//! What the translation of one file yields.
//!
//! A file is translated by the task that checks it, at the same time as other files are by other tasks. So a fragment is a program of
//! its own, with its own tables and its own numbering: the strings, the types, the layouts, the variables and the functions that the
//! code of the file mentions. What is also known outside the fragment has a key besides its number, which is the same in every fragment:
//! files, nodes and symbols are numbered before the first task, and a type of the checker is known by its identity. Nothing in a
//! fragment dies with the task: no `TypeId`, no atom.
//!
//! A fragment defines what its file declares: every function, every class, every variable, reached or not. Of what another file declares
//! it has what the translation has taken it for, a function without its body, a class with its members. That follows from the program
//! alone, so it is what the fragment of that file says too, and the link makes sure. The layout of an object type belongs to no file:
//! every fragment that has to know its fields defines it, all alike, and the link keeps one. See `link`.

use crate::build::Problem;
use crate::declared::DeclaredTable;
use crate::id::{FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId};
use crate::ir::{Def, Field, Func, Global, Layout, Literal, Method, NO_VARIABLE, Op, Prediction, STATIC_FIELD_IS_ANNOTATED, Strs, Value};
use bun_sema::bind::SymbolId;
use bun_sema::check::{Identity, MethodStore, Noted};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::program::FileId;
use std::sync::Mutex;

// ───────────────────────────── keys ─────────────────────────────

/// A function of the program, by what it is made from. The entry function is not among them: the link makes it.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum FuncKey {
    /// Evaluates the module once, after what it imports.
    Module(FileId),
    /// The evaluation of a module with top-level `await`, or that imports one.
    AsyncModuleBody(FileId),
    /// `import("./file")`
    DynamicImport(FileId),
    Function(FileId, FnId),
    /// The constructor of a class that declares none.
    DefaultConstructor(FileId, ClassId),
    /// Yields the object an enum is as a value.
    EnumObject(FileId, SymbolId),
    /// Yields the object for a module namespace or a TypeScript namespace used as a value.
    NamespaceObject(FileId, SymbolId),
}

impl FuncKey {
    /// The file whose fragment defines it.
    pub fn file(self) -> FileId {
        match self {
            FuncKey::Module(file)
            | FuncKey::AsyncModuleBody(file)
            | FuncKey::DynamicImport(file)
            | FuncKey::Function(file, _)
            | FuncKey::DefaultConstructor(file, _)
            | FuncKey::EnumObject(file, _)
            | FuncKey::NamespaceObject(file, _) => file,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum LayoutKey {
    /// `LayoutKind::Record`, by the type that says how the objects are laid out (`Checker::laid_out_as`).
    Record(Identity),
    /// `LayoutKind::Instance`
    Instance(FileId, ClassId),
    /// What the class object of a class that is not evaluated once closes over.
    ClassEnvironment(FileId, ClassId),
    /// Any other environment, by its number among those of the file, in the order the translation of the file makes them. Only the
    /// fragment of the file mentions it.
    Environment(FileId, u32),
}

impl LayoutKey {
    /// The file whose fragment has the last word on it. `None`: it belongs to no file.
    pub fn file(self) -> Option<FileId> {
        match self {
            LayoutKey::Record(_) => None,
            LayoutKey::Instance(file, _) | LayoutKey::ClassEnvironment(file, _) | LayoutKey::Environment(file, _) => Some(file),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum GlobalKey {
    /// What a declaration binds: a variable of a module, an export, a static field.
    Symbol(FileId, SymbolId),
    /// Where the object an enum is as a value is kept.
    Enum(FileId, SymbolId),
    /// Where the object for a module namespace or a TypeScript namespace used as a value is kept.
    Namespace(FileId, SymbolId),
    /// What a class that is evaluated once keeps to itself, by its number among the variables of the class, in the order the
    /// declaration gives rise to them.
    ClassVariable(FileId, ClassId, u32),
    /// What the compiler keeps for a module, by the name it has for it: `module`, `exports`, `evaluated`.
    OfModule(FileId, &'static str),
    /// What the compiler keeps for one place in the code of the file, by its number among those of the file: a template object. Only
    /// the fragment of the file mentions it.
    Hidden(FileId, u32),
    /// The namespace object of a module that is not compiled with the program, by its specifier.
    ExternalModule(Box<[u8]>),
}

impl GlobalKey {
    /// As `LayoutKey::file`.
    pub fn file(&self) -> Option<FileId> {
        match *self {
            GlobalKey::Symbol(file, _) | GlobalKey::Enum(file, _) | GlobalKey::Namespace(file, _) | GlobalKey::ClassVariable(file, ..) | GlobalKey::OfModule(file, _) | GlobalKey::Hidden(file, _) => Some(file),
            GlobalKey::ExternalModule(_) => None,
        }
    }
}

// ───────────────────────────── what the checker has noted ─────────────────────────────

/// What the checker has noted while something was translated (`Checker::take_noted`), with identities in the place of types
/// (`Noted::renamed`). Every type in it is kept (`Checker::keep_type`). It counts only if what it comes from is reached, which is known
/// when all tasks have ended.
pub type Notes = Noted<Identity>;

// ───────────────────────────── the parts of a fragment ─────────────────────────────

/// The numbers in a function or a layout that count in the tables of its fragment, each once, in the order they are first come by.
#[derive(Default)]
pub struct Mentions {
    pub strs: Vec<StrId>,
    pub tys: Vec<TyId>,
    pub layouts: Vec<LayoutId>,
    pub globals: Vec<GlobalId>,
    /// The functions that are called directly. Of a layout: the constructor, the methods and the accessors.
    pub called: Vec<FuncId>,
    /// The functions that closures are made of.
    pub values: Vec<FuncId>,
}

/// What goes with a function that the fragment defines.
pub struct Body {
    /// Of a function of a class: the layout of the class. Nothing runs it unless the declaration of the class is evaluated.
    /// `NONE`: it is of no class.
    pub class: LayoutId,
    /// The classes whose declarations the function evaluates, by their layouts.
    pub declares: Vec<LayoutId>,
    /// The classes that are laid out and whose class objects the function uses as values.
    pub classes_as_values: Vec<LayoutId>,
    pub notes: Notes,
    /// What holds besides if someone calls the function who does not know it, and hands it anything.
    pub notes_if_called_unknown: Notes,
    /// What could not be translated.
    pub problems: Vec<Problem>,
    /// Where the code of the function is in the text of its file, from where to where. Of a constructor also the fields of the objects
    /// of the class, which it initializes. None: whatever of the file is in no function, if it evaluates the module. The compiler has
    /// made it up, if not.
    pub spans: Vec<(u32, u32)>,
    /// What of that is not translated, because a constant decides that it does not run, or stands in its place.
    pub cut: Vec<(u32, u32)>,
    /// The import and export declarations that the bundler has dropped.
    pub dropped: Vec<(u32, u32)>,
    pub mentions: Mentions,
}

pub struct Function {
    pub key: FuncKey,
    /// Without blocks, unless there is a `body`: the function as whoever calls it has to know it. `None`: it is only named, closures
    /// of it are expected and nothing more.
    pub func: Option<Func>,
    /// The fragment defines the function.
    pub body: Option<Box<Body>>,
}

/// A layout as a fragment has it.
pub struct Definition {
    /// Without members and specializations, which the link finds.
    pub layout: Layout,
    /// Of `layout`.
    pub mentions: Mentions,
    /// Of a class that is not laid out: the class it extends, if that is laid out, which it constructs by its value. `NONE`: none.
    pub constructs: LayoutId,
    /// What holds if the layout is of any use: of what is stored to its fields by whoever does not know it. `None`: nothing.
    pub notes: Option<Box<Notes>>,
    /// What could not be translated of the declaration it comes from.
    pub problems: Vec<Problem>,
}

pub struct Shape {
    pub key: LayoutKey,
    /// `Layout::name`, for a message about a layout that is only named.
    pub name: StrId,
    /// The checker's type that it is the layout of, which is kept. `None`: no type stands for it, as for an environment and for a
    /// class that is not laid out.
    pub ty: Option<Identity>,
    /// `None`: the fragment only names the layout.
    pub definition: Option<Box<Definition>>,
}

pub struct Variable {
    pub key: GlobalKey,
    pub global: Global,
}

pub struct Fragment {
    /// `NO_FILE`: it comes from the link itself.
    pub file: FileId,
    /// The name of the file.
    pub path: StrId,
    pub strs: Strs,
    pub tys: DeclaredTable,
    /// By `ModuleId`.
    pub modules: Vec<FileId>,
    /// By `GlobalId`. Every fragment says of each variable it mentions what it holds.
    pub globals: Vec<Variable>,
    /// By `LayoutId`.
    pub layouts: Vec<Shape>,
    /// By `FuncId`. Those that the fragment defines are in an order that follows from the file.
    pub funcs: Vec<Function>,
    /// `Checker::globals_altered_in`
    pub altered_globals: Vec<StrId>,
    /// `Checker::stores_to_methods_in`, with identities in the place of types. Every type in it is kept.
    pub stores_to_methods: Vec<MethodStore<Identity>>,
}

/// In the place of the file of a fragment.
pub const NO_FILE: FileId = FileId(u32::MAX);

// ───────────────────────────── the numbers in the parts ─────────────────────────────

/// How a function is mentioned.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Used {
    Called,
    /// A closure is made of it.
    AsValue,
    /// It is the constructor, a method or an accessor of a class.
    AsMember,
    /// A closure of it is expected. That does not keep it.
    Expected,
}

/// What is done with every number in a function, a layout or a variable that counts in a table. `NONE` is not passed.
pub trait Ids {
    fn str(&mut self, id: &mut StrId);
    fn ty(&mut self, id: &mut TyId);
    fn layout(&mut self, id: &mut LayoutId);
    fn global(&mut self, id: &mut GlobalId);
    fn module(&mut self, id: &mut ModuleId);
    fn func(&mut self, id: &mut FuncId, used: Used);
}

macro_rules! pass {
    ($ids:ident.$kind:ident($id:expr $(, $used:expr)?)) => {
        if $id.is_some() {
            $ids.$kind($id $(, $used)?);
        }
    };
}

pub fn for_each_id_of_op(op: &mut Op, ids: &mut impl Ids) {
    match op {
        Op::Str(text) | Op::BigInt(text) | Op::ExternalModule(text) => pass!(ids.str(text)),
        Op::FreeGet { name, is_typeof: _ }
        | Op::FreeSet { name, value: _ }
        | Op::PropGet { obj: _, name }
        | Op::PropSet { obj: _, name, value: _ }
        | Op::PropHas { obj: _, name }
        | Op::PropDelete { obj: _, name }
        | Op::CallMethod { obj: _, name, args: _ }
        | Op::Operation { name, args: _ } => pass!(ids.str(name)),
        Op::FuncRef(func) | Op::Closure { func, env: _ } => pass!(ids.func(func, Used::AsValue)),
        Op::CallDirect { func, args: _ } => pass!(ids.func(func, Used::Called)),
        Op::GlobalGet(global) | Op::GlobalSet(global, _) => pass!(ids.global(global)),
        Op::New(layout)
        | Op::FieldGet { obj: _, layout, field: _ }
        | Op::FieldSet { obj: _, layout, field: _, value: _ }
        | Op::IsInstance { value: _, layout } => pass!(ids.layout(layout)),
        Op::Coerce { value: _, to, why: _ } => pass!(ids.ty(to)),
        Op::Undefined
        | Op::Null
        | Op::Bool(_)
        | Op::Int(_)
        | Op::Double(_)
        | Op::ElemGet { .. }
        | Op::ElemSet { .. }
        | Op::ElemHas { .. }
        | Op::ElemDelete { .. }
        | Op::NewArray(_)
        | Op::NewObject
        | Op::Binary { .. }
        | Op::Unary { .. }
        | Op::Relational { .. }
        | Op::StrictEq { .. }
        | Op::LooseEq { .. }
        | Op::Not(_)
        | Op::Truthy(_)
        | Op::TypeOf(_)
        | Op::InstanceOf { .. }
        | Op::ToStr(_)
        | Op::ToKey(_)
        | Op::IsNullish(_)
        | Op::StrConcat(_)
        | Op::IterOpen(_)
        | Op::IterHas { .. }
        | Op::IterGet { .. }
        | Op::IterClose(_)
        | Op::IterCloseForThrow(_)
        | Op::Call { .. }
        | Op::Construct { .. }
        | Op::Caught
        | Op::Poll
        | Op::Yield(_)
        | Op::ResumeMode
        | Op::Await(_) => {}
    }
}

/// First what whoever calls the function has to know, then the values in their order. Blocks hold numbers of the function alone.
pub fn for_each_id_of_func(func: &mut Func, ids: &mut impl Ids) {
    let Func { name, module, pos: _, kind: _, flags: _, length: _, env, this_declared, params, annotated: _, result, blocks: _, values } = func;
    pass!(ids.str(name));
    pass!(ids.module(module));
    pass!(ids.layout(env));
    pass!(ids.ty(this_declared));
    for param in params {
        pass!(ids.ty(param));
    }
    pass!(ids.ty(result));
    for value in values {
        let Value { def, pos: _, ty, prediction } = value;
        pass!(ids.ty(ty));
        match prediction {
            Prediction::None => {}
            Prediction::Ty(expected) => pass!(ids.ty(expected)),
            Prediction::Closure(func) => pass!(ids.func(func, Used::Expected)),
        }
        match def {
            Def::Param(..) => {}
            Def::Op(op) => for_each_id_of_op(op, ids),
        }
    }
}

/// A variable of a class, which is a module variable: see `Layout::environment`. `flags`: the bits that are no part of the number.
fn pass_variable(variable: &mut u32, flags: u32, ids: &mut impl Ids) {
    if *variable == NO_VARIABLE {
        return;
    }
    let mut global = GlobalId(*variable & !flags);
    ids.global(&mut global);
    *variable = global.0 | *variable & flags;
}

pub fn for_each_id_of_layout(layout: &mut Layout, ids: &mut impl Ids) {
    let Layout {
        kind: _,
        name,
        base,
        fields,
        methods,
        constructor,
        class_flags: _,
        environment,
        static_fields,
        is_allocated: _,
        may_be_frozen: _,
        admits_foreign: _,
        members,
        specializations,
    } = layout;
    let has_module_variables = environment.is_none();
    pass!(ids.str(name));
    pass!(ids.layout(base));
    for field in fields {
        let Field { name, declared, flags: _, literals } = field;
        pass!(ids.str(name));
        pass!(ids.ty(declared));
        for literal in literals {
            match literal {
                Literal::Str(text) => pass!(ids.str(text)),
                Literal::Num(_) => {}
            }
        }
    }
    pass!(ids.func(constructor, Used::AsMember));
    for method in methods {
        let Method { name, func, kind: _, flags: _, key } = method;
        pass!(ids.str(name));
        pass!(ids.func(func, Used::AsMember));
        if has_module_variables {
            pass_variable(key, 0, ids);
        }
    }
    pass!(ids.layout(environment));
    for (name, variable) in static_fields {
        pass!(ids.str(name));
        if has_module_variables {
            pass_variable(variable, STATIC_FIELD_IS_ANNOTATED, ids);
        }
    }
    for other in members.iter_mut().chain(specializations) {
        pass!(ids.layout(other));
    }
}

pub fn for_each_id_of_global(global: &mut Global, ids: &mut impl Ids) {
    let Global { name, module, declared, initialization: _ } = global;
    pass!(ids.str(name));
    pass!(ids.module(module));
    pass!(ids.ty(declared));
}

/// Finds the mentions of the functions and the layouts of one fragment, one after the other.
#[derive(Default)]
pub struct Mentioning {
    /// Goes up with each function or layout.
    round: u32,
    /// By number, for each table: the last round that came by it.
    strs: Vec<u32>,
    tys: Vec<u32>,
    layouts: Vec<u32>,
    globals: Vec<u32>,
    called: Vec<u32>,
    values: Vec<u32>,
    found: Mentions,
}

/// Whether the round comes by the number for the first time.
fn is_first(seen: &mut Vec<u32>, number: usize, round: u32) -> bool {
    if number >= seen.len() {
        seen.resize(number + 1, 0);
    }
    std::mem::replace(&mut seen[number], round) != round
}

impl Ids for Mentioning {
    fn str(&mut self, id: &mut StrId) {
        if is_first(&mut self.strs, id.idx(), self.round) {
            self.found.strs.push(*id);
        }
    }
    fn ty(&mut self, id: &mut TyId) {
        if is_first(&mut self.tys, id.idx(), self.round) {
            self.found.tys.push(*id);
        }
    }
    fn layout(&mut self, id: &mut LayoutId) {
        if is_first(&mut self.layouts, id.idx(), self.round) {
            self.found.layouts.push(*id);
        }
    }
    fn global(&mut self, id: &mut GlobalId) {
        if is_first(&mut self.globals, id.idx(), self.round) {
            self.found.globals.push(*id);
        }
    }
    /// The link has the module from the function or the variable itself.
    fn module(&mut self, _: &mut ModuleId) {}
    fn func(&mut self, id: &mut FuncId, used: Used) {
        match used {
            Used::Called | Used::AsMember => {
                if is_first(&mut self.called, id.idx(), self.round) {
                    self.found.called.push(*id);
                }
            }
            Used::AsValue => {
                if is_first(&mut self.values, id.idx(), self.round) {
                    self.found.values.push(*id);
                }
            }
            Used::Expected => {}
        }
    }
}

impl Mentioning {
    /// Nothing of the function is changed.
    pub fn of_func(&mut self, func: &mut Func) -> Mentions {
        self.round += 1;
        for_each_id_of_func(func, self);
        std::mem::take(&mut self.found)
    }

    /// Nothing of the layout is changed.
    pub fn of_layout(&mut self, layout: &mut Layout) -> Mentions {
        self.round += 1;
        for_each_id_of_layout(layout, self);
        std::mem::take(&mut self.found)
    }
}

// ───────────────────────────── handing them in ─────────────────────────────

/// Where the tasks of a check put the fragments. An invalid task is retried, and its files are translated again: the last fragment of
/// a file counts, and takes the place of the one before as a whole. No two tasks have one file at the same time.
pub struct Fragments {
    /// By `FileId`.
    by_file: Vec<Mutex<Option<Box<Fragment>>>>,
}

impl Fragments {
    /// `files`: how many the program has.
    pub fn new(files: usize) -> Fragments {
        Fragments { by_file: (0..files).map(|_| Mutex::new(None)).collect() }
    }

    pub fn put(&self, fragment: Box<Fragment>) {
        let place = &self.by_file[fragment.file.idx()];
        *place.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(fragment);
    }

    /// Once every task has ended.
    pub fn take(&self) -> Vec<Fragment> {
        let fragments = self.by_file.iter().filter_map(|place| place.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take());
        fragments.map(|fragment| *fragment).collect()
    }
}
