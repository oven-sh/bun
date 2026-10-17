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
use crate::declared::{Declared, DeclaredTable, Part};
use crate::id::{BlockId, FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{Block, Def, Field, Func, FuncKind, Global, Layout, Literal, Method, NO_VARIABLE, Op, Operation, Prediction, Strs, Value, CoerceReason};
use bun_sema::bind::SymbolId;
use bun_sema::check::{Identity, MethodStore, FlowNotes, NumberFlow};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::program::FileId;
use bun_sema::util::{InParallel, for_each_mut};
use std::hash::{BuildHasher, Hash};
use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicU32, Ordering};
use bun_threading::Guarded;

// ───────────────────────────── keys ─────────────────────────────

/// A function of the program, by what it is made from. The entry function is not among them: the link makes it.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum FuncKey {
    /// Evaluates the module once, after what it imports.
    Module(FileId),
    /// The statements of the module. `Module` calls it, or `ModuleDriver` where a top-level `await` is reached from the module.
    ModuleBody(FileId),
    ModuleTouch(FileId),
    ModuleSettling(FileId),
    ModuleDriver(FileId),
    ModuleInner(FileId),
    /// `import("./file")`; of a CommonJS module: whether as Node.js has it.
    DynamicImport(FileId, bool),
    Required(FileId),
    DynamicImportBody(FileId, bool),
    /// Evaluates the initializer of a variable of a module and stores it, when the variable is first read.
    Initializer(FileId, SymbolId),
    Function(FileId, FnId),
    TypedBody(FileId, FnId),
    GenericEntrypoint(FileId, FnId),
    UntypedClone(FileId, FnId, FnId),
    /// The constructor of a class that declares none.
    DefaultConstructor(FileId, ClassId),
    /// Yields the object an enum is as a value.
    EnumObject(FileId, SymbolId),
    /// Yields the object for a module namespace or a TypeScript namespace used as a value.
    NamespaceObject(FileId, SymbolId),
    /// Yields what the export of a number is now: see `MakeModuleNamespace`.
    ModuleNamespaceReader(FileId),
    /// What an ES module reads from a CommonJS module, as long as what that exports is not remembered: a name it is handed; `default`, as Node.js has it or not.
    ExportedObjectMember(FileId),
    ExportedObjectDefault(FileId, bool),
    FilesByPath(FileId),
    EvaluateByIndex(FileId),
    EvaluateSingleFile(FileId, FileId),
    ExportVariablesReader(FileId),
    NamespaceForHost(FileId),
    Validator(FileId, u32),
}

impl FuncKey {
    /// The file whose fragment defines it.
    pub fn file(self) -> FileId {
        match self {
            FuncKey::Module(file)
            | FuncKey::ModuleBody(file)
            | FuncKey::ModuleTouch(file)
            | FuncKey::ModuleSettling(file)
            | FuncKey::ModuleDriver(file)
            | FuncKey::ModuleInner(file)
            | FuncKey::DynamicImport(file, _)
            | FuncKey::Required(file)
            | FuncKey::DynamicImportBody(file, _)
            | FuncKey::Initializer(file, _)
            | FuncKey::Function(file, _)
            | FuncKey::TypedBody(file, _)
            | FuncKey::GenericEntrypoint(file, _)
            | FuncKey::UntypedClone(file, _, _)
            | FuncKey::DefaultConstructor(file, _)
            | FuncKey::EnumObject(file, _)
            | FuncKey::NamespaceObject(file, _)
            | FuncKey::ModuleNamespaceReader(file)
            | FuncKey::ExportedObjectMember(file)
            | FuncKey::ExportedObjectDefault(file, _)
            | FuncKey::FilesByPath(file)
            | FuncKey::EvaluateByIndex(file)
            | FuncKey::EvaluateSingleFile(file, _)
            | FuncKey::ExportVariablesReader(file)
            | FuncKey::NamespaceForHost(file)
            | FuncKey::Validator(file, _) => file,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum LayoutKey {
    /// `LayoutKind::Record`, by the type that says how the objects are laid out (`Checker::layout_defining_type`).
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
    ModuleInternal(FileId, &'static str),
    /// What a CommonJS module exports under the name, where it keeps that in variables.
    Export(FileId, Box<[u8]>),
    /// What the compiler keeps for one place in the code of the file, by its number among those of the file: a template object. Only
    /// the fragment of the file mentions it.
    Hidden(FileId, u32),
    LazyVariableState(FileId, SymbolId),
    /// The namespace object of a module that is not compiled with the program, by its specifier.
    ExternalModule(Box<[u8]>),
}

impl GlobalKey {
    /// As `LayoutKey::file`.
    pub fn file(&self) -> Option<FileId> {
        match *self {
            GlobalKey::Symbol(file, _) | GlobalKey::Enum(file, _) | GlobalKey::Namespace(file, _) | GlobalKey::ClassVariable(file, ..) | GlobalKey::ModuleInternal(file, _) | GlobalKey::Export(file, _) | GlobalKey::Hidden(file, _) | GlobalKey::LazyVariableState(file, _) => Some(file),
            GlobalKey::ExternalModule(_) => None,
        }
    }
}

// ───────────────────────────── what the checker has noted ─────────────────────────────

/// What the checker has noted while something was translated (`Checker::take_notes_recorded`), with identities in the place of types
/// (`FlowNotes::renamed`). Every type in it is kept (`Checker::keep_type`). It counts only if what it comes from is reached, which is known
/// when all tasks have ended.
pub type Notes = FlowNotes<Identity>;

// ───────────────────────────── the parts of a fragment ─────────────────────────────

/// The numbers in a function or a layout that count in the tables of its fragment, each once, in the order they are first come by.
#[derive(Default)]
pub struct ReferencedIds {
    all: Vec<u32>,
    ends: [u32; 5],
}

impl ReferencedIds {
    #[inline]
    fn part(&self, index: usize) -> &[u32] {
        let start = if index == 0 { 0 } else { self.ends[index - 1] as usize };
        let end = self.ends.get(index).map_or(self.all.len(), |&end| end as usize);
        &self.all[start..end]
    }
    pub fn strs(&self) -> impl Iterator<Item = StrId> + '_ {
        self.part(0).iter().map(|&id| StrId(id))
    }
    pub fn tys(&self) -> impl Iterator<Item = TyId> + '_ {
        self.part(1).iter().map(|&id| TyId(id))
    }
    pub fn layouts(&self) -> impl Iterator<Item = LayoutId> + '_ {
        self.part(2).iter().map(|&id| LayoutId(id))
    }
    pub fn globals(&self) -> impl Iterator<Item = GlobalId> + '_ {
        self.part(3).iter().map(|&id| GlobalId(id))
    }
    /// The functions that are called directly. Of a layout: the constructor, the methods and the accessors.
    pub fn called(&self) -> impl Iterator<Item = FuncId> + '_ {
        self.part(4).iter().map(|&id| FuncId(id))
    }
    /// The functions that closures are made of.
    pub fn values(&self) -> impl Iterator<Item = FuncId> + '_ {
        self.part(5).iter().map(|&id| FuncId(id))
    }
    pub fn add_layout(&mut self, layout: LayoutId) {
        if !self.part(2).contains(&layout.0) {
            self.all.insert(self.ends[2] as usize, layout.0);
            for end in &mut self.ends[2..] {
                *end += 1;
            }
        }
    }
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
    /// Those of them that it does not read.
    pub write_only_globals: Vec<GlobalId>,
    pub mentions: ReferencedIds,
    /// By parameter of the block it ends in, if that is not the one it begins in: the value from before the part that every way through the part
    /// hands it. `NONE`: it is what the statement yields. The front end hands a local that lives across a join through the join.
    pub passed_through: Vec<V>,
}

impl ModulePart {
    pub fn find_passed_through_values(&mut self, func: &Func) {
        let ((from, start), (to, _)) = (self.from, self.to);
        if from == to || func.blocks[to.idx()].params.is_empty() {
            return;
        }
        let is_own = |block: BlockId| (self.blocks.0..self.blocks.1).contains(&block.0);
        let own_blocks = || (self.blocks.0..self.blocks.1).map(BlockId);
        // By value of the part: what it is to whoever stands before the part. `NONE`: the part makes it.
        let mut seen: rustc_hash::FxHashMap<V, V> = Default::default();
        let own_operations = own_blocks().flat_map(|block| &func.blocks[block.idx()].ops);
        seen.extend(func.blocks[from.idx()].ops[start as usize..].iter().chain(own_operations).map(|&v| (v, V::NONE)));
        let mut args_by_target: rustc_hash::FxHashMap<BlockId, Vec<crate::ir::Args>> = Default::default();
        for source in std::iter::once(from).chain(own_blocks()) {
            if let Some(term) = &func.blocks[source.idx()].term {
                term.for_each_target(|target| args_by_target.entry(target.block).or_default().push(target.args.clone()));
            }
        }
        let mut is_asked: rustc_hash::FxHashSet<V> = Default::default();
        let mut asked: Vec<V> = func.blocks[to.idx()].params.clone();
        while let Some(&param) = asked.last() {
            let Def::Param(block, index) = func.values[param.idx()].def else { unreachable!() };
            if seen.contains_key(&param) {
                asked.pop();
                continue;
            }
            is_asked.insert(param);
            let (mut found, mut agree, mut waits_for) = (V::NONE, true, V::NONE);
            for args in args_by_target.get(&block).map_or(&[][..], |list| &list[..]) {
                let arg = args.get(index as usize).copied().unwrap_or(V::NONE);
                let handed = match (seen.get(&arg), arg.is_some().then(|| &func.values[arg.idx()].def)) {
                    (Some(&answer), _) => answer,
                    (None, Some(&Def::Param(of, _))) if is_own(of) && is_asked.contains(&arg) => V::NONE,
                    (None, Some(&Def::Param(of, _))) if is_own(of) => {
                        waits_for = arg;
                        break;
                    }
                    _ => arg,
                };
                agree &= handed.is_some() && (found.is_none() || found == handed);
                found = handed;
            }
            if waits_for.is_some() {
                asked.push(waits_for);
                continue;
            }
            seen.insert(param, if agree { found } else { V::NONE });
            asked.pop();
        }
        self.passed_through = func.blocks[to.idx()].params.iter().map(|param| seen[param]).collect();
    }

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
                values.extend(params.iter().zip(&self.passed_through).filter(|(_, handed)| handed.is_none()).map(|(&param, _)| param));
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
    pub classes_as_values: Vec<LayoutId>,
    /// The names of the properties that the function makes and that none of its operations stores: a field of a class that starts as
    /// `undefined`.
    pub implicit_stores: Vec<StrId>,
    /// `Checker::number_flows_in`: those that the function runs, with strings of the fragment in the place of names.
    pub number_flows: Vec<NumberFlow<StrId>>,
    pub notes: Notes,
    /// What holds besides if someone calls the function who does not know it, and hands it anything.
    pub notes_for_unknown_callers: Notes,
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
    pub mentions: ReferencedIds,
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
    pub mentions: ReferencedIds,
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
    /// `Checker::mutated_globals_in`
    pub mutated_globals: Vec<StrId>,
    /// `Checker::prototype_property_names_in`
    pub prototype_property_names: Vec<StrId>,
    pub regexp_literals: Vec<(StrId, StrId)>,
    /// `Checker::method_stores_in`, with identities in the place of types. Every type in it is kept.
    pub method_stores: Vec<MethodStore<Identity>>,
    /// Of a file of builtin functions: what native code asks for a function by, the function, its `ImplementationVisibility` as a number.
    pub builtin_functions: Vec<(u32, FuncKey, u32)>,
    /// How many times the file has been translated, this time included: more than once if a task was invalid.
    pub translation_count: u32,
    pub program_ids: LocalToProgram,
    pub summary: Summary,
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

pub fn for_each_op_id(op: &mut Op, ids: &mut impl Ids) {
    match op {
        Op::Str(text) | Op::BigInt(text) | Op::ExternalModule(text) => pass!(ids.str(text)),
        Op::FreeGet { name, is_typeof: _ }
        | Op::FreeSet { name, value: _ }
        | Op::PropGet { obj: _, name }
        | Op::PropSet { obj: _, name, value: _ }
        | Op::PropHas { obj: _, name }
        | Op::PropDelete { obj: _, name }
        | Op::CallMethod { obj: _, name, args: _ } => pass!(ids.str(name)),
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
            if let CoerceReason::NonNull(text) = why {
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
        | Op::CaughtException
        | Op::Poll
        | Op::Operation { .. }
        | Op::Yield(_)
        | Op::ResumeMode
        | Op::Await(_) => {}
    }
}

/// First what whoever calls the function has to know, then the values in their order. Blocks hold numbers of the function alone.
pub fn for_each_func_id(func: &mut Func, ids: &mut impl Ids) {
    for_each_header_id(func, ids);
    for value in &mut func.values {
        for_each_value_id(value, ids);
    }
}

fn for_each_header_id(func: &mut Func, ids: &mut impl Ids) {
    let Func { name, module, pos: _, source_start: _, source_end: _, kind: _, flags: _, length: _, captures, declared_this_type, params, annotated: _, result, blocks: _, values: _, spans: _ } = func;
    pass!(ids.str(name));
    pass!(ids.module(module));
    for capture in captures {
        pass!(ids.ty(capture));
    }
    pass!(ids.ty(declared_this_type));
    for param in params {
        pass!(ids.ty(param));
    }
    pass!(ids.ty(result));
}

fn for_each_value_id(value: &mut Value, ids: &mut impl Ids) {
    pass!(ids.ty(&mut value.ty));
    pass!(ids.ty(&mut value.signature));
    let mut prediction = value.prediction();
    match &mut prediction {
        Prediction::None => {}
        Prediction::Ty(expected) | Prediction::Field(expected) => pass!(ids.ty(expected)),
        Prediction::Closure(func) => pass!(ids.func(func, Used::Expected)),
        Prediction::ByKey(property) => pass!(ids.str(property)),
    }
    value.set_prediction(prediction);
    match &mut value.def {
        Def::Param(..) => {}
        Def::Op(op) => for_each_op_id(op, ids),
    }
}

/// A variable of a class, which is a module variable: see `Layout::environment`.
fn visit_class_variable(variable: &mut u32, ids: &mut impl Ids) {
    if *variable == NO_VARIABLE {
        return;
    }
    let mut global = GlobalId(*variable);
    ids.global(&mut global);
    *variable = global.0;
}

pub fn for_each_layout_id(layout: &mut Layout, ids: &mut impl Ids) {
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
        accepts_untyped: _,
        is_relaxed_for_logging: _,
        accepts_only_other_layouts: _,
        members,
        structural_subtypes,
        specializations,
        declared_path,
        declared_line: _,
    } = layout;
    let has_module_variables = environment.is_none();
    pass!(ids.str(name));
    pass!(ids.layout(base));
    for field in fields {
        let Field { name, declared, flags: _, literals, type_text, single_function, single_function_flags: _ } = field;
        pass!(ids.str(name));
        pass!(ids.ty(declared));
        pass!(ids.str(type_text));
        pass!(ids.func(single_function, Used::Expected));
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
            visit_class_variable(key, ids);
        }
    }
    pass!(ids.layout(environment));
    for (name, declared) in static_fields {
        pass!(ids.str(name));
        pass!(ids.ty(declared));
    }
    for other in members.iter_mut().chain(structural_subtypes).chain(specializations) {
        pass!(ids.layout(other));
    }
    pass!(ids.str(declared_path));
}

pub fn for_each_global_id(global: &mut Global, ids: &mut impl Ids) {
    let Global { name, module, declared, initialization: _, single_function, single_function_flags: _ } = global;
    pass!(ids.str(name));
    pass!(ids.module(module));
    pass!(ids.ty(declared));
    pass!(ids.func(single_function, Used::Expected));
}

/// Finds the mentions of the functions and the layouts of one fragment, one after the other.
#[derive(Default)]
pub struct ReferenceCollector {
    /// Goes up with each function or layout.
    round: u32,
    /// By number, for each table: the last round that came by it.
    strs: Vec<u32>,
    tys: Vec<u32>,
    layouts: Vec<u32>,
    globals: Vec<u32>,
    called: Vec<u32>,
    values: Vec<u32>,
    found: [Vec<u32>; 6],
}

/// Whether the round comes by the number for the first time.
fn is_first(seen: &mut Vec<u32>, number: usize, round: u32) -> bool {
    if number >= seen.len() {
        seen.resize(number + 1, 0);
    }
    std::mem::replace(&mut seen[number], round) != round
}

impl Ids for ReferenceCollector {
    fn str(&mut self, id: &mut StrId) {
        if is_first(&mut self.strs, id.idx(), self.round) {
            self.found[0].push(id.0);
        }
    }
    fn ty(&mut self, id: &mut TyId) {
        if is_first(&mut self.tys, id.idx(), self.round) {
            self.found[1].push(id.0);
        }
    }
    fn layout(&mut self, id: &mut LayoutId) {
        if is_first(&mut self.layouts, id.idx(), self.round) {
            self.found[2].push(id.0);
        }
    }
    fn global(&mut self, id: &mut GlobalId) {
        if is_first(&mut self.globals, id.idx(), self.round) {
            self.found[3].push(id.0);
        }
    }
    /// The link has the module from the function or the variable itself.
    fn module(&mut self, _: &mut ModuleId) {}
    fn func(&mut self, id: &mut FuncId, used: Used) {
        match used {
            Used::Called | Used::AsMember => {
                if is_first(&mut self.called, id.idx(), self.round) {
                    self.found[4].push(id.0);
                }
            }
            Used::AsValue => {
                if is_first(&mut self.values, id.idx(), self.round) {
                    self.found[5].push(id.0);
                }
            }
            Used::Expected => {}
        }
    }
}

impl ReferenceCollector {
    fn take_referenced_ids(&mut self) -> ReferencedIds {
        let mut mentions = ReferencedIds { all: Vec::with_capacity(self.found.iter().map(Vec::len).sum()), ends: [0; 5] };
        for (index, part) in self.found.iter_mut().enumerate() {
            mentions.all.extend_from_slice(part);
            part.clear();
            if let Some(end) = mentions.ends.get_mut(index) {
                *end = mentions.all.len() as u32;
            }
        }
        mentions
    }

    /// Nothing of the function is changed.
    pub fn collect_func(&mut self, func: &mut Func) -> ReferencedIds {
        self.round += 1;
        for_each_func_id(func, self);
        self.take_referenced_ids()
    }

    /// The same for the values that are meant, by their numbers. `with_header`: and for what whoever calls the function has to know.
    pub fn of_values(&mut self, func: &mut Func, with_header: bool, is_meant: impl Fn(usize) -> bool) -> ReferencedIds {
        self.round += 1;
        if with_header {
            for_each_header_id(func, self);
        }
        for (index, value) in func.values.iter_mut().enumerate() {
            if is_meant(index) {
                for_each_value_id(value, self);
            }
        }
        self.take_referenced_ids()
    }

    /// Nothing of the layout is changed.
    pub fn of_layout(&mut self, layout: &mut Layout) -> ReferencedIds {
        self.round += 1;
        for_each_layout_id(layout, self);
        self.take_referenced_ids()
    }
}

// ───────────────────────────── program-wide ids ─────────────────────────────

#[derive(Default)]
pub struct LocalToProgram {
    pub strs: Vec<u32>,
    pub tys: Vec<u32>,
    pub layouts: Vec<u32>,
    pub globals: Vec<u32>,
    pub funcs: Vec<u32>,
}

pub mod outline_flags {
    pub const HAS_HEADER: u8 = 1;
    pub const HAS_BODY: u8 = 1 << 1;
    pub const IS_CONSTRUCTOR: u8 = 1 << 2;
    pub const HAS_PARTS: u8 = 1 << 3;
    pub const EVALUATES_MODULE: u8 = 1 << 4;
    pub const RUNS_AT_START: u8 = 1 << 5;
    pub const REQUESTS_RUNTIME_MODULES: u8 = 1 << 6;
}

#[derive(Copy, Clone)]
pub struct FunctionOutline {
    start: u32,
    ends: [u32; Outline::LISTS],
    pub fragment: u32,
    pub index: u32,
    pub id: u32,
    pub class: LayoutId,
    pub class_id: u32,
    pub module: ModuleId,
    pub name: StrId,
    pub file: FileId,
    pub captures: u32,
    pub flags: u8,
}

impl FunctionOutline {
    pub fn has(&self, flag: u8) -> bool {
        self.flags & flag != 0
    }

    pub fn list(&self, list: usize) -> std::ops::Range<usize> {
        (if list == 0 { self.start } else { self.ends[list - 1] }) as usize..self.ends[list] as usize
    }
}

#[derive(Copy, Clone)]
pub struct LayoutOutline {
    start: u32,
    ends: [u32; Outline::LAYOUT_LISTS],
    pub fragment: u32,
    pub index: u32,
    pub base: LayoutId,
    pub constructs: LayoutId,
    pub constructs_id: u32,
}

impl LayoutOutline {
    pub fn list(&self, list: usize) -> std::ops::Range<usize> {
        (if list == 0 { self.start } else { self.ends[list - 1] }) as usize..self.ends[list] as usize
    }
}

#[derive(Copy, Clone)]
pub struct VariableOutline {
    pub fragment: u32,
    pub index: u32,
    pub declared: TyId,
    pub declared_id: u32,
}

#[derive(Default)]
pub struct Outline {
    pub funcs: Vec<FunctionOutline>,
    pub layouts: Vec<LayoutOutline>,
    pub variables: Vec<VariableOutline>,
    pub local: Vec<u32>,
    pub program: Vec<u32>,
    pub funcs_with_parts: Vec<u32>,
    func_slots: Vec<AtomicU32>,
    layout_slots: Vec<AtomicU32>,
    variable_slots: Vec<AtomicU32>,
}

pub struct OutlineBatch<'a> {
    pub fragment: u32,
    pub file: FileId,
    pub ids: &'a LocalToProgram,
    pub summary: &'a Summary,
    pub first: [u32; 3],
    pub functions: &'a mut [Function],
    pub shapes: &'a mut [Shape],
    pub variables: &'a [Variable],
    is_preferred: [Vec<bool>; 3],
    list_len: usize,
    rebuilt_list_len: usize,
}

impl<'a> OutlineBatch<'a> {
    pub fn new(fragment: u32, file: FileId, ids: &'a LocalToProgram, summary: &'a Summary, first: [u32; 3], functions: &'a mut [Function], shapes: &'a mut [Shape], variables: &'a [Variable]) -> OutlineBatch<'a> {
        OutlineBatch { fragment, file, ids, summary, first, functions, shapes, variables, is_preferred: Default::default(), list_len: 0, rebuilt_list_len: 0 }
    }
}

struct ListWriter<'a> {
    local: &'a mut [MaybeUninit<u32>],
    program: &'a mut [MaybeUninit<u32>],
    written: usize,
    start: u32,
}

impl ListWriter<'_> {
    fn extend(&mut self, locals: impl Iterator<Item = u32>, ids: &[u32]) -> u32 {
        for local in locals {
            self.local[self.written].write(local);
            self.program[self.written].write(if local == u32::MAX { local } else { ids[local as usize] });
            self.written += 1;
        }
        self.start + self.written as u32
    }
}

fn function_list_len(function: &Function) -> usize {
    let header_len = function.func.as_ref().map_or(0, |func| 2 + func.captures.len() + func.params.len());
    let body_len = function.body.as_ref().map_or(0, |body| body.mentions.all.len() + body.classes_as_values.len() + body.declares.len());
    header_len + body_len
}

fn outline_function(function: &Function, fragment: u32, index: u32, fragment_file: FileId, ids: &LocalToProgram, lists: &mut ListWriter<'_>) -> FunctionOutline {
    use outline_flags::{EVALUATES_MODULE, HAS_BODY, HAS_HEADER, HAS_PARTS, IS_CONSTRUCTOR};
    let start = lists.start + lists.written as u32;
    let runs_at_start = matches!(function.key, FuncKey::Module(_) | FuncKey::ModuleBody(_) | FuncKey::ModuleTouch(_) | FuncKey::ModuleSettling(_));
    let mut outline = FunctionOutline {
        start,
        ends: [start; Outline::LISTS],
        fragment,
        index,
        id: ids.funcs[index as usize],
        class: LayoutId::NONE,
        class_id: u32::MAX,
        module: ModuleId::NONE,
        name: StrId::NONE,
        file: function.key.file(),
        captures: 0,
        flags: if runs_at_start { outline_flags::RUNS_AT_START } else { 0 },
    };
    if let Some(func) = &function.func {
        outline.flags |= HAS_HEADER | if func.kind == FuncKind::Constructor { IS_CONSTRUCTOR } else { 0 };
        (outline.module, outline.name, outline.captures) = (func.module, func.name, func.captures.len() as u32);
        outline.ends[Outline::HEADER_TYS] = lists.extend([func.declared_this_type, func.result].into_iter().chain(func.captures.iter().copied()).chain(func.params.iter().copied()).map(|ty| ty.0), &ids.tys);
    }
    let header_end = outline.ends[Outline::HEADER_TYS];
    outline.ends[Outline::STRS..].fill(header_end);
    if let Some(body) = &function.body {
        outline.flags |= HAS_BODY | if body.parts.is_empty() { 0 } else { HAS_PARTS } | if function.key == FuncKey::Module(fragment_file) { EVALUATES_MODULE } else { 0 };
        outline.class = body.class;
        outline.class_id = if body.class.is_none() { u32::MAX } else { ids.layouts[body.class.idx()] };
        outline.ends[Outline::STRS] = lists.extend(body.mentions.strs().map(|id| id.0), &ids.strs);
        outline.ends[Outline::TYS] = lists.extend(body.mentions.tys().map(|id| id.0), &ids.tys);
        outline.ends[Outline::LAYOUTS] = lists.extend(body.mentions.layouts().map(|id| id.0), &ids.layouts);
        outline.ends[Outline::GLOBALS] = lists.extend(body.mentions.globals().map(|id| id.0), &ids.globals);
        outline.ends[Outline::CALLED] = lists.extend(body.mentions.called().map(|id| id.0), &ids.funcs);
        outline.ends[Outline::VALUES] = lists.extend(body.mentions.values().map(|id| id.0), &ids.funcs);
        outline.ends[Outline::CLASSES_AS_VALUES] = lists.extend(body.classes_as_values.iter().map(|id| id.0), &ids.layouts);
        outline.ends[Outline::DECLARES] = lists.extend(body.declares.iter().map(|id| id.0), &ids.layouts);
    }
    outline
}

fn outline_layout(definition: &Definition, fragment: u32, index: u32, ids: &LocalToProgram, lists: &mut ListWriter<'_>) -> LayoutOutline {
    let start = lists.start + lists.written as u32;
    let mentions = &definition.mentions;
    let ends = [
        lists.extend(mentions.strs().map(|id| id.0), &ids.strs),
        lists.extend(mentions.tys().map(|id| id.0), &ids.tys),
        lists.extend(mentions.layouts().map(|id| id.0), &ids.layouts),
        lists.extend(mentions.globals().map(|id| id.0), &ids.globals),
        lists.extend(mentions.called().map(|id| id.0), &ids.funcs),
        lists.extend(mentions.values().map(|id| id.0), &ids.funcs),
    ];
    let constructs = definition.constructs;
    LayoutOutline { start, ends, fragment, index, base: definition.layout.base, constructs, constructs_id: if constructs.is_none() { u32::MAX } else { ids.layouts[constructs.idx()] } }
}

fn slot_at(slots: &[AtomicU32], id: u32) -> Option<usize> {
    Some(slots.get(id as usize)?.load(Ordering::Relaxed)).filter(|&slot| slot != u32::MAX).map(|slot| slot as usize)
}

impl Outline {
    pub const HEADER_TYS: usize = 0;
    pub const STRS: usize = 1;
    pub const TYS: usize = 2;
    pub const LAYOUTS: usize = 3;
    pub const GLOBALS: usize = 4;
    pub const CALLED: usize = 5;
    pub const VALUES: usize = 6;
    pub const CLASSES_AS_VALUES: usize = 7;
    pub const DECLARES: usize = 8;
    const LISTS: usize = 9;
    pub const LAYOUT_LISTS: usize = 6;

    pub fn grow(&mut self, ids: &ProgramIds) {
        self.func_slots.resize_with(ids.funcs.bound(), || AtomicU32::new(u32::MAX));
        self.layout_slots.resize_with(ids.layouts.bound(), || AtomicU32::new(u32::MAX));
        self.variable_slots.resize_with(ids.globals.bound(), || AtomicU32::new(u32::MAX));
    }

    #[inline]
    pub fn func_slot(&self, id: u32) -> Option<usize> {
        slot_at(&self.func_slots, id)
    }

    #[inline]
    pub fn func(&self, id: u32) -> Option<&FunctionOutline> {
        slot_at(&self.func_slots, id).map(|slot| &self.funcs[slot])
    }

    #[inline]
    pub fn layout(&self, id: u32) -> Option<&LayoutOutline> {
        slot_at(&self.layout_slots, id).map(|slot| &self.layouts[slot])
    }

    #[inline]
    pub fn variable(&self, id: u32) -> Option<&VariableOutline> {
        slot_at(&self.variable_slots, id).map(|slot| &self.variables[slot])
    }

    pub fn add(&mut self, batches: &mut [OutlineBatch<'_>], is_preferred: &(dyn Fn(usize, u32, u32, u32) -> bool + Sync), in_parallel: InParallel<'_>) {
        for_each_mut(batches, in_parallel, &|batch| {
            let preferred_flags = |kind: usize, ids: &[u32], count: usize| -> Vec<bool> { (0..count as u32).map(|offset| is_preferred(kind, batch.fragment, batch.first[kind] + offset, ids[(batch.first[kind] + offset) as usize])).collect() };
            batch.is_preferred = [preferred_flags(0, &batch.ids.funcs, batch.functions.len()), preferred_flags(1, &batch.ids.layouts, batch.shapes.len()), preferred_flags(2, &batch.ids.globals, batch.variables.len())];
            let function_lists_len: usize = batch.functions.iter().zip(&batch.is_preferred[0]).filter(|function| *function.1).map(|function| function_list_len(function.0)).sum();
            let layout_lists_len: usize = batch.shapes.iter().zip(&batch.is_preferred[1]).filter(|shape| *shape.1).filter_map(|shape| shape.0.definition.as_ref()).map(|definition| definition.mentions.all.len()).sum();
            batch.list_len = function_lists_len + layout_lists_len;
            let with_parts = batch.functions.iter().zip(&batch.is_preferred[0]).filter(|function| *function.1).map(|function| function.0).filter(|function| function.body.as_ref().is_some_and(|body| !body.parts.is_empty()));
            batch.rebuilt_list_len = with_parts.map(|function| function_list_len(function) + function.body.iter().flat_map(|body| &body.parts).map(|part| part.mentions.all.len()).sum::<usize>()).sum();
        });
        let count = |kind: usize| -> usize { batches.iter().map(|batch| batch.is_preferred[kind].iter().filter(|is_preferred| **is_preferred).count()).sum() };
        let (functions, layouts, variables, list_len) = (count(0), count(1), count(2), batches.iter().map(|batch| batch.list_len).sum::<usize>());
        let before = [self.funcs.len(), self.layouts.len(), self.variables.len(), self.local.len()];
        self.funcs.reserve_exact(functions);
        self.layouts.reserve_exact(layouts);
        self.variables.reserve_exact(variables);
        if self.local.capacity() - self.local.len() < list_len {
            let spare = batches.iter().map(|batch| batch.rebuilt_list_len).sum::<usize>() + list_len / 16;
            self.local.reserve_exact(list_len + spare);
            self.program.reserve_exact(list_len + spare);
        }
        struct BatchOutput<'a, 'b> {
            batch: &'a mut OutlineBatch<'b>,
            first_slots: [u32; 3],
            funcs: &'a mut [MaybeUninit<FunctionOutline>],
            layouts: &'a mut [MaybeUninit<LayoutOutline>],
            variables: &'a mut [MaybeUninit<VariableOutline>],
            lists: ListWriter<'a>,
            funcs_with_parts: Vec<u32>,
        }
        let Outline { funcs, layouts: all_layouts, variables: all_variables, local, program, func_slots, layout_slots, variable_slots, funcs_with_parts } = self;
        let mut funcs_rest = &mut funcs.spare_capacity_mut()[..functions];
        let mut layouts_rest = &mut all_layouts.spare_capacity_mut()[..layouts];
        let mut variables_rest = &mut all_variables.spare_capacity_mut()[..variables];
        let mut local_rest = &mut local.spare_capacity_mut()[..list_len];
        let mut program_rest = &mut program.spare_capacity_mut()[..list_len];
        let mut next = before;
        let mut outputs: Vec<BatchOutput<'_, '_>> = Vec::with_capacity(batches.len());
        for batch in batches.iter_mut() {
            let counts = [0, 1, 2].map(|kind| batch.is_preferred[kind].iter().filter(|is_preferred| **is_preferred).count());
            let (funcs_chunk, layouts_chunk, variables_chunk, local_chunk, program_chunk);
            (funcs_chunk, funcs_rest) = std::mem::take(&mut funcs_rest).split_at_mut(counts[0]);
            (layouts_chunk, layouts_rest) = std::mem::take(&mut layouts_rest).split_at_mut(counts[1]);
            (variables_chunk, variables_rest) = std::mem::take(&mut variables_rest).split_at_mut(counts[2]);
            (local_chunk, local_rest) = std::mem::take(&mut local_rest).split_at_mut(batch.list_len);
            (program_chunk, program_rest) = std::mem::take(&mut program_rest).split_at_mut(batch.list_len);
            let lists = ListWriter { local: local_chunk, program: program_chunk, written: 0, start: next[3] as u32 };
            let first_slots = [next[0] as u32, next[1] as u32, next[2] as u32];
            next = [next[0] + counts[0], next[1] + counts[1], next[2] + counts[2], next[3] + batch.list_len];
            outputs.push(BatchOutput { batch, first_slots, funcs: funcs_chunk, layouts: layouts_chunk, variables: variables_chunk, lists, funcs_with_parts: Vec::new() });
        }
        for_each_mut(&mut outputs, in_parallel, &|BatchOutput { batch, first_slots, funcs, layouts, variables, lists, funcs_with_parts }| {
            let OutlineBatch { fragment, file, ids, summary, first, functions, shapes, variables: fragment_variables, is_preferred, list_len, .. } = &mut **batch;
            let ids: &LocalToProgram = ids;
            let mut count = 0;
            for (offset, function) in functions.iter_mut().enumerate().filter(|function| is_preferred[0][function.0]) {
                let mut outline = outline_function(function, *fragment, first[0] + offset as u32, *file, ids, lists);
                if summary.runtime_modules.binary_search_by_key(&outline.index, |found| found.0).is_ok() {
                    outline.flags |= outline_flags::REQUESTS_RUNTIME_MODULES;
                }
                if outline.has(outline_flags::HAS_PARTS) {
                    funcs_with_parts.push(first_slots[0] + count as u32);
                }
                func_slots[outline.id as usize].store(first_slots[0] + count as u32, Ordering::Relaxed);
                funcs[count].write(outline);
                count += 1;
            }
            for body in functions.iter_mut().filter_map(|function| function.body.as_mut()) {
                body.mentions = ReferencedIds::default();
            }
            let mut count = 0;
            for (offset, shape) in shapes.iter_mut().enumerate().filter(|shape| is_preferred[1][shape.0]) {
                let index = first[1] + offset as u32;
                let definition = shape.definition.as_mut().expect("the index preferred_flags no shape that is only named");
                layouts[count].write(outline_layout(definition, *fragment, index, ids, lists));
                definition.mentions = ReferencedIds::default();
                layout_slots[ids.layouts[index as usize] as usize].store(first_slots[1] + count as u32, Ordering::Relaxed);
                count += 1;
            }
            let mut count = 0;
            for (offset, variable) in fragment_variables.iter().enumerate().filter(|variable| is_preferred[2][variable.0]) {
                let (index, declared) = (first[2] + offset as u32, variable.global.declared);
                variables[count].write(VariableOutline { fragment: *fragment, index, declared, declared_id: if declared.is_none() { u32::MAX } else { ids.tys[declared.idx()] } });
                variable_slots[ids.globals[index as usize] as usize].store(first_slots[2] + count as u32, Ordering::Relaxed);
                count += 1;
            }
            assert_eq!(lists.written, *list_len, "the lists are as long as computed");
        });
        for output in &mut outputs {
            funcs_with_parts.append(&mut output.funcs_with_parts);
        }
        drop(outputs);
        // SAFETY: the batches partition the reserved capacity, and each one initialized its whole chunk.
        unsafe {
            funcs.set_len(before[0] + functions);
            all_layouts.set_len(before[1] + layouts);
            all_variables.set_len(before[2] + variables);
            local.set_len(before[3] + list_len);
            program.set_len(before[3] + list_len);
        }
    }

    pub fn rebuild_functions(&mut self, functions: &mut [(u32, &mut Function, &LocalToProgram, FileId)], in_parallel: InParallel<'_>) {
        let list_len: usize = functions.iter().map(|function| function_list_len(&*function.1)).sum();
        let before = self.local.len();
        self.local.reserve_exact(list_len);
        self.program.reserve_exact(list_len);
        let mut local_rest = &mut self.local.spare_capacity_mut()[..list_len];
        let mut program_rest = &mut self.program.spare_capacity_mut()[..list_len];
        let mut start = before;
        let mut rebuilt: Vec<(&mut (u32, &mut Function, &LocalToProgram, FileId), ListWriter<'_>, Option<FunctionOutline>, (u32, u32, u8))> = Vec::with_capacity(functions.len());
        for function in functions.iter_mut() {
            let (list_len, previous) = (function_list_len(&*function.1), &self.funcs[function.0 as usize]);
            let (local_chunk, program_chunk);
            (local_chunk, local_rest) = std::mem::take(&mut local_rest).split_at_mut(list_len);
            (program_chunk, program_rest) = std::mem::take(&mut program_rest).split_at_mut(list_len);
            rebuilt.push((function, ListWriter { local: local_chunk, program: program_chunk, written: 0, start: start as u32 }, None, (previous.fragment, previous.index, previous.flags & outline_flags::REQUESTS_RUNTIME_MODULES)));
            start += list_len;
        }
        for_each_mut(&mut rebuilt, in_parallel, &|(function, lists, outline, (fragment, index, flags))| {
            let rebuilt = outline_function(&*function.1, *fragment, *index, function.3, function.2, lists);
            *outline = Some(FunctionOutline { flags: rebuilt.flags | *flags, ..rebuilt });
            if let Some(body) = &mut function.1.body {
                body.mentions = ReferencedIds::default();
            }
        });
        let outlines: Vec<(u32, FunctionOutline)> = rebuilt.into_iter().filter_map(|(function, _, outline, _)| Some((function.0, outline?))).collect();
        // SAFETY: the functions partition the reserved capacity, and each one initialized its whole chunk.
        unsafe {
            self.local.set_len(before + list_len);
            self.program.set_len(before + list_len);
        }
        for (slot, outline) in outlines {
            self.funcs[slot as usize] = outline;
        }
        self.funcs_with_parts.retain(|&slot| self.funcs[slot as usize].has(outline_flags::HAS_PARTS));
    }
}

#[derive(Copy, Clone)]
pub enum RuntimeModule {
    Number(i64),
    Name(StrId),
}

#[derive(Default)]
pub struct Summary {
    pub runtime_modules: Vec<(u32, RuntimeModule)>,
    pub entrypoints_and_clones: Vec<u32>,
    pub run_at_evaluation: Vec<u32>,
    pub with_mutations: Vec<u32>,
}

impl Summary {
    fn of(fragment: &Fragment) -> Summary {
        let mut summary = Summary::default();
        for (index, function) in fragment.funcs.iter().enumerate() {
            let index = index as u32;
            if matches!(function.key, FuncKey::Module(file) | FuncKey::ModuleBody(file) | FuncKey::ModuleSettling(file) | FuncKey::ModuleDriver(file) | FuncKey::ModuleInner(file) | FuncKey::Required(file) if file == fragment.file) {
                summary.run_at_evaluation.push(index);
            }
            let (Some(func), Some(body)) = (&function.func, &function.body) else { continue };
            if matches!(function.key, FuncKey::GenericEntrypoint(..) | FuncKey::UntypedClone(..)) {
                summary.entrypoints_and_clones.push(index);
            }
            if body.notes.has_mutations() {
                summary.with_mutations.push(index);
            }
            for value in &func.values {
                let found = match &value.def {
                    Def::Op(Op::Operation { which: Operation::RequireBuiltinModule, args }) if !args.is_empty() => match func.op(args[0]) {
                        Some(&Op::Int(number)) => Some(RuntimeModule::Number(number)),
                        _ => None,
                    },
                    Def::Op(Op::Operation { which: Operation::RequireExternalModule | Operation::ImportExternalModule, args }) if !args.is_empty() => crate::link::constant_string(func, args[0]).map(RuntimeModule::Name),
                    Def::Op(Op::ExternalModule(name)) => Some(RuntimeModule::Name(*name)),
                    _ => None,
                };
                summary.runtime_modules.extend(found.map(|module| (index, module)));
            }
        }
        summary
    }
}

const SHARDS: usize = 64;

fn shard_of(hash: u64) -> usize {
    ((hash ^ (hash >> 32)).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 58) as usize
}

struct InternerShard<K> {
    keys: Vec<K>,
    hashes: Vec<u64>,
    ids: hashbrown::HashTable<u32>,
}

pub struct Interner<K> {
    shards: Vec<Guarded<InternerShard<K>>>,
}

impl<K: Hash + Eq + Clone> Interner<K> {
    fn new() -> Interner<K> {
        Interner { shards: (0..SHARDS).map(|_| Guarded::new(InternerShard { keys: Vec::new(), hashes: Vec::new(), ids: hashbrown::HashTable::new() })).collect() }
    }

    fn intern(&self, key: K) -> u32 {
        let hash = rustc_hash::FxBuildHasher.hash_one(&key);
        let shard_number = shard_of(hash);
        let mut shard = self.shards[shard_number].lock();
        let InternerShard { keys, hashes, ids } = &mut *shard;
        if let Some(&index) = ids.find(hash, |&index| keys[index as usize] == key) {
            return index * SHARDS as u32 + shard_number as u32;
        }
        let index = keys.len() as u32;
        keys.push(key);
        hashes.push(hash);
        ids.insert_unique(hash, index, |&index| hashes[index as usize]);
        index * SHARDS as u32 + shard_number as u32
    }

    pub fn find(&self, key: &K) -> Option<u32> {
        let hash = rustc_hash::FxBuildHasher.hash_one(key);
        let shard_number = shard_of(hash);
        let shard = self.shards[shard_number].lock();
        let index = *shard.ids.find(hash, |&index| shard.keys[index as usize] == *key)?;
        Some(index * SHARDS as u32 + shard_number as u32)
    }

    pub fn key(&self, id: u32) -> K {
        self.shards[id as usize % SHARDS].lock().keys[id as usize / SHARDS].clone()
    }

    pub fn bound(&self) -> usize {
        SHARDS * self.shards.iter().map(|shard| shard.lock().keys.len()).max().unwrap_or(0)
    }
}

pub struct ProgramIds {
    strs: Vec<Guarded<Strs>>,
    tys: Interner<Declared>,
    pub layouts: Interner<LayoutKey>,
    pub globals: Interner<GlobalKey>,
    pub funcs: Interner<FuncKey>,
}

impl Default for ProgramIds {
    fn default() -> ProgramIds {
        ProgramIds { strs: (0..SHARDS).map(|_| Guarded::new(Strs::default())).collect(), tys: Interner::new(), layouts: Interner::new(), globals: Interner::new(), funcs: Interner::new() }
    }
}

impl ProgramIds {
    pub fn str(&self, hash: u64, bytes: &[u8]) -> u32 {
        let shard_number = shard_of(hash);
        self.strs[shard_number].lock().intern_hashed(hash, bytes).0 * SHARDS as u32 + shard_number as u32
    }

    pub fn strs_upper_bound(&self) -> usize {
        SHARDS * self.strs.iter().map(|shard| shard.lock().len()).max().unwrap_or(0)
    }

    pub fn tys_upper_bound(&self) -> usize {
        self.tys.bound()
    }

    pub fn assign(&self, fragment: &mut Fragment) {
        let strs: Vec<u32> = (0..fragment.strs.len()).map(StrId::new).map(|id| self.str(fragment.strs.hash(id), fragment.strs.get(id))).collect();
        let layouts: Vec<u32> = fragment.layouts.iter().map(|shape| self.layouts.intern(shape.key)).collect();
        let globals: Vec<u32> = fragment.globals.iter().map(|variable| self.globals.intern(variable.key.clone())).collect();
        let funcs: Vec<u32> = fragment.funcs.iter().map(|function| self.funcs.intern(function.key)).collect();
        let mut tys: Vec<u32> = Vec::with_capacity(fragment.tys.list.len());
        for Declared { prims, ints, parts, any_object, any_function } in &fragment.tys.list {
            let ty = |local: TyId| if local.is_none() { local } else { TyId(tys[local.idx()]) };
            let mut parts: smallvec::SmallVec<[Part; 1]> = (parts.iter())
                .map(|part| match part {
                    Part::Class(layout) => Part::Class(if layout.is_none() { *layout } else { LayoutId(layouts[layout.idx()]) }),
                    Part::Global(name, arguments) => Part::Global(if name.is_none() { *name } else { StrId(strs[name.idx()]) }, arguments.iter().map(|&argument| ty(argument)).collect()),
                    Part::Array(element) => Part::Array(ty(*element)),
                })
                .collect();
            parts.sort_unstable();
            tys.push(self.tys.intern(Declared { prims: *prims, ints: *ints, parts, any_object: *any_object, any_function: *any_function }));
        }
        fragment.program_ids = LocalToProgram { strs, tys, layouts, globals, funcs };
        fragment.summary = Summary::of(fragment);
        fragment.tys.close();
    }
}

// ───────────────────────────── handing them in ─────────────────────────────

/// Where the tasks of a check put the fragments. An invalid task is retried, and its files are translated again: the last fragment of
/// a file counts, and takes the place of the one before as a whole. No two tasks have one file at the same time.
pub struct Fragments {
    /// By `FileId`.
    by_file: Vec<Guarded<Option<Box<Fragment>>>>,
    pub program_ids: ProgramIds,
}

impl Fragments {
    /// `files`: how many the program has.
    pub fn new(files: usize) -> Fragments {
        Fragments { by_file: (0..files).map(|_| Guarded::new(None)).collect(), program_ids: ProgramIds::default() }
    }

    pub fn put(&self, mut fragment: Box<Fragment>) {
        self.program_ids.assign(&mut fragment);
        let mut place = self.by_file[fragment.file.idx()].lock();
        fragment.translation_count += place.as_ref().map_or(0, |earlier| earlier.translation_count);
        *place = Some(fragment);
    }

    pub fn is_any_of(&self, test: &dyn Fn(FileId) -> bool) -> bool {
        self.by_file.iter().any(|place| place.lock().as_ref().is_some_and(|fragment| test(fragment.file)))
    }

    /// Once every task has ended.
    pub fn take(&self, rank_of_file: &dyn Fn(FileId) -> u32, in_parallel: InParallel<'_>) -> Vec<Fragment> {
        const FRAGMENTS_PER_RUN: usize = 128;
        let mut boxes: Vec<Option<Box<Fragment>>> = self.by_file.iter().map(|place| place.lock().take()).filter(Option::is_some).collect();
        boxes.sort_by_cached_key(|fragment| fragment.as_ref().map(|fragment| rank_of_file(fragment.file)));
        let mut fragments: Vec<Fragment> = Vec::with_capacity(boxes.len());
        let mut runs: Vec<(&mut [Option<Box<Fragment>>], &mut [MaybeUninit<Fragment>])> = boxes.chunks_mut(FRAGMENTS_PER_RUN).zip(fragments.spare_capacity_mut().chunks_mut(FRAGMENTS_PER_RUN)).collect();
        for_each_mut(&mut runs, in_parallel, &|(boxes, places)| {
            for (fragment, place) in boxes.iter_mut().zip(places.iter_mut()) {
                place.write(*fragment.take().expect("only fragments that are there are listed"));
            }
        });
        drop(runs);
        // SAFETY: the runs are all of the first `boxes.len()` places, and each has been written.
        unsafe { fragments.set_len(boxes.len()) };
        fragments
    }
}
