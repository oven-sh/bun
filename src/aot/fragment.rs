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
use crate::id::{BlockId, FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{Block, Def, Field, Func, Global, Layout, Literal, Method, NO_VARIABLE, Op, Prediction, STATIC_FIELD_IS_ANNOTATED, Strs, Value, Why};
use bun_sema::bind::SymbolId;
use bun_sema::check::{Identity, MethodStore, Noted, NumberFlow};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::program::FileId;
use std::sync::Mutex;

// ───────────────────────────── keys ─────────────────────────────

/// A function of the program, by what it is made from. The entry function is not among them: the link makes it.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum FuncKey {
    /// Evaluates the module once, after what it imports.
    Module(FileId),
    /// The statements of the module. `Module` calls it. Of a module with top-level `await`, or that imports one: what it imports too.
    ModuleBody(FileId),
    /// `import("./file")`
    DynamicImport(FileId),
    /// Evaluates the initializer of a variable of a module and stores it, when the variable is first read.
    Initializer(FileId, SymbolId),
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
            | FuncKey::ModuleBody(file)
            | FuncKey::DynamicImport(file)
            | FuncKey::Initializer(file, _)
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

/// A statement of the body of a module that need not run unless code that is reached mentions a variable it stores to: see `build::parts`.
pub struct ModulePart {
    /// The block it begins in, and how many operations of that come before it.
    pub from: (BlockId, u32),
    /// The block it ends in, and with how many operations of that it ends. If that is another block, those are all its own.
    pub to: (BlockId, u32),
    /// The blocks that were made for it, from the first to before the last of these numbers. The one it ends in is among them, unless it ends where it begins.
    pub blocks: (u32, u32),
    pub stores: Vec<GlobalId>,
    pub mentions: Mentions,
}

impl ModulePart {
    /// Its operations and the parameters of its blocks.
    pub fn values(&self, func: &Func) -> Vec<V> {
        let ((from, start), (to, end)) = (self.from, self.to);
        if from == to {
            return func.blocks[from.idx()].ops[start as usize..end as usize].to_vec();
        }
        let mut values = func.blocks[from.idx()].ops[start as usize..].to_vec();
        for block in (self.blocks.0..self.blocks.1).map(BlockId) {
            let Block { params, ops, term: _ } = &func.blocks[block.idx()];
            if block == to {
                values.extend_from_slice(&ops[..end as usize]);
            } else {
                values.extend_from_slice(params);
                values.extend_from_slice(ops);
            }
        }
        values
    }
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
    /// The names of the properties that the function makes and that none of its operations stores: a field of a class that starts as
    /// `undefined`.
    pub stored_besides: Vec<StrId>,
    /// `Checker::number_flows_in`: those that the function runs, with strings of the fragment in the place of names.
    pub number_flows: Vec<NumberFlow<StrId>>,
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
    /// Of the function that evaluates a module, in their order. The link takes them out or leaves them in, and then there are none.
    pub parts: Vec<ModulePart>,
    /// Without those of `parts`.
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
    /// `Checker::prototype_property_names_in`
    pub prototype_property_names: Vec<StrId>,
    /// `Checker::stores_to_methods_in`, with identities in the place of types. Every type in it is kept.
    pub stores_to_methods: Vec<MethodStore<Identity>>,
    /// Of a file of builtin functions: what native code asks for a function by, the function, its `ImplementationVisibility` as a number.
    pub builtin_functions: Vec<(u32, FuncKey, u32)>,
    /// How many times the file has been translated, this time included: more than once if a task was invalid.
    pub times_translated: u32,
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
        Op::FuncRef(func) | Op::Closure { func, captures: _ } | Op::ClosureOnce { func, captures: _, env: _, field: _ } => pass!(ids.func(func, Used::AsValue)),
        Op::CallDirect { func, args: _ } => pass!(ids.func(func, Used::Called)),
        Op::GlobalGet(global) | Op::GlobalSet(global, _) => pass!(ids.global(global)),
        Op::New(layout)
        | Op::FieldGet { obj: _, layout, field: _ }
        | Op::FieldSet { obj: _, layout, field: _, value: _ }
        | Op::IsInstance { value: _, layout } => pass!(ids.layout(layout)),
        Op::NewWith { layout, name, value: _ } => {
            pass!(ids.layout(layout));
            pass!(ids.str(name));
        }
        Op::Coerce { value: _, to, why } => {
            pass!(ids.ty(to));
            if let Why::NonNull(text) = why {
                pass!(ids.str(text));
            }
        }
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
    for_each_id_of_header(func, ids);
    for value in &mut func.values {
        for_each_id_of_value(value, ids);
    }
}

fn for_each_id_of_header(func: &mut Func, ids: &mut impl Ids) {
    let Func { name, module, pos: _, kind: _, flags: _, length: _, captures, this_declared, params, annotated: _, result, blocks: _, values: _ } = func;
    pass!(ids.str(name));
    pass!(ids.module(module));
    for capture in captures {
        pass!(ids.ty(capture));
    }
    pass!(ids.ty(this_declared));
    for param in params {
        pass!(ids.ty(param));
    }
    pass!(ids.ty(result));
}

fn for_each_id_of_value(value: &mut Value, ids: &mut impl Ids) {
    let Value { def, pos: _, ty, prediction } = value;
    pass!(ids.ty(ty));
    match prediction {
        Prediction::None => {}
        Prediction::Ty(expected) | Prediction::Field(expected) => pass!(ids.ty(expected)),
        Prediction::Closure(func) => pass!(ids.func(func, Used::Expected)),
        Prediction::ByKey(property) => pass!(ids.str(property)),
    }
    match def {
        Def::Param(..) => {}
        Def::Op(op) => for_each_id_of_op(op, ids),
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
        declared_path,
        declared_line: _,
    } = layout;
    let has_module_variables = environment.is_none();
    pass!(ids.str(name));
    pass!(ids.layout(base));
    for field in fields {
        let Field { name, declared, flags: _, literals, type_text, only_function, only_function_flags: _ } = field;
        pass!(ids.str(name));
        pass!(ids.ty(declared));
        pass!(ids.str(type_text));
        pass!(ids.func(only_function, Used::Expected));
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
    pass!(ids.str(declared_path));
}

pub fn for_each_id_of_global(global: &mut Global, ids: &mut impl Ids) {
    let Global { name, module, declared, initialization: _, only_function, only_function_flags: _ } = global;
    pass!(ids.str(name));
    pass!(ids.module(module));
    pass!(ids.ty(declared));
    pass!(ids.func(only_function, Used::Expected));
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

    /// The same for the values that are meant, by their numbers. `with_header`: and for what whoever calls the function has to know.
    pub fn of_values(&mut self, func: &mut Func, with_header: bool, is_meant: impl Fn(usize) -> bool) -> Mentions {
        self.round += 1;
        if with_header {
            for_each_id_of_header(func, self);
        }
        for (index, value) in func.values.iter_mut().enumerate() {
            if is_meant(index) {
                for_each_id_of_value(value, self);
            }
        }
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

    pub fn put(&self, mut fragment: Box<Fragment>) {
        let mut place = self.by_file[fragment.file.idx()].lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        fragment.times_translated += place.as_ref().map_or(0, |earlier| earlier.times_translated);
        *place = Some(fragment);
    }

    /// Once every task has ended.
    pub fn take(&self) -> Vec<Fragment> {
        let fragments = self.by_file.iter().filter_map(|place| place.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take());
        fragments.map(|fragment| *fragment).collect()
    }
}
