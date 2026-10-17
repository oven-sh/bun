use crate::build::Problem;
use crate::declared::{Declared, DeclaredTable, Part};
use crate::id::{BlockId, FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{
    Block, CoerceReason, Def, Field, Func, FuncKind, Global, Layout, Literal, Method, NO_VARIABLE,
    Op, Operation, Prediction, Strs, Value,
};
use bun_sema::bind::SymbolId;
use bun_sema::check::{FlowNotes, Identity, MethodStore, NumberFlow};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::program::FileId;
use bun_sema::util::{InParallel, for_each_mut};
use bun_threading::Guarded;
use std::hash::{BuildHasher, Hash};
use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicU32, Ordering};

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum FuncKey {
    Module(FileId),
    ModuleBody(FileId),
    ModuleTouch(FileId),
    ModuleSettling(FileId),
    ModuleDriver(FileId),
    ModuleInner(FileId),
    BuiltinModuleLoads(FileId),
    DynamicImport(FileId, bool),
    Required(FileId),
    DynamicImportBody(FileId, bool),
    Initializer(FileId, SymbolId),
    Function(FileId, FnId),
    TypedBody(FileId, FnId),
    GenericEntrypoint(FileId, FnId),
    UntypedClone(FileId, FnId, FnId),
    DefaultConstructor(FileId, ClassId),
    EnumObject(FileId, SymbolId),
    NamespaceObject(FileId, SymbolId),
    ModuleNamespaceReader(FileId),
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
    pub fn file(self) -> FileId {
        match self {
            FuncKey::Module(file)
            | FuncKey::ModuleBody(file)
            | FuncKey::ModuleTouch(file)
            | FuncKey::ModuleSettling(file)
            | FuncKey::ModuleDriver(file)
            | FuncKey::ModuleInner(file)
            | FuncKey::BuiltinModuleLoads(file)
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
    Record(Identity),
    Instance(FileId, ClassId),
    ClassEnvironment(FileId, ClassId),
    Environment(FileId, u32),
}

impl LayoutKey {
    pub fn file(self) -> Option<FileId> {
        match self {
            LayoutKey::Record(_) => None,
            LayoutKey::Instance(file, _)
            | LayoutKey::ClassEnvironment(file, _)
            | LayoutKey::Environment(file, _) => Some(file),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum GlobalKey {
    Symbol(FileId, SymbolId),
    Enum(FileId, SymbolId),
    Namespace(FileId, SymbolId),
    ClassVariable(FileId, ClassId, u32),
    ModuleInternal(FileId, &'static str),
    Export(FileId, Box<[u8]>),
    Hidden(FileId, u32),
    LazyVariableState(FileId, SymbolId),
    ExternalModule(Box<[u8]>),
}

impl GlobalKey {
    pub fn file(&self) -> Option<FileId> {
        match *self {
            GlobalKey::Symbol(file, _)
            | GlobalKey::Enum(file, _)
            | GlobalKey::Namespace(file, _)
            | GlobalKey::ClassVariable(file, ..)
            | GlobalKey::ModuleInternal(file, _)
            | GlobalKey::Export(file, _)
            | GlobalKey::Hidden(file, _)
            | GlobalKey::LazyVariableState(file, _) => Some(file),
            GlobalKey::ExternalModule(_) => None,
        }
    }
}

pub type Notes = FlowNotes<Identity>;

#[derive(Default)]
pub struct ReferencedIds {
    all: Vec<u32>,
    ends: [u32; 5],
}

impl ReferencedIds {
    #[inline]
    fn part(&self, index: usize) -> &[u32] {
        let start = if index == 0 {
            0
        } else {
            self.ends[index - 1] as usize
        };
        let end = self
            .ends
            .get(index)
            .map_or(self.all.len(), |&end| end as usize);
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
    pub fn called(&self) -> impl Iterator<Item = FuncId> + '_ {
        self.part(4).iter().map(|&id| FuncId(id))
    }
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

pub struct ModulePart {
    pub from: (BlockId, u32),
    pub to: (BlockId, u32),
    pub blocks: (u32, u32),
    pub stores: Vec<GlobalId>,
    pub write_only_globals: Vec<GlobalId>,
    pub mentions: ReferencedIds,
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
        let mut seen: rustc_hash::FxHashMap<V, V> = Default::default();
        let own_operations = own_blocks().flat_map(|block| &func.blocks[block.idx()].ops);
        seen.extend(
            func.blocks[from.idx()].ops[start as usize..]
                .iter()
                .chain(own_operations)
                .map(|&v| (v, V::NONE)),
        );
        let mut args_by_target: rustc_hash::FxHashMap<BlockId, Vec<crate::ir::Args>> =
            Default::default();
        for source in std::iter::once(from).chain(own_blocks()) {
            if let Some(term) = &func.blocks[source.idx()].term {
                term.for_each_target(|target| {
                    args_by_target
                        .entry(target.block)
                        .or_default()
                        .push(target.args.clone())
                });
            }
        }
        let mut is_asked: rustc_hash::FxHashSet<V> = Default::default();
        let mut asked: Vec<V> = func.blocks[to.idx()].params.clone();
        while let Some(&param) = asked.last() {
            let Def::Param(block, index) = func.values[param.idx()].def else {
                unreachable!()
            };
            if seen.contains_key(&param) {
                asked.pop();
                continue;
            }
            is_asked.insert(param);
            let (mut found, mut agree, mut waits_for) = (V::NONE, true, V::NONE);
            for args in args_by_target.get(&block).map_or(&[][..], |list| &list[..]) {
                let arg = args.get(index as usize).copied().unwrap_or(V::NONE);
                let handed = match (
                    seen.get(&arg),
                    arg.is_some().then(|| &func.values[arg.idx()].def),
                ) {
                    (Some(&answer), _) => answer,
                    (None, Some(&Def::Param(of, _))) if is_own(of) && is_asked.contains(&arg) => {
                        V::NONE
                    }
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
        self.passed_through = func.blocks[to.idx()]
            .params
            .iter()
            .map(|param| seen[param])
            .collect();
    }

    pub fn values(&self, func: &Func) -> Vec<V> {
        let ((from, start), (to, end)) = (self.from, self.to);
        if from == to {
            return func.blocks[from.idx()].ops[start as usize..end as usize].to_vec();
        }
        let mut values = func.blocks[from.idx()].ops[start as usize..].to_vec();
        for block in (self.blocks.0..self.blocks.1).map(BlockId) {
            let Block {
                params,
                ops,
                term: _,
            } = &func.blocks[block.idx()];
            if block == to {
                values.extend(
                    params
                        .iter()
                        .zip(&self.passed_through)
                        .filter(|(_, handed)| handed.is_none())
                        .map(|(&param, _)| param),
                );
                values.extend_from_slice(&ops[..end as usize]);
            } else {
                values.extend_from_slice(params);
                values.extend_from_slice(ops);
            }
        }
        values
    }
}

pub struct Body {
    pub class: LayoutId,
    pub declares: Vec<LayoutId>,
    pub classes_as_values: Vec<LayoutId>,
    pub implicit_stores: Vec<StrId>,
    pub number_flows: Vec<NumberFlow<StrId>>,
    pub notes: Notes,
    pub notes_for_unknown_callers: Notes,
    pub problems: Vec<Problem>,
    pub spans: Vec<(u32, u32)>,
    pub cut: Vec<(u32, u32)>,
    pub dropped: Vec<(u32, u32)>,
    pub parts: Vec<ModulePart>,
    pub mentions: ReferencedIds,
}

pub struct Function {
    pub key: FuncKey,
    pub func: Option<Func>,
    pub body: Option<Box<Body>>,
}

pub struct Definition {
    pub layout: Layout,
    pub mentions: ReferencedIds,
    pub constructs: LayoutId,
    pub notes: Option<Box<Notes>>,
    pub problems: Vec<Problem>,
}

pub struct Shape {
    pub key: LayoutKey,
    pub name: StrId,
    pub ty: Option<Identity>,
    pub definition: Option<Box<Definition>>,
}

pub struct Variable {
    pub key: GlobalKey,
    pub global: Global,
}

pub struct Fragment {
    pub file: FileId,
    pub path: StrId,
    pub strs: Strs,
    pub tys: DeclaredTable,
    pub modules: Vec<FileId>,
    pub globals: Vec<Variable>,
    pub layouts: Vec<Shape>,
    pub funcs: Vec<Function>,
    pub mutated_globals: Vec<StrId>,
    pub prototype_property_names: Vec<StrId>,
    pub regexp_literals: Vec<(StrId, StrId)>,
    pub method_stores: Vec<MethodStore<Identity>>,
    pub builtin_functions: Vec<(u32, FuncKey, u32)>,
    pub translation_count: u32,
    pub program_ids: LocalToProgram,
    pub summary: Summary,
}

pub const NO_FILE: FileId = FileId(u32::MAX);

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Used {
    Called,
    AsValue,
    AsMember,
    Expected,
}

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
        Op::Str(text) | Op::BigInt(text) | Op::Symbol(text) | Op::ExternalModule(text) => {
            pass!(ids.str(text))
        }
        Op::FreeGet { name, is_typeof: _ }
        | Op::FreeSet { name, value: _ }
        | Op::PropGet { obj: _, name }
        | Op::PropSet {
            obj: _,
            name,
            value: _,
        }
        | Op::PropHas { obj: _, name }
        | Op::PropDelete { obj: _, name }
        | Op::CallMethod {
            obj: _,
            name,
            args: _,
        } => pass!(ids.str(name)),
        Op::FuncRef(func)
        | Op::Closure { func, captures: _ }
        | Op::ClosureOnce {
            func,
            captures: _,
            env: _,
            field: _,
        } => pass!(ids.func(func, Used::AsValue)),
        Op::CallDirect { func, args: _ } => pass!(ids.func(func, Used::Called)),
        Op::GlobalGet(global) | Op::GlobalSet(global, _) => pass!(ids.global(global)),
        Op::New(layout)
        | Op::FieldGet {
            obj: _,
            layout,
            field: _,
        }
        | Op::FieldSet {
            obj: _,
            layout,
            field: _,
            value: _,
        }
        | Op::IsInstance { value: _, layout } => pass!(ids.layout(layout)),
        Op::NewWith {
            layout,
            name,
            value: _,
        } => {
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

pub fn for_each_func_id(func: &mut Func, ids: &mut impl Ids) {
    for_each_header_id(func, ids);
    for value in &mut func.values {
        for_each_value_id(value, ids);
    }
}

fn for_each_header_id(func: &mut Func, ids: &mut impl Ids) {
    let Func {
        name,
        module,
        pos: _,
        source_start: _,
        source_end: _,
        kind: _,
        flags: _,
        length: _,
        captures,
        declared_this_type,
        params,
        annotated: _,
        result,
        blocks: _,
        values: _,
        spans: _,
    } = func;
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
        let Field {
            name,
            declared,
            flags: _,
            literals,
            type_text,
            single_function,
            single_function_flags: _,
        } = field;
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
        let Method {
            name,
            func,
            kind: _,
            flags: _,
            key,
        } = method;
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
    for other in members
        .iter_mut()
        .chain(structural_subtypes)
        .chain(specializations)
    {
        pass!(ids.layout(other));
    }
    pass!(ids.str(declared_path));
}

pub fn for_each_global_id(global: &mut Global, ids: &mut impl Ids) {
    let Global {
        name,
        module,
        declared,
        initialization: _,
        single_function,
        single_function_flags: _,
    } = global;
    pass!(ids.str(name));
    pass!(ids.module(module));
    pass!(ids.ty(declared));
    pass!(ids.func(single_function, Used::Expected));
}

#[derive(Default)]
pub struct ReferenceCollector {
    round: u32,
    strs: Vec<u32>,
    tys: Vec<u32>,
    layouts: Vec<u32>,
    globals: Vec<u32>,
    called: Vec<u32>,
    values: Vec<u32>,
    found: [Vec<u32>; 6],
}

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
        let mut mentions = ReferencedIds {
            all: Vec::with_capacity(self.found.iter().map(Vec::len).sum()),
            ends: [0; 5],
        };
        for (index, part) in self.found.iter_mut().enumerate() {
            mentions.all.extend_from_slice(part);
            part.clear();
            if let Some(end) = mentions.ends.get_mut(index) {
                *end = mentions.all.len() as u32;
            }
        }
        mentions
    }

    pub fn collect_func(&mut self, func: &mut Func) -> ReferencedIds {
        self.round += 1;
        for_each_func_id(func, self);
        self.take_referenced_ids()
    }

    pub fn of_values(
        &mut self,
        func: &mut Func,
        with_header: bool,
        indices: &[u32],
    ) -> ReferencedIds {
        self.round += 1;
        if with_header {
            for_each_header_id(func, self);
        }
        for &index in indices {
            for_each_value_id(&mut func.values[index as usize], self);
        }
        self.take_referenced_ids()
    }

    pub fn of_layout(&mut self, layout: &mut Layout) -> ReferencedIds {
        self.round += 1;
        for_each_layout_id(layout, self);
        self.take_referenced_ids()
    }
}

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
        (if list == 0 {
            self.start
        } else {
            self.ends[list - 1]
        }) as usize..self.ends[list] as usize
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
        (if list == 0 {
            self.start
        } else {
            self.ends[list - 1]
        }) as usize..self.ends[list] as usize
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
    pub fn new(
        fragment: u32,
        file: FileId,
        ids: &'a LocalToProgram,
        summary: &'a Summary,
        first: [u32; 3],
        functions: &'a mut [Function],
        shapes: &'a mut [Shape],
        variables: &'a [Variable],
    ) -> OutlineBatch<'a> {
        OutlineBatch {
            fragment,
            file,
            ids,
            summary,
            first,
            functions,
            shapes,
            variables,
            is_preferred: Default::default(),
            list_len: 0,
            rebuilt_list_len: 0,
        }
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
            self.program[self.written].write(if local == u32::MAX {
                local
            } else {
                ids[local as usize]
            });
            self.written += 1;
        }
        self.start + self.written as u32
    }
}

fn function_list_len(function: &Function) -> usize {
    let header_len = function
        .func
        .as_ref()
        .map_or(0, |func| 2 + func.captures.len() + func.params.len());
    let body_len = function.body.as_ref().map_or(0, |body| {
        body.mentions.all.len() + body.classes_as_values.len() + body.declares.len()
    });
    header_len + body_len
}

fn outline_function(
    function: &Function,
    fragment: u32,
    index: u32,
    fragment_file: FileId,
    ids: &LocalToProgram,
    lists: &mut ListWriter<'_>,
) -> FunctionOutline {
    use outline_flags::{EVALUATES_MODULE, HAS_BODY, HAS_HEADER, HAS_PARTS, IS_CONSTRUCTOR};
    let start = lists.start + lists.written as u32;
    let runs_at_start = matches!(
        function.key,
        FuncKey::Module(_)
            | FuncKey::ModuleBody(_)
            | FuncKey::ModuleTouch(_)
            | FuncKey::ModuleSettling(_)
    );
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
        flags: if runs_at_start {
            outline_flags::RUNS_AT_START
        } else {
            0
        },
    };
    if let Some(func) = &function.func {
        outline.flags |= HAS_HEADER
            | if func.kind == FuncKind::Constructor {
                IS_CONSTRUCTOR
            } else {
                0
            };
        (outline.module, outline.name, outline.captures) =
            (func.module, func.name, func.captures.len() as u32);
        outline.ends[Outline::HEADER_TYS] = lists.extend(
            [func.declared_this_type, func.result]
                .into_iter()
                .chain(func.captures.iter().copied())
                .chain(func.params.iter().copied())
                .map(|ty| ty.0),
            &ids.tys,
        );
    }
    let header_end = outline.ends[Outline::HEADER_TYS];
    outline.ends[Outline::STRS..].fill(header_end);
    if let Some(body) = &function.body {
        outline.flags |= HAS_BODY
            | if body.parts.is_empty() { 0 } else { HAS_PARTS }
            | if function.key == FuncKey::Module(fragment_file) {
                EVALUATES_MODULE
            } else {
                0
            };
        outline.class = body.class;
        outline.class_id = if body.class.is_none() {
            u32::MAX
        } else {
            ids.layouts[body.class.idx()]
        };
        outline.ends[Outline::STRS] = lists.extend(body.mentions.strs().map(|id| id.0), &ids.strs);
        outline.ends[Outline::TYS] = lists.extend(body.mentions.tys().map(|id| id.0), &ids.tys);
        outline.ends[Outline::LAYOUTS] =
            lists.extend(body.mentions.layouts().map(|id| id.0), &ids.layouts);
        outline.ends[Outline::GLOBALS] =
            lists.extend(body.mentions.globals().map(|id| id.0), &ids.globals);
        outline.ends[Outline::CALLED] =
            lists.extend(body.mentions.called().map(|id| id.0), &ids.funcs);
        outline.ends[Outline::VALUES] =
            lists.extend(body.mentions.values().map(|id| id.0), &ids.funcs);
        outline.ends[Outline::CLASSES_AS_VALUES] =
            lists.extend(body.classes_as_values.iter().map(|id| id.0), &ids.layouts);
        outline.ends[Outline::DECLARES] =
            lists.extend(body.declares.iter().map(|id| id.0), &ids.layouts);
    }
    outline
}

fn outline_layout(
    definition: &Definition,
    fragment: u32,
    index: u32,
    ids: &LocalToProgram,
    lists: &mut ListWriter<'_>,
) -> LayoutOutline {
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
    LayoutOutline {
        start,
        ends,
        fragment,
        index,
        base: definition.layout.base,
        constructs,
        constructs_id: if constructs.is_none() {
            u32::MAX
        } else {
            ids.layouts[constructs.idx()]
        },
    }
}

fn slot_at(slots: &[AtomicU32], id: u32) -> Option<usize> {
    Some(slots.get(id as usize)?.load(Ordering::Relaxed))
        .filter(|&slot| slot != u32::MAX)
        .map(|slot| slot as usize)
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
        self.func_slots
            .resize_with(ids.funcs.bound(), || AtomicU32::new(u32::MAX));
        self.layout_slots
            .resize_with(ids.layouts.bound(), || AtomicU32::new(u32::MAX));
        self.variable_slots
            .resize_with(ids.globals.bound(), || AtomicU32::new(u32::MAX));
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

    pub fn add(
        &mut self,
        batches: &mut [OutlineBatch<'_>],
        is_preferred: &(dyn Fn(usize, u32, u32, u32) -> bool + Sync),
        in_parallel: InParallel<'_>,
    ) {
        for_each_mut(batches, in_parallel, &|batch| {
            let preferred_flags = |kind: usize, ids: &[u32], count: usize| -> Vec<bool> {
                (0..count as u32)
                    .map(|offset| {
                        is_preferred(
                            kind,
                            batch.fragment,
                            batch.first[kind] + offset,
                            ids[(batch.first[kind] + offset) as usize],
                        )
                    })
                    .collect()
            };
            batch.is_preferred = [
                preferred_flags(0, &batch.ids.funcs, batch.functions.len()),
                preferred_flags(1, &batch.ids.layouts, batch.shapes.len()),
                preferred_flags(2, &batch.ids.globals, batch.variables.len()),
            ];
            let function_lists_len: usize = batch
                .functions
                .iter()
                .zip(&batch.is_preferred[0])
                .filter(|function| *function.1)
                .map(|function| function_list_len(function.0))
                .sum();
            let layout_lists_len: usize = batch
                .shapes
                .iter()
                .zip(&batch.is_preferred[1])
                .filter(|shape| *shape.1)
                .filter_map(|shape| shape.0.definition.as_ref())
                .map(|definition| definition.mentions.all.len())
                .sum();
            batch.list_len = function_lists_len + layout_lists_len;
            let with_parts = batch
                .functions
                .iter()
                .zip(&batch.is_preferred[0])
                .filter(|function| *function.1)
                .map(|function| function.0)
                .filter(|function| {
                    function
                        .body
                        .as_ref()
                        .is_some_and(|body| !body.parts.is_empty())
                });
            batch.rebuilt_list_len = with_parts
                .map(|function| {
                    function_list_len(function)
                        + function
                            .body
                            .iter()
                            .flat_map(|body| &body.parts)
                            .map(|part| part.mentions.all.len())
                            .sum::<usize>()
                })
                .sum();
        });
        let count = |kind: usize| -> usize {
            batches
                .iter()
                .map(|batch| {
                    batch.is_preferred[kind]
                        .iter()
                        .filter(|is_preferred| **is_preferred)
                        .count()
                })
                .sum()
        };
        let (functions, layouts, variables, list_len) = (
            count(0),
            count(1),
            count(2),
            batches.iter().map(|batch| batch.list_len).sum::<usize>(),
        );
        let before = [
            self.funcs.len(),
            self.layouts.len(),
            self.variables.len(),
            self.local.len(),
        ];
        self.funcs.reserve_exact(functions);
        self.layouts.reserve_exact(layouts);
        self.variables.reserve_exact(variables);
        if self.local.capacity() - self.local.len() < list_len {
            let spare = batches
                .iter()
                .map(|batch| batch.rebuilt_list_len)
                .sum::<usize>()
                + list_len / 16;
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
        let Outline {
            funcs,
            layouts: all_layouts,
            variables: all_variables,
            local,
            program,
            func_slots,
            layout_slots,
            variable_slots,
            funcs_with_parts,
        } = self;
        let mut funcs_rest = &mut funcs.spare_capacity_mut()[..functions];
        let mut layouts_rest = &mut all_layouts.spare_capacity_mut()[..layouts];
        let mut variables_rest = &mut all_variables.spare_capacity_mut()[..variables];
        let mut local_rest = &mut local.spare_capacity_mut()[..list_len];
        let mut program_rest = &mut program.spare_capacity_mut()[..list_len];
        let mut next = before;
        let mut outputs: Vec<BatchOutput<'_, '_>> = Vec::with_capacity(batches.len());
        for batch in batches.iter_mut() {
            let counts = [0, 1, 2].map(|kind| {
                batch.is_preferred[kind]
                    .iter()
                    .filter(|is_preferred| **is_preferred)
                    .count()
            });
            let (funcs_chunk, layouts_chunk, variables_chunk, local_chunk, program_chunk);
            (funcs_chunk, funcs_rest) = std::mem::take(&mut funcs_rest).split_at_mut(counts[0]);
            (layouts_chunk, layouts_rest) =
                std::mem::take(&mut layouts_rest).split_at_mut(counts[1]);
            (variables_chunk, variables_rest) =
                std::mem::take(&mut variables_rest).split_at_mut(counts[2]);
            (local_chunk, local_rest) =
                std::mem::take(&mut local_rest).split_at_mut(batch.list_len);
            (program_chunk, program_rest) =
                std::mem::take(&mut program_rest).split_at_mut(batch.list_len);
            let lists = ListWriter {
                local: local_chunk,
                program: program_chunk,
                written: 0,
                start: next[3] as u32,
            };
            let first_slots = [next[0] as u32, next[1] as u32, next[2] as u32];
            next = [
                next[0] + counts[0],
                next[1] + counts[1],
                next[2] + counts[2],
                next[3] + batch.list_len,
            ];
            outputs.push(BatchOutput {
                batch,
                first_slots,
                funcs: funcs_chunk,
                layouts: layouts_chunk,
                variables: variables_chunk,
                lists,
                funcs_with_parts: Vec::new(),
            });
        }
        for_each_mut(
            &mut outputs,
            in_parallel,
            &|BatchOutput {
                  batch,
                  first_slots,
                  funcs,
                  layouts,
                  variables,
                  lists,
                  funcs_with_parts,
              }| {
                let OutlineBatch {
                    fragment,
                    file,
                    ids,
                    summary,
                    first,
                    functions,
                    shapes,
                    variables: fragment_variables,
                    is_preferred,
                    list_len,
                    ..
                } = &mut **batch;
                let ids: &LocalToProgram = ids;
                let mut count = 0;
                for (offset, function) in functions
                    .iter_mut()
                    .enumerate()
                    .filter(|function| is_preferred[0][function.0])
                {
                    let mut outline = outline_function(
                        function,
                        *fragment,
                        first[0] + offset as u32,
                        *file,
                        ids,
                        lists,
                    );
                    if summary
                        .runtime_modules
                        .binary_search_by_key(&outline.index, |found| found.0)
                        .is_ok()
                    {
                        outline.flags |= outline_flags::REQUESTS_RUNTIME_MODULES;
                    }
                    if outline.has(outline_flags::HAS_PARTS) {
                        funcs_with_parts.push(first_slots[0] + count as u32);
                    }
                    func_slots[outline.id as usize]
                        .store(first_slots[0] + count as u32, Ordering::Relaxed);
                    funcs[count].write(outline);
                    count += 1;
                }
                for body in functions
                    .iter_mut()
                    .filter_map(|function| function.body.as_mut())
                {
                    body.mentions = ReferencedIds::default();
                }
                let mut count = 0;
                for (offset, shape) in shapes
                    .iter_mut()
                    .enumerate()
                    .filter(|shape| is_preferred[1][shape.0])
                {
                    let index = first[1] + offset as u32;
                    let definition = shape
                        .definition
                        .as_mut()
                        .expect("the index preferred_flags no shape that is only named");
                    layouts[count].write(outline_layout(definition, *fragment, index, ids, lists));
                    definition.mentions = ReferencedIds::default();
                    layout_slots[ids.layouts[index as usize] as usize]
                        .store(first_slots[1] + count as u32, Ordering::Relaxed);
                    count += 1;
                }
                let mut count = 0;
                for (offset, variable) in fragment_variables
                    .iter()
                    .enumerate()
                    .filter(|variable| is_preferred[2][variable.0])
                {
                    let (index, declared) = (first[2] + offset as u32, variable.global.declared);
                    variables[count].write(VariableOutline {
                        fragment: *fragment,
                        index,
                        declared,
                        declared_id: if declared.is_none() {
                            u32::MAX
                        } else {
                            ids.tys[declared.idx()]
                        },
                    });
                    variable_slots[ids.globals[index as usize] as usize]
                        .store(first_slots[2] + count as u32, Ordering::Relaxed);
                    count += 1;
                }
                assert_eq!(
                    lists.written, *list_len,
                    "the lists are as long as computed"
                );
            },
        );
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

    pub fn rebuild_functions(
        &mut self,
        functions: &mut [(u32, &mut Function, &LocalToProgram, FileId)],
        in_parallel: InParallel<'_>,
    ) {
        let list_len: usize = functions
            .iter()
            .map(|function| function_list_len(&*function.1))
            .sum();
        let before = self.local.len();
        self.local.reserve_exact(list_len);
        self.program.reserve_exact(list_len);
        let mut local_rest = &mut self.local.spare_capacity_mut()[..list_len];
        let mut program_rest = &mut self.program.spare_capacity_mut()[..list_len];
        let mut start = before;
        let mut rebuilt: Vec<(
            &mut (u32, &mut Function, &LocalToProgram, FileId),
            ListWriter<'_>,
            Option<FunctionOutline>,
            (u32, u32, u8),
        )> = Vec::with_capacity(functions.len());
        for function in functions.iter_mut() {
            let (list_len, previous) = (
                function_list_len(&*function.1),
                &self.funcs[function.0 as usize],
            );
            let (local_chunk, program_chunk);
            (local_chunk, local_rest) = std::mem::take(&mut local_rest).split_at_mut(list_len);
            (program_chunk, program_rest) =
                std::mem::take(&mut program_rest).split_at_mut(list_len);
            rebuilt.push((
                function,
                ListWriter {
                    local: local_chunk,
                    program: program_chunk,
                    written: 0,
                    start: start as u32,
                },
                None,
                (
                    previous.fragment,
                    previous.index,
                    previous.flags & outline_flags::REQUESTS_RUNTIME_MODULES,
                ),
            ));
            start += list_len;
        }
        for_each_mut(&mut rebuilt, in_parallel, &|(
            function,
            lists,
            outline,
            (fragment, index, flags),
        )| {
            let rebuilt = outline_function(
                &*function.1,
                *fragment,
                *index,
                function.3,
                function.2,
                lists,
            );
            *outline = Some(FunctionOutline {
                flags: rebuilt.flags | *flags,
                ..rebuilt
            });
            if let Some(body) = &mut function.1.body {
                body.mentions = ReferencedIds::default();
            }
        });
        let outlines: Vec<(u32, FunctionOutline)> = rebuilt
            .into_iter()
            .filter_map(|(function, _, outline, _)| Some((function.0, outline?)))
            .collect();
        // SAFETY: the functions partition the reserved capacity, and each one initialized its whole chunk.
        unsafe {
            self.local.set_len(before + list_len);
            self.program.set_len(before + list_len);
        }
        for (slot, outline) in outlines {
            self.funcs[slot as usize] = outline;
        }
        self.funcs_with_parts
            .retain(|&slot| self.funcs[slot as usize].has(outline_flags::HAS_PARTS));
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
    fn new(fragment: &Fragment) -> Summary {
        let mut summary = Summary::default();
        for (index, function) in fragment.funcs.iter().enumerate() {
            let index = index as u32;
            if matches!(function.key, FuncKey::Module(file) | FuncKey::ModuleBody(file) | FuncKey::ModuleSettling(file) | FuncKey::ModuleDriver(file) | FuncKey::ModuleInner(file) | FuncKey::Required(file) if file == fragment.file)
            {
                summary.run_at_evaluation.push(index);
            }
            let (Some(func), Some(body)) = (&function.func, &function.body) else {
                continue;
            };
            if matches!(
                function.key,
                FuncKey::GenericEntrypoint(..) | FuncKey::UntypedClone(..)
            ) {
                summary.entrypoints_and_clones.push(index);
            }
            if body.notes.has_mutations() {
                summary.with_mutations.push(index);
            }
            for value in &func.values {
                let found = match &value.def {
                    Def::Op(Op::Operation {
                        which: Operation::RequireBuiltinModule,
                        args,
                    }) if !args.is_empty() => match func.op(args[0]) {
                        Some(&Op::Int(number)) => Some(RuntimeModule::Number(number)),
                        _ => None,
                    },
                    Def::Op(Op::Operation {
                        which: Operation::RequireExternalModule | Operation::ImportExternalModule,
                        args,
                    }) if !args.is_empty() => {
                        crate::link::constant_string(func, args[0]).map(RuntimeModule::Name)
                    }
                    Def::Op(Op::ExternalModule(name)) => Some(RuntimeModule::Name(*name)),
                    _ => None,
                };
                summary
                    .runtime_modules
                    .extend(found.map(|module| (index, module)));
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
        Interner {
            shards: (0..SHARDS)
                .map(|_| {
                    Guarded::new(InternerShard {
                        keys: Vec::new(),
                        hashes: Vec::new(),
                        ids: hashbrown::HashTable::new(),
                    })
                })
                .collect(),
        }
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
        let index = *shard
            .ids
            .find(hash, |&index| shard.keys[index as usize] == *key)?;
        Some(index * SHARDS as u32 + shard_number as u32)
    }

    pub fn key(&self, id: u32) -> K {
        self.shards[id as usize % SHARDS].lock().keys[id as usize / SHARDS].clone()
    }

    pub fn bound(&self) -> usize {
        SHARDS
            * self
                .shards
                .iter()
                .map(|shard| shard.lock().keys.len())
                .max()
                .unwrap_or(0)
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
        ProgramIds {
            strs: (0..SHARDS).map(|_| Guarded::new(Strs::default())).collect(),
            tys: Interner::new(),
            layouts: Interner::new(),
            globals: Interner::new(),
            funcs: Interner::new(),
        }
    }
}

impl ProgramIds {
    pub fn str(&self, hash: u64, bytes: &[u8]) -> u32 {
        let shard_number = shard_of(hash);
        self.strs[shard_number].lock().intern_hashed(hash, bytes).0 * SHARDS as u32
            + shard_number as u32
    }

    pub fn strs_upper_bound(&self) -> usize {
        SHARDS
            * self
                .strs
                .iter()
                .map(|shard| shard.lock().len())
                .max()
                .unwrap_or(0)
    }

    pub fn tys_upper_bound(&self) -> usize {
        self.tys.bound()
    }

    pub fn assign(&self, fragment: &mut Fragment) {
        let strs: Vec<u32> = (0..fragment.strs.len())
            .map(StrId::new)
            .map(|id| self.str(fragment.strs.hash(id), fragment.strs.get(id)))
            .collect();
        let layouts: Vec<u32> = fragment
            .layouts
            .iter()
            .map(|shape| self.layouts.intern(shape.key))
            .collect();
        let globals: Vec<u32> = fragment
            .globals
            .iter()
            .map(|variable| self.globals.intern(variable.key.clone()))
            .collect();
        let funcs: Vec<u32> = fragment
            .funcs
            .iter()
            .map(|function| self.funcs.intern(function.key))
            .collect();
        let mut tys: Vec<u32> = Vec::with_capacity(fragment.tys.list.len());
        for Declared {
            prims,
            ints,
            parts,
            any_object,
            any_function,
        } in &fragment.tys.list
        {
            let ty = |local: TyId| {
                if local.is_none() {
                    local
                } else {
                    TyId(tys[local.idx()])
                }
            };
            let mut parts: smallvec::SmallVec<[Part; 1]> = (parts.iter())
                .map(|part| match part {
                    Part::Class(layout) => Part::Class(if layout.is_none() {
                        *layout
                    } else {
                        LayoutId(layouts[layout.idx()])
                    }),
                    Part::Global(name, arguments) => Part::Global(
                        if name.is_none() {
                            *name
                        } else {
                            StrId(strs[name.idx()])
                        },
                        arguments.iter().map(|&argument| ty(argument)).collect(),
                    ),
                    Part::Array(element) => Part::Array(ty(*element)),
                })
                .collect();
            parts.sort_unstable();
            tys.push(self.tys.intern(Declared {
                prims: *prims,
                ints: *ints,
                parts,
                any_object: *any_object,
                any_function: *any_function,
            }));
        }
        fragment.program_ids = LocalToProgram {
            strs,
            tys,
            layouts,
            globals,
            funcs,
        };
        fragment.summary = Summary::new(fragment);
        fragment.tys.close();
    }
}

pub struct Fragments {
    by_file: Vec<Guarded<Option<Box<Fragment>>>>,
    pub program_ids: ProgramIds,
}

impl Fragments {
    pub fn new(files: usize) -> Fragments {
        Fragments {
            by_file: (0..files).map(|_| Guarded::new(None)).collect(),
            program_ids: ProgramIds::default(),
        }
    }

    pub fn put(&self, mut fragment: Box<Fragment>) {
        self.program_ids.assign(&mut fragment);
        let mut place = self.by_file[fragment.file.idx()].lock();
        fragment.translation_count += place
            .as_ref()
            .map_or(0, |earlier| earlier.translation_count);
        *place = Some(fragment);
    }

    pub fn is_any_of(&self, test: &dyn Fn(FileId) -> bool) -> bool {
        self.by_file.iter().any(|place| {
            place
                .lock()
                .as_ref()
                .is_some_and(|fragment| test(fragment.file))
        })
    }

    pub fn take(
        &self,
        rank_of_file: &dyn Fn(FileId) -> u32,
        in_parallel: InParallel<'_>,
    ) -> Vec<Fragment> {
        const FRAGMENTS_PER_RUN: usize = 128;
        let mut boxes: Vec<Option<Box<Fragment>>> = self
            .by_file
            .iter()
            .map(|place| place.lock().take())
            .filter(Option::is_some)
            .collect();
        boxes.sort_by_cached_key(|fragment| {
            fragment
                .as_ref()
                .map(|fragment| rank_of_file(fragment.file))
        });
        let mut fragments: Vec<Fragment> = Vec::with_capacity(boxes.len());
        let mut runs: Vec<(&mut [Option<Box<Fragment>>], &mut [MaybeUninit<Fragment>])> = boxes
            .chunks_mut(FRAGMENTS_PER_RUN)
            .zip(fragments.spare_capacity_mut().chunks_mut(FRAGMENTS_PER_RUN))
            .collect();
        for_each_mut(&mut runs, in_parallel, &|(boxes, places)| {
            for (fragment, place) in boxes.iter_mut().zip(places.iter_mut()) {
                place.write(
                    *fragment
                        .take()
                        .expect("only fragments that are there are listed"),
                );
            }
        });
        drop(runs);
        // SAFETY: the runs are all of the first `boxes.len()` places, and each has been written.
        unsafe { fragments.set_len(boxes.len()) };
        fragments
    }
}
