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
use crate::fragment::{Definition, Fragment, FuncKey, Function, GlobalKey, Ids, LayoutKey, Mentioning, Mentions, ModulePart, NO_FILE, Notes, Used, for_each_id_of_func, for_each_id_of_global, for_each_id_of_layout};
use crate::id::{FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{self, Def, Func, FuncKind, Layout, LayoutKind, Literal, NO_VARIABLE, Op, Prediction, Program, STATIC_FIELD_IS_ANNOTATED, Strs, Term, class_flags, field_flags, func_flags, method_flags};
use bun_sema::atom::Atom;
use bun_sema::check::task::Finished;
use bun_sema::check::{Certainty, Checker, Doubt, Identity, Int32Verdict, MethodStore, Noted, NumberFlow, Program as Checked, Question, compute_ecma_line_starts, expected_int32};
use bun_sema::hir::{ClassId, Flags};
use bun_sema::program::{Builtin, FileId};
use bun_sema::resolve::get_relative_path_from_directory;
use bun_sema::types::TypeId;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::collections::VecDeque;
use std::collections::hash_map::Entry;
use std::hash::Hash;
use std::time::{Duration, Instant};

mod disagreement;

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
    pub times: Times,
}

/// What the link says of what it has decided, for whoever asks why.
#[derive(Default, Copy, Clone)]
pub struct Explain {
    /// Why each view that admits objects that are not laid out does: `Checker::explain_foreign`.
    pub foreign: bool,
    /// Which views have members only because a test has been left out, and from where: `Checker::explain_members`.
    pub members: bool,
    /// Which layouts untyped code may get hold of, and which fields hold one function for a fact: `Checker::explain_escapes`.
    pub escapes: bool,
    /// How many layouts a built-in may freeze or give another prototype, and how many stores test for it, in numbers alone: `Checker::explain_alterations`.
    pub alterations: bool,
    /// Which variables of numbers and booleans may be read before anything is stored to them: `Checker::explain_uninitialized`.
    pub uninitialized: bool,
    /// What each function captures, which variables are copied and which activations have an environment, and why: `Checker::explain_captures`.
    pub captures: bool,
    /// Which environments and closures are unreachable once the activation that made them has ended, and what keeps the others: `Checker::explain_escape`.
    pub escape: bool,
    /// Which fields have a name that nothing stores: `explain_fields`.
    pub fields: bool,
    /// In what a fragment and the program differ, and what a class is that nobody defines: `disagreement`.
    pub disagreements: bool,
    /// Under which names of fields the numbers are expected to be int32s, and why not under the others: `Checker::explain_int32_fields`.
    pub integers: bool,
    /// Where a declaration without a body was taken for a prediction: `Checker::explain_predictions`.
    pub predictions: bool,
    /// Which variables and fields that may hold a function have no one function, or none that is a fact, and why: `Checker::explain_callees`.
    pub callees: bool,
    /// Where the soundness closure is and how large its tables are, on stderr as it goes, and `Subtypes::report` at the end.
    pub progress: bool,
    /// Which views data of which origin is held to: `Checker::explain_parsed`.
    pub parsed: bool,
    /// What kinds of values the variables hold, going by what is stored to them alone, in counts: `Checker::explain_kinds`.
    pub kinds: bool,
    /// How much of what the modules do when they are evaluated may be deferred: `Checker::explain_deferred`.
    pub deferred: bool,
    /// The one function that is stored under a constant key: `Checker::explain_functions_by_key`.
    pub keys: bool,
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

#[derive(Copy, Clone)]
struct Found {
    at: At,
    /// Nothing takes its place.
    has_last_word: bool,
}

#[derive(Default)]
struct Index {
    funcs: FxHashMap<FuncKey, Found>,
    layouts: FxHashMap<LayoutKey, Found>,
    globals: FxHashMap<GlobalKey, Found>,
    /// The number of the fragment of each file.
    by_file: FxHashMap<FileId, u32>,
}

/// The first that has the last word, or else the first.
fn prefer<K: Hash + Eq>(known: &mut FxHashMap<K, Found>, key: K, found: Found) {
    match known.entry(key) {
        Entry::Vacant(entry) => {
            entry.insert(found);
        }
        Entry::Occupied(mut entry) => {
            if found.has_last_word && !entry.get().has_last_word {
                entry.insert(found);
            }
        }
    }
}

impl Index {
    /// The fragments are added in program order.
    fn add(&mut self, number: usize, fragment: &Fragment) {
        self.by_file.entry(fragment.file).or_insert(number as u32);
        for (i, function) in fragment.funcs.iter().enumerate().filter(|(_, function)| function.func.is_some()) {
            prefer(&mut self.funcs, function.key, Found { at: At::new(number, i), has_last_word: function.body.is_some() });
        }
        for (i, shape) in fragment.layouts.iter().enumerate() {
            let Some(definition) = &shape.definition else { continue };
            // The accessors of an object literal are listed where the literal is written. Whoever else lays its type out has none.
            let lists_accessors = definition.layout.kind == LayoutKind::Record && !definition.layout.methods.is_empty();
            prefer(&mut self.layouts, shape.key, Found { at: At::new(number, i), has_last_word: lists_accessors || shape.key.file() == Some(fragment.file) });
        }
        for (i, variable) in fragment.globals.iter().enumerate() {
            let has_last_word = variable.key.file() == Some(fragment.file);
            if has_last_word || !self.globals.contains_key(&variable.key) {
                prefer(&mut self.globals, variable.key.clone(), Found { at: At::new(number, i), has_last_word });
            }
        }
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

#[derive(Default)]
struct Reach {
    funcs: FxHashSet<FuncKey>,
    /// Those of `funcs` whose body is reached too. Of the others only what a caller has to know is kept.
    bodies: FxHashSet<FuncKey>,
    /// Those that closures are made of.
    values: FxHashSet<FuncKey>,
    /// The constructors, methods and accessors of the classes that are reached.
    members: FxHashSet<FuncKey>,
    layouts: FxHashSet<LayoutKey>,
    globals: FxHashSet<GlobalKey>,
    /// By variable that nothing has mentioned so far: the parts of the bodies of modules that are reached and that store to it.
    parts_storing: FxHashMap<GlobalKey, Vec<(At, u32)>>,
    /// The parts that run: something else mentions a variable that they store to.
    parts: FxHashSet<(At, u32)>,
    /// Those that code that is reached calls or makes closures of. The others are only members of classes that are reached.
    used_by_code: FxHashSet<FuncKey>,
    /// The classes whose declaration is evaluated by a function that is reached.
    declared: FxHashSet<LayoutKey>,
    /// The classes whose constructor is used by code: there may be objects of them, or somebody may have the class object.
    constructed: FxHashSet<LayoutKey>,
    /// By class: its functions that are reached and cannot run yet. See `release`.
    waiting: FxHashMap<LayoutKey, Vec<At>>,
    /// By fragment and type.
    seen_tys: Vec<Vec<bool>>,
    work: Vec<Work>,
    /// By the name of a built-in: the functions of the prelude that the engine may call in its place. A function that is reached and
    /// calls or reads something by the name, a global too, reaches them.
    prelude: FxHashMap<Vec<u8>, Vec<FuncKey>>,
    /// What is being gone through.
    by: By,
    /// The object types whose layouts are reached and that no fragment defines, with the shape that names each and what mentions it.
    missing: Vec<(Identity, At, By)>,
    /// What else is reached and not defined.
    undefined_funcs: Vec<(FuncKey, By)>,
    undefined_layouts: Vec<(At, By)>,
}

impl Reach {
    /// There are more fragments than before.
    fn grow(&mut self, fragments: &[Fragment]) {
        for fragment in &fragments[self.seen_tys.len()..] {
            self.seen_tys.push(vec![false; fragment.tys.list.len()]);
        }
    }

    /// `by_code`: see `used_by_code`.
    fn key(&mut self, fragments: &[Fragment], index: &Index, key: FuncKey, by_code: bool) {
        let is_new = self.funcs.insert(key);
        let is_newly_used = by_code && self.used_by_code.insert(key);
        if !is_new && !is_newly_used {
            return;
        }
        let Some(&Found { at, .. }) = index.funcs.get(&key) else {
            if is_new {
                self.undefined_funcs.push((key, self.by));
            }
            return;
        };
        let fragment = &fragments[at.fragment as usize];
        let function = &fragment.funcs[at.index as usize];
        if is_new {
            let by = std::mem::replace(&mut self.by, By::Func(at));
            if let Some(func) = &function.func {
                for ty in [func.this_declared, func.result].into_iter().chain(func.captures.iter().copied()).chain(func.params.iter().copied()) {
                    self.ty(fragments, index, at.fragment, ty);
                }
            }
            if let Some(body) = &function.body {
                self.layout(fragments, index, at.fragment, body.class);
            }
            self.by = by;
        }
        let Some(body) = &function.body else { return };
        if body.class.is_none() {
            if is_new {
                self.bodies.insert(key);
                self.work.push(Work::Func(at));
            }
            return;
        }
        let class = fragment.layouts[body.class.idx()].key;
        if is_new {
            self.waiting.entry(class).or_default().push(at);
        }
        if by_code && function.func.as_ref().is_some_and(|func| func.kind == FuncKind::Constructor) {
            self.constructed.insert(class);
        }
        self.release(fragments, class);
    }

    /// A function of a class runs only once the declaration of the class has been evaluated. A method, an accessor or the constructor
    /// that no code uses by itself takes an object of the class or the class object besides, and there is neither unless code uses
    /// the constructor. Those of the functions that wait and that can run by now are gone through.
    fn release(&mut self, fragments: &[Fragment], class: LayoutKey) {
        if !self.declared.contains(&class) {
            return;
        }
        let Some(waiting) = self.waiting.get_mut(&class) else { return };
        let is_constructed = self.constructed.contains(&class);
        let key_at = |at: At| fragments[at.fragment as usize].funcs[at.index as usize].key;
        let (ready, still): (Vec<At>, Vec<At>) = waiting.iter().partition(|&&at| is_constructed || self.used_by_code.contains(&key_at(at)));
        *waiting = still;
        for at in ready {
            self.bodies.insert(key_at(at));
            self.work.push(Work::Func(at));
        }
    }

    fn func(&mut self, fragments: &[Fragment], index: &Index, from: u32, func: FuncId, by_code: bool) -> FuncKey {
        let key = fragments[from as usize].funcs[func.idx()].key;
        self.key(fragments, index, key, by_code);
        key
    }

    fn layout(&mut self, fragments: &[Fragment], index: &Index, from: u32, layout: LayoutId) {
        if layout.is_none() {
            return;
        }
        let key = fragments[from as usize].layouts[layout.idx()].key;
        if !self.layouts.insert(key) {
            return;
        }
        match (index.layouts.get(&key), key) {
            (Some(found), _) => self.work.push(Work::Layout(found.at)),
            (None, LayoutKey::Record(identity)) => self.missing.push((identity, At::new(from as usize, layout.idx()), self.by)),
            (None, _) => self.undefined_layouts.push((At::new(from as usize, layout.idx()), self.by)),
        }
    }

    fn ty(&mut self, fragments: &[Fragment], index: &Index, from: u32, ty: TyId) {
        if ty.is_none() || std::mem::replace(&mut self.seen_tys[from as usize][ty.idx()], true) {
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
        let key = &fragments[from as usize].globals[global.idx()].key;
        if self.globals.contains(key) {
            return;
        }
        self.globals.insert(key.clone());
        for part in self.parts_storing.remove(key).unwrap_or_default() {
            if self.parts.insert(part) {
                self.work.push(Work::Part(part.0, part.1));
            }
        }
        // Every fragment that mentions it is in the index with it.
        let at = index.globals[key].at;
        let declared = fragments[at.fragment as usize].globals[at.index as usize].global.declared;
        self.ty(fragments, index, at.fragment, declared);
    }

    fn mention(&mut self, fragments: &[Fragment], index: &Index, from: u32, mentions: &Mentions, is_layout: bool) {
        for &ty in &mentions.tys {
            self.ty(fragments, index, from, ty);
        }
        for &layout in &mentions.layouts {
            self.layout(fragments, index, from, layout);
        }
        for &global in &mentions.globals {
            self.global(fragments, index, from, global);
        }
        for &func in &mentions.called {
            let key = self.func(fragments, index, from, func, !is_layout);
            if is_layout {
                self.members.insert(key);
            }
        }
        for &func in &mentions.values {
            let key = self.func(fragments, index, from, func, true);
            self.values.insert(key);
        }
    }

    /// Until nothing is left to do but to describe what is `missing`.
    fn run(&mut self, fragments: &[Fragment], index: &Index) {
        while let Some(work) = self.work.pop() {
            match work {
                Work::Func(at) => {
                    self.by = By::Func(at);
                    let fragment = &fragments[at.fragment as usize];
                    let Some(body) = &fragment.funcs[at.index as usize].body else { continue };
                    self.mention(fragments, index, at.fragment, &body.mentions, false);
                    for (number, part) in body.parts.iter().enumerate() {
                        let number = number as u32;
                        let stored = part.stores.iter().map(|global| &fragment.globals[global.idx()].key);
                        if stored.clone().any(|key| self.globals.contains(key)) {
                            self.parts.insert((at, number));
                            self.work.push(Work::Part(at, number));
                        } else {
                            stored.for_each(|key| self.parts_storing.entry(key.clone()).or_default().push((at, number)));
                        }
                    }
                    if !self.prelude.is_empty()
                        && let Some(func) = &fragment.funcs[at.index as usize].func
                    {
                        let named = func.values.iter().filter_map(|value| match &value.def {
                            Def::Op(Op::CallMethod { name, .. } | Op::PropGet { name, .. } | Op::FreeGet { name, .. }) => self.prelude.get(fragment.strs.get(*name)),
                            _ => None,
                        });
                        let bound: Vec<FuncKey> = named.flatten().copied().collect();
                        for key in bound {
                            self.key(fragments, index, key, true);
                        }
                    }
                    for &class in &body.classes_as_values {
                        self.layout(fragments, index, at.fragment, class);
                    }
                    // A class that is declared and that nothing mentions is no part of the program.
                    for &class in &body.declares {
                        let class = fragment.layouts[class.idx()].key;
                        if self.declared.insert(class) {
                            self.release(fragments, class);
                        }
                    }
                }
                Work::Part(at, number) => {
                    self.by = By::Func(at);
                    let Some(body) = &fragments[at.fragment as usize].funcs[at.index as usize].body else { continue };
                    self.mention(fragments, index, at.fragment, &body.parts[number as usize].mentions, false);
                }
                Work::Layout(at) => {
                    self.by = By::Layout(at);
                    let Some(definition) = &fragments[at.fragment as usize].layouts[at.index as usize].definition else { continue };
                    self.mention(fragments, index, at.fragment, &definition.mentions, true);
                    self.layout(fragments, index, at.fragment, definition.constructs);
                }
            }
        }
    }
}

/// Takes the part out of the function. Those behind it have been seen to.
fn take_out(func: &mut Func, part: &ModulePart, anything: TyId) {
    for v in part.values(func) {
        func.values[v.idx()] = ir::Value { def: Def::Op(Op::Undefined), pos: 0, ty: anything, prediction: Prediction::None };
    }
    let ((from, start), (to, end)) = (part.from, part.to);
    if from == to {
        func.blocks[from.idx()].ops.drain(start as usize..end as usize);
        return;
    }
    func.blocks[from.idx()].ops.truncate(start as usize);
    func.blocks[from.idx()].term = Some(Term::Jump(ir::Target::new(to)));
    func.blocks[to.idx()].ops.drain(..end as usize);
    for block in (part.blocks.0..part.blocks.1).filter(|&block| block != to.0) {
        func.blocks[block as usize] = ir::Block { params: Vec::new(), ops: Vec::new(), term: Some(Term::Unreachable) };
    }
}

/// What is left of the body of a module is a function like any other.
fn take_out_parts_that_do_not_run(fragments: &mut [Fragment], reach: &Reach) {
    for (number, fragment) in fragments.iter_mut().enumerate() {
        let (anything, mut mentioning) = (fragment.tys.anything, Mentioning::default());
        for (index, function) in fragment.funcs.iter_mut().enumerate() {
            let (Some(func), Some(body)) = (&mut function.func, &mut function.body) else { continue };
            if body.parts.is_empty() {
                continue;
            }
            for (part_number, part) in std::mem::take(&mut body.parts).iter().enumerate().rev() {
                if !reach.parts.contains(&(At::new(number, index), part_number as u32)) {
                    take_out(func, part, anything);
                }
            }
            body.mentions = mentioning.of_func(func);
        }
    }
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
    tys: DeclaredTable,
    /// By number: where the definition is.
    layouts: Vec<At>,
    globals: Vec<At>,
    /// By number: the file and its name.
    modules: Vec<(FileId, StrId)>,
    func_ids: FxHashMap<FuncKey, FuncId>,
    layout_ids: FxHashMap<LayoutKey, LayoutId>,
    global_ids: FxHashMap<GlobalKey, GlobalId>,
    module_ids: FxHashMap<FileId, ModuleId>,
    /// What has its number and whose definition has not been gone through.
    pending: VecDeque<Pending>,
}

impl<'a> Numbering<'a> {
    fn new(fragments: &'a [Fragment], index: &'a Index, func_ids: FxHashMap<FuncKey, FuncId>) -> Numbering<'a> {
        let maps = (fragments.iter())
            .map(|fragment| Maps {
                strs: vec![StrId::NONE; fragment.strs.len()],
                tys: vec![TyId::NONE; fragment.tys.list.len()],
                layouts: vec![LayoutId::NONE; fragment.layouts.len()],
                globals: vec![GlobalId::NONE; fragment.globals.len()],
                modules: vec![ModuleId::NONE; fragment.modules.len()],
                funcs: fragment.funcs.iter().map(|function| func_ids.get(&function.key).copied().unwrap_or(FuncId::NONE)).collect(),
                uses_func: vec![false; fragment.funcs.len()],
            })
            .collect();
        Numbering {
            fragments,
            index,
            maps,
            strs: Strs::default(),
            tys: DeclaredTable::default(),
            layouts: Vec::new(),
            globals: Vec::new(),
            modules: Vec::new(),
            func_ids,
            layout_ids: FxHashMap::default(),
            global_ids: FxHashMap::default(),
            module_ids: FxHashMap::default(),
            pending: VecDeque::new(),
        }
    }

    fn str(&mut self, from: u32, local: StrId) -> StrId {
        if local.is_none() {
            return local;
        }
        let known = self.maps[from as usize].strs[local.idx()];
        if known.is_some() {
            return known;
        }
        let id = self.strs.intern(self.fragments[from as usize].strs.get(local));
        self.maps[from as usize].strs[local.idx()] = id;
        id
    }

    /// Orders the parts of a type by what they are, not by the numbers of the fragment.
    fn rank_of_part(&self, from: u32, part: &Part) -> Vec<u64> {
        let fragment = &self.fragments[from as usize];
        let mut rank = Vec::new();
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

    fn add_rank_of_ty(&self, from: u32, ty: TyId, rank: &mut Vec<u64>) {
        if ty.is_none() {
            return rank.push(u64::MAX);
        }
        let Declared { prims, ints, parts, any_object, any_function } = self.fragments[from as usize].tys.get(ty);
        let (least, most) = ints.unwrap_or((0, 0));
        rank.extend([u64::from(*prims), u64::from(*any_object) | u64::from(*any_function) << 1 | u64::from(ints.is_some()) << 2, least as u64, most as u64, parts.len() as u64]);
        let mut of_parts: Vec<Vec<u64>> = parts.iter().map(|part| self.rank_of_part(from, part)).collect();
        of_parts.sort_unstable();
        rank.extend(of_parts.into_iter().flatten());
    }

    /// A description only mentions descriptions that were there before it, so this ends.
    fn ty(&mut self, from: u32, local: TyId) -> TyId {
        if local.is_none() {
            return local;
        }
        let known = self.maps[from as usize].tys[local.idx()];
        if known.is_some() {
            return known;
        }
        let fragments = self.fragments;
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
        self.maps[from as usize].tys[local.idx()] = id;
        id
    }

    fn layout(&mut self, from: u32, local: LayoutId) -> LayoutId {
        if local.is_none() {
            return local;
        }
        let known = self.maps[from as usize].layouts[local.idx()];
        if known.is_some() {
            return known;
        }
        let fragments = self.fragments;
        let key = fragments[from as usize].layouts[local.idx()].key;
        let numbered = self.layout_ids.get(&key).copied();
        let id = match (numbered, self.index.layouts.get(&key).map(|found| found.at)) {
            (Some(id), _) => id,
            (None, Some(at)) => {
                // What a class extends has the smaller number: the engine makes the classes in the order of their numbers.
                if let Some(definition) = &fragments[at.fragment as usize].layouts[at.index as usize].definition {
                    self.layout(at.fragment, definition.layout.base);
                }
                let id = LayoutId::new(self.layouts.len());
                self.layouts.push(at);
                self.layout_ids.insert(key, id);
                self.pending.push_back(Pending::Layout(id));
                id
            }
            // A problem has been reported.
            (None, None) => LayoutId::NONE,
        };
        self.maps[from as usize].layouts[local.idx()] = id;
        id
    }

    fn global(&mut self, from: u32, local: GlobalId) -> GlobalId {
        let known = self.maps[from as usize].globals[local.idx()];
        if known.is_some() {
            return known;
        }
        let fragments = self.fragments;
        let key = &fragments[from as usize].globals[local.idx()].key;
        let id = match self.global_ids.get(key).copied() {
            Some(id) => id,
            None => {
                let id = GlobalId::new(self.globals.len());
                // What belongs to no file is as the first that mentions it has it.
                self.globals.push(if key.file().is_some() { self.index.globals[key].at } else { At::new(from as usize, local.idx()) });
                self.global_ids.insert(key.clone(), id);
                self.pending.push_back(Pending::Global(id));
                id
            }
        };
        self.maps[from as usize].globals[local.idx()] = id;
        id
    }

    fn module_of(&mut self, file: FileId) -> ModuleId {
        if let Some(&known) = self.module_ids.get(&file) {
            return known;
        }
        let path = match self.index.by_file.get(&file) {
            Some(&fragment) => self.str(fragment, self.fragments[fragment as usize].path),
            None => StrId::NONE,
        };
        let id = ModuleId::new(self.modules.len());
        self.modules.push((file, path));
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
        for &text in &mentions.strs {
            self.str(from, text);
        }
        for &ty in &mentions.tys {
            self.ty(from, ty);
        }
        for &layout in &mentions.layouts {
            self.layout(from, layout);
        }
        for &global in &mentions.globals {
            self.global(from, global);
        }
        for func in mentions.called.iter().chain(&mentions.values) {
            self.maps[from as usize].uses_func[func.idx()] = true;
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

    fn or_anything(&self, ty: TyId) -> TyId {
        if ty.is_none() { self.tys.anything } else { ty }
    }

    /// A function that nothing calls: it is of a class whose declaration nothing evaluates, or no fragment has its body. It takes what
    /// a caller would hand it. In the numbering of the program.
    fn stub(&mut self, from: u32, func: &Func) -> Func {
        let mut stub = Func {
            name: self.str(from, func.name),
            module: self.module(from, func.module),
            pos: func.pos,
            kind: func.kind,
            flags: func.flags & !COROUTINE,
            length: func.length,
            captures: func.captures.iter().map(|&capture| self.ty(from, capture)).collect(),
            this_declared: self.ty(from, func.this_declared),
            params: func.params.iter().map(|&param| self.ty(from, param)).collect(),
            annotated: func.annotated.clone(),
            result: self.ty(from, func.result),
            blocks: Vec::new(),
            values: Vec::new(),
        };
        let entry = stub.add_block();
        for capture in stub.captures.clone() {
            stub.add_param(entry, self.or_anything(capture));
        }
        if stub.has(func_flags::HAS_THIS) {
            stub.add_param(entry, self.or_anything(stub.this_declared));
        }
        for param in stub.params.clone() {
            stub.add_param(entry, self.or_anything(param));
        }
        stub.blocks[entry.idx()].term = Some(Term::Unreachable);
        stub
    }
}

const COROUTINE: u16 = func_flags::ASYNC | func_flags::GENERATOR | func_flags::STARTS_EAGERLY;

const IS_KNOWN: &str = "the index has no function that is only named";

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
fn entry_function(name: StrId, anything: TyId, roots: &[FuncId]) -> Func {
    let mut func = Func {
        name,
        module: ModuleId::NONE,
        pos: 0,
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
    };
    let entry = func.add_block();
    for &root in roots {
        func.append(entry, Op::CallDirect { func: root, args: ir::Args::new() }, 0, anything);
    }
    func.blocks[entry.idx()].term = Some(Term::Return(V::NONE));
    func
}

// ───────────────────────────── whether the fragments agree ─────────────────────────────

/// The program, for looking up what a fragment has.
struct Final<'a> {
    program: &'a Program,
    tys: FxHashMap<&'a Declared, TyId>,
    funcs: &'a FxHashMap<FuncKey, FuncId>,
    layouts: &'a FxHashMap<LayoutKey, LayoutId>,
    globals: &'a FxHashMap<GlobalKey, GlobalId>,
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
        if local.is_none() { Some(local) } else { self.all.layouts.get(&self.fragment.layouts[local.idx()].key).copied() }
    }

    fn func(&self, local: FuncId) -> Option<FuncId> {
        if local.is_none() { Some(local) } else { self.all.funcs.get(&self.fragment.funcs[local.idx()].key).copied() }
    }

    /// A variable of a class, see `Layout::environment`. `flags`: the bits that are no part of the number.
    fn variable(&self, local: u32, flags: u32, is_module_variable: bool) -> Option<u32> {
        if !is_module_variable || local == NO_VARIABLE {
            return Some(local);
        }
        let global = self.all.globals.get(&self.fragment.globals[(local & !flags) as usize].key)?;
        Some(global.0 | local & flags)
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
        let known_later = func_flags::IS_VALUE | func_flags::IS_TYPED | func_flags::IS_OF_BUILTIN_MODULE | if all.is_stub[id.idx()] { COROUTINE } else { 0 };
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
                || self.variable(method.key, 0, has_module_variables) != Some(same.key)
            {
                return false;
            }
        }
        (local.static_fields.iter().zip(&out.static_fields))
            .all(|(field, same)| self.str(field.0) == Some(same.0) && self.variable(field.1, STATIC_FIELD_IS_ANNOTATED, has_module_variables) == Some(same.1))
    }
}

/// What code of the fragment that is reached relies on, and that is not so. With `kept`, each with what `disagreement` says of it.
/// `number`: that of the fragment.
fn disagreements(number: usize, fragment: &Fragment, maps: &Maps, all: &Final<'_>, nowhere: FileId, kept: Option<&disagreement::Kept<'_>>) -> Vec<(Problem, Vec<String>)> {
    let mut finder = Finder { fragment, all, tys: vec![None; fragment.tys.list.len()] };
    let file = if fragment.file == NO_FILE { nowhere } else { fragment.file };
    let mut problems = Vec::new();
    for (i, function) in fragment.funcs.iter().enumerate() {
        if let Some(func) = &function.func
            && maps.uses_func[i]
            && maps.funcs[i].is_some()
            && !finder.is_func(func, maps.funcs[i])
        {
            let why = kept.map_or_else(Vec::new, |kept| disagreement::of_func(&mut finder, kept, number, function, func, maps.funcs[i]));
            problems.push((Problem { file, pos: 0, what: format!("the function `{}` ({:?}), which is not what this file takes it for", text_of(&fragment.strs, func.name), function.key).into() }, why));
        }
    }
    for (shape, &id) in fragment.layouts.iter().zip(&maps.layouts) {
        if let Some(definition) = &shape.definition
            && id.is_some()
            && !finder.is_layout(&definition.layout, id)
        {
            let why = kept.map_or_else(Vec::new, |kept| disagreement::of_layout(&mut finder, kept, number, shape, &definition.layout, id));
            problems.push((Problem { file, pos: 0, what: format!("the layout `{}` ({:x?}), which is not what this file takes it for", text_of(&fragment.strs, shape.name), shape.key).into() }, why));
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
            let why = kept.map_or_else(Vec::new, |kept| disagreement::of_variable(&mut finder, kept, number, variable, id));
            problems.push((Problem { file, pos: 0, what: format!("the variable `{}` ({:?}), which is not what this file takes it for", text_of(&fragment.strs, variable.global.name), variable.key).into() }, why));
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
    for (&ty, &identity) in kept.iter().zip(slices.iter().flat_map(|slice| &slice.1)) {
        types.entry(identity).or_insert(ty);
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
    in_parallel: InParallel<'_>,
    describe: Describe<'_>,
    (times, since): (&mut Times, &mut Instant),
) -> (Vec<Fragment>, bool) {
    let (mut described, mut ran_out_of_stack) = (Vec::new(), false);
    let asked: FxHashSet<Identity> = missing.iter().map(|&(identity, _)| identity).collect();
    let is_defined = |identity: Identity| asked.contains(&identity) || index.layouts.contains_key(&LayoutKey::Record(identity));
    let mut slices: Vec<Vec<TypeId>> = missing.chunks(LAYOUTS_OF_A_TASK).map(|slice| slice.iter().map(|&(_, ty)| ty).collect()).collect();
    while !slices.is_empty() {
        let mut tasks: Vec<(usize, Option<(Fragment, bool, Finished<'s>)>)> = (0..slices.len()).map(|index| (index, None)).collect();
        for_each_mut(&mut tasks, in_parallel, &|(index, outcome)| {
            let mut c = program.checker();
            c.begin_stack_budget();
            c.begin_task(STEP_OF_THE_LINK, *index as u32, true);
            c.withhold_tables_of_expressions();
            let fragment = describe(&mut c, &slices[*index], &is_defined);
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
        let is_invalid = program.validate(&finished);
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

/// How many questions a checker is made for. A checker finds again what another has found, so few are better than many. The number
/// does not show in the answers.
const QUESTIONS_OF_A_CHECKER: usize = 4096;

/// `Checker::answer`, shared out, and whether the stack has run out for one of the checkers.
fn answers_to(program: &Checked<'_>, questions: &[Question], stored: &FxHashSet<Atom>, in_parallel: InParallel<'_>) -> (Vec<bool>, bool) {
    let mut slices: Vec<(&[Question], Vec<bool>, bool)> = questions.chunks(QUESTIONS_OF_A_CHECKER).map(|slice| (slice, Vec::new(), false)).collect();
    for_each_mut(&mut slices, in_parallel, &|(slice, answers, ran_out_of_stack)| {
        let mut c = program.checker();
        c.begin_stack_budget();
        *answers = c.answer(slice, stored);
        *ran_out_of_stack = c.take_ran_out_of_stack();
    });
    let ran_out_of_stack = slices.iter().any(|slice| slice.2);
    (slices.into_iter().flat_map(|slice| slice.1).collect(), ran_out_of_stack)
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
fn constant_string(func: &Func, mut value: V) -> Option<StrId> {
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

impl Names {
    /// Every function of the program with a body is reached. `is_of_opaque_file`: by layout, see `Module::is_opaque`.
    fn of(program: &Program, is_of_opaque_file: &[bool], in_parallel: InParallel<'_>) -> Names {
        let mut slices: Vec<(&[Func], Vec<StrId>, Vec<StrId>)> = program.funcs.chunks(FUNCTIONS_OF_A_SLICE).map(|slice| (slice, Vec::new(), Vec::new())).collect();
        for_each_mut(&mut slices, in_parallel, &|(slice, stored, read)| {
            for func in slice.iter().filter(|func| !func.has(func_flags::IS_OF_BUILTIN_MODULE) || func.has(func_flags::IS_TYPED)) {
                add_names_in(func, &program.layouts, stored, read);
            }
            for found in [stored, read] {
                found.sort_unstable();
                found.dedup();
            }
        });
        let mut names = Names { stored: vec![false; program.strs.len()], read: vec![false; program.strs.len()] };
        for (_, stored, read) in &slices {
            for name in stored.iter().filter(|name| name.is_some()) {
                names.stored[name.idx()] = true;
            }
            for name in read.iter().filter(|name| name.is_some()) {
                names.read[name.idx()] = true;
            }
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

/// A static field that the class object shows as a property: whoever has got hold of the class object stores to that by name, which no
/// operation on the variable shows. Of such a variable, in an environment or of a module, there is no fact about what it holds.
fn drop_facts_about_static_fields(program: &mut Program) {
    let shown: Vec<(LayoutId, u32)> = (program.layouts.iter())
        .flat_map(|class| class.static_fields.iter().map(|field| (class.environment, field.1)))
        .filter(|&(_, variable)| variable != NO_VARIABLE)
        .map(|(environment, variable)| (environment, variable & !STATIC_FIELD_IS_ANNOTATED))
        .collect();
    for (environment, variable) in shown {
        if environment.is_some() {
            program.layouts[environment.idx()].fields[variable as usize].only_function_flags = 0;
        } else {
            program.globals[variable as usize].only_function_flags = 0;
        }
    }
}

/// How many of the layouts that objects are made as have a field of each name that is flagged, the most first. Then those layouts, each
/// with the fields that are flagged, those with the most first. Then what else goes by the names and is not acted on.
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
fn type_texts(checked: &Checked<'_>, program: &Program, views: &[(LayoutId, TypeId)], in_parallel: InParallel<'_>) -> Vec<Vec<(u32, Vec<u8>)>> {
    let mut slices: Vec<(&[(LayoutId, TypeId)], Vec<Vec<(u32, Vec<u8>)>>)> = views.chunks(VIEWS_OF_A_CHECKER).map(|slice| (slice, Vec::new())).collect();
    for_each_mut(&mut slices, in_parallel, &|(slice, texts)| {
        let mut c = checked.checker();
        c.begin_stack_budget();
        let mut printed: FxHashMap<TypeId, Vec<u8>> = FxHashMap::default();
        for &(layout, view) in slice.iter() {
            let mut of_view = Vec::new();
            let Some(members) = c.members(view) else {
                texts.push(of_view);
                continue;
            };
            for prop in members.shape().props.iter() {
                let name = c.atoms().bytes(prop.name);
                let Some(field) = program.strs.find(name).filter(|_| !name.starts_with(&[0xFE])).and_then(|name| program.layouts[layout.idx()].field(name)) else { continue };
                let ty = c.type_of_prop(prop, members.mapper);
                if let Some(text) = printed.get(&ty) {
                    of_view.push((field, text.clone()));
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
                printed.insert(ty, text.clone());
                of_view.push((field, text));
            }
            for &(name, declaring) in c.undeclared_fields_of(view).iter() {
                let Some(field) = program.strs.find(c.atoms().bytes(name)).and_then(|name| program.layouts[layout.idx()].field(name)) else { continue };
                let Some(declared_by) = c.members(declaring) else { continue };
                let Some(prop) = declared_by.shape().props.iter().find(|prop| prop.name == name) else { continue };
                let ty = c.type_of_prop(prop, declared_by.mapper);
                let text = c.type_to_string(ty);
                if !c.take_ran_out_of_stack() && text.len() <= LONGEST_TYPE_TEXT {
                    of_view.push((field, text));
                }
            }
            texts.push(of_view);
        }
    });
    slices.into_iter().flat_map(|slice| slice.1).collect()
}

// ───────────────────────────── the link ─────────────────────────────

/// Where the checker has found errors, and `build::files_imported_by`.
pub struct Errors<'a> {
    pub places: &'a [(FileId, u32)],
    pub imported_by: &'a mut dyn FnMut(FileId) -> Vec<FileId>,
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
}

/// The files that are no modules of the program and that a module of the program imports, straight away or through others of them: for
/// their types, which say what the code of the program is.
fn files_imported_for_types(fragments: &[Fragment], reach: &Reach, imported_by: &mut dyn FnMut(FileId) -> Vec<FileId>) -> FxHashSet<FileId> {
    let is_module = |file: FileId| reach.bodies.contains(&FuncKey::Module(file));
    let mut pending: Vec<FileId> = fragments.iter().map(|fragment| fragment.file).filter(|&file| file != NO_FILE && is_module(file)).collect();
    let mut found = FxHashSet::default();
    while let Some(file) = pending.pop() {
        for imported in imported_by(file) {
            if !is_module(imported) && found.insert(imported) {
                pending.push(imported);
            }
        }
    }
    found
}

/// `None`: the position lies in code of the file that is in the program. It is code of the innermost function around it that the
/// fragment of the file defines, or else of the body of the module. A function in code that is cut is not defined.
/// `is_imported_for_types`: see `files_imported_for_types`. What such a file has outside of functions counts as what it declares.
fn place_of_error(fragments: &[Fragment], index: &Index, reach: &Reach, (file, pos): (FileId, u32), is_imported_for_types: &mut dyn FnMut(FileId) -> bool) -> Option<Elsewhere> {
    let Some(&number) = index.by_file.get(&file) else { return (!is_imported_for_types(file)).then_some(Elsewhere::NoModule) };
    let fragment = &fragments[number as usize];
    let holds = |&&(start, end): &&(u32, u32)| start <= pos && pos < end;
    let bodies = fragment.funcs.iter().filter(|function| function.key.file() == file).filter_map(|function| Some((function, function.body.as_ref()?)));
    let around = bodies.clone().flat_map(|(function, body)| body.spans.iter().filter(holds).map(move |span| (span.1 - span.0, function, body)));
    let name_of = |function: &Function| function.func.as_ref().map_or_else(String::new, |func| text_of(&fragment.strs, func.name));
    if let Some((_, function, body)) = around.min_by_key(|&(length, ..)| length) {
        if !reach.bodies.contains(&function.key) {
            return Some(Elsewhere::NotReached(name_of(function)));
        }
        return body.cut.iter().find(holds).map(|cut| Elsewhere::Cut(cut.0));
    }
    let of_module = bodies.filter(|(function, _)| matches!(function.key, FuncKey::Module(_) | FuncKey::ModuleBody(_)));
    if !reach.bodies.contains(&FuncKey::Module(file)) {
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
    None
}

/// `fragments`: one for each file that has been translated, in any order. `roots`: the files that the program starts with.
/// `builtin_modules`: the modules of the runtime that are compiled with it, by id. The registry runs them: nothing of the program does.
/// `prelude`: the files of `crate::prelude`. `shown_from`: `Constants::root`.
pub fn link(
    checked: &Checked<'_>,
    mut fragments: Vec<Fragment>,
    roots: &[FileId],
    entry_points: &[Vec<FileId>],
    builtin_modules: &[(u32, FileId)],
    prelude: &[FileId],
    shown_from: &[u8],
    errors: Errors<'_>,
    in_parallel: InParallel<'_>,
    explain: Explain,
    describe: Describe<'_>,
) -> Linked {
    fragments.sort_by_key(|fragment| checked.files.rank_of_file(fragment.file));
    let translated: Vec<FileId> = fragments.iter().map(|fragment| fragment.file).filter(|&file| file != NO_FILE).collect();
    let is_opaque = |file: FileId| file != NO_FILE && checked.files.module(file).is_opaque();
    let is_of_runtime = |file: FileId| file != NO_FILE && checked.files.module(file).builtin.is_some();
    // For a problem that is in no file.
    let nowhere = roots.first().copied().unwrap_or(FileId(0));
    let mut problems: Vec<Problem> = Vec::new();
    let (mut times, mut since) = (Times::default(), Instant::now());
    let (mut types, mut seen, mut ran_out_of_stack) = (FxHashMap::default(), FxHashSet::default(), false);
    add_kept_types(checked, &mut seen, &mut types, in_parallel);
    times.add("kept types", &mut since);

    let mut index = Index::default();
    for (number, fragment) in fragments.iter().enumerate() {
        index.add(number, fragment);
    }

    let mut reach = Reach::default();
    reach.grow(&fragments);
    for &(method, name) in crate::prelude::FUNCTIONS {
        let defined = fragments.iter().filter(|fragment| prelude.contains(&fragment.file)).flat_map(|fragment| fragment.funcs.iter().map(move |function| (fragment, function)));
        let is_named = |fragment: &Fragment, function: &Function| function.func.as_ref().is_some_and(|func| func.name.is_some() && fragment.strs.get(func.name) == name.as_bytes());
        if let Some((_, function)) = defined.filter(|(_, function)| function.body.is_some()).find(|(fragment, function)| is_named(fragment, function)) {
            reach.prelude.entry(method.as_bytes().to_vec()).or_default().push(function.key);
        }
    }
    // A file that only declares has no code to start with.
    let roots: Vec<FuncKey> = roots.iter().map(|&root| FuncKey::Module(root)).filter(|root| index.funcs.contains_key(root)).collect();
    for &root in &roots {
        reach.key(&fragments, &index, root, true);
    }
    // No code outside a module of the runtime names a function of it, so one that cannot be translated is left out by itself.
    let mut builtin_modules_left_out: Vec<(u32, Problem)> = Vec::new();
    let mut builtin_functions_left_out: Vec<(u32, Problem)> = Vec::new();
    let mut builtin_roots: Vec<(u32, FuncKey)> = Vec::new();
    let number_of: FxHashMap<FileId, usize> = fragments.iter().enumerate().map(|(number, fragment)| (fragment.file, number)).collect();
    for &(id, file) in builtin_modules.iter().filter(|module| index.funcs.contains_key(&FuncKey::Module(module.1))) {
        let fragment = &fragments[number_of[&file]];
        let of_bodies = fragment.funcs.iter().filter_map(|function| function.body.as_ref()).flat_map(|body| &body.problems);
        let of_layouts = fragment.layouts.iter().filter_map(|shape| shape.definition.as_ref()).flat_map(|definition| &definition.problems);
        match of_bodies.chain(of_layouts).min_by_key(|problem| problem.pos) {
            Some(&Problem { file, pos, ref what }) => builtin_modules_left_out.push((id, Problem { file, pos, what: what.clone() })),
            None => {
                builtin_roots.push((id, FuncKey::Module(file)));
                reach.key(&fragments, &index, FuncKey::Module(file), true);
            }
        }
    }
    // Native code asks for a builtin function by its number, whatever the program does. A file that cannot be translated is left out whole.
    let mut builtin_functions: Vec<(u32, FuncKey, u32)> = Vec::new();
    for fragment in fragments.iter().filter(|fragment| !fragment.builtin_functions.is_empty()) {
        let of_bodies = fragment.funcs.iter().filter_map(|function| function.body.as_ref()).flat_map(|body| &body.problems);
        match of_bodies.min_by_key(|problem| problem.pos) {
            Some(&Problem { file, pos, ref what }) => builtin_functions_left_out.extend(fragment.builtin_functions.iter().map(|function| (function.0, Problem { file, pos, what: what.clone() }))),
            None => builtin_functions.extend(fragment.builtin_functions.iter().filter(|function| index.funcs.contains_key(&function.1))),
        }
    }
    builtin_functions.sort_unstable_by_key(|function| function.0);
    for function in &builtin_functions {
        reach.key(&fragments, &index, function.1, true);
    }
    loop {
        reach.run(&fragments, &index);
        let named = std::mem::take(&mut reach.missing);
        let mut missing: Vec<(Identity, TypeId)> = Vec::with_capacity(named.len());
        for &(identity, at, by) in &named {
            match types.get(&identity) {
                Some(&ty) => missing.push((identity, ty)),
                None => problems.push(by.problem(&fragments, nowhere, format!("{}, which {} mentions, which no file defines and whose type no task has kept", name_of_layout(&fragments, at), by.name(&fragments)))),
            }
        }
        times.add("reach", &mut since);
        if missing.is_empty() {
            break;
        }
        if times.rounds == MOST_ROUNDS {
            let (_, at, by) = named[0];
            problems.push(by.problem(&fragments, nowhere, format!("object types that lead to ever more object types, such as {}, which {} mentions", name_of_layout(&fragments, at), by.name(&fragments))));
            break;
        }
        let (described, has_run_out) = describe_in_tasks(checked, &missing, &index, in_parallel, describe, (&mut times, &mut since));
        ran_out_of_stack |= has_run_out;
        let described_fragments = described.len();
        for fragment in described {
            index.add(fragments.len(), &fragment);
            fragments.push(fragment);
        }
        times.rounds += 1;
        times.layouts_described += fragments[fragments.len() - described_fragments..].iter().flat_map(|fragment| &fragment.layouts).filter(|shape| shape.definition.is_some()).count();
        for &(_, at, by) in named.iter().filter(|named| types.contains_key(&named.0) && !index.layouts.contains_key(&LayoutKey::Record(named.0))) {
            problems.push(by.problem(&fragments, nowhere, format!("{}, which {} mentions and which cannot be laid out again", name_of_layout(&fragments, at), by.name(&fragments))));
        }
        times.add("reach", &mut since);
        add_kept_types(checked, &mut seen, &mut types, in_parallel);
        times.add("kept types", &mut since);
        reach.grow(&fragments);
        let defined = missing.iter().filter_map(|(identity, _)| index.layouts.get(&LayoutKey::Record(*identity)));
        reach.work.extend(defined.map(|found| Work::Layout(found.at)));
    }
    take_out_parts_that_do_not_run(&mut fragments, &reach);
    // `Explain::disagreements`: for each of the problems it is about, in their order.
    let mut why_they_disagree: Vec<Vec<String>> = Vec::new();
    for &(key, by) in &reach.undefined_funcs {
        problems.push(by.problem(&fragments, nowhere, format!("the function {key:?}, which {} mentions and which no file defines", by.name(&fragments))));
        why_they_disagree.push(vec![format!("the function {key:?}, which no fragment defines")]);
    }
    for &(at, by) in &reach.undefined_layouts {
        problems.push(by.problem(&fragments, nowhere, format!("{}, which {} mentions and which no file defines", name_of_layout(&fragments, at), by.name(&fragments))));
        if explain.disagreements {
            why_they_disagree.push(disagreement::of_undefined_layout(checked, &fragments, &index, &reach, at, by));
        }
    }
    let Errors { places, imported_by } = errors;
    let mut imported_for_types: Option<FxHashSet<FileId>> = None;
    let mut is_imported_for_types = |file: FileId| imported_for_types.get_or_insert_with(|| files_imported_for_types(&fragments, &reach, &mut *imported_by)).contains(&file);
    let errors: Vec<Option<Elsewhere>> = places.iter().map(|&place| place_of_error(&fragments, &index, &reach, place, &mut is_imported_for_types)).collect();
    // Nothing comes of a program with an error in it.
    if errors.iter().any(Option::is_none) {
        return Linked { problems, errors, times, ..Linked::default() };
    }

    // The functions of the program after the entry functions, and whether each has its body.
    let mut included: Vec<(At, bool)> = Vec::new();
    for (number, fragment) in fragments.iter().enumerate() {
        for (i, function) in fragment.funcs.iter().enumerate() {
            let at = At::new(number, i);
            if reach.funcs.contains(&function.key) && index.funcs.get(&function.key).is_some_and(|found| found.at == at) {
                included.push((at, reach.bodies.contains(&function.key)));
            }
        }
    }
    // What runs when the program starts comes first, in the order it runs in: the image places code by these numbers, and whatever is numbered as it is first mentioned follows.
    let key_at = |at: At| fragments[at.fragment as usize].funcs[at.index as usize].key;
    let of_the_runtime: FxHashSet<FileId> = builtin_modules.iter().map(|module| module.1).collect();
    let evaluates_module = |key: FuncKey| matches!(key, FuncKey::Module(file) | FuncKey::ModuleBody(file) if !of_the_runtime.contains(&file));
    included.sort_by_key(|&(at, _)| !evaluates_module(key_at(at)));
    let func_ids: FxHashMap<FuncKey, FuncId> = included.iter().enumerate().map(|(i, &(at, _))| (key_at(at), FuncId::new(entry_points.len() + i))).collect();

    let mut numbering = Numbering::new(&fragments, &index, func_ids);
    let name_of_entry = numbering.strs.intern(b"main");
    // A module for each file that has a function in the program, in the order of those.
    for &(at, _) in &included {
        numbering.module_of(fragments[at.fragment as usize].funcs[at.index as usize].key.file());
    }
    let mut stubs: Vec<Option<Func>> = Vec::with_capacity(included.len());
    // By layout: a function of the runtime is the first to lead to it. Those of the program come first: so nothing of the program leads to it.
    let mut is_layout_of_runtime: Vec<bool> = Vec::new();
    for &(at, has_body) in &included {
        let function = &fragments[at.fragment as usize].funcs[at.index as usize];
        let func = function.func.as_ref().expect(IS_KNOWN);
        stubs.push(match &function.body {
            Some(body) if has_body => {
                numbering.module(at.fragment, func.module);
                numbering.mention(at.fragment, &body.mentions);
                None
            }
            _ => Some(numbering.stub(at.fragment, func)),
        });
        if let Some(body) = &function.body {
            numbering.layout(at.fragment, body.class);
            for &class in body.classes_as_values.iter().filter(|_| has_body) {
                numbering.layout(at.fragment, class);
            }
        }
        numbering.settle();
        is_layout_of_runtime.resize(numbering.layouts.len(), is_of_runtime(function.key.file()));
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
    let Numbering { maps, strs, tys, layouts, globals, modules, func_ids, layout_ids, global_ids, .. } = numbering;
    for names in [&mut extended_globals, &mut prototype_property_names] {
        names.sort_unstable_by(|&a, &b| strs.get(a).cmp(strs.get(b)));
        names.dedup();
    }
    times.add("number", &mut since);

    // From here on the fragments are taken apart. What was noted is put together, with the types in the place of what the fragments call
    // them. A type that does not come back would be a member or a view the less, and nobody would know.
    let mut noted: Noted = Noted::default();
    let mut lost: Vec<(Identity, Problem)> = Vec::new();
    let mut absorb = |notes: Notes, file: FileId, pos: u32, of: &dyn Fn() -> String| {
        noted.absorb(notes.renamed(|identity| {
            let ty = types.get(&identity).copied();
            if ty.is_none() {
                lost.push((identity, Problem { file, pos, what: format!("a type ({identity:x?}) that is noted for {} and that no task has kept", of()).into() }));
            }
            ty
        }));
    };
    let mut classes_as_values: Vec<LayoutId> = Vec::new();
    // `Body::stored_besides`, with the number of the fragment.
    let mut stored_besides: Vec<(u32, StrId)> = Vec::new();
    // `Body::number_flows`, each with its file. The names are strings of `names_of_flows`.
    let mut names_of_flows = Strs::default();
    let mut number_flows: Vec<(FileId, NumberFlow<StrId>)> = Vec::new();
    let mut funcs: Vec<(Func, Option<u32>)> = Vec::with_capacity(included.len());
    let mut is_stub: Vec<bool> = vec![false; entry_points.len()];
    for (&(at, has_body), stub) in included.iter().zip(stubs) {
        let Fragment { funcs: of_fragment, strs: strs_of_fragment, .. } = &mut fragments[at.fragment as usize];
        let function = &mut of_fragment[at.index as usize];
        let (key, pos) = (function.key, function.func.as_ref().map_or(0, |func| func.pos));
        let name = || format!("the function {key:?}");
        if let Some(body) = &mut function.body {
            if has_body {
                problems.append(&mut body.problems);
                classes_as_values.extend(body.classes_as_values.iter().map(|class| maps[at.fragment as usize].layouts[class.idx()]));
            }
            if has_body && !is_opaque(key.file()) {
                absorb(std::mem::take(&mut body.notes), key.file(), pos, &name);
                stored_besides.extend(body.stored_besides.iter().map(|&name| (at.fragment, name)));
                number_flows.extend(body.number_flows.drain(..).map(|flow| (key.file(), flow.renamed(|name| names_of_flows.intern(strs_of_fragment.get(name))))));
            }
            if has_body && !is_opaque(key.file()) && (reach.values.contains(&key) || reach.members.contains(&key)) {
                absorb(std::mem::take(&mut body.notes_if_called_unknown), key.file(), pos, &name);
            }
        }
        is_stub.push(stub.is_some());
        let (mut func, from) = match stub {
            Some(stub) => (stub, None),
            None => (function.func.take().expect(IS_KNOWN), Some(at.fragment)),
        };
        if reach.values.contains(&key) {
            func.flags |= func_flags::IS_VALUE;
        }
        funcs.push((func, from));
    }
    for_each_mut(&mut funcs, in_parallel, &|(func, from)| {
        if let Some(from) = from {
            renumber_func(func, &maps[*from as usize]);
        }
    });

    let mut program = Program { strs, tys, extended_globals, prototype_property_names, entries: (0..entry_points.len()).map(FuncId::new).collect(), ..Program::default() };
    for entry_point in entry_points {
        // A file that only declares has no code to start with.
        let run: Vec<FuncId> = entry_point.iter().filter_map(|&root| func_ids.get(&FuncKey::Module(root)).copied()).collect();
        program.funcs.push(entry_function(name_of_entry, program.tys.anything, &run));
    }
    program.funcs.extend(funcs.into_iter().map(|(func, _)| func));
    program.builtin_modules = builtin_roots.iter().map(|(id, root)| (*id, func_ids[root])).collect();
    program.builtin_functions = builtin_functions.iter().map(|(id, root, visibility)| (*id, func_ids[root], *visibility)).collect();
    let init_of = |file: FileId| func_ids.get(&FuncKey::Module(file)).copied().unwrap_or(FuncId::NONE);
    let mut line_tables: Vec<(FileId, Vec<u8>)> = modules.iter().map(|&(file, _)| (file, Vec::new())).collect();
    for_each_mut(&mut line_tables, in_parallel, &|(file, table)| {
        let text = &checked.files.hir(*file).text;
        *table = line_table(text, &compute_ecma_line_starts(text));
    });
    for (&(file, path), (_, line_table)) in modules.iter().zip(line_tables) {
        // A module of the runtime is shown by the name the module loader has for it: native code goes by that text.
        let builtin = match checked.files.module(file).builtin {
            Some(Builtin::Module(id)) => bun_builtin_syntax::Archive::embedded().manifest().module(id),
            _ => None,
        };
        let shown = match builtin {
            Some(module) => module.name.to_vec(),
            None => get_relative_path_from_directory(shown_from, checked.files.module(file).file_name(), checked.files.is_case_sensitive),
        };
        program.modules.push(ir::Module { path, init: init_of(file), display_path: program.strs.intern(&shown), line_table });
    }
    for &at in &globals {
        let ir::Global { name, module, declared, initialization, only_function, only_function_flags } = fragments[at.fragment as usize].globals[at.index as usize].global;
        let mut global = ir::Global { name, module, declared, initialization, only_function, only_function_flags };
        for_each_id_of_global(&mut global, &mut Renumber(&maps[at.fragment as usize]));
        // Of a function that is not reached there are no closures.
        if global.only_function.is_none() {
            global.only_function_flags = 0;
        }
        program.globals.push(global);
    }
    // By layout: the type it stands for, the class it is of, and the class that it constructs by its value.
    let mut views: Vec<(LayoutId, Identity)> = Vec::new();
    let mut classes: Vec<Option<(FileId, ClassId)>> = Vec::with_capacity(layouts.len());
    let mut constructed_by_value: Vec<LayoutId> = Vec::new();
    for (id, &at) in layouts.iter().enumerate() {
        let shape = &mut fragments[at.fragment as usize].layouts[at.index as usize];
        let definition = shape.definition.take().expect("the index has no shape that is only named, and `layouts` has each once");
        let Definition { mut layout, mentions: _, constructs, notes: of_layout, problems: mut of_declaration } = *definition;
        for_each_id_of_layout(&mut layout, &mut Renumber(&maps[at.fragment as usize]));
        for field in layout.fields.iter_mut().filter(|field| field.only_function.is_none()) {
            field.only_function_flags = 0;
        }
        program.layouts.push(layout);
        views.extend(shape.ty.map(|ty| (LayoutId::new(id), ty)));
        classes.push(if let LayoutKey::Instance(file, class) = shape.key { Some((file, class)) } else { None });
        if constructs.is_some() {
            constructed_by_value.push(maps[at.fragment as usize].layouts[constructs.idx()]);
        }
        if let Some(of_layout) = of_layout.filter(|_| !shape.key.file().is_some_and(is_opaque)) {
            let key = shape.key;
            absorb(*of_layout, key.file().unwrap_or(nowhere), 0, &|| format!("the layout {key:x?}"));
        }
        problems.append(&mut of_declaration);
    }
    for class in constructed_by_value.into_iter().filter(|class| class.is_some()) {
        program.layouts[class.idx()].class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
    }
    times.add("renumber", &mut since);

    {
        let all = Final {
            program: &program,
            tys: program.tys.list.iter().enumerate().map(|(i, declared)| (declared, TyId::new(i))).collect(),
            funcs: &func_ids,
            layouts: &layout_ids,
            globals: &global_ids,
            is_stub: &is_stub,
        };
        let about: Vec<String> = fragments.iter().filter(|_| explain.disagreements).map(|fragment| disagreement::about_fragment(checked, &index, &reach, fragment)).collect();
        let explain_identities = |here: Identity, kept: Identity| match (types.get(&here), types.get(&kept)) {
            (Some(&here), Some(&kept)) => checked.checker().explain_identities(here, kept),
            (here, kept) => format!("no task has kept the type: here {}, kept {}", here.is_none(), kept.is_none()),
        };
        let kept = disagreement::Kept { fragments: &fragments, layouts: &layouts, globals: &globals, entries: entry_points.len(), funcs: &included, about: &about, explain_identities: &explain_identities, about_function: &|file, func| disagreement::about_function(checked, file, func) };
        let kept = explain.disagreements.then_some(&kept);
        let mut found: Vec<(usize, Vec<(Problem, Vec<String>)>)> = (0..fragments.len()).map(|number| (number, Vec::new())).collect();
        for_each_mut(&mut found, in_parallel, &|(number, found)| {
            *found = disagreements(*number, &fragments[*number], &maps[*number], &all, nowhere, kept);
        });
        for (problem, why) in found.into_iter().flat_map(|(_, found)| found) {
            problems.push(problem);
            why_they_disagree.push(why);
        }
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
    let stores_to_methods: Vec<MethodStore> = (stores_to_methods.into_iter())
        .filter_map(|(file, store)| store.renamed(|identity| again(identity, file, &|| "an object that a method is stored to".to_owned())))
        .collect();
    // The notes of a function come in no order, and a type more than once.
    lost.sort_by_key(|lost| lost.0);
    lost.dedup_by_key(|lost| lost.0);
    problems.extend(lost.into_iter().map(|lost| lost.1));

    // No task runs any more: the checker sees all that has been published.
    let c = &mut checked.checker();
    c.begin_stack_budget();

    // Which methods the modules of the program are seen to put something else in the place of. No fragment says so of any.
    let replaced = c.methods_replaced_by(stores_to_methods);
    for (layout, class) in program.layouts.iter_mut().zip(&classes) {
        let Some((file, class)) = *class else { continue };
        for method in &mut layout.methods {
            if method.name.is_some() && replaced.contains(file, class, program.strs.get(method.name), method.flags & method_flags::STATIC != 0) {
                method.flags |= method_flags::MAY_BE_REPLACED;
            }
        }
    }

    // What is found in the place of a static member is handed the class object it is found from as `this`, and may construct it.
    let has_replaced_static_member = |layout: &Layout| layout.methods.iter().any(|method| method.flags & method_flags::STATIC != 0 && method.flags & method_flags::MAY_BE_REPLACED != 0);
    for &(layout, ty) in &views {
        let Some((file, class)) = classes[layout.idx()] else { continue };
        let mut at = layout;
        while at.is_some() && !has_replaced_static_member(&program.layouts[at.idx()]) {
            at = program.layouts[at.idx()].base;
        }
        if at.is_some() {
            classes_as_values.push(layout);
            if !c.hir(file)[class].flags.contains(Flags::ABSTRACT) {
                c.note_allocation(ty);
            }
        }
    }
    noted.absorb(c.take_noted());

    // A class that is not laid out constructs what it extends by its value. Where that may be a class that is laid out, the objects of
    // that layout do not all have the prototype object of that class.
    classes_as_values.retain(|class| class.is_some());
    classes_as_values.sort_unstable();
    classes_as_values.dedup();
    let class_of = |layout: &LayoutId| classes[layout.idx()];
    let is_extending = |layout: &LayoutId| program.layouts[layout.idx()].class_flags & class_flags::HAS_FOREIGN_ROOT != 0;
    let extending: Vec<(FileId, ClassId)> = (0..program.layouts.len()).map(LayoutId::new).filter(is_extending).filter_map(|layout| class_of(&layout)).collect();
    let candidates: Vec<(LayoutId, (FileId, ClassId))> = classes_as_values.iter().filter_map(|layout| Some((*layout, class_of(layout)?))).collect();
    let asked: Vec<(FileId, ClassId)> = candidates.iter().map(|candidate| candidate.1).collect();
    for (candidate, may_be_extended) in candidates.iter().zip(c.may_be_extended_by_value(&extending, &asked)) {
        if may_be_extended {
            program.layouts[candidate.0.idx()].class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
        }
    }

    times.add("classes", &mut since);

    drop_facts_about_static_fields(&mut program);
    let is_of_opaque_file: Vec<bool> = classes.iter().map(|class| class.is_some_and(|class| is_opaque(class.0))).collect();
    let mut names = Names::of(&program, &is_of_opaque_file, in_parallel);
    // A name that the program has no string for is the name of no field.
    for name in stored_besides.into_iter().filter_map(|(fragment, name)| program.strs.find(fragments[fragment as usize].strs.get(name))) {
        names.stored[name.idx()] = true;
    }
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
    let stored: FxHashSet<Atom> = (0..program.strs.len()).filter(|&name| names.stored[name]).filter_map(|name| checked.files.atoms.lookup(program.strs.get(StrId::new(name)))).collect();
    times.add("names", &mut since);

    // A name that the program has no string for is the name of no field.
    // The runtime and the program each go by what their own code stores.
    let (flows_of_runtime, number_flows): (Vec<_>, Vec<_>) = number_flows.into_iter().partition(|flow| is_of_runtime(flow.0));
    let [verdicts, verdicts_of_runtime] = [&number_flows, &flows_of_runtime].map(|flows| -> Vec<(StrId, Int32Verdict<StrId>)> {
        let verdicts = expected_int32(flows, |file| checked.files.rank_of_file(file)).into_iter();
        verdicts.filter_map(|verdict| Some((program.strs.find(names_of_flows.get(verdict.name))?, verdict))).collect()
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
        if explain.progress {
            eprintln!("aot: progress: the link: {what}");
        }
    };
    say("the types of the fields");
    let field_types = crate::field_types::field_types(&program, &views);
    let mut subtypes = c.begin_subtypes(noted, &asked, field_types, stored, explain.progress);
    times.add("flows", &mut since);
    let mut has_run_out = false;
    while !subtypes.questions().is_empty() || !subtypes.own_questions().is_empty() {
        let (answers, has_this_run_out) = answers_to(checked, subtypes.questions(), subtypes.stored(), in_parallel);
        subtypes.say("the answers of the other checkers");
        let own_answers = c.answer(subtypes.own_questions(), subtypes.stored());
        has_run_out |= has_this_run_out;
        times.add("answers", &mut since);
        subtypes.advance(&answers, &own_answers);
        times.add("flows", &mut since);
    }
    if let Some(table) = subtypes.is_over_budget() {
        problems.push(Problem { file: nowhere, pos: 0, what: format!("a program with so many flows between its types: {table} is over its budget").into() });
    }
    let let_through = c.let_through_for_closure(&asked, explain.escapes);
    times.add("escapes", &mut since);
    let mut membership = subtypes.finish(&let_through);
    times.add("flows", &mut since);
    say("the subtypes are found");
    if ran_out_of_stack || has_run_out || c.take_ran_out_of_stack() {
        problems.push(Problem { file: nowhere, pos: 0, what: "types that are nested too deeply".into() });
    }
    let layouts_at = |indexes: &[u32]| -> Vec<LayoutId> { indexes.iter().map(|&index| views[index as usize].0).collect() };
    for (&(layout, _), reach) in views.iter().zip(&membership.views) {
        let out = &mut program.layouts[layout.idx()];
        out.is_allocated = reach.is_allocated;
        out.may_be_frozen = reach.may_be_frozen;
        if reach.may_have_other_prototype && out.kind == LayoutKind::Record {
            out.class_flags |= class_flags::MAY_HAVE_OTHER_PROTOTYPE;
        }
        out.admits_foreign = reach.admits_foreign;
        out.members = layouts_at(&reach.members);
        out.specializations = layouts_at(&reach.specializations);
        // What is stored under a name in the objects of a view is seen as far as the types go: a prediction.
        for &(name, file, func, certainty) in &reach.callees {
            let field = program.strs.find(checked.files.atoms.bytes(name)).and_then(|name| out.field(name));
            if let (Some(field), Some(&func)) = (field, func_ids.get(&FuncKey::Function(file, func))) {
                out.fields[field as usize].only_function = func;
                if certainty == Certainty::Fact {
                    out.fields[field as usize].only_function_flags = ir::only_function_flags::OR_NIL;
                }
            }
        }
        for &(name, is_at_every_creation) in &reach.set_at_creation {
            if let Some(field) = program.strs.find(checked.files.atoms.bytes(name)).and_then(|name| out.field(name)) {
                out.fields[field as usize].flags |= if is_at_every_creation { field_flags::SET_AT_CREATION } else { field_flags::MAY_BE_SET_AT_CREATION };
            }
        }
        for &name in &reach.never_seen_absent {
            if let Some(field) = program.strs.find(checked.files.atoms.bytes(name)).and_then(|name| out.field(name))
                && out.fields[field as usize].flags & (field_flags::OPTIONAL | field_flags::NEVER_STORED) == 0
            {
                out.fields[field as usize].flags |= field_flags::NEVER_SEEN_ABSENT;
            }
        }
    }
    // The objects that a constructor function initializes inherit from its `prototype` object. Where the program may replace that or get
    // hold of it, they may inherit from anything.
    for (key, &func) in &func_ids {
        if let FuncKey::Function(file, function) = *key
            && c.has_mutable_prototype(file, function)
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
    // A field that is absent is read from the prototype chain. So which function it holds is a fact only if it is always there, or nothing can be
    // found by its name: no object of a class, no record that may inherit from anything, no name that `Object.prototype` has.
    let on_object_prototype: Vec<StrId> = NAMES_ON_OBJECT_PROTOTYPE.iter().filter_map(|name| program.strs.find(name.as_bytes())).collect();
    for (&(layout, _), reach) in views.iter().zip(&mut membership.views) {
        let view = &program.layouts[layout.idx()];
        let members = || view.members.iter().map(|member| &program.layouts[member.idx()]);
        let may_inherit = members().chain([view]).any(|layout| layout.kind != LayoutKind::Record || layout.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0);
        let is_always_there = |layout: &Layout, name: StrId| {
            layout.field(name).is_some_and(|field| layout.fields[field as usize].flags & (field_flags::OPTIONAL | field_flags::ABSENT_AT_BIRTH | field_flags::NEVER_SEEN_ABSENT) == field_flags::NEVER_SEEN_ABSENT)
        };
        let is_inherited = |field: &ir::Field| field.only_function_flags == ir::only_function_flags::OR_NIL && (may_inherit || on_object_prototype.contains(&field.name)) && !members().all(|layout| is_always_there(layout, field.name));
        let inherited: Vec<usize> = (0..view.fields.len()).filter(|&field| is_inherited(&view.fields[field])).collect();
        for field in inherited {
            let field = &mut program.layouts[layout.idx()].fields[field];
            field.only_function_flags = 0;
            let name = program.strs.get(field.name);
            for callee in reach.callees.iter_mut().filter(|callee| checked.files.atoms.bytes(callee.0) == name) {
                callee.3 = Certainty::Predicted(Doubt::MayBeInherited);
            }
        }
    }
    // A read that stands in a test position is held to nothing. What a view says of a field is a fact all the same where every object that is
    // looked at through it is one of the program's, with the prototype it was made with.
    for func in &mut program.funcs {
        for index in 0..func.values.len() {
            let Prediction::Field(ty) = func.values[index].prediction else { continue };
            let read = match func.values[index].def {
                Def::Op(Op::PropGet { obj, name }) => program.tys.get(func.values[obj.idx()].ty).only_layout().map(|view| (view, name)),
                _ => None,
            };
            let is_fact = read.is_some_and(|(view, name)| {
                let view = &program.layouts[view.idx()];
                let members = || view.members.iter().map(|member| &program.layouts[member.idx()]);
                let is_as_made = |layout: &Layout| layout.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE == 0;
                // Where the view has no field by the name, each of the objects has one of its own, or the name may stand for anything.
                let has_it = |layout: &Layout| {
                    let declared = layout.field(name).map_or(TyId::NONE, |field| layout.fields[field as usize].declared);
                    declared.is_some() && program.tys.get(declared).is_described_within(program.tys.get(ty))
                };
                !view.admits_foreign && is_as_made(view) && members().all(is_as_made) && (view.field(name).is_some() || !view.members.is_empty() && members().all(has_it))
            });
            let value = &mut func.values[index];
            (value.ty, value.prediction) = if is_fact { (ty, Prediction::None) } else { (value.ty, Prediction::Ty(ty)) };
        }
    }
    say("the subtypes are in the program");
    let unsound_uses = crate::verify::unsound_uses(&program, if explain.disagreements { 10 } else { 1 }, in_parallel);
    if let Some(first) = unsound_uses.first() {
        problems.push(Problem { file: nowhere, pos: 0, what: first.what.clone().into() });
    }
    times.add("verify", &mut since);
    say("verified");
    for (&(layout, _), of_view) in views.iter().zip(type_texts(checked, &program, &views, in_parallel)) {
        for (field, text) in of_view {
            program.layouts[layout.idx()].fields[field as usize].type_text = program.strs.intern(&text);
        }
    }
    // By file that declares a view: its path as it is shown, and where its lines start.
    let mut declaring: FxHashMap<FileId, (StrId, Vec<u32>)> = FxHashMap::default();
    for &(layout, view) in &views {
        // The text of a library that is not checked is not kept.
        let Some(at) = c.declaration_of_view(view).filter(|at| (at.pos as usize) < checked.files.hir(at.file).text.len()) else { continue };
        let (path, line_starts) = declaring.entry(at.file).or_insert_with(|| {
            let shown = get_relative_path_from_directory(shown_from, checked.files.module(at.file).file_name(), checked.files.is_case_sensitive);
            (program.strs.intern(&shown), compute_ecma_line_starts(&checked.files.hir(at.file).text))
        });
        let out = &mut program.layouts[layout.idx()];
        (out.declared_path, out.declared_line) = (*path, line_starts.partition_point(|&start| start <= at.pos) as u32);
    }
    times.add("type texts", &mut since);
    say("the texts of the types");
    let mut explained = Vec::new();
    if explain.disagreements {
        let index_of = |layout: LayoutId| views.iter().position(|view| view.0 == layout);
        let names_of = |layout: LayoutId| -> Vec<StrId> { program.layouts[layout.idx()].fields.iter().map(|field| field.name).collect() };
        for (number, unsound) in unsound_uses.iter().enumerate() {
            let sub = index_of(unsound.sub);
            let out_of: Vec<u32> = membership.upcasts.iter().filter(|upcast| Some(upcast.0 as usize) == sub).map(|upcast| upcast.1).collect();
            explained.push(format!(
                "unsound use {}: the layout {}: view number {sub:?}, {} members, {} upcasts lead out of it, to the layouts {:?}",
                number + 1,
                unsound.sub.0,
                program.layouts[unsound.sub.idx()].members.len(),
                out_of.len(),
                out_of.iter().take(12).map(|&to| views[to as usize].0.0).collect::<Vec<u32>>(),
            ));
            for &supertype in &unsound.supertypes {
                let at = index_of(supertype);
                let same_type = at.map_or(0, |at| views.iter().filter(|view| view.1 == views[at].1).count());
                let into = membership.upcasts.iter().filter(|upcast| Some(upcast.1 as usize) == at).count();
                explained.push(format!(
                    "unsound use {}: used as the layout {}: view number {at:?}, {} fields, {} members, views of the same type: {same_type}, upcasts that lead into it: {into}",
                    number + 1,
                    supertype.0,
                    program.layouts[supertype.idx()].fields.len(),
                    program.layouts[supertype.idx()].members.len(),
                ));
                // Another layout with the same fields that the upcasts of the layout lead to.
                for &to in out_of.iter().filter(|&&to| views[to as usize].0 != supertype && names_of(views[to as usize].0) == names_of(supertype)).take(3) {
                    let apart = at.map_or_else(|| "the layout is no view".to_owned(), |at| c.explain_identities(views[at].1, views[to as usize].1));
                    explained.push(format!("unsound use {}: the upcasts lead to the layout {} instead, which has the same fields; here: what the value is used as, kept: that layout; {apart}", number + 1, views[to as usize].0.0));
                }
            }
        }
        for (number, why) in why_they_disagree.iter().enumerate() {
            explained.extend(why.iter().map(|line| format!("disagreement {}: {line}", number + 1)));
        }
    }
    if explain.foreign {
        explained.append(&mut c.explain_foreign(&asked, &membership));
    }
    if explain.members {
        explained.append(&mut c.explain_members(&asked, &membership));
    }
    if explain.escapes {
        explained.append(&mut c.explain_escapes(&asked, &membership));
    }
    if explain.alterations {
        explained.append(&mut c.explain_alterations(&membership));
        let is_tested: Vec<bool> = program.layouts.iter().map(|view| view.members.iter().any(|member| program.layouts[member.idx()].may_be_frozen)).collect();
        let stores = || program.funcs.iter().flat_map(|func| func.blocks.iter().flat_map(|block| block.ops.iter().map(|v| crate::format::record(&func.values[v.idx()].def)))).filter(|r| r.opcode == crate::format::Opcode::PutField);
        explained.push(format!("alterations: {} of {} stores to fields test the integrity level", stores().filter(|r| is_tested[r.immediates[0] as usize]).count(), stores().count()));
        let records = |is_marked: bool| program.layouts.iter().filter(|layout| layout.is_allocated && layout.kind == LayoutKind::Record && (!is_marked || layout.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0)).count();
        explained.push(format!("alterations: {} of {} allocated records may inherit from anything", records(true), records(false)));
    }
    if explain.parsed {
        explained.append(&mut c.explain_parsed(&asked, &membership));
    }
    if explain.keys {
        explained.append(&mut c.explain_functions_by_key());
    }
    for (property, key, (file, func)) in c.functions_by_key() {
        let strings = [property, key].map(|atom| program.strs.find(checked.files.atoms.bytes(atom)));
        if let ([Some(property), Some(key)], Some(&func)) = (strings, func_ids.get(&FuncKey::Function(file, func))) {
            program.functions_by_key.push((property, key, func));
        }
    }
    program.functions_by_key.sort_unstable_by_key(|entry| (entry.0.0, entry.1.0));
    for func in &mut program.funcs {
        for value in &mut func.values {
            if let Prediction::ByKey(property) = value.prediction
                && program.functions_by_key.binary_search_by_key(&property.0, |entry| entry.0.0).is_err()
            {
                value.prediction = Prediction::None;
            }
        }
    }
    if explain.predictions {
        explained.append(&mut c.explain_predictions(&membership.predictions));
    }
    if explain.callees {
        explained.append(&mut c.explain_callees(&asked, &membership));
    }
    if explain.uninitialized {
        explained.append(&mut c.explain_uninitialized());
    }
    if explain.kinds {
        explained.append(&mut c.explain_kinds());
    }
    if explain.deferred {
        explained.append(&mut c.explain_deferred(&translated));
        explained.append(&mut c.explain_modules(&roots.iter().map(|root| root.file()).collect::<Vec<FileId>>(), &translated));
    }
    if explain.captures {
        for &file in &translated {
            explained.append(&mut c.explain_captures(file));
        }
    }
    if explain.escape {
        for &file in &translated {
            explained.append(&mut c.explain_escape(file));
        }
    }
    if explain.fields {
        explained.append(&mut explain_fields(&program, &names));
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
    Linked { program, problems, members: membership.sizes.line(), explained, errors, builtin_modules_left_out, builtin_functions_left_out, times }
}
