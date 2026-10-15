//! From the fragments to the program. It runs when the check is over. Which of the errors that the check has found matter is known
//! here: those that lie in what is reached.
//!
//! 1. Who defines what. A function is defined by the fragment that has its body. A class, an environment and a variable that a file
//!    declares are what the fragment of that file says. The layout of an object type, which belongs to no file, is what the first
//!    fragment in program order says that defines it.
//! 2. What is reached from the entry points: by calls, by closures, by the types of values, by the members of classes. A function of a
//!    class is only reached once a function that is reached evaluates the declaration of the class, and a member that no code uses
//!    by itself only once code uses the constructor: see `Reach::release`. Everything else is dropped.
//! 3. Numbers. Functions: the entry function, then the files in program order, each with its functions in the order of its fragment.
//!    Strings, types, layouts and variables: by first mention, going through the functions in that order. Nothing depends on which
//!    thread has translated what, nor on the value of an identity or the order of a hash table.
//! 4. Every function is renumbered, independently of the others.
//! 5. What the fragments have taken the declarations of other files for is compared with what those are. A difference is a problem: code
//!    has been translated by a fact that does not hold.
//! 6. By which names the code that is reached stores properties. A property that nothing stores does not exist: no object is required to
//!    have it, and its field needs no room (`field_flags::NEVER_STORED`). And under which names it is expected to store no number but
//!    int32s (`field_flags::EXPECTED_INT32`), from how numbers get from place to place in the code that is reached.
//! 7. What was noted for the code that is reached is put together, and the checker says which objects are of which types
//!    (`begin_subtypes`). The questions that leaves for the relation between types are shared out to checkers of their own.
//! 8. What messages and stack traces are made of: the path of each module as it is shown, its lines, and the types of the fields as text.
//!    No code depends on it.
//!
//! What the checker is asked here: the identity of every type that was kept, which classes may be extended by their value, which takes
//! the type of what stands after `extends` in the classes that are not laid out, and those questions. Nothing else is derived
//! again, but for the layouts that no fragment defines: those are described in tasks like those of the check, as many rounds of them
//! as it takes.

use crate::build::Problem;
use crate::declared::{Declared, DeclaredTable, Part};
use crate::format::line_table;
use crate::fragment::{Definition, Fragment, FuncKey, Function, Ids, LayoutKey, LocalToProgram, Mentioning, Mentions, ModulePart, NO_FILE, Notes, Outline, ProgramIds, RuntimeModule, Shape, Used, for_each_id_of_func, for_each_id_of_global, for_each_id_of_layout, outline_flags};
use crate::id::{FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{self, Def, Func, FuncKind, Layout, LayoutKind, Literal, NO_VARIABLE, Op, Prediction, Program, Strs, Term, Why, class_flags, field_flags, func_flags, method_flags};
use bun_sema::atom::Atom;
use bun_sema::check::task::Finished;
use bun_sema::check::{Answer, Checker, CompilerDiagnostic, Identity, Int32Verdict, KindsDeclared, MethodStore, Noted, NumberFlow, Program as Checked, Question, ReplacedMethods, compute_ecma_line_starts, expected_int32};
use bun_sema::hir::{self, ClassId, Flags, StmtKind};
use bun_sema::program::{Builtin, FileId};
use bun_sema::resolve::get_relative_path_from_directory;
use bun_sema::types::TypeId;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::collections::VecDeque;
use std::mem::MaybeUninit;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::{Duration, Instant};

mod nil;
mod reads;
mod reuse;
mod strangers;
mod throws;

#[derive(Default)]
pub struct Linked {
    pub program: Program,
    /// What could not be translated of the code that is reached, and what the fragments do not agree on.
    pub problems: Vec<Problem>,
    /// `Membership::sizes`, as a line.
    pub members: String,
    /// What `Explain` has asked for, a line each.
    pub explained: Vec<String>,
    /// For each of the errors that `link` was handed: why it does not lie in code that is in the program. `None`: it does.
    pub errors: Vec<Option<Elsewhere>>,
    /// The modules of the runtime that are not in the program because something of them could not be translated, each with the first
    /// such thing. The registry runs them as it does without an image.
    pub builtin_modules_left_out: Vec<(u32, Problem)>,
    /// The same for the builtin functions.
    pub builtin_functions_left_out: Vec<(u32, Problem)>,
    pub found: Vec<CompilerDiagnostic>,
    pub times: Times,
}

/// What the link says of what it has decided, for whoever asks why.
#[derive(Default, Copy, Clone)]
pub struct Explain {
    /// Why each view that admits objects that are not laid out does: `Checker::explain_foreign`.
    pub foreign: bool,
    /// How many layouts a built-in may freeze or give another prototype, and how many stores test for it, in numbers alone: `Checker::explain_alterations`.
    pub alterations: bool,
    /// Which fields have a name that nothing stores: `explain_fields`.
    pub fields: bool,
    /// Under which names of fields the numbers are expected to be int32s, and why not under the others: `Checker::explain_int32_fields`.
    pub integers: bool,
    /// Where the soundness closure is and how large its tables are, on stderr as it goes, and `Subtypes::report` at the end.
    pub progress: Option<fn(std::fmt::Arguments<'_>)>,
    /// How much of what the modules do when they are evaluated may be deferred: `Checker::explain_deferred`.
    pub deferred: bool,
    pub rows: bool,
    /// How many of the places and of the reads of typed code go by a fact: `explain_given`.
    pub given: bool,
    pub throws: bool,
    pub throws_json: bool,
    pub throws_all: bool,
}

impl Explain {
    pub const REPORTS: [&'static str; 4] = ["throws", "throws-all", "throws-json", "throws-all-json"];
    pub const WORDS: [&'static str; 11] = ["alterations", "deferred", "fields", "foreign", "given", "integers", "rows", "throws", "throws-all", "throws-all-json", "throws-json"];

    pub fn set(&mut self, word: &[u8]) -> bool {
        let asked = match word {
            b"alterations" => &mut self.alterations,
            b"deferred" => &mut self.deferred,
            b"fields" => &mut self.fields,
            b"foreign" => &mut self.foreign,
            b"given" => &mut self.given,
            b"integers" => &mut self.integers,
            b"rows" => &mut self.rows,
            b"throws" => &mut self.throws,
            b"throws-json" => &mut self.throws_json,
            b"throws-all" | b"throws-all-json" => {
                self.throws_all = true;
                if word == b"throws-all" { &mut self.throws } else { &mut self.throws_json }
            }
            _ => return false,
        };
        *asked = true;
        true
    }
}

/// Where the time of the link goes.
#[derive(Default)]
pub struct Times {
    /// By step, in the order they are first come by: how long it has taken in all.
    pub steps: Vec<(&'static str, Duration)>,
    /// How many rounds it has taken to describe the layouts that no fragment defines, and how many those were.
    pub rounds: usize,
    pub layouts_described: usize,
}

impl Times {
    /// The time since `since` has gone into the step. From now on it goes into the next.
    fn add(&mut self, step: &'static str, since: &mut Instant) {
        let spent = std::mem::replace(since, Instant::now()).elapsed();
        match self.steps.iter_mut().find(|known| known.0 == step) {
            Some(known) => known.1 += spent,
            None => self.steps.push((step, spent)),
        }
    }
}

/// Defines the layouts of the types, in a fragment of no file, and those that they lead to through the types of their fields and of which
/// the last argument says that nobody defines them. A fragment names a layout without defining it where the code of its file does not
/// look into the objects. If no file does, nobody has defined it.
pub type Describe<'a> = &'a (dyn Fn(&mut Checker<'_, '_>, &[TypeId], &dyn Fn(Identity) -> bool) -> Fragment + Sync);

/// A part of a fragment, by the number of the fragment and its number there.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
struct At {
    fragment: u32,
    index: u32,
}

impl At {
    fn new(fragment: usize, index: usize) -> At {
        At { fragment: fragment as u32, index: index as u32 }
    }
}

// ───────────────────────────── names, for the messages ─────────────────────────────

/// What mentions something.
#[derive(Copy, Clone, Default)]
enum By {
    /// The program starts with it.
    #[default]
    Entry,
    Func(At),
    Layout(At),
}

fn text_of(strs: &Strs, name: StrId) -> String {
    if name.is_none() { String::new() } else { String::from_utf8_lossy(strs.get(name)).into_owned() }
}

fn name_of_func(fragments: &[Fragment], at: At) -> String {
    let fragment = &fragments[at.fragment as usize];
    let function = &fragment.funcs[at.index as usize];
    let name = function.func.as_ref().map_or_else(String::new, |func| text_of(&fragment.strs, func.name));
    format!("the function `{name}` ({:?})", function.key)
}

fn name_of_layout(fragments: &[Fragment], at: At) -> String {
    let fragment = &fragments[at.fragment as usize];
    let shape = &fragment.layouts[at.index as usize];
    format!("the layout `{}` ({:x?})", text_of(&fragment.strs, shape.name), shape.key)
}

impl By {
    fn name(self, fragments: &[Fragment]) -> String {
        match self {
            By::Entry => "the entry point".to_owned(),
            By::Func(at) => name_of_func(fragments, at),
            By::Layout(at) => name_of_layout(fragments, at),
        }
    }

    /// A problem with what it mentions, at the place where it is.
    fn problem(self, fragments: &[Fragment], nowhere: FileId, what: String) -> Problem {
        let (file, pos) = match self {
            By::Entry => (nowhere, 0),
            By::Func(at) => {
                let function = &fragments[at.fragment as usize].funcs[at.index as usize];
                (function.key.file(), function.func.as_ref().map_or(0, |func| func.pos))
            }
            By::Layout(at) => {
                let fragment = &fragments[at.fragment as usize];
                (fragment.layouts[at.index as usize].key.file().unwrap_or(if fragment.file == NO_FILE { nowhere } else { fragment.file }), 0)
            }
        };
        Problem { file, pos, what: what.into() }
    }
}

// ───────────────────────────── who defines what ─────────────────────────────

#[derive(Default)]
struct Index {
    funcs: Vec<AtomicU64>,
    layouts: Vec<AtomicU64>,
    globals: Vec<AtomicU64>,
    /// The number of the fragment of each file.
    by_file: FxHashMap<FileId, u32>,
}

const NOT_FOUND: u64 = u64::MAX;

/// The first that has the last word, or else the first.
fn prefer(known: &[AtomicU64], id: u32, at: At, has_last_word: bool) {
    known[id as usize].fetch_min(u64::from(!has_last_word) << 63 | u64::from(at.fragment) << 32 | u64::from(at.index), Ordering::Relaxed);
}

fn preferred(known: &[AtomicU64], id: u32) -> Option<At> {
    let found = known.get(id as usize)?.load(Ordering::Relaxed);
    (found != NOT_FOUND).then_some(At { fragment: (found >> 32) as u32 & (u32::MAX >> 1), index: found as u32 })
}

impl Index {
    fn grow(&mut self, ids: &ProgramIds) {
        self.funcs.resize_with(ids.funcs.bound(), || AtomicU64::new(NOT_FOUND));
        self.layouts.resize_with(ids.layouts.bound(), || AtomicU64::new(NOT_FOUND));
        self.globals.resize_with(ids.globals.bound(), || AtomicU64::new(NOT_FOUND));
    }

    fn add(&self, number: usize, fragment: &Fragment) {
        let ids = &fragment.program_ids;
        for (i, function) in fragment.funcs.iter().enumerate().filter(|(_, function)| function.func.is_some()) {
            prefer(&self.funcs, ids.funcs[i], At::new(number, i), function.body.is_some());
        }
        for (i, shape) in fragment.layouts.iter().enumerate() {
            let Some(definition) = &shape.definition else { continue };
            // The accessors of an object literal are listed where the literal is written. Whoever else lays its type out has none.
            let lists_accessors = definition.layout.kind == LayoutKind::Record && !definition.layout.methods.is_empty();
            prefer(&self.layouts, ids.layouts[i], At::new(number, i), lists_accessors || shape.key.file() == Some(fragment.file));
        }
        for (i, variable) in fragment.globals.iter().enumerate() {
            prefer(&self.globals, ids.globals[i], At::new(number, i), variable.key.file() == Some(fragment.file));
        }
    }

    fn func(&self, id: u32) -> Option<At> {
        preferred(&self.funcs, id)
    }

    fn layout(&self, id: u32) -> Option<At> {
        preferred(&self.layouts, id)
    }

    fn global(&self, id: u32) -> Option<At> {
        preferred(&self.globals, id)
    }

    fn func_by_key(&self, ids: &ProgramIds, key: FuncKey) -> Option<u32> {
        ids.funcs.find(&key).filter(|&id| self.func(id).is_some())
    }

    fn record(&self, ids: &ProgramIds, identity: Identity) -> Option<At> {
        self.layout(ids.layouts.find(&LayoutKey::Record(identity))?)
    }
}

// ───────────────────────────── what is reached ─────────────────────────────

enum Work {
    /// The body of the function.
    Func(At),
    /// The definition of the layout.
    Layout(At),
    /// The part of that number of the body of the function.
    Part(At, u32),
}

mod reached {
    pub(super) const IS_REACHED: u8 = 1;
    /// Of a function: its body is reached too. Of the others only what a caller has to know is kept.
    pub(super) const BODY: u8 = 1 << 1;
    /// Closures are made of it.
    pub(super) const VALUE: u8 = 1 << 2;
    /// It is the constructor, a method or an accessor of a class that is reached.
    pub(super) const MEMBER: u8 = 1 << 3;
    /// Code that is reached calls it or makes closures of it. The others are only members of classes that are reached.
    pub(super) const USED_BY_CODE: u8 = 1 << 4;
    /// Of a class: its declaration is evaluated by a function that is reached.
    pub(super) const DECLARED: u8 = 1 << 1;
    /// Of a class: its constructor is used by code: there may be objects of it, or somebody may have the class object.
    pub(super) const CONSTRUCTED: u8 = 1 << 2;
}

#[derive(Default)]
struct Reach {
    funcs: Vec<u8>,
    layouts: Vec<u8>,
    globals: Vec<bool>,
    /// By variable that nothing has mentioned so far: the parts of the bodies of modules that are reached and that store to it.
    parts_storing: FxHashMap<u32, Vec<(At, u32)>>,
    /// The parts that run: something else mentions a variable that they store to.
    parts: FxHashSet<(At, u32)>,
    /// By class: its functions that are reached and cannot run yet. See `release`.
    waiting: FxHashMap<u32, Vec<At>>,
    seen_tys: Vec<bool>,
    work: Vec<Work>,
    /// By the name of a built-in: the functions of the prelude that the engine may call in its place. A function that is reached and
    /// calls or reads something by the name, a global too, reaches them.
    prelude: FxHashMap<Vec<u8>, Vec<u32>>,
    names_left_in: Vec<(usize, Vec<StrId>)>,
    /// What is being gone through.
    by: By,
    /// The modules of the runtime that can be in the image, by number and by name. One is reached when code that is reached asks for it. One that is not in the image the registry runs as it does without an image.
    runtime_by_number: FxHashMap<i64, FileId>,
    runtime_by_name: FxHashMap<Vec<u8>, FileId>,
    evaluations_of_runtime: FxHashMap<FileId, u32>,
    /// The object types whose layouts are reached and that no fragment defines, with the shape that names each and what mentions it.
    missing: Vec<(Identity, At, By)>,
    /// What else is reached and not defined.
    undefined_funcs: Vec<(u32, By)>,
    undefined_layouts: Vec<(At, By)>,
}

impl Reach {
    /// There are more fragments than before.
    fn grow(&mut self, fragments: &[Fragment], ids: &ProgramIds) {
        self.funcs.resize(ids.funcs.bound(), 0);
        self.layouts.resize(ids.layouts.bound(), 0);
        self.globals.resize(ids.globals.bound(), false);
        self.seen_tys.resize(ids.bound_of_tys(), false);
        self.names_left_in.resize_with(fragments.len(), || (usize::MAX, Vec::new()));
    }

    fn has(&self, func: u32, flag: u8) -> bool {
        self.funcs[func as usize] & flag != 0
    }

    fn has_body_by_key(&self, ids: &ProgramIds, key: FuncKey) -> bool {
        ids.funcs.find(&key).is_some_and(|id| self.has(id, reached::BODY))
    }

    /// `by_code`: see `reached::USED_BY_CODE`.
    fn key(&mut self, fragments: &[Fragment], index: &Index, id: u32, by_code: bool) {
        let flags = self.funcs[id as usize];
        let is_new = flags & reached::IS_REACHED == 0;
        let is_newly_used = by_code && flags & reached::USED_BY_CODE == 0;
        if !is_new && !is_newly_used {
            return;
        }
        self.funcs[id as usize] = flags | reached::IS_REACHED | if by_code { reached::USED_BY_CODE } else { 0 };
        let Some(at) = index.func(id) else {
            if is_new {
                self.undefined_funcs.push((id, self.by));
            }
            return;
        };
        let fragment = &fragments[at.fragment as usize];
        let function = &fragment.outline.funcs[at.index as usize];
        if is_new {
            let by = std::mem::replace(&mut self.by, By::Func(at));
            for position in function.list(Outline::HEADER_TYS) {
                self.ty_known_as(fragments, index, at.fragment, TyId(fragment.outline.local[position]), fragment.outline.program[position]);
            }
            self.layout(fragments, index, at.fragment, function.class);
            self.by = by;
        }
        if !function.has(outline_flags::HAS_BODY) {
            return;
        }
        if function.class.is_none() {
            if is_new {
                self.funcs[id as usize] |= reached::BODY;
                self.work.push(Work::Func(at));
            }
            return;
        }
        let class = fragment.program_ids.layouts[function.class.idx()];
        let before = self.layouts[class as usize];
        if by_code && function.has(outline_flags::IS_CONSTRUCTOR) {
            self.layouts[class as usize] |= reached::CONSTRUCTED;
        }
        if before & reached::DECLARED == 0 || before != self.layouts[class as usize] {
            if is_new {
                self.waiting.entry(class).or_default().push(at);
            }
            return self.release(fragments, class);
        }
        let is_ready = before & reached::CONSTRUCTED != 0 || self.funcs[id as usize] & reached::USED_BY_CODE != 0;
        if !is_ready {
            return self.waiting.entry(class).or_default().push(at);
        }
        if !is_new {
            let Some(waiting) = self.waiting.get_mut(&class) else { return };
            let Some(position) = waiting.iter().position(|&other| other == at) else { return };
            waiting.remove(position);
        }
        self.funcs[id as usize] |= reached::BODY;
        self.work.push(Work::Func(at));
    }

    /// A function of a class runs only once the declaration of the class has been evaluated. A method, an accessor or the constructor
    /// that no code uses by itself takes an object of the class or the class object besides, and there is neither unless code uses
    /// the constructor. Those of the functions that wait and that can run by now are gone through.
    fn release(&mut self, fragments: &[Fragment], class: u32) {
        if self.layouts[class as usize] & reached::DECLARED == 0 {
            return;
        }
        let Some(waiting) = self.waiting.get_mut(&class) else { return };
        let is_constructed = self.layouts[class as usize] & reached::CONSTRUCTED != 0;
        let id_at = |at: At| fragments[at.fragment as usize].program_ids.funcs[at.index as usize] as usize;
        let (ready, still): (Vec<At>, Vec<At>) = waiting.iter().partition(|&&at| is_constructed || self.funcs[id_at(at)] & reached::USED_BY_CODE != 0);
        *waiting = still;
        for at in ready {
            self.funcs[id_at(at)] |= reached::BODY;
            self.work.push(Work::Func(at));
        }
    }

    fn func(&mut self, fragments: &[Fragment], index: &Index, from: u32, func: FuncId, by_code: bool) -> usize {
        let id = fragments[from as usize].program_ids.funcs[func.idx()];
        self.key(fragments, index, id, by_code);
        id as usize
    }

    fn layout(&mut self, fragments: &[Fragment], index: &Index, from: u32, layout: LayoutId) {
        if layout.is_none() {
            return;
        }
        self.layout_known_as(fragments, index, from, layout, fragments[from as usize].program_ids.layouts[layout.idx()]);
    }

    fn layout_known_as(&mut self, fragments: &[Fragment], index: &Index, from: u32, layout: LayoutId, id: u32) {
        if layout.is_none() || self.layouts[id as usize] & reached::IS_REACHED != 0 {
            return;
        }
        self.layouts[id as usize] |= reached::IS_REACHED;
        match (index.layout(id), fragments[from as usize].layouts[layout.idx()].key) {
            (Some(at), _) => self.work.push(Work::Layout(at)),
            (None, LayoutKey::Record(identity)) => self.missing.push((identity, At::new(from as usize, layout.idx()), self.by)),
            (None, _) => self.undefined_layouts.push((At::new(from as usize, layout.idx()), self.by)),
        }
    }

    fn ty(&mut self, fragments: &[Fragment], index: &Index, from: u32, ty: TyId) {
        if ty.is_some() {
            self.ty_known_as(fragments, index, from, ty, fragments[from as usize].program_ids.tys[ty.idx()]);
        }
    }

    fn ty_known_as(&mut self, fragments: &[Fragment], index: &Index, from: u32, ty: TyId, id: u32) {
        if ty.is_none() || std::mem::replace(&mut self.seen_tys[id as usize], true) {
            return;
        }
        for part in &fragments[from as usize].tys.get(ty).parts {
            match part {
                Part::Class(layout) => self.layout(fragments, index, from, *layout),
                Part::Global(_, arguments) => {
                    for &argument in arguments {
                        self.ty(fragments, index, from, argument);
                    }
                }
                Part::Array(element) => self.ty(fragments, index, from, *element),
            }
        }
    }

    fn global(&mut self, fragments: &[Fragment], index: &Index, from: u32, global: GlobalId) {
        self.global_known_as(fragments, index, fragments[from as usize].program_ids.globals[global.idx()]);
    }

    fn global_known_as(&mut self, fragments: &[Fragment], index: &Index, id: u32) {
        if std::mem::replace(&mut self.globals[id as usize], true) {
            return;
        }
        for part in self.parts_storing.remove(&id).unwrap_or_default() {
            if self.parts.insert(part) {
                self.work.push(Work::Part(part.0, part.1));
            }
        }
        let at = index.global(id).expect(IS_INDEXED);
        let declared = fragments[at.fragment as usize].globals[at.index as usize].global.declared;
        self.ty(fragments, index, at.fragment, declared);
    }

    /// `only_stored`: the variables among them that are stored to and not read: what else is stored to them nobody can tell by that.
    fn mention(&mut self, fragments: &[Fragment], index: &Index, from: u32, mentions: &Mentions, only_stored: &[GlobalId], is_layout: bool) {
        for ty in mentions.tys() {
            self.ty(fragments, index, from, ty);
        }
        for layout in mentions.layouts() {
            self.layout(fragments, index, from, layout);
        }
        for global in mentions.globals() {
            if only_stored.binary_search(&global).is_ok() {
                let at = index.global(fragments[from as usize].program_ids.globals[global.idx()]).expect(IS_INDEXED);
                self.ty(fragments, index, at.fragment, fragments[at.fragment as usize].globals[at.index as usize].global.declared);
            } else {
                self.global(fragments, index, from, global);
            }
        }
        for func in mentions.called() {
            let id = self.func(fragments, index, from, func, !is_layout);
            if is_layout {
                self.funcs[id] |= reached::MEMBER;
            }
        }
        for func in mentions.values() {
            let id = self.func(fragments, index, from, func, true);
            self.funcs[id] |= reached::VALUE;
        }
    }

    fn mention_of_function(&mut self, fragments: &[Fragment], index: &Index, at: At) {
        let Outline { funcs, local, program } = &fragments[at.fragment as usize].outline;
        let function = &funcs[at.index as usize];
        for position in function.list(Outline::TYS) {
            self.ty_known_as(fragments, index, at.fragment, TyId(local[position]), program[position]);
        }
        for position in function.list(Outline::LAYOUTS) {
            self.layout_known_as(fragments, index, at.fragment, LayoutId(local[position]), program[position]);
        }
        for &global in &program[function.list(Outline::GLOBALS)] {
            self.global_known_as(fragments, index, global);
        }
        for &func in &program[function.list(Outline::CALLED)] {
            self.key(fragments, index, func, true);
        }
        for &func in &program[function.list(Outline::VALUES)] {
            self.key(fragments, index, func, true);
            self.funcs[func as usize] |= reached::VALUE;
        }
    }

    /// See `runtime_by_number`.
    fn ask_the_runtime(&mut self, fragments: &[Fragment], index: &Index, at: At) {
        let fragment = &fragments[at.fragment as usize];
        let function = &fragment.outline.funcs[at.index as usize];
        if !function.has(outline_flags::HAS_HEADER) {
            return;
        }
        let mut asked: Vec<FileId> = Vec::new();
        let file = fragment.file;
        if function.has(outline_flags::EVALUATES_MODULE)
            && self.evaluations_of_runtime.contains_key(&file)
            && let Some((&number, _)) = self.runtime_by_number.iter().find(|module| *module.1 == file)
        {
            let besides = bun_builtin_syntax::Archive::embedded().manifest().required_besides(number as u32);
            asked.extend(besides.iter().filter_map(|&id| self.runtime_by_number.get(&i64::from(id))));
        }
        let of_fragment = &fragment.summary.runtime_modules;
        for &(_, module) in of_fragment[of_fragment.partition_point(|found| found.0 < at.index)..].iter().take_while(|found| found.0 == at.index) {
            let found = match module {
                RuntimeModule::Number(number) => self.runtime_by_number.get(&number),
                RuntimeModule::Name(name) => self.runtime_by_name.get(fragment.strs.get(name)),
            };
            asked.extend(found.copied());
        }
        for file in asked {
            let evaluation = self.evaluations_of_runtime[&file];
            self.key(fragments, index, evaluation, true);
        }
    }

    /// Until nothing is left to do but to describe what is `missing`.
    fn run(&mut self, fragments: &[Fragment], index: &Index) {
        while let Some(work) = self.work.pop() {
            match work {
                Work::Func(at) => {
                    self.by = By::Func(at);
                    let fragment = &fragments[at.fragment as usize];
                    let function = &fragment.outline.funcs[at.index as usize];
                    if !function.has(outline_flags::HAS_BODY) {
                        continue;
                    }
                    self.ask_the_runtime(fragments, index, at);
                    self.mention_of_function(fragments, index, at);
                    let parts: &[ModulePart] = if function.has(outline_flags::HAS_PARTS) { fragment.funcs[at.index as usize].body.as_ref().map_or(&[][..], |body| &body.parts[..]) } else { &[] };
                    for (number, part) in parts.iter().enumerate() {
                        let number = number as u32;
                        let stored = part.stores.iter().map(|global| fragment.program_ids.globals[global.idx()]);
                        if stored.clone().any(|id| self.globals[id as usize]) {
                            self.parts.insert((at, number));
                            self.work.push(Work::Part(at, number));
                        } else {
                            stored.for_each(|id| self.parts_storing.entry(id).or_default().push((at, number)));
                        }
                    }
                    if !self.prelude.is_empty() && function.has(outline_flags::HAS_HEADER) {
                        let left = &mut self.names_left_in[at.fragment as usize];
                        if left.0 != self.prelude.len() {
                            *left = (self.prelude.len(), self.prelude.keys().filter_map(|name| fragment.strs.find(name)).collect());
                        }
                        let mut named: Vec<StrId> = Vec::new();
                        if !left.1.is_empty()
                            && let Some(func) = &fragment.funcs[at.index as usize].func
                        {
                            for value in &func.values {
                                if let Def::Op(Op::CallMethod { name, .. } | Op::PropGet { name, .. } | Op::FreeGet { name, .. }) = &value.def
                                    && left.1.contains(name)
                                    && !named.contains(name)
                                {
                                    named.push(*name);
                                }
                            }
                        }
                        for name in named {
                            for key in self.prelude.remove(fragment.strs.get(name)).unwrap_or_default() {
                                self.key(fragments, index, key, true);
                            }
                        }
                    }
                    for position in function.list(Outline::CLASSES_AS_VALUES) {
                        self.layout_known_as(fragments, index, at.fragment, LayoutId(fragment.outline.local[position]), fragment.outline.program[position]);
                    }
                    // A class that is declared and that nothing mentions is no part of the program.
                    for &class in &fragment.outline.program[function.list(Outline::DECLARES)] {
                        if self.layouts[class as usize] & reached::DECLARED == 0 {
                            self.layouts[class as usize] |= reached::DECLARED;
                            self.release(fragments, class);
                        }
                    }
                }
                Work::Part(at, number) => {
                    self.by = By::Func(at);
                    let Some(body) = &fragments[at.fragment as usize].funcs[at.index as usize].body else { continue };
                    let part = &body.parts[number as usize];
                    self.mention(fragments, index, at.fragment, &part.mentions, &part.only_stores, false);
                }
                Work::Layout(at) => {
                    self.by = By::Layout(at);
                    let Some(definition) = &fragments[at.fragment as usize].layouts[at.index as usize].definition else { continue };
                    self.mention(fragments, index, at.fragment, &definition.mentions, &[], true);
                    self.layout(fragments, index, at.fragment, definition.constructs);
                }
            }
        }
    }
}

#[derive(Default)]
struct EvidenceOfStrangers {
    fragments: usize,
    noted: Notes,
    is_absorbed: Vec<bool>,
    classes: usize,
    served: Vec<LayoutKey>,
}

fn classes_served_by_second_bodies(checked: &Checked<'_>, fragments: &[Fragment], index: &Index, reach: &Reach, types: &FxHashMap<Identity, TypeId>, known: &mut EvidenceOfStrangers, in_parallel: InParallel<'_>) -> Vec<LayoutKey> {
    if known.fragments != fragments.len() {
        *known = EvidenceOfStrangers { fragments: fragments.len(), is_absorbed: vec![false; reach.funcs.len()], classes: usize::MAX, ..EvidenceOfStrangers::default() };
    }
    let EvidenceOfStrangers { noted: evidence, is_absorbed, .. } = known;
    let mut not_absorbed: Vec<&Notes> = Vec::new();
    for (number, fragment) in fragments.iter().enumerate().filter(|(_, fragment)| !fragment.summary.with_alterations.is_empty()) {
        if fragment.file != NO_FILE && checked.files.module(fragment.file).is_opaque() {
            continue;
        }
        for i in fragment.summary.with_alterations.iter().map(|&i| i as usize) {
            if let Some(body) = &fragment.funcs[i].body
                && reach.has(fragment.program_ids.funcs[i], reached::BODY)
                && index.func(fragment.program_ids.funcs[i]) == Some(At::new(number, i))
                && !std::mem::replace(&mut is_absorbed[fragment.program_ids.funcs[i] as usize], true)
            {
                not_absorbed.push(&body.notes);
            }
        }
    }
    const FUNCTIONS_OF_A_RUN: usize = 256;
    let is_more_known = !not_absorbed.is_empty();
    let mut runs: Vec<(&[&Notes], Notes)> = not_absorbed.chunks(FUNCTIONS_OF_A_RUN).map(|run| (run, Noted::default())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, of_run)| run.iter().for_each(|notes| of_run.absorb_evidence_of_strangers(notes)));
    for (_, of_run) in runs {
        evidence.absorb(of_run);
    }
    let kept = |list: Vec<Identity>| -> Vec<TypeId> { list.into_iter().filter_map(|identity| types.get(&identity).copied()).collect() };
    let mut classes: Vec<(LayoutKey, TypeId)> = Vec::new();
    for (number, fragment) in fragments.iter().enumerate() {
        for (i, shape) in fragment.layouts.iter().enumerate().filter(|(_, shape)| matches!(shape.key, LayoutKey::Instance(..))) {
            let id = fragment.program_ids.layouts[i];
            if reach.layouts[id as usize] & reached::IS_REACHED != 0
                && index.layout(id) == Some(At::new(number, i))
                && let Some(&ty) = shape.ty.as_ref().and_then(|identity| types.get(identity))
            {
                classes.push((shape.key, ty));
            }
        }
    }
    if !is_more_known && known.classes == classes.len() {
        return known.served.clone();
    }
    known.classes = classes.len();
    let (let_out, entered, entered_if_let_out) = known.noted.evidence_of_strangers();
    if let_out.is_empty() && entered.is_empty() {
        known.served = Vec::new();
        return Vec::new();
    }
    let of_classes: Vec<TypeId> = classes.iter().map(|class| class.1).collect();
    let served = checked.checker().classes_served_by_second_bodies(&kept(let_out), &kept(entered), &kept(entered_if_let_out), &of_classes);
    let mut served: Vec<LayoutKey> = classes.into_iter().zip(served).filter(|class| class.1).map(|class| class.0.0).collect();
    served.sort_unstable_by_key(|key| if let LayoutKey::Instance(file, class) = *key { (file.idx(), class.idx()) } else { (0, 0) });
    known.served.clone_from(&served);
    served
}

/// Takes the part out of the function. Those behind it have been seen to.
fn take_out(func: &mut Func, part: &ModulePart, anything: TyId) {
    for v in part.values(func) {
        func.values[v.idx()] = ir::Value { def: Def::Op(Op::Undefined), pos: 0, ty: anything, prediction: Prediction::None, finds_initialized: false, is_in_tail_position: false };
    }
    let ((from, start), (to, end)) = (part.from, part.to);
    if from == to {
        func.blocks[from.idx()].ops.drain(start as usize..end as usize);
        return;
    }
    func.blocks[from.idx()].ops.truncate(start as usize);
    func.blocks[from.idx()].term = Some(Term::Jump(ir::Target { block: to, args: part.handed_through.iter().copied().filter(|handed| handed.is_some()).collect() }));
    let mut handed = part.handed_through.iter();
    func.blocks[to.idx()].params.retain(|_| handed.next().is_some_and(|handed| handed.is_some()));
    for (index, param) in func.blocks[to.idx()].params.clone().into_iter().enumerate() {
        func.values[param.idx()].def = Def::Param(to, index as u32);
    }
    func.blocks[to.idx()].ops.drain(..end as usize);
    for block in (part.blocks.0..part.blocks.1).filter(|&block| block != to.0) {
        func.blocks[block as usize] = ir::Block { params: Vec::new(), ops: Vec::new(), term: Some(Term::Unreachable) };
    }
}

/// What is left of the body of a module is a function like any other.
fn take_out_parts_that_do_not_run(fragments: &mut [Fragment], reach: &Reach, in_parallel: InParallel<'_>) {
    let mut numbered: Vec<(usize, &mut Fragment)> = fragments.iter_mut().enumerate().collect();
    for_each_mut(&mut numbered, in_parallel, &|(number, fragment)| {
        let number = *number;
        let (anything, mut mentioning) = (fragment.tys.anything, Mentioning::default());
        let Fragment { funcs, outline, program_ids, file, .. } = &mut **fragment;
        for index in 0..funcs.len() {
            if !outline.funcs[index].has(outline_flags::HAS_PARTS) {
                continue;
            }
            let function = &mut funcs[index];
            let (Some(func), Some(body)) = (&mut function.func, &mut function.body) else { continue };
            for (part_number, part) in std::mem::take(&mut body.parts).iter().enumerate().rev() {
                if !reach.parts.contains(&(At::new(number, index), part_number as u32)) {
                    take_out(func, part, anything);
                }
            }
            body.mentions = mentioning.of_func(func);
            outline.funcs[index] = outline.of_function(function, *file, program_ids);
            if let Some(body) = &mut function.body {
                body.mentions = Mentions::default();
            }
        }
    });
}

// ───────────────────────────── numbers ─────────────────────────────

/// For one fragment: the number in the program of what has a number in the fragment. `NONE`: nothing that is reached mentions it.
struct Maps {
    strs: Vec<StrId>,
    tys: Vec<TyId>,
    layouts: Vec<LayoutId>,
    globals: Vec<GlobalId>,
    modules: Vec<ModuleId>,
    /// `NONE`: the function is not reached.
    funcs: Vec<FuncId>,
    /// Whether code of the fragment that is reached calls the function or makes closures of it.
    uses_func: Vec<bool>,
}

enum Pending {
    Layout(LayoutId),
    Global(GlobalId),
}

struct Numbering<'a> {
    fragments: &'a [Fragment],
    index: &'a Index,
    maps: Vec<Maps>,
    strs: Strs,
    strs_not_laid: Vec<(u32, StrId)>,
    tys: DeclaredTable,
    /// By number: where the definition is.
    layouts: Vec<At>,
    globals: Vec<At>,
    /// By number: the file and its name.
    modules: Vec<FileId>,
    str_ids: Vec<StrId>,
    ty_ids: Vec<TyId>,
    layout_ids: Vec<LayoutId>,
    global_ids: Vec<GlobalId>,
    module_ids: FxHashMap<FileId, ModuleId>,
    /// What has its number and whose definition has not been gone through.
    pending: VecDeque<Pending>,
}

type Rank = SmallVec<[u64; 4]>;

impl<'a> Numbering<'a> {
    fn new(fragments: &'a [Fragment], index: &'a Index, ids: &ProgramIds, func_ids: &[FuncId], in_parallel: InParallel<'_>) -> Numbering<'a> {
        let mut maps_of: Vec<(&Fragment, Option<Maps>)> = fragments.iter().map(|fragment| (fragment, None)).collect();
        for_each_mut(&mut maps_of, in_parallel, &|(fragment, maps)| {
            *maps = Some(Maps {
                strs: vec![StrId::NONE; fragment.strs.len()],
                tys: vec![TyId::NONE; fragment.tys.list.len()],
                layouts: vec![LayoutId::NONE; fragment.layouts.len()],
                globals: vec![GlobalId::NONE; fragment.globals.len()],
                modules: vec![ModuleId::NONE; fragment.modules.len()],
                funcs: fragment.program_ids.funcs.iter().map(|&id| func_ids[id as usize]).collect(),
                uses_func: vec![false; fragment.program_ids.funcs.len()],
            });
        });
        let maps = maps_of.into_iter().filter_map(|of_fragment| of_fragment.1).collect();
        Numbering {
            fragments,
            index,
            maps,
            strs: Strs::with_room_for(ids.bound_of_strs()),
            strs_not_laid: Vec::with_capacity(ids.bound_of_strs()),
            tys: DeclaredTable::default(),
            layouts: Vec::with_capacity(ids.layouts.bound()),
            globals: Vec::with_capacity(ids.globals.bound()),
            modules: Vec::new(),
            str_ids: vec![StrId::NONE; ids.bound_of_strs()],
            ty_ids: vec![TyId::NONE; ids.bound_of_tys()],
            layout_ids: vec![LayoutId::NONE; ids.layouts.bound()],
            global_ids: vec![GlobalId::NONE; ids.globals.bound()],
            module_ids: FxHashMap::default(),
            pending: VecDeque::new(),
        }
    }

    fn str(&mut self, from: u32, local: StrId) -> StrId {
        if local.is_none() {
            return local;
        }
        let fragment = &self.fragments[from as usize];
        let known = &mut self.str_ids[fragment.program_ids.strs[local.idx()] as usize];
        if known.is_none() {
            *known = StrId::new(self.strs.len() + self.strs_not_laid.len());
            self.strs_not_laid.push((from, local));
        }
        *known
    }

    fn lay_strs(&mut self, in_parallel: InParallel<'_>) {
        const STRINGS_OF_A_RUN: usize = 4096;
        let Numbering { fragments, strs, strs_not_laid, .. } = self;
        let fragments = *fragments;
        let mut runs: Vec<(&[(u32, StrId)], Vec<u8>, Vec<u32>, Vec<u64>)> = strs_not_laid.chunks(STRINGS_OF_A_RUN).map(|run| (run, Vec::new(), Vec::new(), Vec::new())).collect();
        for_each_mut(&mut runs, in_parallel, &|(run, bytes, lengths, hashes)| {
            for &(from, local) in run.iter() {
                let of_fragment = &fragments[from as usize].strs;
                bytes.extend_from_slice(of_fragment.get(local));
                lengths.push(of_fragment.get(local).len() as u32);
                hashes.push(of_fragment.hash(local));
            }
        });
        for (_, bytes, lengths, hashes) in &runs {
            strs.add_all(bytes, lengths, hashes);
        }
    }

    /// Orders the parts of a type by what they are, not by the numbers of the fragment.
    fn rank_of_part(&self, from: u32, part: &Part) -> Rank {
        let fragment = &self.fragments[from as usize];
        let mut rank = Rank::new();
        match part {
            Part::Class(layout) if layout.is_none() => rank.push(0),
            Part::Class(layout) => rank.extend(match fragment.layouts[layout.idx()].key {
                LayoutKey::Record(identity) => [1, identity[0], identity[1]],
                LayoutKey::Instance(file, class) => [2, u64::from(file.0), u64::from(class.0)],
                LayoutKey::ClassEnvironment(file, class) => [3, u64::from(file.0), u64::from(class.0)],
                LayoutKey::Environment(file, number) => [4, u64::from(file.0), u64::from(number)],
            }),
            Part::Global(name, arguments) => {
                let name = fragment.strs.get(*name);
                rank.extend([5, name.len() as u64]);
                rank.extend(name.iter().map(|&byte| u64::from(byte)));
                for &argument in arguments {
                    self.add_rank_of_ty(from, argument, &mut rank);
                }
            }
            Part::Array(element) => {
                rank.push(6);
                self.add_rank_of_ty(from, *element, &mut rank);
            }
        }
        rank
    }

    fn add_rank_of_ty(&self, from: u32, ty: TyId, rank: &mut Rank) {
        if ty.is_none() {
            return rank.push(u64::MAX);
        }
        let Declared { prims, ints, parts, any_object, any_function } = self.fragments[from as usize].tys.get(ty);
        let (least, most) = ints.unwrap_or((0, 0));
        rank.extend([u64::from(*prims), u64::from(*any_object) | u64::from(*any_function) << 1 | u64::from(ints.is_some()) << 2, least as u64, most as u64, parts.len() as u64]);
        let mut of_parts: SmallVec<[Rank; 4]> = parts.iter().map(|part| self.rank_of_part(from, part)).collect();
        of_parts.sort_unstable();
        rank.extend(of_parts.into_iter().flatten());
    }

    /// A description only mentions descriptions that were there before it, so this ends.
    fn ty(&mut self, from: u32, local: TyId) -> TyId {
        if local.is_none() {
            return local;
        }
        let fragments = self.fragments;
        let program_id = fragments[from as usize].program_ids.tys[local.idx()] as usize;
        let known = self.ty_ids[program_id];
        if known.is_some() {
            return known;
        }
        let Declared { prims, ints, parts, any_object, any_function } = fragments[from as usize].tys.get(local);
        // What is mentioned for the first time gets its number here. The parts are in the order of the fragment's numbers: for the parts
        // of a union that is the order of the checker's ids, which goes by the plan of the check.
        let mut order: SmallVec<[usize; 4]> = (0..parts.len()).collect();
        if parts.len() > 1 {
            order.sort_by_cached_key(|&part| self.rank_of_part(from, &parts[part]));
        }
        let mut renumbered: SmallVec<[Part; 1]> = SmallVec::new();
        for part in order.into_iter().map(|part| &parts[part]) {
            renumbered.push(match part {
                Part::Class(layout) => Part::Class(self.layout(from, *layout)),
                Part::Global(name, arguments) => Part::Global(self.str(from, *name), arguments.iter().map(|&argument| self.ty(from, argument)).collect()),
                Part::Array(element) => Part::Array(self.ty(from, *element)),
            });
        }
        renumbered.sort_unstable();
        let id = self.tys.intern(Declared { prims: *prims, ints: *ints, parts: renumbered, any_object: *any_object, any_function: *any_function });
        self.ty_ids[program_id] = id;
        id
    }

    fn layout(&mut self, from: u32, local: LayoutId) -> LayoutId {
        if local.is_none() {
            return local;
        }
        let fragments = self.fragments;
        let program_id = fragments[from as usize].program_ids.layouts[local.idx()];
        let numbered = Some(self.layout_ids[program_id as usize]).filter(|id| id.is_some());
        match (numbered, self.index.layout(program_id)) {
            (Some(id), _) => id,
            (None, Some(at)) => {
                // What a class extends has the smaller number: the engine makes the classes in the order of their numbers.
                if let Some(definition) = &fragments[at.fragment as usize].layouts[at.index as usize].definition {
                    self.layout(at.fragment, definition.layout.base);
                }
                let id = LayoutId::new(self.layouts.len());
                self.layouts.push(at);
                self.layout_ids[program_id as usize] = id;
                self.pending.push_back(Pending::Layout(id));
                id
            }
            // A problem has been reported.
            (None, None) => LayoutId::NONE,
        }
    }

    fn global(&mut self, from: u32, local: GlobalId) -> GlobalId {
        let fragments = self.fragments;
        let program_id = fragments[from as usize].program_ids.globals[local.idx()];
        match Some(self.global_ids[program_id as usize]).filter(|id| id.is_some()) {
            Some(id) => id,
            None => {
                let id = GlobalId::new(self.globals.len());
                // What belongs to no file is as the first that mentions it has it.
                let belongs_to_a_file = fragments[from as usize].globals[local.idx()].key.file().is_some();
                self.globals.push(if belongs_to_a_file { self.index.global(program_id).expect(IS_INDEXED) } else { At::new(from as usize, local.idx()) });
                self.global_ids[program_id as usize] = id;
                self.pending.push_back(Pending::Global(id));
                id
            }
        }
    }

    fn module_of(&mut self, file: FileId) -> ModuleId {
        if let Some(&known) = self.module_ids.get(&file) {
            return known;
        }
        let id = ModuleId::new(self.modules.len());
        self.modules.push(file);
        self.module_ids.insert(file, id);
        id
    }

    fn module(&mut self, from: u32, local: ModuleId) -> ModuleId {
        if local.is_none() {
            return local;
        }
        let id = self.module_of(self.fragments[from as usize].modules[local.idx()]);
        self.maps[from as usize].modules[local.idx()] = id;
        id
    }

    fn mention(&mut self, from: u32, mentions: &Mentions) {
        for text in mentions.strs() {
            self.str(from, text);
        }
        for ty in mentions.tys() {
            self.ty(from, ty);
        }
        for layout in mentions.layouts() {
            self.layout(from, layout);
        }
        for global in mentions.globals() {
            self.global(from, global);
        }
    }

    fn mention_of_function(&mut self, at: At) {
        let fragments = self.fragments;
        let Outline { funcs, local, program } = &fragments[at.fragment as usize].outline;
        let function = &funcs[at.index as usize];
        for i in function.list(Outline::STRS) {
            if self.str_ids[program[i] as usize].is_none() {
                self.str(at.fragment, StrId(local[i]));
            }
        }
        for i in function.list(Outline::TYS) {
            if self.ty_ids[program[i] as usize].is_none() {
                self.ty(at.fragment, TyId(local[i]));
            }
        }
        for i in function.list(Outline::LAYOUTS) {
            if self.layout_ids[program[i] as usize].is_none() {
                self.layout(at.fragment, LayoutId(local[i]));
            }
        }
        for i in function.list(Outline::GLOBALS) {
            if self.global_ids[program[i] as usize].is_none() {
                self.global(at.fragment, GlobalId(local[i]));
            }
        }
    }

    fn header_of_function(&mut self, at: At) {
        let fragments = self.fragments;
        let Outline { funcs, local, .. } = &fragments[at.fragment as usize].outline;
        let function = &funcs[at.index as usize];
        let [this_declared, result, ref handed @ ..] = local[function.list(Outline::HEADER_TYS)] else { unreachable!("{IS_KNOWN}") };
        let (captures, params) = handed.split_at(function.captures as usize);
        self.str(at.fragment, function.name);
        self.module(at.fragment, function.module);
        for &ty in captures.iter().chain([&this_declared]).chain(params).chain([&result]) {
            self.ty(at.fragment, TyId(ty));
        }
    }

    /// Goes through the definitions of what has got a number, and of what gets one on the way.
    fn settle(&mut self) {
        let fragments = self.fragments;
        while let Some(pending) = self.pending.pop_front() {
            match pending {
                Pending::Layout(id) => {
                    let at = self.layouts[id.idx()];
                    let Some(definition) = &fragments[at.fragment as usize].layouts[at.index as usize].definition else { continue };
                    self.mention(at.fragment, &definition.mentions);
                    self.layout(at.fragment, definition.constructs);
                }
                Pending::Global(id) => {
                    let at = self.globals[id.idx()];
                    let global = &fragments[at.fragment as usize].globals[at.index as usize].global;
                    self.str(at.fragment, global.name);
                    self.module(at.fragment, global.module);
                    self.ty(at.fragment, global.declared);
                }
            }
        }
    }

    fn fill_maps(&mut self, included_of: &[[&[(At, bool)]; 2]], in_parallel: InParallel<'_>) {
        let Numbering { fragments, maps, layouts, globals, str_ids, ty_ids, layout_ids, global_ids, .. } = self;
        let mut defined: Vec<[Vec<u32>; 2]> = vec![Default::default(); fragments.len()];
        for at in layouts.iter() {
            defined[at.fragment as usize][0].push(at.index);
        }
        for at in globals.iter() {
            defined[at.fragment as usize][1].push(at.index);
        }
        let mut of_fragments: Vec<(usize, &Fragment, &mut Maps)> = fragments.iter().zip(maps).enumerate().map(|(number, (fragment, maps))| (number, fragment, maps)).collect();
        for_each_mut(&mut of_fragments, in_parallel, &|(number, fragment, maps)| {
            let ids = &fragment.program_ids;
            let set_str = |maps: &mut Maps, local: u32| {
                if local != StrId::NONE.0 {
                    maps.strs[local as usize] = str_ids[ids.strs[local as usize] as usize];
                }
            };
            let set_ty = |maps: &mut Maps, local: u32| {
                if local != TyId::NONE.0 {
                    maps.tys[local as usize] = ty_ids[ids.tys[local as usize] as usize];
                }
            };
            let set_layout = |maps: &mut Maps, local: u32| {
                if local != LayoutId::NONE.0 {
                    maps.layouts[local as usize] = layout_ids[ids.layouts[local as usize] as usize];
                }
            };
            let set_global = |maps: &mut Maps, local: u32| maps.globals[local as usize] = global_ids[ids.globals[local as usize] as usize];
            let Outline { funcs, local, .. } = &fragment.outline;
            for &(at, has_body) in included_of[*number].iter().copied().flatten() {
                let function = &funcs[at.index as usize];
                if has_body {
                    local[function.list(Outline::STRS)].iter().for_each(|&text| set_str(maps, text));
                    local[function.list(Outline::TYS)].iter().for_each(|&described| set_ty(maps, described));
                    local[function.list(Outline::LAYOUTS)].iter().chain(&local[function.list(Outline::CLASSES_AS_VALUES)]).for_each(|&shape| set_layout(maps, shape));
                    local[function.list(Outline::GLOBALS)].iter().for_each(|&variable| set_global(maps, variable));
                    for &func in local[function.list(Outline::CALLED)].iter().chain(&local[function.list(Outline::VALUES)]) {
                        maps.uses_func[func as usize] = true;
                    }
                } else {
                    set_str(maps, function.name.0);
                    local[function.list(Outline::HEADER_TYS)].iter().for_each(|&described| set_ty(maps, described));
                }
                set_layout(maps, function.class.0);
            }
            for &index in &defined[*number][0] {
                let Some(definition) = &fragment.layouts[index as usize].definition else { continue };
                definition.mentions.strs().for_each(|text| set_str(maps, text.0));
                definition.mentions.tys().for_each(|described| set_ty(maps, described.0));
                definition.mentions.layouts().chain([definition.constructs, definition.layout.base]).for_each(|shape| set_layout(maps, shape.0));
                definition.mentions.globals().for_each(|variable| set_global(maps, variable.0));
                for func in definition.mentions.called().chain(definition.mentions.values()) {
                    maps.uses_func[func.idx()] = true;
                }
            }
            for &index in &defined[*number][1] {
                let variable = &fragment.globals[index as usize].global;
                set_str(maps, variable.name.0);
                set_ty(maps, variable.declared.0);
            }
        });
    }

    fn number_parts_of_types(&mut self, in_parallel: InParallel<'_>) {
        let Numbering { fragments, maps, str_ids, ty_ids, layout_ids, .. } = self;
        let mut of_fragments: Vec<(&Fragment, &mut Maps)> = fragments.iter().zip(maps).collect();
        for_each_mut(&mut of_fragments, in_parallel, &|(fragment, maps)| {
            let ids = &fragment.program_ids;
            for local in (0..maps.tys.len()).rev() {
                if maps.tys[local].is_none() {
                    continue;
                }
                let mut number = |ty: TyId| {
                    if ty.is_some() {
                        maps.tys[ty.idx()] = ty_ids[ids.tys[ty.idx()] as usize];
                    }
                };
                for part in &fragment.tys.list[local].parts {
                    match part {
                        Part::Class(layout) if layout.is_none() => {}
                        Part::Class(layout) => maps.layouts[layout.idx()] = layout_ids[ids.layouts[layout.idx()] as usize],
                        Part::Global(name, arguments) => {
                            if name.is_some() {
                                maps.strs[name.idx()] = str_ids[ids.strs[name.idx()] as usize];
                            }
                            arguments.iter().copied().for_each(&mut number);
                        }
                        Part::Array(element) => number(*element),
                    }
                }
            }
        });
    }

}

/// A function that nothing calls: it is of a class whose declaration nothing evaluates, or no fragment has its body. It takes what
/// a caller would hand it. In the numbering of the program.
fn stub(func: &Func, maps: &Maps, anything: TyId) -> Func {
    let ty = |local: TyId| if local.is_none() { local } else { maps.tys[local.idx()] };
    let or_anything = |ty: TyId| if ty.is_none() { anything } else { ty };
    let mut stub = Func {
        name: if func.name.is_none() { func.name } else { maps.strs[func.name.idx()] },
        module: if func.module.is_none() { func.module } else { maps.modules[func.module.idx()] },
        pos: func.pos,
        place_of_text: func.place_of_text,
        end_of_text: func.end_of_text,
        kind: func.kind,
        flags: func.flags & !COROUTINE,
        length: func.length,
        captures: func.captures.iter().map(|&capture| ty(capture)).collect(),
        this_declared: ty(func.this_declared),
        params: func.params.iter().map(|&param| ty(param)).collect(),
        annotated: func.annotated.clone(),
        result: ty(func.result),
        blocks: Vec::new(),
        values: Vec::new(),
        spans: Vec::new(),
    };
    let entry = stub.add_block();
    for capture in stub.captures.clone() {
        stub.add_param(entry, or_anything(capture));
    }
    if stub.has(func_flags::HAS_THIS) {
        stub.add_param(entry, or_anything(stub.this_declared));
    }
    for param in stub.params.clone() {
        stub.add_param(entry, or_anything(param));
    }
    stub.blocks[entry.idx()].term = Some(Term::Unreachable);
    stub
}

#[derive(Default)]
struct HeldByFields {
    // By view, name and what the view says: what the field holds. `NONE`: anything.
    held_by_field: FxHashMap<(LayoutId, StrId, TyId), TyId>,
    is_found: Vec<bool>,
    is_within_known: FxHashMap<(TyId, TyId), bool>,
}

trait TableOfTypes {
    fn table(&self) -> &DeclaredTable;
    fn number_of(&mut self, described: Declared) -> Option<TyId>;
}

impl TableOfTypes for &DeclaredTable {
    fn table(&self) -> &DeclaredTable {
        self
    }
    fn number_of(&mut self, described: Declared) -> Option<TyId> {
        self.find(&described)
    }
}

impl TableOfTypes for &mut DeclaredTable {
    fn table(&self) -> &DeclaredTable {
        self
    }
    fn number_of(&mut self, described: Declared) -> Option<TyId> {
        Some(self.intern(described))
    }
}

fn type_reads_by_what_fields_hold(func: &mut Func, layouts: &[Layout], tys: &mut impl TableOfTypes, views_of: &[Vec<LayoutId>], views_beside: &[OnceLock<Vec<LayoutId>>], known: &mut HeldByFields) -> bool {
    let mut as_it_was: Vec<(usize, TyId, Prediction)> = Vec::new();
    for index in 0..func.values.len() {
        let Prediction::Field(ty) = func.values[index].prediction else { continue };
        let read = match func.values[index].def {
            Def::Op(Op::PropGet { obj, name }) => tys.table().get(func.values[obj.idx()].ty).only_layout().map(|view| (view, name)),
            _ => None,
        };
        let is_fact = |tys: &DeclaredTable, view: LayoutId, name: StrId| {
            let view = &layouts[view.idx()];
            let members = || view.members.iter().map(|member| &layouts[member.idx()]);
            let is_as_made = |layout: &Layout| layout.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE == 0;
            // Where the view has no field by the name, each of the objects has one of its own, or the name may stand for anything.
            let has_it = |layout: &Layout| {
                let declared = layout.field(name).map_or(TyId::NONE, |field| layout.fields[field as usize].declared);
                declared.is_some() && tys.get(declared).is_described_within(tys.get(ty))
            };
            !view.admits_foreign && is_as_made(view) && members().all(is_as_made) && (view.field(name).is_some() || !view.members.is_empty() && members().all(has_it))
        };
        let held = match read {
            None => TyId::NONE,
            Some((view, name)) => match known.held_by_field.get(&(view, name, ty)) {
                Some(&known) => known,
                None if !is_fact(tys.table(), view, name) => {
                    known.held_by_field.insert((view, name, ty), TyId::NONE);
                    TyId::NONE
                }
                None => {
                    let HeldByFields { is_found, is_within_known, .. } = &mut *known;
                    let beside = views_beside[view.idx()].get_or_init(|| {
                        let mut beside: Vec<LayoutId> = Vec::new();
                        for &other in layouts[view.idx()].members.iter().chain([&view]).flat_map(|member| &views_of[member.idx()]) {
                            if !std::mem::replace(&mut is_found[other.idx()], true) {
                                beside.push(other);
                            }
                        }
                        for other in &beside {
                            is_found[other.idx()] = false;
                        }
                        beside
                    });
                    let layouts_in = |described: &Declared| -> Vec<LayoutId> { described.parts.iter().filter_map(|part| if let Part::Class(layout) = part { layout.is_some().then_some(*layout) } else { None }).collect() };
                    let is_subtype = |sub: LayoutId, sup: LayoutId| {
                        let (below, above) = (&layouts[sub.idx()], &layouts[sup.idx()]);
                        sub == sup || !below.admits_foreign && below.members.iter().all(|member| above.members.binary_search(member).is_ok())
                    };
                    let read_as = tys.table().get(ty);
                    let is_within = |declared: TyId| {
                        let taken = tys.table().get(declared);
                        let besides = Declared { parts: taken.parts.iter().filter(|part| !matches!(part, Part::Class(_))).cloned().collect(), ..taken.clone() };
                        besides.is_described_within(read_as) && (read_as.any_object || layouts_in(taken).into_iter().all(|sub| layouts_in(read_as).into_iter().any(|sup| is_subtype(sub, sup))))
                    };
                    // What the other views take for the field beyond that. A narrower declaration in a subtype adds nothing.
                    let (mut more, mut takes_anything): (Vec<TyId>, bool) = (Vec::new(), false);
                    for other in beside.iter() {
                        let other = &layouts[other.idx()];
                        let Some(field) = other.field(name) else { continue };
                        let declared = other.fields[field as usize].declared;
                        takes_anything |= declared.is_none();
                        if declared.is_some() && declared != ty && !more.contains(&declared) && !*is_within_known.entry((declared, ty)).or_insert_with(|| is_within(declared)) {
                            more.push(declared);
                        }
                    }
                    let held = if takes_anything {
                        TyId::NONE
                    } else if more.is_empty() {
                        ty
                    } else {
                        let described = more.iter().fold(read_as.clone(), |described, &declared| described.or(tys.table().get(declared)));
                        let Some(held) = tys.number_of(described) else {
                            for (index, ty, prediction) in as_it_was.into_iter().rev() {
                                (func.values[index].ty, func.values[index].prediction) = (ty, prediction);
                            }
                            return false;
                        };
                        held
                    };
                    known.held_by_field.insert((view, name, ty), held);
                    held
                }
            },
        };
        let value = &mut func.values[index];
        as_it_was.push((index, value.ty, value.prediction));
        (value.ty, value.prediction) = if held == ty {
            (ty, Prediction::None)
        } else if held.is_some() && value.ty == tys.table().anything {
            (held, Prediction::Ty(ty))
        } else {
            (value.ty, Prediction::Ty(ty))
        };
    }
    true
}

pub(crate) mod has {
    pub(super) const DELETIONS: u8 = 1 << 0;
    pub(super) const PREDICTIONS_BY_KEY: u8 = 1 << 1;
    pub(super) const PREDICTIONS_BY_FIELD: u8 = 1 << 2;
    pub(super) const NEW_OBJECTS: u8 = 1 << 3;
    pub(super) const OBJECT_LITERALS: u8 = 1 << 4;
    pub(crate) const CONSTRUCTIONS_OR_SIZES: u8 = 1 << 5;
    pub(super) const NON_NULL_ASSERTIONS: u8 = 1 << 6;
}

fn contents_of(func: &Func, size: Option<StrId>) -> u8 {
    let mut found = 0;
    for value in &func.values {
        found |= match value.prediction {
            Prediction::ByKey(_) => has::PREDICTIONS_BY_KEY,
            Prediction::Field(_) => has::PREDICTIONS_BY_FIELD,
            _ => 0,
        };
        found |= match value.def {
            Def::Op(Op::PropDelete { .. } | Op::ElemDelete { .. }) => has::DELETIONS,
            Def::Op(Op::New(_) | Op::NewWith { .. }) => has::NEW_OBJECTS,
            Def::Op(Op::NewObject) => has::OBJECT_LITERALS,
            Def::Op(Op::Coerce { why: Why::NonNull(_), .. }) => has::NON_NULL_ASSERTIONS,
            Def::Op(Op::Construct { .. }) => has::CONSTRUCTIONS_OR_SIZES,
            Def::Op(Op::PropGet { name, .. }) if Some(name) == size => has::CONSTRUCTIONS_OR_SIZES,
            _ => 0,
        };
    }
    found
}

const COROUTINE: u16 = func_flags::ASYNC | func_flags::GENERATOR | func_flags::STARTS_EAGERLY;

const IS_KNOWN: &str = "the index has no function that is only named";

fn spawn_beside_the_pool<'scope, T: Send + 'scope>(scope: &'scope std::thread::Scope<'scope, '_>, work: impl FnOnce() -> T + Send + 'scope) -> std::thread::ScopedJoinHandle<'scope, T> {
    const STACK: usize = 64 << 20;
    std::thread::Builder::new().name("AOT link".to_owned()).stack_size(STACK).spawn_scoped(scope, work).expect("a thread of the link could not be started")
}
struct FuncIds<'a> {
    ids: &'a ProgramIds,
    by_program_id: Vec<FuncId>,
}

impl FuncIds<'_> {
    fn get(&self, key: FuncKey) -> Option<FuncId> {
        Some(self.by_program_id[self.ids.funcs.find(&key)? as usize]).filter(|id| id.is_some())
    }
}

const IS_INDEXED: &str = "every fragment that mentions a variable is in the index with it";

/// Puts the numbers of the program in the place of those of a fragment. Everything it comes by has its number.
struct Renumber<'a>(&'a Maps);

impl Ids for Renumber<'_> {
    fn str(&mut self, id: &mut StrId) {
        *id = self.0.strs[id.idx()];
    }
    fn ty(&mut self, id: &mut TyId) {
        *id = self.0.tys[id.idx()];
    }
    fn layout(&mut self, id: &mut LayoutId) {
        *id = self.0.layouts[id.idx()];
    }
    fn global(&mut self, id: &mut GlobalId) {
        *id = self.0.globals[id.idx()];
    }
    fn module(&mut self, id: &mut ModuleId) {
        *id = self.0.modules[id.idx()];
    }
    fn func(&mut self, id: &mut FuncId, _: Used) {
        *id = self.0.funcs[id.idx()];
    }
}

fn first_entry_point_evaluating(number_of_files: usize, entry_points: &[Vec<usize>], static_imports_of: &dyn Fn(usize) -> Vec<usize>) -> Vec<u32> {
    let mut first = vec![u32::MAX; number_of_files];
    for (entry_point, files) in entry_points.iter().enumerate() {
        let mut pending = files.clone();
        while let Some(file) = pending.pop() {
            if first[file] == u32::MAX {
                first[file] = entry_point as u32;
                pending.extend(static_imports_of(file));
            }
        }
    }
    first
}

fn renumber_func(func: &mut Func, maps: &Maps) {
    for_each_id_of_func(func, &mut Renumber(maps));
    // Of a function that is not reached there are no closures to expect.
    for value in &mut func.values {
        if value.prediction == Prediction::Closure(FuncId::NONE) {
            value.prediction = Prediction::None;
        }
    }
}

/// Runs the modules that the program starts with, in order.
/// `--aot-explain=deferred`: what the functions that run when the program starts contain, by operation. An operation counts once wherever it stands. Numbers alone.
fn explain_start(program: &Program, evaluating: &[(FuncId, FuncKey)]) -> Vec<String> {
    let kinds: [(&str, fn(FuncKey) -> bool); 3] = [
        ("functions that evaluate a module once", |key| matches!(key, FuncKey::Module(_))),
        ("bodies of modules", |key| matches!(key, FuncKey::ModuleBody(_))),
        ("initializers of lazy variables", |key| matches!(key, FuncKey::Initializer(..))),
    ];
    kinds
        .into_iter()
        .map(|(what, is_such)| {
            let (mut functions, mut idle, mut operations) = (0u32, 0u32, 0u32);
            let mut by_name: FxHashMap<String, u32> = FxHashMap::default();
            for &(id, _) in evaluating.iter().filter(|found| is_such(found.1)) {
                functions += 1;
                let before = operations;
                for value in &program.funcs[id.idx()].values {
                    let Def::Op(op) = &value.def else { continue };
                    let of_class = |func: FuncId| if program.funcs[func.idx()].kind == FuncKind::Constructor { " of a class" } else { "" };
                    let name = match op {
                        Op::Undefined | Op::Null | Op::Bool(_) | Op::Int(_) | Op::Double(_) => continue,
                        Op::Operation { name, .. } => text_of(&program.strs, *name),
                        Op::FuncRef(func) => format!("FuncRef{}", of_class(*func)),
                        Op::Closure { func, .. } => format!("Closure{}", of_class(*func)),
                        Op::CallDirect { func, .. } if program.funcs[func.idx()].kind == FuncKind::Module => "CallDirect of such a function".to_owned(),
                        _ => format!("{op:?}").split(|c: char| !c.is_ascii_alphanumeric()).next().unwrap_or_default().to_owned(),
                    };
                    operations += 1;
                    *by_name.entry(name).or_default() += 1;
                }
                idle += u32::from(operations == before);
            }
            let mut by_name: Vec<(String, u32)> = by_name.into_iter().collect();
            by_name.sort_unstable_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            let by_name = by_name.into_iter().map(|(name, count)| format!("{name} {count}")).collect::<Vec<_>>().join(", ");
            format!("deferred: in the linked program: {what} {functions}, with nothing to do {idle}; operations {operations}: {by_name}")
        })
        .collect()
}

fn entry_function(name: StrId, anything: TyId, roots: &[FuncId], import: Option<FuncId>, first_operation: Option<StrId>) -> Func {
    let mut func = Func {
        name,
        module: ModuleId::NONE,
        pos: 0,
        place_of_text: 0,
        end_of_text: 0,
        kind: FuncKind::Module,
        flags: 0,
        length: 0,
        captures: Vec::new(),
        this_declared: TyId::NONE,
        params: Vec::new(),
        annotated: Vec::new(),
        result: TyId::NONE,
        blocks: Vec::new(),
        values: Vec::new(),
        spans: Vec::new(),
    };
    let entry = func.add_block();
    if let Some(name) = first_operation {
        func.append(entry, Op::Operation { name, args: ir::Args::new() }, 0, anything);
    }
    for &root in roots {
        func.append(entry, Op::CallDirect { func: root, args: ir::Args::new() }, 0, anything);
    }
    let yielded = import.map_or(V::NONE, |import| func.append(entry, Op::FuncRef(import), 0, anything));
    func.blocks[entry.idx()].term = Some(Term::Return(yielded));
    func
}

// ───────────────────────────── whether the fragments agree ─────────────────────────────

/// The program, for looking up what a fragment has.
struct Final<'a> {
    program: &'a Program,
    tys: FxHashMap<&'a Declared, TyId>,
    funcs: &'a [FuncId],
    layouts: &'a [LayoutId],
    globals: &'a [GlobalId],
    /// By function: see `Numbering::stub`.
    is_stub: &'a [bool],
}

/// Finds in the program what has a number in one fragment, mentioned by code that is reached or not. `None`: the program has none such.
/// `NONE` is `NONE`.
struct Finder<'a> {
    fragment: &'a Fragment,
    all: &'a Final<'a>,
    /// By type, as far as it has been looked for.
    tys: Vec<Option<Option<TyId>>>,
}

impl Finder<'_> {
    fn str(&self, local: StrId) -> Option<StrId> {
        if local.is_none() { Some(local) } else { self.all.program.strs.find(self.fragment.strs.get(local)) }
    }

    fn layout(&self, local: LayoutId) -> Option<LayoutId> {
        if local.is_none() { Some(local) } else { Some(self.all.layouts[self.fragment.program_ids.layouts[local.idx()] as usize]).filter(|id| id.is_some()) }
    }

    fn func(&self, local: FuncId) -> Option<FuncId> {
        if local.is_none() { Some(local) } else { Some(self.all.funcs[self.fragment.program_ids.funcs[local.idx()] as usize]).filter(|id| id.is_some()) }
    }

    /// A variable of a class, see `Layout::environment`.
    fn variable(&self, local: u32, is_module_variable: bool) -> Option<u32> {
        if !is_module_variable || local == NO_VARIABLE {
            return Some(local);
        }
        let global = self.all.globals[self.fragment.program_ids.globals[local as usize] as usize];
        global.is_some().then_some(global.0)
    }

    fn ty(&mut self, local: TyId) -> Option<TyId> {
        if local.is_none() {
            return Some(local);
        }
        if let Some(known) = self.tys[local.idx()] {
            return known;
        }
        let found = self.ty_uncached(local);
        self.tys[local.idx()] = Some(found);
        found
    }

    fn ty_uncached(&mut self, local: TyId) -> Option<TyId> {
        let fragment = self.fragment;
        let Declared { prims, ints, parts, any_object, any_function } = fragment.tys.get(local);
        let mut renumbered: SmallVec<[Part; 1]> = SmallVec::new();
        for part in parts {
            renumbered.push(match part {
                Part::Class(layout) => Part::Class(self.layout(*layout)?),
                Part::Global(name, arguments) => {
                    let arguments: Option<SmallVec<[TyId; 2]>> = arguments.iter().map(|&argument| self.ty(argument)).collect();
                    Part::Global(self.str(*name)?, arguments?)
                }
                Part::Array(element) => Part::Array(self.ty(*element)?),
            });
        }
        renumbered.sort_unstable();
        let declared = Declared { prims: *prims, ints: *ints, parts: renumbered, any_object: *any_object, any_function: *any_function };
        self.all.tys.get(&declared).copied()
    }

    /// Whether what the fragment says of the one function of a field or a variable is what the program says. The program says nothing of
    /// a function that is not reached.
    fn is_only_function(&self, local: FuncId, flags: u8, out: FuncId, out_flags: u8) -> bool {
        let found = self.func(local).unwrap_or(FuncId::NONE);
        found == out && (found.is_none() || flags == out_flags)
    }

    /// Whether the function is to a caller what the fragment takes it for.
    fn is_func(&mut self, local: &Func, id: FuncId) -> bool {
        let all = self.all;
        let out = &all.program.funcs[id.idx()];
        // What is only known of a function once it is built, or once all its uses are.
        let known_later = func_flags::IS_VALUE | func_flags::IS_TYPED | func_flags::IS_BUILTIN | func_flags::IS_OF_BUILTIN_MODULE | if all.is_stub[id.idx()] { COROUTINE } else { 0 };
        local.kind == out.kind
            && (local.flags ^ out.flags) & !known_later == 0
            && local.annotated == out.annotated
            && local.params.len() == out.params.len()
            && local.captures.len() == out.captures.len()
            && local.captures.iter().zip(&out.captures).all(|(&capture, &same)| self.ty(capture) == Some(same))
            && self.ty(local.this_declared) == Some(out.this_declared)
            && self.ty(local.result) == Some(out.result)
            && local.params.iter().zip(&out.params).all(|(&param, &same)| self.ty(param) == Some(same))
    }

    /// The same for a layout, but for what the link itself finds out about it.
    fn is_layout(&mut self, local: &Layout, id: LayoutId) -> bool {
        let all = self.all;
        let out = &all.program.layouts[id.idx()];
        // See `Index::add`.
        let lists_methods = local.kind != LayoutKind::Record;
        let is_alike = local.kind == out.kind
            && (local.class_flags ^ out.class_flags) & !class_flags::MAY_HAVE_OTHER_PROTOTYPE == 0
            && local.fields.len() == out.fields.len()
            && (!lists_methods || local.methods.len() == out.methods.len())
            && local.static_fields.len() == out.static_fields.len()
            && self.layout(local.base) == Some(out.base)
            && self.layout(local.environment) == Some(out.environment)
            && self.func(local.constructor) == Some(out.constructor);
        if !is_alike {
            return false;
        }
        for (field, same) in local.fields.iter().zip(&out.fields) {
            if field.flags != same.flags || self.str(field.name) != Some(same.name) || self.ty(field.declared) != Some(same.declared) {
                return false;
            }
            if !self.is_only_function(field.only_function, field.only_function_flags, same.only_function, same.only_function_flags) {
                return false;
            }
            let is_same_literal = |(literal, same): (&Literal, &Literal)| match (*literal, *same) {
                (Literal::Str(text), Literal::Str(same)) => self.str(text) == Some(same),
                (Literal::Num(number), Literal::Num(same)) => number.to_bits() == same.to_bits(),
                _ => false,
            };
            if field.literals.len() != same.literals.len() || !field.literals.iter().zip(&same.literals).all(is_same_literal) {
                return false;
            }
        }
        let has_module_variables = local.environment.is_none();
        for (method, same) in local.methods.iter().zip(&out.methods).filter(|_| lists_methods) {
            if method.kind != same.kind
                || method.flags != same.flags
                || self.str(method.name) != Some(same.name)
                || self.func(method.func) != Some(same.func)
                || self.variable(method.key, has_module_variables) != Some(same.key)
            {
                return false;
            }
        }
        (local.static_fields.iter().zip(&out.static_fields)).all(|(field, same)| self.str(field.0) == Some(same.0) && self.ty(field.1) == Some(same.1))
    }
}

/// What code of the fragment that is reached relies on, and that is not so.
fn disagreements(fragment: &Fragment, maps: &Maps, all: &Final<'_>, nowhere: FileId) -> Vec<Problem> {
    let mut finder = Finder { fragment, all, tys: vec![None; fragment.tys.list.len()] };
    let file = if fragment.file == NO_FILE { nowhere } else { fragment.file };
    let mut problems = Vec::new();
    for (i, function) in fragment.funcs.iter().enumerate() {
        if let Some(func) = &function.func
            && maps.uses_func[i]
            && maps.funcs[i].is_some()
            && !finder.is_func(func, maps.funcs[i])
        {
            problems.push(Problem { file, pos: 0, what: format!("the function `{}` ({:?}), which is not what this file takes it for", text_of(&fragment.strs, func.name), function.key).into() });
        }
    }
    for (shape, &id) in fragment.layouts.iter().zip(&maps.layouts) {
        if let Some(definition) = &shape.definition
            && id.is_some()
            && !finder.is_layout(&definition.layout, id)
        {
            problems.push(Problem { file, pos: 0, what: format!("the layout `{}` ({:x?}), which is not what this file takes it for", text_of(&fragment.strs, shape.name), shape.key).into() });
        }
    }
    for (variable, &id) in fragment.globals.iter().zip(&maps.globals) {
        if id.is_none() {
            continue;
        }
        let out = &all.program.globals[id.idx()];
        if variable.global.initialization != out.initialization
            || finder.ty(variable.global.declared) != Some(out.declared)
            || !finder.is_only_function(variable.global.only_function, variable.global.only_function_flags, out.only_function, out.only_function_flags)
        {
            problems.push(Problem { file, pos: 0, what: format!("the variable `{}` ({:?}), which is not what this file takes it for", text_of(&fragment.strs, variable.global.name), variable.key).into() });
        }
    }
    problems
}

// ───────────────────────────── the types again ─────────────────────────────

/// How many types a checker is made for, to say what they are called.
const TYPES_OF_A_CHECKER: usize = 8192;

/// Adds the types that tasks have kept, by what fragments call them. `seen`: those that have been added.
fn add_kept_types(program: &Checked<'_>, seen: &mut FxHashSet<TypeId>, types: &mut FxHashMap<Identity, TypeId>, in_parallel: InParallel<'_>) {
    let mut kept = program.checker().kept_types();
    kept.retain(|&ty| seen.insert(ty));
    let mut slices: Vec<(&[TypeId], Vec<Identity>)> = kept.chunks(TYPES_OF_A_CHECKER).map(|slice| (slice, Vec::new())).collect();
    for_each_mut(&mut slices, in_parallel, &|(slice, identities)| {
        let mut c = program.checker();
        *identities = slice.iter().map(|&ty| c.identity_of_type(ty)).collect();
    });
    types.reserve(kept.len());
    let c = program.checker();
    for (&ty, &identity) in kept.iter().zip(slices.iter().flat_map(|slice| &slice.1)) {
        let first = types.entry(identity).or_insert(ty);
        if *first != ty
            && let (Some(written_at), Some(so_far)) = (c.place_of_object_literal(ty), c.place_of_object_literal(*first))
            && written_at < so_far
        {
            *first = ty;
        }
    }
}

/// What every object inherits unless it has a property of its own by the name.
const NAMES_ON_OBJECT_PROTOTYPE: [&str; 12] = [
    "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
];

/// How many of the layouts that are missing a task describes, before it goes on to what they lead to.
const LAYOUTS_OF_A_TASK: usize = 128;
/// A further round is for what the classes lead to that the layouts of a round mention, which the tasks do not look into, and for what a
/// task was kept from describing at once.
const MOST_ROUNDS: usize = 32;
/// The step of the tasks of the link, which come after all others.
const STEP_OF_THE_LINK: u32 = u32::MAX;

/// Describes the layouts of the types, in tasks like those of the check: with a barrier, validated and retried, so that the types they
/// come by and keep are published. A task goes on to what its layouts lead to and nobody defines, with all it has found out so far:
/// what two tasks lead to is described twice. Yields the fragments, in the order of the types, and whether the stack has run out for a
/// task.
fn describe_in_tasks<'s>(
    program: &Checked<'s>,
    missing: &[(Identity, TypeId)],
    index: &Index,
    ids: &ProgramIds,
    in_parallel: InParallel<'_>,
    describe: Describe<'_>,
    (times, since): (&mut Times, &mut Instant),
) -> (Vec<Fragment>, bool) {
    let (mut described, mut ran_out_of_stack) = (Vec::new(), false);
    let asked: FxHashSet<Identity> = missing.iter().map(|&(identity, _)| identity).collect();
    let is_defined = |identity: Identity| asked.contains(&identity) || index.record(ids, identity).is_some();
    let mut slices: Vec<Vec<TypeId>> = missing.chunks(LAYOUTS_OF_A_TASK).map(|slice| slice.iter().map(|&(_, ty)| ty).collect()).collect();
    while !slices.is_empty() {
        let mut tasks: Vec<(usize, Option<(Fragment, bool, Finished<'s>)>)> = (0..slices.len()).map(|index| (index, None)).collect();
        for_each_mut(&mut tasks, in_parallel, &|(index, outcome)| {
            let mut c = program.checker();
            c.begin_stack_budget();
            c.begin_task(STEP_OF_THE_LINK, *index as u32, true);
            c.withhold_tables_of_expressions();
            let mut fragment = describe(&mut c, &slices[*index], &is_defined);
            ids.assign(&mut fragment);
            fragment.make_outline();
            *outcome = Some((fragment, c.take_ran_out_of_stack(), c.end_task()));
        });
        times.add("describe", since);
        let mut fragments = Vec::with_capacity(tasks.len());
        let mut finished = Vec::with_capacity(tasks.len());
        for (fragment, has_run_out, task) in tasks.into_iter().filter_map(|task| task.1) {
            fragments.push(fragment);
            finished.push(task);
            ran_out_of_stack |= has_run_out;
        }
        let is_invalid = program.validate(&finished, true);
        let mut at = is_invalid.iter();
        finished.retain(|_| at.next().is_some_and(|is_invalid| !is_invalid));
        let mut retried = Vec::new();
        for ((fragment, slice), &is_invalid) in fragments.into_iter().zip(slices).zip(&is_invalid) {
            if is_invalid {
                retried.push(slice);
            } else {
                described.push(fragment);
            }
        }
        program.link(&mut finished, in_parallel);
        program.publish(&mut finished, in_parallel, false);
        times.add("barriers", since);
        slices = retried;
    }
    (described, ran_out_of_stack)
}

/// How many questions a checker is made for, at the least, and how many checkers are made for the questions of a round, at the most. A checker finds again what another has found, and one that is cut
/// short holds up all behind it. The numbers do not show in the answers.
const QUESTIONS_OF_A_CHECKER: usize = 64;
const CHECKERS_OF_A_ROUND: usize = 64;

/// `Checker::answer`, shared out, and whether the stack has run out for one of the checkers.
fn answers_to(program: &Checked<'_>, questions: &[Question], stored: &FxHashSet<Atom>, cut_short: &mut Vec<(TypeId, TypeId, u8)>, in_parallel: InParallel<'_>) -> (Vec<Answer>, bool) {
    let known: &[(TypeId, TypeId, u8)] = cut_short;
    let mut slices: Vec<(&[Question], Vec<Answer>, bool, Vec<(TypeId, TypeId, u8)>)> = questions.chunks(questions.len().div_ceil(CHECKERS_OF_A_ROUND).max(QUESTIONS_OF_A_CHECKER)).map(|slice| (slice, Vec::new(), false, Vec::new())).collect();
    for_each_mut(&mut slices, in_parallel, &|(slice, answers, ran_out_of_stack, cut_now)| {
        let mut c = program.checker();
        c.begin_stack_budget();
        c.know_questions_cut_short(known);
        *answers = c.answer(slice, stored);
        *ran_out_of_stack = c.take_ran_out_of_stack();
        *cut_now = c.questions_cut_short();
    });
    for slice in &mut slices {
        keep_questions_cut_short(cut_short, std::mem::take(&mut slice.3));
    }
    let ran_out_of_stack = slices.iter().any(|slice| slice.2);
    (slices.into_iter().flat_map(|slice| slice.1).collect(), ran_out_of_stack)
}

fn keep_questions_cut_short(kept: &mut Vec<(TypeId, TypeId, u8)>, mut more: Vec<(TypeId, TypeId, u8)>) {
    if !more.is_empty() {
        kept.append(&mut more);
        kept.sort_unstable_by_key(|question| (question.0.0, question.1.0, question.2));
        kept.dedup();
    }
}

// ───────────────────────────── the names of properties ─────────────────────────────

/// By string: what the program does with properties of that name.
struct Names {
    /// An operation stores a property by the name, or may: it hands the name to whatever it calls. Or a class has a method, an accessor
    /// or a static field of the name. A copy, by a spread or `Object.assign`, adds nothing: what it brings has been stored before. Nor
    /// does plain data that is copied into a layout: what it has by another name stays an extra property.
    stored: Vec<bool>,
    /// An operation reads, calls or looks for a property by the name, or may.
    read: Vec<bool>,
}

/// How many functions are gone through at a time.
const FUNCTIONS_OF_A_SLICE: usize = 256;

/// The string that the value is, as far as that shows without following the flow of control.
pub(crate) fn constant_string(func: &Func, mut value: V) -> Option<StrId> {
    while value.is_some() {
        match func.op(value)? {
            Op::Str(text) => return Some(*text),
            Op::ToKey(inner) | Op::Coerce { value: inner, .. } => value = *inner,
            _ => break,
        }
    }
    None
}

fn add_names_in(func: &Func, layouts: &[Layout], stored: &mut Vec<StrId>, read: &mut Vec<StrId>) {
    for value in &func.values {
        let Def::Op(op) = &value.def else { continue };
        match op {
            Op::PropSet { name, .. } => stored.push(*name),
            // Whoever initializes the object stores it.
            Op::NewWith { name, .. } => stored.push(*name),
            Op::FieldSet { layout, field, .. } if layout.is_some() && layouts[layout.idx()].kind != LayoutKind::Environment => stored.push(layouts[layout.idx()].fields[*field as usize].name),
            Op::ElemSet { key, .. } => stored.extend(constant_string(func, *key)),
            Op::PropGet { name, .. } | Op::PropHas { name, .. } | Op::CallMethod { name, .. } => read.push(*name),
            Op::ElemGet { key, .. } | Op::ElemHas { key, .. } => read.extend(constant_string(func, *key)),
            _ => {}
        }
        // `DefineField`, `Object.defineProperty(o, "k", ..)`, `Reflect.get(o, "k")`, and what the program has of its own of the kind.
        if let Op::Operation { args, .. } | Op::Call { args, .. } | Op::CallMethod { args, .. } | Op::CallDirect { args, .. } | Op::Construct { args, .. } = op {
            for name in args.iter().filter_map(|&arg| constant_string(func, arg)) {
                stored.push(name);
                read.push(name);
            }
        }
    }
}

struct Marks {
    names: Vec<AtomicU8>,
    is_copied_to: Vec<AtomicBool>,
}

impl Marks {
    const IS_STORED: u8 = 1;
    const IS_READ: u8 = 2;

    fn add_names(&self, names: &mut Vec<StrId>, mark: u8) {
        for name in names.drain(..).filter(|name| name.is_some()) {
            if self.names[name.idx()].load(Ordering::Relaxed) & mark == 0 {
                self.names[name.idx()].fetch_or(mark, Ordering::Relaxed);
            }
        }
    }

    fn add(&self, func: &Func, layouts: &[Layout], stored: &mut Vec<StrId>, read: &mut Vec<StrId>) {
        if !func.has(func_flags::IS_OF_BUILTIN_MODULE) || func.has(func_flags::IS_TYPED) {
            add_names_in(func, layouts, stored, read);
            self.add_names(stored, Marks::IS_STORED);
            self.add_names(read, Marks::IS_READ);
        }
        for value in &func.values {
            if let Def::Op(Op::Coerce { to, why: Why::Cast | Why::CastFresh | Why::Coerce | Why::CoerceFreshGraph, .. }) = value.def
                && to.is_some()
            {
                self.is_copied_to[to.idx()].store(true, Ordering::Relaxed);
            }
        }
    }
}

impl Names {
    /// Every function of the program with a body is reached. `is_of_opaque_file`: by layout, see `Module::is_opaque`.
    fn of(program: &Program, marks: &Marks, is_of_opaque_file: &[bool]) -> Names {
        let mut names = Names { stored: vec![false; program.strs.len()], read: vec![false; program.strs.len()] };
        for (name, marks) in marks.names.iter().enumerate() {
            names.stored[name] = marks.load(Ordering::Relaxed) & Marks::IS_STORED != 0;
            names.read[name] = marks.load(Ordering::Relaxed) & Marks::IS_READ != 0;
        }
        for (layout, _) in program.layouts.iter().zip(is_of_opaque_file).filter(|layout| !layout.1) {
            let of_class = layout.methods.iter().map(|method| method.name).chain(layout.static_fields.iter().map(|field| field.0));
            for name in of_class.filter(|name| name.is_some()) {
                names.stored[name.idx()] = true;
            }
        }
        names
    }
}

/// How many of the layouts that objects are made as have a field of each name that is flagged, the most first. Then those layouts, each
/// with the fields that are flagged, those with the most first. Then what else goes by the names and is not acted on.
/// In the functions that are written in TypeScript: how many places and reads have a type that says something. The rest holds anything, with or without a prediction.
fn explain_given(program: &Program) -> Vec<String> {
    let is_fact = |ty: TyId| ty.is_some() && ty != program.tys.anything;
    // Facts, and all.
    let (mut parameters, mut results, mut joins, mut fields) = ((0usize, 0usize), (0usize, 0usize), (0usize, 0usize), (0usize, 0usize));
    let (mut receivers, mut properties, mut containers, mut elements) = ((0usize, 0usize), (0usize, 0usize), (0usize, 0usize), (0usize, 0usize));
    let count = |counter: &mut (usize, usize), ty: TyId| {
        counter.0 += usize::from(is_fact(ty));
        counter.1 += 1;
    };
    for func in program.funcs.iter().filter(|func| func.flags & func_flags::IS_TYPED != 0) {
        for &parameter in &func.params {
            count(&mut parameters, parameter);
        }
        count(&mut results, func.result);
        for value in &func.values {
            match &value.def {
                ir::Def::Param(block, _) if *block != Func::ENTRY => count(&mut joins, value.ty),
                ir::Def::Op(Op::PropGet { obj, .. }) => {
                    count(&mut receivers, func.values[obj.idx()].ty);
                    count(&mut properties, value.ty);
                }
                ir::Def::Op(Op::ElemGet { obj, .. }) => {
                    count(&mut containers, func.values[obj.idx()].ty);
                    count(&mut elements, value.ty);
                }
                _ => {}
            }
        }
    }
    for layout in program.layouts.iter().filter(|layout| layout.kind != LayoutKind::Environment && layout.is_allocated) {
        for field in &layout.fields {
            count(&mut fields, field.declared);
        }
    }
    let rows = [
        ("parameters", parameters),
        ("results", results),
        ("joins", joins),
        ("fields of the layouts that objects are made as", fields),
        ("reads of a property: the receiver", receivers),
        ("reads of a property: what is read", properties),
        ("reads of an element: the container", containers),
        ("reads of an element: what is read", elements),
    ];
    let share = |(facts, all): (usize, usize)| format!("{facts} of {all} ({:.1}%)", 100.0 * facts as f64 / all.max(1) as f64);
    let sum = |counted: &[(usize, usize)]| counted.iter().fold((0, 0), |sum, counted| (sum.0 + counted.0, sum.1 + counted.1));
    let in_all = format!("given: facts: {} of the places, {} of the reads", share(sum(&[parameters, results, joins, fields])), share(sum(&[properties, elements])));
    // A view that admits objects that are not laid out stays a type, and every read through it tests for them.
    let views = program.layouts.iter().filter(|layout| layout.kind != LayoutKind::Environment);
    let strangers = format!("given: layouts that admit strangers: {}", share((views.clone().filter(|layout| layout.admits_foreign).count(), views.count())));
    [in_all, strangers].into_iter().chain(rows.iter().map(|&(what, counted)| format!("given: {what}: {} are facts", share(counted)))).collect()
}

fn explain_fields(program: &Program, names: &Names) -> Vec<String> {
    let is_flagged = |field: &&ir::Field| field.flags & field_flags::NEVER_STORED != 0;
    let made: Vec<&Layout> = program.layouts.iter().filter(|layout| layout.kind != LayoutKind::Environment && layout.is_allocated).collect();
    let mut layouts_with: Vec<usize> = vec![0; program.strs.len()];
    let mut by_layout: Vec<(usize, &Layout)> = Vec::new();
    let (mut fields, mut flagged, mut never_read) = (0, 0, 0);
    for &layout in &made {
        for field in layout.fields.iter().filter(is_flagged) {
            layouts_with[field.name.idx()] += 1;
        }
        let of_layout = layout.fields.iter().filter(is_flagged).count();
        by_layout.extend((of_layout > 0).then_some((of_layout, layout)));
        fields += layout.fields.len();
        flagged += of_layout;
        never_read += layout.fields.iter().filter(|field| !is_flagged(field) && field.name.is_some() && !names.read[field.name.idx()]).count();
    }
    let mut lines = vec![format!("fields: {flagged} of the {fields} fields of the {} layouts that objects are made as have a name that nothing stores", made.len())];
    let mut by_name: Vec<StrId> = (0..program.strs.len()).filter(|&name| layouts_with[name] > 0).map(StrId::new).collect();
    by_name.sort_by(|&a, &b| layouts_with[b.idx()].cmp(&layouts_with[a.idx()]).then_with(|| program.strs.get(a).cmp(program.strs.get(b))));
    lines.extend(by_name.iter().map(|&name| format!("fields: `{}` in {} layouts", text_of(&program.strs, name), layouts_with[name.idx()])));
    // Those with as many stay in the order of their numbers.
    by_layout.sort_by_key(|&(of_layout, _)| std::cmp::Reverse(of_layout));
    for (of_layout, layout) in by_layout {
        let flagged: Vec<String> = layout.fields.iter().filter(is_flagged).map(|field| text_of(&program.strs, field.name)).collect();
        lines.push(format!("fields: `{}`: {of_layout} of {}: {}", text_of(&program.strs, layout.name), layout.fields.len(), flagged.join(", ")));
    }
    lines.push(format!("fields: {never_read} more have a name that is stored and that nothing reads"));
    let is_required = |field: &&ir::Field| field.flags & (field_flags::OPTIONAL | field_flags::NEVER_STORED) == 0;
    let may_be_absent = |field: &&ir::Field| is_required(field) && field.flags & field_flags::NEVER_SEEN_ABSENT == 0;
    let required = made.iter().flat_map(|layout| &layout.fields).filter(is_required).count();
    lines.push(format!("fields: {} of the {required} required fields may be seen absent", made.iter().flat_map(|layout| &layout.fields).filter(may_be_absent).count()));
    for layout in made.iter().filter(|layout| layout.fields.iter().any(|field| may_be_absent(&field))) {
        let absent: Vec<String> = layout.fields.iter().filter(may_be_absent).map(|field| text_of(&program.strs, field.name)).collect();
        lines.push(format!("fields: `{}`: may be seen absent: {}", text_of(&program.strs, layout.name), absent.join(", ")));
    }
    let methods = || program.layouts.iter().flat_map(|layout| &layout.methods).filter(|method| method.name.is_some());
    lines.push(format!("fields: {} of the {} methods and accessors have a name that nothing reads", methods().filter(|method| !names.read[method.name.idx()]).count(), methods().count()));
    lines
}

// ───────────────────────────── for messages ─────────────────────────────

/// How many views a checker is made for, to print the types of their properties. What a type is printed as may depend on what the
/// checker has printed before, so this shows in the output. The number of threads does not.
const VIEWS_OF_A_CHECKER: usize = 512;
/// How many bytes `Field::type_text` has at most.
const LONGEST_TYPE_TEXT: usize = 80;

/// For each of the views: the fields of its layout that are properties of the type, by their indexes, each with its type as text. Not
/// `#x`.
struct TypeTexts<'a> {
    slices: Vec<&'a [(LayoutId, TypeId)]>,
    next: AtomicUsize,
    printed: Vec<OnceLock<TextsOfViews>>,
    declared: OnceLock<WhereViewsAreDeclared>,
}

#[derive(Default)]
struct TextsOfViews {
    fields: Vec<Vec<(u32, u64, Vec<u8>)>>,
    declared_at: Vec<Option<(FileId, u32)>>,
}

struct WhereViewsAreDeclared {
    shown_paths: Vec<Vec<u8>>,
    path_and_line: Vec<Option<(u32, u32)>>,
}

impl<'a> TypeTexts<'a> {
    fn of(views: &'a [(LayoutId, TypeId)]) -> TypeTexts<'a> {
        let slices: Vec<&[(LayoutId, TypeId)]> = views.chunks(VIEWS_OF_A_CHECKER).collect();
        TypeTexts { printed: slices.iter().map(|_| OnceLock::new()).collect(), slices, next: AtomicUsize::new(0), declared: OnceLock::new() }
    }

    fn print(&self, checked: &Checked<'_>, program: &Program, shown_from: &[u8]) {
        loop {
            let at = self.next.fetch_add(1, Ordering::Relaxed);
            let Some(slice) = self.slices.get(at) else { break };
            assert!(self.printed[at].set(type_texts(checked, program, slice)).is_ok(), "a slice is printed once");
        }
        self.declared.get_or_init(|| self.find_where_views_are_declared(checked, shown_from));
    }

    fn find_where_views_are_declared(&self, checked: &Checked<'_>, shown_from: &[u8]) -> WhereViewsAreDeclared {
        let mut declaring: FxHashMap<FileId, u32> = FxHashMap::default();
        let mut files: Vec<FileId> = Vec::new();
        let mut path_and_line: Vec<Option<(u32, u32)>> = Vec::new();
        for at in self.printed.iter().flat_map(|slice| &slice.wait().declared_at) {
            path_and_line.push(at.map(|(file, pos)| {
                let path = *declaring.entry(file).or_insert_with(|| {
                    files.push(file);
                    files.len() as u32 - 1
                });
                (path, pos)
            }));
        }
        let line_starts: Vec<Vec<u32>> = files.iter().map(|&file| compute_ecma_line_starts(&checked.files.hir(file).text)).collect();
        for (path, line) in path_and_line.iter_mut().flatten() {
            let pos = *line;
            *line = line_starts[*path as usize].partition_point(|&start| start <= pos) as u32;
        }
        let shown_paths = (files.iter())
            .map(|&file| {
                let name = checked.files.module(file).file_name();
                match name.starts_with(bun_builtin_syntax::VIRTUAL_ROOT) {
                    true => name.to_vec(),
                    false => get_relative_path_from_directory(shown_from, name, checked.files.is_case_sensitive),
                }
            })
            .collect();
        WhereViewsAreDeclared { shown_paths, path_and_line }
    }
}

fn type_texts(checked: &Checked<'_>, program: &Program, slice: &[(LayoutId, TypeId)]) -> TextsOfViews {
    let TextsOfViews { fields: mut texts, mut declared_at } = TextsOfViews::default();
    {
        let mut c = checked.checker();
        c.begin_stack_budget();
        let mut printed: FxHashMap<TypeId, (u64, Vec<u8>)> = FxHashMap::default();
        for &(layout, view) in slice.iter() {
            // The text of a library that is not checked is not kept.
            declared_at.push(c.declaration_of_view(view).filter(|at| (at.pos as usize) < checked.files.hir(at.file).text.len()).map(|at| (at.file, at.pos)));
            let mut of_view = Vec::new();
            let Some(members) = c.members(view) else {
                texts.push(of_view);
                continue;
            };
            let by_name = program.layouts[layout.idx()].fields_by_name();
            for prop in members.shape().props.iter() {
                let name = c.atoms().bytes(prop.name);
                let Some(field) = program.strs.find(name).filter(|_| !name.starts_with(&[0xFE])).and_then(|name| by_name.get(&program.layouts[layout.idx()], name)) else { continue };
                let ty = c.type_of_prop(prop, members.mapper);
                if let Some((hash, text)) = printed.get(&ty) {
                    of_view.push((field, *hash, text.clone()));
                    continue;
                }
                let mut text = c.type_to_string_in_canonical_order(ty);
                // Nothing is made of half a text.
                if c.take_ran_out_of_stack() {
                    continue;
                }
                if text.len() > LONGEST_TYPE_TEXT {
                    let mut end = LONGEST_TYPE_TEXT - 3;
                    while text[end] & 0xC0 == 0x80 {
                        end -= 1;
                    }
                    text.truncate(end);
                    text.extend_from_slice(b"...");
                }
                let hash = Strs::hash_of(&text);
                printed.insert(ty, (hash, text.clone()));
                of_view.push((field, hash, text));
            }
            for &(name, declaring) in c.undeclared_fields_of(view).iter() {
                let Some(field) = program.strs.find(c.atoms().bytes(name)).and_then(|name| by_name.get(&program.layouts[layout.idx()], name)) else { continue };
                let Some(declared_by) = c.members(declaring) else { continue };
                let Some(prop) = declared_by.shape().props.iter().find(|prop| prop.name == name) else { continue };
                let ty = c.type_of_prop(prop, declared_by.mapper);
                let text = c.type_to_string(ty);
                if !c.take_ran_out_of_stack() && text.len() <= LONGEST_TYPE_TEXT {
                    of_view.push((field, Strs::hash_of(&text), text));
                }
            }
            texts.push(of_view);
        }
    }
    TextsOfViews { fields: texts, declared_at }
}

// ───────────────────────────── the link ─────────────────────────────

/// Where the checker has found errors, and `build::files_imported_by`.
pub struct Errors<'a> {
    pub places: &'a [(FileId, u32)],
    /// For each: it lies in an import or export declaration that the bundler has dropped.
    pub in_dropped_imports: &'a [bool],
    pub imported_by: &'a (dyn Fn(&mut Checker<'_, '_>, FileId) -> Vec<FileId> + Sync),
}

/// Why an error does not lie in the program.
pub enum Elsewhere {
    /// A constant decides that the code does not run, or stands in its place. Where what is left out starts.
    Cut(u32),
    DroppedImport,
    /// It is in the function of that name, which nothing reaches.
    NotReached(String),
    /// Nothing of the file is in the program, and no module of the program imports it, be it through files that are themselves no
    /// modules of the program.
    NoModule,
    RegExpLiteral,
    PrivateNameInOptionalChain,
    PrivateNameOfEnclosingClass,
    StaticMemberNamedConstructor,
    CommentOfJavaScript,
    DeclarationsOfPackage,
}

/// The files that are no modules of the program and that a module of the program imports, straight away or through others of them: for
/// their types, which say what the code of the program is.
fn files_imported_for_types(checked: &Checked<'_>, fragments: &[Fragment], reach: &Reach, ids: &ProgramIds, imported_by: &(dyn Fn(&mut Checker<'_, '_>, FileId) -> Vec<FileId> + Sync), in_parallel: InParallel<'_>) -> FxHashSet<FileId> {
    const FILES_OF_A_RUN: usize = 256;
    let is_module = |file: FileId| reach.has_body_by_key(ids, FuncKey::Module(file));
    let mut pending: Vec<FileId> = fragments.iter().map(|fragment| fragment.file).filter(|&file| file != NO_FILE && is_module(file)).collect();
    let mut found = FxHashSet::default();
    while !pending.is_empty() {
        let mut runs: Vec<(&[FileId], Vec<FileId>)> = pending.chunks(FILES_OF_A_RUN).map(|run| (run, Vec::new())).collect();
        for_each_mut(&mut runs, in_parallel, &|(run, imported)| {
            let mut c = checked.checker();
            imported.extend(run.iter().flat_map(|&file| imported_by(&mut c, file)).filter(|&imported| !is_module(imported)));
        });
        pending = runs.into_iter().flat_map(|run| run.1).filter(|&imported| found.insert(imported)).collect();
    }
    found
}

/// Of a file that is not compiled with the program: the name of a function with a body in whose text the position lies, or nothing for a name if it lies in a statement at the top level
/// that declares nothing. That is code, and not the program's. `None`: it lies in what the file declares.
fn code_around(checked: &Checked<'_>, file: FileId, pos: u32) -> Option<String> {
    let hir = checked.files.hir(file);
    let c = checked.checker();
    let functions = (0..hir.fns.len() as u32).map(hir::FnId::from).filter(|&func| !matches!(hir[func].body, hir::FnBody::None));
    if let Some(func) = functions.filter(|&func| hir[func].start <= pos && pos < c.end_of_fn(file, func)).min_by_key(|&func| c.end_of_fn(file, func) - hir[func].start) {
        let name = hir[func].name;
        return Some(if name.is_some() { String::from_utf8_lossy(checked.files.atoms.bytes(name)).into_owned() } else { String::new() });
    }
    let around = hir.ids(hir.body).find(|&stmt| hir[stmt].start <= pos && pos < hir[stmt].loc.end)?;
    let declares_nothing = matches!(
        hir[around].kind,
        StmtKind::Expr(_) | StmtKind::If { .. } | StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } | StmtKind::Block(_) | StmtKind::Switch { .. } | StmtKind::Try { .. } | StmtKind::Throw(_) | StmtKind::Labeled { .. }
    );
    declares_nothing.then(String::new)
}

/// `None`: the position lies in code of the file that is in the program. It is code of the innermost function around it that the
/// fragment of the file defines, or else of the body of the module. A function in code that is cut is not defined.
/// `is_imported_for_types`: see `files_imported_for_types`. What such a file has outside of functions counts as what it declares.
fn place_of_error(checked: &Checked<'_>, fragments: &[Fragment], index: &Index, reach: &Reach, ids: &ProgramIds, (file, pos): (FileId, u32), is_imported_for_types: &mut dyn FnMut(FileId) -> bool) -> Option<Elsewhere> {
    if let Some(start) = checked.files.enclosing_cut_start(file, pos) {
        return Some(Elsewhere::Cut(start));
    }
    let Some(&number) = index.by_file.get(&file) else {
        return if is_imported_for_types(file) { code_around(checked, file, pos).map(Elsewhere::NotReached) } else { Some(Elsewhere::NoModule) };
    };
    let fragment = &fragments[number as usize];
    let holds = |&&(start, end): &&(u32, u32)| start <= pos && pos < end;
    let bodies = fragment.funcs.iter().filter(|function| function.key.file() == file).filter_map(|function| Some((function, function.body.as_ref()?)));
    let around = bodies.clone().flat_map(|(function, body)| body.spans.iter().filter(holds).map(move |span| (span.1 - span.0, function, body)));
    let name_of = |function: &Function| function.func.as_ref().map_or_else(String::new, |func| text_of(&fragment.strs, func.name));
    if let Some((_, function, body)) = around.min_by_key(|&(length, ..)| length) {
        if !reach.has_body_by_key(ids, function.key) {
            return Some(Elsewhere::NotReached(name_of(function)));
        }
        return body.cut.iter().find(holds).map(|cut| Elsewhere::Cut(cut.0));
    }
    let of_module = bodies.filter(|(function, _)| matches!(function.key, FuncKey::Module(_) | FuncKey::ModuleBody(_) | FuncKey::ModuleInner(_)));
    if !reach.has_body_by_key(ids, FuncKey::Module(file)) {
        let name = of_module.map(|(function, _)| name_of(function)).next().unwrap_or_default();
        return (!is_imported_for_types(file)).then_some(Elsewhere::NotReached(name));
    }
    for (_, body) in of_module {
        if body.dropped.iter().any(|span| holds(&span)) {
            return Some(Elsewhere::DroppedImport);
        }
        if let Some(cut) = body.cut.iter().find(holds) {
            return Some(Elsewhere::Cut(cut.0));
        }
    }
    let hir = checked.files.hir(file);
    let imported = hir.ids(hir.body).find_map(|stmt| match hir[stmt].kind {
        StmtKind::Import(import) if !hir[import].type_only && hir[stmt].start <= pos && pos < hir[stmt].loc.end => hir[import].named.iter().map(|spec| &hir[spec]).find(|spec| !spec.type_only && spec.start <= pos && pos < spec.end),
        _ => None,
    })?;
    let exports_locals = hir.ids(hir.body).any(|stmt| matches!(hir[stmt].kind, StmtKind::ExportNamed(export) if hir[export].spec.is_none()));
    let mentions: Vec<u32> = hir.exprs.iter().filter(|e| matches!(e.kind, hir::ExprKind::Ident(name) if name == imported.local)).map(|e| e.pos).collect();
    let is_used_nowhere = !exports_locals && mentions.into_iter().all(|mention| place_of_error(checked, fragments, index, reach, ids, (file, mention), is_imported_for_types).is_some());
    is_used_nowhere.then_some(Elsewhere::DroppedImport)
}

fn is_in_try_block_with_catch(checked: &Checked<'_>, file: FileId, pos: u32) -> bool {
    use bun_sema::bind::Parent;
    let (hir, bound, c) = (checked.files.hir(file), checked.files.bound(file), checked.checker());
    let around = (0..hir.exprs.len() as u32).map(hir::ExprId).filter(|&e| hir[e].pos <= pos && pos < hir[e].end);
    let Some(innermost) = around.min_by_key(|&e| hir[e].end - hir[e].pos) else { return false };
    let (mut child, mut parent) = (hir::StmtId::NONE, bound.expr_parent[innermost.idx()]);
    loop {
        match parent {
            Parent::Stmt(outer) if outer.is_some() => {
                if matches!(hir[outer].kind, StmtKind::Try { block, handler, .. } if block == child && handler.is_some()) {
                    return true;
                }
                child = outer;
            }
            Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::MemberInit(_) | Parent::Module(_) | Parent::File | Parent::None => return false,
            _ => {}
        }
        parent = c.parent_of_node(file, parent);
    }
}

/// `fragments`: one for each file that has been translated, in any order. `roots`: the files that the program starts with.
/// `builtin_modules`: the modules of the runtime that are compiled with it, by id. The registry runs them: nothing of the program does.
/// `prelude`: the files of `crate::prelude`. `shown_from`: `Constants::root`.
pub fn link(
    checked: &Checked<'_>,
    fragments: Vec<Fragment>,
    ids: &ProgramIds,
    roots: &[FileId],
    entry_points: &[Vec<FileId>],
    builtin_modules: &[(u32, FileId)],
    prelude: &[FileId],
    shown_from: &[u8],
    shows_whole_paths: bool,
    function_texts: Option<&mut crate::FunctionTexts>,
    errors: Errors<'_>,
    in_parallel: InParallel<'_>,
    explain: Explain,
    describe: Describe<'_>,
) -> Linked {
    let kinds_declared = checked.checker().kinds_declared();
    let named_by_typeof: OnceLock<FxHashSet<(FileId, ClassId)>> = OnceLock::new();
    std::thread::scope(|scope| {
        for _ in 0..2 {
            spawn_beside_the_pool(scope, || kinds_declared.help(checked));
        }
        spawn_beside_the_pool(scope, || {
            named_by_typeof.get_or_init(|| {
                let mut c = checked.checker();
                c.begin_stack_budget();
                c.classes_named_by_typeof()
            });
        });
        let (stores_known, stores_awaited) = channel::<Vec<MethodStore>>();
        let (methods_found, methods_awaited) = channel();
        spawn_beside_the_pool(scope, move || {
            if let Ok(stores) = stores_awaited.recv() {
                let mut c = checked.checker();
                c.begin_stack_budget();
                let replaced = c.methods_replaced_by(stores);
                methods_found.send((replaced, c.take_noted(), c.take_ran_out_of_stack())).ok();
            }
        });
        let linked = link_beside(checked, fragments, ids, roots, entry_points, builtin_modules, prelude, shown_from, shows_whole_paths, function_texts, errors, &kinds_declared, &named_by_typeof, (stores_known, methods_awaited), in_parallel, explain, describe);
        kinds_declared.give_up();
        linked
    })
}

fn link_beside(
    checked: &Checked<'_>,
    mut fragments: Vec<Fragment>,
    ids: &ProgramIds,
    roots: &[FileId],
    entry_points: &[Vec<FileId>],
    builtin_modules: &[(u32, FileId)],
    prelude: &[FileId],
    shown_from: &[u8],
    shows_whole_paths: bool,
    function_texts: Option<&mut crate::FunctionTexts>,
    errors: Errors<'_>,
    kinds_declared: &KindsDeclared,
    named_by_typeof: &OnceLock<FxHashSet<(FileId, ClassId)>>,
    methods_replaced: (Sender<Vec<MethodStore>>, Receiver<(ReplacedMethods, Noted, bool)>),
    in_parallel: InParallel<'_>,
    explain: Explain,
    describe: Describe<'_>,
) -> Linked {
    let (mut times, mut since) = (Times::default(), Instant::now());
    fragments.sort_by_cached_key(|fragment| checked.files.rank_of_file(fragment.file));
    let translated: Vec<FileId> = fragments.iter().map(|fragment| fragment.file).filter(|&file| file != NO_FILE).collect();
    let is_opaque = |file: FileId| file != NO_FILE && checked.files.module(file).is_opaque();
    let is_of_runtime = |file: FileId| file != NO_FILE && checked.files.module(file).builtin.is_some();
    // For a problem that is in no file.
    let nowhere = roots.first().copied().unwrap_or(FileId(0));
    let mut problems: Vec<Problem> = Vec::new();
    times.add("order", &mut since);
    let (mut types, mut seen, mut ran_out_of_stack) = (FxHashMap::default(), FxHashSet::default(), false);

    let mut index = Index::default();
    index.grow(ids);
    for (number, fragment) in fragments.iter().enumerate() {
        index.by_file.entry(fragment.file).or_insert(number as u32);
    }
    in_parallel(fragments.len(), &|number| index.add(number, &fragments[number]));
    const FUNCTIONS_OF_AN_OUTLINE: usize = 2048;
    let mut runs: Vec<(usize, usize, &mut [Function], &LocalToProgram, FileId, Outline)> = (fragments.iter_mut().enumerate())
        .flat_map(|(number, fragment)| {
            let Fragment { funcs, program_ids, file, .. } = fragment;
            let (program_ids, file) = (&*program_ids, *file);
            funcs.chunks_mut(FUNCTIONS_OF_AN_OUTLINE).enumerate().map(move |(run, functions)| (number, run * FUNCTIONS_OF_AN_OUTLINE, functions, program_ids, file, Outline::default()))
        })
        .collect();
    for_each_mut(&mut runs, in_parallel, &|(number, first, functions, program_ids, file, outline)| {
        *outline = Outline::of_functions(functions, *first, *file, program_ids, &|function, id| index.func(id) == Some(At::new(*number, function)));
    });
    let outlines: Vec<(usize, Outline)> = runs.into_iter().map(|run| (run.0, run.5)).collect();
    for (number, outline) in outlines {
        fragments[number].outline.append(outline);
    }
    times.add("index", &mut since);

    let mut reach = Reach::default();
    reach.grow(&fragments, ids);
    for &(method, name) in crate::prelude::FUNCTIONS {
        let defined = fragments.iter().filter(|fragment| prelude.contains(&fragment.file)).flat_map(|fragment| fragment.funcs.iter().map(move |function| (fragment, function)));
        let is_named = |fragment: &Fragment, function: &Function| function.func.as_ref().is_some_and(|func| func.name.is_some() && fragment.strs.get(func.name) == name.as_bytes());
        if let Some((_, function)) = defined.filter(|(_, function)| function.body.is_some()).find(|(fragment, function)| is_named(fragment, function))
            && let Some(id) = ids.funcs.find(&function.key)
        {
            reach.prelude.entry(method.as_bytes().to_vec()).or_default().push(id);
        }
    }
    // A file that only declares has no code to start with.
    let roots: Vec<FuncKey> = roots.iter().map(|&root| FuncKey::Module(root)).filter(|&root| index.func_by_key(ids, root).is_some()).collect();
    for root in roots.iter().filter_map(|&root| index.func_by_key(ids, root)) {
        reach.key(&fragments, &index, root, true);
    }
    for import in entry_points.iter().filter_map(|files| files.first()).filter_map(|&first| index.func_by_key(ids, FuncKey::DynamicImport(first, false))) {
        reach.key(&fragments, &index, import, true);
        reach.funcs[import as usize] |= reached::VALUE;
    }
    // No code outside a module of the runtime names a function of it, so one that cannot be translated is left out by itself.
    let mut builtin_modules_left_out: Vec<(u32, Problem)> = Vec::new();
    let mut builtin_functions_left_out: Vec<(u32, Problem)> = Vec::new();
    let mut builtin_roots: Vec<(u32, FuncKey)> = Vec::new();
    let number_of: FxHashMap<FileId, usize> = fragments.iter().enumerate().map(|(number, fragment)| (fragment.file, number)).collect();
    for &(id, file) in builtin_modules {
        let Some(evaluation) = index.func_by_key(ids, FuncKey::Module(file)) else { continue };
        let fragment = &fragments[number_of[&file]];
        let of_bodies = fragment.funcs.iter().filter_map(|function| function.body.as_ref()).flat_map(|body| &body.problems);
        let of_layouts = fragment.layouts.iter().filter_map(|shape| shape.definition.as_ref()).flat_map(|definition| &definition.problems);
        match of_bodies.chain(of_layouts).min_by_key(|problem| problem.pos) {
            Some(&Problem { file, pos, ref what }) => builtin_modules_left_out.push((id, Problem { file, pos, what: what.clone() })),
            None => {
                builtin_roots.push((id, FuncKey::Module(file)));
                reach.runtime_by_number.insert(i64::from(id), file);
                reach.evaluations_of_runtime.insert(file, evaluation);
                let name: &[u8] = bun_builtin_syntax::Archive::embedded().manifest().module(id).map_or(&[][..], |module| &module.name);
                reach.runtime_by_name.insert(name.to_vec(), file);
                if let Some(short) = name.strip_prefix(b"node:") {
                    reach.runtime_by_name.insert(short.to_vec(), file);
                }
                if matches!(checked.files.module(file).builtin, Some(Builtin::Module(_, true))) {
                    reach.key(&fragments, &index, evaluation, true);
                }
            }
        }
    }
    if let Some((files, id)) = entry_points.iter().filter_map(|files| files.first()).map(|&first| FuncKey::FilesByPath(first)).find_map(|files| Some((files, index.func_by_key(ids, files)?))) {
        builtin_roots.push((0x7fff_ffff, files));
        reach.key(&fragments, &index, id, true);
    }
    // Native code asks for a builtin function by its number, whatever the program does. A file that cannot be translated is left out whole.
    let mut builtin_functions: Vec<(u32, FuncKey, u32)> = Vec::new();
    for fragment in fragments.iter().filter(|fragment| !fragment.builtin_functions.is_empty()) {
        let of_bodies = fragment.funcs.iter().filter_map(|function| function.body.as_ref()).flat_map(|body| &body.problems);
        match of_bodies.min_by_key(|problem| problem.pos) {
            Some(&Problem { file, pos, ref what }) => builtin_functions_left_out.extend(fragment.builtin_functions.iter().map(|function| (function.0, Problem { file, pos, what: what.clone() }))),
            None => builtin_functions.extend(fragment.builtin_functions.iter().filter(|function| index.func_by_key(ids, function.1).is_some())),
        }
    }
    builtin_functions.sort_unstable_by_key(|function| function.0);
    for function in builtin_functions.iter().filter_map(|function| index.func_by_key(ids, function.1)) {
        reach.key(&fragments, &index, function, true);
    }
    let mut entries_beside: FxHashMap<LayoutKey, Vec<u32>> = FxHashMap::default();
    let mut entries_beside_functions: Vec<(Option<u32>, u32)> = Vec::new();
    let mut not_translated: FxHashSet<(FileId, hir::FnId)> = FxHashSet::default();
    for function in fragments.iter().flat_map(|fragment| fragment.summary.entries_and_second_bodies.iter().map(move |&i| &fragment.funcs[i as usize])) {
        if let (FuncKey::EntryBeside(file, root) | FuncKey::SecondBody(file, _, root), Some(body)) = (function.key, &function.body)
            && !body.problems.is_empty()
        {
            not_translated.insert((file, root));
        }
    }
    for fragment in &fragments {
        for (function, id) in fragment.summary.entries_and_second_bodies.iter().map(|&i| (&fragment.funcs[i as usize], fragment.program_ids.funcs[i as usize])) {
            let is_of_an_arrow = matches!(function.key, FuncKey::EntryBeside(file, root) if checked.files.hir(file)[root].kind == hir::FnKind::Arrow);
            if let (FuncKey::EntryBeside(file, root), Some(body)) = (function.key, &function.body)
                && body.class.is_some()
                && !is_of_an_arrow
                && !not_translated.contains(&(file, root))
            {
                entries_beside.entry(fragment.layouts[body.class.idx()].key).or_default().push(id);
            }
            if let (FuncKey::EntryBeside(file, root), Some(body)) = (function.key, &function.body)
                && (body.class.is_none() || is_of_an_arrow)
                && !not_translated.contains(&(file, root))
            {
                entries_beside_functions.push((ids.funcs.find(&FuncKey::Function(file, root)), id));
            }
        }
    }
    let entries_translated: usize = entries_beside.values().map(Vec::len).sum();
    let mut not_foreseen: FxHashSet<LayoutKey> = FxHashSet::default();
    let make_line_tables = |line_tables: &mut [(FileId, Vec<u8>, Vec<u8>)]| {
        for_each_mut(line_tables, in_parallel, &|(file, table, shown)| {
            let file = *file;
            let text = &checked.files.hir(file).text;
            *table = line_table(text, &compute_ecma_line_starts(text));
            // A module of the runtime is shown by the name the module loader has for it: native code goes by that text.
            let builtin = match checked.files.module(file).builtin {
                Some(Builtin::Module(id, _)) => bun_builtin_syntax::Archive::embedded().manifest().module(id),
                _ => None,
            };
            *shown = match builtin {
                Some(module) => module.name.to_vec(),
                None if shows_whole_paths || checked.files.module(file).file_name().starts_with(bun_builtin_syntax::VIRTUAL_ROOT) => checked.files.module(file).file_name().to_vec(),
                None => get_relative_path_from_directory(shown_from, checked.files.module(file).file_name(), checked.files.is_case_sensitive),
            };
        });
    };
    let mut line_tables_ahead: Vec<(FileId, Vec<u8>, Vec<u8>)> = fragments.iter().filter(|fragment| fragment.file != NO_FILE).map(|fragment| (fragment.file, Vec::new(), Vec::new())).collect();
    let mut evidence_of_strangers = EvidenceOfStrangers::default();
    loop {
        if seen.is_empty() {
            std::thread::scope(|scope| {
                let run = spawn_beside_the_pool(scope, || reach.run(&fragments, &index));
                add_kept_types(checked, &mut seen, &mut types, in_parallel);
                make_line_tables(&mut line_tables_ahead);
                run.join().expect("the thread that finds what is reached panicked");
            });
        } else {
            reach.run(&fragments, &index);
        }
        let named = std::mem::take(&mut reach.missing);
        let mut missing: Vec<(Identity, TypeId)> = Vec::with_capacity(named.len());
        for &(identity, at, by) in &named {
            match types.get(&identity) {
                Some(&ty) => missing.push((identity, ty)),
                None => problems.push(by.problem(&fragments, nowhere, format!("type {} (used by {}): internal error: no file defines it and its type was not kept; please report it", name_of_layout(&fragments, at), by.name(&fragments)))),
            }
        }
        times.add("reach", &mut since);
        if missing.is_empty() {
            let mut is_more_reached = false;
            let served = classes_served_by_second_bodies(checked, &fragments, &index, &reach, &types, &mut evidence_of_strangers, in_parallel);
            let mut c = checked.checker();
            for &class in &served {
                if let LayoutKey::Instance(file, of) = class
                    && !c.may_be_served_by_second_bodies(file, of)
                    && not_foreseen.insert(class)
                {
                    problems.push(Problem { file, pos: 0, what: "a class that objects come to which its constructor has not made, and of which the text of the program showed no evidence ahead of the translation".into() });
                }
            }
            drop(c);
            for &(whole, entry) in &entries_beside_functions {
                if whole.is_some_and(|whole| reach.has(whole, reached::VALUE)) && !reach.has(entry, reached::IS_REACHED) {
                    reach.key(&fragments, &index, entry, false);
                    is_more_reached = true;
                }
            }
            for class in served {
                for &entry in entries_beside.get(&class).into_iter().flatten() {
                    if !reach.has(entry, reached::IS_REACHED) {
                        reach.key(&fragments, &index, entry, false);
                        reach.funcs[entry as usize] |= reached::MEMBER;
                        is_more_reached = true;
                    }
                }
            }
            if !is_more_reached {
                break;
            }
            continue;
        }
        if times.rounds == MOST_ROUNDS {
            let (_, at, by) = named[0];
            problems.push(by.problem(&fragments, nowhere, format!("a type that expands without end, such as {} (used by {})", name_of_layout(&fragments, at), by.name(&fragments))));
            break;
        }
        let (described, has_run_out) = describe_in_tasks(checked, &missing, &index, ids, in_parallel, describe, (&mut times, &mut since));
        ran_out_of_stack |= has_run_out;
        let described_fragments = described.len();
        index.grow(ids);
        for fragment in described {
            index.by_file.entry(fragment.file).or_insert(fragments.len() as u32);
            index.add(fragments.len(), &fragment);
            fragments.push(fragment);
        }
        times.rounds += 1;
        times.layouts_described += fragments[fragments.len() - described_fragments..].iter().flat_map(|fragment| &fragment.layouts).filter(|shape| shape.definition.is_some()).count();
        for &(_, at, by) in named.iter().filter(|named| types.contains_key(&named.0) && index.record(ids, named.0).is_none()) {
            problems.push(by.problem(&fragments, nowhere, format!("type {} (used by {}): internal error: its layout could not be rebuilt; please report it", name_of_layout(&fragments, at), by.name(&fragments))));
        }
        times.add("reach", &mut since);
        add_kept_types(checked, &mut seen, &mut types, in_parallel);
        times.add("kept types", &mut since);
        reach.grow(&fragments, ids);
        let defined = missing.iter().filter_map(|(identity, _)| index.record(ids, *identity));
        reach.work.extend(defined.map(Work::Layout));
    }
    take_out_parts_that_do_not_run(&mut fragments, &reach, in_parallel);
    let is_record = |by: By| matches!(by, By::Layout(at) if matches!(fragments[at.fragment as usize].layouts[at.index as usize].key, LayoutKey::Record(_)));
    for (key, by) in reach.undefined_funcs.iter().filter(|undefined| !is_record(undefined.1)).map(|&(id, by)| (ids.funcs.key(id), by)) {
        problems.push(by.problem(&fragments, nowhere, format!("function {key:?} (used by {}): internal error: no file defines it; please report it", by.name(&fragments))));
    }
    for &(at, by) in &reach.undefined_layouts {
        problems.push(by.problem(&fragments, nowhere, format!("type {} (used by {}): internal error: no file defines it; please report it", name_of_layout(&fragments, at), by.name(&fragments))));
    }
    let Errors { places, in_dropped_imports, imported_by } = errors;
    let mut imported_for_types: Option<FxHashSet<FileId>> = None;
    let mut is_imported_for_types = |file: FileId| imported_for_types.get_or_insert_with(|| files_imported_for_types(checked, &fragments, &reach, ids, imported_by, in_parallel)).contains(&file);
    let is_in_regexp_literal = |(file, pos): (FileId, u32)| checked.files.hir(file).exprs.iter().any(|e| matches!(e.kind, hir::ExprKind::Regex) && e.pos < pos && pos < e.end);
    let is_private_name_in_optional_chain = |(file, pos): (FileId, u32)| {
        let hir = checked.files.hir(file);
        let is_in_chain = |mut at: hir::ExprId| loop {
            let (chain, inner) = match hir[at].kind {
                hir::ExprKind::Dot { obj, chain, .. } | hir::ExprKind::Index { obj, chain, .. } => (chain, obj),
                hir::ExprKind::Call(call) => (hir[call].chain, hir[call].callee),
                hir::ExprKind::NonNull(inner) => (hir::Chain::No, inner),
                _ => return false,
            };
            if chain != hir::Chain::No {
                return true;
            }
            at = inner;
        };
        hir.is_js && hir::is_private_name_at(hir, pos) && (0..hir.exprs.len() as u32).map(hir::ExprId).any(|e| matches!(hir[e].kind, hir::ExprKind::Dot { name_pos, .. } if name_pos == pos) && is_in_chain(e))
    };
    let is_private_name_of_enclosing_class = |(file, pos): (FileId, u32)| {
        let (hir, bound) = (checked.files.hir(file), checked.files.bound(file));
        hir.is_js && hir::is_private_name_at(hir, pos) && (0..hir.exprs.len() as u32).map(hir::ExprId).any(|e| {
            matches!(hir[e].kind, hir::ExprKind::Dot { obj, name_pos, .. } if name_pos == pos && !matches!(hir[obj].kind, hir::ExprKind::Super))
                && bound.private_class.contains_key(&e)
                && !hir.exprs.iter().any(|around| matches!(around.kind, hir::ExprKind::Unary { op: hir::UnOp::Delete, operand } if operand == e))
        })
    };
    let is_static_member_named_constructor = |(file, pos): (FileId, u32)| {
        let hir = checked.files.hir(file);
        hir.is_js && hir.members.iter().any(|member| (member.name_pos == pos || hir.modifier_list(member.modifiers).iter().any(|modifier| modifier.pos == pos && modifier.kind == hir::ModifierKind::Keyword(Flags::STATIC))) && member.flags.contains(Flags::STATIC) && matches!(member.kind, hir::MemberKind::Method | hir::MemberKind::Getter | hir::MemberKind::Setter) && matches!(member.key, hir::PropKey::Name(name) if checked.files.atoms.bytes(name) == b"constructor"))
    };
    let is_in_comment_of_javascript = |(file, pos): (FileId, u32)| {
        let hir = checked.files.hir(file);
        hir.is_js && hir.check_directive.is_none() && checked.files.options.check_js.is_none() && hir::is_in_comment(hir, pos)
    };
    let is_in_declarations_of_package = |(file, _): (FileId, u32)| {
        checked.files.hir(file).kind == hir::FileKind::Declaration && checked.files.module(file).path.text.windows(14).any(|part| part == b"/node_modules/")
    };
    let place_of = |(&place, &is_in_dropped_import): (&(FileId, u32), &bool)| {
        let elsewhere = place_of_error(checked, &fragments, &index, &reach, ids, place, &mut is_imported_for_types).or(is_in_dropped_import.then_some(Elsewhere::DroppedImport));
        elsewhere.or_else(|| is_in_regexp_literal(place).then_some(Elsewhere::RegExpLiteral)).or_else(|| is_private_name_in_optional_chain(place).then_some(Elsewhere::PrivateNameInOptionalChain))
            .or_else(|| is_private_name_of_enclosing_class(place).then_some(Elsewhere::PrivateNameOfEnclosingClass))
            .or_else(|| is_static_member_named_constructor(place).then_some(Elsewhere::StaticMemberNamedConstructor))
            .or_else(|| is_in_comment_of_javascript(place).then_some(Elsewhere::CommentOfJavaScript))
            .or_else(|| is_in_declarations_of_package(place).then_some(Elsewhere::DeclarationsOfPackage))
    };
    let errors: Vec<Option<Elsewhere>> = places.iter().zip(in_dropped_imports).map(place_of).collect();
    // Nothing comes of a program with an error in it.
    if errors.iter().any(Option::is_none) {
        return Linked { problems, errors, times, ..Linked::default() };
    }

    // The functions of the program after the entry functions, and whether each has its body.
    let of_the_runtime: FxHashSet<FileId> = builtin_modules.iter().map(|module| module.1).collect();
    let mut included_of: Vec<(usize, [Vec<(At, bool)>; 2])> = (0..fragments.len()).map(|number| (number, Default::default())).collect();
    {
        let (fragments, reach, index) = (&fragments, &reach, &index);
        for_each_mut(&mut included_of, in_parallel, &|(number, included)| {
            for (i, &id) in fragments[*number].program_ids.funcs.iter().enumerate() {
                let at = At::new(*number, i);
                if reach.has(id, reached::IS_REACHED) && index.func(id) == Some(at) {
                    let function = &fragments[*number].outline.funcs[i];
                    let evaluates_module = function.has(outline_flags::RUNS_AT_START) && !of_the_runtime.contains(&function.file);
                    included[usize::from(!evaluates_module)].push((at, reach.has(id, reached::BODY)));
                }
            }
        });
    }
    {
        let fragment_of_file: FxHashMap<FileId, usize> = fragments.iter().enumerate().filter(|found| !is_of_runtime(found.1.file)).map(|(number, fragment)| (fragment.file, number)).collect();
        let starts: Vec<Vec<usize>> = entry_points.iter().map(|files| files.iter().filter_map(|file| fragment_of_file.get(file).copied()).collect()).collect();
        let static_imports_of = |number: usize| -> Vec<usize> {
            let fragment = &fragments[number];
            let called = fragment.summary.run_at_evaluation.iter().flat_map(|&i| {
                let of_function = fragment.outline.local[fragment.outline.funcs[i as usize].list(Outline::CALLED)].iter().map(|&callee| FuncId(callee));
                of_function.chain(fragment.funcs[i as usize].body.iter().flat_map(|body| body.parts.iter().flat_map(|part| part.mentions.called())))
            });
            called
                .filter_map(|callee| match fragment.funcs[callee.idx()].key {
                    FuncKey::Module(imported) | FuncKey::Required(imported) => fragment_of_file.get(&imported).copied(),
                    _ => None,
                })
                .collect()
        };
        let first_entry_point = first_entry_point_evaluating(fragments.len(), &starts, &static_imports_of);
        included_of.sort_by_key(|&(number, _)| (first_entry_point[number], number));
    }
    // What runs when the program starts comes first, in the order it runs in: the image places code by these numbers, and whatever is numbered as it is first mentioned follows.
    let key_at = |at: At| fragments[at.fragment as usize].funcs[at.index as usize].key;
    let evaluating_modules: usize = included_of.iter().map(|of_fragment| of_fragment.1[0].len()).sum();
    let included: Vec<(At, bool)> = [0, 1].into_iter().flat_map(|group| included_of.iter().flat_map(move |of_fragment| &of_fragment.1[group])).copied().collect();
    let evaluating: Vec<(FuncId, FuncKey)> = included
        .iter()
        .enumerate()
        .filter(|found| explain.deferred && found.1.1)
        .map(|(i, &(at, _))| (FuncId::new(entry_points.len() + i), key_at(at)))
        .filter(|found| matches!(found.1, FuncKey::Module(file) | FuncKey::ModuleBody(file) | FuncKey::ModuleSettling(file) | FuncKey::Initializer(file, _) if !of_the_runtime.contains(&file)))
        .collect();

    let name_of_entry = ids.str(Strs::hash_of(b"main"), b"main");
    let mut func_ids = FuncIds { ids, by_program_id: vec![FuncId::NONE; ids.funcs.bound()] };
    for (i, &(at, _)) in included.iter().enumerate() {
        func_ids.by_program_id[fragments[at.fragment as usize].program_ids.funcs[at.index as usize] as usize] = FuncId::new(entry_points.len() + i);
    }
    let func_ids = func_ids;
    let mut funcs_of: Vec<Vec<Function>> = fragments.iter_mut().map(|fragment| std::mem::take(&mut fragment.funcs)).collect();
    let mut numbering = Numbering::new(&fragments, &index, ids, &func_ids.by_program_id, in_parallel);
    numbering.str_ids[name_of_entry as usize] = numbering.strs.intern(b"main");
    let name_of_entry = numbering.str_ids[name_of_entry as usize];
    // A module for each file that has a function in the program, in the order of those.
    let mut last = None;
    for &(at, _) in &included {
        let file = fragments[at.fragment as usize].outline.funcs[at.index as usize].file;
        if last.replace(file) != Some(file) {
            numbering.module_of(file);
        }
    }
    let mut noted: Noted = Noted::default();
    let mut lost: Vec<(Identity, Problem)> = Vec::new();
    let mut included_by_fragment: Vec<[&[(At, bool)]; 2]> = vec![[&included[..0]; 2]; fragments.len()];
    let groups = included.split_at(evaluating_modules);
    for (group, functions) in [groups.0, groups.1].into_iter().enumerate() {
        for run in functions.chunk_by(|a, b| a.0.fragment == b.0.fragment) {
            included_by_fragment[run[0].0.fragment as usize][group] = run;
        }
    }
    let (mut numbering, is_layout_of_runtime, mut extended_globals, mut prototype_property_names, stores_to_methods) = std::thread::scope(|scope| {
    let numbered = spawn_beside_the_pool(scope, || {
    // By layout: a function of the runtime is the first to lead to it. Those of the program come first: so nothing of the program leads to it.
    let mut is_layout_of_runtime: Vec<bool> = Vec::new();
    let mut module_before = (u32::MAX, ModuleId::NONE);
    for &(at, has_body) in &included {
        let outline = &fragments[at.fragment as usize].outline;
        let function = &outline.funcs[at.index as usize];
        if has_body {
            if std::mem::replace(&mut module_before, (at.fragment, function.module)) != (at.fragment, function.module) {
                numbering.module(at.fragment, function.module);
            }
            numbering.mention_of_function(at);
        } else {
            numbering.header_of_function(at);
        }
        numbering.layout(at.fragment, function.class);
        for &class in outline.local[function.list(Outline::CLASSES_AS_VALUES)].iter().filter(|_| has_body) {
            numbering.layout(at.fragment, LayoutId(class));
        }
        numbering.settle();
        if is_layout_of_runtime.len() < numbering.layouts.len() {
            is_layout_of_runtime.resize(numbering.layouts.len(), is_of_runtime(function.file));
        }
    }
    let mut extended_globals: Vec<StrId> = Vec::new();
    let mut prototype_property_names: Vec<StrId> = Vec::new();
    let mut stores_to_methods: Vec<(FileId, MethodStore<Identity>)> = Vec::new();
    for (number, fragment) in fragments.iter().enumerate() {
        if numbering.module_ids.contains_key(&fragment.file) && !is_opaque(fragment.file) {
            for &name in &fragment.altered_globals {
                extended_globals.push(numbering.str(number as u32, name));
            }
            for &name in &fragment.prototype_property_names {
                prototype_property_names.push(numbering.str(number as u32, name));
            }
            stores_to_methods.extend(fragment.stores_to_methods.iter().map(|store| (fragment.file, store.clone())));
        }
    }
    (numbering, is_layout_of_runtime, extended_globals, prototype_property_names, stores_to_methods)
    });

    // From here on the fragments are taken apart. What was noted is put together, with the types in the place of what the fragments call
    // them. A type that does not come back would be a member or a view the less, and nobody would know.
    struct NotesOf<'a> {
        program_ids: &'a [u32],
        funcs: &'a mut [Function],
        functions: [&'a [(At, bool)]; 2],
        noted: [Noted; 2],
        lost: [Vec<(Identity, Problem)>; 2],
    }
    let mut notes_of: Vec<NotesOf<'_>> = (funcs_of.iter_mut().zip(&fragments).zip(included_by_fragment.iter().copied()))
        .filter(|(_, functions)| functions.iter().any(|group| !group.is_empty()))
        .map(|((funcs, fragment), functions)| NotesOf { program_ids: &fragment.program_ids.funcs, funcs, functions, noted: Default::default(), lost: Default::default() })
        .collect();
    for_each_mut(&mut notes_of, in_parallel, &|of| {
        for (group, functions) in of.functions.iter().enumerate() {
            let (noted, lost) = (&mut of.noted[group], &mut of.lost[group]);
            for index in functions.iter().filter(|function| function.1).map(|function| function.0.index) {
                let function = &mut of.funcs[index as usize];
                let (key, pos) = (function.key, function.func.as_ref().map_or(0, |func| func.pos));
                if is_opaque(key.file()) {
                    continue;
                }
                let Some(body) = &mut function.body else { continue };
                let is_called_unknown = reach.has(of.program_ids[index as usize], reached::VALUE | reached::MEMBER);
                let if_called_unknown = is_called_unknown.then(|| std::mem::take(&mut body.notes_if_called_unknown));
                for notes in std::iter::once(std::mem::take(&mut body.notes)).chain(if_called_unknown) {
                    noted.absorb(notes.renamed(|identity| {
                        let ty = types.get(&identity).copied();
                        if ty.is_none() {
                            lost.push((identity, Problem { file: key.file(), pos, what: format!("a type ({identity:x?}) that is noted for the function {key:?} and that no task has kept").into() }));
                        }
                        ty
                    }));
                }
            }
        }
    });
    const FRAGMENTS_OF_A_RUN: usize = 1024;
    let mut runs: Vec<(&mut [NotesOf<'_>], [Noted; 2])> = notes_of.chunks_mut(FRAGMENTS_OF_A_RUN).map(|run| (run, Default::default())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, noted)| {
        for (group, noted) in noted.iter_mut().enumerate() {
            for of in run.iter_mut() {
                noted.absorb(std::mem::take(&mut of.noted[group]));
            }
        }
    });
    for group in 0..2 {
        for (run, of_run) in &mut runs {
            noted.absorb(std::mem::take(&mut of_run[group]));
            for of in run.iter_mut() {
                lost.append(&mut of.lost[group]);
            }
        }
    }
    drop(runs);
    drop(notes_of);
    numbered.join().expect("the thread that numbers panicked")
    });
    numbering.lay_strs(in_parallel);
    numbering.fill_maps(&included_by_fragment, in_parallel);
    numbering.number_parts_of_types(in_parallel);
    let Numbering { maps, strs, tys, layouts, globals, modules, str_ids, layout_ids, global_ids, .. } = numbering;
    for (fragment, funcs) in fragments.iter_mut().zip(funcs_of) {
        fragment.funcs = funcs;
    }
    for names in [&mut extended_globals, &mut prototype_property_names] {
        names.sort_unstable_by(|&a, &b| strs.get(a).cmp(strs.get(b)));
        names.dedup();
    }
    let outlines: Vec<Outline> = fragments.iter_mut().map(|fragment| std::mem::take(&mut fragment.outline)).collect();
    std::thread::spawn(move || drop(outlines));
    times.add("number", &mut since);
    let mut lost_with_stores: Vec<(Identity, Problem)> = Vec::new();
    let stores_to_methods: Vec<MethodStore> = (stores_to_methods.into_iter())
        .filter_map(|(file, store)| {
            store.renamed(|identity| {
                let ty = types.get(&identity).copied();
                if ty.is_none() {
                    lost_with_stores.push((identity, Problem { file, pos: 0, what: format!("the type ({identity:x?}) of an object that a method is stored to, which no task has kept").into() }));
                }
                ty
            })
        })
        .collect();
    let (stores_known, methods_awaited) = methods_replaced;
    stores_known.send(stores_to_methods).expect("the thread that finds the methods that are replaced is there");
    let mut classes_as_values: Vec<LayoutId> = Vec::new();
    // `Body::stored_besides`, with the number of the fragment.
    let mut stored_besides: Vec<(u32, StrId)> = Vec::new();
    // `Body::number_flows`, each with its file. The names are program-wide ids.
    let (mut number_flows, mut flows_of_runtime): (Vec<(FileId, NumberFlow<StrId>)>, Vec<(FileId, NumberFlow<StrId>)>) = (Vec::new(), Vec::new());
    let is_stub: Vec<bool> = std::iter::repeat_n(false, entry_points.len()).chain(included.iter().map(|function| !function.1)).collect();

    let mut program = Program { strs, tys, extended_globals, prototype_property_names, entries: (0..entry_points.len()).map(FuncId::new).collect(), ..Program::default() };
    for entry_point in entry_points {
        // A file that only declares has no code to start with.
        let run: Vec<FuncId> = entry_point.iter().filter_map(|&root| func_ids.get(FuncKey::Module(root))).collect();
        let import = entry_point.first().and_then(|&first| func_ids.get(FuncKey::DynamicImport(first, false)));
        let is_commonjs = shows_whole_paths && entry_point.first().is_some_and(|&first| checked.files.module(first).is_commonjs() || checked.files.module(first).file_name().ends_with(b".cjs"));
        let first_operation = is_commonjs.then(|| program.strs.intern(b"NoteCommonJSEntryPoint"));
        program.funcs.push(entry_function(name_of_entry, program.tys.anything, &run, import, first_operation));
    }
    // By layout: the type it stands for, the class it is of, and the class that it constructs by its value.
    let mut views: Vec<(LayoutId, Identity)> = Vec::new();
    let mut classes: Vec<Option<(FileId, ClassId)>> = Vec::with_capacity(layouts.len());
    let mut constructed_by_value: Vec<LayoutId> = Vec::new();
    let mut notes_of_layouts: Vec<(Notes, LayoutKey)> = Vec::new();
    let mut problems_of_layouts: Vec<Problem> = Vec::new();
    let mut shapes_of: Vec<Vec<Option<&mut Shape>>> = fragments.iter_mut().map(|fragment| fragment.layouts.iter_mut().map(Some).collect()).collect();
    let mut taken: Vec<(At, &mut Shape, Option<Box<Definition>>)> = (layouts.iter())
        .map(|&at| (at, shapes_of[at.fragment as usize][at.index as usize].take().expect("`layouts` has each layout once"), None))
        .collect();
    drop(shapes_of);
    for_each_mut(&mut taken, in_parallel, &|(at, shape, taken)| {
        let mut definition = shape.definition.take().expect("the index has no shape that is only named, and `layouts` has each once");
        let layout = &mut definition.layout;
        for_each_id_of_layout(layout, &mut Renumber(&maps[at.fragment as usize]));
        if layout.kind == LayoutKind::Record {
            layout.methods.retain(|method| method.func.is_some());
        }
        for field in layout.fields.iter_mut().filter(|field| field.only_function.is_none()) {
            field.only_function_flags = 0;
        }
        *taken = Some(definition);
    });
    for (id, (at, shape, definition)) in taken.into_iter().enumerate() {
        let Definition { layout, mentions: _, constructs, notes: of_layout, problems: mut of_declaration } = *definition.expect("every layout has been taken");
        program.layouts.push(layout);
        views.extend(shape.ty.map(|ty| (LayoutId::new(id), ty)));
        classes.push(if let LayoutKey::Instance(file, class) = shape.key { Some((file, class)) } else { None });
        if constructs.is_some() {
            constructed_by_value.push(maps[at.fragment as usize].layouts[constructs.idx()]);
        }
        if let Some(of_layout) = of_layout.filter(|_| !shape.key.file().is_some_and(is_opaque)) {
            notes_of_layouts.push((*of_layout, shape.key));
        }
        problems_of_layouts.append(&mut of_declaration);
    }
    struct Run<'a> {
        included: &'a [(At, bool)],
        functions: Vec<&'a mut Function>,
        funcs: &'a mut [MaybeUninit<Func>],
        contents: &'a mut [u8],
        problems: Vec<Problem>,
        classes_as_values: Vec<LayoutId>,
        stored_besides: Vec<(u32, StrId)>,
        number_flows: [Vec<(FileId, NumberFlow<StrId>)>; 2],
        regexp_literals: Vec<(StrId, StrId)>,
    }
    let literal = program.strs.find(b"RegExpLiteral");
    let marks = Marks { names: (0..program.strs.len()).map(|_| AtomicU8::new(0)).collect(), is_copied_to: (0..program.tys.list.len()).map(|_| AtomicBool::new(false)).collect() };
    for func in &program.funcs {
        marks.add(func, &program.layouts, &mut Vec::new(), &mut Vec::new());
    }
    let layouts_of_program = &program.layouts;
    program.funcs.reserve_exact(included.len());
    let anything = program.tys.anything;
    let size = program.strs.find(b"size");
    let mut contents: Vec<u8> = program.funcs.iter().map(|func| contents_of(func, size)).chain(std::iter::repeat_n(0, included.len())).collect();
    let mut room_left = &mut program.funcs.spare_capacity_mut()[..included.len()];
    let mut contents_left = &mut contents[entry_points.len()..];
    let (mut taken_apart, program_ids): (Vec<Vec<Option<&mut Function>>>, Vec<&LocalToProgram>) = (fragments.iter_mut())
        .map(|fragment| {
            let Fragment { funcs, program_ids, .. } = fragment;
            (funcs.iter_mut().map(Some).collect(), &*program_ids)
        })
        .unzip();
    let mut runs: Vec<Run<'_>> = (included.chunks(FUNCTIONS_OF_A_SLICE))
        .map(|included| {
            let functions = included.iter().map(|&(at, _)| taken_apart[at.fragment as usize][at.index as usize].take().expect("a function is in the program once")).collect();
            let (funcs, contents);
            (funcs, room_left) = std::mem::take(&mut room_left).split_at_mut(included.len());
            (contents, contents_left) = std::mem::take(&mut contents_left).split_at_mut(included.len());
            Run { included, functions, funcs, contents, problems: Vec::new(), classes_as_values: Vec::new(), stored_besides: Vec::new(), number_flows: Default::default(), regexp_literals: Vec::new() }
        })
        .collect();
    drop(taken_apart);
    for_each_mut(&mut runs, in_parallel, &|run| {
        let (mut stored, mut read) = (Vec::new(), Vec::new());
        for (((&(at, has_body), function), place), contents) in run.included.iter().zip(run.functions.iter_mut()).zip(run.funcs.iter_mut()).zip(run.contents.iter_mut()) {
            let number = at.fragment as usize;
            let program_ids = program_ids[number];
            let key = function.key;
            if let Some(body) = &mut function.body {
                if has_body {
                    run.problems.append(&mut body.problems);
                    run.classes_as_values.extend(body.classes_as_values.iter().map(|class| maps[number].layouts[class.idx()]));
                }
                if has_body && !is_opaque(key.file()) {
                    for &name in &body.stored_besides {
                        match str_ids[program_ids.strs[name.idx()] as usize] {
                            known if known.is_some() => stored.push(known),
                            _ => run.stored_besides.push((at.fragment, name)),
                        }
                    }
                    marks.add_names(&mut stored, Marks::IS_STORED);
                    run.number_flows[usize::from(is_of_runtime(key.file()))].extend(body.number_flows.drain(..).map(|flow| (key.file(), flow.renamed(|name| StrId(program_ids.strs[name.idx()])))));
                }
            }
            let mut func = if has_body {
                let mut func = function.func.take().expect(IS_KNOWN);
                renumber_func(&mut func, &maps[number]);
                func
            } else {
                stub(function.func.as_ref().expect(IS_KNOWN), &maps[number], anything)
            };
            if reach.has(program_ids.funcs[at.index as usize], reached::VALUE) {
                func.flags |= func_flags::IS_VALUE;
            }
            if let Some(literal) = literal
                && !modules.get(func.module.idx()).is_some_and(|file| of_the_runtime.contains(file))
            {
                for value in &func.values {
                    if let Def::Op(Op::Operation { name, args }) = &value.def
                        && *name == literal
                        && let [pattern, flags] = args[..]
                        && let (Some(pattern), Some(flags)) = (constant_string(&func, pattern), constant_string(&func, flags))
                    {
                        run.regexp_literals.push((pattern, flags));
                    }
                }
            }
            *contents = contents_of(&func, size);
            marks.add(&func, layouts_of_program, &mut stored, &mut read);
            place.write(func);
        }
    });
    for mut run in runs {
        problems.append(&mut run.problems);
        classes_as_values.append(&mut run.classes_as_values);
        stored_besides.append(&mut run.stored_besides);
        number_flows.append(&mut run.number_flows[0]);
        flows_of_runtime.append(&mut run.number_flows[1]);
        program.regexp_literals.append(&mut run.regexp_literals);
    }
    // SAFETY: the runs are all of `included`, and each has written a function for every entry.
    unsafe { program.funcs.set_len(entry_points.len() + included.len()) };
    program.regexp_literals.sort_unstable_by_key(|&(pattern, flags)| (pattern.0, flags.0));
    program.regexp_literals.dedup();
    // The runtime and the program each go by what their own code stores.
    let ranks_of_files: Vec<u32> = (0..checked.files.modules.len() as u32).map(|file| checked.files.rank_of_file(FileId(file))).collect();
    let verdicts_on_integers = std::thread::spawn(move || [number_flows, flows_of_runtime].map(|flows| expected_int32(&flows, |file| ranks_of_files[file.idx()])));
    program.builtin_modules = builtin_roots.iter().filter_map(|(id, root)| Some((*id, func_ids.get(*root)?))).collect();
    program.builtin_functions = builtin_functions.iter().map(|(id, root, visibility)| (*id, func_ids.get(*root).expect("a builtin function that is in the index is reached"), *visibility)).collect();
    let init_of = |file: FileId| func_ids.get(FuncKey::Module(file)).unwrap_or(FuncId::NONE);
    let made_ahead: FxHashMap<FileId, usize> = line_tables_ahead.iter().enumerate().map(|(at, made)| (made.0, at)).collect();
    let mut others: Vec<(FileId, Vec<u8>, Vec<u8>)> = modules.iter().filter(|&&file| !made_ahead.contains_key(&file)).map(|&file| (file, Vec::new(), Vec::new())).collect();
    make_line_tables(&mut others);
    let mut others = others.into_iter();
    for &file in &modules {
        let (line_table, shown) = match made_ahead.get(&file) {
            Some(&at) => (std::mem::take(&mut line_tables_ahead[at].1), std::mem::take(&mut line_tables_ahead[at].2)),
            None => others.next().map(|made| (made.1, made.2)).expect("a line table is made for every other module"),
        };
        let display_path = program.strs.intern(&shown);
        program.modules.push(ir::Module { path: display_path, init: init_of(file), display_path, line_table, printed: Vec::new() });
    }
    if let Some(function_texts) = function_texts {
        let printed_by_module: Vec<Option<&(Vec<u8>, Vec<(u32, u32, u32)>)>> = modules.iter().map(|&file| function_texts.get(checked.files.module(file).file_name())).collect();
        let has_text: Vec<AtomicBool> = modules.iter().map(|_| AtomicBool::new(false)).collect();
        let mut runs: Vec<&mut [Func]> = program.funcs.chunks_mut(FUNCTIONS_OF_A_SLICE).collect();
        for_each_mut(&mut runs, in_parallel, &|funcs| {
            for func in funcs.iter_mut().filter(|func| func.place_of_text != 0) {
                let printed = printed_by_module.get(func.module.idx()).copied().flatten();
                let found = printed.and_then(|(_, texts)| Some(texts[texts.binary_search_by_key(&(func.place_of_text - 1), |text| text.0).ok()?]));
                (func.place_of_text, func.end_of_text) = found.map_or((0, 0), |(_, start, end)| (start, end));
                if found.is_some() {
                    has_text[func.module.idx()].store(true, Ordering::Relaxed);
                }
            }
        });
        for ((module, &file), _) in program.modules.iter_mut().zip(&modules).zip(has_text).filter(|module| module.1.load(Ordering::Relaxed)) {
            if let Some((text, _)) = function_texts.get_mut(checked.files.module(file).file_name()) {
                module.printed = std::mem::take(text);
            }
        }
    }
    const VARIABLES_OF_A_RUN: usize = 1024;
    let mut runs: Vec<(&[At], Vec<ir::Global>)> = globals.chunks(VARIABLES_OF_A_RUN).map(|run| (run, Vec::new())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, made)| {
        for &at in run.iter() {
            let ir::Global { name, module, declared, initialization, only_function, only_function_flags } = fragments[at.fragment as usize].globals[at.index as usize].global;
            let mut global = ir::Global { name, module, declared, initialization, only_function, only_function_flags };
            for_each_id_of_global(&mut global, &mut Renumber(&maps[at.fragment as usize]));
            // Of a function that is not reached there are no closures.
            if global.only_function.is_none() {
                global.only_function_flags = 0;
            }
            made.push(global);
        }
    });
    program.globals.extend(runs.into_iter().flat_map(|run| run.1));
    problems.append(&mut problems_of_layouts);
    const LAYOUTS_OF_A_RUN: usize = 512;
    let mut runs: Vec<(&mut [(Notes, LayoutKey)], Noted, Vec<(Identity, Problem)>)> = notes_of_layouts.chunks_mut(LAYOUTS_OF_A_RUN).map(|run| (run, Noted::default(), Vec::new())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, noted, lost)| {
        for (notes, key) in run.iter_mut() {
            noted.absorb(std::mem::take(notes).renamed(|identity| {
                let ty = types.get(&identity).copied();
                if ty.is_none() {
                    lost.push((identity, Problem { file: key.file().unwrap_or(nowhere), pos: 0, what: format!("a type ({identity:x?}) that is noted for the layout {key:x?} and that no task has kept").into() }));
                }
                ty
            }));
        }
    });
    for (_, of_run, mut lost_in_run) in runs {
        noted.absorb(of_run);
        lost.append(&mut lost_in_run);
    }
    for class in constructed_by_value.into_iter().filter(|class| class.is_some()) {
        program.layouts[class.idx()].class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
    }
    times.add("renumber", &mut since);

    {
        let all = Final {
            program: &program,
            tys: program.tys.list.iter().enumerate().map(|(i, declared)| (declared, TyId::new(i))).collect(),
            funcs: &func_ids.by_program_id,
            layouts: &layout_ids,
            globals: &global_ids,
            is_stub: &is_stub,
        };
        let mut found: Vec<(usize, Vec<Problem>)> = (0..fragments.len()).map(|number| (number, Vec::new())).collect();
        for_each_mut(&mut found, in_parallel, &|(number, found)| {
            *found = disagreements(&fragments[*number], &maps[*number], &all, nowhere);
        });
        problems.extend(found.into_iter().flat_map(|(_, found)| found));
    }
    times.add("compare", &mut since);

    let mut again = |identity: Identity, file: FileId, of: &dyn Fn() -> String| {
        let ty = types.get(&identity).copied();
        if ty.is_none() {
            lost.push((identity, Problem { file, pos: 0, what: format!("the type ({identity:x?}) of {}, which no task has kept", of()).into() }));
        }
        ty
    };
    let views: Vec<(LayoutId, TypeId)> = (views.into_iter())
        .filter_map(|(layout, identity)| Some((layout, again(identity, nowhere, &|| format!("the layout `{}`", text_of(&program.strs, program.layouts[layout.idx()].name)))?)))
        .collect();
    lost.append(&mut lost_with_stores);
    // The notes of a function come in no order, and a type more than once.
    lost.sort_by_key(|lost| lost.0);
    lost.dedup_by_key(|lost| lost.0);
    problems.extend(lost.into_iter().map(|lost| lost.1));

    // No task runs any more: the checker sees all that has been published.
    let c = &mut checked.checker();
    c.begin_stack_budget();

    // Which methods the modules of the program are seen to put something else in the place of. No fragment says so of any.
    let (replaced, noted_on_the_way, has_run_out_on_the_way) = methods_awaited.recv().expect("the thread that finds the methods that are replaced panicked");
    ran_out_of_stack |= has_run_out_on_the_way;
    for (layout, class) in program.layouts.iter_mut().zip(&classes) {
        let Some((file, class)) = *class else { continue };
        if replaced.contains(file, class, b"constructor", false) {
            layout.class_flags |= class_flags::CONSTRUCTOR_MAY_BE_REPLACED;
        }
        for method in &mut layout.methods {
            if method.name.is_some() && replaced.contains(file, class, program.strs.get(method.name), method.flags & method_flags::STATIC != 0) {
                method.flags |= method_flags::MAY_BE_REPLACED;
            }
        }
    }

    // A class that is not laid out constructs what it extends by its value. Where that may be a class that is laid out, the objects of
    // that layout do not all have the prototype object of that class.
    let has_replaced_static_member = |layout: &Layout| layout.methods.iter().any(|method| method.flags & method_flags::STATIC != 0 && method.flags & method_flags::MAY_BE_REPLACED != 0);
    for &(layout, _) in views.iter().filter(|view| classes[view.0.idx()].is_some()) {
        let mut at = layout;
        while at.is_some() && !has_replaced_static_member(&program.layouts[at.idx()]) {
            at = program.layouts[at.idx()].base;
        }
        if at.is_some() {
            classes_as_values.push(layout);
        }
    }
    let named_by_typeof = named_by_typeof.get_or_init(|| c.classes_named_by_typeof());
    for layout in (0..program.layouts.len()).map(LayoutId::new).filter(|layout| classes[layout.idx()].is_some_and(|class| named_by_typeof.contains(&class))) {
        let mut at = layout;
        while at.is_some() {
            classes_as_values.push(at);
            at = program.layouts[at.idx()].base;
        }
    }
    classes_as_values.retain(|class| class.is_some() && program.layouts[class.idx()].class_flags & class_flags::IS_LAID_OUT != 0);
    classes_as_values.sort_unstable();
    classes_as_values.dedup();
    let class_of = |layout: &LayoutId| classes[layout.idx()];
    let is_extending = |layout: &LayoutId| program.layouts[layout.idx()].class_flags & class_flags::HAS_FOREIGN_ROOT != 0;
    let extending: Vec<(FileId, ClassId)> = (0..program.layouts.len()).map(LayoutId::new).filter(is_extending).filter_map(|layout| class_of(&layout)).collect();
    let candidates: Vec<(LayoutId, (FileId, ClassId))> = classes_as_values.iter().filter_map(|layout| Some((*layout, class_of(layout)?))).collect();
    let asked: Vec<(FileId, ClassId)> = candidates.iter().map(|candidate| candidate.1).collect();
    let mut extended_by_value = 0usize;
    for (candidate, may_be_extended) in candidates.iter().zip(c.may_be_extended_by_value(&extending, &asked)) {
        if may_be_extended {
            extended_by_value += 1;
            program.layouts[candidate.0.idx()].class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
            // `super()` there makes an object of this layout, be the class abstract.
            if let Some(&(_, ty)) = views.iter().find(|view| view.0 == candidate.0) {
                c.note_allocation(ty);
            }
        }
    }
    let given_and_lost = c.note_what_is_given(&|identity| types.get(identity).copied());
    if let Some(print_line) = explain.progress {
        print_line(format_args!("aot: progress: the link: {given_and_lost} given types that no task has kept"));
    }
    noted.absorb(noted_on_the_way);
    noted.absorb(c.take_noted());
    let classes_that_are_values = candidates.len();

    times.add("classes", &mut since);

    let is_of_opaque_file: Vec<bool> = classes.iter().map(|class| class.is_some_and(|class| is_opaque(class.0))).collect();
    let mut names = Names::of(&program, &marks, &is_of_opaque_file);
    // A name that the program has no string for is the name of no field.
    for name in stored_besides.into_iter().filter_map(|(fragment, name)| program.strs.find(fragments[fragment as usize].strs.get(name))) {
        names.stored[name.idx()] = true;
    }
    let keys_of_functions: Vec<FuncKey> = included.iter().filter(|_| explain.alterations || explain.throws || explain.throws_json).map(|&(at, _)| fragments[at.fragment as usize].funcs[at.index as usize].key).collect();
    // How the modules of the runtime are compiled does not depend on the program they are linked with: each of their fields has room.
    for (layout, _) in program.layouts.iter().zip(&is_layout_of_runtime).filter(|layout| *layout.1 && layout.0.kind != LayoutKind::Environment) {
        for field in layout.fields.iter().filter(|field| field.name.is_some()) {
            names.stored[field.name.idx()] = true;
        }
    }
    for layout in program.layouts.iter_mut().filter(|layout| layout.kind != LayoutKind::Environment) {
        for field in layout.fields.iter_mut().filter(|field| field.name.is_some() && !names.stored[field.name.idx()]) {
            field.flags |= field_flags::NEVER_STORED;
        }
    }
    const NAMES_OF_A_RUN: usize = 4096;
    let mut runs: Vec<(usize, Vec<Atom>)> = (0..program.strs.len()).step_by(NAMES_OF_A_RUN).map(|first| (first, Vec::new())).collect();
    for_each_mut(&mut runs, in_parallel, &|(first, found)| {
        found.extend((*first..program.strs.len().min(*first + NAMES_OF_A_RUN)).filter(|&name| names.stored[name]).filter_map(|name| checked.files.atoms.lookup(program.strs.get(StrId::new(name)))));
    });
    let stored: FxHashSet<Atom> = runs.into_iter().flat_map(|run| run.1).collect();
    times.add("names", &mut since);

    // A name that the program has no string for is the name of no field.
    let [verdicts, verdicts_of_runtime] = verdicts_on_integers.join().expect("the thread that follows the numbers panicked").map(|verdicts| -> Vec<(StrId, Int32Verdict<StrId>)> {
        verdicts.into_iter().filter_map(|verdict| Some((Some(str_ids[verdict.name.idx()]).filter(|name| name.is_some())?, verdict))).collect()
    });
    for (verdicts, are_of_runtime) in [(&verdicts, false), (&verdicts_of_runtime, true)] {
        let mut is_expected_int32 = vec![false; program.strs.len()];
        for (name, verdict) in verdicts {
            is_expected_int32[name.idx()] = verdict.is_expected_int32();
        }
        for (layout, _) in program.layouts.iter_mut().zip(&is_layout_of_runtime).filter(|layout| *layout.1 == are_of_runtime && layout.0.kind != LayoutKind::Environment) {
            for field in layout.fields.iter_mut().filter(|field| field.name.is_some() && field.flags & field_flags::NEVER_STORED == 0 && is_expected_int32[field.name.idx()]) {
                field.flags |= field_flags::EXPECTED_INT32;
            }
        }
    }
    times.add("integers", &mut since);

    let asked: Vec<TypeId> = views.iter().map(|view| view.1).collect();
    let say = |what: &str| {
        if let Some(print_line) = explain.progress {
            print_line(format_args!("aot: progress: the link: {what}"));
        }
    };
    say("the types of the fields");
    let copied_to: Vec<u32> = marks.is_copied_to.iter().enumerate().filter(|ty| ty.1.load(Ordering::Relaxed)).map(|ty| ty.0 as u32).collect();
    let field_types = crate::field_types::field_types(&program, &views, copied_to);
    let mut has_run_out = false;
    let mut cut_short = Vec::new();
    let mut opened_for_the_log = Vec::new();
    let type_texts = TypeTexts::of(&views);
    let membership = std::thread::scope(|scope| {
    let printers = [(); 2].map(|()| spawn_beside_the_pool(scope, || type_texts.print(checked, &program, shown_from)));
    let mut subtypes = c.begin_subtypes(noted, &asked, field_types, stored, kinds_declared, explain.progress, in_parallel);
    times.add("flows", &mut since);
    for run in 0..6 {
        if run == 1 {
            subtypes = subtypes.begin_again();
        }
        if run >= 2 {
            if !subtypes.logs_type_errors() {
                break;
            }
            if run >= 3 {
                opened_for_the_log.push(subtypes.explain_what_opened_for_the_log());
                if !subtypes.has_opened_too_much_for_the_log() {
                    break;
                }
            }
            use bun_sema::check::OpensForTheLog::{FromOutsideWithinTheBound, Nothing, UntypedWithinTheBound, WhateverComesFromOutside};
            subtypes = subtypes.begin_the_final_run_again([WhateverComesFromOutside, FromOutsideWithinTheBound, UntypedWithinTheBound, Nothing][run - 2]);
        }
        while !subtypes.questions().is_empty() || !subtypes.own_questions().is_empty() {
            let (answers, has_this_run_out) = answers_to(checked, subtypes.questions(), subtypes.stored(), &mut cut_short, in_parallel);
            subtypes.say("the answers of the other checkers");
            c.know_questions_cut_short(&cut_short);
            let own_answers = c.answer(subtypes.own_questions(), subtypes.stored());
            keep_questions_cut_short(&mut cut_short, c.questions_cut_short());
            has_run_out |= has_this_run_out;
            times.add("answers", &mut since);
            subtypes.advance(&answers, &own_answers);
            times.add("flows", &mut since);
        }
    }
    if let Some(table) = subtypes.is_over_budget() {
        problems.push(Problem { file: nowhere, pos: 0, what: format!("a program with so many flows between its types: {table} is over its budget").into() });
    }
    let membership = subtypes.finish();
    times.add("flows", &mut since);
    type_texts.print(checked, &program, shown_from);
    for printer in printers {
        printer.join().expect("a thread that prints types panicked");
    }
    membership
    });
    times.add("type texts", &mut since);
    std::thread::spawn(move || drop((fragments, index, reach, maps, types, seen, included, layout_ids, global_ids)));
    say("the subtypes are found");
    if ran_out_of_stack || has_run_out || c.take_ran_out_of_stack() {
        problems.push(Problem { file: nowhere, pos: 0, what: "types that are nested too deeply".into() });
    }
    let layouts_at = |indexes: &[u32]| -> Vec<LayoutId> { indexes.iter().map(|&index| views[index as usize].0).collect() };
    let strs = &program.strs;
    let mut layouts_left: Vec<Option<&mut Layout>> = program.layouts.iter_mut().map(Some).collect();
    let mut laid: Vec<_> = views.iter().zip(&membership.views).map(|(&(layout, _), reach)| (layouts_left[layout.idx()].take().expect("a layout is of one view"), reach)).collect();
    drop(layouts_left);
    for_each_mut(&mut laid, in_parallel, &|(out, reach)| {
        out.is_allocated = reach.is_allocated;
        out.may_be_frozen = reach.may_be_frozen;
        if reach.may_have_other_prototype && out.kind == LayoutKind::Record {
            out.class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
        }
        out.admits_foreign = reach.admits_foreign;
        out.is_opened_for_the_log = reach.is_opened_for_the_log;
        out.admits_only_other_layouts = reach.admits_only_other_layouts;
        out.members = layouts_at(&reach.members);
        out.members_by_fit = layouts_at(&reach.members_by_fit);
        out.specializations = layouts_at(&reach.specializations);
        let by_name = out.fields_by_name();
        // What is stored under a name in the objects of a view is seen as far as the types go: a prediction.
        for &(name, file, func) in &reach.callees {
            let field = strs.find(checked.files.atoms.bytes(name)).and_then(|name| by_name.get(out, name));
            if let (Some(field), Some(func)) = (field, func_ids.get(FuncKey::Function(file, func))) {
                out.fields[field as usize].only_function = func;
            }
        }
        for &(name, is_at_every_creation) in &reach.set_at_creation {
            if let Some(field) = strs.find(checked.files.atoms.bytes(name)).and_then(|name| by_name.get(out, name)) {
                out.fields[field as usize].flags |= if is_at_every_creation { field_flags::SET_AT_CREATION } else { field_flags::MAY_BE_SET_AT_CREATION };
            }
        }
        for &name in &reach.never_seen_absent {
            if let Some(field) = strs.find(checked.files.atoms.bytes(name)).and_then(|name| by_name.get(out, name))
                && out.fields[field as usize].flags & (field_flags::OPTIONAL | field_flags::NEVER_STORED) == 0
            {
                out.fields[field as usize].flags |= field_flags::NEVER_SEEN_ABSENT;
            }
        }
    });
    // The objects that a constructor function initializes inherit from its `prototype` object. Where the program may replace that or get
    // hold of it, they may inherit from anything.
    for (file, function) in c.functions_with_mutable_prototype() {
        if let Some(func) = func_ids.get(FuncKey::Function(file, function))
            && program.funcs[func.idx()].this_declared.is_some()
            && let Some(view) = program.tys.get(program.funcs[func.idx()].this_declared).only_layout()
        {
            let initialized: Vec<LayoutId> = std::iter::once(view).chain(program.layouts[view.idx()].members.iter().copied()).collect();
            for layout in initialized {
                let out = &mut program.layouts[layout.idx()];
                if out.kind == LayoutKind::Record {
                    out.class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
                }
            }
        }
    }
    // A read that stands in a test position is held to nothing. What a view says of a field is a fact all the same where every object that is
    // looked at through it is one of the program's, with the prototype it was made with, and no other view of such an object takes more for
    // the field: typed code stores through a view what the field of the VIEW takes, `(narrow as Wide).next = wide`.
    let mut views_of: Vec<Vec<LayoutId>> = vec![Vec::new(); program.layouts.len()];
    for (index, view) in program.layouts.iter().enumerate() {
        for member in view.members.iter().filter(|member| member.idx() != index) {
            views_of[member.idx()].push(LayoutId::new(index));
        }
    }
    {
        let Program { funcs, layouts, tys, .. } = &mut program;
        let layouts = &layouts[..];
        let nothing_known = || HeldByFields { is_found: vec![false; layouts.len()], ..Default::default() };
        let views_beside: Vec<OnceLock<Vec<LayoutId>>> = layouts.iter().map(|_| OnceLock::new()).collect();
        let functions_of_a_run = funcs.len().div_ceil(64).max(1);
        let mut runs: Vec<(&mut [Func], &[u8], Vec<usize>)> = funcs.chunks_mut(functions_of_a_run).zip(contents.chunks(functions_of_a_run)).map(|(run, contents)| (run, contents, Vec::new())).collect();
        let numbered: &DeclaredTable = tys;
        for_each_mut(&mut runs, in_parallel, &|(run, contents, left)| {
            let mut known = nothing_known();
            for (index, func) in run.iter_mut().enumerate().filter(|function| contents[function.0] & has::PREDICTIONS_BY_FIELD != 0) {
                if !type_reads_by_what_fields_hold(func, layouts, &mut &*numbered, &views_of, &views_beside, &mut known) {
                    left.push(index);
                }
            }
        });
        let mut known = nothing_known();
        for (run, _, left) in &mut runs {
            for &index in left.iter() {
                type_reads_by_what_fields_hold(&mut run[index], layouts, &mut &mut *tys, &views_of, &views_beside, &mut known);
            }
        }
    }
    times.add("answers", &mut since);
    let fields_by_name = nil::fields_by_the_names_that_are_deleted(&program, &contents, in_parallel);
    let deleted = nil::make_room_for_deletions(&mut program, &contents, &fields_by_name, in_parallel);
    reads::type_by_the_members(&mut program, in_parallel);
    let written: Vec<TyId> = program.funcs.iter().flat_map(|func| func.params.iter().copied()).collect();
    let mut found_while_waiting = None;
    nil::make_room_for_nil(&mut program, &contents, &fields_by_name, in_parallel, &mut |program| found_while_waiting = Some((strangers::find_receivers_of_one_row(program, in_parallel), throws::set_up(program, in_parallel))));
    let ((accesses_of_one_row, mut rows), setup_of_what_always_fails) = found_while_waiting.expect("the link waits once for where the functions get");
    let mut left = &written[..];
    for (index, func) in program.funcs.iter().enumerate() {
        let of_function;
        (of_function, left) = left.split_at(func.params.len());
        if func.params != of_function {
            program.parameters_as_written.insert(index as u32, of_function.to_vec());
        }
    }
    times.add("nil", &mut since);
    say("the subtypes are in the program");
    times.add("members", &mut since);
    let unsound_uses = crate::verify::unsound_uses(&program, 1, in_parallel);
    if let Some(first) = unsound_uses.first() {
        problems.push(Problem { file: nowhere, pos: 0, what: first.what.clone().into() });
    }
    times.add("verify", &mut since);
    say("verified");
    let holds_nothing = |view: &Layout| view.kind == LayoutKind::Record && nil::is_empty_view(view) && !view.is_opened_for_the_log;
    for view in program.layouts.iter_mut().filter(|view| holds_nothing(view)) {
        view.name = StrId::NONE;
        for field in &mut view.fields {
            field.literals.clear();
        }
    }
    let mut fields_without_text: FxHashSet<(LayoutId, u32)> = FxHashSet::default();
    for view in (0..program.layouts.len() as u32).map(LayoutId) {
        let looked_through = &program.layouts[view.idx()];
        if looked_through.kind != LayoutKind::Record || looked_through.is_allocated || looked_through.admits_foreign || looked_through.is_opened_for_the_log || looked_through.members.is_empty() {
            continue;
        }
        for field in 0..looked_through.fields.len() {
            let looked_through = &program.layouts[view.idx()];
            if looked_through.fields[field].literals.is_empty() {
                continue;
            }
            let name = looked_through.fields[field].name;
            let of_members: Option<Vec<&[Literal]>> = (looked_through.members.iter())
                .map(|member| &program.layouts[member.idx()])
                .map(|member| member.field(name).map(|at| &member.fields[at as usize].literals[..]).filter(|literals| !literals.is_empty()))
                .collect();
            let Some(of_members) = of_members else { continue };
            let held: Vec<Literal> = looked_through.fields[field].literals.iter().copied().filter(|literal| of_members.iter().any(|literals| literals.contains(literal))).collect();
            if held.len() != looked_through.fields[field].literals.len() {
                program.layouts[view.idx()].fields[field].literals = held;
                fields_without_text.insert((view, field as u32));
            }
        }
    }
    let TypeTexts { printed, declared, .. } = type_texts;
    for (&(layout, _), of_view) in views.iter().zip(printed.into_iter().flat_map(|slice| slice.into_inner().expect("every slice is printed").fields)) {
        if holds_nothing(&program.layouts[layout.idx()]) {
            continue;
        }
        for (field, hash, text) in of_view.into_iter().filter(|of_field| !fields_without_text.contains(&(layout, of_field.0))) {
            program.layouts[layout.idx()].fields[field as usize].type_text = program.strs.intern_hashed(hash, &text);
        }
    }
    let WhereViewsAreDeclared { shown_paths, path_and_line } = declared.into_inner().expect("where the views are declared is found behind their texts");
    let paths: Vec<StrId> = shown_paths.iter().map(|shown| program.strs.intern(shown)).collect();
    for (&(layout, _), at) in views.iter().zip(path_and_line) {
        let Some((path, line)) = at else { continue };
        let out = &mut program.layouts[layout.idx()];
        if holds_nothing(out) {
            continue;
        }
        (out.declared_path, out.declared_line) = (paths[path as usize], line);
    }
    times.add("type texts", &mut since);
    say("the texts of the types");
    let mut explained = Vec::new();
    if explain.foreign {
        explained.append(&mut c.explain_foreign(&asked, &membership));
    }
    if explain.alterations {
        explained.append(&mut c.explain_alterations(&membership));
        let classes_laid_out = || program.layouts.iter().filter(|layout| layout.kind == LayoutKind::Instance && layout.class_flags & class_flags::IS_LAID_OUT != 0);
        let beside: FxHashMap<FuncId, FuncId> = (keys_of_functions.iter().enumerate())
            .filter_map(|(i, &key)| match key {
                FuncKey::EntryBeside(file, func) => Some((func_ids.get(FuncKey::Function(file, func))?, FuncId::new(entry_points.len() + i))),
                _ => None,
            })
            .collect();
        explained.push(format!("alterations: classes: {} methods of laid-out classes have an entry that hands a stranger to a second body, of {entries_translated} for which one was translated", beside.len()));
        explained.push(format!("alterations: classes: {} of the {} laid-out classes take objects that their constructor has not made", classes_laid_out().filter(|layout| layout.admits_foreign).count(), classes_laid_out().count()));
        let layouts_turned: FxHashSet<LayoutId> = deleted.turned.iter().map(|turned| turned.0).collect();
        explained.push(format!(
            "alterations: deleted through a view: {} places; by the name alone, from any object: {} places; {} required fields of {} layouts may be absent for it, {} of them by the name alone, {} were never seen absent; {} reads may find one absent",
            deleted.places,
            deleted.places_by_name,
            deleted.turned.len(),
            layouts_turned.len(),
            deleted.turned_by_name,
            deleted.never_seen_absent,
            nil::reads_that_may_find_deleted(&program, &deleted)
        ));
        explained.push(format!("alterations: classes: {extended_by_value} of the {classes_that_are_values} laid-out classes that are used as values may be extended by their value"));
        let is_tested: Vec<bool> = program.layouts.iter().map(|view| view.members.iter().any(|member| program.layouts[member.idx()].may_be_frozen)).collect();
        let stores = || program.funcs.iter().flat_map(|func| func.blocks.iter().flat_map(|block| block.ops.iter().map(|v| crate::format::record(&func.values[v.idx()].def)))).filter(|r| r.opcode == crate::format::Opcode::PutField);
        explained.push(format!("alterations: {} of {} stores to fields test the integrity level", stores().filter(|r| is_tested[r.immediates[0] as usize]).count(), stores().count()));
        let records = |is_marked: bool| program.layouts.iter().filter(|layout| layout.is_allocated && layout.kind == LayoutKind::Record && (!is_marked || layout.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0)).count();
        explained.push(format!("alterations: {} of {} allocated records may inherit from anything", records(true), records(false)));
    }
    for (property, key, (file, func)) in c.functions_by_key() {
        let strings = [property, key].map(|atom| program.strs.find(checked.files.atoms.bytes(atom)));
        if let ([Some(property), Some(key)], Some(func)) = (strings, func_ids.get(FuncKey::Function(file, func))) {
            program.functions_by_key.push((property, key, func));
        }
    }
    program.functions_by_key.sort_unstable_by_key(|entry| (entry.0.0, entry.1.0));
    {
        let Program { funcs, functions_by_key, .. } = &mut program;
        let functions_by_key = &*functions_by_key;
        let mut runs: Vec<(&mut [Func], &[u8])> = funcs.chunks_mut(FUNCTIONS_OF_A_SLICE).zip(contents.chunks(FUNCTIONS_OF_A_SLICE)).collect();
        for_each_mut(&mut runs, in_parallel, &|(funcs, contents)| {
            for value in funcs.iter_mut().zip(contents.iter()).filter(|function| function.1 & has::PREDICTIONS_BY_KEY != 0).flat_map(|function| &mut function.0.values) {
                if let Prediction::ByKey(property) = value.prediction
                    && functions_by_key.binary_search_by_key(&property.0, |entry| entry.0.0).is_err()
                {
                    value.prediction = Prediction::None;
                }
            }
        });
    }
    times.add("by key", &mut since);
    if explain.deferred {
        explained.append(&mut c.explain_deferred(&translated));
        explained.append(&mut explain_start(&program, &evaluating));
        explained.append(&mut c.explain_modules(&roots.iter().map(|root| root.file()).collect::<Vec<FileId>>(), &translated));
        explained.append(&mut c.explain_commonjs());
    }
    if explain.fields {
        explained.append(&mut explain_fields(&program, &names));
    }
    if explain.given {
        explained.append(&mut opened_for_the_log);
        explained.append(&mut explain_given(&program));
        let (in_part, by_looks, all) = checked.checker().count_unions_given_in_part();
        explained.push(format!("given: written unions of records that are given in part: {in_part} of {all}; in {by_looks} of them no member was found: one only looks like what is given"));
    }
    if explain.throws || explain.throws_json {
        let mut starts: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
        for (module, &file) in modules.iter().enumerate() {
            starts.insert(module as u32, compute_ecma_line_starts(&checked.files.hir(file).text));
        }
        let line_and_column = |module: u32, pos: u32| {
            let Some(starts) = starts.get(&module) else { return (0, 0) };
            let line = starts.partition_point(|&start| start <= pos).max(1) - 1;
            let text = &checked.files.hir(modules[module as usize]).text;
            let before = &text[(starts[line] as usize).min(text.len())..(pos as usize).min(text.len())];
            (line as u32 + 1, String::from_utf8_lossy(before).encode_utf16().count() as u32 + 1)
        };
        let mut asked: Vec<(FuncId, FileId, hir::FnId)> = (keys_of_functions.iter().enumerate())
            .filter_map(|(i, &key)| match key {
                FuncKey::Function(file, root) => Some((FuncId::new(entry_points.len() + i), file, root)),
                _ => None,
            })
            .filter(|asked| program.funcs[asked.0.idx()].has(func_flags::IS_TYPED))
            .collect();
        asked.sort_unstable_by_key(|asked| asked.0);
        in_parallel(64, &|_| checked.checker().help_find_who_may_be_handed_what_says_nothing());
        let mut asking = checked.checker();
        program.may_be_handed_what_says_nothing = asked.into_iter().filter(|&(func, file, root)| asking.may_be_handed_what_says_nothing(file, root, program.funcs[func.idx()].has(func_flags::IS_VALUE))).map(|asked| asked.0.idx() as u32).collect();
        explained.append(&mut throws::explain(&program, checked.checker().logs_type_errors(), explain.throws_json, explain.throws_all, &line_and_column, in_parallel));
    }
    if explain.integers {
        let mut is_name_of_field = vec![false; program.strs.len()];
        let fields = program.layouts.iter().filter(|layout| layout.kind != LayoutKind::Environment).flat_map(|layout| &layout.fields);
        for field in fields.filter(|field| field.name.is_some() && field.flags & field_flags::NEVER_STORED == 0) {
            is_name_of_field[field.name.idx()] = true;
        }
        let of_fields = verdicts.iter().filter(|verdict| is_name_of_field[verdict.0.idx()]);
        let mut by_text: Vec<Int32Verdict<&[u8]>> = of_fields.map(|&(name, Int32Verdict { is_reached_by_int32, contrary, .. })| Int32Verdict { name: program.strs.get(name), is_reached_by_int32, contrary }).collect();
        by_text.sort_by_key(|verdict| verdict.name);
        explained.push(format!("integers: under {} of the {} names of fields that numbers are seen to get to, they are expected to be int32s", by_text.iter().filter(|verdict| verdict.is_expected_int32()).count(), by_text.len()));
        explained.append(&mut c.explain_int32_fields(&by_text));
    }
    program.marked_values = crate::build::sets_of_strings::sizes_of_sets_of_strings(&program, &contents, in_parallel);
    times.add("collections", &mut since);
    program.accesses_of_one_row = accesses_of_one_row;
    times.add("rows", &mut since);
    strangers::find_first_stores(&mut program, &contents, in_parallel);
    times.add("firsts", &mut since);
    if explain.rows {
        explained.append(&mut rows);
    }
    reuse::mark_releases_of_environments(&mut program, &contents, in_parallel);
    times.add("releases of environments", &mut since);
    let logs_type_errors = checked.checker().logs_type_errors();
    let found = throws::always_fail(&program, setup_of_what_always_fails, in_parallel).iter().map(|site| {
        let span = |module: u32, pos: u32| {
            let file = modules[module as usize];
            let hir = checked.files.hir(file);
            (file, pos, bun_sema::check::spans::token_end(&hir.text, pos as usize, hir.kind == hir::FileKind::Tsx) as u32)
        };
        let (file, start, end) = span(site.module, site.pos);
        let (code, args) = site.message();
        let code = if code == 100013 && logs_type_errors && site.goes_on_when_logged() { 100019 } else { code };
        let (code, args) = match bun_sema::messages::message(code) {
            Some((bun_sema::messages::Category::Error, words)) if checked.files.hir(file).is_js && is_in_try_block_with_catch(checked, file, start) => {
                let mut said = Vec::new();
                bun_sema::messages::format(&mut said, words, &args);
                (100020, vec![said])
            }
            _ => (code, args),
        };
        let related = site.origin.iter().filter(|origin| origin.0 != u32::MAX && origin.1 != 0 && (origin.0, origin.1) != (site.module, site.pos)).map(|(module, pos, what)| {
            let (file, start, end) = span(*module, *pos);
            CompilerDiagnostic { file, start, end, code: 100018, args: vec![what.clone().into_bytes()], related: Vec::new() }
        });
        CompilerDiagnostic { file, start, end, code, args, related: related.collect() }
    }).collect();
    times.add("what always fails", &mut since);
    let members = membership.sizes.line();
    since = Instant::now();
    let func_ids = func_ids.by_program_id;
    std::thread::spawn(move || drop((func_ids, str_ids)));
    drop((membership, names));
    times.add("free", &mut since);
    Linked { program, problems, members, explained, errors, builtin_modules_left_out, builtin_functions_left_out, found, times }
}

#[cfg(test)]
mod tests {
    use super::first_entry_point_evaluating;

    #[test]
    fn files_belong_to_the_first_entry_point_that_evaluates_them() {
        let static_imports = [vec![2], vec![2, 3], vec![4, 0], vec![], vec![], vec![4]];
        let first = first_entry_point_evaluating(6, &[vec![0], vec![1]], &|file| static_imports[file].clone());
        assert_eq!(first, [0, 1, 0, 1, 0, u32::MAX]);
    }
}
