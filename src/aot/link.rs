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
//! 6. What was noted for the code that is reached is put together, and the checker says which objects are of which types
//!    (`questions_about_views`). The questions that leaves for the relation between types are shared out to checkers of their own.
//!
//! What the checker is asked here: the identity of every type that was kept, which classes may be extended by their value, which takes
//! the type of what stands after `extends` in the classes that are not laid out, and those questions. Nothing else is derived
//! again, but for the layouts that no fragment defines: those are described in tasks like those of the check, as many rounds of them
//! as it takes.

use crate::build::Problem;
use crate::declared::{Declared, DeclaredTable, Part};
use crate::fragment::{Definition, Fragment, FuncKey, Function, GlobalKey, Ids, LayoutKey, Mentions, NO_FILE, Notes, Used, for_each_id_of_func, for_each_id_of_global, for_each_id_of_layout};
use crate::id::{FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{self, Func, FuncKind, Layout, LayoutKind, Literal, NO_VARIABLE, Op, Prediction, Program, STATIC_FIELD_IS_ANNOTATED, Strs, Term, class_flags, func_flags, method_flags};
use bun_sema::check::task::Finished;
use bun_sema::check::{Checker, Identity, MethodStore, Noted, Program as Checked, Question};
use bun_sema::hir::{ClassId, Flags};
use bun_sema::program::FileId;
use bun_sema::types::TypeId;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::collections::VecDeque;
use std::collections::hash_map::Entry;
use std::hash::Hash;
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct Linked {
    pub program: Program,
    /// What could not be translated of the code that is reached, and what the fragments do not agree on.
    pub problems: Vec<Problem>,
    /// `Membership::pairs_asked`, `Membership::members_added`.
    pub pairs_asked: usize,
    pub members_added: usize,
    /// What `Explain` has asked for, a line each.
    pub explained: Vec<String>,
    /// For each of the errors that `link` was handed: why it does not lie in code that is in the program. `None`: it does.
    pub errors: Vec<Option<Elsewhere>>,
    pub times: Times,
}

/// What the link says of what it has decided, for whoever asks why.
#[derive(Default, Copy, Clone)]
pub struct Explain {
    /// Why each view that admits objects that are not laid out does: `Checker::explain_foreign`.
    pub foreign: bool,
    /// Which views have members only because a test has been left out, and from where: `Checker::explain_members`.
    pub members: bool,
    /// Which variables of numbers and booleans may be read before anything is stored to them: `Checker::explain_uninitialized`.
    pub uninitialized: bool,
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
#[derive(Copy, Clone, PartialEq, Eq)]
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
                self.layout(fragments, index, at.fragment, func.env);
                for ty in [func.this_declared, func.result].into_iter().chain(func.params.iter().copied()) {
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
        let mut renumbered: SmallVec<[Part; 1]> = SmallVec::new();
        for part in parts {
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
            env: self.layout(from, func.env),
            this_declared: self.ty(from, func.this_declared),
            params: func.params.iter().map(|&param| self.ty(from, param)).collect(),
            annotated: func.annotated.clone(),
            result: self.ty(from, func.result),
            blocks: Vec::new(),
            values: Vec::new(),
        };
        let entry = stub.add_block();
        if stub.env.is_some() {
            let env = self.tys.intern(Declared::part(Part::Class(stub.env)));
            stub.add_param(entry, env);
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
        env: LayoutId::NONE,
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

    /// Whether the function is to a caller what the fragment takes it for.
    fn is_func(&mut self, local: &Func, id: FuncId) -> bool {
        let all = self.all;
        let out = &all.program.funcs[id.idx()];
        // What is only known of a function once it is built, or once all its uses are.
        let known_later = func_flags::IS_VALUE | func_flags::IS_TYPED | if all.is_stub[id.idx()] { COROUTINE } else { 0 };
        local.kind == out.kind
            && (local.flags ^ out.flags) & !known_later == 0
            && local.annotated == out.annotated
            && local.params.len() == out.params.len()
            && self.layout(local.env) == Some(out.env)
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
            // What leads from an environment to the one around it is for the code of the file alone.
            let is_link = local.kind == LayoutKind::Environment && field.name.is_none() && same.name.is_none();
            if !is_link && (field.flags != same.flags || self.str(field.name) != Some(same.name) || self.ty(field.declared) != Some(same.declared)) {
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
        if variable.global.initialization != out.initialization || finder.ty(variable.global.declared) != Some(out.declared) {
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
    for (&ty, &identity) in kept.iter().zip(slices.iter().flat_map(|slice| &slice.1)) {
        types.entry(identity).or_insert(ty);
    }
}

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
fn answers_to(program: &Checked<'_>, questions: &[Question], in_parallel: InParallel<'_>) -> (Vec<bool>, bool) {
    let mut slices: Vec<(&[Question], Vec<bool>, bool)> = questions.chunks(QUESTIONS_OF_A_CHECKER).map(|slice| (slice, Vec::new(), false)).collect();
    for_each_mut(&mut slices, in_parallel, &|(slice, answers, ran_out_of_stack)| {
        let mut c = program.checker();
        c.begin_stack_budget();
        *answers = c.answer(slice);
        *ran_out_of_stack = c.take_ran_out_of_stack();
    });
    let ran_out_of_stack = slices.iter().any(|slice| slice.2);
    (slices.into_iter().flat_map(|slice| slice.1).collect(), ran_out_of_stack)
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
    let of_module = bodies.filter(|(function, _)| matches!(function.key, FuncKey::Module(_) | FuncKey::AsyncModuleBody(_)));
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
pub fn link(
    checked: &Checked<'_>,
    mut fragments: Vec<Fragment>,
    roots: &[FileId],
    errors: Errors<'_>,
    in_parallel: InParallel<'_>,
    explain: Explain,
    describe: Describe<'_>,
) -> Linked {
    fragments.sort_by_key(|fragment| checked.files.rank_of_file(fragment.file));
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
    // A file that only declares has no code to start with.
    let roots: Vec<FuncKey> = roots.iter().map(|&root| FuncKey::Module(root)).filter(|root| index.funcs.contains_key(root)).collect();
    for &root in &roots {
        reach.key(&fragments, &index, root, true);
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
    for &(key, by) in &reach.undefined_funcs {
        problems.push(by.problem(&fragments, nowhere, format!("the function {key:?}, which {} mentions and which no file defines", by.name(&fragments))));
    }
    for &(at, by) in &reach.undefined_layouts {
        problems.push(by.problem(&fragments, nowhere, format!("{}, which {} mentions and which no file defines", name_of_layout(&fragments, at), by.name(&fragments))));
    }
    let Errors { places, imported_by } = errors;
    let mut imported_for_types: Option<FxHashSet<FileId>> = None;
    let mut is_imported_for_types = |file: FileId| imported_for_types.get_or_insert_with(|| files_imported_for_types(&fragments, &reach, &mut *imported_by)).contains(&file);
    let errors: Vec<Option<Elsewhere>> = places.iter().map(|&place| place_of_error(&fragments, &index, &reach, place, &mut is_imported_for_types)).collect();
    // Nothing comes of a program with an error in it.
    if errors.iter().any(Option::is_none) {
        return Linked { problems, errors, times, ..Linked::default() };
    }

    // The functions of the program after the entry function, and whether each has its body.
    let mut included: Vec<(At, bool)> = Vec::new();
    let mut func_ids: FxHashMap<FuncKey, FuncId> = FxHashMap::default();
    for (number, fragment) in fragments.iter().enumerate() {
        for (i, function) in fragment.funcs.iter().enumerate() {
            let at = At::new(number, i);
            if reach.funcs.contains(&function.key) && index.funcs.get(&function.key).is_some_and(|found| found.at == at) {
                included.push((at, reach.bodies.contains(&function.key)));
                func_ids.insert(function.key, FuncId::new(included.len()));
            }
        }
    }

    let mut numbering = Numbering::new(&fragments, &index, func_ids);
    let name_of_entry = numbering.strs.intern(b"main");
    // A module for each file that has a function in the program, in program order.
    for &(at, _) in &included {
        numbering.module_of(fragments[at.fragment as usize].funcs[at.index as usize].key.file());
    }
    let mut stubs: Vec<Option<Func>> = Vec::with_capacity(included.len());
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
    }
    let mut extended_globals: Vec<StrId> = Vec::new();
    let mut stores_to_methods: Vec<(FileId, MethodStore<Identity>)> = Vec::new();
    for (number, fragment) in fragments.iter().enumerate() {
        if numbering.module_ids.contains_key(&fragment.file) {
            for &name in &fragment.altered_globals {
                extended_globals.push(numbering.str(number as u32, name));
            }
            stores_to_methods.extend(fragment.stores_to_methods.iter().map(|store| (fragment.file, store.clone())));
        }
    }
    let Numbering { maps, strs, tys, layouts, globals, modules, func_ids, layout_ids, global_ids, .. } = numbering;
    extended_globals.sort_unstable_by(|&a, &b| strs.get(a).cmp(strs.get(b)));
    extended_globals.dedup();
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
    let mut funcs: Vec<(Func, Option<u32>)> = Vec::with_capacity(included.len());
    let mut is_stub: Vec<bool> = vec![false];
    for (&(at, has_body), stub) in included.iter().zip(stubs) {
        let function = &mut fragments[at.fragment as usize].funcs[at.index as usize];
        let (key, pos) = (function.key, function.func.as_ref().map_or(0, |func| func.pos));
        let name = || format!("the function {key:?}");
        if let Some(body) = &mut function.body {
            if has_body {
                absorb(std::mem::take(&mut body.notes), key.file(), pos, &name);
                problems.append(&mut body.problems);
                classes_as_values.extend(body.classes_as_values.iter().map(|class| maps[at.fragment as usize].layouts[class.idx()]));
            }
            if has_body && (reach.values.contains(&key) || reach.members.contains(&key)) {
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

    let mut program = Program { strs, tys, extended_globals, entry: FuncId::new(0), ..Program::default() };
    let roots: Vec<FuncId> = roots.iter().map(|root| func_ids[root]).collect();
    program.funcs.push(entry_function(name_of_entry, program.tys.anything, &roots));
    program.funcs.extend(funcs.into_iter().map(|(func, _)| func));
    let init_of = |file: FileId| func_ids.get(&FuncKey::Module(file)).copied().unwrap_or(FuncId::NONE);
    program.modules = modules.iter().map(|&(file, path)| ir::Module { path, init: init_of(file) }).collect();
    for &at in &globals {
        let ir::Global { name, module, declared, initialization } = fragments[at.fragment as usize].globals[at.index as usize].global;
        let mut global = ir::Global { name, module, declared, initialization };
        for_each_id_of_global(&mut global, &mut Renumber(&maps[at.fragment as usize]));
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
        program.layouts.push(layout);
        views.extend(shape.ty.map(|ty| (LayoutId::new(id), ty)));
        classes.push(if let LayoutKey::Instance(file, class) = shape.key { Some((file, class)) } else { None });
        if constructs.is_some() {
            constructed_by_value.push(maps[at.fragment as usize].layouts[constructs.idx()]);
        }
        if let Some(of_layout) = of_layout {
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

    let asked: Vec<TypeId> = views.iter().map(|view| view.1).collect();
    let questions = c.questions_about_views(noted, &asked);
    times.add("questions", &mut since);
    let (answers, has_run_out) = answers_to(checked, questions.all(), in_parallel);
    times.add("answers", &mut since);
    let membership = questions.close(&answers);
    times.add("close", &mut since);
    if ran_out_of_stack || has_run_out || c.take_ran_out_of_stack() {
        problems.push(Problem { file: nowhere, pos: 0, what: "types that are nested too deeply".into() });
    }
    let layouts_at = |indexes: &[u32]| -> Vec<LayoutId> { indexes.iter().map(|&index| views[index as usize].0).collect() };
    for (&(layout, _), reach) in views.iter().zip(&membership.views) {
        let out = &mut program.layouts[layout.idx()];
        out.is_allocated = reach.is_allocated;
        out.may_be_frozen = reach.may_be_frozen;
        out.admits_foreign = reach.admits_foreign;
        out.members = layouts_at(&reach.members);
        out.specializations = layouts_at(&reach.specializations);
    }
    let mut explained = Vec::new();
    if explain.foreign {
        explained.append(&mut c.explain_foreign(&asked, &membership));
    }
    if explain.members {
        explained.append(&mut c.explain_members(&asked, &membership));
    }
    if explain.uninitialized {
        explained.append(&mut c.explain_uninitialized());
    }
    Linked { program, problems, pairs_asked: membership.pairs_asked, members_added: membership.members_added, explained, errors, times }
}
