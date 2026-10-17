use super::OnceLock;
use super::captures::Receiver;
use super::int32_fields::CodeOwner;
use super::type_flags;
use super::{ByExpression, ByFile};
use crate::atom::Atom;
use crate::bind::{
    AccessKind, ClassOwner, Decl, Flow, FlowId, FlowTarget, FnOwner, MemberOwner, Parent,
    PatParent, SymFlags, SymbolId,
};
use crate::check::decl::{number_operation, to_int32};
use crate::check::errors_names_and_exports::root_declaration;
use crate::check::infer::Inference;
use crate::check::shape::{self, Found};
use crate::check::{Checker, ContextFlags};
use crate::hir::{
    BinOp, CallId, Chain, ClassId, EnumId, ExprId, ExprKind, ExprTag, FileKind, Flags, FnBody,
    FnId, FnKind, ImportEqualsId, Keyword, MemberId, MemberKind, ModifierId, ModifierKind, ParamId,
    PatId, PatKind, PropKey, PropKind, Span, StmtId, StmtKind, TypeNodeKind, UnOp, VarDeclId,
    VarKind,
};
use crate::program::{FileId, Sym};
use crate::types::{EnumValue, MapperId, Prop, PropSource, TypeData, TypeId, TypeKey};
use crate::util::{FxHashMap, FxHashSet};
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone, Default)]
pub struct FreshGraph {
    pub is_object: bool,
    pub within: Vec<(Atom, FreshGraph)>,
    pub anywhere: Option<Box<FreshGraph>>,
    pub elements: Option<Box<FreshGraph>>,
}

impl FreshGraph {
    fn object() -> FreshGraph {
        FreshGraph {
            is_object: true,
            ..FreshGraph::default()
        }
    }

    fn named_contents(self) -> FreshGraph {
        FreshGraph {
            is_object: false,
            elements: None,
            ..self
        }
    }

    fn all_contents(self) -> FreshGraph {
        let mut created = self
            .elements
            .map_or_else(FreshGraph::object, |elements| *elements);
        for held in self
            .within
            .into_iter()
            .map(|held| held.1)
            .chain(self.anywhere.map(|anywhere| *anywhere))
        {
            created.join(held);
        }
        created
    }

    fn join(&mut self, other: FreshGraph) {
        self.is_object |= other.is_object;
        for (name, held) in other.within {
            match self.within.iter_mut().find(|known| known.0 == name) {
                Some(known) => known.1.join(held),
                None => self.within.push((name, held)),
            }
        }
        join_contents(&mut self.anywhere, other.anywhere);
        join_contents(&mut self.elements, other.elements);
    }
}

fn join_contents(so_far: &mut Option<Box<FreshGraph>>, other: Option<Box<FreshGraph>>) {
    let Some(other) = other else { return };
    match so_far {
        Some(known) => known.join(*other),
        None => *so_far = Some(other),
    }
}

fn join_created(so_far: &mut Option<FreshGraph>, other: Option<FreshGraph>) {
    let Some(other) = other else { return };
    match so_far {
        Some(known) => known.join(other),
        None => *so_far = Some(other),
    }
}

#[derive(Default)]
struct InspectedCast {
    functions: Vec<((FileId, FnId), Option<FreshGraph>)>,
    variables: Vec<(Sym, Option<FreshGraph>)>,
}

#[derive(Default)]
struct UntypedArgumentCalls {
    by_name: FxHashSet<Sym>,
    by_parameters: FxHashSet<Vec<super::Identity>>,
    handed_over: FxHashSet<Sym>,
    by_parameters_as_values: FxHashSet<Vec<super::Identity>>,
    escaping_parameter_lists: FxHashSet<Vec<super::Identity>>,
}

impl UntypedArgumentCalls {
    fn absorb(&mut self, more: UntypedArgumentCalls) {
        self.by_name.extend(more.by_name);
        self.by_parameters.extend(more.by_parameters);
        self.handed_over.extend(more.handed_over);
        self.by_parameters_as_values
            .extend(more.by_parameters_as_values);
        self.escaping_parameter_lists
            .extend(more.escaping_parameter_lists);
    }
}

#[derive(Default)]
struct CallSearch {
    next_file: std::sync::atomic::AtomicU32,
    looked_at: bun_threading::Guarded<(u32, Option<UntypedArgumentCalls>)>,
    all_done: bun_threading::Condvar,
}

struct Deletions {
    names_deleted_from_untyped_objects: FxHashSet<Atom>,
    from_dictionaries: Vec<(FileId, ExprId, Atom)>,
}

#[derive(Default)]
pub(super) struct Shared {
    modules: OnceLock<ModuleGraph>,
    lazy_modules: OnceLock<FxHashSet<FileId>>,
    logs_type_errors: OnceLock<bool>,
    marked_pure: OnceLock<FxHashMap<FileId, Vec<u32>>>,
    replaced: OnceLock<[FxHashSet<Vec<u8>>; 2]>,
    evaluates_before_importers_cache: ByFile<bool>,
    by_file: ByFile<FileFacts>,
    mentions: ByFile<(Vec<u32>, Vec<ExprId>)>,
    top_level_uses: ByFile<TopLevelUses>,
    earliest_runs: ByFile<FxHashMap<FnId, u32>>,
    earliest_runs_before_importers: ByFile<FxHashMap<FnId, u32>>,
    returned_casts: ByFile<Vec<(FnId, ExprId)>>,
    sorted_positions: ByFile<SortedPositions>,
    pub(super) external_types: OnceLock<super::flows::ExternalTypes>,
    pub(super) is_search_under_way: std::sync::atomic::AtomicBool,
    pub(super) initial_search: bun_threading::Guarded<Option<super::flows::Search>>,
    pub(super) stored_names: OnceLock<std::sync::Arc<Vec<u64>>>,
    pub(super) pairs_compared: bun_threading::Guarded<Vec<(super::Identity, super::Identity)>>,
    pub(super) records_reaching_javascript:
        bun_threading::Guarded<FxHashMap<super::Identity, super::flows::Place>>,
    pub(super) external_marks:
        bun_threading::Guarded<FxHashMap<super::Identity, super::flows::ExternalMark>>,
    pub(super) places_where_external_data_enters:
        bun_threading::Guarded<Vec<(super::Identity, super::flows::Place)>>,
    receiving_untyped_from_js: std::sync::OnceLock<FxHashSet<Sym>>,
    forwardable_imports: std::sync::OnceLock<FxHashMap<Sym, Vec<(FileId, ExprId)>>>,
    functions_receiving_component_props: OnceLock<FxHashSet<Sym>>,
    sql_row_types: OnceLock<FxHashSet<Sym>>,
    jsx_factories: OnceLock<FxHashSet<(FileId, FnId)>>,
    calls_by_default_parameter_function: OnceLock<FxHashMap<Atom, Vec<(FileId, ExprId)>>>,
    import_calls: OnceLock<FxHashMap<Sym, Vec<(FileId, ExprId)>>>,
    member_mentions: OnceLock<FxHashMap<Atom, Vec<(FileId, ExprId)>>>,
    deletions: OnceLock<Deletions>,
    names_deleted_from_predicted_dictionaries: OnceLock<FxHashSet<Atom>>,
    escaped_members: bun_threading::Guarded<FxHashMap<(Atom, bool), bool>>,
    untyped_argument_calls: OnceLock<UntypedArgumentCalls>,
    call_searches: [CallSearch; 2],
    pub(super) recorded_untyped_object_evidence:
        OnceLock<Box<[bun_threading::Guarded<Option<Box<super::mutations::Mutations<Sym>>>>]>>,
    pub(super) untyped_object_evidence: OnceLock<FxHashSet<Sym>>,
    calls_that_may_redefine: std::sync::OnceLock<Vec<(FileId, ExprId)>>,
    proxy_constructions: std::sync::OnceLock<Vec<(FileId, ExprId)>>,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(super) enum Query {
    Stored(Sym),
    Result(FileId, FnId),
    HostCallback(FileId, FnId),
    Claim(FileId, ExprId),
    ArgumentUse(FileId, ParamId),
    FlowCoverage(Sym),
    FilledWithExternalData(FileId, SymbolId),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum DataFlowNode {
    Variable(Sym),
    Function(FileId, FnId),
    Parameter(FileId, ParamId),
    Expression(FileId, ExprId),
}

#[derive(Default)]
struct DataFlowSearch {
    positions: FxHashMap<DataFlowNode, usize>,
    nodes: Vec<DataFlowNode>,
    carries: Vec<bool>,
    dependents: Vec<Vec<usize>>,
    pending: Vec<usize>,
    evaluated: usize,
    leaves: FxHashMap<(FileId, ExprId), bool>,
}

impl DataFlowSearch {
    fn position_of(&mut self, node: DataFlowNode) -> usize {
        if let Some(&at) = self.positions.get(&node) {
            return at;
        }
        let at = self.nodes.len();
        self.positions.insert(node, at);
        self.nodes.push(node);
        self.carries.push(false);
        self.dependents.push(Vec::new());
        self.pending.push(at);
        at
    }
}

struct InFlight {
    query: Query,
    assumed: u64,
    was_assumed: bool,
}

struct Outermost(usize);

impl Default for Outermost {
    fn default() -> Outermost {
        Outermost(usize::MAX)
    }
}

#[derive(Default)]
pub(super) struct State {
    this_uses: FxHashMap<(FileId, ClassId), Rc<[Use]>>,
    keeps_this: FxHashMap<(FileId, ClassId), bool>,
    flow_coverage: FxHashMap<Sym, FlowCoverage>,
    stored: FxHashMap<Sym, TypeId>,
    external_data_flow: FxHashMap<DataFlowNode, bool>,
    data_flow_in_progress: Vec<DataFlowNode>,
    data_flow_cuts: usize,
    container_mutations: FxHashMap<FileId, Rc<FxHashMap<SymbolId, Vec<ExprId>>>>,
    filled_with_external_data: FxHashMap<(FileId, SymbolId), bool>,
    results: FxHashMap<(FileId, FnId), (TypeId, bool)>,
    in_flight: Vec<InFlight>,
    outermost_assumed: Outermost,
    provisional_results: FxHashMap<Query, u64>,
    provisional_order: Vec<(Query, usize)>,
    confirmed_results: FxHashMap<Query, u64>,
    host_callbacks: FxHashMap<(FileId, FnId), bool>,
    stricter_method_params: FxHashMap<(FileId, ParamId), bool>,
    escaped: FxHashMap<(FileId, FnId), bool>,
    is_cross_file_query: bool,
    untyped_clones: FxHashMap<(FileId, FnId), bool>,
    pub(super) builtin_bindings: FxHashMap<Sym, Option<(FileId, ExprId)>>,
    pub(super) builtin_or_undefined_bindings: FxHashMap<Sym, Option<(FileId, ExprId)>>,
    has_tdz_cache: FxHashMap<Sym, bool>,
    logging_untyped_clones: FxHashMap<(FileId, FnId), bool>,
    ignores_member_names: bool,
    pub(in crate::check) accessed_within: Option<FileId>,
    untyped_clone_spans: Option<(FileId, Rc<[(u32, u32)]>)>,
    is_searching_calls: bool,
    set_aside: Option<Box<SavedState>>,
    untyped_state_owner: Option<(FileId, Rc<[(u32, u32)]>)>,
    maybe_uninitialized_fields: FxHashMap<Sym, bool>,
    constants: FxHashMap<Sym, Option<Primitive>>,
    long_string_constants: FxHashMap<Sym, Option<Primitive>>,
    chain_values: FxHashMap<(FileId, ExprId, bool), Option<Primitive>>,
    folding_long_strings: bool,
    pure_prefix_ends: RefCell<FxHashMap<FileId, u32>>,
    deferred_modules: FxHashMap<FileId, bool>,
    lazy_variables: FxHashMap<Sym, Option<(FileId, VarDeclId)>>,
    only_allocates: FxHashMap<(FileId, FnId), Option<bool>>,
    walked: FxHashMap<(FileId, ExprId), Result<WalkedAs, &'static str>>,
    lazy_declarations: FxHashMap<(FileId, VarDeclId), Option<bool>>,
    produced: ByExpression<TypeId>,
    reads: ByExpression<Option<ReferenceRead>>,
    variable_reads: FxHashMap<Sym, Option<VariableRead>>,
    string_proof_steps: u32,
    redefinitions: Option<Rc<[Redefinition]>>,
    proxy_type_parameters: Option<Rc<[TypeId]>>,
}

#[derive(Default)]
struct SavedState {
    flow_coverage: FxHashMap<Sym, FlowCoverage>,
    variable_reads: FxHashMap<Sym, Option<VariableRead>>,
    stored: FxHashMap<Sym, TypeId>,
    external_data_flow: FxHashMap<DataFlowNode, bool>,
    filled_with_external_data: FxHashMap<(FileId, SymbolId), bool>,
    confirmed_results: FxHashMap<Query, u64>,
    results: FxHashMap<(FileId, FnId), (TypeId, bool)>,
    trust: super::trust::State,
    integers: super::integers::State,
    kinds: super::kinds::State,
}

type Redefinition = (TypeId, Option<Vec<Atom>>);

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum Primitive {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(Atom),
}

struct SortedPositions {
    functions: Box<[(u32, FnId)]>,
    classes: Box<[u32]>,
    private_name_uses: Box<[u32]>,
}

#[derive(Default)]
struct TopLevelUses {
    later: FxHashSet<SymbolId>,
    during: FxHashSet<SymbolId>,
    in_initializers: Vec<(SymbolId, VarDeclId)>,
}

#[derive(Copy, Clone)]
enum UsedFrom {
    Later,
    Initializer(VarDeclId),
    During,
    Nowhere,
}

const FIXED_GLOBALS: &[&[u8]] = &[
    b"undefined",
    b"NaN",
    b"Infinity",
    b"Object",
    b"Array",
    b"ArrayBuffer",
    b"Map",
    b"Set",
    b"WeakMap",
    b"WeakSet",
    b"Int8Array",
    b"Uint8Array",
    b"Uint8ClampedArray",
    b"Int16Array",
    b"Uint16Array",
    b"Int32Array",
    b"Uint32Array",
    b"Float32Array",
    b"Float64Array",
    b"Error",
    b"AggregateError",
    b"EvalError",
    b"RangeError",
    b"ReferenceError",
    b"SyntaxError",
    b"TypeError",
    b"URIError",
];

#[derive(Copy, Clone, PartialEq, Eq)]
enum Walked {
    Undefined,
    Null,
    Primitive {
        may_be_nullish: bool,
    },
    Anything {
        may_be_nullish: bool,
    },
    Object,
    Function {
        file: FileId,
        func: FnId,
        within: u32,
    },
    Class(FileId, ClassId),
    Allocated(u32),
}

impl Walked {
    const VALUE: Walked = Walked::Primitive {
        may_be_nullish: false,
    };

    fn may_be_nullish(self) -> bool {
        matches!(
            self,
            Walked::Undefined
                | Walked::Null
                | Walked::Primitive {
                    may_be_nullish: true
                }
                | Walked::Anything {
                    may_be_nullish: true
                }
        )
    }

    fn is_primitive(self) -> bool {
        matches!(
            self,
            Walked::Undefined | Walked::Null | Walked::Primitive { .. }
        )
    }

    fn is_nullish(self) -> bool {
        matches!(self, Walked::Undefined | Walked::Null)
    }

    fn is_object(self) -> bool {
        matches!(
            self,
            Walked::Object | Walked::Function { .. } | Walked::Class(..) | Walked::Allocated(_)
        )
    }

    fn without_nullish(self) -> Walked {
        match self {
            Walked::Primitive { .. } => Walked::VALUE,
            Walked::Anything { .. } => Walked::Anything {
                may_be_nullish: false,
            },
            other => other,
        }
    }

    fn join(self, other: Walked) -> Walked {
        if self == other {
            self
        } else if self.is_primitive() && other.is_primitive() {
            Walked::Primitive {
                may_be_nullish: true,
            }
        } else if self.is_object() && other.is_object() {
            Walked::Object
        } else {
            Walked::Anything {
                may_be_nullish: self.may_be_nullish() || other.may_be_nullish(),
            }
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum CreatedAs {
    Record,
    Instance(FileId, ClassId),
    List,
    Collection { has_values: bool, is_weak: bool },
}

struct WalkAllocation {
    allocated_as: CreatedAs,
    fields: Vec<(Atom, Walked)>,
    elements: Option<Walked>,
    holds_local_lists: bool,
    is_frozen: bool,
    uncertainty: u32,
}

struct Activation {
    function: (FileId, FnId),
    serial: u32,
    this: Option<Walked>,
    bound_from: usize,
    uncertainty_base: u32,
    returned: Option<Walked>,
    constructs: Option<((FileId, ClassId), Option<(FileId, ClassId)>)>,
    has_called_super: bool,
}

struct Walk {
    root: (FileId, u32),
    bound: Vec<((FileId, SymbolId), Walked, u32)>,
    running: Vec<Activation>,
    constructing: Vec<(FileId, ClassId)>,
    created: Vec<WalkAllocation>,
    known_initialized: Vec<Sym>,
    uncertainty: u32,
    serials: u32,
    steps: u32,
    depth: u32,
    obstacle: &'static str,
}

impl Walk {
    fn new(root: (FileId, u32)) -> Walk {
        Walk {
            root,
            bound: Vec::new(),
            running: Vec::new(),
            constructing: Vec::new(),
            created: Vec::new(),
            known_initialized: Vec::new(),
            uncertainty: 0,
            serials: 0,
            steps: 0,
            depth: 0,
            obstacle: "",
        }
    }

    fn bail<T>(&mut self, why: &'static str) -> Option<T> {
        if self.obstacle.is_empty() {
            self.obstacle = why;
        }
        None
    }

    fn make(
        &mut self,
        allocated_as: CreatedAs,
        fields: Vec<(Atom, Walked)>,
        elements: Option<Walked>,
    ) -> Walked {
        self.created.push(WalkAllocation {
            allocated_as,
            fields,
            elements,
            holds_local_lists: false,
            is_frozen: false,
            uncertainty: self.uncertainty,
        });
        Walked::Allocated(self.created.len() as u32 - 1)
    }

    fn is_list(&self, value: Walked) -> bool {
        matches!(value, Walked::Allocated(it) if self.created[it as usize].allocated_as == CreatedAs::List)
    }

    fn serial(&self) -> u32 {
        self.running
            .last()
            .map_or(0, |activation| activation.serial)
    }

    fn bind(&mut self, file: FileId, symbol: SymbolId, value: Walked) {
        self.bound.push(((file, symbol), value, self.uncertainty));
    }
}

fn set_walked_field(fields: &mut Vec<(Atom, Walked)>, name: Atom, value: Walked, is_certain: bool) {
    match fields.iter_mut().find(|field| field.0 == name) {
        Some(field) => {
            field.1 = if is_certain {
                value
            } else {
                field.1.join(value)
            }
        }
        None => fields.push((
            name,
            if is_certain {
                value
            } else {
                value.join(Walked::Undefined)
            },
        )),
    }
}

fn join_walked(so_far: Option<Walked>, other: Option<Walked>) -> Option<Walked> {
    match (so_far, other) {
        (Some(a), Some(b)) => Some(a.join(b)),
        (a, b) => a.or(b),
    }
}

#[derive(Clone)]
struct WalkedAs {
    is_object: bool,
    known_initialized: Rc<[Sym]>,
}

const MAX_WALK_STEPS: u32 = 4000;
const MAX_WALK_ACTIVATIONS: usize = 16;
const MAX_WALK_DEPTH: u32 = 96;

const OBJECT_PROTOTYPE_NAMES: &[&[u8]] = &[
    b"constructor",
    b"__proto__",
    b"__defineGetter__",
    b"__defineSetter__",
    b"__lookupGetter__",
    b"__lookupSetter__",
    b"hasOwnProperty",
    b"isPrototypeOf",
    b"propertyIsEnumerable",
    b"toLocaleString",
    b"toString",
    b"valueOf",
];

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum EvaluationTime {
    First,
    Immediately,
    InModuleBody,
    Later,
    DeferredFromModuleBody,
}

#[derive(Default)]
struct ModuleGraph {
    importers: FxHashMap<FileId, Vec<FileId>>,
    evaluates: FxHashMap<FileId, Vec<(FileId, EvaluationTime)>>,
    cycle: FxHashMap<FileId, u32>,
    is_module: Vec<bool>,
    in_cycles: FxHashSet<FileId>,
    exposed: FxHashSet<FileId>,
}

impl ModuleGraph {
    fn new(
        modules: &[FileId],
        edges: &[(FileId, FileId, EvaluationTime)],
        has_top_level_await: bool,
    ) -> ModuleGraph {
        let mut graph = ModuleGraph::default();
        let (mut evaluated, mut first): (
            FxHashMap<FileId, Vec<FileId>>,
            FxHashMap<FileId, Vec<FileId>>,
        ) = Default::default();
        let mut pending = Vec::new();
        for &(from, to, how) in edges {
            evaluated.entry(from).or_default().push(to);
            graph.evaluates.entry(from).or_default().push((to, how));
            if how == EvaluationTime::First {
                first.entry(from).or_default().push(to);
                graph.importers.entry(to).or_default().push(from);
                if from == to {
                    graph.in_cycles.insert(from);
                }
            } else if !matches!(
                how,
                EvaluationTime::Later | EvaluationTime::DeferredFromModuleBody
            ) || has_top_level_await
            {
                pending.push(to);
            }
        }
        while let Some(module) = pending.pop() {
            if graph.exposed.insert(module) {
                pending.extend(evaluated.get(&module).into_iter().flatten());
            }
        }
        let (mut left, mut seen) = (Vec::new(), FxHashSet::default());
        for &root in modules {
            let mut path = if seen.insert(root) {
                vec![(root, 0)]
            } else {
                Vec::new()
            };
            while let Some(&(module, next)) = path.last() {
                match first.get(&module).and_then(|imported| imported.get(next)) {
                    Some(&imported) => {
                        if let Some(top) = path.last_mut() {
                            top.1 += 1;
                        }
                        if seen.insert(imported) {
                            path.push((imported, 0));
                        }
                    }
                    None => {
                        left.push(module);
                        path.pop();
                    }
                }
            }
        }
        for (number, &root) in left.iter().rev().enumerate() {
            if graph.cycle.contains_key(&root) {
                continue;
            }
            graph.cycle.insert(root, number as u32);
            let (mut members, mut at) = (vec![root], 0);
            while at < members.len() {
                for &importer in graph.importers.get(&members[at]).into_iter().flatten() {
                    if let std::collections::hash_map::Entry::Vacant(e) =
                        graph.cycle.entry(importer)
                    {
                        e.insert(number as u32);
                        members.push(importer);
                    }
                }
                at += 1;
            }
            if members.len() > 1 {
                graph.in_cycles.extend(members);
            }
        }
        graph.is_module = vec![
            false;
            graph
                .cycle
                .keys()
                .map(|file| file.idx() + 1)
                .max()
                .unwrap_or(0)
        ];
        for file in graph.cycle.keys() {
            graph.is_module[file.idx()] = true;
        }
        graph
    }

    fn evaluates_before_importers(&self, module: FileId) -> bool {
        if !self.cycle.contains_key(&module)
            || self.in_cycles.contains(&module)
            || self.exposed.contains(&module)
        {
            return false;
        }
        let importers_of =
            |module: FileId| self.importers.get(&module).into_iter().flatten().copied();
        let mut run_after: FxHashSet<FileId> = FxHashSet::default();
        run_after.insert(module);
        let mut pending = vec![module];
        while let Some(at) = pending.pop() {
            for importer in importers_of(at) {
                if self.cycle.get(&importer) != self.cycle.get(&at) && run_after.insert(importer) {
                    pending.push(importer);
                }
            }
        }
        let mut seen: FxHashSet<FileId> = FxHashSet::default();
        pending.push(module);
        while let Some(at) = pending.pop() {
            for importer in importers_of(at) {
                if !run_after.contains(&importer) {
                    return false;
                }
                if seen.insert(importer) {
                    pending.push(importer);
                }
            }
        }
        true
    }
}

#[derive(Copy, Clone)]
enum FlowCoverage {
    Everywhere,
    Within(Site),
    Nowhere,
}

impl FlowCoverage {
    fn encoded(self) -> u64 {
        match self {
            FlowCoverage::Everywhere => 0,
            FlowCoverage::Nowhere => 1,
            FlowCoverage::Within(Site::File) => 2,
            FlowCoverage::Within(Site::Body(func)) => 3 | u64::from(func.0) << 8,
            FlowCoverage::Within(Site::Parameter(parameter)) => 4 | u64::from(parameter.0) << 8,
            FlowCoverage::Within(Site::Initializer(member)) => 5 | u64::from(member.0) << 8,
        }
    }

    fn decoded(code: u64) -> FlowCoverage {
        let id = (code >> 8) as u32;
        match code & 0xff {
            0 => FlowCoverage::Everywhere,
            2 => FlowCoverage::Within(Site::File),
            3 => FlowCoverage::Within(Site::Body(FnId(id))),
            4 => FlowCoverage::Within(Site::Parameter(ParamId(id))),
            5 => FlowCoverage::Within(Site::Initializer(MemberId(id))),
            _ => FlowCoverage::Nowhere,
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub struct Storage {
    pub ty: TypeId,
    pub starts_undefined: bool,
}

#[derive(Copy, Clone)]
struct VariableRead {
    declared_in: FileId,
    coverage: FlowCoverage,
    declared: TypeId,
    may_be_undefined: bool,
    is_asserted: bool,
}

#[derive(Copy, Clone, Debug)]
pub struct ReferenceRead {
    pub declared: TypeId,
    pub is_narrowing_reliable: bool,
    pub may_be_undefined: bool,
    pub is_asserted: bool,
}

struct FileFacts {
    read_before_assignment: Vec<u64>,
    cleared: Vec<u64>,
    self_referenced_in_tdz: Vec<u64>,
    referenced_in_tdz: Vec<u64>,
    captured_in_tdz: Vec<u64>,
    seen_by_importers: Vec<u64>,
    stored_through_casts: Vec<u64>,
    this: Vec<(ClassId, ThisUseSite, Access)>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Site {
    File,
    Body(FnId),
    Parameter(ParamId),
    Initializer(MemberId),
}

#[derive(Copy, Clone)]
struct Declared {
    site: Option<Site>,
    tdz_end: u32,
    is_blank: bool,
    initializer_end: u32,
}

#[derive(Copy, Clone)]
enum Store {
    Variable(SymbolId),
    Field(Atom),
    Super,
}

#[derive(Default)]
struct Search {
    seen: FxHashSet<(FlowId, u32)>,
    reduced: Vec<(FlowId, FlowId, u32)>,
    pending: Vec<(FlowId, u32)>,
}

#[derive(Copy, Clone)]
enum ThisUseSite {
    Parameters,
    Initializer(MemberId),
    Body(FlowId),
}

#[derive(Copy, Clone)]
enum Access {
    Reads(Atom),
    Stores(Atom),
    Leaks,
}

#[derive(Copy, Clone)]
struct Use {
    at: ThisUseSite,
    reads: Atom,
}

#[derive(Copy, Clone)]
enum Stored {
    ByInitializer(MemberId),
    AsParameter,
    ByConstructor,
}

const MAX_PURE_ALLOCATION_LENGTH: f64 = 65536.0;
const MAX_CONSTANT_BYTES: usize = 64;
const MAX_FOLDED_STRING_PART_LEN: usize = 16384;

fn substitution_end(text: &[u8], mut i: usize) -> usize {
    while i < text.len() && text[i] != b'}' {
        match (text[i], text.get(i + 1)) {
            (b'/', Some(b'*')) => {
                i += 2;
                while i < text.len() && !text[i..].starts_with(b"*/") {
                    i += 1;
                }
                i += 2;
            }
            (b'/', Some(b'/')) => {
                while i < text.len()
                    && !matches!(text[i], b'\n' | b'\r')
                    && !text[i..].starts_with(b"\xE2\x80\xA8")
                    && !text[i..].starts_with(b"\xE2\x80\xA9")
                {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
    i + 1
}

fn set(bits: &mut [u64], symbol: SymbolId) {
    if let Some(word) = bits.get_mut(symbol.idx() / 64) {
        *word |= 1 << (symbol.idx() % 64);
    }
}

fn has(bits: &[u64], symbol: SymbolId) -> bool {
    bits.get(symbol.idx() / 64)
        .is_some_and(|word| word >> (symbol.idx() % 64) & 1 != 0)
}

impl<'p, 's> Checker<'p, 's> {
    pub fn symbol_storage(&mut self, sym: Sym) -> Storage {
        Storage {
            ty: self.stored_type(sym),
            starts_undefined: self.starts_undefined(sym),
        }
    }

    pub(super) fn stored_type(&mut self, sym: Sym) -> TypeId {
        if let Some(&known) = self.aot.storage.stored.get(&sym) {
            return known;
        }
        if let Some(assumed) = self.assumption(Query::Stored(sym)) {
            return TypeId(assumed as u32);
        }
        let declared = self.type_of_symbol(sym);
        let (stored, is_final) = self.solve(
            Query::Stored(sym),
            u64::from(declared.0),
            u64::from(TypeId::UNKNOWN.0),
            |c| u64::from(c.compute_stored_type(sym, declared).0),
        );
        let stored = TypeId(stored as u32);
        if is_final {
            self.aot.storage.stored.insert(sym, stored);
        }
        stored
    }

    fn without_number_literals(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, part| {
            if matches!(
                c.data(part),
                TypeData::NumberLit { .. } | TypeData::BigIntLit { .. } | TypeData::BoolLit { .. }
            ) {
                c.base_of_literal(part)
            } else {
                part
            }
        })
    }

    pub fn without_number_literals_in_arguments(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, part| {
            c.without_number_literals_in_arguments_inner(part, 4, false)
        })
    }

    pub fn without_number_literals_deep(&mut self, ty: TypeId) -> TypeId {
        let ty = self.without_number_literals(ty);
        self.without_number_literals_in_arguments(ty)
    }

    fn without_number_literals_in_arguments_inner(
        &mut self,
        part: TypeId,
        depth: u32,
        is_under_an_argument: bool,
    ) -> TypeId {
        if depth == 0 {
            return part;
        }
        match self.data(part) {
            TypeData::Ref { target, .. }
                if self.files().module(target.file).is_lib
                    && !self.is_reference_to_global(part, crate::atom::known::ReadonlyArray, 1) =>
            {
                let not_known_before = self.aot.flows.unknown_count;
                let arguments = self.type_arguments(part);
                let mapped: Vec<TypeId> = arguments
                    .iter()
                    .map(|&argument| self.argument_without_number_literals(argument, depth - 1))
                    .collect();
                if mapped[..] == *arguments {
                    return part;
                }
                let rebuilt = self.intern_key(TypeKey::Ref {
                    target: *target,
                    args: &mapped,
                });
                self.seen_wider(part, rebuilt, not_known_before)
            }
            TypeData::Tuple {
                flags,
                readonly: false,
                ..
            } if is_under_an_argument => {
                let not_known_before = self.aot.flows.unknown_count;
                let elements = self.type_arguments(part);
                let mapped: Vec<TypeId> = elements
                    .iter()
                    .map(|&element| self.argument_without_number_literals(element, depth - 1))
                    .collect();
                if mapped[..] == *elements {
                    return part;
                }
                let rebuilt = self.normalized_tuple(&mapped, flags, false);
                self.seen_wider(part, rebuilt, not_known_before)
            }
            _ => part,
        }
    }

    fn seen_wider(&mut self, part: TypeId, wider: TypeId, not_known_before: usize) -> TypeId {
        if self.is_provably_assignable(part, wider) {
            wider
        } else if self.aot.flows.unknown_count != not_known_before {
            TypeId::UNKNOWN
        } else {
            part
        }
    }

    fn argument_without_number_literals(&mut self, argument: TypeId, depth: u32) -> TypeId {
        let argument = self.without_number_literals(argument);
        self.map_type(argument, |c, part| {
            c.without_number_literals_in_arguments_inner(part, depth, true)
        })
    }

    fn compute_stored_type(&mut self, sym: Sym, declared: TypeId) -> TypeId {
        self.compute_stored_type_from(sym, declared, true)
    }

    fn compute_stored_type_from(
        &mut self,
        sym: Sym,
        declared: TypeId,
        follows_assignments: bool,
    ) -> TypeId {
        if let Some((file, Decl::Param(pat) | Decl::Var(pat))) = self.files().value_declaration(sym)
            && self.is_in_untyped_clone_span(file, self.hir(file)[pat].pos)
        {
            return TypeId::UNKNOWN;
        }
        if let Some((file, Decl::Param(pat))) = self.files().value_declaration(sym)
            && let PatParent::Param(p) = root_declaration(self.bound(file), pat)
            && self.is_param_predicted(file, p)
        {
            return TypeId::UNKNOWN;
        }
        if let Some((file, Decl::Param(pat))) = self.files().value_declaration(sym)
            && let PatParent::Param(p) = root_declaration(self.bound(file), pat)
            && self.hir(file)[p].ty.is_none()
        {
            return self.without_number_literals(declared);
        }
        let Some((file, Decl::Var(pat))) = self.files().value_declaration(sym) else {
            return declared;
        };
        let hir = self.hir(file);
        let PatParent::Var(d) = root_declaration(self.bound(file), pat) else {
            return declared;
        };
        if hir[d].ty.is_some() {
            let is_external_data = hir[d].pat == pat
                && hir[d].init.is_some()
                && self.never_has_fixed_layout(declared)
                && self.is_predicted(file, hir[d].init);
            return if is_external_data {
                TypeId::UNKNOWN
            } else {
                declared
            };
        }
        let is_loop_binding =
            hir[d].init.is_none() && self.loop_variable_iterable(file, d).is_some();
        let is_literal = hir[d].init.is_some()
            && matches!(
                hir[hir[d].init].kind,
                ExprKind::True
                    | ExprKind::False
                    | ExprKind::Number(_)
                    | ExprKind::BigInt(_)
                    | ExprKind::Unary { .. }
                    | ExprKind::As { .. }
            );
        let declared = if is_loop_binding
            || hir[d].pat != pat
            || matches!(hir[d].kind, VarKind::Let | VarKind::Var)
            || !is_literal
        {
            self.without_number_literals(declared)
        } else {
            declared
        };
        let declared = self.without_number_literals_in_arguments(declared);
        if hir[d].pat == pat
            && hir[d].init.is_some()
            && matches!(hir[d].kind, VarKind::Let | VarKind::Var)
        {
            let parts: &[TypeId] = self.parts(declared);
            if !parts.is_empty() && parts.iter().all(|&part| self.is_nullish(part)) {
                return TypeId::UNKNOWN;
            }
        }
        if hir[d].pat != pat || hir[d].init.is_none() {
            let source = if hir[d].init.is_some() {
                hir[d].init
            } else {
                self.loop_variable_iterable(file, d)
            };
            if source.is_none() {
                return if hir[d].pat == pat {
                    self.assigned_type(file, sym).unwrap_or(declared)
                } else {
                    declared
                };
            }
            let is_predicted = self.is_predicted(file, source)
                || self.holds_unknown_elements(file, source)
                || (hir[d].init.is_some() && self.destructures_predicted_prop(file, pat, source));
            return if is_predicted {
                TypeId::UNKNOWN
            } else {
                declared
            };
        }
        if self.is_container_filled_with_external_data(file, sym, declared)
            || self.holds_unknown_elements(file, hir[d].init)
        {
            return self.with_unknown_elements(declared);
        }
        if follows_assignments
            && matches!(hir[d].kind, VarKind::Let | VarKind::Var)
            && self.receives_prediction(sym)
        {
            return TypeId::UNKNOWN;
        }
        let declared = if follows_assignments
            && matches!(hir[d].kind, VarKind::Let | VarKind::Var)
            && self.is_assigned_a_sum_that_may_be_a_number(file, sym, declared)
        {
            self.union(&[declared, TypeId::NUMBER])
        } else {
            declared
        };
        if self.has_propagated_type(file, hir[d].init) {
            return declared;
        }
        let forwarded = self.propagated_type(file, hir[d].init);
        self.union(&[declared, forwarded])
    }

    fn assigned_type(&mut self, file: FileId, sym: Sym) -> Option<TypeId> {
        let (values, computed) = self.stored_expressions(sym)?;
        let mut stored: Vec<TypeId> = values
            .into_iter()
            .map(|value| self.propagated_type(file, value))
            .collect();
        stored.extend(computed.into_iter().map(|by| self.type_of_expr(file, by)));
        let are_primitives = !stored.is_empty()
            && stored
                .iter()
                .all(|&ty| self.every_type(ty, |c, part| c.is_primitive(part)));
        are_primitives.then(|| self.union(&stored))
    }

    pub(super) fn assumption(&mut self, query: Query) -> Option<u64> {
        let state = &mut self.aot.storage;
        let index = state.in_flight.iter().position(|it| it.query == query)?;
        state.in_flight[index].was_assumed = true;
        state.outermost_assumed.0 = state.outermost_assumed.0.min(index);
        Some(state.in_flight[index].assumed)
    }

    pub(super) fn solve(
        &mut self,
        query: Query,
        start: u64,
        give_up: u64,
        find: impl Fn(&mut Self) -> u64,
    ) -> (u64, bool) {
        const MAX_ROUNDS: usize = 8;
        if let Some(found) = self.aot.storage.confirmed_results.remove(&query) {
            return (found, true);
        }
        if let Some(&found) = self.aot.storage.provisional_results.get(&query) {
            let state = &mut self.aot.storage;
            let relied_on = state
                .provisional_order
                .last()
                .map_or(usize::MAX, |&(_, lowest)| lowest);
            state.outermost_assumed.0 = state.outermost_assumed.0.min(relied_on);
            return (found, false);
        }
        let index = self.aot.storage.in_flight.len();
        let retained = self.aot.storage.provisional_order.len();
        self.aot.storage.in_flight.push(InFlight {
            query,
            assumed: start,
            was_assumed: false,
        });
        let further_out = std::mem::take(&mut self.aot.storage.outermost_assumed).0;
        let mut rounds = 0;
        let found = loop {
            self.aot.storage.in_flight[index].was_assumed = false;
            let found = find(self);
            let own = &mut self.aot.storage.in_flight[index];
            if !own.was_assumed || own.assumed == found {
                break found;
            }
            own.assumed = found;
            rounds += 1;
            let state = &mut self.aot.storage;
            for (member, _) in state.provisional_order.drain(retained..) {
                state.provisional_results.remove(&member);
            }
            if rounds == MAX_ROUNDS {
                break give_up;
            }
        };
        self.aot.storage.in_flight.truncate(index);
        let relied_on = self.aot.storage.outermost_assumed.0;
        let is_final = relied_on >= index;
        self.aot.storage.outermost_assumed.0 = if is_final {
            further_out
        } else {
            further_out.min(relied_on)
        };
        let state = &mut self.aot.storage;
        if is_final {
            for (member, _) in state.provisional_order.drain(retained..) {
                if let Some(found) = state.provisional_results.remove(&member) {
                    state.confirmed_results.insert(member, found);
                }
            }
        } else {
            let lowest = state
                .provisional_order
                .last()
                .map_or(relied_on, |&(_, lowest)| lowest.min(relied_on));
            state.provisional_order.push((query, lowest));
            state.provisional_results.insert(query, found);
        }
        (found, is_final)
    }

    fn destructures_predicted_prop(&mut self, file: FileId, pat: PatId, source: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut names = Vec::new();
        let mut at = pat;
        loop {
            match bound.pat_parent[at.idx()] {
                PatParent::Prop(outer, prop) => {
                    match (hir[prop].key, hir[hir[prop].value].kind) {
                        (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name))
                            if !hir[prop].is_rest =>
                        {
                            names.push(name)
                        }
                        _ => return false,
                    }
                    at = outer;
                }
                PatParent::Var(_) => break,
                _ => return false,
            }
        }
        let mut ty = self.type_of_expr(file, source);
        for name in names.into_iter().rev() {
            if self.has_predicted_prop(ty, name) || self.has_ambient_class_member(ty, name) {
                return true;
            }
            let object = self.non_nullable(ty);
            let Some(next) = self.type_of_property(object, name) else {
                return false;
            };
            ty = next;
        }
        false
    }

    pub fn is_destructured_from_prediction(&mut self, file: FileId, pat: PatId) -> bool {
        let hir = self.hir(file);
        match root_declaration(self.bound(file), pat) {
            PatParent::Var(d) if hir[d].ty.is_none() && hir[d].pat != pat => {
                let source = if hir[d].init.is_some() {
                    hir[d].init
                } else {
                    self.loop_variable_iterable(file, d)
                };
                source.is_some()
                    && (self.is_predicted(file, source)
                        || self.holds_unknown_elements(file, source)
                        || (hir[d].init.is_some()
                            && self.destructures_predicted_prop(file, pat, source)))
            }
            PatParent::Param(p) => self.is_param_predicted(file, p),
            _ => false,
        }
    }

    fn loop_variable_iterable(&self, file: FileId, d: VarDeclId) -> ExprId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let left = bound.var_stmt[d.idx()];
        if left.is_none() {
            return ExprId::NONE;
        }
        match bound.stmt_parent[left.idx()] {
            Parent::Stmt(parent) => match hir[parent].kind {
                StmtKind::ForOf {
                    left: declares,
                    expr,
                    ..
                } if declares == left => expr,
                _ => ExprId::NONE,
            },
            _ => ExprId::NONE,
        }
    }

    pub fn double_cast_source(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let ExprKind::As {
            expr: mut operand, ..
        } = self.hir(file)[e].kind
        else {
            return None;
        };
        let mut is_double = false;
        while let ExprKind::As { expr, .. } = self.hir(file)[operand].kind {
            let between = self.type_of_expr(file, operand);
            if !between.is_any() && between != TypeId::UNKNOWN && !between.is_never() {
                break;
            }
            (operand, is_double) = (expr, true);
        }
        let target = self.type_of_expr(file, e);
        let target = self.reduced(target);
        let parts: &[TypeId] = self.parts(target);
        if !is_double
            || !parts
                .iter()
                .copied()
                .any(|part| self.can_be_created_from_any_object(part))
        {
            return None;
        }
        if matches!(
            self.hir(file)[operand].kind,
            ExprKind::Object(_) | ExprKind::Array(_)
        ) {
            return None;
        }
        let source = self.known_type_of(file, operand);
        (!self.is_uninformative(source) && !self.is_untyped(source)).then_some(source)
    }

    pub fn has_unknown_fields(&mut self, ty: TypeId) -> bool {
        if !self.results_are_provisional()
            && let Some(&known) = self.aot.flows.untyped_for_fields.get(&ty)
        {
            return known;
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.compute_has_unknown_fields(ty));
        if is_cacheable {
            self.aot.flows.untyped_for_fields.insert(ty, found);
        }
        found
    }

    fn compute_has_unknown_fields(&mut self, ty: TypeId) -> bool {
        if self.is_uninformative(ty) || self.is_untyped(ty) {
            return true;
        }
        let ty = self.reduced(ty);
        self.parts(ty).iter().any(|&part| {
            self.members(part).is_some_and(|members| {
                let shape = members.shape();
                shape.props.is_empty()
                    && !shape.index.is_empty()
                    && shape.call.is_empty()
                    && shape.construct.is_empty()
            })
        })
    }

    pub fn returned_forced_cast_operand(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        const MAX_CALLS: u32 = 4;
        self.forced_cast_operand_through_calls(file, e, MAX_CALLS)
    }

    pub fn callee_returns_any(&mut self, file: FileId, e: ExprId) -> bool {
        let Some((of, func, _)) = self
            .resolved_signature(file, e)
            .sig
            .and_then(|sig| self.sig_decl(sig))
        else {
            return false;
        };
        let Some((of, func)) = self.implementation_for(of, func) else {
            return false;
        };
        if self.is_untyped_file(of) || !self.is_compiled(of) {
            return false;
        }
        self.returned_values(of, func)
            .into_iter()
            .filter(|returned| returned.is_some())
            .any(|returned| {
                let produced = self.type_of_expr(of, returned);
                self.is_any_like(produced)
            })
    }

    fn forced_cast_operand_through_calls(
        &mut self,
        file: FileId,
        e: ExprId,
        calls_left: u32,
    ) -> Option<TypeId> {
        let (of, func, _) = self
            .resolved_signature(file, e)
            .sig
            .and_then(|sig| self.sig_decl(sig))?;
        let returned = self.returned_casts_in(of);
        for &(_, returned) in returned.iter().filter(|returned| returned.0 == func) {
            let to = self.type_of_expr(of, returned);
            if !self.has_type_variables(to) {
                continue;
            }
            match self.hir(of)[returned].kind {
                ExprKind::As { expr, .. } => {
                    let between = self.type_of_expr(of, expr);
                    if !self.has_unknown_fields(between) {
                        continue;
                    }
                    let mut operand = expr;
                    while let ExprKind::As { expr, .. } = self.hir(of)[operand].kind {
                        operand = expr;
                    }
                    return Some(self.known_type_of(of, operand));
                }
                _ if calls_left > 0 => {
                    if let Some(operand) =
                        self.forced_cast_operand_through_calls(of, returned, calls_left - 1)
                    {
                        return Some(operand);
                    }
                }
                _ => {}
            }
        }
        None
    }

    fn returned_casts_in(&self, file: FileId) -> &'p Vec<(FnId, ExprId)> {
        let program = self.p;
        program.aot.storage.returned_casts.get_or_init(program.files.modules.len(), file, || {
            let (hir, bound) = (self.hir(file), self.bound(file));
            let by_kind = self.file_exprs_by_kind(file);
            (by_kind.of(ExprTag::As).iter().chain(by_kind.of(ExprTag::Call)))
                .filter_map(|&cast| match bound.expr_parent[cast.idx()] {
                    Parent::Stmt(stmt) if matches!(hir[stmt].kind, StmtKind::Return(value) if value == cast) => match self.owning_code(file, Parent::Stmt(stmt)) {
                        Some(CodeOwner::Function(func)) => Some((func, cast)),
                        _ => None,
                    },
                    Parent::FnBody(func) => Some((func, cast)),
                    _ => None,
                })
                .collect()
        })
    }

    fn known_type_of(&mut self, file: FileId, e: ExprId) -> TypeId {
        let forwarded = self.propagated_type(file, e);
        if !self.is_uninformative(forwarded) {
            return forwarded;
        }
        let Some(first) = self.returned_argument_of(file, e) else {
            return forwarded;
        };
        let of_first = self.known_type_of(file, first);
        if self.is_uninformative(of_first) || self.is_untyped(of_first) {
            forwarded
        } else {
            self.type_of_expr(file, e)
        }
    }

    pub fn is_external_data_cast_to_primitives(&mut self, file: FileId, e: ExprId) -> bool {
        let ExprKind::As {
            expr: mut written, ..
        } = self.hir(file)[e].kind
        else {
            return false;
        };
        while let ExprKind::As { expr, .. } = self.hir(file)[written].kind {
            written = expr;
        }
        if !matches!(
            self.hir(file)[written].kind,
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_)
        ) {
            return false;
        }
        let target = self.type_of_expr(file, e);
        !self.is_uninformative(target)
            && self.every_type(target, |c, part| c.is_primitive(part))
            && self.is_predicted(file, written)
    }

    pub fn result_type_of(&mut self, file: FileId, e: ExprId) -> TypeId {
        if let Some(&known) = self.aot.storage.produced.get((file, e)) {
            return known;
        }
        let asked = self.begin_query();
        let found = self.compute_result_type_of(file, e);
        let found = self.without_number_literals_in_arguments(found);
        if self.is_assumption_free(asked) {
            self.aot.storage.produced.insert((file, e), found);
        }
        found
    }

    pub fn is_restricted_to_fixed_set(&self, file: FileId) -> bool {
        self.files().module(file).is_restricted_to_fixed_set()
    }

    pub(super) fn assumes_only_predictions(&self) -> Option<u32> {
        (self.aot.storage.in_flight.is_empty() && self.aot.kinds.is_stable())
            .then(|| self.stack_half_used_count())
    }

    pub(super) fn begin_query(&mut self) -> (Option<u32>, usize) {
        let is_settled = self.aot.javascript.is_idle() && self.aot.kinds.is_stable();
        (
            is_settled.then(|| self.stack_half_used_count()),
            std::mem::take(&mut self.aot.storage.outermost_assumed).0,
        )
    }

    pub(super) fn is_assumption_free(
        &mut self,
        (careful_before, further_out): (Option<u32>, usize),
    ) -> bool {
        let relied_on = self.aot.storage.outermost_assumed.0;
        self.aot.storage.outermost_assumed.0 = further_out.min(relied_on);
        relied_on == usize::MAX && self.is_result_cacheable(careful_before)
    }

    pub(in crate::check) fn index_may_be_missing(&self, within: Option<FileId>) -> bool {
        match within.or(self.aot.storage.accessed_within) {
            Some(file) => {
                self.check_options(file).no_unchecked_indexed_access
                    && !self.is_restricted_to_fixed_set(file)
            }
            None => self.p.files.options.no_unchecked_indexed_access,
        }
    }

    pub(super) fn is_result_cacheable(&self, asked: Option<u32>) -> bool {
        asked == Some(self.stack_half_used_count())
    }

    pub fn enable_expr_cache_for(&mut self, file: FileId) {
        let expressions = self.hir(file).exprs.len();
        self.aot
            .storage
            .produced
            .switch_to_file(file, expressions, TypeId::ANY);
        self.aot
            .storage
            .reads
            .switch_to_file(file, expressions, None);
        self.aot
            .symbols_named
            .switch_to_file(file, expressions, (Atom::NONE, None));
        self.aot.resolved_calls.switch_to_file(
            file,
            expressions,
            crate::check::call::ResolvedCall {
                sig: None,
                ret: TypeId::ANY,
            },
        );
        self.compute_parent_links(file);
        self.aot.javascript.enable_expr_cache_for(
            file,
            expressions,
            self.hir(file).pats.len(),
            self.bound(file).symbols.len(),
            self.hir(file).fns.len(),
        );
        self.aot.trust.enable_expr_cache_for(file, expressions);
    }

    pub fn clear_expr_cache(&mut self) {
        self.aot.storage.produced.clear();
        self.aot.storage.reads.clear();
        self.aot.resolved_calls.clear();
        self.aot.javascript.clear_expr_cache();
        self.aot.flows.literal_contextual_types.clear();
    }

    fn compute_result_type_of(&mut self, file: FileId, e: ExprId) -> TypeId {
        if self.is_half_of_stack_in_use() {
            return TypeId::ANY;
        }
        if let Some(produced) = self.files().result_operand(file, e) {
            return self.result_type_of(file, produced);
        }
        let (operator, left, right) = match self.hir(file)[e].kind {
            ExprKind::Unary { op: UnOp::Not, .. } => return TypeId::BOOLEAN,
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                left,
                right,
            }
            | ExprKind::Assign {
                op: Some(op @ (BinOp::And | BinOp::Or | BinOp::Nullish)),
                target: left,
                value: right,
            } => (Some(op), left, right),
            ExprKind::Cond { yes, no, .. } => (None, yes, no),
            ExprKind::Binary {
                op: BinOp::Comma,
                right: expr,
                ..
            }
            | ExprKind::Assign {
                op: None,
                value: expr,
                ..
            }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr) => {
                let produced = self.result_type_of(file, expr);
                return match self.type_beyond_flow_narrowing(file, expr) {
                    Some(held) => self.union(&[produced, held]),
                    None => produced,
                };
            }
            ExprKind::Binary { op, left, right }
            | ExprKind::Assign {
                op: Some(op),
                target: left,
                value: right,
            } if matches!(
                op,
                BinOp::Add
                    | BinOp::Sub
                    | BinOp::Mul
                    | BinOp::Div
                    | BinOp::Rem
                    | BinOp::Pow
                    | BinOp::Shl
                    | BinOp::Shr
                    | BinOp::UShr
                    | BinOp::BitAnd
                    | BinOp::BitOr
                    | BinOp::BitXor
            ) =>
            {
                return self.operator_result_type(file, e, &[left, right], op == BinOp::Add);
            }
            ExprKind::Unary {
                op:
                    UnOp::Minus
                    | UnOp::BitNot
                    | UnOp::PreInc
                    | UnOp::PreDec
                    | UnOp::PostInc
                    | UnOp::PostDec,
                operand,
            } => {
                return self.operator_result_type(file, e, &[operand], false);
            }
            ExprKind::This
                if self
                    .this_container_fn(file, e)
                    .is_some_and(|func| self.is_this_predicted(file, func)) =>
            {
                return TypeId::UNKNOWN;
            }
            ExprKind::Array(_) | ExprKind::New(_)
                if self.allocates_container_of_external_data(file, e) =>
            {
                let own = self.type_of_expr(file, e);
                return self.with_unknown_elements(own);
            }
            ExprKind::Index { obj, .. } if self.holds_unknown_elements(file, obj) => {
                return TypeId::UNKNOWN;
            }
            ExprKind::Call(_) if self.returns_external_data_by_type_argument(file, e) => {
                return TypeId::UNKNOWN;
            }
            ExprKind::Call(call) | ExprKind::New(call)
                if self.copies_container_of_unknown_elements(file, e, call) =>
            {
                let own = self.type_of_expr(file, e);
                return self.with_unknown_elements(own);
            }
            ExprKind::Call(call) if self.yields_elements_of_container(file, call) => {
                let own = self.type_of_expr(file, e);
                return if self.is_container(own) {
                    self.with_unknown_elements(own)
                } else {
                    TypeId::UNKNOWN
                };
            }
            ExprKind::Call(_) if self.has_declared_type(file, e) => {
                let own = self.type_of_expr(file, e);
                let own = match self.resolved_signature(file, e).sig {
                    Some(sig) => match self.sig_decl(sig) {
                        Some((of, func, _))
                            if self.return_type_of_fn(of, func) == self.sig_return(sig) =>
                        {
                            own
                        }
                        _ if self
                            .parts(own)
                            .iter()
                            .all(|part| part.is_null() || part.is_undefined()) =>
                        {
                            TypeId::UNKNOWN
                        }
                        _ => self.without_number_literals_deep(own),
                    },
                    None => own,
                };
                if let Some(sig) = self.resolved_signature(file, e).sig
                    && let Some((of, func, _)) = self.sig_decl(sig)
                    && self.hir(of)[func].ret.is_none()
                    && !self.hir(of)[func]
                        .flags
                        .intersects(Flags::ASYNC | Flags::GENERATOR)
                    && self.is_host_callback(of, func)
                {
                    return TypeId::UNKNOWN;
                }
                if let Some(sig) = self.resolved_signature(file, e).sig
                    && let Some((of, func, _)) = self.sig_decl(sig)
                    && !self.is_untyped_file(of)
                    && self.is_compiled(of)
                    && self.hir(of)[func].ret.is_none()
                    && let (compiled, _) = self.fn_result_type(of, func)
                    && compiled != self.return_type_of_fn(of, func)
                    && self.return_type_of_fn(of, func) == self.sig_return(sig)
                    && (!self.is_call_result_annotated(file, e) || self.is_uninformative(compiled))
                {
                    return self.union(&[own, compiled]);
                }
                return own;
            }
            _ if !self.is_untyped_file(file) && !self.has_declared_type(file, e) => {
                return TypeId::UNKNOWN;
            }
            ExprKind::Await(operand) => {
                let own = self.type_of_expr(file, e);
                let produced = self.result_type_of(file, operand);
                if produced == self.type_of_expr(file, operand) {
                    return own;
                }
                let promised = self.awaited(produced);
                return self.union(&[own, promised]);
            }
            ExprKind::As { expr, .. } => {
                let target = self.type_of_expr(file, e);
                if target.is_never() || self.is_external_data_cast_to_primitives(file, e) {
                    return TypeId::UNKNOWN;
                }
                let source = match self.double_cast_source(file, e) {
                    Some(source) => source,
                    None => self.propagated_type(file, expr),
                };
                if (self.has_tainted_part(target)
                    || self.is_external_data(file, expr)
                    || self.has_no_required_properties(target))
                    && (self.is_uninformative(source) || self.is_untyped(source))
                {
                    return TypeId::UNKNOWN;
                }
                return self.coerced_type(source, target);
            }
            ExprKind::Ident(name) => {
                let own = self.type_of_expr(file, e);
                let sym = self.resolved_symbol_for(file, e, name);
                let Some(sym) = sym.filter(|&sym| {
                    matches!(
                        self.variable_declaration(sym),
                        Some((_, Decl::Var(_) | Decl::Param(_)))
                    )
                }) else {
                    return own;
                };
                let declared = self.type_of_symbol(sym);
                if own == declared || self.is_base_constraint_too_narrow(declared) {
                    return self.stored_type(sym);
                }
                if self.is_array_or_tuple(own)
                    && self.is_array_or_tuple(declared)
                    && self.is_container_filled_with_external_data(file, sym, declared)
                {
                    return self.with_unknown_elements(own);
                }
                let (mut gone, mut met): (Vec<TypeId>, usize) = (Vec::new(), 0);
                for &part in self.parts(declared) {
                    if self.parts(own).get(met) == Some(&part) {
                        met += 1;
                    } else {
                        gone.push(part);
                    }
                }
                if met != self.parts(own).len() {
                    gone = self
                        .parts(declared)
                        .iter()
                        .copied()
                        .filter(|part| !self.parts(own).contains(part))
                        .collect();
                    if !self
                        .parts(own)
                        .iter()
                        .all(|part| self.parts(declared).contains(part))
                    {
                        return own;
                    }
                }
                let stored = self.stored_type(sym);
                if gone.is_empty() {
                    return stored;
                }
                if let Some(proved) = self.guard_proven_type(file, e, stored, own) {
                    return if self.parts(proved) == self.parts(own) {
                        own
                    } else {
                        proved
                    };
                }
                return if stored == declared {
                    own
                } else {
                    self.filter(stored, |_, part| !gone.contains(&part))
                };
            }
            ExprKind::NonNull(expr) => {
                let produced = self.result_type_of(file, expr);
                let without_nullish = if produced == self.type_of_expr(file, expr) {
                    self.type_of_expr(file, e)
                } else if self.is_uninformative(produced) {
                    produced
                } else {
                    self.non_nullable(produced)
                };
                return match self.type_beyond_flow_narrowing(file, e) {
                    Some(held) => self.union(&[without_nullish, held]),
                    None => without_nullish,
                };
            }
            ExprKind::Dot { obj, name, .. }
                if self.reads_container_with_unknown_elements(file, e, obj, name) =>
            {
                let own = self.type_of_expr(file, e);
                return self.with_unknown_elements(own);
            }
            ExprKind::Dot { obj, .. } if self.is_string_by_type_that_may_be_a_number(file, obj) => {
                let own = self.type_of_expr(file, e);
                return self.union(&[own, TypeId::UNDEFINED]);
            }
            ExprKind::Dot { .. } => {
                return match self.coerced_property_read(file, e) {
                    Some((found, target)) => self.coerced_type(found, target),
                    None => self.type_of_expr(file, e),
                };
            }
            _ => return self.type_of_expr(file, e),
        };
        let own = self.type_of_expr(file, e);
        let mut parts = vec![own];
        for operand in [left, right] {
            let produced = self.result_type_of(file, operand);
            let is_tested =
                operand == left && operator.is_some() && produced == self.type_of_expr(file, left);
            let mut rest_of_own = self.parts(own).iter();
            let is_own_part = self
                .parts(produced)
                .iter()
                .all(|part| rest_of_own.any(|other| other == part));
            if !is_tested && !is_own_part && !self.is_provably_assignable(produced, own) {
                parts.push(produced);
            }
            if let Some(held) = self.type_beyond_flow_narrowing(file, operand) {
                let is_stripped_of_nullish =
                    operand == left && matches!(operator, Some(BinOp::Or | BinOp::Nullish));
                parts.push(if is_stripped_of_nullish {
                    self.non_nullable(held)
                } else {
                    held
                });
            }
        }
        if operator == Some(BinOp::And) && !self.contains_undefined(own) {
            let (tested, may_be_undefined) = self.checked_type_of(file, left);
            if may_be_undefined
                || !self.every_type(tested, |c, part| {
                    c.is_number_like(part) || c.is_boolean_like(part)
                })
            {
                parts.push(TypeId::UNDEFINED);
            }
        }
        if parts.len() == 1 {
            own
        } else {
            self.union(&parts)
        }
    }

    fn has_own_result_type(&mut self, file: FileId, e: ExprId) -> bool {
        e.is_none() || self.result_type_of(file, e) == self.type_of_expr(file, e)
    }

    fn propagated_type(&mut self, file: FileId, e: ExprId) -> TypeId {
        if self.coerced_property_read(file, e).is_some() {
            return self.result_type_of(file, e);
        }
        let forwarded = match self.reference_read(file, e) {
            Some(read)
                if !read.is_narrowing_reliable
                    && read.declared != TypeId::UNRESOLVED
                    && self.unverified_claim(file, e).is_none() =>
            {
                read.declared
            }
            _ => self.result_type_of(file, e),
        };
        if self.may_return_uninitialized_variable(file, e) {
            self.union(&[forwarded, TypeId::UNDEFINED])
        } else {
            forwarded
        }
    }

    fn has_unboxed_part(&self, ty: TypeId) -> bool {
        self.parts(ty)
            .iter()
            .any(|&part| self.is_number_like(part) || self.is_boolean_like(part))
    }

    pub fn may_return_uninitialized_variable(&mut self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Ident(_) => self
                .reference_read(file, e)
                .is_some_and(|read| read.may_be_undefined && self.has_unboxed_part(read.declared)),
            ExprKind::Cond {
                yes: left,
                no: right,
                ..
            }
            | ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            }
            | ExprKind::Assign {
                op: Some(BinOp::And),
                target: left,
                value: right,
            } => {
                self.may_return_uninitialized_variable(file, left)
                    || self.may_return_uninitialized_variable(file, right)
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish | BinOp::Comma,
                right: expr,
                ..
            }
            | ExprKind::Assign {
                op: None | Some(BinOp::Or | BinOp::Nullish),
                value: expr,
                ..
            }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::As { expr, .. } => self.may_return_uninitialized_variable(file, expr),
            _ => false,
        }
    }

    fn has_propagated_type(&mut self, file: FileId, e: ExprId) -> bool {
        e.is_none() || self.propagated_type(file, e) == self.type_of_expr(file, e)
    }

    pub fn field_storage(&mut self, sym: Sym, extended: &[(FileId, ClassId)]) -> Storage {
        Storage {
            ty: self.type_of_symbol(sym),
            starts_undefined: self.field_starts_undefined(sym, extended),
        }
    }

    pub fn param_storage(&mut self, file: FileId, p: ParamId) -> Storage {
        let param = &self.hir(file)[p];
        let ty = if self.is_param_predicted(file, p) {
            TypeId::UNKNOWN
        } else {
            self.type_of_param(file, p)
        };
        let ty = if param.ty.is_none() {
            self.without_number_literals(ty)
        } else {
            ty
        };
        Storage {
            ty,
            starts_undefined: param.default.is_some() || param.flags.contains(Flags::OPTIONAL),
        }
    }

    pub fn is_host_callback(&mut self, file: FileId, func: FnId) -> bool {
        if let Some(&known) = self.aot.storage.host_callbacks.get(&(file, func)) {
            return known;
        }
        if let Some(assumed) = self.assumption(Query::HostCallback(file, func)) {
            return assumed != 0;
        }
        let (found, is_final) = self.solve(Query::HostCallback(file, func), 1, 1, |c| {
            u64::from(c.compute_is_host_callback(file, func))
        });
        if is_final {
            self.aot
                .storage
                .host_callbacks
                .insert((file, func), found != 0);
        }
        found != 0
    }

    fn is_library_only_key(&mut self, file: FileId, literal: ExprId, key: PropKey) -> bool {
        let Some(name) = self.declared_member_name(file, key) else {
            return false;
        };
        self.prepare_enclosing(file, literal);
        let Some(expected) =
            self.apparent_type_of_contextual_type(file, literal, ContextFlags::SIGNATURE)
        else {
            return false;
        };
        let mut is_found = false;
        for &part in self.parts(expected) {
            let Some(members) = self.members(part) else {
                continue;
            };
            if members.resolved.prop(name).is_some() {
                return false;
            }
            is_found |= self.property_in_type(part, &members, name).is_some();
        }
        is_found
    }

    fn compute_is_host_callback(&mut self, file: FileId, func: FnId) -> bool {
        let FnOwner::Expr(e) = self.bound(file).fns[func.idx()].owner else {
            return false;
        };
        !self.is_untyped_file(file) && self.is_passed_to_host(file, e)
    }

    fn function_name_symbol(&self, file: FileId, func: FnId) -> SymbolId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => bound.symbol_of_declaration(Decl::Fn(func)),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                    bound.pat_symbol[hir[d].pat.idx()]
                }
                _ => SymbolId::NONE,
            },
            _ => SymbolId::NONE,
        }
    }

    fn is_passed_to_host_by_name(&mut self, file: FileId, func: FnId) -> bool {
        let symbol = self.function_name_symbol(file, func);
        !self.is_untyped_file(file)
            && self
                .symbol_mentions(file, symbol)
                .into_iter()
                .any(|mention| self.is_passed_to_host(file, mention))
    }

    pub fn is_host_bound(&mut self, file: FileId, e: ExprId) -> bool {
        !self.is_untyped_file(file)
            && !self.is_function_result(file, e)
            && self.is_passed_to_host(file, e)
    }

    fn is_function_result(&self, file: FileId, mut e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            e = match bound.expr_parent[e.idx()] {
                Parent::Prop(prop) => bound.prop_owner[prop.idx()],
                Parent::FnBody(_) => return true,
                Parent::Stmt(stmt) => {
                    return stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Return(_));
                }
                Parent::Expr(parent)
                    if parent.is_some()
                        && !matches!(
                            hir[parent].kind,
                            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::Assign { .. }
                        ) =>
                {
                    parent
                }
                _ => return false,
            };
            if e.is_none() {
                return false;
            }
        }
    }

    fn is_passed_to_host(&mut self, file: FileId, mut e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let parent = match bound.expr_parent[e.idx()] {
                Parent::Prop(prop) if hir[prop].kind != PropKind::Spread => {
                    let owner = bound.prop_owner[prop.idx()];
                    if owner.is_none() {
                        return false;
                    }
                    match (hir[owner].kind, hir[prop].key) {
                        (ExprKind::Object(_), key)
                            if self.is_library_only_key(file, owner, key) =>
                        {
                            return true;
                        }
                        (ExprKind::Object(_), _) => {}
                        (ExprKind::Jsx(_), PropKey::Name(name)) => {
                            return self.is_jsx_prop_for_host(file, owner, Some(name));
                        }
                        _ => return false,
                    }
                    e = owner;
                    continue;
                }
                Parent::FnBody(outer) => {
                    return hir[outer].ret.is_none() && self.is_host_callback(file, outer);
                }
                Parent::Stmt(stmt)
                    if stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Return(_)) =>
                {
                    return matches!(self.enclosing_site(file, Parent::Stmt(stmt)), Some(Site::Body(outer)) if hir[outer].ret.is_none() && self.is_host_callback(file, outer));
                }
                Parent::Expr(parent) if parent.is_some() => parent,
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Call(call) | ExprKind::New(call) => {
                    let callee = hir[call].callee;
                    if callee == e || matches!(hir[callee].kind, ExprKind::Super) {
                        return false;
                    }
                    return self.is_predicted(file, callee);
                }
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if value == e => return self.is_predicted(file, target),
                ExprKind::Jsx(jsx) if hir[jsx].tag == e => return true,
                ExprKind::Jsx(_) => return self.is_jsx_prop_for_host(file, parent, None),
                ExprKind::Array(_) => {}
                ExprKind::Cond { test, .. } if test != e => {}
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    right,
                    ..
                } if right == e => {}
                _ => return false,
            }
            e = parent;
        }
    }

    fn is_jsx_prop_for_host(&mut self, file: FileId, element: ExprId, name: Option<Atom>) -> bool {
        let hir = self.hir(file);
        let ExprKind::Jsx(jsx) = hir[element].kind else {
            return false;
        };
        let tag = hir[jsx].tag;
        if tag.is_none() {
            return false;
        }
        let is_intrinsic = match hir[tag].kind {
            ExprKind::Ident(tag) => crate::hir::is_intrinsic_jsx_name(self.atoms().bytes(tag)),
            ExprKind::String(_) => true,
            _ => false,
        };
        if is_intrinsic || self.is_predicted(file, tag) {
            return true;
        }
        let (Some(name), Some(sig)) = (name, self.resolved_signature(file, element).sig) else {
            return false;
        };
        let Some(props) = self.sig_params(sig).first().map(|props| props.ty) else {
            return false;
        };
        let apparent = self.apparent_type(props);
        self.property_type(props, apparent, name, shape::Access::Read)
            .is_none()
    }

    fn is_param_predicted(&mut self, file: FileId, p: ParamId) -> bool {
        self.is_param_predicted_from(file, p, true)
    }

    fn is_param_predicted_from(
        &mut self,
        file: FileId,
        p: ParamId,
        follows_arguments: bool,
    ) -> bool {
        let func = self.bound(file).param_fn[p.idx()];
        if self.is_in_untyped_clone_span(file, self.hir(file)[self.hir(file)[p].pat].pos) {
            return true;
        }
        if self.hir(file)[p].ty.is_some() {
            return func.is_some()
                && (self.is_param_stricter_than_inherited(file, func, p)
                    || self.is_param_supplied_by_host(file, func, p)
                    || self.is_jsx_factory(file, func));
        }
        if func.is_some() && self.is_callback_param_checked_at_entry(file, func, p) {
            return false;
        }
        let default = self.hir(file)[p].default;
        func.is_some()
            && (self.is_host_callback(file, func)
                || self.is_typed_by_declaration_file(file, func)
                || self.receives_unknown_elements(file, func)
                || self.is_typed_only_by_pattern(file, func, p))
            || default.is_some()
                && if follows_arguments && self.is_typed_by_primitive_default(file, p) {
                    self.carries_external_data(DataFlowNode::Parameter(file, p))
                } else {
                    self.is_derived_from_prediction(file, default, 0)
                }
    }

    fn is_callback_param_checked_at_entry(&mut self, file: FileId, func: FnId, p: ParamId) -> bool {
        let hir = self.hir(file);
        if hir[p].ty.is_some()
            || hir[p].default.is_some()
            || !matches!(hir[hir[p].pat].kind, PatKind::Ident(_))
            || !hir[func].params.range().contains(&p.idx())
        {
            return false;
        }
        let index = p.idx() - hir[func].params.start as usize;
        let Some(expected) = self.contextual_param_type(file, func, index) else {
            return false;
        };
        let TypeData::Ref { target, .. } = *self.data(expected) else {
            return false;
        };
        self.is_sql_row_type(target)
            && self.could_have_untyped_clone(file, func, false)
            && self.is_host_callback(file, func)
    }

    pub fn literal_type_expected_of_callback(
        &mut self,
        file: FileId,
        literal: ExprId,
    ) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.expr_parent[literal.idx()] {
            Parent::Prop(prop) if hir[prop].kind == PropKind::Init => {
                let PropKey::Name(name) = hir[prop].key else {
                    return None;
                };
                let owner = bound.prop_owner[prop.idx()];
                if owner.is_none() || !matches!(hir[owner].kind, ExprKind::Object(_)) {
                    return None;
                }
                let expected = self.literal_type_expected_of_callback(file, owner)?;
                let apparent = self.apparent_type(expected);
                self.property_type(expected, apparent, name, shape::Access::Read)
                    .map(|found| found.0)
            }
            Parent::FnBody(func) => self.result_type_expected_of_callback(file, func),
            Parent::Stmt(stmt)
                if stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Return(_)) =>
            {
                let func = self.enclosing_fn(file, Parent::Stmt(stmt))?;
                self.result_type_expected_of_callback(file, func)
            }
            _ => None,
        }
    }

    fn result_type_expected_of_callback(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir[func].ret.is_some() || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return None;
        }
        let FnOwner::Expr(callback) = bound.fns[func.idx()].owner else {
            return None;
        };
        let Parent::Expr(call) = bound.expr_parent[callback.idx()] else {
            return None;
        };
        let ExprKind::Call(arguments) = hir[call].kind else {
            return None;
        };
        let index = hir
            .ids(hir[arguments].args)
            .position(|argument| argument == callback)?;
        let resolved = self.resolved_signature(file, call).sig?;
        let (declared_in, declaration, _) = self.sig_decl(resolved)?;
        let declared = self.sig_of_fn(declared_in, declaration);
        let type_params = self.sig_type_params(declared);
        let params = self.sig_params(declared);
        let callback_type = self.param_type_at(&params, index)?;
        let callback_signature = self.single_call_signature(callback_type)?;
        let result = self.sig_return(callback_signature);
        let position = type_params.iter().position(|&param| param == result)?;
        self.prepare_enclosing(file, call);
        let expected = self.contextual_type(file, call, ContextFlags::SKIP_BINDING_PATTERNS)?;
        let mut inference = Inference::for_params(&type_params, Some(declared));
        let returned = self.sig_return(declared);
        self.infer(&mut inference, expected, returned, 0);
        if inference.candidates[position].covariant.is_empty() {
            return None;
        }
        let mapper = self.fixing_mapper(&mut inference, result);
        Some(self.instantiate(result, mapper))
    }

    fn is_sql_row_type(&mut self, row: Sym) -> bool {
        let program = self.p;
        let row = self.files().canonical(row);
        program
            .aot
            .storage
            .sql_row_types
            .get_or_init(|| self.find_sql_row_types())
            .contains(&row)
    }

    fn find_sql_row_types(&mut self) -> FxHashSet<Sym> {
        let mut rows = FxHashSet::default();
        for file in (0..self.files().modules.len() as u32).map(FileId) {
            if !self.is_compiled(file) || self.is_untyped_file(file) {
                continue;
            }
            for &query in self.file_exprs_by_kind(file).of(ExprTag::TaggedTemplate) {
                let Some(row) = self.sql_query_row_type(file, query) else {
                    continue;
                };
                if let TypeData::Ref { target, .. } = *self.data(row) {
                    rows.insert(self.files().canonical(target));
                }
            }
        }
        rows
    }

    pub(super) fn is_derived_from_prediction(
        &mut self,
        file: FileId,
        e: ExprId,
        _depth: u32,
    ) -> bool {
        self.carries_external_data(DataFlowNode::Expression(file, e))
    }

    pub(super) fn function_returns_external_data(&mut self, file: FileId, func: FnId) -> bool {
        self.carries_external_data(DataFlowNode::Function(file, func))
    }

    fn carries_external_data(&mut self, start: DataFlowNode) -> bool {
        if let Some(&known) = self.aot.storage.external_data_flow.get(&start) {
            return known;
        }
        if self.aot.storage.data_flow_in_progress.contains(&start) {
            self.aot.storage.data_flow_cuts += 1;
            return false;
        }
        self.aot.storage.data_flow_in_progress.push(start);
        let cuts = self.aot.storage.data_flow_cuts;
        let further_out = std::mem::take(&mut self.aot.storage.outermost_assumed).0;
        let mut search = DataFlowSearch::default();
        search.position_of(start);
        while let Some(at) = search.pending.pop() {
            if search.carries[at] {
                continue;
            }
            search.evaluated = at;
            let values = self.values_flowing_into(search.nodes[at]);
            if values
                .into_iter()
                .any(|(file, value)| self.flows_external_data(file, value, 0, &mut search))
            {
                search.carries[at] = true;
                let dependents = std::mem::take(&mut search.dependents[at]);
                search.pending.extend(dependents);
            }
        }
        let relied_on = self.aot.storage.outermost_assumed.0;
        self.aot.storage.outermost_assumed.0 = further_out.min(relied_on);
        self.aot.storage.data_flow_in_progress.pop();
        let found = search.carries[0];
        if relied_on == usize::MAX && cuts == self.aot.storage.data_flow_cuts {
            for (node, carries) in search.nodes.into_iter().zip(search.carries) {
                if !matches!(node, DataFlowNode::Expression(..)) {
                    self.aot.storage.external_data_flow.insert(node, carries);
                }
            }
        }
        found
    }

    fn values_flowing_into(&mut self, node: DataFlowNode) -> Vec<(FileId, ExprId)> {
        match node {
            DataFlowNode::Expression(file, e) => vec![(file, e)],
            DataFlowNode::Parameter(file, p) => {
                let func = self.bound(file).param_fn[p.idx()];
                if func.is_none() {
                    return Vec::new();
                }
                let position = p.idx() - self.hir(file)[func].params.start as usize;
                let mut values = vec![(file, self.hir(file)[p].default)];
                for (of, e) in self.calls_of_function(file, func) {
                    let hir = self.hir(of);
                    let (ExprKind::Call(call) | ExprKind::New(call)) = hir[e].kind else {
                        continue;
                    };
                    let arguments: Vec<ExprId> =
                        hir.ids(hir[call].args).take(position + 1).collect();
                    if arguments
                        .iter()
                        .any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
                    {
                        values.extend(arguments.into_iter().map(
                            |argument| match hir[argument].kind {
                                ExprKind::Spread(operand) => (of, operand),
                                _ => (of, argument),
                            },
                        ));
                    } else if let Some(&argument) = arguments.get(position) {
                        values.push((of, argument));
                    }
                }
                values
            }
            DataFlowNode::Variable(sym) => {
                let Some((file, _)) = self.files().value_declaration(sym) else {
                    return Vec::new();
                };
                self.bound(file)
                    .assignments_to(sym.id)
                    .iter()
                    .map(|assignment| assignment.1)
                    .filter_map(|target| match self.target_store(file, target) {
                        Some(
                            super::integers::Store::Value(stored)
                            | super::integers::Store::Computed(stored),
                        ) => Some((file, stored)),
                        _ => None,
                    })
                    .collect()
            }
            DataFlowNode::Function(file, func) => {
                let (hir, bound) = (self.hir(file), self.bound(file));
                if hir[func].flags.contains(Flags::GENERATOR) {
                    return bound
                        .ids(bound.fns[func.idx()].yields)
                        .filter_map(|e| match hir[e].kind {
                            ExprKind::Yield { value, star: false } if value.is_some() => {
                                Some((file, value))
                            }
                            _ => None,
                        })
                        .collect();
                }
                match hir[func].body {
                    FnBody::Expr(value) => vec![(file, value)],
                    _ => bound
                        .ids(bound.fns[func.idx()].returns)
                        .filter_map(|stmt| match hir[stmt].kind {
                            StmtKind::Return(value) if value.is_some() => Some((file, value)),
                            _ => None,
                        })
                        .collect(),
                }
            }
        }
    }

    fn node_carries_external_data(
        &mut self,
        node: DataFlowNode,
        search: &mut DataFlowSearch,
    ) -> bool {
        if let Some(&known) = self.aot.storage.external_data_flow.get(&node) {
            return known;
        }
        let at = search.position_of(node);
        if !search.carries[at] && search.dependents[at].last() != Some(&search.evaluated) {
            search.dependents[at].push(search.evaluated);
        }
        search.carries[at]
    }

    fn data_flow_leaf(
        &mut self,
        file: FileId,
        e: ExprId,
        search: &mut DataFlowSearch,
        find: impl FnOnce(&mut Self) -> bool,
    ) -> bool {
        if let Some(&known) = search.leaves.get(&(file, e)) {
            return known;
        }
        let found = find(self);
        search.leaves.insert((file, e), found);
        found
    }

    fn flows_external_data(
        &mut self,
        file: FileId,
        e: ExprId,
        depth: u32,
        search: &mut DataFlowSearch,
    ) -> bool {
        if depth > 12 {
            return false;
        }
        match self.hir(file)[e].kind {
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.flows_external_data(file, right, depth + 1, search),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => {
                self.flows_external_data(file, left, depth + 1, search)
                    || self.flows_external_data(file, right, depth + 1, search)
            }
            ExprKind::Binary {
                op:
                    op @ (BinOp::Add
                    | BinOp::Sub
                    | BinOp::Mul
                    | BinOp::Div
                    | BinOp::Rem
                    | BinOp::Pow
                    | BinOp::Shl
                    | BinOp::Shr
                    | BinOp::BitAnd
                    | BinOp::BitOr
                    | BinOp::BitXor),
                left,
                right,
            }
            | ExprKind::Assign {
                op:
                    Some(
                        op @ (BinOp::Add
                        | BinOp::Sub
                        | BinOp::Mul
                        | BinOp::Div
                        | BinOp::Rem
                        | BinOp::Pow
                        | BinOp::Shl
                        | BinOp::Shr
                        | BinOp::BitAnd
                        | BinOp::BitOr
                        | BinOp::BitXor),
                    ),
                target: left,
                value: right,
            } => {
                let is_predicted = [left, right]
                    .map(|operand| self.flows_external_data(file, operand, depth + 1, search));
                is_predicted.contains(&true)
                    && ![left, right].into_iter().zip(is_predicted).any(
                        |(operand, is_predicted)| {
                            let declared = self.type_of_expr(file, operand);
                            !is_predicted
                                && if op == BinOp::Add {
                                    !self.is_uninformative(declared)
                                        && self
                                            .every_type(declared, |c, part| c.is_string_like(part))
                                } else {
                                    self.is_primitive_by_type(file, operand)
                                        && !self
                                            .some_type(declared, |c, part| c.is_bigint_like(part))
                                }
                        },
                    )
            }
            ExprKind::Assign { value, .. } => {
                self.flows_external_data(file, value, depth + 1, search)
            }
            ExprKind::Cond { yes, no, .. } => {
                self.flows_external_data(file, yes, depth + 1, search)
                    || self.flows_external_data(file, no, depth + 1, search)
            }
            ExprKind::Unary {
                op: UnOp::Minus | UnOp::BitNot,
                operand,
            } => self.flows_external_data(file, operand, depth + 1, search),
            ExprKind::NonNull(expr) | ExprKind::Satisfies { expr, .. } => {
                self.flows_external_data(file, expr, depth + 1, search)
            }
            ExprKind::Ident(name) => {
                if !self.refers_to_typed_binding(file, e) {
                    return false;
                }
                if let Some((of, p)) = self.parameter_typed_by_default(file, e, name) {
                    return self.node_carries_external_data(DataFlowNode::Parameter(of, p), search)
                        || self.data_flow_leaf(file, e, search, |c| {
                            c.is_param_predicted_from(of, p, false)
                        });
                }
                match self.reassigned_inferred_variable(file, e, name) {
                    Some(sym) => {
                        self.node_carries_external_data(DataFlowNode::Variable(sym), search)
                            || self.data_flow_leaf(file, e, search, |c| {
                                c.is_predicted_apart_from_assignments(sym)
                            })
                    }
                    None => self.data_flow_leaf(file, e, search, |c| c.is_predicted(file, e)),
                }
            }
            ExprKind::Array(_) => {
                self.allocated_container_elements(file, e)
                    .into_iter()
                    .any(|element| self.flows_external_data(file, element, depth + 1, search))
                    || self.data_flow_leaf(file, e, search, |c| {
                        c.spreads_container_of_unknown_elements(file, e)
                    })
            }
            ExprKind::New(_)
                if self
                    .allocated_container_elements(file, e)
                    .into_iter()
                    .any(|element| self.flows_external_data(file, element, depth + 1, search)) =>
            {
                true
            }
            ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Call(_)
            | ExprKind::TaggedTemplate(_)
            | ExprKind::New(_)
            | ExprKind::Await(_) => {
                if let Some(root) = self.chain_root_identifier(file, e) {
                    if !self.refers_to_typed_binding(file, root)
                        && self.is_primitive_by_type(file, root)
                    {
                        return false;
                    }
                    if self.flows_external_data(file, root, depth + 1, search) {
                        return true;
                    }
                }
                if self.unverified_claim(file, e).is_some()
                    || self.data_flow_leaf(file, e, search, |c| c.reads_unknown_element(file, e))
                {
                    return true;
                }
                match self.called_function_with_inferred_result(file, e) {
                    Some((of, func)) => {
                        self.node_carries_external_data(DataFlowNode::Function(of, func), search)
                    }
                    None if self.has_primitive_result_by_type_argument(file, e) => {
                        self.value_arguments(file, e).into_iter().any(|argument| {
                            self.flows_external_data(file, argument, depth + 1, search)
                        })
                    }
                    None => false,
                }
            }
            _ => false,
        }
    }

    fn spreads_container_of_unknown_elements(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Array(elements) = hir[e].kind else {
            return false;
        };
        hir.ids(elements)
            .filter_map(|element| match hir[element].kind {
                ExprKind::Spread(operand) => Some(operand),
                _ => None,
            })
            .any(|operand| {
                self.holds_unknown_elements(file, operand) || self.is_predicted(file, operand)
            })
    }

    fn allocated_container_elements(&mut self, file: FileId, e: ExprId) -> Vec<ExprId> {
        let hir = self.hir(file);
        let elements: Vec<ExprId> = match hir[e].kind {
            ExprKind::Array(elements) => hir.ids(elements).collect(),
            ExprKind::New(call)
                if [&b"Map"[..], b"Set", b"WeakMap", b"Array"]
                    .into_iter()
                    .any(|name| self.refers_to_global_object(file, hir[call].callee, name)) =>
            {
                hir.ids(hir[call].args).collect()
            }
            _ => return Vec::new(),
        };
        elements
            .into_iter()
            .map(|element| match hir[element].kind {
                ExprKind::Spread(operand) => operand,
                _ => element,
            })
            .collect()
    }

    fn parameter_typed_by_default(
        &mut self,
        file: FileId,
        e: ExprId,
        name: Atom,
    ) -> Option<(FileId, ParamId)> {
        let sym = self.resolved_symbol_for(file, e, name)?;
        let Some((of, Decl::Param(pat))) = self.files().value_declaration(sym) else {
            return None;
        };
        let PatParent::Param(p) = root_declaration(self.bound(of), pat) else {
            return None;
        };
        (self.hir(of)[p].pat == pat && self.is_typed_by_primitive_default(of, p)).then_some((of, p))
    }

    fn is_typed_by_primitive_default(&mut self, file: FileId, p: ParamId) -> bool {
        if self.hir(file)[p].ty.is_some() || self.hir(file)[p].default.is_none() {
            return false;
        }
        let inferred = self.type_of_param(file, p);
        !self.is_uninformative(inferred)
            && self.every_type(inferred, |c, part| {
                c.is_primitive(part) || c.is_nullish(part)
            })
    }

    pub(super) fn parameter_receives_external_data(&mut self, file: FileId, p: ParamId) -> bool {
        self.is_typed_by_primitive_default(file, p)
            && self.carries_external_data(DataFlowNode::Parameter(file, p))
    }

    fn callable_name(&self, file: FileId, func: FnId) -> Option<Atom> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let name = match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => hir[func].name,
            FnOwner::Member(member) if hir[member].kind == MemberKind::Constructor => {
                match bound.member_owner[member.idx()] {
                    MemberOwner::Class(class) => hir[class].name,
                    _ => return None,
                }
            }
            FnOwner::Member(member) => match hir[member].key {
                PropKey::Name(name) => name,
                _ => return None,
            },
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::VarInit(d) => match hir[hir[d].pat].kind {
                    PatKind::Ident(name) => name,
                    _ => return None,
                },
                Parent::Prop(prop) => match hir[prop].key {
                    PropKey::Name(name) => name,
                    _ => return None,
                },
                _ => return None,
            },
            _ => return None,
        };
        (!name.is_none()).then_some(name)
    }

    fn find_calls_by_default_parameter_function(&self) -> FxHashMap<Atom, Vec<(FileId, ExprId)>> {
        let files: Vec<FileId> = (0..self.files().modules.len() as u32)
            .map(FileId)
            .filter(|&file| {
                self.is_compiled(file)
                    && !self.is_untyped_file(file)
                    && !self.bound(file).ran_out_of_stack
            })
            .collect();
        let mut found: FxHashMap<Atom, Vec<(FileId, ExprId)>> = FxHashMap::default();
        for &file in &files {
            let (hir, bound) = (self.hir(file), self.bound(file));
            for p in (0..hir.params.len() as u32).map(ParamId) {
                let func = bound.param_fn[p.idx()];
                if hir[p].ty.is_none()
                    && hir[p].default.is_some()
                    && func.is_some()
                    && let Some(name) = self.callable_name(file, func)
                {
                    found.entry(name).or_default();
                }
            }
        }
        for &file in &files {
            let hir = self.hir(file);
            let index = self.file_exprs_by_kind(file);
            for &e in index.of(ExprTag::Call).iter().chain(index.of(ExprTag::New)) {
                let (ExprKind::Call(call) | ExprKind::New(call)) = hir[e].kind else {
                    continue;
                };
                let (ExprKind::Ident(name) | ExprKind::Dot { name, .. }) =
                    hir[hir[call].callee].kind
                else {
                    continue;
                };
                if let Some(calls) = found.get_mut(&name) {
                    calls.push((file, e));
                }
            }
        }
        found
    }

    fn calls_of_function(&mut self, file: FileId, func: FnId) -> Vec<(FileId, ExprId)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if let FnOwner::Expr(e) = bound.fns[func.idx()].owner
            && let Parent::Expr(parent) = bound.expr_parent[e.idx()]
            && parent.is_some()
            && let ExprKind::Call(call) = hir[parent].kind
            && hir[call].callee == e
        {
            return vec![(file, parent)];
        }
        let Some(name) = self.callable_name(file, func) else {
            return Vec::new();
        };
        let program = self.p;
        let Some(calls) = program
            .aot
            .storage
            .calls_by_default_parameter_function
            .get_or_init(|| self.find_calls_by_default_parameter_function())
            .get(&name)
        else {
            return Vec::new();
        };
        calls
            .iter()
            .copied()
            .filter(|&(of, e)| {
                self.resolved_signature(of, e)
                    .sig
                    .and_then(|sig| self.sig_decl(sig))
                    .is_some_and(|(declared_in, declared, _)| {
                        (declared_in, declared) == (file, func)
                    })
            })
            .collect()
    }

    fn reassigned_inferred_variable(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        let sym = self.resolved_symbol_for(file, e, name)?;
        let Some((of, Decl::Var(pat))) = self.files().value_declaration(sym) else {
            return None;
        };
        let hir = self.hir(of);
        let PatParent::Var(d) = root_declaration(self.bound(of), pat) else {
            return None;
        };
        (hir[d].ty.is_none()
            && hir[d].pat == pat
            && hir[d].init.is_some()
            && matches!(hir[d].kind, VarKind::Let | VarKind::Var))
        .then_some(sym)
    }

    fn is_predicted_apart_from_assignments(&mut self, sym: Sym) -> bool {
        let declared = self.type_of_symbol(sym);
        let stored = self.compute_stored_type_from(sym, declared, false);
        self.is_uninformative(stored) && !self.is_uninformative(declared)
    }

    fn called_function_with_inferred_result(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<(FileId, FnId)> {
        let (call, is_awaited) = match self.hir(file)[e].kind {
            ExprKind::Call(_) => (e, false),
            ExprKind::Await(operand)
                if matches!(self.hir(file)[operand].kind, ExprKind::Call(_)) =>
            {
                (operand, true)
            }
            _ => return None,
        };
        let sig = self.resolved_signature(file, call).sig?;
        let (of, func, _) = self.sig_decl(sig)?;
        let flags = self.hir(of)[func].flags;
        let is_followed = !self.is_untyped_file(of)
            && self.is_compiled(of)
            && self.hir(of)[func].ret.is_none()
            && !flags.contains(Flags::GENERATOR)
            && flags.contains(Flags::ASYNC) == is_awaited
            && self.return_type_of_fn(of, func) == self.sig_return(sig);
        is_followed.then_some((of, func))
    }

    fn refers_to_typed_binding(&mut self, file: FileId, e: ExprId) -> bool {
        let ExprKind::Ident(name) = self.hir(file)[e].kind else {
            return false;
        };
        self.resolved_symbol_for(file, e, name).is_some_and(|sym| {
            let written = self.type_of_symbol(sym);
            !self.is_uninformative(written)
        })
    }

    pub(super) fn is_external_element(&mut self, file: FileId, element: ExprId) -> bool {
        match self.hir(file)[element].kind {
            ExprKind::Spread(operand) => {
                self.is_derived_from_prediction(file, operand, 0)
                    || self.holds_unknown_elements(file, operand)
                    || self.is_predicted(file, operand)
            }
            _ => {
                self.is_derived_from_prediction(file, element, 0)
                    || self.holds_unknown_elements(file, element)
                    || self.is_string_by_type_that_may_be_a_number(file, element)
            }
        }
    }

    fn reads_container_with_unknown_elements(
        &mut self,
        file: FileId,
        e: ExprId,
        obj: ExprId,
        name: Atom,
    ) -> bool {
        let own = self.type_of_expr(file, e);
        if !self.is_container(own) {
            return false;
        }
        let object = self.type_of_expr(file, obj);
        let object = self.non_nullable(object);
        let object = self.apparent_type(object);
        let parts: Vec<TypeId> = self.parts(object).to_vec();
        parts
            .into_iter()
            .any(|part| self.property_holds_unknown_elements(part, name))
    }

    pub(super) fn is_container(&mut self, ty: TypeId) -> bool {
        !self.is_uninformative(ty)
            && self.every_type(ty, |c, part| {
                c.is_array_or_tuple(part)
                    || c.is_global_instance(part, &[b"Map", b"Set", b"WeakMap"])
            })
    }

    fn with_unknown_elements(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, part| {
            if c.is_array_or_tuple(part) {
                c.array_of(TypeId::UNKNOWN)
            } else if c.is_global_instance(part, &[b"Map", b"Set", b"WeakMap"])
                && matches!(c.data(part), TypeData::Ref { .. })
            {
                let arguments = vec![TypeId::UNKNOWN; c.type_arguments(part).len()];
                c.create_type_reference(part, &arguments)
            } else {
                part
            }
        })
    }

    fn receives_unknown_elements(&mut self, file: FileId, func: FnId) -> bool {
        let FnOwner::Expr(e) = self.bound(file).fns[func.idx()].owner else {
            return false;
        };
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else {
            return false;
        };
        if parent.is_none() {
            return false;
        }
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[parent].kind else {
            return false;
        };
        if self.calls_generic_function(file, parent)
            && self
                .value_arguments(file, parent)
                .into_iter()
                .any(|argument| self.is_external_element(file, argument))
        {
            return true;
        }
        let ExprKind::Dot { obj, .. } = hir[hir[call].callee].kind else {
            return false;
        };
        self.holds_unknown_elements(file, obj)
            || self.passes_container_of_unknown_elements(file, call)
            || self.calls_coroutine_with_external_data(file, obj, Flags::ASYNC)
    }

    fn calls_generic_function(&mut self, file: FileId, e: ExprId) -> bool {
        let Some((of, func, _)) = self
            .resolved_signature(file, e)
            .sig
            .and_then(|sig| self.sig_decl(sig))
        else {
            return false;
        };
        !self.hir(of)[func].type_params.is_empty()
            && self.is_compiled(of)
            && !self.is_untyped_file(of)
    }

    fn has_primitive_result_by_type_argument(&mut self, file: FileId, e: ExprId) -> bool {
        if !matches!(self.hir(file)[e].kind, ExprKind::Call(_))
            || !self.calls_generic_function(file, e)
        {
            return false;
        }
        let own = self.type_of_expr(file, e);
        if self.is_uninformative(own)
            || !self.every_type(own, |c, part| c.is_primitive(part) || c.is_nullish(part))
        {
            return false;
        }
        let Some(sig) = self.resolved_signature(file, e).sig else {
            return false;
        };
        self.sig_decl(sig)
            .is_some_and(|(of, func, _)| self.return_type_of_fn(of, func) != self.sig_return(sig))
    }

    fn value_arguments(&self, file: FileId, e: ExprId) -> Vec<ExprId> {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return Vec::new();
        };
        hir.ids(hir[call].args)
            .map(|argument| match hir[argument].kind {
                ExprKind::Spread(operand) => operand,
                _ => argument,
            })
            .filter(|&argument| !matches!(hir[argument].kind, ExprKind::Fn(_)))
            .collect()
    }

    fn returns_external_data_by_type_argument(&mut self, file: FileId, e: ExprId) -> bool {
        self.has_primitive_result_by_type_argument(file, e)
            && self
                .value_arguments(file, e)
                .into_iter()
                .any(|argument| self.is_external_element(file, argument))
    }

    fn passes_container_of_unknown_elements(&mut self, file: FileId, call: CallId) -> bool {
        let hir = self.hir(file);
        hir.ids(hir[call].args)
            .map(|argument| match hir[argument].kind {
                ExprKind::Spread(operand) => operand,
                _ => argument,
            })
            .any(|argument| self.holds_unknown_elements(file, argument))
    }

    fn copies_container_of_unknown_elements(
        &mut self,
        file: FileId,
        e: ExprId,
        call: CallId,
    ) -> bool {
        let own = self.type_of_expr(file, e);
        self.is_container(own)
            && self.is_typed_by_library_signature(file, e)
            && self.passes_container_of_unknown_elements(file, call)
    }

    fn is_typed_by_library_signature(&mut self, file: FileId, e: ExprId) -> bool {
        let Some(sig) = self.resolved_signature(file, e).sig else {
            return false;
        };
        self.sig_decl(sig)
            .is_none_or(|(of, _, _)| self.files().module(of).is_lib)
    }

    fn calls_coroutine_with_external_data(&mut self, file: FileId, e: ExprId, kind: Flags) -> bool {
        if !matches!(self.hir(file)[e].kind, ExprKind::Call(_)) {
            return false;
        }
        let Some((of, func, _)) = self
            .resolved_signature(file, e)
            .sig
            .and_then(|sig| self.sig_decl(sig))
        else {
            return false;
        };
        let declared = &self.hir(of)[func];
        (declared.flags & (Flags::GENERATOR | Flags::ASYNC)) == kind
            && declared.ret.is_none()
            && self.is_compiled(of)
            && !self.is_untyped_file(of)
            && self.carries_external_data(DataFlowNode::Function(of, func))
    }

    pub fn holds_unknown_elements(&mut self, file: FileId, e: ExprId) -> bool {
        if e.is_none() {
            return false;
        }
        if self.calls_coroutine_with_external_data(file, e, Flags::GENERATOR) {
            return true;
        }
        let own = self.type_of_expr(file, e);
        if !self.is_container(own) {
            return false;
        }
        let found = self.result_type_of(file, e);
        if found == own || !self.is_container(found) {
            return false;
        }
        let parts: Vec<TypeId> = self.parts(found).to_vec();
        parts
            .into_iter()
            .any(|part| part == self.with_unknown_elements(part))
    }

    fn yields_elements_of_container(&mut self, file: FileId, call: CallId) -> bool {
        let hir = self.hir(file);
        match hir[hir[call].callee].kind {
            ExprKind::Dot { obj, name, .. } => {
                !self.is_independent_of_elements(name) && self.holds_unknown_elements(file, obj)
            }
            ExprKind::Index { obj, .. } => self.holds_unknown_elements(file, obj),
            _ => false,
        }
    }

    fn reads_unknown_element(&mut self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Index { obj, .. } => self.holds_unknown_elements(file, obj),
            ExprKind::Call(call) => self.yields_elements_of_container(file, call),
            _ => false,
        }
    }

    fn is_independent_of_elements(&self, method: Atom) -> bool {
        matches!(
            self.atoms().bytes(method),
            b"push"
                | b"unshift"
                | b"indexOf"
                | b"lastIndexOf"
                | b"includes"
                | b"findIndex"
                | b"findLastIndex"
                | b"some"
                | b"every"
                | b"forEach"
                | b"join"
                | b"toString"
                | b"toLocaleString"
                | b"has"
                | b"delete"
                | b"clear"
        )
    }

    pub(super) fn has_primitive_elements(&mut self, ty: TypeId) -> bool {
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        parts.into_iter().any(|part| {
            let arguments: Vec<TypeId> = self.type_arguments(part).to_vec();
            arguments.into_iter().any(|argument| {
                self.is_uninformative(argument)
                    || self.some_type(argument, |c, element| c.is_primitive(element))
                    || self.is_container(argument) && self.has_primitive_elements(argument)
            })
        })
    }

    fn allocates_container_of_external_data(&mut self, file: FileId, e: ExprId) -> bool {
        let own = self.type_of_expr(file, e);
        if !self.has_primitive_elements(own) {
            return false;
        }
        let hir = self.hir(file);
        let elements: Vec<ExprId> = match hir[e].kind {
            ExprKind::Array(elements) => hir.ids(elements).collect(),
            ExprKind::New(call)
                if [&b"Map"[..], b"Set", b"WeakMap", b"Array"]
                    .into_iter()
                    .any(|name| self.refers_to_global_object(file, hir[call].callee, name)) =>
            {
                hir.ids(hir[call].args).collect()
            }
            _ => return false,
        };
        elements
            .into_iter()
            .any(|element| self.is_external_element(file, element))
    }

    fn container_mutations_in(&mut self, file: FileId) -> Rc<FxHashMap<SymbolId, Vec<ExprId>>> {
        if let Some(known) = self.aot.storage.container_mutations.get(&file) {
            return Rc::clone(known);
        }
        let (hir, bound, index) = (
            self.hir(file),
            self.bound(file),
            self.file_exprs_by_kind(file),
        );
        let variable_of = |e: ExprId| {
            matches!(hir[e].kind, ExprKind::Ident(_))
                .then(|| bound.expr_symbol[e.idx()])
                .filter(|symbol| symbol.is_some())
        };
        let mut found: FxHashMap<SymbolId, Vec<ExprId>> = FxHashMap::default();
        for &e in index.of(ExprTag::Call) {
            let ExprKind::Call(call) = hir[e].kind else {
                continue;
            };
            let ExprKind::Dot { obj, name, .. } = hir[hir[call].callee].kind else {
                continue;
            };
            let Some(variable) = variable_of(obj) else {
                continue;
            };
            if matches!(
                self.atoms().bytes(name),
                b"push" | b"unshift" | b"splice" | b"fill" | b"set" | b"add"
            ) {
                found
                    .entry(variable)
                    .or_default()
                    .extend(hir.ids(hir[call].args));
            }
        }
        for &e in index.of(ExprTag::Assign) {
            let ExprKind::Assign { target, value, .. } = hir[e].kind else {
                continue;
            };
            let ExprKind::Index { obj, .. } = hir[target].kind else {
                continue;
            };
            let Some(variable) = variable_of(obj) else {
                continue;
            };
            found.entry(variable).or_default().push(value);
        }
        let found = Rc::new(found);
        self.aot
            .storage
            .container_mutations
            .insert(file, Rc::clone(&found));
        found
    }

    fn is_container_filled_with_external_data(
        &mut self,
        file: FileId,
        sym: Sym,
        declared: TypeId,
    ) -> bool {
        if !self.is_container(declared) || !self.has_primitive_elements(declared) {
            return false;
        }
        let mutations = self.container_mutations_in(file);
        let Some(stored) = mutations.get(&sym.id) else {
            return false;
        };
        if let Some(&known) = self
            .aot
            .storage
            .filled_with_external_data
            .get(&(file, sym.id))
        {
            return known;
        }
        let query = Query::FilledWithExternalData(file, sym.id);
        if let Some(assumed) = self.assumption(query) {
            return assumed != 0;
        }
        let careful_before = (self.aot.javascript.is_idle() && self.aot.kinds.is_stable())
            .then(|| self.stack_half_used_count());
        let cuts = self.aot.storage.data_flow_cuts;
        let (found, is_final) = self.solve(query, 0, 1, |c| {
            u64::from(
                stored
                    .iter()
                    .any(|&value| c.is_external_element(file, value)),
            )
        });
        if is_final
            && cuts == self.aot.storage.data_flow_cuts
            && self.is_result_cacheable(careful_before)
        {
            self.aot
                .storage
                .filled_with_external_data
                .insert((file, sym.id), found != 0);
        }
        found != 0
    }

    fn chain_root_identifier(&self, file: FileId, e: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        let mut at = e;
        loop {
            at = match hir[at].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call) | ExprKind::New(call) => {
                    hir[call].callee
                }
                ExprKind::NonNull(expr)
                | ExprKind::Await(expr)
                | ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. } => expr,
                ExprKind::Ident(_) => return Some(at),
                _ => return None,
            };
        }
    }

    fn receives_prediction(&mut self, sym: Sym) -> bool {
        self.carries_external_data(DataFlowNode::Variable(sym))
    }

    fn is_param_supplied_by_host(&mut self, file: FileId, func: FnId, p: ParamId) -> bool {
        let written = self.type_of_param(file, p);
        let parts: &[TypeId] = self.parts(written);
        !self.is_uninformative(written)
            && parts
                .iter()
                .copied()
                .all(|part| self.is_primitive_or_built_in(part))
            && (self.is_host_callback(file, func) || self.is_argument_of_untyped_call(file, func))
    }

    fn is_jsx_factory(&mut self, file: FileId, func: FnId) -> bool {
        let program = self.p;
        program
            .aot
            .storage
            .jsx_factories
            .get_or_init(|| self.find_jsx_factories())
            .contains(&(file, func))
    }

    fn find_jsx_factories(&mut self) -> FxHashSet<(FileId, FnId)> {
        let (files, atoms) = (self.files(), self.atoms());
        let names: Vec<Atom> = [&b"jsx"[..], b"jsxs", b"jsxDEV", b"createElement"]
            .into_iter()
            .filter_map(|name| atoms.lookup(name))
            .collect();
        let (mut called, mut seen): (Vec<TypeId>, FxHashSet<Sym>) = Default::default();
        for file in (0..files.modules.len() as u32).map(FileId) {
            if !self.is_compiled(file) || self.hir(file).jsx.is_empty() {
                continue;
            }
            if let Some(runtime) = files.jsx_runtime(file) {
                let text = atoms.bytes(runtime);
                let package = text
                    .strip_suffix(b"/jsx-runtime")
                    .or_else(|| text.strip_suffix(b"/jsx-dev-runtime"))
                    .and_then(|package| atoms.lookup(package));
                let modules = [Some(runtime), package]
                    .into_iter()
                    .flatten()
                    .filter_map(|specifier| files.module(file).imported_file(specifier));
                let exported: Vec<Sym> = modules
                    .flat_map(|module| {
                        names
                            .iter()
                            .filter_map(move |&name| files.export(files.file_symbol(module), name))
                    })
                    .collect();
                for exported in exported {
                    let exported = if files.flags(exported).contains(SymFlags::ALIAS) {
                        files.resolve_alias(exported)
                    } else {
                        Some(exported)
                    };
                    if let Some(exported) = exported.filter(|&exported| seen.insert(exported)) {
                        called.push(self.type_of_symbol(exported));
                    }
                }
                continue;
            }
            for &element in self.file_exprs_by_kind(file).of(ExprTag::Jsx) {
                let (entity, Some(named)) = self.classic_jsx_factory(file, element, false) else {
                    continue;
                };
                if !seen.insert(named) {
                    continue;
                }
                let named = if files.flags(named).contains(SymFlags::ALIAS) {
                    files.resolve_alias(named)
                } else {
                    Some(named)
                };
                let Some(named) = named else { continue };
                let named = self.type_of_symbol(named);
                called.extend(
                    entity[1..]
                        .iter()
                        .try_fold(named, |object, &name| self.type_of_property(object, name)),
                );
            }
        }
        let mut factories = FxHashSet::default();
        for ty in called {
            for (of, func, _) in self
                .signatures(ty, false)
                .iter()
                .copied()
                .filter_map(|signature| self.sig_decl(signature))
            {
                factories.insert(self.implementation_for(of, func).unwrap_or((of, func)));
            }
        }
        factories
    }

    fn is_argument_of_untyped_call(&mut self, file: FileId, func: FnId) -> bool {
        let FnOwner::Expr(e) = self.bound(file).fns[func.idx()].owner else {
            return false;
        };
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else {
            return false;
        };
        if parent.is_none() || self.is_untyped_file(file) {
            return false;
        }
        let (ExprKind::Call(call) | ExprKind::New(call)) = self.hir(file)[parent].kind else {
            return false;
        };
        let callee = self.hir(file)[call].callee;
        if callee == e {
            return false;
        }
        let called = self.type_of_expr(file, callee);
        self.is_untyped(called)
    }

    fn is_param_stricter_than_inherited(&mut self, file: FileId, func: FnId, p: ParamId) -> bool {
        if !matches!(self.bound(file).fns[func.idx()].owner, FnOwner::Member(_)) {
            return false;
        }
        if let Some(&known) = self.aot.storage.stricter_method_params.get(&(file, p)) {
            return known;
        }
        let found = self.compute_param_stricter_than_inherited(file, func, p);
        self.aot
            .storage
            .stricter_method_params
            .insert((file, p), found);
        found
    }

    fn compute_param_stricter_than_inherited(
        &mut self,
        file: FileId,
        func: FnId,
        p: ParamId,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Member(member) = bound.fns[func.idx()].owner else {
            return false;
        };
        let MemberOwner::Class(class) = bound.member_owner[member.idx()] else {
            return false;
        };
        let (PropKey::Name(name), MemberKind::Method) = (hir[member].key, hir[member].kind) else {
            return false;
        };
        if hir[member].flags.contains(Flags::STATIC) || hir[p].flags.contains(Flags::REST) {
            return false;
        }
        let Some(index) = hir[func].params.iter().position(|other| other == p) else {
            return false;
        };
        let required = self.type_of_param(file, p);
        if self.has_type_variables(required) {
            return false;
        }
        let mut inherited = Vec::new();
        for node in hir.ids(hir[class].implements) {
            inherited.push(self.type_from_node(file, node));
        }
        let class = self.class_sym(file, class);
        inherited.extend(self.base_types(class).iter().copied());
        inherited.into_iter().any(|parent| {
            let Some(method) = self.type_of_property(parent, name) else {
                return false;
            };
            let method = self.non_nullable(method);
            let Some(signature) = self.single_call_signature(method) else {
                return false;
            };
            let expected = self.sig_params(signature);
            let Some(declared) = self.param_type_at(&expected, index) else {
                return false;
            };
            let declared = self.non_nullable(declared);
            !self.is_uninformative(declared)
                && !self.is_untyped(declared)
                && !self.has_type_variables(declared)
                && !self.every_type(declared, |c, part| {
                    c.is_primitive(part) || c.is_nullish(part)
                })
                && !self.is_provably_assignable(declared, required)
        })
    }

    fn is_typed_only_by_pattern(&mut self, file: FileId, func: FnId, p: ParamId) -> bool {
        let hir = self.hir(file);
        let has_literal_default =
            hir[p].default.is_some() && matches!(hir[hir[p].default].kind, ExprKind::Object(_));
        (has_literal_default || !matches!(hir[hir[p].pat].kind, PatKind::Ident(_)))
            && !hir[p].flags.contains(Flags::REST)
            && self.contextual_signature(file, func).is_none()
    }

    fn is_typed_by_declaration_file(&mut self, file: FileId, func: FnId) -> bool {
        let Some(expected) = self.contextual_signature(file, func) else {
            return false;
        };
        let Some((declared_in, ..)) = self.sig_decl(expected) else {
            return false;
        };
        self.is_declaration_only(declared_in) && !self.files().module(declared_in).is_lib
    }

    pub(super) fn is_in_untyped_clone_span(&self, file: FileId, pos: u32) -> bool {
        let Some((of, spans)) = &self.aot.storage.untyped_clone_spans else {
            return false;
        };
        *of == file
            && spans[..spans.partition_point(|span| span.0 <= pos)]
                .last()
                .is_some_and(|span| pos < span.1)
    }

    fn untyped_clone_spans_in(&mut self, file: FileId) -> Rc<[(u32, u32)]> {
        let functions: Vec<FnId> = (0..self.hir(file).fns.len() as u32)
            .map(FnId)
            .filter(|&func| {
                self.has_untyped_clone(file, func)
                    || self.method_has_untyped_clone(file, func)
                    || self.has_logging_untyped_clone(file, func)
            })
            .collect();
        let mut spans: Vec<(u32, u32)> = functions
            .into_iter()
            .map(|func| (self.hir(file)[func].start, self.end_of_fn(file, func)))
            .collect();
        spans.sort_unstable();
        let mut apart: Vec<(u32, u32)> = Vec::with_capacity(spans.len());
        for span in spans {
            match apart.last_mut() {
                Some(last) if span.0 < last.1 => last.1 = last.1.max(span.1),
                _ => apart.push(span),
            }
        }
        apart.into()
    }

    fn swap_with_saved_state(&mut self) {
        let aside = self
            .aot
            .storage
            .set_aside
            .get_or_insert_with(Default::default);
        std::mem::swap(
            &mut self.aot.storage.flow_coverage,
            &mut aside.flow_coverage,
        );
        std::mem::swap(
            &mut self.aot.storage.variable_reads,
            &mut aside.variable_reads,
        );
        std::mem::swap(&mut self.aot.storage.stored, &mut aside.stored);
        std::mem::swap(
            &mut self.aot.storage.external_data_flow,
            &mut aside.external_data_flow,
        );
        std::mem::swap(
            &mut self.aot.storage.filled_with_external_data,
            &mut aside.filled_with_external_data,
        );
        std::mem::swap(
            &mut self.aot.storage.confirmed_results,
            &mut aside.confirmed_results,
        );
        std::mem::swap(&mut self.aot.storage.results, &mut aside.results);
        std::mem::swap(&mut self.aot.trust, &mut aside.trust);
        std::mem::swap(&mut self.aot.integers, &mut aside.integers);
        std::mem::swap(&mut self.aot.kinds, &mut aside.kinds);
    }

    pub fn translate_untyped_clone(&mut self, root: Option<(FileId, FnId)>) {
        let file = root.map(|root| root.0);
        if file == self.aot.storage.untyped_clone_spans.as_ref().map(|on| on.0) {
            return;
        }
        self.clear_expr_cache();
        if self.aot.storage.untyped_clone_spans.take().is_some() {
            self.swap_with_saved_state();
        }
        let Some(file) = file else { return };
        let spans = match &self.aot.storage.untyped_state_owner {
            Some((of, spans)) if *of == file => Rc::clone(spans),
            _ => {
                let spans = self.untyped_clone_spans_in(file);
                self.aot.storage.untyped_state_owner = Some((file, Rc::clone(&spans)));
                self.aot.storage.set_aside = None;
                spans
            }
        };
        self.swap_with_saved_state();
        self.enable_expr_cache_for(file);
        self.aot.storage.untyped_clone_spans = Some((file, spans));
    }

    pub fn has_untyped_clone(&mut self, file: FileId, func: FnId) -> bool {
        if func.is_none() || self.is_untyped_file(file) || !self.is_compiled(file) {
            return false;
        }
        if let Some(&known) = self.aot.storage.untyped_clones.get(&(file, func)) {
            return known;
        }
        let found = self.compute_has_untyped_clone(file, func);
        if !self.aot.storage.is_cross_file_query {
            self.aot.storage.untyped_clones.insert((file, func), found);
        }
        found
    }

    fn references_private_member(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (start, end) = (hir[func].start, self.end_of_fn(file, func));
        bound
            .private_class
            .iter()
            .any(|(&e, _)| start <= hir[e].pos && hir[e].pos < end)
    }

    pub fn has_logging_untyped_clone(&mut self, file: FileId, func: FnId) -> bool {
        if !self.logs_type_errors()
            || func.is_none()
            || self.is_untyped_file(file)
            || !self.is_compiled(file)
            || self.files().module(file).builtin.is_some()
        {
            return false;
        }
        if let Some(&known) = self.aot.storage.logging_untyped_clones.get(&(file, func)) {
            return known;
        }
        let found = !self.has_untyped_clone(file, func)
            && self.could_have_untyped_clone(file, func, true)
            && (self.has_unknown_callers(file, func)
                || self.escapes_with_enclosing_literal(file, func)
                || self.is_iife_with_untyped_arguments(file, func)
                || self.is_called_with_untyped_arguments(file, func, None));
        self.aot
            .storage
            .logging_untyped_clones
            .insert((file, func), found);
        found
    }

    fn escapes_by_visible_path(&mut self, file: FileId, func: FnId) -> bool {
        self.aot.storage.ignores_member_names = true;
        let found = self.escapes_with_enclosing_literal(file, func);
        self.aot.storage.ignores_member_names = false;
        found
    }

    fn escapes_with_enclosing_literal(&mut self, file: FileId, func: FnId) -> bool {
        let bound = self.bound(file);
        let mentions: Vec<ExprId> = match bound.fns[func.idx()].owner {
            FnOwner::Expr(e) => {
                let named = self.function_name_symbol(file, func);
                std::iter::once(e)
                    .chain(self.symbol_mentions(file, named))
                    .collect()
            }
            FnOwner::Stmt(_) => {
                self.symbol_mentions(file, bound.symbol_of_declaration(Decl::Fn(func)))
            }
            _ => return false,
        };
        mentions
            .into_iter()
            .any(|mention| self.is_in_escaping_literal(file, mention))
    }

    fn is_in_escaping_literal(&mut self, file: FileId, at: ExprId) -> bool {
        self.escapes_from(file, at, false, 2)
    }

    fn escapes_from(
        &mut self,
        file: FileId,
        mut at: ExprId,
        mut is_held_in_a_literal: bool,
        hops: u32,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let around = match bound.expr_parent[at.idx()] {
                Parent::Prop(prop) if hir[prop].kind != PropKind::Spread => {
                    if !is_held_in_a_literal
                        && matches!(hir[prop].key, PropKey::Name(name) if self.escapes_by_member_name(name, false))
                    {
                        return true;
                    }
                    bound.prop_owner[prop.idx()]
                }
                Parent::MemberInit(member) => {
                    return !is_held_in_a_literal
                        && matches!(hir[member].key, PropKey::Name(name) if self.escapes_by_member_name(name, false));
                }
                Parent::Expr(parent)
                    if hops != 0
                        && parent.is_some()
                        && matches!(hir[parent].kind, ExprKind::Assign { op: None, target, value } if value == at && matches!(hir[target].kind, ExprKind::Ident(_))) =>
                {
                    let ExprKind::Assign { target, .. } = hir[parent].kind else {
                        return false;
                    };
                    let mentions = self.symbol_mentions(file, bound.expr_symbol[target.idx()]);
                    return mentions
                        .into_iter()
                        .filter(|&mention| mention != target)
                        .any(|mention| {
                            self.escapes_typed_code(file, mention, is_held_in_a_literal)
                                || self.escapes_from(file, mention, is_held_in_a_literal, hops - 1)
                        });
                }
                Parent::Expr(parent) => parent,
                Parent::VarInit(d)
                    if hops != 0
                        && hir[d].ty.is_none()
                        && matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
                        && !matches!(hir[at].kind, ExprKind::Fn(_)) =>
                {
                    let named = bound.pat_symbol[hir[d].pat.idx()];
                    return self
                        .symbol_mentions(file, named)
                        .into_iter()
                        .any(|mention| {
                            self.escapes_typed_code(file, mention, is_held_in_a_literal)
                                || self.escapes_from(file, mention, is_held_in_a_literal, hops - 1)
                        })
                        || self.symbol_escapes_in_another_file(file, named);
                }
                Parent::FnBody(returning) if hops != 0 => {
                    return self.result_escapes(file, returning, is_held_in_a_literal, hops - 1);
                }
                Parent::Stmt(stmt)
                    if hops != 0
                        && stmt.is_some()
                        && matches!(hir[stmt].kind, StmtKind::Return(_)) =>
                {
                    return matches!(self.enclosing_site(file, Parent::Stmt(stmt)), Some(Site::Body(returning)) if self.result_escapes(file, returning, is_held_in_a_literal, hops - 1));
                }
                _ => return false,
            };
            if around.is_none()
                || !matches!(hir[around].kind, ExprKind::Object(_) | ExprKind::Array(_))
            {
                return false;
            }
            self.prepare_enclosing(file, at);
            if self
                .contextual_type(file, at, ContextFlags::empty())
                .is_some_and(|expected| self.is_uninformative(expected))
                || self.escapes_typed_code(file, around, true)
            {
                return true;
            }
            (at, is_held_in_a_literal) = (around, true);
        }
    }

    fn result_escapes(
        &mut self,
        file: FileId,
        returning: FnId,
        is_held_in_a_literal: bool,
        hops: u32,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let named = match bound.fns[returning.idx()].owner {
            FnOwner::Stmt(_) => bound.symbol_of_declaration(Decl::Fn(returning)),
            _ => self.function_name_symbol(file, returning),
        };
        if hir[returning]
            .flags
            .intersects(Flags::ASYNC | Flags::GENERATOR)
        {
            return false;
        }
        if named.is_none() {
            return hir[returning].kind == FnKind::Method
                && hir[returning].name.is_some()
                && self.escapes_by_member_name(hir[returning].name, true);
        }
        let call_of = |mention: ExprId| match bound.expr_parent[mention.idx()] {
            Parent::Expr(parent)
                if parent.is_some()
                    && matches!(hir[parent].kind, ExprKind::Call(call) if hir[call].callee == mention) =>
            {
                Some(parent)
            }
            _ => None,
        };
        if self
            .symbol_mentions(file, named)
            .into_iter()
            .filter_map(call_of)
            .any(|call| {
                self.escapes_typed_code(file, call, is_held_in_a_literal)
                    || self.escapes_from(file, call, is_held_in_a_literal, hops)
            })
        {
            return true;
        }
        if self.aot.storage.is_cross_file_query {
            return false;
        }
        let sym = self.files().sym(file, named);
        let exported = self.files().export_symbol_of_value_symbol_if_exported(sym);
        let program = self.p;
        let standing = program
            .aot
            .storage
            .import_calls
            .get_or_init(|| self.find_import_calls());
        let mut calls: Vec<(FileId, ExprId)> = Vec::new();
        calls.extend(standing.get(&sym).into_iter().flatten().copied());
        if exported != sym {
            calls.extend(standing.get(&exported).into_iter().flatten().copied());
        }
        self.aot.storage.is_cross_file_query = true;
        let found = calls.into_iter().any(|(other, call)| {
            self.is_untyped_file(other)
                || self.is_passed_to_host(other, call)
                || self.flows_into_untyped_slot(other, call)
        });
        self.aot.storage.is_cross_file_query = false;
        found
    }

    fn escapes_by_member_name(&mut self, name: Atom, is_what_it_returns: bool) -> bool {
        if self.aot.storage.is_cross_file_query || self.aot.storage.ignores_member_names {
            return false;
        }
        let program = self.p;
        if let Some(&known) = program
            .aot
            .storage
            .escaped_members
            .lock()
            .get(&(name, is_what_it_returns))
        {
            return known;
        }
        let standing = program
            .aot
            .storage
            .member_mentions
            .get_or_init(|| self.find_member_mentions());
        let mentions: Vec<(FileId, ExprId)> = standing.get(&name).cloned().unwrap_or_default();
        let found = mentions.into_iter().any(|(other, mention)| {
            let (hir, bound) = (self.hir(other), self.bound(other));
            let call = match bound.expr_parent[mention.idx()] {
                Parent::Expr(parent) if parent.is_some() && matches!(hir[parent].kind, ExprKind::Call(call) if hir[call].callee == mention) => Some(parent),
                _ => None,
            };
            if let (false, Some(_), ExprKind::Dot { obj, .. }) = (is_what_it_returns, call, hir[mention].kind) {
                self.prepare_enclosing(other, obj);
                return self.type_of_expr(other, obj).is_any();
            }
            let Some(leaving) = (if is_what_it_returns { call } else { Some(mention) }) else { return false };
            self.aot.storage.is_cross_file_query = true;
            let leaves = self.is_passed_to_host(other, leaving) || self.flows_into_untyped_slot(other, leaving);
            self.aot.storage.is_cross_file_query = false;
            leaves
        });
        program
            .aot
            .storage
            .escaped_members
            .lock()
            .insert((name, is_what_it_returns), found);
        found
    }

    pub fn is_deleted_from_untyped_objects(&mut self, name: Atom) -> bool {
        let program = self.p;
        let deletions = self.deletions();
        if deletions.names_deleted_from_untyped_objects.contains(&name) {
            return true;
        }
        if deletions.from_dictionaries.is_empty() {
            return false;
        }
        let from_predictions = program
            .aot
            .storage
            .names_deleted_from_predicted_dictionaries
            .get_or_init(|| {
                let mut asker = program.checker();
                (asker.stack_base, asker.stack_limit) = (self.stack_base, self.stack_limit);
                asker.during_translation(|asker| {
                    let is_predicted = |&&(file, dictionary, _): &&(FileId, ExprId, Atom)| {
                        asker.prepare_enclosing(file, dictionary);
                        asker.is_predicted(file, dictionary)
                    };
                    deletions
                        .from_dictionaries
                        .iter()
                        .filter(is_predicted)
                        .map(|deletion| deletion.2)
                        .collect()
                })
            });
        from_predictions.contains(&name)
    }

    fn deletions(&mut self) -> &'p Deletions {
        let program = self.p;
        program
            .aot
            .storage
            .deletions
            .get_or_init(|| self.find_deletions())
    }

    fn find_deletions(&mut self) -> Deletions {
        let (mut names, mut from_dictionaries) = (FxHashSet::default(), Vec::new());
        for file in (0..self.files().modules.len() as u32).map(FileId) {
            if !self.is_compiled(file) {
                continue;
            }
            let hir = self.hir(file);
            let mut deleted: Vec<(ExprId, Atom)> = Vec::new();
            for &e in self.file_exprs_by_kind(file).of(ExprTag::Unary) {
                let ExprKind::Unary {
                    op: UnOp::Delete,
                    operand,
                } = hir[e].kind
                else {
                    continue;
                };
                match hir[operand].kind {
                    ExprKind::Dot { obj, name, .. } => deleted.push((obj, name)),
                    ExprKind::Index { obj, index, .. } => {
                        if let ExprKind::String(name) = hir[index].kind {
                            deleted.push((obj, name));
                        }
                    }
                    _ => {}
                }
            }
            for &e in self.file_exprs_by_kind(file).of(ExprTag::Call) {
                let ExprKind::Call(call) = hir[e].kind else {
                    continue;
                };
                let ExprKind::Dot {
                    obj: holder,
                    name: method,
                    ..
                } = hir[hir[call].callee].kind
                else {
                    continue;
                };
                if self.atoms().bytes(method) != b"deleteProperty"
                    || !self.refers_to_global_object(file, holder, b"Reflect")
                {
                    continue;
                }
                let mut arguments = hir.ids(hir[call].args);
                if let (Some(obj), Some(key)) = (arguments.next(), arguments.next())
                    && let ExprKind::String(name) = hir[key].kind
                {
                    deleted.push((obj, name));
                }
            }
            for (obj, name) in deleted {
                if !self.is_untyped_file(file) {
                    self.prepare_enclosing(file, obj);
                    let of_object = self.type_of_expr(file, obj);
                    if !self.is_uninformative(of_object) {
                        if !self.dictionaries_in(of_object).is_empty() {
                            from_dictionaries.push((file, obj, name));
                        }
                        continue;
                    }
                }
                names.insert(name);
            }
        }
        Deletions {
            names_deleted_from_untyped_objects: names,
            from_dictionaries,
        }
    }

    fn find_member_mentions(&mut self) -> FxHashMap<Atom, Vec<(FileId, ExprId)>> {
        let mut standing: FxHashMap<Atom, Vec<(FileId, ExprId)>> = FxHashMap::default();
        for other in (0..self.files().modules.len() as u32).map(FileId) {
            if !self.is_compiled(other)
                || self.is_untyped_file(other)
                || self.files().module(other).builtin.is_some()
            {
                continue;
            }
            let hir = self.hir(other);
            for &e in self.file_exprs_by_kind(other).of(ExprTag::Dot) {
                if let ExprKind::Dot { name, .. } = hir[e].kind {
                    standing.entry(name).or_default().push((other, e));
                }
            }
        }
        standing
    }

    fn is_iife_with_untyped_arguments(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Expr(e) = bound.fns[func.idx()].owner else {
            return false;
        };
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else {
            return false;
        };
        if parent.is_none() {
            return false;
        }
        let ExprKind::Call(call) = hir[parent].kind else {
            return false;
        };
        hir[call].callee == e
            && hir.ids(hir[call].args).any(|argument| {
                self.prepare_enclosing(file, argument);
                self.type_of_expr(file, argument).is_any()
            })
    }

    fn find_import_calls(&mut self) -> FxHashMap<Sym, Vec<(FileId, ExprId)>> {
        let mut standing: FxHashMap<Sym, Vec<(FileId, ExprId)>> = FxHashMap::default();
        for other in (0..self.files().modules.len() as u32).map(FileId) {
            if !self.is_compiled(other) {
                continue;
            }
            let (hir, bound) = (self.hir(other), self.bound(other));
            for &e in self.file_exprs_by_kind(other).of(ExprTag::Call) {
                let ExprKind::Call(call) = hir[e].kind else {
                    continue;
                };
                let local = bound.expr_symbol[hir[call].callee.idx()];
                if local.is_none() || !matches!(hir[hir[call].callee].kind, ExprKind::Ident(_)) {
                    continue;
                }
                let local = self.files().sym(other, local);
                if !self.files().flags(local).contains(SymFlags::ALIAS) {
                    continue;
                }
                let Some(target) = self.files().resolve_alias(local) else {
                    continue;
                };
                if !self.is_untyped_file(target.file) && self.refers_to_function(target) {
                    standing.entry(target).or_default().push((other, e));
                }
            }
        }
        standing
    }

    fn escapes_typed_code(&mut self, file: FileId, e: ExprId, is_held_in_a_literal: bool) -> bool {
        self.flows_into_untyped_slot(file, e)
            || self.is_passed_to_host(file, e)
            || is_held_in_a_literal && self.is_passed_to_ambient_declaration(file, e)
    }

    fn is_passed_to_ambient_declaration(&mut self, file: FileId, mut e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let parent = match bound.expr_parent[e.idx()] {
                Parent::Prop(prop) if hir[prop].kind != PropKind::Spread => {
                    bound.prop_owner[prop.idx()]
                }
                Parent::Expr(parent) => parent,
                _ => return false,
            };
            if parent.is_none() {
                return false;
            }
            match hir[parent].kind {
                ExprKind::Call(call) | ExprKind::New(call) => {
                    if hir[call].callee == e {
                        return false;
                    }
                    self.prepare_enclosing(file, parent);
                    let Some(sig) = self.resolved_signature(file, parent).sig else {
                        return false;
                    };
                    return self.sig_decl(sig).is_some_and(|(declared_in, ..)| {
                        self.hir(declared_in).kind == FileKind::Declaration
                    });
                }
                ExprKind::Object(_)
                | ExprKind::Array(_)
                | ExprKind::NonNull(_)
                | ExprKind::Satisfies { .. }
                | ExprKind::As { .. } => {}
                _ => return false,
            }
            e = parent;
        }
    }

    pub fn help_find_untyped_argument_receivers(&mut self) {
        if self.p.aot.storage.untyped_argument_calls.get().is_none() {
            self.help_find_untyped_argument_calls();
        }
    }

    pub fn may_receive_untyped_arguments(
        &mut self,
        file: FileId,
        func: FnId,
        is_used_as_a_value: bool,
    ) -> bool {
        if func.is_none()
            || self.is_untyped_file(file)
            || !self.is_compiled(file)
            || self.files().module(file).builtin.is_some()
        {
            return false;
        }
        self.during_translation(|c| {
            !c.has_untyped_clone(file, func)
                && (c.has_unknown_callers(file, func)
                    || c.escapes_by_visible_path(file, func)
                    || c.is_called_with_untyped_arguments(file, func, Some(is_used_as_a_value)))
        })
    }

    fn compute_has_untyped_clone(&mut self, file: FileId, func: FnId) -> bool {
        self.could_have_untyped_clone(file, func, false)
            && !self.object_parameter_indices(file, func).is_empty()
            && self.has_unknown_callers(file, func)
    }

    fn has_unknown_callers(&mut self, file: FileId, func: FnId) -> bool {
        self.is_host_callback(file, func)
            || self.function_escapes(file, func)
            || self.receives_untyped_from_js(file, func)
            || self.is_passed_to_host_by_name(file, func)
            || self.escapes_in_another_file(file, func)
            || self.is_called_with_weaker_types(file, func)
            || self.receives_component_props(file, func)
    }

    pub fn is_exported_to_unseen_files(&mut self, file: FileId, func: FnId) -> bool {
        if !self.preserves_source_paths() || self.is_untyped_file(file) || !self.is_compiled(file) {
            return false;
        }
        let symbol = self.function_name_symbol(file, func);
        !symbol.is_none()
            && !self.bound(file).symbols[symbol.idx()].parent.is_none()
            && self.could_have_untyped_clone(file, func, false)
            && !self.object_parameter_indices(file, func).is_empty()
    }

    fn receives_component_props(&mut self, file: FileId, func: FnId) -> bool {
        let symbol = self.function_name_symbol(file, func);
        if symbol.is_none() {
            return false;
        }
        let program = self.p;
        let receivers = program
            .aot
            .storage
            .functions_receiving_component_props
            .get_or_init(|| self.find_functions_receiving_component_props());
        let sym = self.files().sym(file, symbol);
        receivers.contains(&sym)
            || receivers.contains(&self.files().export_symbol_of_value_symbol_if_exported(sym))
    }

    fn find_functions_receiving_component_props(&mut self) -> FxHashSet<Sym> {
        let mut forwarded_to: FxHashMap<(Sym, u32), Vec<(Sym, u32)>> = FxHashMap::default();
        let mut pending: Vec<(Sym, u32)> = Vec::new();
        for file in (0..self.files().modules.len() as u32).map(FileId) {
            if !self.is_compiled(file) || self.is_untyped_file(file) {
                continue;
            }
            let (hir, bound) = (self.hir(file), self.bound(file));
            let resolve_name = |c: &Self, name: ExprId| -> Option<Sym> {
                let local = bound.expr_symbol[name.idx()];
                if !matches!(hir[name].kind, ExprKind::Ident(_)) || local.is_none() {
                    return None;
                }
                let local = c.files().sym(file, local);
                if c.files().flags(local).contains(SymFlags::ALIAS) {
                    c.files().resolve_alias(local)
                } else {
                    Some(local)
                }
            };
            for &name in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
                let Parent::Expr(parent) = bound.expr_parent[name.idx()] else {
                    continue;
                };
                if parent.is_none() {
                    continue;
                }
                match hir[parent].kind {
                    ExprKind::Jsx(jsx) if hir[jsx].tag == name => {
                        pending.extend(resolve_name(self, name).map(|tag| (tag, 0)))
                    }
                    ExprKind::Call(call) if hir[call].callee != name => {
                        let local = bound.expr_symbol[name.idx()];
                        let Some([Decl::Param(pat)]) = bound
                            .symbols
                            .get(local.idx())
                            .map(|symbol| symbol.decls.as_slice())
                        else {
                            continue;
                        };
                        let PatParent::Param(parameter) = bound.pat_parent[pat.idx()] else {
                            continue;
                        };
                        let func = bound.param_fn[parameter.idx()];
                        let owner = self.function_name_symbol(file, func);
                        let (Some(parameter_index), Some(argument_index), Some(callee)) = (
                            hir[func].params.iter().position(|other| other == parameter),
                            hir.ids(hir[call].args)
                                .position(|argument| argument == name),
                            resolve_name(self, hir[call].callee),
                        ) else {
                            continue;
                        };
                        if owner.is_none() || hir[parameter].pat != *pat {
                            continue;
                        }
                        let owner = self.files().sym(file, owner);
                        for from in [
                            owner,
                            self.files()
                                .export_symbol_of_value_symbol_if_exported(owner),
                        ] {
                            forwarded_to
                                .entry((from, parameter_index as u32))
                                .or_default()
                                .push((callee, argument_index as u32));
                        }
                    }
                    _ => {}
                }
            }
        }
        let mut visited: FxHashSet<(Sym, u32)> = FxHashSet::default();
        while let Some(at) = pending.pop() {
            if visited.insert(at) {
                pending.extend(forwarded_to.get(&at).into_iter().flatten().copied());
            }
        }
        visited.into_iter().map(|(function, _)| function).collect()
    }

    fn is_called_with_weaker_types(&mut self, file: FileId, func: FnId) -> bool {
        let own = self.hir(file)[func].params;
        if !own.iter().any(|p| self.hir(file)[p].ty.is_some()) {
            return false;
        }
        let mut places: Vec<crate::types::SigId> = Vec::new();
        places.extend(self.contextual_signature(file, func));
        let named = self.function_name_symbol(file, func);
        for mention in self.symbol_mentions(file, named) {
            let Some(entered) = self.contextual_type_of_literal(file, mention) else {
                continue;
            };
            let entered = self.non_nullable(entered);
            places.extend(self.single_call_signature(entered));
        }
        places.into_iter().any(|place| {
            let expected = self.sig_params(place);
            (0..own.len()).any(|index| {
                let p = own.at(index);
                let written = &self.hir(file)[p];
                if written.ty.is_none() || written.flags.contains(Flags::REST) {
                    return false;
                }
                let Some(promised) = self.param_type_at(&expected, index) else {
                    return false;
                };
                let promised = self.non_nullable(promised);
                let asked = self.type_of_param(file, p);
                !self.is_uninformative(promised)
                    && !self.is_untyped(promised)
                    && !self.has_type_variables(promised)
                    && !self.has_type_variables(asked)
                    && !self.every_type(promised, |c, part| {
                        c.is_primitive(part) || c.is_nullish(part)
                    })
                    && !self.is_provably_assignable(promised, asked)
            })
        })
    }

    fn could_have_untyped_clone(&mut self, file: FileId, func: FnId, is_for_the_log: bool) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if !matches!(
            bound.fns[func.idx()].owner,
            FnOwner::Expr(_) | FnOwner::Stmt(_)
        ) || matches!(f.body, FnBody::None)
        {
            return false;
        }
        if f.this_param.is_some()
            || f.flags.contains(Flags::GENERATOR)
            || !is_for_the_log && f.flags.contains(Flags::ASYNC)
            || f.params.iter().any(|p| hir[p].flags.contains(Flags::REST))
        {
            return false;
        }
        let is_call_opaque = match f.kind {
            FnKind::Arrow => match self.arrow_receiver(file, func) {
                Receiver::None => true,
                Receiver::Function(around) if !is_for_the_log => {
                    !self.mentions_new_target(file, around)
                        && !self.mentions_super(file, around)
                        && !self.mentions_arguments_object(file, around)
                        && !self.references_private_member(file, func)
                }
                Receiver::Function(_) | Receiver::Instance(_) | Receiver::Static(_) => {
                    let (start, end) = (f.start, self.end_of_fn(file, func));
                    let index = self.file_exprs_by_kind(file);
                    let call_visibility = index
                        .of(ExprTag::Super)
                        .iter()
                        .chain(index.of(ExprTag::NewTarget))
                        .chain(&bound.arguments_objects);
                    is_for_the_log
                        && !self.references_private_member(file, func)
                        && !call_visibility
                            .into_iter()
                            .any(|&e| start <= hir[e].pos && hir[e].pos < end)
                }
            },
            FnKind::Decl => !bound.fns[func.idx()].contains_this,
            FnKind::Expr => {
                !bound.fns[func.idx()].contains_this
                    && (f.name.is_none()
                        || is_for_the_log
                            && self
                                .symbol_mentions(file, bound.symbol_of_declaration(Decl::Fn(func)))
                                .is_empty())
            }
            FnKind::Method | FnKind::Setter => {
                (is_for_the_log
                    || f.kind == FnKind::Method && self.is_called_with_weaker_types(file, func))
                    && !self.mentions_super(file, func)
                    && !self.mentions_arguments_object(file, func)
                    && !self.references_private_member(file, func)
            }
            _ => false,
        };
        if !is_call_opaque || self.mentions_new_target(file, func) {
            return false;
        }
        let (start, end) = (f.start, self.end_of_fn(file, func));
        !(0..hir.classes.len() as u32)
            .map(ClassId)
            .any(|class| start <= hir[class].start && hir[class].start < end)
    }

    pub fn method_has_untyped_clone(&mut self, file: FileId, func: FnId) -> bool {
        if func.is_none() || self.is_untyped_file(file) || !self.is_compiled(file) {
            return false;
        }
        let hir = self.hir(file);
        let f = &hir[func];
        if !matches!(f.kind, FnKind::Method | FnKind::Getter | FnKind::Setter)
            || matches!(f.body, FnBody::None)
        {
            return false;
        }
        if f.this_param.is_some()
            || f.flags.contains(Flags::GENERATOR)
            || f.params.iter().any(|p| hir[p].flags.contains(Flags::REST))
        {
            return false;
        }
        if self.mentions_new_target(file, func) || self.mentions_arguments_object(file, func) {
            return false;
        }
        let (start, end) = (f.start, self.end_of_fn(file, func));
        let positions = self.sorted_positions(file);
        let has_any_within = |sorted: &[u32]| {
            sorted
                .get(sorted.partition_point(|&pos| pos < start))
                .is_some_and(|&pos| pos < end)
        };
        !has_any_within(&positions.classes) && !has_any_within(&positions.private_name_uses)
    }

    fn sorted_positions(&self, file: FileId) -> &'p SortedPositions {
        let program = self.p;
        program
            .aot
            .storage
            .sorted_positions
            .get_or_init(program.files.modules.len(), file, || {
                let (hir, bound) = (self.hir(file), self.bound(file));
                let mut functions: Box<[(u32, FnId)]> = (0..hir.fns.len() as u32)
                    .map(FnId)
                    .map(|func| (hir[func].start, func))
                    .collect();
                let mut classes: Box<[u32]> = (0..hir.classes.len() as u32)
                    .map(ClassId)
                    .map(|class| hir[class].start)
                    .collect();
                let mut private_name_uses: Box<[u32]> = bound
                    .private_class
                    .iter()
                    .map(|(&e, _)| hir[e].pos)
                    .collect();
                functions.sort_unstable();
                classes.sort_unstable();
                private_name_uses.sort_unstable();
                SortedPositions {
                    functions,
                    classes,
                    private_name_uses,
                }
            })
    }

    pub fn functions_starting_within(
        &self,
        file: FileId,
        start: u32,
        end: u32,
    ) -> &'p [(u32, FnId)] {
        let functions = &self.sorted_positions(file).functions;
        &functions[functions.partition_point(|&(pos, _)| pos < start)
            ..functions.partition_point(|&(pos, _)| pos < end)]
    }

    pub fn annotation_exclusions(&mut self, file: FileId, p: ParamId) -> (bool, bool, bool) {
        let written = self.type_of_param(file, p);
        let parameter = &self.hir(file)[p];
        let may_be_omitted =
            parameter.default.is_some() || parameter.flags.contains(Flags::OPTIONAL);
        let parts: &[TypeId] = self.parts(written);
        let may_be_anything = self.accepts_nullish(written)
            || parts.iter().any(|&part| {
                part.is_any()
                    || matches!(part, TypeId::UNKNOWN | TypeId::UNRESOLVED)
                    || self.is_instantiable(part)
            });
        let no_undefined = !may_be_omitted && !self.accepts_undefined(written);
        let no_null = !may_be_anything && !parts.iter().any(|part| part.is_null());
        let no_objects = !may_be_anything
            && !parts.is_empty()
            && parts
                .iter()
                .copied()
                .all(|part| self.has_primitive_flag(part));
        (no_undefined, no_null, no_objects)
    }

    fn object_parameter_indices(&mut self, file: FileId, func: FnId) -> Vec<usize> {
        (self.hir(file)[func].params.iter().enumerate())
            .filter(|&(_, p)| {
                (self.hir(file)[p].ty.is_some()
                    || self.is_callback_param_checked_at_entry(file, func, p))
                    && {
                        let written = self.type_of_param(file, p);
                        !self.is_uninformative(written)
                            && !self.every_type(written, |c, part| {
                                c.is_primitive(part) || c.is_nullish(part)
                            })
                    }
            })
            .map(|(index, _)| index)
            .collect()
    }

    fn escapes_in_another_file(&mut self, file: FileId, func: FnId) -> bool {
        if self.aot.storage.is_cross_file_query {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => bound.symbol_of_declaration(Decl::Fn(func)),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                    bound.pat_symbol[hir[d].pat.idx()]
                }
                _ => return false,
            },
            _ => return false,
        };
        self.symbol_escapes_in_another_file(file, symbol)
    }

    fn symbol_escapes_in_another_file(&mut self, file: FileId, symbol: SymbolId) -> bool {
        if symbol.is_none() || self.aot.storage.is_cross_file_query {
            return false;
        }
        let sym = self.files().sym(file, symbol);
        let exported = self.files().export_symbol_of_value_symbol_if_exported(sym);
        let program = self.p;
        let standing = program
            .aot
            .storage
            .forwardable_imports
            .get_or_init(|| self.find_forwardable_imports());
        let mut mentions: Vec<(FileId, ExprId)> = Vec::new();
        mentions.extend(standing.get(&sym).into_iter().flatten().copied());
        if exported != sym {
            mentions.extend(standing.get(&exported).into_iter().flatten().copied());
        }
        self.aot.storage.is_cross_file_query = true;
        let found = mentions.into_iter().any(|(other, name)| {
            self.is_passed_to_host(other, name) || self.flows_into_untyped_slot(other, name)
        });
        self.aot.storage.is_cross_file_query = false;
        found
    }

    fn find_forwardable_imports(&mut self) -> FxHashMap<Sym, Vec<(FileId, ExprId)>> {
        let mut standing: FxHashMap<Sym, Vec<(FileId, ExprId)>> = FxHashMap::default();
        for other in (0..self.files().modules.len() as u32).map(FileId) {
            if !self.is_compiled(other) || self.is_untyped_file(other) {
                continue;
            }
            let (hir, bound) = (self.hir(other), self.bound(other));
            for &name in self.file_exprs_by_kind(other).of(ExprTag::Ident) {
                let local = bound.expr_symbol[name.idx()];
                if local.is_none() {
                    continue;
                }
                let may_be_forwarded = match bound.expr_parent[name.idx()] {
                    Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                        ExprKind::Call(call) | ExprKind::New(call) => hir[call].callee != name,
                        ExprKind::Assign {
                            op: None, value, ..
                        } => value == name,
                        ExprKind::As { .. }
                        | ExprKind::Array(_)
                        | ExprKind::NonNull(_)
                        | ExprKind::Satisfies { .. }
                        | ExprKind::Cond { .. }
                        | ExprKind::Binary { .. }
                        | ExprKind::Jsx(_) => true,
                        _ => false,
                    },
                    Parent::Prop(_) | Parent::VarInit(_) | Parent::FnBody(_) | Parent::Stmt(_) => {
                        true
                    }
                    _ => false,
                };
                if !may_be_forwarded {
                    continue;
                }
                let local = self.files().sym(other, local);
                if !self.files().flags(local).contains(SymFlags::ALIAS) {
                    continue;
                }
                let Some(target) = self.files().resolve_alias(local) else {
                    continue;
                };
                if self.is_untyped_file(target.file)
                    || !matches!(
                        self.files().value_declaration(target),
                        Some((_, Decl::Fn(_) | Decl::Var(_)))
                    )
                {
                    continue;
                }
                standing.entry(target).or_default().push((other, name));
            }
        }
        standing
    }

    fn receives_untyped_from_js(&mut self, file: FileId, func: FnId) -> bool {
        let program = self.p;
        program
            .aot
            .storage
            .receiving_untyped_from_js
            .get_or_init(|| self.find_functions_receiving_untyped_from_js());
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => bound.symbol_of_declaration(Decl::Fn(func)),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                    bound.pat_symbol[hir[d].pat.idx()]
                }
                _ => return false,
            },
            _ => return false,
        };
        if symbol.is_none() {
            return false;
        }
        let sym = self.files().sym(file, symbol);
        let exported = self.files().export_symbol_of_value_symbol_if_exported(sym);
        program
            .aot
            .storage
            .receiving_untyped_from_js
            .get()
            .is_some_and(|handed| handed.contains(&sym) || handed.contains(&exported))
    }

    fn is_called_with_untyped_arguments(
        &mut self,
        file: FileId,
        func: FnId,
        for_the_report: Option<bool>,
    ) -> bool {
        let program = self.p;
        if self.aot.storage.is_searching_calls {
            return true;
        }
        if program.aot.storage.untyped_argument_calls.get().is_none() {
            self.help_find_untyped_argument_calls();
        }
        let Some(called) = program.aot.storage.untyped_argument_calls.get() else {
            return false;
        };
        let (by_name, by_parameters) = if for_the_report.is_some() {
            (&called.handed_over, &called.by_parameters_as_values)
        } else {
            (&called.by_name, &called.by_parameters)
        };
        if !(by_parameters.is_empty() && called.escaping_parameter_lists.is_empty())
            && for_the_report != Some(false)
        {
            let types: Vec<TypeId> = self.hir(file)[func]
                .params
                .iter()
                .map(|p| self.type_of_param(file, p))
                .collect();
            let identities: Vec<super::Identity> =
                types.into_iter().map(|ty| self.type_identity(ty)).collect();
            if by_parameters.contains(&identities)
                || called.escaping_parameter_lists.contains(&identities)
            {
                return true;
            }
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => bound.symbol_of_declaration(Decl::Fn(func)),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                    bound.pat_symbol[hir[d].pat.idx()]
                }
                _ => return false,
            },
            _ => return false,
        };
        if symbol.is_none() {
            return false;
        }
        let sym = self.files().sym(file, symbol);
        let exported = self.files().export_symbol_of_value_symbol_if_exported(sym);
        by_name.contains(&sym) || by_name.contains(&exported)
    }

    fn help_find_untyped_argument_calls(&mut self) {
        const BATCH_SIZE: u32 = 8;
        let program = self.p;
        let storage = &program.aot.storage;
        let looking = &storage.call_searches[usize::from(self.is_warming_up())];
        let files = program.files.modules.len() as u32;
        let mut asking = None;
        let (mut looked_at, mut mine) = (0, UntypedArgumentCalls::default());
        loop {
            let first = looking
                .next_file
                .fetch_add(BATCH_SIZE, std::sync::atomic::Ordering::Relaxed)
                .min(files);
            let behind = (first + BATCH_SIZE).min(files);
            if first == behind {
                break;
            }
            let asking = asking.get_or_insert_with(|| {
                let mut asking = program.checker();
                asking.begin_task(0, 0, false);
                (asking.stack_base, asking.stack_limit) = (self.stack_base, self.stack_limit);
                asking.aot.storage.is_searching_calls = true;
                asking
            });
            let found = asking
                .during_translation(|asking| asking.find_untyped_argument_calls(first..behind));
            mine.absorb(found);
            looked_at += behind - first;
        }
        let mut all = looking.looked_at.lock();
        if looked_at != 0 || files == 0 {
            all.0 += looked_at;
            all.1.get_or_insert_with(Default::default).absorb(mine);
        }
        if all.0 == files {
            storage
                .untyped_argument_calls
                .get_or_init(|| all.1.take().expect("what was found is taken once"));
            looking.all_done.notify_all();
        }
        while storage.untyped_argument_calls.get().is_none() {
            looking.all_done.wait_guarded(&mut all);
        }
    }

    fn refers_to_function(&mut self, target: Sym) -> bool {
        match self.files().value_declaration(target) {
            Some((_, Decl::Fn(_))) => true,
            Some((of, Decl::Var(pat))) => match root_declaration(self.bound(of), pat) {
                PatParent::Var(d)
                    if self.hir(of)[d].pat == pat && self.hir(of)[d].init.is_some() =>
                {
                    matches!(self.hir(of)[self.hir(of)[d].init].kind, ExprKind::Fn(_))
                }
                _ => false,
            },
            _ => false,
        }
    }

    fn find_untyped_argument_calls(&mut self, files: std::ops::Range<u32>) -> UntypedArgumentCalls {
        let mut found: FxHashSet<Sym> = FxHashSet::default();
        let mut by_parameters: FxHashSet<Vec<super::Identity>> = FxHashSet::default();
        let mut handed_over: FxHashSet<Sym> = FxHashSet::default();
        let mut by_parameters_as_values: FxHashSet<Vec<super::Identity>> = FxHashSet::default();
        let mut escaping_parameter_lists: FxHashSet<Vec<super::Identity>> = FxHashSet::default();
        let mut visited_types: FxHashMap<TypeId, u32> = FxHashMap::default();
        for other in files.map(FileId) {
            if !self.is_compiled(other) {
                continue;
            }
            let (hir, bound) = (self.hir(other), self.bound(other));
            let is_untyped = self.is_untyped_file(other);
            for &name in self.file_exprs_by_kind(other).of(ExprTag::Ident) {
                let local = bound.expr_symbol[name.idx()];
                if local.is_none() {
                    continue;
                }
                let call = match bound.expr_parent[name.idx()] {
                    Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                        ExprKind::Call(call) if hir[call].callee == name => Some(call),
                        _ => None,
                    },
                    _ => None,
                };
                let local = self.files().sym(other, local);
                let target = if self.files().flags(local).contains(SymFlags::ALIAS) {
                    self.files().resolve_alias(local)
                } else {
                    Some(local)
                };
                let Some(target) = target else { continue };
                if self.is_untyped_file(target.file)
                    || handed_over.contains(&target)
                    || call.is_some() && !is_untyped && found.contains(&target)
                {
                    continue;
                }
                if call.is_none() && !is_untyped {
                    let refers_to_function = self.refers_to_function(target);
                    if refers_to_function {
                        self.prepare_enclosing(other, name);
                        if self.flows_into_untyped_slot(other, name)
                            || self.is_passed_to_host(other, name)
                        {
                            found.insert(target);
                            handed_over.insert(target);
                        }
                    }
                    continue;
                }
                let is_uninformative = is_untyped
                    || call.is_some_and(|call| {
                        hir.ids(hir[call].args).any(|argument| {
                            self.prepare_enclosing(other, argument);
                            let given = self.type_of_expr(other, argument);
                            given.is_any()
                        })
                    });
                if is_uninformative {
                    found.insert(target);
                }
                if is_untyped {
                    handed_over.insert(target);
                }
            }
            if is_untyped {
                continue;
            }
            if self.files().module(other).builtin.is_none() {
                let index = self.file_exprs_by_kind(other);
                let mut escaping: Vec<ExprId> = Vec::new();
                for &e in index
                    .of(ExprTag::Call)
                    .iter()
                    .chain(index.of(ExprTag::New))
                    .chain(index.of(ExprTag::As))
                    .chain(index.of(ExprTag::Assign))
                {
                    match hir[e].kind {
                        ExprKind::Call(call) | ExprKind::New(call) => {
                            escaping.extend(hir.ids(hir[call].args))
                        }
                        ExprKind::As { expr, .. } => escaping.push(expr),
                        ExprKind::Assign {
                            op: None, value, ..
                        } => escaping.push(value),
                        _ => {}
                    }
                }
                escaping.extend(
                    (0..hir.var_decls.len() as u32)
                        .map(VarDeclId)
                        .filter(|&d| hir[d].ty.is_some() && hir[d].init.is_some())
                        .map(|d| hir[d].init),
                );
                for e in escaping {
                    if matches!(
                        hir[e].kind,
                        ExprKind::Fn(_)
                            | ExprKind::Number(_)
                            | ExprKind::String(_)
                            | ExprKind::Template { .. }
                            | ExprKind::True
                            | ExprKind::False
                            | ExprKind::Null
                            | ExprKind::Spread(_)
                    ) {
                        continue;
                    }
                    self.prepare_enclosing(other, e);
                    let given = self.type_of_expr(other, e);
                    if self.is_uninformative(given)
                        || visited_types.get(&given) == Some(&3)
                        || self
                            .every_type(given, |c, part| c.is_primitive(part) || c.is_nullish(part))
                    {
                        continue;
                    }
                    self.aot.storage.is_cross_file_query = true;
                    let escapes =
                        self.flows_into_untyped_slot(other, e) || self.is_passed_to_host(other, e);
                    self.aot.storage.is_cross_file_query = false;
                    if escapes {
                        self.collect_function_parameter_lists(
                            given,
                            3,
                            &mut visited_types,
                            &mut escaping_parameter_lists,
                        );
                    }
                }
            }
            for &e in self.file_exprs_by_kind(other).of(ExprTag::Call) {
                let ExprKind::Call(call) = hir[e].kind else {
                    continue;
                };
                let callee = hir[call].callee;
                if matches!(hir[callee].kind, ExprKind::Super | ExprKind::Fn(_)) {
                    continue;
                }
                let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                if arguments.is_empty()
                    || arguments
                        .iter()
                        .any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
                {
                    continue;
                }
                let may_be_any = |argument: ExprId| {
                    !matches!(
                        hir[argument].kind,
                        ExprKind::Fn(_)
                            | ExprKind::Object(_)
                            | ExprKind::Array(_)
                            | ExprKind::Number(_)
                            | ExprKind::String(_)
                            | ExprKind::Template { .. }
                            | ExprKind::True
                            | ExprKind::False
                            | ExprKind::Null
                            | ExprKind::This
                    )
                };
                if !arguments.iter().any(|&argument| may_be_any(argument)) {
                    continue;
                }
                self.prepare_enclosing(other, e);
                if !arguments.iter().any(|&argument| {
                    may_be_any(argument) && self.type_of_expr(other, argument).is_any()
                }) {
                    continue;
                }
                let local = bound.expr_symbol[callee.idx()];
                let is_by_name =
                    matches!(hir[callee].kind, ExprKind::Ident(_)) && local.is_some() && {
                        let local = self.files().sym(other, local);
                        let target = if self.files().flags(local).contains(SymFlags::ALIAS) {
                            self.files().resolve_alias(local)
                        } else {
                            Some(local)
                        };
                        target.is_some_and(|target| self.refers_to_function(target))
                    };
                let called = self.type_of_expr(other, callee);
                for &part in self.parts(called) {
                    for &sig in self.signatures(part, false).iter() {
                        let types: Vec<TypeId> = self
                            .sig_params(sig)
                            .iter()
                            .map(|parameter| parameter.ty)
                            .collect();
                        if !types.is_empty() && !types.iter().all(|&ty| self.is_uninformative(ty)) {
                            let identities: Vec<super::Identity> =
                                types.into_iter().map(|ty| self.type_identity(ty)).collect();
                            if !is_by_name {
                                by_parameters_as_values.insert(identities.clone());
                            }
                            by_parameters.insert(identities);
                        }
                    }
                }
            }
        }
        UntypedArgumentCalls {
            by_name: found,
            by_parameters,
            handed_over,
            by_parameters_as_values,
            escaping_parameter_lists,
        }
    }

    fn collect_function_parameter_lists(
        &mut self,
        ty: TypeId,
        depth: u32,
        seen: &mut FxHashMap<TypeId, u32>,
        found: &mut FxHashSet<Vec<super::Identity>>,
    ) {
        if self.is_uninformative(ty)
            || seen
                .get(&ty)
                .is_some_and(|&visited_depth| visited_depth >= depth)
        {
            return;
        }
        seen.insert(ty, depth);
        for &part in self.parts(ty) {
            if self.is_primitive(part) || self.is_nullish(part) || self.is_instance_type(part) {
                continue;
            }
            let signatures: Vec<crate::types::SigId> =
                self.signatures(part, false).iter().copied().collect();
            for &sig in &signatures {
                let types: Vec<TypeId> = self
                    .sig_params(sig)
                    .iter()
                    .map(|parameter| parameter.ty)
                    .collect();
                if !types.is_empty() && !types.iter().all(|&ty| self.is_uninformative(ty)) {
                    found.insert(types.into_iter().map(|ty| self.type_identity(ty)).collect());
                }
                if depth != 0 {
                    let returned = self.sig_return(sig);
                    self.collect_function_parameter_lists(returned, depth - 1, seen, found);
                }
            }
            if depth == 0 {
                continue;
            }
            if matches!(
                self.data(part),
                TypeData::Ref { .. } | TypeData::Tuple { .. }
            ) {
                for &argument in self.type_arguments(part) {
                    self.collect_function_parameter_lists(argument, depth - 1, seen, found);
                }
            } else if signatures.is_empty() && self.is_object_type(part) {
                let Some(members) = self.members(part) else {
                    continue;
                };
                for prop in members.shape().props.iter() {
                    let member_type = self.type_of_prop(prop, members.mapper);
                    self.collect_function_parameter_lists(member_type, depth - 1, seen, found);
                }
            }
        }
    }

    fn find_functions_receiving_untyped_from_js(&mut self) -> FxHashSet<Sym> {
        let mut found: FxHashSet<Sym> = FxHashSet::default();
        for other in (0..self.files().modules.len() as u32).map(FileId) {
            if !self.is_compiled(other) || !self.is_untyped_file(other) {
                continue;
            }
            let (hir, bound) = (self.hir(other), self.bound(other));
            for &name in self.file_exprs_by_kind(other).of(ExprTag::Ident) {
                let local = bound.expr_symbol[name.idx()];
                if local.is_none() {
                    continue;
                }
                let local = self.files().sym(other, local);
                if !self.files().flags(local).contains(SymFlags::ALIAS) {
                    continue;
                }
                let Some(target) = self.files().resolve_alias(local) else {
                    continue;
                };
                if self.is_untyped_file(target.file) || found.contains(&target) {
                    continue;
                }
                let declared = match self.files().value_declaration(target) {
                    Some((of, Decl::Fn(func))) => Some((of, func)),
                    Some((of, Decl::Var(pat))) => match root_declaration(self.bound(of), pat) {
                        PatParent::Var(d)
                            if self.hir(of)[d].pat == pat && self.hir(of)[d].init.is_some() =>
                        {
                            match self.hir(of)[self.hir(of)[d].init].kind {
                                ExprKind::Fn(func) => Some((of, func)),
                                _ => None,
                            }
                        }
                        _ => None,
                    },
                    _ => None,
                };
                let Some((of, func)) = declared else { continue };
                if !self.is_compiled(of) {
                    continue;
                }
                let call = match bound.expr_parent[name.idx()] {
                    Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                        ExprKind::Call(call) if hir[call].callee == name => Some(call),
                        _ => None,
                    },
                    _ => None,
                };
                let receives_untyped_objects = match call {
                    None => true,
                    Some(call) => {
                        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                        arguments
                            .iter()
                            .any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
                            || self
                                .object_parameter_indices(of, func)
                                .into_iter()
                                .any(|place| {
                                    arguments.get(place).is_some_and(|&argument| {
                                        !matches!(
                                            hir[argument].kind,
                                            ExprKind::Object(_)
                                                | ExprKind::Array(_)
                                                | ExprKind::Fn(_)
                                                | ExprKind::Null
                                        )
                                    })
                                })
                    }
                };
                if receives_untyped_objects {
                    found.insert(target);
                }
            }
        }
        found
    }

    pub fn function_escapes(&mut self, file: FileId, func: FnId) -> bool {
        if let Some(&known) = self.aot.storage.escaped.get(&(file, func)) {
            return known;
        }
        let found = self.compute_function_escapes(file, func);
        self.aot.storage.escaped.insert((file, func), found);
        found
    }

    fn compute_function_escapes(&mut self, file: FileId, func: FnId) -> bool {
        let bound = self.bound(file);
        if self.is_untyped_file(file) {
            return false;
        }
        let mentions: Vec<ExprId> = match bound.fns[func.idx()].owner {
            FnOwner::Expr(e) => {
                let named = self.function_name_symbol(file, func);
                std::iter::once(e)
                    .chain(self.symbol_mentions(file, named))
                    .collect()
            }
            FnOwner::Stmt(_) => {
                self.symbol_mentions(file, bound.symbol_of_declaration(Decl::Fn(func)))
            }
            _ => return false,
        };
        mentions
            .into_iter()
            .any(|mention| self.flows_into_untyped_slot(file, mention))
    }

    fn symbol_mentions(&mut self, file: FileId, symbol: SymbolId) -> Vec<ExprId> {
        if symbol.is_none() {
            return Vec::new();
        }
        let program = self.p;
        let (ends, mentions) =
            program
                .aot
                .storage
                .mentions
                .get_or_init(program.files.modules.len(), file, || {
                    let bound = self.bound(file);
                    let names = self.file_exprs_by_kind(file).of(ExprTag::Ident);
                    let mut ends: Vec<u32> = vec![0; bound.symbols.len() + 1];
                    for &name in names {
                        let named = bound.expr_symbol[name.idx()];
                        if named.is_some() {
                            ends[named.idx()] += 1;
                        }
                    }
                    let mut so_far = 0;
                    for end in ends.iter_mut() {
                        so_far += std::mem::replace(end, so_far);
                    }
                    let mut mentions: Vec<ExprId> = vec![ExprId::NONE; so_far as usize];
                    for &name in names {
                        let named = bound.expr_symbol[name.idx()];
                        if named.is_some() {
                            mentions[ends[named.idx()] as usize] = name;
                            ends[named.idx()] += 1;
                        }
                    }
                    (ends, mentions)
                });
        let Some(&to) = ends.get(symbol.idx()) else {
            return Vec::new();
        };
        let from = if symbol.idx() == 0 {
            0
        } else {
            ends[symbol.idx() - 1]
        };
        mentions[from as usize..to as usize].to_vec()
    }

    fn flows_into_untyped_slot(&mut self, file: FileId, mut e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let parent = match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => parent,
                Parent::VarInit(d) if hir[d].ty.is_some() => {
                    let written = self.type_from_node(file, hir[d].ty);
                    return self.is_uninformative(written);
                }
                Parent::VarInit(d)
                    if matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
                        && matches!(hir[e].kind, ExprKind::Fn(_)) =>
                {
                    let mentions = self.symbol_mentions(file, bound.pat_symbol[hir[d].pat.idx()]);
                    return mentions
                        .into_iter()
                        .any(|mention| self.flows_into_untyped_slot(file, mention));
                }
                Parent::Stmt(stmt) if stmt.is_some() => {
                    return matches!(hir[stmt].kind, StmtKind::Throw(_));
                }
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Call(call) | ExprKind::New(call) => {
                    if hir[call].callee == e {
                        return false;
                    }
                    if self.aot.storage.is_cross_file_query
                        && !hir
                            .ids(hir[call].args)
                            .any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
                    {
                        let Some(index) =
                            hir.ids(hir[call].args).position(|argument| argument == e)
                        else {
                            return false;
                        };
                        let called = self.type_of_expr(file, hir[call].callee);
                        if self.is_uninformative(called) {
                            return true;
                        }
                        let is_constructed = matches!(hir[parent].kind, ExprKind::New(_));
                        for &part in self.parts(called) {
                            for &sig in self.signatures(part, is_constructed).iter() {
                                let parameters = self.sig_params(sig);
                                if self
                                    .param_type_at(&parameters, index)
                                    .is_some_and(|taking| self.is_uninformative(taking))
                                {
                                    return true;
                                }
                            }
                        }
                        return false;
                    }
                    self.prepare_enclosing(file, e);
                    return self
                        .contextual_type(file, e, ContextFlags::empty())
                        .is_none_or(|expected| self.is_uninformative(expected));
                }
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if value == e => {
                    let held = self.type_of_expr(file, target);
                    return self.is_uninformative(held);
                }
                ExprKind::As { .. } => {
                    let seen_as = self.type_of_expr(file, parent);
                    if self.is_uninformative(seen_as) {
                        return true;
                    }
                }
                ExprKind::Array(_) | ExprKind::NonNull(_) | ExprKind::Satisfies { .. } => {}
                ExprKind::Cond { test, .. } if test != e => {}
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    right,
                    ..
                } if right == e => {}
                _ => return false,
            }
            e = parent;
        }
    }

    fn is_this_predicted(&mut self, file: FileId, func: FnId) -> bool {
        self.hir(file)[func].this_param.is_none()
            && (self.is_host_callback(file, func)
                || self.is_member_of_literal_typed_any(file, func)
                || self.is_member_of_plain_literal(file, func))
    }

    fn is_member_of_plain_literal(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Expr(member) = bound.fns[func.idx()].owner else {
            return false;
        };
        let Parent::Prop(prop) = bound.expr_parent[member.idx()] else {
            return false;
        };
        let literal = bound.prop_owner[prop.idx()];
        if literal.is_none() {
            return false;
        }
        let ExprKind::Object(props) = hir[literal].kind else {
            return false;
        };
        let has_accessor = props
            .iter()
            .any(|p| matches!(hir[p].kind, PropKind::Getter | PropKind::Setter));
        let is_plain = props.iter().all(|p| hir[p].kind != PropKind::Spread && matches!(hir[p].key, PropKey::Name(name) if self.atoms().bytes(name) != b"__proto__"));
        has_accessor && (!is_plain || !self.initializes_member_of_inferred_type(file, literal))
            || self.is_object_assign_target_literal(file, literal)
            || self.is_copy_source_only(file, literal)
    }

    pub fn initializes_member_of_inferred_type(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) => parent,
                Parent::Prop(prop) if bound.prop_owner[prop.idx()].is_some() => {
                    bound.prop_owner[prop.idx()]
                }
                Parent::MemberInit(member) => return hir[member].ty.is_none(),
                _ => return false,
            };
        }
    }

    pub fn is_object_assign_target_literal(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        if !matches!(hir[e].kind, ExprKind::Object(_)) {
            return false;
        }
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else {
            return false;
        };
        matches!(hir[parent].kind, ExprKind::Call(call) if hir.ids(hir[call].args).next() == Some(e))
            && self.is_overlay_onto_first_argument(file, parent)
    }

    pub fn is_copy_source_only(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            let parent = match bound.expr_parent[at.idx()] {
                Parent::Prop(prop) => return hir[prop].kind == PropKind::Spread,
                Parent::Expr(parent) => parent,
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    ..
                } => {}
                ExprKind::Cond { test, .. } if test != at => {}
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } if right == at => {}
                ExprKind::Call(call) => {
                    let place = hir.ids(hir[call].args).position(|argument| argument == at);
                    return place.is_some_and(|place| place > 0)
                        && self.is_object_assign(file, parent)
                        || place == Some(0)
                            && self.is_library_call(
                                file,
                                parent,
                                b"ObjectConstructor",
                                &[b"create"],
                            )
                        || place == Some(1)
                            && self.is_library_call(
                                file,
                                parent,
                                b"ObjectConstructor",
                                &[b"setPrototypeOf"],
                            );
                }
                _ => return false,
            }
            at = parent;
        }
    }

    fn is_member_of_literal_typed_any(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Expr(member) = bound.fns[func.idx()].owner else {
            return false;
        };
        let Parent::Prop(prop) = bound.expr_parent[member.idx()] else {
            return false;
        };
        let literal = bound.prop_owner[prop.idx()];
        literal.is_some()
            && matches!(hir[literal].kind, ExprKind::Object(_))
            && self.is_inside_any_context(file, literal)
    }

    pub fn record_literal_allocation_type(&mut self, file: FileId, e: ExprId, created: TypeId) {
        if !matches!(self.data(created), TypeData::Synth(_))
            || self.is_coercion_result_type(created)
        {
            return;
        }
        let own = self.type_of_expr(file, e);
        let own = self.layout_defining_type(own);
        if own != created {
            self.record_upcast(created, own);
        }
    }

    pub fn is_synthesized_type(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Anon {
                origin:
                    crate::types::Origin::ObjectLiteral(..) | crate::types::Origin::WidenedLiteral(..),
                ..
            } => true,
            TypeData::Synth(_) => !self.is_coercion_result_type(ty),
            _ => false,
        }
    }

    pub(super) fn add_nested_object_literal_types(
        &mut self,
        ty: TypeId,
        found: &mut Vec<[TypeId; 3]>,
    ) {
        let (mut seen, mut pending, mut budget) = (FxHashSet::default(), vec![ty], 256);
        while let Some(ty) = pending.pop() {
            for &part in self.parts(ty) {
                if budget == 0 || !seen.insert(part) {
                    continue;
                }
                budget -= 1;
                if let Some(element) = self.array_element(part) {
                    pending.push(element);
                    continue;
                }
                let created = match *self.data(part) {
                    TypeData::Anon {
                        origin:
                            crate::types::Origin::ObjectLiteral(file, literal, ..)
                            | crate::types::Origin::WidenedLiteral(file, literal, ..),
                        ..
                    } => self.type_of_expr(file, literal),
                    TypeData::Synth(_) if !self.is_coercion_result_type(part) => part,
                    _ => continue,
                };
                let Some(members) = self.members(part) else {
                    continue;
                };
                if members.shape().props.len() > 1024 {
                    continue;
                }
                found.push([part, self.layout_defining_type(part), created]);
                pending.push(created);
                for prop in members.shape().props.iter() {
                    pending.push(self.type_of_prop(prop, members.mapper));
                }
            }
        }
    }

    pub fn is_passed_directly_to_any(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut outermost = e;
        loop {
            let around = match bound.expr_parent[outermost.idx()] {
                Parent::Prop(prop) if bound.prop_owner[prop.idx()].is_some() => {
                    bound.prop_owner[prop.idx()]
                }
                Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Array(_)) => parent,
                _ => break,
            };
            if self
                .contextual_type_of_literal(file, outermost)
                .is_some_and(|expected| self.is_any_like(expected))
            {
                return true;
            }
            outermost = around;
        }
        self.contextual_type_of_literal(file, outermost)
            .is_some_and(|expected| self.is_any_like(expected))
    }

    pub fn is_inside_any_context(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut outermost = e;
        loop {
            outermost = match bound.expr_parent[outermost.idx()] {
                Parent::Prop(prop) if bound.prop_owner[prop.idx()].is_some() => {
                    bound.prop_owner[prop.idx()]
                }
                Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Array(_)) => parent,
                Parent::Expr(parent)
                    if matches!(hir[parent].kind, ExprKind::Call(_))
                        && (self.returned_argument_of(file, parent) == Some(outermost)
                            || self.returned_argument_of_function(file, parent)
                                == Some(outermost)) =>
                {
                    parent
                }
                _ => break,
            };
        }
        let outer = match bound.expr_parent[outermost.idx()] {
            Parent::VarInit(decl) if hir[decl].ty.is_some() => {
                self.contextual_type_of_literal(file, outermost)
            }
            Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::As { .. }) => {
                Some(self.type_of_expr(file, parent))
            }
            _ => None,
        };
        outer.is_some_and(|ty| self.is_any(ty))
    }

    fn this_container_fn(&self, file: FileId, e: ExprId) -> Option<FnId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            let func = match self.enclosing_site(file, parent)? {
                Site::Body(func) => func,
                Site::Parameter(p) => bound.param_fn[p.idx()],
                Site::File | Site::Initializer(_) => return None,
            };
            if func.is_none() {
                return None;
            }
            if hir[func].kind != FnKind::Arrow {
                return Some(func);
            }
            let FnOwner::Expr(arrow) = bound.fns[func.idx()].owner else {
                return None;
            };
            parent = bound.expr_parent[arrow.idx()];
        }
    }

    pub fn fn_this_type(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        if self.is_this_predicted(file, func) || !self.uses_this(file, func) {
            None
        } else {
            self.this_type_in_fn(file, func)
        }
    }

    pub fn accepts_nullish(&self, ty: TypeId) -> bool {
        !self.p.files.options.strict_null_checks && !ty.is_never()
    }

    pub fn is_annotated(&mut self, sym: Sym) -> bool {
        let Some((file, decl)) = self.files().value_declaration(sym) else {
            return false;
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        match decl {
            Decl::Var(pat) => {
                matches!(root_declaration(bound, pat), PatParent::Var(d) if hir[d].ty.is_some())
            }
            Decl::Param(pat) => match root_declaration(bound, pat) {
                PatParent::Param(p) => self.is_param_annotated(file, p),
                _ => false,
            },
            Decl::Member(m) => hir[m].ty.is_some(),
            Decl::ParameterProperty(p) => hir[p].ty.is_some(),
            _ => false,
        }
    }

    pub fn is_param_annotated(&mut self, file: FileId, p: ParamId) -> bool {
        let hir = self.hir(file);
        if hir[p].ty.is_some() {
            return true;
        }
        let func = self.bound(file).param_fn[p.idx()];
        if func.is_none() || !hir[func].params.range().contains(&p.idx()) {
            return false;
        }
        let index = p.idx() - hir[func].params.start as usize;
        hir[func].kind != FnKind::Setter
            && !self.is_immediately_invoked(file, func)
            && (!self.is_host_callback(file, func)
                || self.is_callback_param_checked_at_entry(file, func, p))
            && self.contextual_param_type(file, func, index).is_some()
    }

    pub fn is_prop_annotated(&mut self, prop: &Prop) -> bool {
        match &prop.source {
            PropSource::Symbol(sym) => self.is_annotated(*sym),
            PropSource::Mapped(..) => true,
            PropSource::Intersected(_, parts) | PropSource::Copy(_, parts, _) => {
                !parts.is_empty() && parts.iter().all(|part| self.is_prop_annotated(part))
            }
            PropSource::Type(_) | PropSource::Literal(..) | PropSource::ReverseMapped(..) => false,
        }
    }

    pub fn fn_result_type(&mut self, file: FileId, func: FnId) -> (TypeId, bool) {
        if let Some(&known) = self.aot.storage.results.get(&(file, func)) {
            return known;
        }
        if let Some(assumed) = self.assumption(Query::Result(file, func)) {
            return (TypeId(assumed as u32), false);
        }
        let f = &self.hir(file)[func];
        let inferred = self.return_type_of_fn(file, func);
        if f.ret.is_none() && f.flags.contains(Flags::ASYNC) && !f.flags.contains(Flags::GENERATOR)
        {
            let open = self.promise_of(TypeId::UNKNOWN);
            let (found, is_final) = self.solve(
                Query::Result(file, func),
                u64::from(inferred.0),
                u64::from(open.0),
                |c| u64::from(c.find_async_fn_result_type(file, func, inferred).0),
            );
            let found = (TypeId(found as u32), false);
            if is_final {
                self.aot.storage.results.insert((file, func), found);
            }
            return found;
        }
        if f.ret.is_some() || f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return (inferred, f.ret.is_some());
        }
        if self.is_host_callback(file, func) {
            return (TypeId::UNKNOWN, true);
        }
        self.prepare_fn(file, func);
        let is_part = matches!(self.bound(file).fns[func.idx()].owner, FnOwner::Expr(written) if self.is_spread_part(file, written));
        if !is_part
            && !self.is_called_for_assignment_pattern(file, func)
            && !self.is_callback_typed_by_own_prediction(file, func)
            && !self.contextual_signature(file, func).is_some_and(|signature| matches!(self.types().sig(signature), crate::types::SigData::Synth { of, is_union: false, .. } if of.len() > 1))
            && let Some(expected) = self.declared_or_contextual_return_type(file, func, ContextFlags::SKIP_BINDING_PATTERNS)
            && !expected.is_never()
            && expected != TypeId::UNRESOLVED
            && !self.is_instantiable(expected)
            && !(self.some_type(expected, |c, part| c.is_primitive(part)) && (self.is_immediately_invoked(file, func) || self.receives_unknown_elements(file, func)))
        {
            return (self.without_number_literals_deep(expected), true);
        }
        let (found, is_final) = self.solve(
            Query::Result(file, func),
            u64::from(inferred.0),
            u64::from(TypeId::UNKNOWN.0),
            |c| u64::from(c.find_fn_result_type(file, func, inferred).0),
        );
        let found = (TypeId(found as u32), false);
        if is_final {
            self.aot.storage.results.insert((file, func), found);
        }
        found
    }

    pub(super) fn is_callback_typed_by_own_prediction(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if f.ret.is_some() || f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return false;
        }
        let FnOwner::Expr(written) = bound.fns[func.idx()].owner else {
            return false;
        };
        let Parent::Expr(parent) = bound.expr_parent[written.idx()] else {
            return false;
        };
        let ExprKind::Call(call) = hir[parent].kind else {
            return false;
        };
        if hir[call].callee == written || !hir[call].type_args.is_empty() {
            return false;
        }
        let of_statements =
            bound
                .ids(bound.fns[func.idx()].returns)
                .filter_map(|stmt| match hir[stmt].kind {
                    StmtKind::Return(value) if value.is_some() => Some(value),
                    _ => None,
                });
        let of_body = match f.body {
            FnBody::Expr(value) => Some(value),
            _ => None,
        };
        if !of_body
            .into_iter()
            .chain(of_statements)
            .any(|value| self.is_predicted(file, value))
        {
            return false;
        }
        let Some((called_in, called, _)) = self
            .resolved_signature(file, parent)
            .sig
            .and_then(|sig| self.sig_decl(sig))
        else {
            return false;
        };
        let Some(context) = self.contextual_signature(file, func) else {
            return false;
        };
        let Some((declared_in, declared, _)) = self.sig_decl(context) else {
            return false;
        };
        self.files.module(declared_in).is_lib
            || !self.hir(called_in)[called].type_params.is_empty()
                && self.return_type_of_fn(declared_in, declared) != self.sig_return(context)
    }

    fn is_called_for_assignment_pattern(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Expr(mut produced) = bound.fns[func.idx()].owner else {
            return false;
        };
        loop {
            let Parent::Expr(parent) = bound.expr_parent[produced.idx()] else {
                return false;
            };
            match hir[parent].kind {
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if value == produced => {
                    return matches!(hir[target].kind, ExprKind::Array(_) | ExprKind::Object(_));
                }
                ExprKind::Call(call) if hir[call].callee == produced => {}
                ExprKind::Await(_)
                | ExprKind::NonNull(_)
                | ExprKind::Satisfies { .. }
                | ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    ..
                } => {}
                ExprKind::Cond { yes, no, .. } if yes == produced || no == produced => {}
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    right,
                    ..
                } if right == produced => {}
                _ => return false,
            }
            produced = parent;
        }
    }

    fn find_async_fn_result_type(&mut self, file: FileId, func: FnId, inferred: TypeId) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of_statements =
            bound
                .ids(bound.fns[func.idx()].returns)
                .filter_map(|stmt| match hir[stmt].kind {
                    StmtKind::Return(value) if value.is_some() => Some(value),
                    _ => None,
                });
        let of_body = match hir[func].body {
            FnBody::Expr(value) => Some(value),
            _ => None,
        };
        let returned: Vec<ExprId> = of_body.into_iter().chain(of_statements).collect();
        let mut parts = Vec::new();
        for value in returned {
            if !self.has_propagated_type(file, value) {
                let forwarded = self.propagated_type(file, value);
                parts.push(self.awaited(forwarded));
            }
        }
        if parts.is_empty() {
            return inferred;
        }
        parts.push(self.awaited(inferred));
        let promised = self.union(&parts);
        self.promise_of(promised)
    }

    fn find_fn_result_type(&mut self, file: FileId, func: FnId, inferred: TypeId) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        let mut parts = vec![inferred];
        let of_statements =
            bound
                .ids(bound.fns[func.idx()].returns)
                .filter_map(|stmt| match hir[stmt].kind {
                    StmtKind::Return(value) if value.is_some() => Some(value),
                    _ => None,
                });
        let of_body = match f.body {
            FnBody::Expr(value) => Some(value),
            _ => None,
        };
        for value in of_body.into_iter().chain(of_statements) {
            if !self.has_propagated_type(file, value) {
                parts.push(self.propagated_type(file, value));
            }
        }
        if parts.len() == 1 {
            inferred
        } else {
            self.union(&parts)
        }
    }

    pub fn is_call_result_annotated(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return false;
        };
        if !hir[call].type_args.is_empty() {
            return true;
        }
        let Some(sig) = self.resolved_signature(file, e).sig else {
            return false;
        };
        let Some((declared_in, func, _)) = self.sig_decl(sig) else {
            return false;
        };
        let of = self.hir(declared_in);
        if self.is_untyped_file(declared_in)
            || !self.is_compiled(declared_in)
            || of[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR)
        {
            return false;
        }
        let (declared, is_annotated) = self.fn_result_type(declared_in, func);
        is_annotated && declared != self.sig_return(sig)
    }

    pub fn overload_implementation_result(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let sig = self.resolved_signature(file, e).sig?;
        let (declared_in, func, _) = self.sig_decl(sig)?;
        if !matches!(self.hir(declared_in)[func].body, FnBody::None) {
            return None;
        }
        let (implemented_in, implementation) = self.implementation_for(declared_in, func)?;
        if self.is_untyped_file(implemented_in) || !self.is_compiled(implemented_in) {
            return None;
        }
        Some(self.return_type_of_fn(implemented_in, implementation))
    }

    pub fn generic_call_allocation(&mut self, file: FileId, e: ExprId) -> Option<FreshGraph> {
        if !matches!(self.hir(file)[e].kind, ExprKind::Call(_)) {
            return None;
        }
        let sig = self.resolved_signature(file, e).sig?;
        let (declared_in, func, _) = self.sig_decl(sig)?;
        if self.return_type_of_fn(declared_in, func) == self.sig_return(sig) {
            return None;
        }
        self.function_allocation(declared_in, func, &mut InspectedCast::default())
    }

    fn function_allocation(
        &mut self,
        file: FileId,
        func: FnId,
        looked_at: &mut InspectedCast,
    ) -> Option<FreshGraph> {
        let (file, func) = if matches!(self.hir(file)[func].body, FnBody::None) {
            self.implementation_for(file, func).unwrap_or((file, func))
        } else {
            (file, func)
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        if self.is_untyped_file(file)
            || !self.is_compiled(file)
            || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR)
        {
            return None;
        }
        if let Some(known) = looked_at
            .functions
            .iter()
            .find(|known| known.0 == (file, func))
        {
            return known.1.clone();
        }
        looked_at.functions.push(((file, func), None));
        let returned: Vec<ExprId> = match hir[func].body {
            FnBody::None => Vec::new(),
            FnBody::Expr(body) => vec![body],
            FnBody::Block(_) => bound
                .ids(bound.fns[func.idx()].returns)
                .filter_map(|stmt: StmtId| {
                    if let StmtKind::Return(value) = hir[stmt].kind {
                        Some(value)
                    } else {
                        None
                    }
                })
                .collect(),
        };
        let mut created = None;
        for value in returned {
            if value.is_some() {
                let produced = self.expr_allocation(file, value, looked_at);
                join_created(&mut created, produced);
            }
        }
        if let Some(known) = looked_at
            .functions
            .iter_mut()
            .find(|known| known.0 == (file, func))
        {
            known.1.clone_from(&created);
        }
        created
    }

    pub fn returns_fresh_call_result(&mut self, file: FileId, e: ExprId) -> bool {
        matches!(self.hir(file)[e].kind, ExprKind::Call(_))
            && self.is_freshly_allocated_by(file, e, &mut Vec::new())
    }

    fn is_freshly_allocated_by(
        &mut self,
        file: FileId,
        e: ExprId,
        within: &mut Vec<(FileId, FnId)>,
    ) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Object(props) => {
                let hir = self.hir(file);
                props.iter().all(|p| {
                    matches!(
                        hir[p].kind,
                        PropKind::Init | PropKind::Shorthand | PropKind::Spread
                    )
                })
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr)
            | ExprKind::AsConst(expr) => self.is_freshly_allocated_by(file, expr, within),
            ExprKind::Cond { yes, no, .. } => {
                self.is_freshly_allocated_by(file, yes, within)
                    && self.is_freshly_allocated_by(file, no, within)
            }
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.is_freshly_allocated_by(file, right, within),
            ExprKind::Call(_) => {
                let Some(sig) = self.resolved_signature(file, e).sig else {
                    return false;
                };
                let Some((of, func, _)) = self.sig_decl(sig) else {
                    return false;
                };
                let (of, func) = if matches!(self.hir(of)[func].body, FnBody::None) {
                    self.implementation_for(of, func).unwrap_or((of, func))
                } else {
                    (of, func)
                };
                let (hir, bound) = (self.hir(of), self.bound(of));
                if !self.is_compiled(of)
                    || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR)
                    || within.len() == 4
                    || within.contains(&(of, func))
                {
                    return false;
                }
                let returned: Vec<ExprId> = match hir[func].body {
                    FnBody::None => Vec::new(),
                    FnBody::Expr(body) => vec![body],
                    FnBody::Block(_) => bound
                        .ids(bound.fns[func.idx()].returns)
                        .filter_map(|stmt: StmtId| {
                            if let StmtKind::Return(value) = hir[stmt].kind {
                                Some(value)
                            } else {
                                None
                            }
                        })
                        .collect(),
                };
                within.push((of, func));
                let is_made = !returned.is_empty()
                    && returned.into_iter().all(|value| {
                        value.is_some() && self.is_freshly_allocated_by(of, value, within)
                    });
                within.pop();
                is_made
            }
            _ => false,
        }
    }

    fn either_allocation(
        &mut self,
        file: FileId,
        one: ExprId,
        other: ExprId,
        looked_at: &mut InspectedCast,
    ) -> Option<FreshGraph> {
        let mut created = self.expr_allocation(file, one, looked_at);
        let produced = self.expr_allocation(file, other, looked_at);
        join_created(&mut created, produced);
        created
    }

    fn expr_allocation(
        &mut self,
        file: FileId,
        e: ExprId,
        looked_at: &mut InspectedCast,
    ) -> Option<FreshGraph> {
        match self.hir(file)[e].kind {
            ExprKind::Object(props) => {
                let hir = self.hir(file);
                let props: Vec<(PropKind, PropKey, ExprId)> = props
                    .iter()
                    .map(|p| (hir[p].kind, hir[p].key, hir[p].value))
                    .collect();
                let mut created = FreshGraph::object();
                for (kind, key, value) in props {
                    if !matches!(
                        kind,
                        PropKind::Init | PropKind::Shorthand | PropKind::Spread
                    ) {
                        continue;
                    }
                    let Some(held) = self.expr_allocation(file, value, looked_at) else {
                        continue;
                    };
                    created.join(match (kind, key) {
                        (PropKind::Spread, _) => held.named_contents(),
                        (_, PropKey::Name(name)) => FreshGraph {
                            within: vec![(name, held)],
                            ..FreshGraph::default()
                        },
                        _ => FreshGraph {
                            anywhere: Some(Box::new(held)),
                            ..FreshGraph::default()
                        },
                    });
                }
                Some(created)
            }
            ExprKind::New(_) if self.creates_proxy(file, e) => Some(FreshGraph::object()),
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr)
            | ExprKind::AsConst(expr) => self.expr_allocation(file, expr, looked_at),
            ExprKind::Cond { yes, no, .. } => self.either_allocation(file, yes, no, looked_at),
            ExprKind::Binary {
                op: BinOp::Or | BinOp::And | BinOp::Nullish,
                left,
                right,
            } => self.either_allocation(file, left, right, looked_at),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            }
            | ExprKind::Assign {
                op: None,
                value: right,
                ..
            } => self.expr_allocation(file, right, looked_at),
            ExprKind::Assign {
                op: Some(BinOp::Or | BinOp::And | BinOp::Nullish),
                target,
                value,
            } => self.either_allocation(file, target, value, looked_at),
            ExprKind::Dot { obj, name, .. } => {
                let holder = self.expr_allocation(file, obj, looked_at)?;
                let mut created = holder
                    .within
                    .into_iter()
                    .find(|held| held.0 == name)
                    .map_or_else(FreshGraph::object, |held| held.1);
                if let Some(anywhere) = holder.anywhere {
                    created.join(*anywhere);
                }
                Some(created)
            }
            ExprKind::Index { obj, .. } | ExprKind::Spread(obj) => self
                .expr_allocation(file, obj, looked_at)
                .map(FreshGraph::all_contents),
            ExprKind::Array(elements) => {
                let elements: Vec<ExprId> = self.hir(file).ids(elements).collect();
                let mut of_elements = None;
                for element in elements {
                    let produced = self.expr_allocation(file, element, looked_at);
                    join_created(&mut of_elements, produced);
                }
                of_elements.map(|elements| FreshGraph {
                    elements: Some(Box::new(elements)),
                    ..FreshGraph::default()
                })
            }
            ExprKind::Ident(name) => {
                let sym = self.resolved_symbol_for(file, e, name)?;
                let Some((of, decl @ (Decl::Var(pat) | Decl::Param(pat)))) =
                    self.variable_declaration(sym)
                else {
                    return None;
                };
                let (declaring, bound) = (self.hir(of), self.bound(of));
                let first = match root_declaration(bound, pat) {
                    PatParent::Var(d) => declaring[d].init,
                    PatParent::Param(p) => declaring[p].default,
                    _ => return None,
                };
                if let Some(known) = looked_at.variables.iter().find(|known| known.0 == sym) {
                    return known.1.clone();
                }
                looked_at.variables.push((sym, None));
                let is_from_pattern = !matches!(
                    bound.pat_parent[pat.idx()],
                    PatParent::Var(_) | PatParent::Param(_)
                );
                let mut stored = vec![first];
                for &(_, target) in bound.assignments_to(bound.symbol_of_declaration(decl)) {
                    if let Some(super::integers::Store::Value(value)) =
                        self.target_store(of, target)
                    {
                        stored.push(value);
                    }
                }
                let mut created = None;
                for (index, value) in stored.into_iter().enumerate() {
                    if value.is_some() {
                        let produced = self.expr_allocation(of, value, looked_at);
                        join_created(
                            &mut created,
                            if index == 0 && is_from_pattern {
                                produced.map(FreshGraph::all_contents)
                            } else {
                                produced
                            },
                        );
                    }
                }
                if let Some(known) = looked_at.variables.iter_mut().find(|known| known.0 == sym) {
                    known.1.clone_from(&created);
                }
                created
            }
            ExprKind::Call(call) => {
                if let Some(handed_back) = self.returned_argument_of(file, e) {
                    let mut created = self.expr_allocation(file, handed_back, looked_at)?;
                    let hir = self.hir(file);
                    let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                    for argument in arguments {
                        if argument != handed_back
                            && let Some(copied) = self.expr_allocation(file, argument, looked_at)
                        {
                            created.join(copied.named_contents());
                        }
                    }
                    return Some(created);
                }
                let sig = self.resolved_signature(file, e).sig?;
                let (declared_in, func, _) = self.sig_decl(sig)?;
                self.function_allocation(declared_in, func, looked_at)
            }
            _ => None,
        }
    }

    pub fn argument_parameter_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else {
            return None;
        };
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[parent].kind else {
            return None;
        };
        let mut index = None;
        for (i, argument) in hir.ids(hir[call].args).enumerate() {
            if argument == e {
                index = Some(i);
                break;
            }
            if matches!(hir[argument].kind, ExprKind::Spread(_)) {
                return None;
            }
        }
        let index = index?;
        let sig = self.resolved_signature(file, parent).sig?;
        let (declared_in, func, _) = self.sig_decl(sig)?;
        let of = self.hir(declared_in);
        if self.is_untyped_file(declared_in)
            || !self.is_compiled(declared_in)
            || self.is_predicted(file, hir[call].callee)
        {
            return None;
        }
        if matches!(hir[e].kind, ExprKind::Object(_) | ExprKind::Array(_))
            && let Some(expected) = self.contextual_type_of_literal(file, e)
            && self.is_checked_against_inferred_type(file, e, expected)
        {
            return None;
        }
        let (sig, func) = match self.implementation_for(declared_in, func) {
            Some((_, implementation)) if implementation != func => {
                (self.sig_of_fn(declared_in, implementation), implementation)
            }
            _ => (sig, func),
        };
        let declared = of[func].params;
        let p = if index < declared.len() {
            declared.at(index)
        } else {
            declared.iter().next_back()?
        };
        if !self.is_param_annotated(declared_in, p) {
            return None;
        }
        let params = self.sig_params(sig);
        self.param_type_at(&params, index)
    }

    pub fn callee_may_have_untyped_clone(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else {
            return false;
        };
        if !matches!(hir[parent].kind, ExprKind::Call(_)) {
            return false;
        }
        let Some(sig) = self.resolved_signature(file, parent).sig else {
            return false;
        };
        let Some((declared_in, func, _)) = self.sig_decl(sig) else {
            return false;
        };
        let func = self
            .implementation_for(declared_in, func)
            .map_or(func, |(_, implementation)| implementation);
        match self.hir(declared_in)[func].kind {
            FnKind::FunctionType | FnKind::CallSignature => true,
            _ => {
                self.has_untyped_clone(declared_in, func)
                    || self.has_logging_untyped_clone(declared_in, func)
            }
        }
    }

    pub fn contextual_type_of_literal_before_bounds(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<TypeId> {
        if self.is_spread_part(file, e) {
            return None;
        }
        self.prepare_enclosing(file, e);
        let expected = self.contextual_type(file, e, ContextFlags::SKIP_BINDING_PATTERNS)?;
        Some(self.instantiate_contextual_type(
            expected,
            file,
            e,
            ContextFlags::SKIP_BINDING_PATTERNS,
        ))
    }

    pub fn copied_named_values(&mut self, file: FileId, e: ExprId) -> Vec<(FileId, Atom, ExprId)> {
        let mut found = Vec::new();
        self.add_copied_named_values(file, e, 0, &mut found);
        found
    }

    fn add_copied_named_values(
        &mut self,
        file: FileId,
        e: ExprId,
        depth: u32,
        found: &mut Vec<(FileId, Atom, ExprId)>,
    ) {
        let hir = self.hir(file);
        if depth > 4 {
            return;
        }
        match hir[e].kind {
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr)
            | ExprKind::AsConst(expr) => self.add_copied_named_values(file, expr, depth, found),
            ExprKind::Object(props) => {
                for p in props.iter() {
                    match (hir[p].kind, hir[p].key) {
                        (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) => {
                            found.push((file, name, hir[p].value))
                        }
                        (PropKind::Spread, _) => {
                            self.add_copied_named_values(file, hir[p].value, depth + 1, found)
                        }
                        _ => {}
                    }
                }
            }
            ExprKind::Ident(name) => {
                let Some(sym) = self.resolved_symbol_for(file, e, name) else {
                    return;
                };
                let Some((of, decl @ Decl::Var(pat))) = self.variable_declaration(sym) else {
                    return;
                };
                let (declaring, bound) = (self.hir(of), self.bound(of));
                let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
                    return;
                };
                if declaring[d].init.is_some()
                    && bound
                        .assignments_to(bound.symbol_of_declaration(decl))
                        .is_empty()
                {
                    self.add_copied_named_values(of, declaring[d].init, depth + 1, found);
                }
            }
            _ => {}
        }
    }

    pub fn is_object_assign(&mut self, file: FileId, e: ExprId) -> bool {
        self.is_library_call(file, e, b"ObjectConstructor", &[b"assign"])
    }

    pub fn is_function_bind(&mut self, file: FileId, e: ExprId) -> bool {
        self.is_library_call(file, e, b"CallableFunction", &[b"bind"])
    }

    pub fn is_identity_call(&mut self, file: FileId, e: ExprId) -> bool {
        self.is_library_call(
            file,
            e,
            b"ObjectConstructor",
            &[b"freeze", b"seal", b"preventExtensions"],
        )
    }

    pub fn is_array_from(&mut self, file: FileId, e: ExprId) -> bool {
        self.is_library_call(file, e, b"ArrayConstructor", &[b"from"])
    }

    pub fn is_overlay_onto_first_argument(&mut self, file: FileId, e: ExprId) -> bool {
        self.is_library_call(
            file,
            e,
            b"ObjectConstructor",
            &[
                b"assign",
                b"defineProperties",
                b"defineProperty",
                b"setPrototypeOf",
            ],
        )
    }

    pub fn redefines_literal(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return false;
        };
        hir.ids(hir[call].args)
            .next()
            .is_some_and(|first| matches!(hir[first].kind, ExprKind::Object(_)))
            && self.is_library_call(
                file,
                e,
                b"ObjectConstructor",
                &[b"defineProperties", b"defineProperty", b"setPrototypeOf"],
            )
    }

    pub fn returns_redefined_literal(&mut self, file: FileId, e: ExprId) -> bool {
        self.redefines_literal(file, e)
            || self
                .returned_argument_of(file, e)
                .is_some_and(|first| self.returns_redefined_literal(file, first))
    }

    pub fn may_be_redefined(&mut self, ty: TypeId) -> bool {
        if !self.results_are_provisional()
            && let Some(known) = self
                .shared_type_flag(ty, type_flags::REDEFINED_KNOWN, type_flags::IS_REDEFINED)
                .or_else(|| self.aot.flows.is_redefined_cache.get(&ty).copied())
        {
            return known;
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.find_may_be_redefined(ty));
        if is_cacheable
            && !self.publish_type_flag(
                ty,
                type_flags::REDEFINED_KNOWN,
                type_flags::IS_REDEFINED,
                found,
            )
        {
            self.aot.flows.is_redefined_cache.insert(ty, found);
        }
        found
    }

    fn find_may_be_redefined(&mut self, ty: TypeId) -> bool {
        let redefinitions = self.redefinitions();
        let is_of_class = self.is_instance_type(ty);
        redefinitions.iter().any(|(target, names)| {
            names.as_ref().is_none_or(|names| {
                names
                    .iter()
                    .any(|&name| self.get_property_of_type(ty, name).is_some())
            }) && (self.is_assignable(ty, *target)
                || is_of_class && self.is_assignable(*target, ty))
        })
    }

    pub(super) fn redefinition_site(&mut self, ty: TypeId) -> Option<(FileId, ExprId)> {
        if !self.may_be_redefined(ty) {
            return None;
        }
        let is_of_class = self.is_instance_type(ty);
        self.calls_that_may_redefine()
            .iter()
            .copied()
            .find(|&(file, call)| {
                let mut found = Vec::new();
                self.find_redefinition_in_call(file, call, &mut found);
                found.iter().any(|(target, names)| {
                    names.as_ref().is_none_or(|names| {
                        names
                            .iter()
                            .any(|&name| self.get_property_of_type(ty, name).is_some())
                    }) && (self.is_assignable(ty, *target)
                        || is_of_class && self.is_assignable(*target, ty))
                })
            })
    }

    fn redefinitions(&mut self) -> Rc<[Redefinition]> {
        if let Some(known) = &self.aot.storage.redefinitions {
            return Rc::clone(known);
        }
        let calls = self.calls_that_may_redefine();
        let mut found = Vec::new();
        for &(file, e) in calls {
            self.find_redefinition_in_call(file, e, &mut found);
        }
        let mut seen: FxHashSet<Redefinition> = FxHashSet::default();
        found.retain(|redefinition| seen.insert(redefinition.clone()));
        let found: Rc<[Redefinition]> = found.into();
        self.aot.storage.redefinitions = Some(Rc::clone(&found));
        found
    }

    fn proxy_constructions(&self) -> &'p [(FileId, ExprId)] {
        self.p.aot.storage.proxy_constructions.get_or_init(|| {
            let mut constructions = Vec::new();
            for file in (0..self.files().modules.len() as u32).map(FileId) {
                if !self.is_compiled(file)
                    || self.is_untyped_file(file)
                    || self.hir(file).kind == FileKind::Json
                {
                    continue;
                }
                let hir = self.hir(file);
                for &e in self.file_exprs_by_kind(file).of(ExprTag::New) {
                    if let ExprKind::New(call) = hir[e].kind
                        && let ExprKind::Ident(name) = hir[hir[call].callee].kind
                        && name.is_some()
                        && self.atoms().bytes(name) == b"Proxy"
                    {
                        constructions.push((file, e));
                    }
                }
            }
            constructions
        })
    }

    fn proxy_type_parameters(&mut self) -> Rc<[TypeId]> {
        if let Some(known) = &self.aot.storage.proxy_type_parameters {
            return Rc::clone(known);
        }
        let mut found = Vec::new();
        for &(file, e) in self.proxy_constructions() {
            if !self.creates_proxy(file, e) {
                continue;
            }
            let created = self.type_of_expr(file, e);
            let mut pending = vec![created];
            while let Some(ty) = pending.pop() {
                match self.data(ty) {
                    TypeData::Union(parts) | TypeData::Intersection(parts) => {
                        pending.extend(parts.iter().copied())
                    }
                    TypeData::TypeParam(..) if !found.contains(&ty) => found.push(ty),
                    _ => {}
                }
            }
        }
        let found: Rc<[TypeId]> = found.into();
        self.aot.storage.proxy_type_parameters = Some(Rc::clone(&found));
        found
    }

    pub fn record_type_argument_proxies(&mut self, file: FileId, e: ExprId) {
        if self.proxy_constructions().is_empty() {
            return;
        }
        let Some((.., mapper)) = self
            .resolved_signature(file, e)
            .sig
            .and_then(|sig| self.sig_decl(sig))
        else {
            return;
        };
        if mapper == MapperId::IDENTITY {
            return;
        }
        let of_proxies = self.proxy_type_parameters();
        let put_in: Vec<TypeId> = self
            .types()
            .mapping(mapper)
            .iter()
            .filter(|pair| of_proxies.contains(&pair.0))
            .map(|pair| pair.1)
            .collect();
        for argument in put_in {
            self.record_generic_function_result(&FreshGraph::object(), argument);
        }
    }

    pub fn receives_generic_proxy_factory(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[e].kind else {
            return false;
        };
        if self.proxy_constructions().is_empty() {
            return false;
        }
        let of_proxies = self.proxy_type_parameters();

        !of_proxies.is_empty()
            && hir
                .ids(hir[call].args)
                .filter(|&argument| {
                    matches!(
                        hir[argument].kind,
                        ExprKind::Ident(_) | ExprKind::Dot { .. }
                    )
                })
                .any(|argument| {
                    let handed_over = self.type_of_expr(file, argument);
                    self.signatures(handed_over, false)
                        .iter()
                        .copied()
                        .any(|own| {
                            self.sig_type_params(own)
                                .iter()
                                .any(|parameter| of_proxies.contains(parameter))
                        })
                })
    }

    pub fn record_nested_proxies(&mut self, ty: TypeId) {
        let created = FreshGraph {
            is_object: true,
            within: Vec::new(),
            anywhere: Some(Box::new(FreshGraph::object())),
            elements: Some(Box::new(FreshGraph::object())),
        };
        self.record_generic_function_result(&created, ty);
    }

    pub fn record_proxies_returned_through(&mut self, file: FileId, e: ExprId, target: TypeId) {
        if target == TypeId::UNRESOLVED
            || self.proxy_constructions().is_empty()
            || !matches!(
                self.hir(file)[e].kind,
                ExprKind::Ident(_) | ExprKind::Dot { .. }
            )
        {
            return;
        }
        let of_proxies = self.proxy_type_parameters();
        if of_proxies.is_empty() {
            return;
        }
        let handed_over = self.type_of_expr(file, e);
        if !self
            .signatures(handed_over, false)
            .iter()
            .copied()
            .any(|own| {
                self.sig_type_params(own)
                    .iter()
                    .any(|parameter| of_proxies.contains(parameter))
            })
        {
            return;
        }
        for &part in self.parts(target) {
            let called_as: Vec<crate::types::SigId> =
                self.signatures(part, false).iter().copied().collect();
            for called_as in called_as {
                let produced = self.sig_return(called_as);
                self.record_generic_function_result(&FreshGraph::object(), produced);
            }
        }
    }

    pub(super) fn precompute_storage_tables(&mut self, part: usize) {
        let program = self.p;
        match part {
            0 => {
                self.calls_that_may_redefine();
            }
            1 => {
                program
                    .aot
                    .storage
                    .forwardable_imports
                    .get_or_init(|| self.find_forwardable_imports());
            }
            2 => {
                program
                    .aot
                    .storage
                    .receiving_untyped_from_js
                    .get_or_init(|| self.find_functions_receiving_untyped_from_js());
            }
            3 => {
                program
                    .aot
                    .storage
                    .functions_receiving_component_props
                    .get_or_init(|| self.find_functions_receiving_component_props());
            }
            4 => {
                self.deletions();
            }
            _ => {
                self.occurs_in_code(Atom::NONE);
            }
        }
    }

    fn calls_that_may_redefine(&self) -> &'p [(FileId, ExprId)] {
        self.p.aot.storage.calls_that_may_redefine.get_or_init(|| {
            let mut calls = Vec::new();
            for file in (0..self.files().modules.len() as u32).map(FileId) {
                if !self.is_compiled(file)
                    || self.is_untyped_file(file)
                    || self.hir(file).kind == FileKind::Json
                {
                    continue;
                }
                let hir = self.hir(file);
                for &e in self.file_exprs_by_kind(file).of(ExprTag::Call) {
                    if let ExprKind::Call(call) = hir[e].kind
                        && let ExprKind::Dot { name, .. } | ExprKind::Ident(name) =
                            hir[hir[call].callee].kind
                        && name.is_some()
                        && matches!(
                            self.atoms().bytes(name),
                            b"defineProperty" | b"defineProperties"
                        )
                    {
                        calls.push((file, e));
                    }
                }
            }
            calls
        })
    }

    fn find_redefinition_in_call(
        &mut self,
        file: FileId,
        e: ExprId,
        found: &mut Vec<Redefinition>,
    ) {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return;
        };
        let (ExprKind::Dot { name, .. } | ExprKind::Ident(name)) = hir[hir[call].callee].kind
        else {
            return;
        };
        if name.is_none() {
            return;
        }
        let accepts_key = match self.atoms().bytes(name) {
            b"defineProperty" => true,
            b"defineProperties" => false,
            _ => return,
        };
        let is_library_type = self
            .resolved_signature(file, e)
            .sig
            .and_then(|signature| self.sig_decl(signature))
            .is_some_and(|(declared_in, ..)| self.hir(declared_in).kind == FileKind::Declaration);
        let mut arguments = hir.ids(hir[call].args);
        let Some(target) = arguments.next().filter(|&target| {
            is_library_type
                && !matches!(hir[target].kind, ExprKind::Object(_))
                && !self.holds_object_create_result(file, target)
        }) else {
            return;
        };
        let mut of_target = self.type_of_expr(file, target);
        if self.is_instantiable(of_target) {
            of_target = self.base_constraint(of_target);
        }
        let of_target = self.non_nullable(of_target);
        let names = if accepts_key {
            let Some(key) = arguments.next() else { return };
            let descriptor = arguments.next();
            if descriptor
                .is_some_and(|descriptor| self.is_plain_data_descriptor(file, descriptor, true))
            {
                return;
            }
            let names = self.key_literal_names(file, key);
            if !names.is_empty()
                && descriptor.is_some_and(|descriptor| {
                    self.is_plain_data_descriptor(file, descriptor, false)
                })
                && names
                    .iter()
                    .all(|&name| self.is_required_property(of_target, name))
            {
                return;
            }
            let of_key = self.type_of_expr(file, key);
            if names.is_empty()
                && self.every_type(of_key, |c, part| {
                    c.is_symbol_like(part) || c.is_number_like(part)
                })
            {
                return;
            }
            (!names.is_empty()).then_some(names)
        } else {
            match arguments.next().map(|descriptors| hir[descriptors].kind) {
                Some(ExprKind::Object(props))
                    if props.iter().all(|prop| {
                        hir[prop].kind == PropKind::Init
                            && matches!(hir[prop].key, PropKey::Name(_))
                    }) =>
                {
                    let mut redefined: Vec<Atom> = Vec::new();
                    for prop in props.iter() {
                        let (PropKey::Name(name), descriptor) = (hir[prop].key, hir[prop].value)
                        else {
                            continue;
                        };
                        if !self.is_plain_data_descriptor(file, descriptor, true)
                            && !(self.is_plain_data_descriptor(file, descriptor, false)
                                && self.is_required_property(of_target, name))
                        {
                            redefined.push(name);
                        }
                    }
                    if redefined.is_empty() {
                        return;
                    }
                    Some(redefined)
                }
                _ => None,
            }
        };
        for &part in self.parts(of_target) {
            if self.is_object_type(part)
                && !self.is_untyped_for_objects(part)
                && !self.has_unknown_fields(part)
            {
                found.push((part, names.clone()));
            }
        }
    }

    fn holds_object_create_result(&mut self, file: FileId, e: ExprId) -> bool {
        let ExprKind::Ident(name) = self.hir(file)[e].kind else {
            return false;
        };
        let Some(sym) = self.resolved_symbol_for(file, e, name) else {
            return false;
        };
        let Some((of, Decl::Var(pat))) = self.variable_declaration(sym) else {
            return false;
        };
        let PatParent::Var(declaration) = self.bound(of).pat_parent[pat.idx()] else {
            return false;
        };
        let declaration = &self.hir(of)[declaration];
        declaration.kind == VarKind::Const
            && declaration.init.is_some()
            && self.is_library_call(of, declaration.init, b"ObjectConstructor", &[b"create"])
    }

    fn is_required_property(&mut self, ty: TypeId, name: Atom) -> bool {
        let parts: &[TypeId] = self.parts(ty);
        parts.iter().copied().all(|part| {
            self.get_property_of_type(part, name)
                .is_some_and(|(prop, _)| !prop.flags.contains(crate::types::PropFlags::OPTIONAL))
        })
    }

    fn is_plain_data_descriptor(
        &self,
        file: FileId,
        descriptor: ExprId,
        is_complete: bool,
    ) -> bool {
        let hir = self.hir(file);
        let ExprKind::Object(props) = hir[descriptor].kind else {
            return false;
        };
        let mut seen = [false; 4];
        for prop in props.iter() {
            let PropKey::Name(name) = hir[prop].key else {
                return false;
            };
            let at = match self.atoms().bytes(name) {
                b"value"
                    if matches!(
                        hir[prop].kind,
                        PropKind::Init | PropKind::Shorthand | PropKind::Method
                    ) =>
                {
                    0
                }
                b"writable" => 1,
                b"enumerable" => 2,
                b"configurable" => 3,
                _ => return false,
            };
            if at != 0
                && !(hir[prop].kind == PropKind::Init
                    && matches!(hir[hir[prop].value].kind, ExprKind::True))
            {
                return false;
            }
            seen[at] = true;
        }
        seen[0] && (!is_complete || seen == [true; 4])
    }

    fn is_library_call(&mut self, file: FileId, e: ExprId, holder: &[u8], names: &[&[u8]]) -> bool {
        let Some(sig) = self.resolved_signature(file, e).sig else {
            return false;
        };
        let Some((declared_in, func, _)) = self.sig_decl(sig) else {
            return false;
        };
        let (hir, bound) = (self.hir(declared_in), self.bound(declared_in));
        let FnOwner::Member(member) = bound.fns[func.idx()].owner else {
            return false;
        };
        let MemberOwner::Interface(interface) = bound.member_owner[member.idx()] else {
            return false;
        };
        hir.kind == FileKind::Declaration
            && hir[func].name.is_some()
            && names.contains(&self.atoms().bytes(hir[func].name))
            && self.atoms().bytes(hir[interface].name) == holder
    }

    pub fn reference_read(&mut self, file: FileId, e: ExprId) -> Option<ReferenceRead> {
        if !matches!(
            self.hir(file)[e].kind,
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }
        ) {
            return None;
        }
        if let Some(&known) = self.aot.storage.reads.get((file, e)) {
            return known;
        }
        let asked = self.begin_query();
        let found = self.find_reference_read(file, e);
        if self.is_assumption_free(asked) {
            self.aot.storage.reads.insert((file, e), found);
        }
        found
    }

    fn variable_read(&mut self, sym: Sym) -> Option<VariableRead> {
        if let Some(&known) = self.aot.storage.variable_reads.get(&sym) {
            return known;
        }
        let asked = self.begin_query();
        let found = self.find_variable_read(sym);
        if self.is_assumption_free(asked) {
            self.aot.storage.variable_reads.insert(sym, found);
        }
        found
    }

    fn find_variable_read(&mut self, sym: Sym) -> Option<VariableRead> {
        let (declared_in, Decl::Var(_) | Decl::Param(_)) = self.variable_declaration(sym)? else {
            return None;
        };
        let coverage = self.flow_coverage_of(sym);
        let is_definite = matches!(self.variable_declaration(sym), Some((of, Decl::Var(pat))) if self.files().module(of).builtin.is_some() && matches!(root_declaration(self.bound(of), pat), PatParent::Var(d) if self.hir(of)[d].flags.contains(Flags::DEFINITE)));
        let starts_undefined = self.starts_undefined(sym);
        Some(VariableRead {
            declared_in,
            coverage,
            declared: self.stored_type(sym),
            may_be_undefined: starts_undefined && !is_definite,
            is_asserted: starts_undefined && is_definite,
        })
    }

    fn find_reference_read(&mut self, file: FileId, e: ExprId) -> Option<ReferenceRead> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => {
                let sym = self.resolved_symbol_for(file, e, name)?;
                let read = self.variable_read(sym)?;
                let is_narrowing_reliable = match read.coverage {
                    FlowCoverage::Everywhere => true,
                    FlowCoverage::Within(site) => {
                        read.declared_in == file
                            && self.enclosing_site(file, self.bound(file).expr_parent[e.idx()])
                                == Some(site)
                    }
                    FlowCoverage::Nowhere => false,
                };
                Some(ReferenceRead {
                    declared: read.declared,
                    is_narrowing_reliable,
                    may_be_undefined: read.may_be_undefined,
                    is_asserted: read.is_asserted,
                })
            }
            ExprKind::Dot {
                obj,
                name,
                name_pos,
                ..
            } if !matches!(hir[obj].kind, ExprKind::Super) => {
                let object = if self.is_asserted_at_use(file, obj) {
                    self.type_of_expr(file, obj)
                } else {
                    self.result_type_of(file, obj)
                };
                let mut object = self.non_nullable(object);
                if self.is_union(object)
                    && self
                        .property_type(object, object, name, shape::Access::Read)
                        .is_none()
                {
                    object = self.union_all_members_type(object);
                }
                let mut found = self.property_type_within(
                    object,
                    object,
                    name,
                    shape::Access::Read,
                    Some(file),
                );
                if let Some((inherited, Found::Property)) = found
                    && crate::hir::is_bracket_access(hir, name_pos)
                    && self.is_string_index_signature_only(object)
                {
                    let outer = self.aot.storage.accessed_within.replace(file);
                    let by_index = self.indexed_access_if_any(object, TypeId::STRING, true);
                    self.aot.storage.accessed_within = outer;
                    if let Some(by_index) = by_index {
                        found = Some((self.union(&[by_index, inherited]), Found::ByIndex));
                    }
                }
                let mut declared = found.map_or(TypeId::UNRESOLVED, |found| found.0);
                let apparent = self.apparent_type(object);
                let field = self
                    .prop_ref(apparent, name)
                    .and_then(|(prop, _)| match prop.source {
                        PropSource::Symbol(field) => Some(field),
                        _ => None,
                    });
                if declared != TypeId::UNRESOLVED
                    && let Some((prop, mapper)) = self.prop_ref(apparent, name)
                    && self.type_of_prop(prop, MapperId::IDENTITY)
                        != self.type_of_prop(prop, mapper)
                {
                    declared = self.without_number_literals_deep(declared);
                }
                if declared != TypeId::UNRESOLVED
                    && let Some((prop, mapper)) = self.prop_ref(apparent, name)
                    && matches!(prop.source, PropSource::Literal(..))
                {
                    let held = self.prop_storage_type(prop, mapper);
                    declared = self.union(&[declared, held]);
                }
                if declared != TypeId::UNRESOLVED
                    && (self.has_predicted_prop(object, name)
                        || self.is_primitive_read_after_cast(file, e))
                {
                    declared = TypeId::UNKNOWN;
                }
                if declared != TypeId::UNRESOLVED
                    && self.reads_container_with_unknown_elements(file, e, obj, name)
                {
                    declared = self.with_unknown_elements(declared);
                }
                let is_undefined_on_a_number = self
                    .is_string_by_type_that_may_be_a_number(file, obj)
                    && self
                        .type_of_property_of_type(TypeId::NUMBER, name)
                        .is_none();
                let may_be_undefined = is_undefined_on_a_number
                    || matches!(found, Some((_, Found::ByIndex)))
                    || field.is_some_and(|field| self.field_may_be_uninitialized(field));
                Some(ReferenceRead {
                    declared,
                    is_narrowing_reliable: false,
                    may_be_undefined,
                    is_asserted: false,
                })
            }
            ExprKind::Index { obj, index, .. } if !matches!(hir[obj].kind, ExprKind::Super) => {
                let object = if self.holds_unknown_elements(file, obj) {
                    self.result_type_of(file, obj)
                } else {
                    self.type_of_expr(file, obj)
                };
                let object = self.non_nullable(object);
                let object = self.without_number_literals_in_arguments(object);
                let key = self.type_of_expr(file, index);
                let outer = self.aot.storage.accessed_within.replace(file);
                let declared = if object == TypeId::UNKNOWN {
                    TypeId::UNKNOWN
                } else {
                    self.indexed_access_if_any(object, key, true)
                        .unwrap_or(TypeId::UNRESOLVED)
                };
                self.aot.storage.accessed_within = outer;
                Some(ReferenceRead {
                    declared,
                    is_narrowing_reliable: false,
                    may_be_undefined: true,
                    is_asserted: false,
                })
            }
            _ => None,
        }
    }

    pub fn resolves_via_index_signature(&mut self, file: FileId, obj: ExprId, name: Atom) -> bool {
        let object = self.type_of_expr(file, obj);
        let object = self.non_nullable(object);
        matches!(
            self.property_type_within(object, object, name, shape::Access::Read, Some(file)),
            Some((_, Found::ByIndex))
        )
    }

    pub fn type_beyond_flow_narrowing(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        if self.is_half_of_stack_in_use() {
            return Some(TypeId::ANY);
        }
        let (first, second) = match self.hir(file)[e].kind {
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                let read = self.reference_read(file, e).filter(|read| {
                    !read.is_narrowing_reliable && read.declared != TypeId::UNRESOLVED
                })?;
                let own = self.type_of_expr(file, e);
                return (read.declared != own && !self.is_provably_assignable(read.declared, own))
                    .then_some(read.declared);
            }
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => (left, right),
            ExprKind::Cond { yes, no, .. } => (yes, no),
            ExprKind::Binary {
                op: BinOp::Comma,
                right: inner,
                ..
            }
            | ExprKind::Assign {
                op: None,
                value: inner,
                ..
            }
            | ExprKind::Satisfies { expr: inner, .. }
            | ExprKind::AsConst(inner) => (inner, ExprId::NONE),
            ExprKind::NonNull(inner) => {
                return self
                    .type_beyond_flow_narrowing(file, inner)
                    .map(|held| self.non_nullable(held));
            }
            _ => return None,
        };
        let first = self.type_beyond_flow_narrowing(file, first);
        let second = if second.is_some() {
            self.type_beyond_flow_narrowing(file, second)
        } else {
            None
        };
        match (first, second) {
            (Some(first), Some(second)) => Some(self.union(&[first, second])),
            (first, second) => first.or(second),
        }
    }

    pub fn prop_storage_type(&mut self, prop: &Prop, mapper: MapperId) -> TypeId {
        let own = self.type_of_prop(prop, mapper);
        let PropSource::Literal(file, written) = prop.source else {
            return own;
        };
        let value = self.hir(file)[written].value;
        let is_written_out = value.is_some()
            && match self.hir(file)[value].kind {
                ExprKind::Number(_) | ExprKind::BigInt(_) => true,
                ExprKind::Unary {
                    op: UnOp::Minus,
                    operand,
                } => matches!(
                    self.hir(file)[operand].kind,
                    ExprKind::Number(_) | ExprKind::BigInt(_)
                ),
                _ => false,
            };
        let own = if is_written_out || prop.flags.contains(crate::types::PropFlags::READONLY) {
            own
        } else {
            self.without_number_literals_deep(own)
        };
        match if value.is_some() {
            self.type_beyond_flow_narrowing(file, value)
        } else {
            None
        } {
            Some(held) => self.union(&[own, held]),
            None => own,
        }
    }

    fn field_may_be_uninitialized(&mut self, field: Sym) -> bool {
        if let Some(&known) = self.aot.storage.maybe_uninitialized_fields.get(&field) {
            return known;
        }
        let found = self.starts_undefined(field);
        self.aot
            .storage
            .maybe_uninitialized_fields
            .insert(field, found);
        found
    }

    pub(super) fn checked_type_of(&mut self, file: FileId, e: ExprId) -> (TypeId, bool) {
        let (held, may_be_undefined) = self.checked_type_and_whether_left_undefined(file, e);
        (held, may_be_undefined || self.accepts_nullish(held))
    }

    pub(super) fn checked_type_and_whether_left_undefined(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> (TypeId, bool) {
        let is_left_out =
            self.is_optional_chain(file, e) || self.may_return_uninitialized_variable(file, e);
        let refers_to_typed_binding = self.refers_to_typed_binding(file, e);
        let is_predicted_element =
            matches!(self.hir(file)[e].kind, ExprKind::Index { .. }) && self.is_predicted(file, e);
        let (held, may_be_undefined) = match self.reference_read(file, e) {
            Some(read) if is_predicted_element => {
                (TypeId::UNKNOWN, read.may_be_undefined || is_left_out)
            }
            Some(read)
                if !read.is_narrowing_reliable
                    || read.declared == TypeId::UNKNOWN && refers_to_typed_binding =>
            {
                (read.declared, read.may_be_undefined || is_left_out)
            }
            Some(read) => (
                self.type_of_expr(file, e),
                read.may_be_undefined || is_left_out,
            ),
            None if matches!(
                self.hir(file)[e].kind,
                ExprKind::As { .. }
                    | ExprKind::NonNull(_)
                    | ExprKind::Satisfies { .. }
                    | ExprKind::AsConst(_)
                    | ExprKind::Assign { op: None, .. }
                    | ExprKind::Binary { .. }
                    | ExprKind::Assign { op: Some(_), .. }
                    | ExprKind::Cond { .. }
                    | ExprKind::Unary {
                        op: UnOp::Minus
                            | UnOp::BitNot
                            | UnOp::PreInc
                            | UnOp::PreDec
                            | UnOp::PostInc
                            | UnOp::PostDec,
                        ..
                    }
                    | ExprKind::Call(_)
                    | ExprKind::Await(_)
                    | ExprKind::TaggedTemplate(_)
            ) =>
            {
                (self.result_type_of(file, e), is_left_out)
            }
            None => (self.type_of_expr(file, e), is_left_out),
        };
        (held, may_be_undefined)
    }

    pub fn is_optional_chain(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain != Chain::No,
            ExprKind::Call(call) => hir[call].chain != Chain::No,
            _ => false,
        }
    }

    pub fn redeclared_catch_parameter(&self, file: FileId, pat: PatId) -> Option<SymbolId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatKind::Ident(name) = hir[pat].kind else {
            return None;
        };
        let PatParent::Var(d) = root_declaration(bound, pat) else {
            return None;
        };
        if hir[d].kind != VarKind::Var {
            return None;
        }
        let mut inner = bound.var_stmt[d.idx()];
        let mut parent = Parent::Stmt(inner);
        loop {
            parent = match parent {
                Parent::Stmt(at) if at.is_some() => {
                    if let StmtKind::Try { param, handler, .. } = hir[at].kind
                        && handler == inner
                        && param.is_some()
                        && matches!(hir[hir[param].pat].kind, PatKind::Ident(caught) if caught == name)
                    {
                        return bound.pat_symbol[hir[param].pat.idx()].some();
                    }
                    inner = at;
                    bound.stmt_parent[at.idx()]
                }
                Parent::Case(_) => self.parent_of_node(file, parent),
                _ => return None,
            };
        }
    }

    pub(super) fn is_stored_through_casts(&self, file: FileId, local: SymbolId) -> bool {
        has(&self.storage_facts(file).stored_through_casts, local)
    }

    pub fn is_declared_enum_member(
        &self,
        declared: Sym,
        file: FileId,
        member: crate::hir::EnumMemberId,
    ) -> bool {
        self.files().decls_of(declared).iter().any(|&(of, decl)| {
            matches!(decl, Decl::Enum(declaration) if of == file
                && self.hir(of)[declaration].members.iter().any(|it| it == member)
                && !self.hir(of)[declaration].flags.contains(Flags::CONST)
                && (!self.is_compiled(of) || self.hir(of)[declaration].flags.contains(Flags::AMBIENT)))
        })
    }

    fn flow_coverage_of(&mut self, sym: Sym) -> FlowCoverage {
        if let Some(&known) = self.aot.storage.flow_coverage.get(&sym) {
            return known;
        }
        if let Some(assumed) = self.assumption(Query::FlowCoverage(sym)) {
            return FlowCoverage::decoded(assumed);
        }
        let at_best = self.find_flow_coverage_of(sym, true);
        let (found, is_final) = match at_best {
            FlowCoverage::Nowhere => (at_best, true),
            _ => {
                let (found, is_final) = self.solve(
                    Query::FlowCoverage(sym),
                    at_best.encoded(),
                    FlowCoverage::Nowhere.encoded(),
                    |c| c.find_flow_coverage_of(sym, false).encoded(),
                );
                (FlowCoverage::decoded(found), is_final)
            }
        };
        if is_final {
            self.aot.storage.flow_coverage.insert(sym, found);
        }
        found
    }

    fn find_flow_coverage_of(&mut self, sym: Sym, goes_by_the_text_alone: bool) -> FlowCoverage {
        let Some((file, decl)) = self.variable_declaration(sym) else {
            return FlowCoverage::Nowhere;
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let local = bound.symbol_of_declaration(decl);
        let Some(symbol) = bound.symbols.get(local.idx()) else {
            return FlowCoverage::Nowhere;
        };
        if symbol.flags.contains(SymFlags::MERGED)
            || symbol.decls.iter().count() != 1
            || self.files().sym(file, local) != sym
        {
            return FlowCoverage::Nowhere;
        }
        let (site, first) = match decl {
            Decl::Var(pat) => match root_declaration(bound, pat) {
                PatParent::Var(d) => (
                    self.tdz_of(file, decl).map(|found| found.0),
                    if hir[d].pat == pat {
                        hir[d].init
                    } else {
                        ExprId::NONE
                    },
                ),
                _ => return FlowCoverage::Nowhere,
            },
            Decl::Param(pat) => match root_declaration(bound, pat) {
                PatParent::Param(p) => (
                    Some(Site::Body(bound.param_fn[p.idx()])),
                    if hir[p].pat == pat {
                        hir[p].default
                    } else {
                        ExprId::NONE
                    },
                ),
                _ => return FlowCoverage::Nowhere,
            },
            _ => return FlowCoverage::Nowhere,
        };
        let Some(site) = site else {
            return FlowCoverage::Nowhere;
        };
        if site == Site::File && !self.files().module(file).is_module() {
            return FlowCoverage::Nowhere;
        }
        let targets = bound.assignments_to(local);
        if has(&self.storage_facts(file).stored_through_casts, local)
            || !targets.iter().all(|&(_, target)| {
                self.enclosing_site(file, bound.expr_parent[target.idx()]) == Some(site)
                    && !self.is_in_default_of_assignment_pattern(file, target)
            })
        {
            return FlowCoverage::Nowhere;
        }
        if goes_by_the_text_alone {
            return if targets.is_empty() {
                FlowCoverage::Everywhere
            } else {
                FlowCoverage::Within(site)
            };
        }
        if !self.has_propagated_type(file, first) {
            return FlowCoverage::Nowhere;
        }
        let declared = self.type_of_symbol(sym);
        if self.is_union(declared) {
            let mut stored = vec![first];
            for &(_, target) in targets {
                let Parent::Expr(parent) = bound.expr_parent[target.idx()] else {
                    return FlowCoverage::Nowhere;
                };
                match hir[parent].kind {
                    ExprKind::Assign {
                        target: to, value, ..
                    } if to == target && self.target_store(file, target).is_some() => {
                        stored.push(value)
                    }
                    ExprKind::Unary { .. } => {}
                    _ => return FlowCoverage::Nowhere,
                }
            }
            if !stored
                .into_iter()
                .all(|value| self.is_checked_against_its_type(file, value))
            {
                return FlowCoverage::Nowhere;
            }
        }
        if targets.is_empty() {
            FlowCoverage::Everywhere
        } else {
            FlowCoverage::Within(site)
        }
    }

    fn operator_result_type(
        &mut self,
        file: FileId,
        e: ExprId,
        operands: &[ExprId],
        may_concatenate: bool,
    ) -> TypeId {
        let own = self.type_of_expr(file, e);
        let held: Vec<TypeId> = operands
            .iter()
            .map(|&operand| self.checked_type_of(file, operand).0)
            .collect();
        let steps_of_asker = std::mem::take(&mut self.aot.storage.string_proof_steps);
        let may_add_undefined = may_concatenate
            && self.some_type(own, |c, part| c.is_string_like(part))
            && !operands
                .iter()
                .any(|&operand| self.is_certainly_a_string(file, operand, &mut Vec::new()));
        self.aot.storage.string_proof_steps = steps_of_asker;
        let own = if may_add_undefined {
            self.union(&[own, TypeId::NUMBER])
        } else {
            own
        };
        if operands.iter().zip(&held).all(|(&operand, &held)| {
            !self.is_uninformative(held)
                && (held == self.type_of_expr(file, operand)
                    || self.is_asserted_as_operand(file, operand, held))
        }) {
            return own;
        }
        if may_concatenate
            && operands.iter().zip(&held).any(|(&operand, &held)| {
                !self.is_uninformative(held)
                    && held == self.type_of_expr(file, operand)
                    && self.every_type(held, |c, part| c.is_string_like(part))
            })
        {
            return own;
        }
        let mut parts = vec![own, TypeId::NUMBER];
        if may_concatenate {
            parts.push(TypeId::STRING);
        }
        if held.iter().all(|&held| {
            self.is_uninformative(held)
                || self.some_type(held, |c, part| {
                    c.is_bigint_like(part) || !c.has_primitive_flag(part)
                })
        }) {
            parts.push(TypeId::BIGINT);
        }
        self.union(&parts)
    }

    fn is_certainly_a_string(&mut self, file: FileId, e: ExprId, assumed: &mut Vec<Sym>) -> bool {
        self.aot.storage.string_proof_steps += 1;
        if self.aot.storage.string_proof_steps > 100 {
            return false;
        }
        if let Some(produced) = self.files().result_operand(file, e) {
            return self.is_certainly_a_string(file, produced, assumed);
        }
        let kinds = self.result_kinds_of(file, e);
        if kinds != super::kind::NOTHING && kinds & !super::kind::STRING == 0 {
            return true;
        }
        match self.hir(file)[e].kind {
            ExprKind::String(_)
            | ExprKind::Template { .. }
            | ExprKind::Unary {
                op: UnOp::Typeof, ..
            } => true,
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Binary {
                op: BinOp::Comma,
                right: expr,
                ..
            }
            | ExprKind::Assign {
                op: None,
                value: expr,
                ..
            } => self.is_certainly_a_string(file, expr, assumed),
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            }
            | ExprKind::Assign {
                op: Some(BinOp::Add),
                target: left,
                value: right,
            } => {
                self.is_certainly_a_string(file, left, assumed)
                    || self.is_certainly_a_string(file, right, assumed)
            }
            ExprKind::Cond {
                yes: left,
                no: right,
                ..
            }
            | ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } => {
                self.is_certainly_a_string(file, left, assumed)
                    && self.is_certainly_a_string(file, right, assumed)
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            }
            | ExprKind::Assign {
                op: Some(BinOp::Or | BinOp::Nullish),
                target: left,
                value: right,
            } => {
                if !self.is_certainly_a_string(file, right, assumed) {
                    return false;
                }
                if self.is_certainly_a_string(file, left, assumed) {
                    return true;
                }
                let held = self.checked_type_of(file, left).0;
                !self.is_uninformative(held)
                    && self.every_type(held, |c, part| c.is_string_like(part) || c.is_nullish(part))
            }
            ExprKind::Ident(name) => {
                let Some(sym) = self.resolved_symbol_for(file, e, name) else {
                    return false;
                };
                if assumed.contains(&sym) {
                    return true;
                }
                if assumed.len() == 8 || self.starts_undefined(sym) {
                    return false;
                }
                let Some((values, computed)) = self.stored_expressions(sym) else {
                    return false;
                };
                if values.is_empty() && computed.is_empty() {
                    return false;
                }
                assumed.push(sym);
                let is_certain = values
                    .into_iter()
                    .chain(computed)
                    .all(|stored| self.is_certainly_a_string(sym.file, stored, assumed));
                assumed.pop();
                is_certain
            }
            ExprKind::Call(call) => {
                self.calls_builtin_that_returns_a_string(file, e, call)
                    || self.calls_function_that_returns_strings(file, call, assumed)
            }
            _ => false,
        }
    }

    fn calls_function_that_returns_strings(
        &mut self,
        file: FileId,
        call: CallId,
        assumed: &mut Vec<Sym>,
    ) -> bool {
        let (callee, chain) = (self.hir(file)[call].callee, self.hir(file)[call].chain);
        let ExprKind::Ident(name) = self.hir(file)[callee].kind else {
            return false;
        };
        let Some(named) = self
            .resolved_symbol_for(file, callee, name)
            .filter(|_| chain == Chain::No)
        else {
            return false;
        };
        let Some(sym) = (if self.files().flags(named).contains(SymFlags::ALIAS) {
            self.files().resolve_alias(named)
        } else {
            Some(named)
        }) else {
            return false;
        };
        if assumed.contains(&sym) {
            return true;
        }
        let (hir, bound) = (self.hir(sym.file), self.bound(sym.file));
        let Some(symbol) = bound.symbols.get(sym.id.idx()) else {
            return false;
        };
        if assumed.len() == 8
            || symbol
                .flags
                .intersects(SymFlags::MERGED | SymFlags::ASSIGNED)
            || !bound.assignments_to(sym.id).is_empty()
            || self.has_direct_eval(sym.file)
        {
            return false;
        }
        let mut bodies = symbol.decls.iter().filter_map(|decl| match *decl {
            Decl::Fn(func) if !matches!(hir[func].body, FnBody::None) => Some(Some(func)),
            Decl::Fn(_) => None,
            _ => Some(None),
        });
        let (Some(Some(func)), None) = (bodies.next(), bodies.next()) else {
            return false;
        };
        if hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            || matches!(hir[func].body, FnBody::Block(_))
                && bound.fns[func.idx()].end != crate::bind::UNREACHABLE
        {
            return false;
        }
        let returned = self.returned_values(sym.file, func);
        assumed.push(sym);
        let is_certain = !returned.is_empty()
            && returned.into_iter().all(|value| {
                value.is_some() && self.is_certainly_a_string(sym.file, value, assumed)
            });
        assumed.pop();
        is_certain
    }

    fn calls_builtin_that_returns_a_string(
        &mut self,
        file: FileId,
        e: ExprId,
        call: CallId,
    ) -> bool {
        let (callee, chain) = (self.hir(file)[call].callee, self.hir(file)[call].chain);
        let Some(sig) = self
            .resolved_signature(file, e)
            .sig
            .filter(|_| chain == Chain::No)
        else {
            return false;
        };
        let Some((declared_in, _, _)) = self.sig_decl(sig) else {
            return false;
        };
        if !self.files().module(declared_in).is_lib || self.sig_return(sig) != TypeId::STRING {
            return false;
        }
        match self.hir(file)[callee].kind {
            ExprKind::Ident(name) => name == crate::atom::known::String,
            ExprKind::Dot {
                obj,
                chain: Chain::No,
                ..
            } => {
                let receiver = self.checked_type_of(file, obj).0;
                !self.is_uninformative(receiver)
                    && (self.is_array_or_tuple(receiver)
                        || self.every_type(receiver, |c, part| {
                            c.is_string_like(part) || c.is_number_like(part)
                        }))
            }
            _ => false,
        }
    }

    pub(super) fn is_string_by_type_that_may_be_a_number(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> bool {
        if e.is_none() {
            return false;
        }
        let checked = self.type_of_expr(file, e);
        if self.is_uninformative(checked)
            || !self.every_type(checked, |c, part| {
                c.is_string_like(part) || c.is_nullish(part)
            })
        {
            return false;
        }
        let produced = self.result_type_of(file, e);
        self.some_type(produced, |_, part| part == TypeId::NUMBER)
    }

    fn is_assigned_a_sum_that_may_be_a_number(
        &mut self,
        file: FileId,
        sym: Sym,
        declared: TypeId,
    ) -> bool {
        if !self.every_type(declared, |c, part| {
            c.is_string_like(part) || c.is_nullish(part)
        }) {
            return false;
        }
        let targets: Vec<ExprId> = self
            .bound(file)
            .assignments_to(sym.id)
            .iter()
            .map(|assignment| assignment.1)
            .collect();
        for target in targets {
            if let Some(
                super::integers::Store::Value(stored) | super::integers::Store::Computed(stored),
            ) = self.target_store(file, target)
            {
                let produced = self.result_type_of(file, stored);
                if self.some_type(produced, |_, part| part == TypeId::NUMBER) {
                    return true;
                }
            }
        }
        false
    }

    pub fn may_be_nullish_after_cast(&mut self, file: FileId, e: ExprId) -> bool {
        self.may_be_nullish_after_cast_inner(file, e, &mut Vec::new())
    }

    fn may_be_nullish_after_cast_inner(
        &mut self,
        file: FileId,
        e: ExprId,
        seen: &mut Vec<Sym>,
    ) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::As { .. } => true,
            ExprKind::Satisfies { expr, .. } => {
                self.may_be_nullish_after_cast_inner(file, expr, seen)
            }
            ExprKind::Cond { yes, no, .. } => {
                self.may_be_nullish_after_cast_inner(file, yes, seen)
                    || self.may_be_nullish_after_cast_inner(file, no, seen)
            }
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => {
                self.may_be_nullish_after_cast_inner(file, left, seen)
                    || self.may_be_nullish_after_cast_inner(file, right, seen)
            }
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.may_be_nullish_after_cast_inner(file, right, seen),
            ExprKind::Assign {
                op: None, value, ..
            } => self.may_be_nullish_after_cast_inner(file, value, seen),
            ExprKind::Ident(name) => {
                let Some(sym) = self.resolved_symbol_for(file, e, name) else {
                    return false;
                };
                if seen.contains(&sym) {
                    return false;
                }
                seen.push(sym);
                let Some((of, Decl::Var(pat))) = self.variable_declaration(sym) else {
                    return false;
                };
                let mut stored: Vec<ExprId> = Vec::new();
                if let PatParent::Var(d) = root_declaration(self.bound(of), pat)
                    && self.hir(of)[d].pat == pat
                    && self.hir(of)[d].init.is_some()
                {
                    stored.push(self.hir(of)[d].init);
                }
                stored.extend(
                    self.bound(of)
                        .assignments_to(sym.id)
                        .iter()
                        .map(|assignment| assignment.1)
                        .filter_map(|target| match self.target_store(of, target) {
                            Some(super::integers::Store::Value(value)) => Some(value),
                            _ => None,
                        }),
                );
                stored
                    .into_iter()
                    .any(|value| self.may_be_nullish_after_cast_inner(of, value, seen))
            }
            _ => false,
        }
    }

    fn is_asserted_as_operand(&mut self, file: FileId, operand: ExprId, held: TypeId) -> bool {
        let declared = self.type_of_expr(file, operand);
        if !self.is_asserted_at_use(file, operand) {
            return false;
        }
        let (of_declared, of_held): (&[TypeId], &[TypeId]) =
            (self.parts(declared), self.parts(held));
        of_held.iter().copied().all(|part| {
            of_declared.contains(&part)
                || matches!(part, TypeId::UNDEFINED | TypeId::NULL)
                || !self.has_primitive_flag(part)
        })
    }

    fn is_checked_against_its_type(&mut self, file: FileId, e: ExprId) -> bool {
        if e.is_none() {
            return true;
        }
        match self.hir(file)[e].kind {
            ExprKind::Satisfies { expr, .. }
            | ExprKind::Assign {
                op: None,
                value: expr,
                ..
            } => self.is_checked_against_its_type(file, expr),
            _ => match self.reference_read(file, e) {
                Some(read) => {
                    !read.may_be_undefined
                        && (read.is_narrowing_reliable
                            || read.declared == self.type_of_expr(file, e))
                }
                None => self.has_own_result_type(file, e),
            },
        }
    }

    pub(super) fn variable_declaration(&self, sym: Sym) -> Option<(FileId, Decl)> {
        let files = self.files();
        files.value_declaration(sym).or_else(|| {
            files
                .decls_of(sym)
                .iter()
                .find_map(|&(file, decl)| match decl {
                    Decl::Require(pat) => Some((file, Decl::Var(pat))),
                    _ => None,
                })
        })
    }

    pub fn has_tdz(&mut self, sym: Sym) -> bool {
        if let Some(&known) = self.aot.storage.has_tdz_cache.get(&sym) {
            return known;
        }
        let found = self.find_has_tdz(sym);
        self.aot.storage.has_tdz_cache.insert(sym, found);
        found
    }

    fn find_has_tdz(&self, sym: Sym) -> bool {
        let Some((file, decl)) = self.variable_declaration(sym) else {
            return false;
        };
        let hir = self.hir(file);
        matches!(decl, Decl::Var(_) | Decl::Class(_))
            && self.is_compiled(file)
            && !self
                .bound(file)
                .modifier_flags(hir, decl)
                .contains(Flags::AMBIENT)
            && !matches!(self.tdz_of(file, decl), Some((_, 0)))
    }

    pub fn is_hoisted(&self, sym: Sym) -> bool {
        matches!(self.variable_declaration(sym), Some((file, decl @ Decl::Var(_))) if matches!(self.tdz_of(file, decl), Some((_, 0))))
    }

    pub fn is_constant(&self, sym: Sym) -> bool {
        let Some((file, Decl::Var(pat))) = self.variable_declaration(sym) else {
            return false;
        };
        matches!(root_declaration(self.bound(file), pat), PatParent::Var(d) if matches!(self.hir(file)[d].kind, VarKind::Const | VarKind::Using | VarKind::AwaitUsing))
    }

    pub fn may_be_in_tdz(&mut self, sym: Sym, file: FileId, e: ExprId) -> bool {
        let Some((of, decl)) = self.variable_declaration(sym) else {
            return true;
        };
        match decl {
            Decl::Fn(_) => false,
            Decl::Param(pat) => {
                of != file || e.is_none() || self.parameter_may_be_unbound(file, pat, e)
            }
            Decl::Var(_) | Decl::Class(_) => match self.tdz_of(of, decl) {
                Some((_, 0)) => false,
                Some((Site::File, _))
                    if of != file
                        && self.is_evaluated_before_importers(of)
                        && !self
                            .p
                            .aot
                            .storage
                            .lazy_modules
                            .get()
                            .is_some_and(|lazy_modules| lazy_modules.contains(&of)) =>
                {
                    false
                }
                Some((site, end)) => {
                    !self.is_initialized_before_any_code(sym)
                        && (of != file
                            || e.is_none()
                            || !self.is_evaluated_after(file, e, site, end))
                }
                None => true,
            },
            _ => true,
        }
    }

    pub fn may_run_before_import_equals(
        &mut self,
        of: FileId,
        import: ImportEqualsId,
        file: FileId,
        e: ExprId,
    ) -> bool {
        let stmt = self.hir(of)[import].stmt;
        let Some(site) = self.enclosing_site(of, Parent::Stmt(stmt)) else {
            return true;
        };
        if site == Site::File
            && of != file
            && self.is_evaluated_before_importers(of)
            && !self
                .p
                .aot
                .storage
                .lazy_modules
                .get()
                .is_some_and(|lazy_modules| lazy_modules.contains(&of))
        {
            return false;
        }
        of != file
            || e.is_none()
            || !self.is_evaluated_after(file, e, site, self.hir(of)[stmt].loc.end)
    }

    pub fn namespace_runs_before_import_equals(
        &self,
        namespace: Sym,
        of: FileId,
        import: ImportEqualsId,
    ) -> bool {
        let start = self.hir(of)[self.hir(of)[import].stmt].start;
        self.files()
            .decls_of(namespace)
            .iter()
            .copied()
            .all(|(file, decl)| match decl {
                Decl::Module(block) if file == of => {
                    self.hir(file)[self.hir(file)[block].stmt].loc.end <= start
                }
                Decl::Module(_) => {
                    self.is_evaluated_before_importers(file)
                        && !self
                            .p
                            .aot
                            .storage
                            .lazy_modules
                            .get()
                            .is_some_and(|lazy_modules| lazy_modules.contains(&file))
                }
                _ => true,
            })
    }

    pub fn import_equals_symbol(
        &self,
        file: FileId,
        import: ImportEqualsId,
    ) -> Option<(Sym, bool)> {
        let aliases = self.symbols_of_alias_declarations(file);
        let &alias = aliases.get(&Decl::ImportEquals(import))?;
        Some((
            alias,
            self.modules_is_marked_as_referenced(file, &aliases, import, &mut Vec::new()),
        ))
    }

    fn is_evaluated_after(&self, file: FileId, e: ExprId, site: Site, end: u32) -> bool {
        self.comes_after(file, e, site, end, true)
    }

    fn is_created_after(&self, file: FileId, e: ExprId, site: Site, end: u32) -> bool {
        self.comes_after(file, e, site, end, false)
    }

    fn comes_after(
        &self,
        file: FileId,
        e: ExprId,
        site: Site,
        end: u32,
        goes_by_earliest_run: bool,
    ) -> bool {
        let (mut pos, mut parent) = (self.hir(file)[e].pos, self.bound(file).expr_parent[e.idx()]);
        loop {
            match self.enclosing_site(file, parent) {
                Some(at) if at == site => return pos >= end,
                Some(at) => match goes_by_earliest_run
                    .then(|| self.earliest_run(file, at))
                    .flatten()
                    .or_else(|| self.creation_site(file, at))
                {
                    Some(created) => (pos, parent) = created,
                    None => return false,
                },
                None => return false,
            }
        }
    }

    fn earliest_run(&self, file: FileId, site: Site) -> Option<(u32, Parent)> {
        let bound = self.bound(file);
        let func = match site {
            Site::Body(func) => func,
            Site::Parameter(p) => bound.param_fn[p.idx()],
            Site::File | Site::Initializer(_) => return None,
        };
        let &pos = self.earliest_runs_in(file).get(&func)?;
        let stmt = match bound.fns[func.idx()].owner {
            FnOwner::Stmt(stmt) => stmt,
            FnOwner::Expr(e) => {
                bound.var_stmt[self
                    .declaration_holding_value_at(file, bound.expr_parent[e.idx()])?
                    .idx()]
            }
            _ => return None,
        };
        Some((pos, bound.stmt_parent[stmt.idx()]))
    }

    fn declaration_holding_value_at(&self, file: FileId, mut parent: Parent) -> Option<VarDeclId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            parent = match parent {
                Parent::VarInit(d) => return Some(d),
                Parent::Prop(prop) if hir[prop].kind != PropKind::Spread => {
                    Parent::Expr(bound.prop_owner[prop.idx()])
                }
                Parent::Expr(e) if e.is_some() => match hir[e].kind {
                    ExprKind::Object(_)
                    | ExprKind::Array(_)
                    | ExprKind::As { .. }
                    | ExprKind::Satisfies { .. }
                    | ExprKind::AsConst(_)
                    | ExprKind::NonNull(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::Binary {
                        op: BinOp::And | BinOp::Or | BinOp::Nullish,
                        ..
                    } => bound.expr_parent[e.idx()],
                    ExprKind::Assign {
                        op: None, target, ..
                    } => return self.declaration_of_literal_stored_into(file, e, target),
                    _ => return None,
                },
                _ => return None,
            };
        }
    }

    fn declaration_of_literal_stored_into(
        &self,
        file: FileId,
        assignment: ExprId,
        target: ExprId,
    ) -> Option<VarDeclId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Stmt(stmt) = bound.expr_parent[assignment.idx()] else {
            return None;
        };
        let ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } = hir[target].kind
        else {
            return None;
        };
        if !matches!(hir[stmt].kind, StmtKind::Expr(_))
            || !matches!(
                bound.stmt_parent[stmt.idx()],
                Parent::FnBody(_) | Parent::File
            )
            || !matches!(hir[obj].kind, ExprKind::Ident(_))
            || name == crate::atom::known::__proto__
        {
            return None;
        }
        let [Decl::Var(pat)] = bound
            .symbols
            .get(bound.expr_symbol[obj.idx()].idx())?
            .decls
            .as_slice()
        else {
            return None;
        };
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
            return None;
        };
        let ExprKind::Object(props) = hir[hir[d].init.some()?].kind else {
            return None;
        };
        let has_only_plain_properties = props.iter().all(|prop| {
            matches!(
                hir[prop].kind,
                PropKind::Init | PropKind::Shorthand | PropKind::Method
            ) && matches!(hir[prop].key, PropKey::Name(key) if key != crate::atom::known::__proto__)
        });
        (has_only_plain_properties && hir[stmt].start >= hir[d].loc.end).then_some(d)
    }

    fn earliest_runs_in(&self, file: FileId) -> &'p FxHashMap<FnId, u32> {
        let program = self.p;
        let storage = &program.aot.storage;
        let is_evaluated_before_importers = self.is_evaluated_before_importers(file)
            && !storage
                .lazy_modules
                .get()
                .is_some_and(|lazy_modules| lazy_modules.contains(&file));
        let runs = if is_evaluated_before_importers {
            &storage.earliest_runs_before_importers
        } else {
            &storage.earliest_runs
        };
        runs.get_or_init(program.files.modules.len(), file, || {
            self.find_earliest_runs_in(file, is_evaluated_before_importers)
        })
    }

    fn find_earliest_runs_in(
        &self,
        file: FileId,
        is_evaluated_before_importers: bool,
    ) -> FxHashMap<FnId, u32> {
        let (hir, bound, index) = (
            self.hir(file),
            self.bound(file),
            self.file_exprs_by_kind(file),
        );
        let mut runs: FxHashMap<FnId, u32> = FxHashMap::default();
        if matches!(hir.kind, FileKind::Declaration | FileKind::Json)
            || bound.ran_out_of_stack
            || self.has_direct_eval(file)
            || !hir.with_bodies.is_empty()
        {
            return runs;
        }
        let mut declared: FxHashMap<SymbolId, (FnId, Site)> = FxHashMap::default();
        for (func, f) in hir.fns.iter().enumerate() {
            let func = FnId(func as u32);
            let FnOwner::Stmt(stmt) = bound.fns[func.idx()].owner else {
                continue;
            };
            let id = bound.fn_symbol[func.idx()];
            let Some(symbol) = bound.symbols.get(id.idx()) else {
                continue;
            };
            let is_more = SymFlags::VALUE.difference(SymFlags::FUNCTION)
                | SymFlags::MERGED
                | SymFlags::ASSIGNED
                | SymFlags::ALIAS;
            let bodies = symbol
                .decls
                .iter()
                .filter(
                    |decl| matches!(**decl, Decl::Fn(it) if !matches!(hir[it].body, FnBody::None)),
                )
                .count();
            let is_exported = f.flags.contains(Flags::EXPORT)
                || hir.exports.iter().any(|export| {
                    export.spec.is_none()
                        && export.items.iter().any(|item| hir[item].local == f.name)
                });
            let is_referenced_elsewhere = f.flags.intersects(Flags::DEFAULT | Flags::AMBIENT)
                || is_exported
                    && !(is_evaluated_before_importers
                        && bound.stmt_parent[stmt.idx()] == Parent::File)
                || symbol.flags.intersects(is_more)
                || bodies != 1
                || !symbol.decls.iter().all(|decl| matches!(decl, Decl::Fn(_)));
            let is_also_variable = hir.is_js
                && !matches!(
                    bound.stmt_parent[stmt.idx()],
                    Parent::FnBody(_) | Parent::File
                );
            if f.kind != FnKind::Decl
                || matches!(f.body, FnBody::None)
                || is_referenced_elsewhere
                || is_also_variable
            {
                continue;
            }
            let Some(site) = self.enclosing_site(file, bound.stmt_parent[stmt.idx()]) else {
                continue;
            };
            if site != Site::File || self.files().module(file).is_module() {
                declared.insert(id, (func, site));
                runs.insert(func, u32::MAX);
            }
        }
        let mut holders: FxHashMap<SymbolId, (Site, Vec<FnId>)> = FxHashMap::default();
        for (d, declaration) in hir.var_decls.iter().enumerate() {
            let (id, stmt) = (bound.pat_symbol[declaration.pat.idx()], bound.var_stmt[d]);
            let Some(symbol) = bound.symbols.get(id.idx()) else {
                continue;
            };
            if declaration.init.is_none()
                || !matches!(
                    declaration.kind,
                    VarKind::Var | VarKind::Let | VarKind::Const
                )
                || stmt.is_none()
                || !matches!(hir[declaration.pat].kind, PatKind::Ident(_))
                || !matches!(
                    bound.stmt_parent[stmt.idx()],
                    Parent::FnBody(_) | Parent::File
                )
            {
                continue;
            }
            let is_referenced_elsewhere =
                declaration.flags.intersects(Flags::EXPORT | Flags::AMBIENT)
                    || symbol.flags.intersects(SymFlags::MERGED | SymFlags::ALIAS)
                    || symbol.decls.len() != 1
                    || bound.stmt_parent[stmt.idx()] == Parent::File
                        && hir.exports.iter().any(|export| {
                            export.spec.is_none()
                                && export
                                    .items
                                    .iter()
                                    .any(|item| hir[item].local == symbol.name)
                        });
            if is_referenced_elsewhere {
                continue;
            }
            let Some(site) = self.enclosing_site(file, bound.stmt_parent[stmt.idx()]) else {
                continue;
            };
            if site != Site::File || self.files().module(file).is_module() {
                holders.insert(id, (site, Vec::new()));
            }
        }
        let holder_around = |parent: Parent, home: Site| {
            let d = self.declaration_holding_value_at(file, parent)?;
            Some(bound.pat_symbol[hir[d].pat.idx()])
                .filter(|id| holders.get(id).is_some_and(|holder| holder.0 == home))
        };
        let mut held: Vec<(SymbolId, FnId)> = Vec::new();
        let mut home_of_held: FxHashMap<FnId, Site> = FxHashMap::default();
        for func in (0..hir.fns.len() as u32).map(FnId) {
            let FnOwner::Expr(e) = bound.fns[func.idx()].owner else {
                continue;
            };
            let Some(home) = self.enclosing_site(file, bound.expr_parent[e.idx()]) else {
                continue;
            };
            if let Some(holder) = holder_around(bound.expr_parent[e.idx()], home) {
                held.push((holder, func));
                home_of_held.insert(func, home);
                runs.insert(func, u32::MAX);
            }
        }
        let mut referenced_in: Vec<(FnId, FnId)> = Vec::new();
        let mut holders_referenced_in: Vec<(FnId, SymbolId)> = Vec::new();
        let mut holders_held: Vec<(SymbolId, SymbolId)> = Vec::new();
        let mut earliest_mentions: FxHashMap<SymbolId, u32> = FxHashMap::default();
        for &e in index.of(ExprTag::Ident) {
            let named = bound.expr_symbol[e.idx()];
            let (func, home) = match (declared.get(&named), holders.get(&named)) {
                (Some(&(func, home)), _) => (func, home),
                (None, Some(holder)) => (FnId::NONE, holder.0),
                (None, None) => continue,
            };
            let (mut pos, mut parent) = (hir[e].pos, bound.expr_parent[e.idx()]);
            if parent == Parent::None || bound.is_in_type_query(e) {
                continue;
            }
            if func.is_none()
                && let Parent::Expr(access) = parent
                && access.is_some()
                && let Parent::Expr(assignment) = bound.expr_parent[access.idx()]
                && assignment.is_some()
                && matches!(hir[assignment].kind, ExprKind::Assign { op: None, target, .. } if target == access && self.declaration_of_literal_stored_into(file, assignment, target).is_some())
            {
                continue;
            }
            let earliest = loop {
                match self.enclosing_site(file, parent) {
                    Some(at) if at == home => match holder_around(parent, home) {
                        Some(holder) if func.is_some() => {
                            held.push((holder, func));
                            break u32::MAX;
                        }
                        Some(holder) => {
                            holders_held.push((holder, named));
                            break u32::MAX;
                        }
                        None => break pos,
                    },
                    Some(at) => {
                        let around = match at {
                            Site::Body(around) => around,
                            Site::Parameter(p) => bound.param_fn[p.idx()],
                            Site::File | Site::Initializer(_) => FnId::NONE,
                        };
                        if home_of_held.get(&around) == Some(&home) {
                            if func.is_some() {
                                referenced_in.push((around, func));
                            } else {
                                holders_referenced_in.push((around, named));
                            }
                            break u32::MAX;
                        }
                        if let Some(created) = self.creation_site(file, at) {
                            (pos, parent) = created;
                        } else if around.is_some()
                            && runs.contains_key(&around)
                            && let FnOwner::Stmt(stmt) = bound.fns[around.idx()].owner
                        {
                            if self.enclosing_site(file, bound.stmt_parent[stmt.idx()])
                                == Some(home)
                            {
                                if func.is_some() {
                                    referenced_in.push((around, func));
                                } else {
                                    holders_referenced_in.push((around, named));
                                }
                                break u32::MAX;
                            }
                            (pos, parent) = (hir[stmt].start, bound.stmt_parent[stmt.idx()]);
                        } else {
                            break 0;
                        }
                    }
                    None => break 0,
                }
            };
            let so_far = if func.is_some() {
                runs.entry(func).or_insert(u32::MAX)
            } else {
                earliest_mentions.entry(named).or_insert(u32::MAX)
            };
            *so_far = earliest.min(*so_far);
        }
        for (holder, func) in held {
            if let Some(of_holder) = holders.get_mut(&holder) {
                of_holder.1.push(func);
            }
        }
        referenced_in.sort_unstable_by_key(|&(from, to)| (from.0, to.0));
        referenced_in.dedup();
        holders_referenced_in.sort_unstable_by_key(|&(from, to)| (from.0, to.0));
        holders_referenced_in.dedup();
        holders_held.sort_unstable_by_key(|&(from, to)| (from.0, to.0));
        holders_held.dedup();
        let mut by_position: Vec<(u32, FnId, SymbolId)> = runs
            .iter()
            .map(|(&func, &pos)| (pos, func, SymbolId::NONE))
            .chain(
                earliest_mentions
                    .iter()
                    .map(|(&holder, &pos)| (pos, FnId::NONE, holder)),
            )
            .collect();
        by_position.sort_unstable_by_key(|&(pos, func, holder)| (pos, func.0, holder.0));
        let mut is_settled: FxHashSet<FnId> = FxHashSet::default();
        let mut is_holder_settled: FxHashSet<SymbolId> = FxHashSet::default();
        for (pos, first, first_holder) in by_position {
            let (mut pending, mut pending_holders) = (vec![first], vec![first_holder]);
            loop {
                if let Some(holder) = pending_holders.pop() {
                    if holder.is_some() && is_holder_settled.insert(holder) {
                        pending.extend(
                            holders
                                .get(&holder)
                                .into_iter()
                                .flat_map(|of_holder| of_holder.1.iter().copied()),
                        );
                        let start = holders_held.partition_point(|edge| edge.0.0 < holder.0);
                        pending_holders.extend(
                            holders_held[start..]
                                .iter()
                                .take_while(|edge| edge.0 == holder)
                                .map(|edge| edge.1),
                        );
                    }
                    continue;
                }
                let Some(from) = pending.pop() else { break };
                if from.is_none() || !is_settled.insert(from) {
                    continue;
                }
                runs.insert(from, pos);
                let start = referenced_in.partition_point(|edge| edge.0.0 < from.0);
                pending.extend(
                    referenced_in[start..]
                        .iter()
                        .take_while(|edge| edge.0 == from)
                        .map(|edge| edge.1),
                );
                let start = holders_referenced_in.partition_point(|edge| edge.0.0 < from.0);
                pending_holders.extend(
                    holders_referenced_in[start..]
                        .iter()
                        .take_while(|edge| edge.0 == from)
                        .map(|edge| edge.1),
                );
            }
        }
        runs
    }

    pub(super) fn creation_site(&self, file: FileId, site: Site) -> Option<(u32, Parent)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let func = match site {
            Site::File => return None,
            Site::Body(func) => func,
            Site::Parameter(p) => bound.param_fn[p.idx()],
            Site::Initializer(_) => FnId::NONE,
        };
        let member = match site {
            Site::Initializer(member) => member,
            _ => match bound.fns.get(func.idx())?.owner {
                FnOwner::Expr(e) => return Some((hir[e].pos, bound.expr_parent[e.idx()])),
                FnOwner::Member(member) => member,
                _ => return None,
            },
        };
        let MemberOwner::Class(class) = bound.member_owner[member.idx()] else {
            return None;
        };
        Some(match bound.class_owner[class.idx()] {
            ClassOwner::Expr(e) => (hir[e].pos, bound.expr_parent[e.idx()]),
            ClassOwner::Stmt(stmt) => (hir[stmt].start, bound.stmt_parent[stmt.idx()]),
        })
    }

    pub fn is_never_read_uninitialized(&mut self, sym: Sym) -> bool {
        self.is_never_in_tdz(sym, |facts| &facts.referenced_in_tdz)
    }

    pub(super) fn is_never_captured_uninitialized(&mut self, sym: Sym) -> bool {
        self.is_never_in_tdz(sym, |facts| &facts.captured_in_tdz)
    }

    fn is_never_in_tdz(&mut self, sym: Sym, early: impl Fn(&FileFacts) -> &Vec<u64>) -> bool {
        if self.is_initialized_before_any_code(sym) {
            return true;
        }
        let Some((file, decl @ (Decl::Var(_) | Decl::Class(_)))) = self.variable_declaration(sym)
        else {
            return false;
        };
        let bound = self.bound(file);
        let local = bound.symbol_of_declaration(decl);
        let Some(symbol) = bound.symbols.get(local.idx()) else {
            return false;
        };
        let is_seen_by_importers = bound
            .modifier_flags(self.hir(file), decl)
            .contains(Flags::EXPORT)
            || self.files().sym(file, local) != sym
            || has(&self.storage_facts(file).seen_by_importers, local);
        let is_visible_elsewhere = symbol.flags.contains(SymFlags::MERGED)
            || is_seen_by_importers
            || !self.files().module(file).is_module()
                && matches!(self.tdz_of(file, decl), Some((Site::File, _)));
        !is_visible_elsewhere
            && self.tdz_of(file, decl).is_some()
            && !has(early(self.storage_facts(file)), local)
    }

    pub fn const_value(&mut self, sym: Sym) -> Option<Primitive> {
        if self.aot.storage.folding_long_strings {
            if let Some(&known) = self.aot.storage.long_string_constants.get(&sym) {
                return known;
            }
            self.aot.storage.long_string_constants.insert(sym, None);
            let found = self.initializer_of_constant(sym).and_then(|(file, init)| self.constant_value_of(file, init)).filter(|value| !matches!(*value, Primitive::String(text) if self.atoms().bytes(text).len() > MAX_FOLDED_STRING_PART_LEN));
            self.aot.storage.long_string_constants.insert(sym, found);
            return found;
        }
        if let Some(&known) = self.aot.storage.constants.get(&sym) {
            return known;
        }
        self.aot.storage.constants.insert(sym, None);
        let found = self.find_const_value(sym);
        self.aot.storage.constants.insert(sym, found);
        found
    }

    pub fn initializer_of_const(&mut self, sym: Sym) -> Option<(FileId, ExprId)> {
        let (file, Decl::Var(pat)) = self.variable_declaration(sym)? else {
            return None;
        };
        let hir = self.hir(file);
        let PatParent::Var(d) = root_declaration(self.bound(file), pat) else {
            return None;
        };
        let is_code = self.is_compiled(file) && !hir[d].flags.contains(Flags::AMBIENT);
        if !is_code || hir[d].kind != VarKind::Const || hir[d].pat != pat || hir[d].init.is_none() {
            return None;
        }
        Some((file, hir[d].init))
    }

    pub(super) fn initializer_of_constant(&mut self, sym: Sym) -> Option<(FileId, ExprId)> {
        if let Some(found) = self.initializer_of_const(sym) {
            return Some(found);
        }
        let (file, Decl::Var(pat)) = self.variable_declaration(sym)? else {
            return None;
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Var(d) = root_declaration(bound, pat) else {
            return None;
        };
        let local = bound.pat_symbol[pat.idx()];
        let symbol = bound.symbols.get(local.idx())?;
        let is_declared_once = matches!(hir[d].kind, VarKind::Var | VarKind::Let)
            && hir[d].pat == pat
            && hir[d].init.is_some()
            && symbol.decls.len() == 1;
        let is_stored_once = is_declared_once
            && !symbol
                .flags
                .intersects(SymFlags::ASSIGNED | SymFlags::MERGED)
            && bound.assignments_to(local).is_empty()
            && !self.is_stored_through_casts(file, local);
        let is_code = self.is_compiled(file) && !hir[d].flags.contains(Flags::AMBIENT);
        if !is_stored_once
            || !is_code
            || !hir.with_bodies.is_empty()
            || self.has_direct_eval(file)
            || self.variable_starts_undefined(sym, file, pat)
        {
            return None;
        }
        Some((file, hir[d].init))
    }

    fn find_const_value(&mut self, sym: Sym) -> Option<Primitive> {
        let (file, init) = self.initializer_of_constant(sym)?;
        self.constant_value_of(file, init).filter(|value| !matches!(*value, Primitive::String(text) if self.atoms().bytes(text).len() > MAX_CONSTANT_BYTES))
    }

    pub fn constant_value_of(&mut self, file: FileId, e: ExprId) -> Option<Primitive> {
        let hir = self.hir(file);
        let left_of_chain = |e: ExprId| match hir[e].kind {
            ExprKind::Binary { left, .. } if matches!(hir[left].kind, ExprKind::Binary { .. }) => {
                Some(left)
            }
            _ => None,
        };
        if left_of_chain(e).is_none() {
            return self.find_constant_value_of(file, e);
        }
        let is_folding = self.aot.storage.folding_long_strings;
        let (mut chain, mut at) = (Vec::new(), e);
        while let Some(left) = left_of_chain(at).filter(|_| {
            !self
                .aot
                .storage
                .chain_values
                .contains_key(&(file, at, is_folding))
        }) {
            chain.push(at);
            at = left;
        }
        let mut found = self
            .aot
            .storage
            .chain_values
            .get(&(file, e, is_folding))
            .copied()
            .flatten();
        for &link in chain.iter().rev() {
            let careful_before = self.stack_half_used_count();
            found = self.find_constant_value_of(file, link);
            if careful_before == self.stack_half_used_count() {
                self.aot
                    .storage
                    .chain_values
                    .insert((file, link, is_folding), found);
            }
        }
        found
    }

    fn find_constant_value_of(&mut self, file: FileId, e: ExprId) -> Option<Primitive> {
        if self.is_half_of_stack_in_use() {
            return None;
        }
        let hir = self.hir(file);
        Some(match hir[e].kind {
            ExprKind::Null => Primitive::Null,
            ExprKind::True => Primitive::Bool(true),
            ExprKind::False => Primitive::Bool(false),
            ExprKind::Number(index) => Primitive::Number(hir.numbers[index as usize]),
            ExprKind::String(text) => Primitive::String(text),
            ExprKind::Template { exprs } => {
                let texts = hir.template_texts(exprs);
                let mut text = self.atoms().bytes(hir.id_at(texts, 0)).to_vec();
                for (i, substitution) in hir.ids(exprs).enumerate() {
                    let value = self.constant_value_of(file, substitution)?;
                    text.extend_from_slice(self.primitive_text(value));
                    text.extend_from_slice(self.atoms().bytes(hir.id_at(texts, i + 1)));
                }
                crate::check::mapped::combine_surrogate_pairs(&mut text);
                Primitive::String(self.atoms().intern(&text))
            }
            ExprKind::TaggedTemplate(call) if self.is_string_raw_tag(file, call) => {
                let raw = self.template_raw_strings(file, call);
                let mut text = raw.first()?.clone();
                for (i, substitution) in hir.ids(hir[call].args).enumerate() {
                    let value = self.constant_value_of(file, substitution)?;
                    text.extend_from_slice(self.primitive_text(value));
                    text.extend_from_slice(raw.get(i + 1)?);
                }
                crate::check::mapped::combine_surrogate_pairs(&mut text);
                Primitive::String(self.atoms().intern(&text))
            }
            ExprKind::Ident(name) if self.refers_to_global_constant(file, e, name) => {
                match self.atoms().bytes(name) {
                    b"NaN" => Primitive::Number(f64::NAN),
                    b"Infinity" => Primitive::Number(f64::INFINITY),
                    _ => Primitive::Undefined,
                }
            }
            ExprKind::Ident(name) => {
                let named = self.resolved_symbol_for(file, e, name)?;
                let member =
                    self.files()
                        .decls_of(named)
                        .iter()
                        .find_map(|&(of, decl)| match decl {
                            Decl::EnumMember(member) => Some((of, member)),
                            _ => None,
                        });
                match member {
                    Some((of, member)) => match self.enum_member_value(of, member)? {
                        EnumValue::Number(bits) => Primitive::Number(f64::from_bits(bits)),
                        EnumValue::String(text) => Primitive::String(text),
                    },
                    None => self.const_value(named)?,
                }
            }
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => {
                let ExprKind::Ident(object) = hir[obj].kind else {
                    return None;
                };
                let declared = self
                    .resolved_symbol_for(file, obj, object)
                    .filter(|&declared| self.files().flags(declared).intersects(SymFlags::ENUM))?;
                let member = self.files().export(declared, name)?;
                let (of, member) =
                    self.files()
                        .decls_of(member)
                        .iter()
                        .find_map(|&(of, decl)| match decl {
                            Decl::EnumMember(member) => Some((of, member)),
                            _ => None,
                        })?;
                if self.is_declared_enum_member(declared, of, member)
                    || self.is_enum_member_read_from_object(file, of, member)
                {
                    return None;
                }
                match self.enum_member_value(of, member)? {
                    EnumValue::Number(bits) => Primitive::Number(f64::from_bits(bits)),
                    EnumValue::String(text) => Primitive::String(text),
                }
            }
            ExprKind::Unary { op, operand } => match (op, self.constant_value_of(file, operand)?) {
                (UnOp::Not, value) => Primitive::Bool(match value {
                    Primitive::Undefined | Primitive::Null => true,
                    Primitive::Bool(value) => !value,
                    Primitive::Number(value) => value == 0.0 || value.is_nan(),
                    Primitive::String(text) => self.atoms().bytes(text).is_empty(),
                }),
                (UnOp::Minus, Primitive::Number(value)) => Primitive::Number(-value),
                (UnOp::Plus, Primitive::Number(value)) => Primitive::Number(value),
                (UnOp::BitNot, Primitive::Number(value)) => {
                    Primitive::Number(f64::from(!to_int32(value)))
                }
                _ => return None,
            },
            ExprKind::Binary { op, left, right } => {
                let (a, b) = (
                    self.constant_value_of(file, left)?,
                    self.constant_value_of(file, right)?,
                );
                let is_equality = matches!(op, BinOp::EqEq | BinOp::EqEqEq);
                if !is_equality && !matches!(op, BinOp::NotEq | BinOp::NotEqEq) {
                    return match (a, b) {
                        (Primitive::Number(a), Primitive::Number(b)) => {
                            number_operation(op, a, b, true)
                                .map(Primitive::Number)
                                .or(match op {
                                    BinOp::Lt => Some(Primitive::Bool(a < b)),
                                    BinOp::Le => Some(Primitive::Bool(a <= b)),
                                    BinOp::Gt => Some(Primitive::Bool(a > b)),
                                    BinOp::Ge => Some(Primitive::Bool(a >= b)),
                                    _ => None,
                                })
                        }
                        (
                            Primitive::Number(_) | Primitive::String(_),
                            Primitive::Number(_) | Primitive::String(_),
                        ) if op == BinOp::Add => {
                            let mut text =
                                [self.primitive_text(a), self.primitive_text(b)].concat();
                            crate::check::mapped::combine_surrogate_pairs(&mut text);
                            Some(Primitive::String(self.atoms().intern(&text)))
                        }
                        _ => None,
                    };
                }
                let are_equal = match (a, b) {
                    (Primitive::Number(a), Primitive::Number(b)) => a == b,
                    (Primitive::String(a), Primitive::String(b)) => a == b,
                    (Primitive::Bool(a), Primitive::Bool(b)) => a == b,
                    (
                        Primitive::Undefined | Primitive::Null,
                        Primitive::Undefined | Primitive::Null,
                    ) => a == b || matches!(op, BinOp::EqEq | BinOp::NotEq),
                    _ => return None,
                };
                Primitive::Bool(are_equal == is_equality)
            }
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => {
                self.constant_value_of(file, expr)?
            }
            ExprKind::As { expr, ty } => {
                match (self.constant_value_of(file, expr)?, hir[ty].kind) {
                    (value @ Primitive::Number(_), TypeNodeKind::Keyword(Keyword::Number))
                    | (value @ Primitive::String(_), TypeNodeKind::Keyword(Keyword::String))
                    | (value @ Primitive::Bool(_), TypeNodeKind::Keyword(Keyword::Boolean)) => {
                        value
                    }
                    _ => return None,
                }
            }
            _ => return None,
        })
    }

    fn primitive_text(&self, value: Primitive) -> &'p [u8] {
        match value {
            Primitive::Undefined => b"undefined",
            Primitive::Null => b"null",
            Primitive::Bool(true) => b"true",
            Primitive::Bool(false) => b"false",
            Primitive::Number(value) => self.constant_text(EnumValue::Number(value.to_bits())),
            Primitive::String(text) => self.constant_text(EnumValue::String(text)),
        }
    }

    pub fn set_module_graph(
        &self,
        modules: &[FileId],
        edges: &[(FileId, FileId, EvaluationTime)],
        has_top_level_await: bool,
    ) {
        self.p
            .aot
            .storage
            .modules
            .get_or_init(|| ModuleGraph::new(modules, edges, has_top_level_await));
    }

    pub fn set_logs_type_errors(&self, logs: bool) {
        self.p.aot.storage.logs_type_errors.get_or_init(|| logs);
    }

    pub fn logs_type_errors(&self) -> bool {
        self.p
            .aot
            .storage
            .logs_type_errors
            .get()
            .copied()
            .unwrap_or(false)
    }

    pub fn set_lazy_modules(&self, modules: &FxHashSet<FileId>) {
        self.p
            .aot
            .storage
            .lazy_modules
            .get_or_init(|| modules.clone());
    }

    pub fn set_calls_marked_pure(&self, calls: FxHashMap<FileId, Vec<u32>>) {
        self.p.aot.storage.marked_pure.get_or_init(|| calls);
    }

    pub fn set_defined_primitives(
        &self,
        in_program: FxHashSet<Vec<u8>>,
        in_builtin_modules: FxHashSet<Vec<u8>>,
    ) {
        self.p
            .aot
            .storage
            .replaced
            .get_or_init(|| [in_program, in_builtin_modules]);
    }

    fn is_defined_primitive(&mut self, file: FileId, e: ExprId) -> bool {
        let p = self.p;
        let Some(replaced) = p.aot.storage.replaced.get() else {
            return false;
        };
        let replaced = &replaced[usize::from(self.files().module(file).builtin.is_some())];
        if replaced.is_empty() {
            return false;
        }
        let hir = self.hir(file);
        let (mut names, mut at) = (Vec::new(), e);
        loop {
            match hir[at].kind {
                ExprKind::Dot {
                    obj,
                    name,
                    chain: Chain::No,
                    ..
                } => {
                    names.push(name);
                    at = obj;
                }
                ExprKind::Ident(name) => {
                    if self.bound(file).expr_symbol[at.idx()].is_some()
                        || self
                            .symbol_of_identifier(file, at, name)
                            .is_some_and(|found| self.hir(found.file).kind != FileKind::Declaration)
                    {
                        return false;
                    }
                    names.push(name);
                    break;
                }
                _ => return false,
            }
        }
        let path = names
            .iter()
            .rev()
            .map(|&name| self.atoms().bytes(name))
            .collect::<Vec<_>>()
            .join(&b'.');
        replaced.contains(&path)
    }

    pub(super) fn is_compiled(&self, file: FileId) -> bool {
        self.hir(file).kind != FileKind::Declaration
            && self
                .p
                .aot
                .storage
                .modules
                .get()
                .is_some_and(|modules| modules.is_module.get(file.idx()) == Some(&true))
    }

    pub fn is_initialized_before_any_code(&mut self, sym: Sym) -> bool {
        let Some((file, decl)) = self.variable_declaration(sym) else {
            return false;
        };
        match self.tdz_of(file, decl) {
            Some((Site::File, end)) if end != 0 => {
                end <= self.pure_prefix_end(file)
                    && self.is_evaluated_before_importers(file)
                    && !self
                        .p
                        .aot
                        .storage
                        .lazy_modules
                        .get()
                        .is_some_and(|lazy_modules| lazy_modules.contains(&file))
            }
            _ => false,
        }
    }

    pub fn is_deferred_module(&mut self, file: FileId) -> bool {
        if let Some(&known) = self.aot.storage.deferred_modules.get(&file) {
            return known;
        }
        let is_deferred = self.is_evaluated_before_importers(file)
            && self.pure_prefix_end(file) == u32::MAX
            && self.is_order_independent(file);
        self.aot.storage.deferred_modules.insert(file, is_deferred);
        is_deferred
    }

    fn is_order_independent(&mut self, file: FileId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        (0..hir.exprs.len() as u32).map(ExprId).all(|e| {
            let ExprKind::Ident(name) = hir[e].kind else { return true };
            if matches!(bound.expr_parent[e.idx()], Parent::None) || bound.is_in_type_query(e) || self.enclosing_fn_of_expr(file, e).is_some() {
                return true;
            }
            if bound.expr_symbol[e.idx()].is_none() {
                return FIXED_GLOBALS.contains(&self.atoms().bytes(name));
            }
            let Some(sym) = self.resolved_symbol_for(file, e, name) else { return false };
            let is_operand_of_call = matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Call(_)));
            !matches!(self.variable_declaration(sym), Some((of, Decl::Var(_))) if of != file && (is_operand_of_call || !self.is_constant(sym)))
        })
    }

    pub fn explain_modules(&mut self, roots: &[FileId], modules: &[FileId]) -> Vec<String> {
        let Some(graph) = self.p.aot.storage.modules.get() else {
            return Vec::new();
        };
        let closure = |from: Vec<FileId>, follows: &dyn Fn(EvaluationTime) -> bool| {
            let (mut seen, mut pending) = (FxHashSet::default(), from);
            while let Some(module) = pending.pop() {
                if seen.insert(module) {
                    pending.extend(
                        graph
                            .evaluates
                            .get(&module)
                            .into_iter()
                            .flatten()
                            .filter(|edge| follows(edge.1))
                            .map(|edge| edge.0),
                    );
                }
            }
            seen
        };
        let at_start = closure(roots.to_vec(), &|how| {
            matches!(how, EvaluationTime::First | EvaluationTime::InModuleBody)
        });
        let without_import_calls = closure(roots.to_vec(), &|how| {
            !matches!(
                how,
                EvaluationTime::Later | EvaluationTime::DeferredFromModuleBody
            )
        });
        let reached = closure(roots.to_vec(), &|_| true);
        let mut counts = [[0u32; 6]; 4];
        let mut does: FxHashMap<FileId, u32> = FxHashMap::default();
        for &file in modules {
            let hir = self.hir(file);
            if hir.kind == FileKind::Declaration {
                continue;
            }
            let module = self.files().module(file);
            let kind = match () {
                _ if module.builtin.is_some() => 4,
                _ if hir.kind == FileKind::Json => 3,
                _ if module.is_commonjs() => 2,
                _ if module.is_untyped() => 1,
                _ => 0,
            };
            let place = if at_start.contains(&file) {
                0
            } else if without_import_calls.contains(&file) {
                1
            } else if reached.contains(&file) {
                2
            } else {
                3
            };
            counts[place][kind] += 1;
            let mut statements = 0;
            if kind < 2 {
                for stmt in hir.ids(hir.body) {
                    statements += u32::from(self.impurity_reason(file, stmt).is_some());
                }
            }
            counts[place][5] += statements;
            if kind != 4 {
                does.insert(file, statements);
            }
        }
        let is_static = |how: EvaluationTime| {
            matches!(how, EvaluationTime::First | EvaluationTime::InModuleBody)
        };
        let size_of = |members: &FxHashSet<FileId>| {
            members
                .iter()
                .filter_map(|module| does.get(module))
                .fold((0u32, 0u32), |sum, &statements| {
                    (sum.0 + 1, sum.1 + statements)
                })
        };
        let (mut evaluated, mut level, mut levels, mut targets): (
            FxHashSet<FileId>,
            _,
            Vec<String>,
            FxHashSet<FileId>,
        ) = (
            FxHashSet::default(),
            at_start,
            Vec::new(),
            FxHashSet::default(),
        );
        while !level.is_empty() {
            evaluated.extend(level.iter().copied());
            let doors: Vec<(FileId, EvaluationTime)> = level
                .iter()
                .flat_map(|module| graph.evaluates.get(module).into_iter().flatten())
                .filter(|edge| !is_static(edge.1))
                .copied()
                .collect();
            targets.extend(doors.iter().map(|door| door.0));
            let ((modules, statements), outside) = (
                size_of(&level),
                doors
                    .iter()
                    .filter(|door| door.1 == EvaluationTime::DeferredFromModuleBody)
                    .count(),
            );
            levels.push(format!("{}: modules {modules}, statements {statements}, doors {} ({outside} outside every function)", levels.len(), doors.len()));
            level = closure(doors.into_iter().map(|door| door.0).collect(), &is_static)
                .into_iter()
                .filter(|module| !evaluated.contains(module))
                .collect();
        }
        let mut sizes: Vec<(u32, u32)> = targets
            .iter()
            .map(|&target| size_of(&closure(vec![target], &is_static)))
            .collect();
        sizes.sort_unstable_by(|a, b| b.cmp(a));
        let line = |what: &str, of: [u32; 6]| {
            format!(
                "deferred: modules {what} {}: typed {}, untyped {}, CommonJS {}, JSON {}, of the runtime {}",
                of[..5].iter().sum::<u32>(),
                of[0],
                of[1],
                of[2],
                of[3],
                of[4]
            )
        };
        vec![
            line("at the start", counts[0]),
            line("behind require(..) in a function", counts[1]),
            line("behind import(..)", counts[2]),
            line("that no import of the program leads to", counts[3]),
            format!(
                "deferred: statements that do something, in ES modules at the start {}, behind require(..) in a function {}, behind import(..) {}",
                counts[0][5], counts[1][5], counts[2][5]
            ),
            format!("deferred: levels: {}", levels.join("; ")),
            format!(
                "deferred: targets of a door {}: the largest by what they import without passing another door, modules / statements: {}",
                sizes.len(),
                sizes
                    .iter()
                    .take(10)
                    .map(|size| format!("{} / {}", size.0, size.1))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ]
    }

    pub fn explain_deferred(&mut self, modules: &[FileId]) -> Vec<String> {
        let [
            mut all,
            mut deferred,
            mut on_demand,
            mut not_first,
            mut not_inert,
            mut not_timeless,
        ] = [0u32; 6];
        let [
            mut statements,
            mut inert,
            mut in_prefix,
            mut in_deferred,
            mut where_first,
            mut in_inert_not_first,
        ] = [0u32; 6];
        let (mut first, mut every): (FxHashMap<&'static str, u32>, FxHashMap<&'static str, u32>) =
            Default::default();
        for &file in modules {
            let hir = self.hir(file);
            if self.files().module(file).builtin.is_some() || hir.kind == FileKind::Declaration {
                continue;
            }
            all += 1;
            if self.files().module(file).is_commonjs() || hir.kind == FileKind::Json {
                on_demand += 1;
                continue;
            }
            let (is_deferred, end, is_first_of_all) = (
                self.is_deferred_module(file),
                self.pure_prefix_end(file),
                self.is_evaluated_before_importers(file),
            );
            match (is_deferred, end == u32::MAX, is_first_of_all) {
                (true, ..) => deferred += 1,
                (_, false, _) => not_inert += 1,
                (_, _, false) => not_first += 1,
                _ => not_timeless += 1,
            }
            let mut is_first = true;
            for stmt in hir.ids(hir.body) {
                let Some(obstacle) = self.impurity_reason(file, stmt) else {
                    continue;
                };
                statements += 1;
                match obstacle {
                    None => {
                        inert += 1;
                        in_prefix += u32::from(hir[stmt].loc.pos < end);
                        in_deferred += u32::from(is_deferred);
                        where_first += u32::from(is_first_of_all);
                        in_inert_not_first += u32::from(end == u32::MAX && !is_first_of_all);
                    }
                    Some(what) => {
                        *every.entry(what).or_default() += 1;
                        if std::mem::take(&mut is_first) {
                            *first.entry(what).or_default() += 1;
                        }
                    }
                }
            }
        }
        let [mut declarations, mut lazy] = [0u32; 2];
        for &file in modules {
            let hir = self.hir(file);
            if self.files().module(file).builtin.is_some() || hir.kind == FileKind::Declaration {
                continue;
            }
            for stmt in hir.ids(hir.body) {
                let StmtKind::Var(decls) = hir[stmt].kind else {
                    continue;
                };
                for d in decls
                    .iter()
                    .filter(|&d| !hir[d].flags.contains(Flags::AMBIENT) && hir[d].init.is_some())
                {
                    declarations += 1;
                    lazy += u32::from(self.declares_lazy_variable(file, d));
                }
            }
        }
        let by_count = |counts: FxHashMap<&'static str, u32>| {
            let mut counts: Vec<(&'static str, u32)> = counts.into_iter().collect();
            counts.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
            counts
                .into_iter()
                .map(|(what, count)| format!("{what} {count}"))
                .collect::<Vec<_>>()
                .join(", ")
        };
        vec![
            format!(
                "deferred: modules {all}: deferred {deferred}, evaluated on demand anyway {on_demand}, not put first {not_first}, not inert {not_inert}, not timeless {not_timeless}"
            ),
            format!(
                "deferred: statements that do something {statements}: inert {inert}, of them where the module is put first {where_first}, in the inert prefix of their module {in_prefix}, in deferred modules {in_deferred}, in modules that are inert but not put first {in_inert_not_first}"
            ),
            format!("deferred: first: {}", by_count(first)),
            format!("deferred: every: {}", by_count(every)),
            format!(
                "deferred: top-level variables with an initializer {declarations}: lazy {lazy}"
            ),
        ]
    }

    fn impurity_reason(&mut self, file: FileId, stmt: StmtId) -> Option<Option<&'static str>> {
        let hir = self.hir(file);
        Some(match hir[stmt].kind {
            StmtKind::Empty
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Fn(_)
            | StmtKind::Enum(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => return None,
            StmtKind::Var(decls) => {
                if decls.iter().all(|d| hir[d].flags.contains(Flags::AMBIENT)) {
                    return None;
                }
                decls.iter().find_map(|d| match hir[hir[d].pat].kind {
                    PatKind::Ident(_) => (!self.is_pure_expr(file, hir[d].init))
                        .then(|| self.impure_part(file, hir[d].init)),
                    _ => Some("a pattern"),
                })
            }
            StmtKind::Expr(e) | StmtKind::ExportDefault(e) => {
                (!self.is_pure_expr(file, e)).then(|| self.impure_part(file, e))
            }
            StmtKind::Class(class) if hir[class].flags.contains(Flags::AMBIENT) => return None,
            StmtKind::Class(class) => {
                (!self.is_pure_class(file, class)).then(|| self.impure_class_part(file, class))
            }
            StmtKind::Module(module) if hir[module].flags.contains(Flags::AMBIENT) => return None,
            StmtKind::Module(_) => Some("a namespace"),
            _ => Some("control flow"),
        })
    }

    fn impure_part(&mut self, file: FileId, e: ExprId) -> &'static str {
        let hir = self.hir(file);
        let parts: Vec<ExprId> = match hir[e].kind {
            ExprKind::Array(elements) => hir.ids(elements).collect(),
            ExprKind::Object(props) => props.iter().map(|p| hir[p].value).collect(),
            ExprKind::Cond { test, yes, no } => vec![test, yes, no],
            ExprKind::Binary { left, right, .. } => vec![left, right],
            ExprKind::Unary { operand: part, .. }
            | ExprKind::Satisfies { expr: part, .. }
            | ExprKind::AsConst(part)
            | ExprKind::As { expr: part, .. } => vec![part],
            _ => Vec::new(),
        };
        if let Some(part) = parts
            .into_iter()
            .find(|&part| !self.is_pure_expr(file, part))
        {
            return self.impure_part(file, part);
        }
        match hir[e].kind {
            ExprKind::Call(call) | ExprKind::New(call) => {
                let label = self.callee_label(
                    file,
                    hir[call].callee,
                    matches!(hir[e].kind, ExprKind::New(_)),
                );
                match self.walked(file, e) {
                    _ if !matches!(
                        label,
                        "f(..): a typed function of the program"
                            | "new C(..): a typed class of the program"
                    ) =>
                    {
                        label
                    }
                    Ok(_) => "walk: fine, but for names that may be early",
                    Err("") => label,
                    Err(why) => why,
                }
            }
            ExprKind::TaggedTemplate(_) => "a tagged template",
            ExprKind::Dot { .. } | ExprKind::Index { .. } => "a property read",
            ExprKind::Template { .. } => "a template",
            ExprKind::Spread(_) => "a spread",
            ExprKind::Assign { .. } => "an assignment",
            ExprKind::Await(_) => "await",
            ExprKind::As { .. } | ExprKind::NonNull(_) => "a cast",
            ExprKind::Ident(_) => "a name",
            ExprKind::Jsx(_) => "JSX",
            ExprKind::Object(_) => "a member of a literal",
            ExprKind::Class(class) => self.impure_class_part(file, class),
            ExprKind::ImportCall { .. } => "import(..)",
            ExprKind::ImportMeta => "import.meta",
            _ => "another expression",
        }
    }

    pub fn is_lazy_variable(&mut self, sym: Sym) -> bool {
        self.lazy_variable_declaration(sym).is_some()
    }

    pub fn lazy_variable_declaration(&mut self, sym: Sym) -> Option<(FileId, VarDeclId)> {
        if let Some(&known) = self.aot.storage.lazy_variables.get(&sym) {
            return known;
        }
        let found = self.find_lazy_variable_declaration(sym);
        self.aot.storage.lazy_variables.insert(sym, found);
        found
    }

    fn find_lazy_variable_declaration(&mut self, sym: Sym) -> Option<(FileId, VarDeclId)> {
        let (file, Decl::Var(pat)) = self.files().value_declaration(sym)? else {
            return None;
        };
        let PatParent::Var(d) = self.bound(file).pat_parent[pat.idx()] else {
            return None;
        };
        self.declares_lazy_variable(file, d).then_some((file, d))
    }

    fn declares_lazy_variable(&mut self, file: FileId, d: VarDeclId) -> bool {
        if let Some(&known) = self.aot.storage.lazy_declarations.get(&(file, d)) {
            return known.unwrap_or(false);
        }
        self.aot.storage.lazy_declarations.insert((file, d), None);
        let found = self.has_deferrable_initializer(file, d)
            && self.is_used_after_evaluation(file, d)
            && !self.is_used_during_evaluation(file, d);
        self.aot
            .storage
            .lazy_declarations
            .insert((file, d), Some(found));
        found
    }

    fn is_used_after_evaluation(&mut self, file: FileId, d: VarDeclId) -> bool {
        let local = self
            .bound(file)
            .symbol_of_declaration(Decl::Var(self.hir(file)[d].pat));
        let uses = self.top_level_uses(file);
        uses.later.contains(&local)
            || uses
                .in_initializers
                .iter()
                .any(|&(named, by)| named == local && self.declares_lazy_variable(file, by))
    }

    fn is_used_during_evaluation(&mut self, file: FileId, d: VarDeclId) -> bool {
        let local = self
            .bound(file)
            .symbol_of_declaration(Decl::Var(self.hir(file)[d].pat));
        let uses = self.top_level_uses(file);
        uses.during.contains(&local)
            || uses
                .in_initializers
                .iter()
                .any(|&(named, by)| named == local && !self.declares_lazy_variable(file, by))
    }

    fn top_level_uses(&self, file: FileId) -> &'p TopLevelUses {
        let program = self.p;
        program
            .aot
            .storage
            .top_level_uses
            .get_or_init(program.files.modules.len(), file, || {
                self.find_top_level_uses(file)
            })
    }

    fn find_top_level_uses(&self, file: FileId) -> TopLevelUses {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut uses = TopLevelUses::default();
        let (mut ends_of_climbs, mut passed): (FxHashMap<ExprId, UsedFrom>, Vec<ExprId>) =
            (FxHashMap::default(), Vec::new());
        for &e in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
            let (symbol, mut parent) = (bound.expr_symbol[e.idx()], bound.expr_parent[e.idx()]);
            if symbol.is_none() || parent == Parent::None || bound.is_in_type_query(e) {
                continue;
            }
            if matches!(parent, Parent::Stmt(stmt) if matches!(hir[stmt].kind, StmtKind::ExportDefault(_)))
            {
                uses.later.insert(symbol);
                continue;
            }
            passed.clear();
            let used_from = loop {
                parent = match parent {
                    Parent::Expr(outer) if outer.is_some() => {
                        if !ends_of_climbs.is_empty()
                            && let Some(&known) = ends_of_climbs.get(&outer)
                        {
                            break known;
                        }
                        passed.push(outer);
                        bound.expr_parent[outer.idx()]
                    }
                    Parent::Stmt(stmt) if stmt.is_some() => bound.stmt_parent[stmt.idx()],
                    Parent::FnBody(_) | Parent::ParamDefault(_) => break UsedFrom::Later,
                    Parent::MemberInit(member) if !hir[member].flags.contains(Flags::STATIC) => {
                        break UsedFrom::Later;
                    }
                    Parent::VarInit(by)
                        if matches!(
                            bound.stmt_parent[bound.var_stmt[by.idx()].idx()],
                            Parent::File
                        ) =>
                    {
                        break UsedFrom::Initializer(by);
                    }
                    Parent::File => break UsedFrom::During,
                    Parent::None => break UsedFrom::Nowhere,
                    _ => self.parent_of_node(file, parent),
                };
            };
            if passed.len() >= 32 {
                ends_of_climbs.extend(passed.iter().map(|&outer| (outer, used_from)));
            }
            match used_from {
                UsedFrom::Later => {
                    uses.later.insert(symbol);
                }
                UsedFrom::Initializer(by) => uses.in_initializers.push((symbol, by)),
                UsedFrom::During => {
                    uses.during.insert(symbol);
                }
                UsedFrom::Nowhere => {}
            }
        }
        for symbol in bound.symbols.iter().filter(|symbol| {
            symbol.flags.contains(SymFlags::EXPORT_VALUE) && symbol.export_symbol.is_some()
        }) {
            uses.later.insert(symbol.export_symbol);
        }
        for (i, export) in hir
            .exports
            .iter()
            .enumerate()
            .filter(|export| export.1.spec.is_none())
        {
            for item in export.items.iter() {
                if let Some(exported) = self.files().resolve_name(
                    file,
                    bound.export_scope[i],
                    hir[item].local,
                    SymFlags::VALUE,
                ) && exported.file == file
                {
                    uses.later.insert(exported.id);
                }
            }
        }
        uses
    }

    fn has_deferrable_initializer(&mut self, file: FileId, d: VarDeclId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let stmt = bound.var_stmt[d.idx()];
        hir[d].kind == VarKind::Const
            && !hir[d].flags.contains(Flags::AMBIENT)
            && matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
            && stmt.is_some()
            && matches!(hir[stmt].kind, StmtKind::Var(_))
            && matches!(bound.stmt_parent[stmt.idx()], Parent::File)
            && self.files().module(file).is_module()
            && hir[d].init.is_some()
            && (self.is_deferrable_by_form(file, hir[d].init)
                || self.is_marked_deferrable(file, hir[d].init))
    }

    fn is_deferrable_by_form(&mut self, file: FileId, e: ExprId) -> bool {
        self.is_syntactically_deferrable(file, e)
            || self.walked(file, e).is_ok_and(|walked| walked.is_object)
    }

    fn is_syntactically_deferrable(&mut self, file: FileId, e: ExprId) -> bool {
        self.allocates_value(file, e)
            && self.is_pure_expr(file, e)
            && self.is_time_invariant(file, e)
    }

    fn is_marked_deferrable(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::As { expr, .. }
            | ExprKind::NonNull(expr) => self.is_marked_deferrable(file, expr),
            ExprKind::Call(call) | ExprKind::New(call) => {
                hir[call].chain == Chain::No
                    && self
                        .p
                        .aot
                        .storage
                        .marked_pure
                        .get()
                        .and_then(|marked| marked.get(&file))
                        .is_some_and(|calls| calls.binary_search(&e.0).is_ok())
                    && self.is_callee_always_available(file, hir[call].callee)
                    && hir.ids(hir[call].args).all(|argument| {
                        !matches!(hir[argument].kind, ExprKind::Spread(_))
                            && (self.is_marked_deferrable(file, argument)
                                || self.is_pure_expr(file, argument)
                                    && self.is_time_invariant(file, argument))
                    })
            }
            _ => false,
        }
    }

    fn is_callee_always_available(&mut self, file: FileId, callee: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[callee].kind {
            ExprKind::Ident(name) => {
                self.is_pure_expr(file, callee) && self.is_time_invariant_name(file, callee, name)
            }
            ExprKind::Dot {
                obj,
                chain: Chain::No,
                ..
            } => self.is_callee_always_available(file, obj),
            ExprKind::Fn(_) => true,
            _ => false,
        }
    }

    pub fn has_separate_state(&mut self, sym: Sym) -> bool {
        let Some((file, d)) = self.lazy_variable_declaration(sym) else {
            return false;
        };
        let hir = self.hir(file);
        let mut e = hir[d].init;
        while let ExprKind::Satisfies { expr, .. }
        | ExprKind::AsConst(expr)
        | ExprKind::As { expr, .. }
        | ExprKind::NonNull(expr) = hir[e].kind
        {
            e = expr;
        }
        self.p
            .aot
            .storage
            .marked_pure
            .get()
            .and_then(|marked| marked.get(&file))
            .is_some_and(|calls| calls.binary_search(&e.0).is_ok())
    }

    pub fn runs_code_when_initialized(&mut self, sym: Sym) -> bool {
        self.reaches_marked_deferrable(sym, &mut Vec::new())
    }

    fn reaches_marked_deferrable(&mut self, sym: Sym, seen: &mut Vec<VarDeclId>) -> bool {
        let Some((file, d)) = self.lazy_variable_declaration(sym) else {
            return false;
        };
        if seen.contains(&d) {
            return false;
        }
        seen.push(d);
        let initializer = self.hir(file)[d].init;
        if !self.is_deferrable_by_form(file, initializer) {
            return true;
        }
        let uses = self.top_level_uses(file);
        uses.in_initializers.iter().any(|&(named, by)| {
            by == d && self.reaches_marked_deferrable(Sym { file, id: named }, seen)
        })
    }

    fn allocates_value(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_) | ExprKind::New(_) | ExprKind::Regex | ExprKind::String(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::As { expr, .. } => self.allocates_value(file, expr),
            ExprKind::Call(call) => match self.pure_allocator_call_target(file, call) {
                Some((of, func)) => match self.hir(of)[func].body {
                    FnBody::Expr(returned) => self.allocates_value(of, returned),
                    FnBody::Block(statements) => self.hir(of).ids(statements).last().is_some_and(|last| matches!(self.hir(of)[last].kind, StmtKind::Return(returned) if self.allocates_value(of, returned))),
                    FnBody::None => false,
                },
                None => match self.walked(file, e) {
                    Ok(walked) => walked.is_object,
                    Err(_) => hir[call].args.len() == 1 && hir.ids(hir[call].args).all(|argument| self.allocates_value(file, argument)),
                },
            },
            _ => false,
        }
    }

    fn is_time_invariant(&mut self, file: FileId, e: ExprId) -> bool {
        if e.is_none() {
            return true;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => self.is_time_invariant_name(file, e, name),
            ExprKind::Array(elements) => hir
                .ids(elements)
                .all(|element| self.is_time_invariant(file, element)),
            ExprKind::Object(props) => props
                .iter()
                .all(|p| self.is_time_invariant(file, hir[p].value)),
            ExprKind::Class(class) => {
                let extends = hir[class].extends;
                (extends.is_none()
                    || matches!(hir[extends].kind, ExprKind::Ident(name) if self.bound(file).expr_symbol[extends.idx()].is_none() || self.refers_to_class_or_function(file, extends, name, false)))
                    && self.is_time_invariant(file, extends)
                    && hir[class].members.iter().all(|member| {
                        hir[member].kind != MemberKind::Property
                            || !hir[member].flags.contains(Flags::STATIC)
                            || self.is_time_invariant(file, hir[member].init)
                    })
            }
            ExprKind::New(call) => {
                self.walked(file, e).is_ok()
                    || self.is_time_invariant(file, hir[call].callee)
                        && hir
                            .ids(hir[call].args)
                            .all(|argument| self.is_time_invariant(file, argument))
            }
            ExprKind::Call(call) => {
                let only_allocates = self.pure_allocator_call_target(file, call).is_some();
                self.walked(file, e).is_ok()
                    || hir.ids(hir[call].args).all(|argument| {
                        (only_allocates || self.allocates_value(file, argument))
                            && self.is_time_invariant(file, argument)
                    })
            }
            ExprKind::Unary { operand, .. } => self.is_time_invariant(file, operand),
            ExprKind::Binary { left, right, .. } => {
                self.is_time_invariant(file, left) && self.is_time_invariant(file, right)
            }
            ExprKind::Cond { test, yes, no } => {
                self.is_time_invariant(file, test)
                    && self.is_time_invariant(file, yes)
                    && self.is_time_invariant(file, no)
            }
            ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::As { expr, .. } => self.is_time_invariant(file, expr),
            _ => true,
        }
    }

    fn is_time_invariant_name(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        if self.bound(file).expr_symbol[e.idx()].is_none() {
            return FIXED_GLOBALS.contains(&self.atoms().bytes(name));
        }
        let Some(sym) = self.resolved_symbol_for(file, e, name) else {
            return false;
        };
        match self.variable_declaration(sym) {
            Some((_, Decl::Var(_))) => self.is_constant(sym),
            Some((of, decl @ (Decl::Fn(_) | Decl::Class(_)))) => {
                let local = self.bound(of).symbol_of_declaration(decl);
                local.is_some()
                    && self.bound(of).assignments_to(local).is_empty()
                    && !self.is_stored_through_casts(of, local)
            }
            Some((_, Decl::Enum(_))) => true,
            _ => false,
        }
    }

    fn callee_label(&mut self, file: FileId, callee: ExprId, is_new: bool) -> &'static str {
        let hir = self.hir(file);
        let pick = |call: &'static str, new: &'static str| if is_new { new } else { call };
        match hir[callee].kind {
            ExprKind::Ident(name) => {
                if self.bound(file).expr_symbol[callee.idx()].is_none() {
                    return match self.atoms().bytes(name) {
                        b"Map" | b"Set" | b"WeakMap" | b"WeakSet" if is_new => {
                            "new <collection>(..) with arguments"
                        }
                        b"Error" | b"TypeError" | b"RangeError" | b"SyntaxError"
                        | b"ReferenceError" | b"EvalError" | b"URIError" | b"AggregateError"
                            if is_new =>
                        {
                            "new <error>(..)"
                        }
                        _ => pick("f(..): a global", "new C(..): another global"),
                    };
                }
                let Some(sym) = self.resolved_symbol_for(file, callee, name) else {
                    return pick("f(..): not resolved", "new C(..): not resolved");
                };
                let Some((of, decl)) = self.variable_declaration(sym) else {
                    return pick("f(..): not resolved", "new C(..): not resolved");
                };
                if self.hir(of).kind == FileKind::Declaration {
                    return pick(
                        "f(..): of a module that is only declared",
                        "new C(..): of a module that is only declared",
                    );
                }
                let is_untyped = self.files().module(of).is_untyped();
                let known = match decl {
                    Decl::Fn(_) | Decl::Class(_) => true,
                    Decl::Var(pat) => {
                        matches!(root_declaration(self.bound(of), pat), PatParent::Var(d) if self.hir(of)[d].kind == VarKind::Const && self.hir(of)[d].pat == pat && matches!(self.hir(of)[self.hir(of)[d].init].kind, ExprKind::Fn(_) | ExprKind::Class(_)))
                    }
                    Decl::Param(_) => return pick("f(..): a parameter", "new C(..): a parameter"),
                    _ => false,
                };
                match (known, is_untyped) {
                    (true, false) => pick(
                        "f(..): a typed function of the program",
                        "new C(..): a typed class of the program",
                    ),
                    (true, true) => pick(
                        "f(..): an untyped function of the program",
                        "new C(..): an untyped class of the program",
                    ),
                    (false, false) => pick(
                        "f(..): a variable of typed code",
                        "new C(..): a variable of typed code",
                    ),
                    (false, true) => pick(
                        "f(..): a variable of untyped code",
                        "new C(..): a variable of untyped code",
                    ),
                }
            }
            ExprKind::Dot { obj, .. } => match hir[obj].kind {
                ExprKind::Ident(name) => {
                    if self.bound(file).expr_symbol[obj.idx()].is_none() {
                        return pick("o.m(..): on a global", "new o.C(..): on a global");
                    }
                    let Some(sym) = self.resolved_symbol_for(file, obj, name) else {
                        return pick("o.m(..): not resolved", "new o.C(..): not resolved");
                    };
                    let declared = self.files().value_declaration(sym);
                    let Some((of, decl)) = declared else {
                        return pick("o.m(..): not resolved", "new o.C(..): not resolved");
                    };
                    if self.hir(of).kind == FileKind::Declaration {
                        return pick(
                            "o.m(..): on a module or value that is only declared",
                            "new o.C(..): on a module or value that is only declared",
                        );
                    }
                    let is_untyped = self.files().module(of).is_untyped();
                    match (decl, is_untyped) {
                        (Decl::File | Decl::Module(_), false) => pick(
                            "o.m(..): on a namespace of typed code",
                            "new o.C(..): on a namespace of typed code",
                        ),
                        (Decl::File | Decl::Module(_), true) => pick(
                            "o.m(..): on a namespace of untyped code",
                            "new o.C(..): on a namespace of untyped code",
                        ),
                        (Decl::Class(_), false) => {
                            pick("o.m(..): on a typed class", "new o.C(..): on a typed class")
                        }
                        (Decl::Class(_), true) => pick(
                            "o.m(..): on an untyped class",
                            "new o.C(..): on an untyped class",
                        ),
                        (_, false) => pick(
                            "o.m(..): on a variable of typed code",
                            "new o.C(..): on a variable of typed code",
                        ),
                        (_, true) => pick(
                            "o.m(..): on a variable of untyped code",
                            "new o.C(..): on a variable of untyped code",
                        ),
                    }
                }
                ExprKind::Call(_) | ExprKind::New(_) => pick(
                    "o.m(..): on the result of a call",
                    "new o.C(..): on the result of a call",
                ),
                ExprKind::Dot { .. } => {
                    pick("o.m(..): on a property", "new o.C(..): on a property")
                }
                _ => pick(
                    "o.m(..): on something else",
                    "new o.C(..): on something else",
                ),
            },
            ExprKind::Fn(_) => pick("a function that is called where it stands", "another new"),
            _ => pick("another call", "another new"),
        }
    }

    fn impure_class_part(&mut self, file: FileId, class: ClassId) -> &'static str {
        let hir = self.hir(file);
        let is_decorated = |modifiers: Span<ModifierId>| {
            modifiers
                .iter()
                .any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)))
        };
        let extends = hir[class].extends;
        if is_decorated(hir[class].modifiers)
            || hir[class]
                .members
                .iter()
                .any(|member| is_decorated(hir[member].modifiers))
        {
            return "a class: a decorator";
        }
        if extends.is_some()
            && !matches!(hir[extends].kind, ExprKind::Ident(name) if self.is_pure_identifier_read(file, extends, name) || self.refers_to_global(file, extends, name))
        {
            return if matches!(hir[extends].kind, ExprKind::Ident(_)) {
                "a class: extends a name that is not inert"
            } else {
                "a class: extends an expression"
            };
        }
        for member in hir[class].members.iter() {
            let m = &hir[member];
            if matches!(m.key, PropKey::Computed(_)) {
                return "a class: a computed key";
            }
            if m.kind == MemberKind::StaticBlock {
                return "a class: a static block";
            }
            if m.flags.contains(Flags::ACCESSOR) {
                return "a class: an `accessor`";
            }
            if m.kind == MemberKind::Property
                && m.flags.contains(Flags::STATIC)
                && !self.is_pure_expr(file, m.init)
            {
                return "a class: a static field that is not inert";
            }
        }
        "a class"
    }

    pub fn is_default_export_equivalent_to_binding(
        &mut self,
        file: FileId,
        e: ExprId,
        sym: Sym,
    ) -> bool {
        if self.is_evaluated_before_importers(file)
            && !self
                .p
                .aot
                .storage
                .lazy_modules
                .get()
                .is_some_and(|lazy_modules| lazy_modules.contains(&file))
        {
            return true;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Stmt(export) = bound.expr_parent[e.idx()] else {
            return false;
        };
        let from = match self.variable_declaration(sym) {
            Some((of, decl @ (Decl::Var(_) | Decl::Class(_)))) if of == file => {
                match self.tdz_of(file, decl) {
                    Some((Site::File, end)) if end != u32::MAX => end,
                    _ => return false,
                }
            }
            Some((of, Decl::Fn(_))) if of == file => 0,
            _ => return false,
        };
        let to = hir[export].loc.pos;
        for stmt in hir.ids(hir.body) {
            let at = hir[stmt].loc;
            if at.pos >= to || at.end <= from {
                continue;
            }
            let is_pure_expr = match hir[stmt].kind {
                StmtKind::Var(decls) => decls.iter().filter(|&d| hir[d].loc.pos >= from).all(|d| {
                    matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
                        && self.is_pure_expr(file, hir[d].init)
                }),
                _ if at.pos < from => true,
                _ => self.is_pure_statement(file, stmt),
            };
            if !is_pure_expr {
                return false;
            }
        }
        from <= to
    }

    fn is_evaluated_before_importers(&self, module: FileId) -> bool {
        let shared = &self.p.aot.storage;
        shared.modules.get().is_some_and(|modules| {
            *shared.evaluates_before_importers_cache.get_or_init(
                self.p.files.modules.len(),
                module,
                || modules.evaluates_before_importers(module),
            )
        })
    }

    fn pure_prefix_end(&mut self, file: FileId) -> u32 {
        if let Some(&known) = self.aot.storage.pure_prefix_ends.borrow().get(&file) {
            return known;
        }
        self.aot
            .storage
            .pure_prefix_ends
            .borrow_mut()
            .insert(file, 0);
        let hir = self.hir(file);
        let mut end = u32::MAX;
        'statements: for stmt in hir.ids(hir.body) {
            match hir[stmt].kind {
                StmtKind::Var(decls) => {
                    for d in decls.iter() {
                        let is_pure_expr = hir[d].flags.contains(Flags::AMBIENT)
                            || matches!(hir[d].kind, VarKind::Var | VarKind::Let | VarKind::Const)
                                && matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
                                && self.is_pure_expr(file, hir[d].init);
                        if !is_pure_expr {
                            end = hir[d].loc.pos;
                            break 'statements;
                        }
                    }
                }
                _ if self.is_pure_statement(file, stmt) => {}
                _ => {
                    end = hir[stmt].loc.pos;
                    break;
                }
            }
        }
        self.aot
            .storage
            .pure_prefix_ends
            .borrow_mut()
            .insert(file, end);
        end
    }

    pub fn is_entirely_pure(&mut self, file: FileId) -> bool {
        self.pure_prefix_end(file) == u32::MAX
    }

    pub fn runs_before_importers(&self, file: FileId) -> bool {
        self.is_evaluated_before_importers(file)
    }

    pub fn is_in_import_cycle(&self, file: FileId) -> bool {
        self.p
            .aot
            .storage
            .modules
            .get()
            .is_some_and(|modules| modules.in_cycles.contains(&file))
    }

    fn is_pure_statement(&mut self, file: FileId, stmt: StmtId) -> bool {
        let hir = self.hir(file);
        match hir[stmt].kind {
            StmtKind::Empty
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Fn(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => true,
            StmtKind::Expr(e) | StmtKind::ExportDefault(e) => self.is_pure_expr(file, e),
            StmtKind::Class(class) => {
                hir[class].flags.contains(Flags::AMBIENT) || self.is_pure_class(file, class)
            }
            StmtKind::Enum(declared) => {
                hir[declared]
                    .flags
                    .intersects(Flags::AMBIENT | Flags::CONST)
                    || self.has_primitive_members(file, declared)
            }
            StmtKind::Module(module) => hir[module].flags.contains(Flags::AMBIENT),
            _ => false,
        }
    }

    fn has_primitive_members(&mut self, file: FileId, declared: EnumId) -> bool {
        let hir = self.hir(file);
        hir[declared].members.iter().all(|member| {
            hir[member].computed_name.is_none()
                && (hir[member].init.is_none()
                    || self.evaluates_to_primitive(file, hir[member].init))
        })
    }

    fn is_pure_class(&mut self, file: FileId, class: ClassId) -> bool {
        let hir = self.hir(file);
        let is_decorated = |modifiers: Span<ModifierId>| {
            modifiers
                .iter()
                .any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)))
        };
        let extends = hir[class].extends;
        !is_decorated(hir[class].modifiers)
            && (extends.is_none()
                || matches!(hir[extends].kind, ExprKind::Ident(name) if self.is_pure_identifier_read(file, extends, name) && self.refers_to_class_or_function(file, extends, name, true) || self.refers_to_global(file, extends, name)))
            && hir[class].members.iter().all(|member| {
                let m = &hir[member];
                !is_decorated(m.modifiers)
                    && !matches!(m.key, PropKey::Computed(_))
                    && m.kind != MemberKind::StaticBlock
                    && !m.flags.contains(Flags::ACCESSOR)
                    && (m.kind != MemberKind::Property
                        || !m.flags.contains(Flags::STATIC)
                        || self.is_pure_expr(file, m.init))
            })
    }

    fn refers_to_class_or_function(
        &mut self,
        file: FileId,
        e: ExprId,
        name: Atom,
        or_function: bool,
    ) -> bool {
        let Some(sym) = self.resolved_symbol_for(file, e, name) else {
            return false;
        };
        match self.variable_declaration(sym) {
            Some((_, Decl::Class(_))) => true,
            Some((_, Decl::Fn(_))) => or_function,
            _ => self.class_for_const(sym).is_some(),
        }
    }

    fn creates_typed_array(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::As { expr, .. } => self.creates_typed_array(file, expr),
            ExprKind::New(call) => {
                matches!(hir[hir[call].callee].kind, ExprKind::Ident(name) if self.atoms().bytes(name).len() > 5 && self.atoms().bytes(name).ends_with(b"Array"))
            }
            ExprKind::Call(_) => true,
            ExprKind::Cond { yes, no, .. } => {
                self.creates_typed_array(file, yes) || self.creates_typed_array(file, no)
            }
            ExprKind::Binary { left, right, .. } => {
                self.creates_typed_array(file, left) || self.creates_typed_array(file, right)
            }
            _ => false,
        }
    }

    fn is_pure_expr(&mut self, file: FileId, e: ExprId) -> bool {
        if e.is_none() {
            return true;
        }
        if self.is_half_of_stack_in_use() {
            return false;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Missing | ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Regex | ExprKind::Fn(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            ExprKind::Ident(name) => self.refers_to_global_constant(file, e, name) || self.is_pure_identifier_read(file, e, name),
            ExprKind::Array(elements) => hir.ids(elements).all(|element| self.is_pure_expr(file, element)),
            ExprKind::Object(props) => props.iter().all(|p| {
                matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method)
                    && matches!(hir[p].key, PropKey::Name(name) if self.atoms().bytes(name) != b"__proto__")
                    && self.is_pure_expr(file, hir[p].value)
            }),
            ExprKind::Class(class) => self.is_pure_class(file, class),
            ExprKind::New(call) => self.allocates_engine_object(file, call) || self.walk_cannot_throw(file, e),
            ExprKind::Call(call) => {
                if self.constant_symbol_created_by(file, e).is_some() || self.enumerates_object_literal(file, call).is_some() || self.pure_allocator_call_target(file, call).is_some() || self.walk_cannot_throw(file, e) {
                    return true;
                }
                let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[hir[call].callee].kind else { return false };
                hir[call].chain == Chain::No
                    && self.atoms().bytes(name) == b"freeze"
                    && matches!(hir[obj].kind, ExprKind::Ident(object) if self.atoms().bytes(object) == b"Object" && self.refers_to_global(file, obj, object))
                    && hir[call].args.len() == 1
                    && hir.ids(hir[call].args).all(|argument| self.is_pure_expr(file, argument) && !self.creates_typed_array(file, argument))
            }
            ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, operand } => self.is_pure_expr(file, operand),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, left, right } => self.is_pure_expr(file, left) && self.is_pure_expr(file, right),
            ExprKind::Cond { test, yes, no } => self.is_pure_expr(file, test) && self.is_pure_expr(file, yes) && self.is_pure_expr(file, no),
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => self.is_pure_expr(file, expr),
            ExprKind::As { expr, ty } => self.is_pure_expr(file, expr) && self.type_of_expr(file, expr) == self.type_from_node(file, ty),
            _ => self.evaluates_to_primitive(file, e),
        }
    }

    pub(super) fn evaluates_to_primitive(&mut self, file: FileId, e: ExprId) -> bool {
        if self.is_half_of_stack_in_use() {
            return false;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            ExprKind::Ident(name) => {
                self.refers_to_global_constant(file, e, name)
                    || self.is_pure_identifier_read(file, e, name)
                        && self
                            .const_initializer_for(file, e, name)
                            .is_some_and(|(of, init)| self.evaluates_to_primitive(of, init))
            }
            ExprKind::Unary {
                op: UnOp::Not | UnOp::Typeof | UnOp::Void,
                operand,
            } => self.is_pure_expr(file, operand),
            ExprKind::Unary {
                op: UnOp::Minus | UnOp::Plus | UnOp::BitNot,
                operand,
            } => self.evaluates_to_primitive(file, operand),
            ExprKind::Binary { op, left, right } => {
                !matches!(op, BinOp::In | BinOp::Instanceof)
                    && self.evaluates_to_primitive(file, left)
                    && self.evaluates_to_primitive(file, right)
            }
            ExprKind::Cond { test, yes, no } => {
                self.is_pure_expr(file, test)
                    && self.evaluates_to_primitive(file, yes)
                    && self.evaluates_to_primitive(file, no)
            }
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => {
                self.evaluates_to_primitive(file, expr)
            }
            ExprKind::Dot { .. } if self.is_defined_primitive(file, e) => true,
            ExprKind::Dot {
                obj,
                chain: Chain::No,
                ..
            } => {
                let ExprKind::Ident(name) = hir[obj].kind else {
                    return false;
                };
                let Some(named) = self.resolved_symbol_for(file, obj, name) else {
                    return false;
                };
                self.files().flags(named).intersects(SymFlags::ENUM)
                    && self.files().decls_of(named).iter().all(|&(of, decl)| matches!(decl, Decl::Enum(declared) if self.has_primitive_members(of, declared)))
            }
            _ => false,
        }
    }

    pub(super) fn resolved_symbol_for(
        &mut self,
        file: FileId,
        e: ExprId,
        name: Atom,
    ) -> Option<Sym> {
        let sym = self.symbol_of_identifier(file, e, name)?;
        if self.files().flags(sym).contains(SymFlags::ALIAS) {
            self.files().resolve_alias(sym)
        } else {
            Some(sym)
        }
    }

    fn refers_to_global_constant(&self, file: FileId, e: ExprId, name: Atom) -> bool {
        self.bound(file).expr_symbol[e.idx()].is_none()
            && matches!(
                self.atoms().bytes(name),
                b"undefined" | b"NaN" | b"Infinity"
            )
    }

    pub(super) fn refers_to_global(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        self.bound(file).expr_symbol[e.idx()].is_none()
            && !self.module_graph_may_replace_in(file, name)
            && self
                .symbol_of_identifier(file, e, name)
                .is_some_and(|found| self.hir(found.file).kind == FileKind::Declaration)
    }

    fn is_pure_identifier_read(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        let Some(sym) = self.resolved_symbol_for(file, e, name) else {
            return false;
        };
        let Some((of, decl)) = self.variable_declaration(sym) else {
            return false;
        };
        let hir = self.hir(of);
        if !self
            .p
            .aot
            .storage
            .modules
            .get()
            .is_some_and(|modules| modules.cycle.contains_key(&of))
            || self
                .bound(of)
                .modifier_flags(hir, decl)
                .contains(Flags::AMBIENT)
        {
            return false;
        }
        if let Decl::Var(pat) = decl
            && let PatParent::Var(d) = root_declaration(self.bound(of), pat)
            && (hir[d].init.is_none()
                || hir[d].ty.is_some()
                    && matches!(
                        hir[hir[d].ty].kind,
                        TypeNodeKind::Keyword(Keyword::Any | Keyword::Unknown)
                    ))
        {
            return false;
        }
        match decl {
            Decl::Fn(_) => true,
            Decl::Var(_) | Decl::Class(_) if of == file => {
                matches!(self.tdz_of(of, decl), Some((Site::File, end)) if end <= self.hir(file)[e].pos)
            }
            Decl::Var(_) | Decl::Class(_) => {
                let is_imported = self.p.aot.storage.modules.get().is_some_and(|modules| {
                    modules
                        .importers
                        .get(&of)
                        .is_some_and(|importers| importers.contains(&file))
                });
                is_imported && self.is_initialized_before_any_code(sym)
            }
            _ => false,
        }
    }

    fn const_initializer_for(
        &mut self,
        file: FileId,
        e: ExprId,
        name: Atom,
    ) -> Option<(FileId, ExprId)> {
        let sym = self.resolved_symbol_for(file, e, name)?;
        let (of, Decl::Var(pat)) = self.variable_declaration(sym)? else {
            return None;
        };
        let hir = self.hir(of);
        let PatParent::Var(d) = root_declaration(self.bound(of), pat) else {
            return None;
        };
        (hir[d].kind == VarKind::Const && hir[d].pat == pat && hir[d].init.is_some())
            .then_some((of, hir[d].init))
    }

    fn pure_allocator_call_target(&mut self, file: FileId, call: CallId) -> Option<(FileId, FnId)> {
        let hir = self.hir(file);
        let ExprKind::Ident(name) = hir[hir[call].callee].kind else {
            return None;
        };
        if hir[call].chain != Chain::No {
            return None;
        }
        let (of, func) = self.hoisted_function_for_name(file, hir[call].callee, name)?;
        (self.only_allocates(of, func)
            && hir
                .ids(hir[call].args)
                .all(|argument| self.is_pure_expr(file, argument)))
        .then_some((of, func))
    }

    fn hoisted_function_for_name(
        &mut self,
        file: FileId,
        e: ExprId,
        name: Atom,
    ) -> Option<(FileId, FnId)> {
        if self.bound(file).expr_symbol[e.idx()].is_none() {
            return None;
        }
        let sym = self.resolved_symbol_for(file, e, name)?;
        let (of, decl @ Decl::Fn(func)) = self.variable_declaration(sym)? else {
            return None;
        };
        let (hir, bound) = (self.hir(of), self.bound(of));
        let local = bound.symbol_of_declaration(decl);
        (hir.kind != FileKind::Declaration
            && self.is_compiled(of)
            && hir[func].kind == FnKind::Decl
            && !matches!(hir[func].body, FnBody::None)
            && bound.fns[func.idx()].enclosing.is_none()
            && local.is_some()
            && bound.symbols[local.idx()].decls.len() == 1
            && bound.assignments_to(local).is_empty()
            && !self.is_stored_through_casts(of, local))
        .then_some((of, func))
    }

    fn only_allocates(&mut self, file: FileId, func: FnId) -> bool {
        if let Some(&known) = self.aot.storage.only_allocates.get(&(file, func)) {
            return known.unwrap_or(false);
        }
        self.aot.storage.only_allocates.insert((file, func), None);
        let hir = self.hir(file);
        let f = &hir[func];
        let has_plain_parameters = f.params.iter().all(|p| {
            matches!(hir[hir[p].pat].kind, PatKind::Ident(_))
                && !hir[p].flags.contains(Flags::REST)
                && self.only_allocates_value(file, func, hir[p].default)
        });
        let found = has_plain_parameters
            && !f.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            && f.this_param.is_none()
            && match f.body {
                FnBody::Expr(returned) => self.only_allocates_value(file, func, returned),
                FnBody::Block(statements) => {
                    let all: Vec<StmtId> = hir.ids(statements).collect();
                    all.split_last().is_some_and(|(&last, before)| {
                        before.iter().all(|&stmt| {
                            matches!(hir[stmt].kind, StmtKind::Var(decls) if decls.iter().all(|d| {
                                hir[d].kind == VarKind::Const && matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) && hir[d].init.is_some() && self.only_allocates_value(file, func, hir[d].init)
                            }))
                        }) && matches!(hir[last].kind, StmtKind::Return(returned) if self.only_allocates_value(file, func, returned))
                    })
                }
                FnBody::None => false,
            };
        self.aot
            .storage
            .only_allocates
            .insert((file, func), Some(found));
        found
    }

    fn only_allocates_value(&mut self, file: FileId, func: FnId, e: ExprId) -> bool {
        if e.is_none() {
            return true;
        }
        if self.is_half_of_stack_in_use() {
            return false;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Regex | ExprKind::Fn(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            ExprKind::Ident(name) => self.refers_to_global_constant(file, e, name) || self.is_bound_in(file, func, e) || self.hoisted_function_for_name(file, e, name).is_some(),
            ExprKind::Array(elements) => hir.ids(elements).all(|element| self.only_allocates_value(file, func, element)),
            ExprKind::Object(props) => props.iter().all(|p| {
                matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method)
                    && matches!(hir[p].key, PropKey::Name(name) if self.atoms().bytes(name) != b"__proto__")
                    && self.only_allocates_value(file, func, hir[p].value)
            }),
            ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, operand } => self.only_allocates_value(file, func, operand),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, left, right } => self.only_allocates_value(file, func, left) && self.only_allocates_value(file, func, right),
            ExprKind::Cond { test, yes, no } => self.only_allocates_value(file, func, test) && self.only_allocates_value(file, func, yes) && self.only_allocates_value(file, func, no),
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => self.only_allocates_value(file, func, expr),
            ExprKind::Call(call) => {
                let ExprKind::Ident(name) = hir[hir[call].callee].kind else { return false };
                hir[call].chain == Chain::No
                    && self.hoisted_function_for_name(file, hir[call].callee, name).is_some_and(|(of, called)| self.only_allocates(of, called))
                    && hir.ids(hir[call].args).all(|argument| self.only_allocates_value(file, func, argument))
            }
            ExprKind::New(call) => self.allocates_engine_object(file, call),
            _ => false,
        }
    }

    fn walked(&mut self, file: FileId, e: ExprId) -> Result<WalkedAs, &'static str> {
        if let Some(known) = self.aot.storage.walked.get(&(file, e)) {
            return known.clone();
        }
        if self.is_half_of_stack_in_use() {
            return Err("walk: too long");
        }
        let asked = self.stack_half_used_count();
        self.aot
            .storage
            .walked
            .insert((file, e), Err("walk: itself"));
        let found = self.find_walked(file, e);
        if asked == self.stack_half_used_count() {
            self.aot.storage.walked.insert((file, e), found.clone());
        } else {
            self.aot.storage.walked.remove(&(file, e));
        }
        found
    }

    fn find_walked(&mut self, file: FileId, e: ExprId) -> Result<WalkedAs, &'static str> {
        if !self.is_walkable_file(file)
            || self.enclosing_site(file, self.bound(file).expr_parent[e.idx()]) != Some(Site::File)
        {
            return Err("");
        }
        let mut cx = Walk::new((file, self.hir(file)[e].pos));
        match self.walk(&mut cx, file, e) {
            Some(created) => Ok(WalkedAs {
                is_object: created.is_object(),
                known_initialized: cx.known_initialized.into(),
            }),
            None => Err(cx.obstacle),
        }
    }

    fn walk_cannot_throw(&mut self, file: FileId, e: ExprId) -> bool {
        self.walked(file, e)
            .is_ok_and(|walked| walked.known_initialized.is_empty())
    }

    fn is_walkable_file(&self, file: FileId) -> bool {
        let module = self.files().module(file);
        self.is_compiled(file)
            && module.builtin.is_none()
            && module.is_module()
            && !module.is_commonjs()
            && !module.is_untyped()
    }

    pub fn names_initialized_at_declaration(&mut self, sym: Sym) -> Rc<[Sym]> {
        let none = || Rc::from(Vec::new());
        let Some((file, d)) = self.lazy_variable_declaration(sym) else {
            return none();
        };
        let initializer = self.hir(file)[d].init;
        if self.is_syntactically_deferrable(file, initializer)
            || self.is_marked_deferrable(file, initializer)
        {
            return none();
        }
        self.walked(file, initializer)
            .map_or_else(|_| none(), |walked| walked.known_initialized)
    }

    fn walk(&mut self, cx: &mut Walk, file: FileId, e: ExprId) -> Option<Walked> {
        if e.is_none() {
            return Some(Walked::Undefined);
        }
        cx.steps += 1;
        if cx.steps > MAX_WALK_STEPS || cx.depth >= MAX_WALK_DEPTH {
            return cx.bail("walk: too long");
        }
        cx.depth += 1;
        let walked = self.walk_expression(cx, file, e);
        cx.depth -= 1;
        walked
    }

    fn walk_expression(&mut self, cx: &mut Walk, file: FileId, e: ExprId) -> Option<Walked> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null => Some(Walked::Null),
            ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) => {
                Some(Walked::VALUE)
            }
            ExprKind::BigInt(_) => Some(Walked::Anything {
                may_be_nullish: false,
            }),
            ExprKind::Regex => Some(Walked::Object),
            ExprKind::Template { exprs } => {
                for part in hir.ids(exprs) {
                    if !self.walk(cx, file, part)?.is_primitive() {
                        return cx.bail("walk: a conversion of what may be an object");
                    }
                }
                Some(Walked::VALUE)
            }
            ExprKind::Ident(name) => self.walk_name(cx, file, e, name),
            ExprKind::This => {
                let by = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
                match cx.running.last() {
                    Some(activation)
                        if activation.function == (file, by) && activation.this.is_some() =>
                    {
                        activation.this
                    }
                    _ => cx.bail("walk: this"),
                }
            }
            ExprKind::Fn(func) => Some(Walked::Function {
                file,
                func,
                within: cx.serial(),
            }),
            ExprKind::Array(elements) => {
                let (mut held, mut holds_lists) = (None, true);
                for element in hir.ids(elements) {
                    let part =
                        match hir[element].kind {
                            ExprKind::Missing => Some(Walked::Undefined),
                            ExprKind::Spread(list) => match self.walk(cx, file, list)? {
                                Walked::Allocated(it)
                                    if cx.created[it as usize].allocated_as == CreatedAs::List =>
                                {
                                    holds_lists &= cx.created[it as usize].holds_local_lists;
                                    cx.created[it as usize].elements
                                }
                                _ => return cx.bail(
                                    "walk: a spread of something that is not a list created there",
                                ),
                            },
                            _ => Some(self.walk(cx, file, element)?),
                        };
                    holds_lists &= matches!(hir[element].kind, ExprKind::Spread(_))
                        || part.is_some_and(|part| cx.is_list(part));
                    held = join_walked(held, part);
                }
                let list = cx.make(CreatedAs::List, Vec::new(), held);
                cx.created.last_mut()?.holds_local_lists = holds_lists;
                Some(list)
            }
            ExprKind::Object(props) => {
                let mut fields = Vec::new();
                for p in props.iter() {
                    let prop = &hir[p];
                    match (prop.kind, prop.key) {
                        (
                            PropKind::Init | PropKind::Shorthand | PropKind::Method,
                            PropKey::Name(name),
                        ) if self.atoms().bytes(name) != b"__proto__" => {
                            let value = self.walk(cx, file, prop.value)?;
                            set_walked_field(&mut fields, name, value, true);
                        }
                        (PropKind::Spread, _) => {
                            self.walk_spread(cx, file, prop.value, &mut fields, true)?
                        }
                        _ => return cx.bail("walk: a member of a literal"),
                    }
                }
                Some(cx.make(CreatedAs::Record, fields, None))
            }
            ExprKind::Dot { .. } if self.evaluates_to_primitive(file, e) => {
                Some(Walked::Primitive {
                    may_be_nullish: true,
                })
            }
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                let on = self.walk(cx, file, obj)?;
                match on {
                    Walked::Undefined | Walked::Null if chain == Chain::Start => {
                        Some(Walked::Undefined)
                    }
                    Walked::Primitive { may_be_nullish }
                        if !may_be_nullish || chain == Chain::Start =>
                    {
                        Some(if self.atoms().bytes(name) == b"length" {
                            Walked::Primitive {
                                may_be_nullish: true,
                            }
                        } else {
                            Walked::Anything {
                                may_be_nullish: true,
                            }
                        })
                    }
                    _ => self.walk_read(cx, on, name),
                }
            }
            ExprKind::Call(call) => self.walk_call(cx, file, call),
            ExprKind::New(call) => self.walk_new(cx, file, call),
            ExprKind::Unary {
                op: UnOp::Not | UnOp::Typeof,
                operand,
            } => {
                self.walk(cx, file, operand)?;
                Some(Walked::VALUE)
            }
            ExprKind::Unary {
                op: UnOp::Void,
                operand,
            } => {
                self.walk(cx, file, operand)?;
                Some(Walked::Undefined)
            }
            ExprKind::Unary {
                op: UnOp::Minus | UnOp::Plus | UnOp::BitNot,
                operand,
            } => {
                if !self.walk(cx, file, operand)?.is_primitive() {
                    return cx.bail("walk: a conversion of what may be an object");
                }
                Some(Walked::VALUE)
            }
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } => {
                let Some(at) = self.walk_variable(cx, file, operand) else {
                    return cx.bail("walk: a store to a variable not its own");
                };
                if !cx.bound[at].1.is_primitive() {
                    return cx.bail("walk: a conversion of what may be an object");
                }
                cx.bound[at].1 = if cx.bound[at].2 == cx.uncertainty {
                    Walked::VALUE
                } else {
                    cx.bound[at].1.join(Walked::VALUE)
                };
                Some(Walked::VALUE)
            }
            ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right,
            } => {
                self.walk(cx, file, left)?;
                self.walk(cx, file, right)
            }
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                left,
                right,
            } => {
                let first = self.walk(cx, file, left)?;
                self.walk_second_operand(cx, file, op, first, right)
            }
            ExprKind::Binary {
                op: BinOp::EqEqEq | BinOp::NotEqEq,
                left,
                right,
            } => {
                self.walk(cx, file, left)?;
                self.walk(cx, file, right)?;
                Some(Walked::VALUE)
            }
            ExprKind::Binary {
                op: BinOp::In | BinOp::Instanceof,
                ..
            } => cx.bail("walk: in, instanceof"),
            ExprKind::Binary { op, left, right } => {
                let (a, b) = (self.walk(cx, file, left)?, self.walk(cx, file, right)?);
                let compares_with_nullish =
                    matches!(op, BinOp::EqEq | BinOp::NotEq) && (a.is_nullish() || b.is_nullish());
                if !compares_with_nullish && !(a.is_primitive() && b.is_primitive()) {
                    return cx.bail("walk: a conversion of what may be an object");
                }
                Some(Walked::VALUE)
            }
            ExprKind::Assign { op, target, value } => {
                self.walk_assignment(cx, file, op, target, value)
            }
            ExprKind::Cond { test, yes, no } => match self.walk_test(cx, file, test)? {
                Some(true) => self.walk(cx, file, yes),
                Some(false) => self.walk(cx, file, no),
                None => {
                    cx.uncertainty += 1;
                    let (a, b) = (self.walk(cx, file, yes)?, self.walk(cx, file, no)?);
                    cx.uncertainty -= 1;
                    Some(a.join(b))
                }
            },
            ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::Instantiation { expr, .. } => self.walk(cx, file, expr),
            ExprKind::As { expr, ty } => {
                let value = self.walk(cx, file, expr)?;
                if self.type_of_expr(file, expr) != self.type_from_node(file, ty) {
                    return cx.bail("walk: a cast");
                }
                Some(value)
            }
            ExprKind::NonNull(expr) => {
                let value = self.walk(cx, file, expr)?;
                if value.may_be_nullish() {
                    return cx.bail("walk: `!` on a value that may be null or undefined");
                }
                Some(value)
            }
            ExprKind::Index { .. } => cx.bail("walk: a read by a key"),
            ExprKind::Class(_) => cx.bail("walk: a class expression"),
            ExprKind::TaggedTemplate(_) => cx.bail("walk: a tagged template"),
            ExprKind::Await(_) | ExprKind::Yield { .. } => cx.bail("walk: a coroutine"),
            ExprKind::Jsx(_) => cx.bail("walk: JSX"),
            ExprKind::ImportCall { .. } | ExprKind::ImportMeta => cx.bail("walk: import"),
            _ => cx.bail("walk: another expression"),
        }
    }

    fn walk_second_operand(
        &mut self,
        cx: &mut Walk,
        file: FileId,
        op: BinOp,
        first: Walked,
        second: ExprId,
    ) -> Option<Walked> {
        let decided = match op {
            BinOp::And if first.is_nullish() => Some(false),
            BinOp::And if first.is_object() => Some(true),
            BinOp::Or if first.is_nullish() => Some(true),
            BinOp::Or if first.is_object() => Some(false),
            BinOp::Nullish if first.is_nullish() => Some(true),
            BinOp::Nullish if !first.may_be_nullish() => Some(false),
            _ => None,
        };
        match decided {
            Some(true) => self.walk(cx, file, second),
            Some(false) => Some(first),
            None => {
                cx.uncertainty += 1;
                let other = self.walk(cx, file, second)?;
                cx.uncertainty -= 1;
                Some(if op == BinOp::And {
                    first.join(other)
                } else {
                    first.without_nullish().join(other)
                })
            }
        }
    }

    fn walk_test(&mut self, cx: &mut Walk, file: FileId, e: ExprId) -> Option<Option<bool>> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::True => Some(Some(true)),
            ExprKind::False => Some(Some(false)),
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => Some(self.walk_test(cx, file, operand)?.map(|holds| !holds)),
            ExprKind::Binary {
                op: op @ (BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq),
                left,
                right,
            } => {
                let (a, b) = (self.walk(cx, file, left)?, self.walk(cx, file, right)?);
                let is_loose = matches!(op, BinOp::EqEq | BinOp::NotEq);
                if is_loose
                    && !a.is_nullish()
                    && !b.is_nullish()
                    && !(a.is_primitive() && b.is_primitive())
                {
                    return cx.bail("walk: a conversion of what may be an object");
                }
                let are_equal = if a.is_nullish() && b.is_nullish() {
                    Some(is_loose || a == b)
                } else if a.is_nullish() && !b.may_be_nullish()
                    || b.is_nullish() && !a.may_be_nullish()
                {
                    Some(false)
                } else {
                    None
                };
                Some(
                    are_equal
                        .map(|are_equal| are_equal == matches!(op, BinOp::EqEqEq | BinOp::EqEq)),
                )
            }
            _ => {
                let value = self.walk(cx, file, e)?;
                Some(if value.is_object() {
                    Some(true)
                } else if value.is_nullish() {
                    Some(false)
                } else {
                    None
                })
            }
        }
    }

    fn walk_spread(
        &mut self,
        cx: &mut Walk,
        file: FileId,
        e: ExprId,
        fields: &mut Vec<(Atom, Walked)>,
        is_certain: bool,
    ) -> Option<()> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } => match self.walk_test(cx, file, left)? {
                Some(true) => self.walk_spread(cx, file, right, fields, is_certain),
                Some(false) => Some(()),
                None => {
                    cx.uncertainty += 1;
                    self.walk_spread(cx, file, right, fields, false)?;
                    cx.uncertainty -= 1;
                    Some(())
                }
            },
            ExprKind::Cond { test, yes, no } => match self.walk_test(cx, file, test)? {
                Some(true) => self.walk_spread(cx, file, yes, fields, is_certain),
                Some(false) => self.walk_spread(cx, file, no, fields, is_certain),
                None => {
                    cx.uncertainty += 1;
                    self.walk_spread(cx, file, yes, fields, false)?;
                    self.walk_spread(cx, file, no, fields, false)?;
                    cx.uncertainty -= 1;
                    Some(())
                }
            },
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => {
                self.walk_spread(cx, file, expr, fields, is_certain)
            }
            _ => match self.walk(cx, file, e)? {
                Walked::Undefined | Walked::Null => Some(()),
                Walked::Allocated(it)
                    if cx.created[it as usize].allocated_as == CreatedAs::Record =>
                {
                    for &(name, value) in &cx.created[it as usize].fields {
                        set_walked_field(
                            fields,
                            name,
                            value,
                            is_certain && !value.may_be_nullish(),
                        );
                    }
                    Some(())
                }
                _ => cx.bail("walk: a spread of something that is not a literal created there"),
            },
        }
    }

    fn walk_name(&mut self, cx: &mut Walk, file: FileId, e: ExprId, name: Atom) -> Option<Walked> {
        let local = self.bound(file).expr_symbol[e.idx()];
        if local.is_none() {
            let is_fixed = FIXED_GLOBALS.contains(&self.atoms().bytes(name));
            return match self.atoms().bytes(name) {
                b"undefined" => Some(Walked::Undefined),
                b"NaN" | b"Infinity" => Some(Walked::VALUE),
                _ if is_fixed => Some(Walked::Object),
                _ => cx.bail("walk: a global"),
            };
        }
        if let Some(bound) = cx.bound.iter().rev().find(|bound| bound.0 == (file, local)) {
            return Some(bound.1);
        }
        let Some(sym) = self.resolved_symbol_for(file, e, name) else {
            return cx.bail("walk: a name that is not resolved");
        };
        let Some((of, decl)) = self.variable_declaration(sym) else {
            return cx.bail("walk: a name that is not resolved");
        };
        if !self.is_walkable_file(of)
            || self
                .bound(of)
                .modifier_flags(self.hir(of), decl)
                .contains(Flags::AMBIENT)
        {
            return cx.bail("walk: a name of untyped code, or only declared");
        }
        if let Decl::Fn(_) = decl {
            return match self.hoisted_function_for_name(file, e, name) {
                Some((of, func)) => Some(Walked::Function {
                    file: of,
                    func,
                    within: 0,
                }),
                None => cx.bail("walk: a function that is not the same at all times"),
            };
        }
        if !matches!(decl, Decl::Var(_) | Decl::Class(_)) {
            return cx.bail("walk: another name");
        }
        let Some((Site::File, end)) = self.tdz_of(of, decl) else {
            return cx.bail("walk: a variable of a call that has ended");
        };
        let value = match decl {
            Decl::Var(pat) => self.walk_constant(sym, of, pat),
            _ => self
                .class_for_variable(sym)
                .map(|(of, class)| Walked::Class(of, class)),
        };
        let Some(value) = value else {
            return cx
                .bail("walk: a variable that is not a constant, or about which nothing is known");
        };
        let is_initialized = if of == cx.root.0 {
            end <= cx.root.1
        } else if self.is_evaluated_before_importers(of) {
            !self.may_be_in_tdz(sym, file, e)
        } else {
            of == file && self.is_evaluated_after(file, e, Site::File, end)
        };
        if !is_initialized && !cx.known_initialized.contains(&sym) {
            if cx.uncertainty > 0 {
                return cx.bail("walk: a name that may be early, under a condition");
            }
            cx.known_initialized.push(sym);
        }
        Some(value)
    }

    fn walk_constant(&mut self, sym: Sym, of: FileId, pat: PatId) -> Option<Walked> {
        let hir = self.hir(of);
        let PatParent::Var(d) = root_declaration(self.bound(of), pat) else {
            return None;
        };
        if hir[d].kind != VarKind::Const || hir[d].init.is_none() {
            return None;
        }
        if hir[d].pat == pat {
            if let Some(constant) = self.const_value(sym) {
                return Some(match constant {
                    Primitive::Undefined => Walked::Undefined,
                    Primitive::Null => Walked::Null,
                    _ => Walked::VALUE,
                });
            }
            let mut init = hir[d].init;
            while let ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) = hir[init].kind {
                init = expr;
            }
            match hir[init].kind {
                ExprKind::Fn(func) => {
                    return Some(Walked::Function {
                        file: of,
                        func,
                        within: 0,
                    });
                }
                ExprKind::Class(_) => {
                    return Some(
                        self.class_for_variable(sym)
                            .map_or(Walked::Object, |(of, class)| Walked::Class(of, class)),
                    );
                }
                ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::New(_) | ExprKind::Regex => {
                    return Some(Walked::Object);
                }
                _ => {}
            }
        }
        let ty = self.type_of_symbol(sym);
        (!self.is_uninformative(ty)).then_some(Walked::Anything {
            may_be_nullish: true,
        })
    }

    fn walk_variable(&mut self, cx: &Walk, file: FileId, target: ExprId) -> Option<usize> {
        let ExprKind::Ident(_) = self.hir(file)[target].kind else {
            return None;
        };
        let local = self.bound(file).expr_symbol[target.idx()];
        cx.bound
            .iter()
            .rposition(|bound| local.is_some() && bound.0 == (file, local))
    }

    fn walk_read(&mut self, cx: &mut Walk, on: Walked, name: Atom) -> Option<Walked> {
        let Walked::Allocated(it) = on else {
            return cx.bail("walk: a read from an object that it did not create");
        };
        let held = cx.created[it as usize]
            .fields
            .iter()
            .find(|field| field.0 == name)
            .map(|field| field.1);
        match cx.created[it as usize].allocated_as {
            CreatedAs::Record => match held {
                Some(held) => Some(held),
                None if OBJECT_PROTOTYPE_NAMES.contains(&self.atoms().bytes(name)) => {
                    cx.bail("walk: a read of Object.prototype")
                }
                None => Some(Walked::Undefined),
            },
            CreatedAs::Instance(of, class) => match (self.has_no_accessor(of, class, name), held) {
                (true, Some(held)) => Some(held),
                _ => cx.bail("walk: a read of an instance that finds no field"),
            },
            CreatedAs::List if self.atoms().bytes(name) == b"length" => Some(Walked::VALUE),
            CreatedAs::Collection { is_weak: false, .. } if self.atoms().bytes(name) == b"size" => {
                Some(Walked::VALUE)
            }
            _ => cx.bail("walk: a read of an object of the engine"),
        }
    }

    fn walk_store(&mut self, cx: &mut Walk, it: u32, name: Atom, value: Walked) -> Option<()> {
        let is_plain = self.atoms().bytes(name) != b"__proto__"
            && match cx.created[it as usize].allocated_as {
                CreatedAs::Record => true,
                CreatedAs::Instance(of, class) => self.has_no_accessor(of, class, name),
                _ => false,
            };
        if !is_plain || cx.created[it as usize].is_frozen {
            return cx.bail("walk: a store that is not a plain store");
        }
        let is_certain = cx.created[it as usize].uncertainty == cx.uncertainty;
        set_walked_field(&mut cx.created[it as usize].fields, name, value, is_certain);
        Some(())
    }

    fn base_class_of(&mut self, of: FileId, class: ClassId) -> Option<Option<(FileId, ClassId)>> {
        let hir = self.hir(of);
        let extends = hir[class].extends;
        if extends.is_none() {
            return Some(None);
        }
        let ExprKind::Ident(name) = hir[extends].kind else {
            return None;
        };
        let sym = self.resolved_symbol_for(of, extends, name)?;
        let extended = self.class_for_variable(sym)?;
        self.is_walkable_file(extended.0).then_some(Some(extended))
    }

    fn has_no_accessor(&mut self, of: FileId, class: ClassId, name: Atom) -> bool {
        let mut at = (of, class);
        for _ in 0..32 {
            let hir = self.hir(at.0);
            let is_in_the_way = hir[at.1].members.iter().any(|member| {
                let m = &hir[member];
                !m.flags.contains(Flags::STATIC)
                    && (matches!(m.key, PropKey::Computed(_))
                        || m.key.name() == Some(name)
                            && (m.kind != MemberKind::Property
                                || m.flags.contains(Flags::ACCESSOR)))
            });
            if is_in_the_way {
                return false;
            }
            match self.base_class_of(at.0, at.1) {
                Some(Some(extended)) => at = extended,
                Some(None) => return true,
                None => return false,
            }
        }
        false
    }

    fn walk_assignment(
        &mut self,
        cx: &mut Walk,
        file: FileId,
        op: Option<BinOp>,
        target: ExprId,
        value: ExprId,
    ) -> Option<Walked> {
        let hir = self.hir(file);
        match hir[target].kind {
            ExprKind::Ident(_) => {
                let Some(at) = self.walk_variable(cx, file, target) else {
                    return cx.bail("walk: a store to a variable not its own");
                };
                let stored = self.walk_stored(cx, file, op, cx.bound[at].1, value)?;
                cx.bound[at].1 = if cx.bound[at].2 == cx.uncertainty {
                    stored
                } else {
                    cx.bound[at].1.join(stored)
                };
                Some(stored)
            }
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => {
                let on = self.walk(cx, file, obj)?;
                let Walked::Allocated(it) = on else {
                    return cx.bail("walk: a store to an object that it did not create");
                };
                let held = if op.is_some() {
                    self.walk_read(cx, on, name)?
                } else {
                    Walked::Undefined
                };
                let stored = self.walk_stored(cx, file, op, held, value)?;
                self.walk_store(cx, it, name, stored)?;
                Some(stored)
            }
            _ => cx.bail("walk: another store"),
        }
    }

    fn walk_stored(
        &mut self,
        cx: &mut Walk,
        file: FileId,
        op: Option<BinOp>,
        held: Walked,
        value: ExprId,
    ) -> Option<Walked> {
        match op {
            None => self.walk(cx, file, value),
            Some(op @ (BinOp::And | BinOp::Or | BinOp::Nullish)) => {
                self.walk_second_operand(cx, file, op, held, value)
            }
            Some(_) => {
                if !held.is_primitive() || !self.walk(cx, file, value)?.is_primitive() {
                    return cx.bail("walk: a conversion of what may be an object");
                }
                Some(Walked::VALUE)
            }
        }
    }

    fn walk_arguments(&mut self, cx: &mut Walk, file: FileId, call: CallId) -> Option<Vec<Walked>> {
        let hir = self.hir(file);
        let mut arguments = Vec::new();
        for argument in hir.ids(hir[call].args) {
            if matches!(hir[argument].kind, ExprKind::Spread(_)) {
                return cx.bail("walk: a spread of arguments");
            }
            arguments.push(self.walk(cx, file, argument)?);
        }
        Some(arguments)
    }

    fn walk_call(&mut self, cx: &mut Walk, file: FileId, call: CallId) -> Option<Walked> {
        let hir = self.hir(file);
        let callee = hir[call].callee;
        if hir[call].chain != Chain::No {
            return cx.bail("walk: an optional call");
        }
        let (called, this) = match hir[callee].kind {
            ExprKind::Super => return self.walk_super_call(cx, file, call),
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => {
                if matches!(hir[obj].kind, ExprKind::Ident(object) if self.atoms().bytes(object) == b"Object" && self.refers_to_global(file, obj, object))
                {
                    return self.walk_call_on_object(cx, file, call, name);
                }
                let on = self.walk(cx, file, obj)?;
                match on {
                    Walked::Allocated(it)
                        if cx.created[it as usize].allocated_as == CreatedAs::Record =>
                    {
                        (self.walk_read(cx, on, name)?, Some(on))
                    }
                    Walked::Allocated(it)
                        if !matches!(
                            cx.created[it as usize].allocated_as,
                            CreatedAs::Instance(..)
                        ) =>
                    {
                        return self.walk_call_on_created(cx, file, call, it, name);
                    }
                    Walked::Allocated(_) => return cx.bail("walk: a method of an instance"),
                    Walked::Class(..) => return cx.bail("walk: a static method"),
                    _ => return cx.bail("walk: a method of an object that it did not create"),
                }
            }
            _ => (self.walk(cx, file, callee)?, None),
        };
        let Walked::Function {
            file: of,
            func,
            within,
        } = called
        else {
            return cx.bail("walk: a call of what is no one function of the program");
        };
        let arguments = self.walk_arguments(cx, file, call)?;
        self.walk_activation(cx, of, func, within, this, &arguments, None)
    }

    fn walk_call_on_object(
        &mut self,
        cx: &mut Walk,
        file: FileId,
        call: CallId,
        name: Atom,
    ) -> Option<Walked> {
        let arguments = self.walk_arguments(cx, file, call)?;
        let [Walked::Allocated(it)] = arguments[..] else {
            return cx.bail("walk: a function of Object");
        };
        let allocated_as = cx.created[it as usize].allocated_as;
        let is_record = allocated_as == CreatedAs::Record;
        match self.atoms().bytes(name) {
            b"freeze" if is_record || allocated_as == CreatedAs::List => {
                cx.created[it as usize].is_frozen = true;
                Some(arguments[0])
            }
            b"keys" if is_record => Some(cx.make(CreatedAs::List, Vec::new(), Some(Walked::VALUE))),
            b"values" if is_record => {
                let held = cx.created[it as usize]
                    .fields
                    .iter()
                    .fold(None, |held, field| join_walked(held, Some(field.1)));
                Some(cx.make(CreatedAs::List, Vec::new(), held))
            }
            b"entries" if is_record => {
                let list = cx.make(CreatedAs::List, Vec::new(), Some(Walked::Object));
                cx.created.last_mut()?.holds_local_lists = true;
                Some(list)
            }
            _ => cx.bail("walk: a function of Object"),
        }
    }

    fn walk_call_on_created(
        &mut self,
        cx: &mut Walk,
        file: FileId,
        call: CallId,
        it: u32,
        name: Atom,
    ) -> Option<Walked> {
        let arguments = self.walk_arguments(cx, file, call)?;
        let allocated_as = cx.created[it as usize].allocated_as;
        match (allocated_as, self.atoms().bytes(name), &arguments[..]) {
            (CreatedAs::List, b"push", pushed) if !cx.created[it as usize].is_frozen => {
                let held = pushed
                    .iter()
                    .fold(cx.created[it as usize].elements, |held, &value| {
                        join_walked(held, Some(value))
                    });
                let holds_lists = pushed.iter().all(|&value| cx.is_list(value));
                cx.created[it as usize].elements = held;
                cx.created[it as usize].holds_local_lists &= holds_lists;
                Some(Walked::VALUE)
            }
            (
                CreatedAs::Collection {
                    has_values: true,
                    is_weak,
                },
                b"set",
                [key, _],
            ) if !is_weak || key.is_object() => Some(Walked::Allocated(it)),
            (
                CreatedAs::Collection {
                    has_values: false,
                    is_weak,
                },
                b"add",
                [key],
            ) if !is_weak || key.is_object() => Some(Walked::Allocated(it)),
            (CreatedAs::Collection { .. }, b"has", [_]) => Some(Walked::VALUE),
            _ => cx.bail("walk: a method of an object of the engine"),
        }
    }

    fn walk_new(&mut self, cx: &mut Walk, file: FileId, call: CallId) -> Option<Walked> {
        let hir = self.hir(file);
        let callee = hir[call].callee;
        if let ExprKind::Ident(name) = hir[callee].kind
            && self.refers_to_global(file, callee, name)
        {
            let collection = match self.atoms().bytes(name) {
                b"Map" => Some((true, false)),
                b"Set" => Some((false, false)),
                b"WeakMap" => Some((true, true)),
                b"WeakSet" => Some((false, true)),
                _ => None,
            };
            let Some((has_values, is_weak)) = collection else {
                return if cx.running.is_empty() && self.allocates_engine_object(file, call) {
                    Some(Walked::Object)
                } else {
                    cx.bail("walk: new of a global")
                };
            };
            let arguments = self.walk_arguments(cx, file, call)?;
            let is_filled_with_plain_data = match arguments[..] {
                [] | [Walked::Undefined | Walked::Null] => true,
                [Walked::Allocated(it)] => {
                    !is_weak
                        && cx.created[it as usize].allocated_as == CreatedAs::List
                        && (!has_values || cx.created[it as usize].holds_local_lists)
                }
                _ => false,
            };
            if !is_filled_with_plain_data {
                return cx.bail(
                    "walk: a collection filled from something that is not a list created there",
                );
            }
            return Some(cx.make(
                CreatedAs::Collection {
                    has_values,
                    is_weak,
                },
                Vec::new(),
                None,
            ));
        }
        let Walked::Class(of, class) = self.walk(cx, file, callee)? else {
            return cx.bail("walk: `new` on something that is not a single class of the program");
        };
        let arguments = self.walk_arguments(cx, file, call)?;
        let instance = cx.make(CreatedAs::Instance(of, class), Vec::new(), None);
        self.walk_construction(cx, of, class, instance, &arguments)?;
        Some(instance)
    }

    fn walk_construction(
        &mut self,
        cx: &mut Walk,
        of: FileId,
        class: ClassId,
        instance: Walked,
        arguments: &[Walked],
    ) -> Option<()> {
        let hir = self.hir(of);
        let is_decorated = |modifiers: Span<ModifierId>| {
            modifiers
                .iter()
                .any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)))
        };
        if !self.is_walkable_file(of)
            || hir[class].flags.contains(Flags::AMBIENT)
            || is_decorated(hir[class].modifiers)
            || hir[class]
                .members
                .iter()
                .any(|member| is_decorated(hir[member].modifiers))
        {
            return cx.bail("walk: a class that is decorated, untyped or only declared");
        }
        let instances = self.class_instance_type(of, class);
        if self.may_be_redefined(instances) {
            return cx.bail("walk: a class whose prototype is redefined");
        }
        if cx.constructing.contains(&(of, class)) || cx.constructing.len() >= MAX_WALK_ACTIVATIONS {
            return cx.bail("walk: recursion");
        }
        let Some(extended) = self.base_class_of(of, class) else {
            return cx.bail(
                "walk: a class that extends something that is not a single class of the program",
            );
        };
        cx.constructing.push((of, class));
        match self.class_constructor(of, class) {
            Some(constructor) => {
                if extended.is_none() {
                    self.walk_fields(cx, of, class, instance)?;
                }
                self.walk_activation(
                    cx,
                    of,
                    constructor,
                    0,
                    Some(instance),
                    arguments,
                    Some(((of, class), extended)),
                )?;
            }
            None => {
                if let Some(extended) = extended {
                    self.walk_construction(cx, extended.0, extended.1, instance, arguments)?;
                }
                self.walk_fields(cx, of, class, instance)?;
            }
        }
        cx.constructing.pop();
        Some(())
    }

    fn walk_fields(
        &mut self,
        cx: &mut Walk,
        of: FileId,
        class: ClassId,
        instance: Walked,
    ) -> Option<()> {
        let hir = self.hir(of);
        let Walked::Allocated(it) = instance else {
            return None;
        };
        cx.serials += 1;
        cx.running.push(Activation {
            function: (of, FnId::NONE),
            serial: cx.serials,
            this: Some(instance),
            bound_from: cx.bound.len(),
            uncertainty_base: cx.uncertainty,
            returned: None,
            constructs: None,
            has_called_super: false,
        });
        for member in hir[class].members.iter() {
            let m = &hir[member];
            if m.kind != MemberKind::Property
                || m.flags
                    .intersects(Flags::STATIC | Flags::AMBIENT | Flags::ABSTRACT)
                || self.is_field_omitted(of, member)
            {
                continue;
            }
            let Some(name) = m.key.name() else {
                return cx.bail("walk: a field with a computed key");
            };
            let value = self.walk(cx, of, m.init)?;
            self.walk_store(cx, it, name, value)?;
        }
        cx.running.pop();
        Some(())
    }

    fn walk_super_call(&mut self, cx: &mut Walk, file: FileId, call: CallId) -> Option<Walked> {
        let arguments = self.walk_arguments(cx, file, call)?;
        let Some(activation) = cx.running.last_mut() else {
            return cx.bail("walk: super");
        };
        let (Some((own, Some(extended))), Some(instance), false) = (
            activation.constructs,
            activation.this,
            activation.has_called_super,
        ) else {
            return cx.bail("walk: super");
        };
        if activation.uncertainty_base != cx.uncertainty {
            return cx.bail("walk: super(..) under a condition");
        }
        activation.has_called_super = true;
        let function = activation.function;
        self.walk_construction(cx, extended.0, extended.1, instance, &arguments)?;
        self.walk_fields(cx, own.0, own.1, instance)?;
        self.walk_parameter_properties(cx, function.0, function.1, instance)?;
        Some(instance)
    }

    fn walk_parameter_properties(
        &mut self,
        cx: &mut Walk,
        of: FileId,
        constructor: FnId,
        instance: Walked,
    ) -> Option<()> {
        let (hir, bound) = (self.hir(of), self.bound(of));
        let Walked::Allocated(it) = instance else {
            return None;
        };
        for p in hir[constructor]
            .params
            .iter()
            .filter(|&p| hir[p].flags.contains(Flags::PARAMETER_PROPERTY))
        {
            let PatKind::Ident(name) = hir[hir[p].pat].kind else {
                return cx.bail("walk: a pattern");
            };
            let symbol = bound.pat_symbol[hir[p].pat.idx()];
            let Some(handed) = cx
                .bound
                .iter()
                .rev()
                .find(|bound| bound.0 == (of, symbol))
                .map(|bound| bound.1)
            else {
                return cx.bail("walk: a pattern");
            };
            self.walk_store(cx, it, name, handed)?;
        }
        Some(())
    }

    fn walk_activation(
        &mut self,
        cx: &mut Walk,
        of: FileId,
        func: FnId,
        within: u32,
        this: Option<Walked>,
        arguments: &[Walked],
        constructs: Option<((FileId, ClassId), Option<(FileId, ClassId)>)>,
    ) -> Option<Walked> {
        let hir = self.hir(of);
        let f = &hir[func];
        if !self.is_walkable_file(of) {
            return cx.bail("walk: a function of untyped code");
        }
        if f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return cx.bail("walk: a coroutine");
        }
        if f.this_param.is_some()
            || cx.running.len() >= MAX_WALK_ACTIVATIONS
            || cx
                .running
                .iter()
                .any(|activation| activation.function == (of, func))
        {
            return cx.bail("walk: recursion");
        }
        if within != 0
            && !cx
                .running
                .iter()
                .any(|activation| activation.serial == within)
        {
            return cx.bail("walk: a closure of a call that has ended");
        }
        cx.serials += 1;
        let this = this.filter(|_| f.kind != FnKind::Arrow);
        cx.running.push(Activation {
            function: (of, func),
            serial: cx.serials,
            this,
            bound_from: cx.bound.len(),
            uncertainty_base: cx.uncertainty,
            returned: None,
            constructs,
            has_called_super: false,
        });
        for (index, p) in f.params.iter().enumerate() {
            let parameter = &hir[p];
            let is_uninformative = parameter.ty.is_some()
                && matches!(hir[parameter.ty].kind, TypeNodeKind::Keyword(Keyword::Any));
            if parameter.flags.contains(Flags::REST) || is_uninformative {
                return cx.bail("walk: a rest parameter, or one that is any");
            }
            let value = match arguments.get(index).copied().unwrap_or(Walked::Undefined) {
                handed
                    if parameter.default.is_none()
                        || !handed.may_be_nullish()
                        || handed == Walked::Null =>
                {
                    handed
                }
                Walked::Undefined => self.walk(cx, of, parameter.default)?,
                handed => {
                    cx.uncertainty += 1;
                    let otherwise = self.walk(cx, of, parameter.default)?;
                    cx.uncertainty -= 1;
                    handed.join(otherwise)
                }
            };
            self.walk_binding(cx, of, parameter.pat, value)?;
        }
        if let (Some((_, None)), Some(instance)) = (constructs, this) {
            self.walk_parameter_properties(cx, of, func, instance)?;
        }
        let falls_off = match f.body {
            FnBody::Expr(returned) => {
                let value = self.walk(cx, of, returned)?;
                cx.running.last_mut()?.returned = Some(value);
                false
            }
            FnBody::Block(statements) => {
                self.walk_statements(cx, of, hir.ids(statements).collect())?
            }
            FnBody::None => return cx.bail("walk: a function without a body"),
        };
        let activation = cx.running.pop()?;
        cx.bound.truncate(activation.bound_from);
        cx.uncertainty = activation.uncertainty_base;
        if matches!(activation.constructs, Some((_, Some(_)))) && !activation.has_called_super {
            return cx.bail("walk: super");
        }
        Some(if falls_off {
            activation.returned.map_or(Walked::Undefined, |returned| {
                returned.join(Walked::Undefined)
            })
        } else {
            activation.returned.unwrap_or(Walked::Undefined)
        })
    }

    fn walk_binding(
        &mut self,
        cx: &mut Walk,
        file: FileId,
        pat: PatId,
        value: Walked,
    ) -> Option<()> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[pat].kind {
            PatKind::Ident(_) => {
                cx.bind(file, bound.pat_symbol[pat.idx()], value);
                Some(())
            }
            PatKind::Object(props) => {
                if !matches!(value, Walked::Allocated(it) if cx.created[it as usize].allocated_as == CreatedAs::Record)
                {
                    return cx
                        .bail("walk: a pattern on something that is not a literal created there");
                }
                for prop in props.iter() {
                    let p = &hir[prop];
                    let PropKey::Name(name) = p.key else {
                        return cx.bail("walk: a pattern");
                    };
                    if p.is_rest {
                        return cx.bail("walk: a pattern");
                    }
                    let mut held = self.walk_read(cx, value, name)?;
                    if p.default.is_some() && held == Walked::Undefined {
                        held = self.walk(cx, file, p.default)?;
                    } else if p.default.is_some() && held.may_be_nullish() && held != Walked::Null {
                        cx.uncertainty += 1;
                        held = held.join(self.walk(cx, file, p.default)?);
                        cx.uncertainty -= 1;
                    }
                    self.walk_binding(cx, file, p.value, held)?;
                }
                Some(())
            }
            _ => cx.bail("walk: a pattern"),
        }
    }

    fn walk_statements(
        &mut self,
        cx: &mut Walk,
        file: FileId,
        statements: Vec<StmtId>,
    ) -> Option<bool> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &stmt in &statements {
            if let StmtKind::Fn(func) = hir[stmt].kind
                && !matches!(hir[func].body, FnBody::None)
            {
                let declared = Walked::Function {
                    file,
                    func,
                    within: cx.serial(),
                };
                cx.bind(file, bound.fn_symbol[func.idx()], declared);
            }
        }
        for stmt in statements {
            if !self.walk_statement(cx, file, stmt)? {
                return Some(false);
            }
        }
        Some(true)
    }

    fn walk_statement(&mut self, cx: &mut Walk, file: FileId, stmt: StmtId) -> Option<bool> {
        let hir = self.hir(file);
        match hir[stmt].kind {
            StmtKind::Empty | StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Fn(_) => {
                Some(true)
            }
            StmtKind::Expr(e) => {
                self.walk(cx, file, e)?;
                Some(true)
            }
            StmtKind::Var(decls) => {
                for d in decls
                    .iter()
                    .filter(|&d| !hir[d].flags.contains(Flags::AMBIENT))
                {
                    let is_uninformative = hir[d].ty.is_some()
                        && matches!(hir[hir[d].ty].kind, TypeNodeKind::Keyword(Keyword::Any));
                    if !matches!(hir[d].kind, VarKind::Let | VarKind::Const)
                        || is_uninformative
                        || hir[d].flags.contains(Flags::DEFINITE)
                    {
                        return cx.bail("walk: a var, a using, or a variable that is any");
                    }
                    let value = self.walk(cx, file, hir[d].init)?;
                    self.walk_binding(cx, file, hir[d].pat, value)?;
                }
                Some(true)
            }
            StmtKind::Return(e) => {
                let value = self.walk(cx, file, e)?;
                let activation = cx.running.last_mut()?;
                if activation.constructs.is_some() && e.is_some() {
                    return cx.bail("walk: a constructor that returns something");
                }
                activation.returned = join_walked(activation.returned, Some(value));
                Some(false)
            }
            StmtKind::Block(statements) => {
                self.walk_statements(cx, file, hir.ids(statements).collect())
            }
            StmtKind::If { test, yes, no } => match self.walk_test(cx, file, test)? {
                Some(true) => self.walk_statement(cx, file, yes),
                Some(false) if no.is_some() => self.walk_statement(cx, file, no),
                Some(false) => Some(true),
                None => {
                    cx.uncertainty += 1;
                    let first = self.walk_statement(cx, file, yes)?;
                    let second = no.is_none() || self.walk_statement(cx, file, no)?;
                    if first == second {
                        cx.uncertainty -= 1;
                    }
                    Some(first || second)
                }
            },
            StmtKind::Throw(_) => cx.bail("walk: throw"),
            StmtKind::Try { .. } => cx.bail("walk: try"),
            StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. } => cx.bail("walk: a loop"),
            StmtKind::Switch { .. } => cx.bail("walk: switch"),
            _ => cx.bail("walk: another statement"),
        }
    }

    fn is_bound_in(&self, file: FileId, func: FnId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(symbol) = bound.symbols.get(bound.expr_symbol[e.idx()].idx()) else {
            return false;
        };
        !symbol.decls.is_empty()
            && symbol.decls.iter().all(|&decl| match decl {
                Decl::Param(pat) => matches!(bound.pat_parent[pat.idx()], PatParent::Param(p) if bound.param_fn[p.idx()] == func) && !self.parameter_may_be_unbound(file, pat, e),
                Decl::Var(pat) => matches!(bound.pat_parent[pat.idx()], PatParent::Var(d) if {
                    let stmt = bound.var_stmt[d.idx()];
                    hir[d].kind == VarKind::Const && stmt.is_some() && self.enclosing_fn(file, Parent::Stmt(stmt)) == Some(func) && hir[stmt].loc.end <= hir[e].pos
                }),
                _ => false,
            })
    }

    fn is_literal_list(&mut self, file: FileId, e: ExprId, of_pairs: bool) -> bool {
        let hir = self.hir(file);
        let is_there = |part: ExprId| !matches!(hir[part].kind, ExprKind::Missing);
        match hir[e].kind {
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => self.is_literal_list(file, expr, of_pairs),
            ExprKind::Array(elements) if !of_pairs => hir.ids(elements).all(|element| is_there(element) && self.is_pure_expr(file, element)),
            ExprKind::Array(elements) => hir.ids(elements).all(|element| {
                let mut pair = element;
                while let ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) = hir[pair].kind {
                    pair = expr;
                }
                matches!(hir[pair].kind, ExprKind::Array(parts) if parts.len() == 2 && hir.ids(parts).all(|part| is_there(part) && self.is_pure_expr(file, part)))
            }),
            ExprKind::Call(call) => self.enumerates_object_literal(file, call).is_some_and(|evaluates_to_pairs| evaluates_to_pairs || !of_pairs),
            _ => false,
        }
    }

    fn enumerates_object_literal(&mut self, file: FileId, call: CallId) -> Option<bool> {
        let hir = self.hir(file);
        let ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } = hir[hir[call].callee].kind
        else {
            return None;
        };
        let evaluates_to_pairs = match self.atoms().bytes(name) {
            b"entries" => true,
            b"keys" | b"values" => false,
            _ => return None,
        };
        let is_of_object = hir[call].chain == Chain::No
            && matches!(hir[obj].kind, ExprKind::Ident(object) if self.atoms().bytes(object) == b"Object" && self.refers_to_global(file, obj, object));
        let mut literal = hir.ids(hir[call].args).next()?;
        while let ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) = hir[literal].kind {
            literal = expr;
        }
        (is_of_object
            && hir[call].args.len() == 1
            && matches!(hir[literal].kind, ExprKind::Object(_))
            && self.is_pure_expr(file, literal))
        .then_some(evaluates_to_pairs)
    }

    pub fn fold_constant_string(&mut self, file: FileId, e: ExprId) -> Option<(Atom, Vec<ExprId>)> {
        let around = std::mem::replace(&mut self.aot.storage.folding_long_strings, true);
        let value = self.constant_value_of(file, e);
        self.aot.storage.folding_long_strings = around;
        let Some(Primitive::String(text)) = value else {
            return None;
        };
        if self.atoms().bytes(text).len() > 4 * MAX_FOLDED_STRING_PART_LEN {
            return None;
        }
        let mut names = Vec::new();
        self.collect_identifiers(file, e, &mut names);
        Some((text, names))
    }

    fn collect_identifiers(&self, file: FileId, e: ExprId, names: &mut Vec<ExprId>) {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(_) if self.bound(file).expr_symbol[e.idx()].is_some() => names.push(e),
            ExprKind::Template { exprs } => hir
                .ids(exprs)
                .for_each(|hole| self.collect_identifiers(file, hole, names)),
            ExprKind::TaggedTemplate(call) => hir
                .ids(hir[call].args)
                .for_each(|hole| self.collect_identifiers(file, hole, names)),
            ExprKind::Unary { operand, .. } => self.collect_identifiers(file, operand, names),
            ExprKind::Binary { left, right, .. } => {
                self.collect_identifiers(file, left, names);
                self.collect_identifiers(file, right, names);
            }
            ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::As { expr, .. } => self.collect_identifiers(file, expr, names),
            _ => {}
        }
    }

    fn is_string_raw_tag(&mut self, file: FileId, call: CallId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } = hir[hir[call].callee].kind
        else {
            return false;
        };
        hir[call].close_pos == u32::MAX
            && self.atoms().bytes(name) == b"raw"
            && matches!(hir[obj].kind, ExprKind::Ident(string) if self.atoms().bytes(string) == b"String" && self.refers_to_global(file, obj, string))
    }

    pub fn template_raw_strings(&self, file: FileId, call: CallId) -> Vec<Vec<u8>> {
        let hir = self.hir(file);
        let start = hir[hir[call].template].pos as usize;
        let (text, mut ends) = (
            &hir.text[start..],
            hir.ids(hir[call].args)
                .map(|substitution| hir[substitution].end as usize),
        );
        let (mut pieces, mut piece, mut i) = (Vec::new(), Vec::new(), 1);
        while i < text.len() {
            match text[i] {
                b'`' => break,
                b'\\' if i + 1 < text.len() && text[i + 1] != b'\r' => {
                    piece.extend_from_slice(&text[i..i + 2]);
                    i += 2;
                }
                b'$' if text.get(i + 1) == Some(&b'{') => {
                    let Some(end) = ends.next() else {
                        return Vec::new();
                    };
                    pieces.push(std::mem::take(&mut piece));
                    i = substitution_end(text, end.saturating_sub(start));
                }
                b'\r' => {
                    piece.push(b'\n');
                    i += if text.get(i + 1) == Some(&b'\n') {
                        2
                    } else {
                        1
                    };
                }
                byte => {
                    piece.push(byte);
                    i += 1;
                }
            }
        }
        pieces.push(piece);
        pieces
    }

    fn allocates_engine_object(&mut self, file: FileId, call: CallId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Ident(name) = hir[hir[call].callee].kind else {
            return false;
        };
        if !self.refers_to_global(file, hir[call].callee, name) {
            return false;
        }
        let accepts_pairs = match self.atoms().bytes(name) {
            b"Map" => Some(true),
            b"Set" => Some(false),
            _ => None,
        };
        let accepts_length = match self.atoms().bytes(name) {
            b"Map" | b"Set" | b"WeakMap" | b"WeakSet" => false,
            b"Array" | b"ArrayBuffer" | b"Int8Array" | b"Uint8Array" | b"Uint8ClampedArray"
            | b"Int16Array" | b"Uint16Array" | b"Int32Array" | b"Uint32Array" | b"Float32Array"
            | b"Float64Array" => true,
            _ => return false,
        };
        let mut arguments = hir.ids(hir[call].args);
        match (arguments.next(), arguments.next()) {
            (None, _) => true,
            (Some(contents), None) if accepts_pairs.is_some() => {
                self.is_literal_list(file, contents, accepts_pairs == Some(true))
            }
            (Some(length), None) if accepts_length => {
                let written = match hir[length].kind {
                    ExprKind::Ident(name) if self.is_pure_identifier_read(file, length, name) => {
                        self.const_initializer_for(file, length, name)
                    }
                    _ => Some((file, length)),
                };
                written.is_some_and(|(of, length)| matches!(self.hir(of)[length].kind, ExprKind::Number(index) if {
                    let length = self.hir(of).numbers[index as usize];
                    length.fract() == 0.0 && (0.0..=MAX_PURE_ALLOCATION_LENGTH).contains(&length)
                }))
            }
            _ => false,
        }
    }

    pub fn is_referenced_in_tdz(&mut self, sym: Sym) -> bool {
        let Some((file, decl)) = self.variable_declaration(sym) else {
            return false;
        };
        let local = self.bound(file).symbol_of_declaration(decl);
        has(&self.storage_facts(file).self_referenced_in_tdz, local)
    }

    fn executing_site(&self, file: FileId, mut parent: Parent) -> Option<Site> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            parent = match parent {
                Parent::MemberInit(member) if !hir[member].flags.contains(Flags::STATIC) => {
                    return Some(Site::Initializer(member));
                }
                Parent::MemberInit(member) | Parent::MemberKey(member) => {
                    match bound.member_owner[member.idx()] {
                        MemberOwner::Class(class) => bound.class_owner[class.idx()].to_parent(),
                        _ => return self.enclosing_site(file, parent),
                    }
                }
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::File | Parent::None => {
                    return self.enclosing_site(file, parent);
                }
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    pub(super) fn enclosing_site(&self, file: FileId, mut parent: Parent) -> Option<Site> {
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => self.expr_parent_link(file, e),
                Parent::Stmt(s) if s.is_some() => self.stmt_parent_link(file, s),
                Parent::FnBody(func) => return Some(Site::Body(func)),
                Parent::ParamDefault(p) => return Some(Site::Parameter(p)),
                Parent::MemberInit(m) => return Some(Site::Initializer(m)),
                Parent::File => return Some(Site::File),
                Parent::None => return None,
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    pub(super) fn tdz_of(&self, file: FileId, decl: Decl) -> Option<(Site, u32)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (stmt, end) = match decl {
            Decl::Var(pat) => {
                let PatParent::Var(d) = root_declaration(bound, pat) else {
                    return None;
                };
                let stmt = bound.var_stmt[d.idx()];
                let is_hoisted = hir[d].kind == VarKind::Var
                    || self.files().module(file).builtin.is_some()
                        && matches!(hir[d].kind, VarKind::Let | VarKind::Const)
                        && stmt.is_some()
                        && matches!(bound.stmt_parent[stmt.idx()], Parent::File);
                (stmt, if is_hoisted { 0 } else { hir[d].loc.end })
            }
            Decl::Class(class) => match bound.class_owner[class.idx()] {
                ClassOwner::Stmt(stmt) => (stmt, hir[stmt].loc.end),
                ClassOwner::Expr(_) => return None,
            },
            _ => return None,
        };
        if stmt.is_none() {
            return None;
        }
        let end = match bound.stmt_parent[stmt.idx()] {
            _ if end == 0 => 0,
            _ if matches!(hir[stmt].kind, StmtKind::Try { .. }) => end,
            Parent::FnBody(_) | Parent::File | Parent::Module(_) => end,
            Parent::Stmt(around) if around.is_some() => match hir[around].kind {
                StmtKind::Block(_) => end,
                StmtKind::For { init, .. } if init == stmt => end,
                StmtKind::ForIn { left, expr, .. } | StmtKind::ForOf { left, expr, .. }
                    if left == stmt =>
                {
                    hir[expr].end
                }
                _ => u32::MAX,
            },
            _ => u32::MAX,
        };
        Some((self.enclosing_site(file, Parent::Stmt(stmt))?, end))
    }

    fn parameter_may_be_unbound(&self, file: FileId, pat: PatId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Param(declared) = root_declaration(bound, pat) else {
            return true;
        };
        let func = bound.param_fn[declared.idx()];
        match self.enclosing_site(file, bound.expr_parent[e.idx()]) {
            Some(Site::Body(body)) if body == func => false,
            Some(Site::Parameter(at)) if bound.param_fn[at.idx()] == func => at <= declared,
            _ => hir[func].params.iter().any(|p| {
                hir[p].default.is_some() || !matches!(hir[hir[p].pat].kind, PatKind::Ident(_))
            }),
        }
    }

    pub fn starts_undefined(&mut self, sym: Sym) -> bool {
        match self.files().value_declaration(sym) {
            Some((file, Decl::Var(pat))) => self.variable_starts_undefined(sym, file, pat),
            Some((_, Decl::Member(_) | Decl::ParameterProperty(_))) => {
                self.field_starts_undefined(sym, &[])
            }
            _ => false,
        }
    }

    fn is_declared_without_value(&self, file: FileId, d: VarDeclId) -> bool {
        let (hir, stmt) = (self.hir(file), self.bound(file).var_stmt[d.idx()]);
        hir[d].init.is_none()
            && stmt.is_some()
            && matches!(hir[stmt].kind, StmtKind::Var(_))
            && !self.declares_loop_variable(file, stmt)
    }

    fn variable_starts_undefined(&mut self, sym: Sym, file: FileId, pat: PatId) -> bool {
        self.variable_may_be_unassigned(sym, file, pat)
            || has(
                &self.storage_facts(file).cleared,
                self.bound(file).pat_symbol[pat.idx()],
            )
    }

    fn variable_may_be_unassigned(&mut self, sym: Sym, file: FileId, pat: PatId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Var(d) = root_declaration(bound, pat) else {
            return false;
        };
        let is_hoisted = hir[d].kind == VarKind::Var
            || matches!(self.tdz_of(file, Decl::Var(pat)), Some((_, 0)));
        if !is_hoisted && !self.is_declared_without_value(file, d) {
            return false;
        }
        let local = bound.pat_symbol[pat.idx()];
        let Some(symbol) = bound.symbols.get(local.idx()) else {
            return true;
        };
        let is_visible_elsewhere = symbol.flags.contains(SymFlags::MERGED)
            || hir[d].flags.contains(Flags::EXPORT)
            || self.files().sym(file, local) != sym
            || !self.files().module(file).is_module()
                && self.enclosing_site(file, Parent::Stmt(bound.var_stmt[d.idx()]))
                    == Some(Site::File);
        if is_visible_elsewhere
            || !symbol.decls.iter().all(|decl| matches!(decl, Decl::Var(_)))
            || self.tdz_of(file, Decl::Var(pat)).is_none()
        {
            return true;
        }
        has(&self.storage_facts(file).read_before_assignment, local)
    }

    fn declaration_info(&self, file: FileId, symbol: SymbolId) -> Declared {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let nothing = Declared {
            site: None,
            tdz_end: 0,
            is_blank: false,
            initializer_end: 0,
        };
        let of = &bound.symbols[symbol.idx()];
        if of.flags.intersects(SymFlags::MERGED | SymFlags::PARAMETER) {
            return nothing;
        }
        let declaration = of.decls.iter().find_map(|&decl| match decl {
            Decl::Require(pat) => Some(Decl::Var(pat)),
            Decl::Var(_) | Decl::Class(_) => Some(decl),
            _ => None,
        });
        let Some(decl) = declaration else {
            return nothing;
        };
        let Some((site, tdz_end)) = self.tdz_of(file, decl) else {
            return nothing;
        };
        let is_blank = matches!(decl, Decl::Var(pat) if tdz_end == 0 || matches!(root_declaration(bound, pat), PatParent::Var(d) if self.is_declared_without_value(file, d)));
        let initializer_end = match decl {
            Decl::Var(pat) if is_blank && of.decls.len() == 1 => match root_declaration(bound, pat)
            {
                PatParent::Var(d)
                    if hir[d].init.is_some()
                        && matches!(
                            bound.stmt_parent[bound.var_stmt[d.idx()].idx()],
                            Parent::FnBody(_) | Parent::File
                        ) =>
                {
                    hir[d].loc.end
                }
                _ => 0,
            },
            _ => 0,
        };
        Declared {
            site: Some(site),
            tdz_end,
            is_blank,
            initializer_end,
        }
    }

    fn storage_facts(&self, file: FileId) -> &'p FileFacts {
        let program = self.p;
        program
            .aot
            .storage
            .by_file
            .get_or_init(program.files.modules.len(), file, || {
                self.find_storage_facts(file)
            })
    }

    fn find_storage_facts(&self, file: FileId) -> FileFacts {
        let index = self.file_exprs_by_kind(file);
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let words = bound.symbols.len() / 64 + 1;
        let mut found = FileFacts {
            read_before_assignment: vec![0; words],
            cleared: vec![0; words],
            self_referenced_in_tdz: vec![0; words],
            referenced_in_tdz: vec![0; words],
            captured_in_tdz: vec![0; words],
            seen_by_importers: vec![0; words],
            stored_through_casts: vec![0; words],
            this: Vec::new(),
        };
        let mut declared: Vec<Option<Declared>> = vec![None; bound.symbols.len()];
        let mut reads: Vec<(SymbolId, ExprId)> = Vec::new();
        for &e in index.of(ExprTag::Ident) {
            let (symbol, parent) = (bound.expr_symbol[e.idx()], bound.expr_parent[e.idx()]);
            if parent == Parent::None || bound.is_in_type_query(e) {
                continue;
            }
            let Some(how) = declared.get_mut(symbol.idx()) else {
                continue;
            };
            let how = *how.get_or_insert_with(|| self.declaration_info(file, symbol));
            if matches!(parent, Parent::Stmt(stmt) if matches!(hir[stmt].kind, StmtKind::ExportDefault(_)))
            {
                set(&mut found.read_before_assignment, symbol);
                set(&mut found.seen_by_importers, symbol);
            }
            if how.tdz_end != 0
                && let Some(site) = how.site
                && !self.is_created_after(file, e, site, how.tdz_end)
            {
                set(&mut found.captured_in_tdz, symbol);
                if !self.is_evaluated_after(file, e, site, how.tdz_end) {
                    set(&mut found.referenced_in_tdz, symbol);
                }
            }
            if how.is_blank
                && let Parent::Expr(assignment) = parent
                && matches!(hir[assignment].kind, ExprKind::Assign { op: None, target, value } if target == e && self.is_plain_nullish(file, value))
            {
                set(&mut found.cleared, symbol);
            }
            let is_early = hir[e].pos < how.tdz_end;
            let is_read = how.is_blank && bound.access_kind(hir, e) != AccessKind::Write;
            if !is_early && !is_read {
                continue;
            }
            let is_in_place = self.enclosing_site(file, parent) == how.site;
            if is_early && (is_in_place || self.executing_site(file, parent) == how.site) {
                set(&mut found.self_referenced_in_tdz, symbol);
            }
            if is_read && is_in_place {
                reads.push((symbol, e));
            } else if is_read
                && !(how.initializer_end != 0
                    && how.site.is_some_and(|site| {
                        self.is_evaluated_after(file, e, site, how.initializer_end)
                    }))
            {
                set(&mut found.read_before_assignment, symbol);
            }
        }
        for tag in [ExprTag::As, ExprTag::Satisfies] {
            for &cast in index.of(tag) {
                if bound.get_assignment_target(hir, cast).is_none() {
                    continue;
                }
                let mut target = cast;
                while let ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::NonNull(expr) = hir[target].kind
                {
                    target = expr;
                }
                let symbol = bound.expr_symbol[target.idx()];
                if matches!(hir[target].kind, ExprKind::Ident(_))
                    && symbol.idx() < bound.symbols.len()
                {
                    set(&mut found.stored_through_casts, symbol);
                }
            }
        }
        for name in [crate::atom::known::exports, crate::atom::known::module] {
            if let Some(declared_again) = self.redeclared_commonjs_variable(file, name) {
                set(&mut found.stored_through_casts, declared_again.id);
            }
        }
        for &symbol in self.reified_namespace_variables(file) {
            set(&mut found.stored_through_casts, symbol);
        }
        for pat in 0..hir.pats.len() {
            if let Some(symbol) = self.redeclared_catch_parameter(file, PatId(pat as u32)) {
                set(&mut found.stored_through_casts, symbol);
                set(&mut found.stored_through_casts, bound.pat_symbol[pat]);
            }
        }
        for &(e, ..) in bound.identifiers_in_parameters.iter() {
            let symbol = bound.expr_symbol[e.idx()];
            if let Some(of) = bound.symbols.get(symbol.idx())
                && of.flags.contains(SymFlags::PARAMETER)
                && let Some(&Decl::Param(pat)) =
                    of.decls.iter().find(|decl| matches!(decl, Decl::Param(_)))
                && self.parameter_may_be_unbound(file, pat, e)
            {
                set(&mut found.self_referenced_in_tdz, symbol);
            }
        }
        if files.jsx_runtime(file).is_none() {
            for &e in index.of(ExprTag::Jsx) {
                for is_fragment_tag in [false, true] {
                    if let (_, Some(named)) = self.classic_jsx_factory(file, e, is_fragment_tag)
                        && named.file == file
                    {
                        set(&mut found.stored_through_casts, named.id);
                        set(&mut found.read_before_assignment, named.id);
                        set(&mut found.referenced_in_tdz, named.id);
                        set(&mut found.captured_in_tdz, named.id);
                    }
                }
            }
        }
        for named in self.decorator_referenced_values(file) {
            if named.file == file {
                set(&mut found.stored_through_casts, named.id);
                set(&mut found.read_before_assignment, named.id);
                set(&mut found.referenced_in_tdz, named.id);
                set(&mut found.captured_in_tdz, named.id);
            }
        }
        for (i, export) in hir.exports.iter().enumerate() {
            if export.spec.is_some() {
                continue;
            }
            for item in export.items.iter() {
                if let Some(exported) = files.resolve_name(
                    file,
                    bound.export_scope[i],
                    hir[item].local,
                    SymFlags::VALUE,
                ) && exported.file == file
                {
                    set(&mut found.read_before_assignment, exported.id);
                    set(&mut found.seen_by_importers, exported.id);
                }
            }
        }
        reads.sort_unstable();
        let mut search = Search::default();
        let mut searched_for = SymbolId::NONE;
        for (symbol, e) in reads {
            if has(&found.read_before_assignment, symbol) {
                continue;
            }
            if searched_for != symbol {
                (searched_for, search) = (symbol, Search::default());
            }
            if self.is_reachable_without(
                file,
                bound.expr_flow[e.idx()],
                Store::Variable(symbol),
                &mut search,
            ) {
                set(&mut found.read_before_assignment, symbol);
            }
        }
        if !self.is_untyped_file(file) && !hir.classes.is_empty() {
            for tag in [ExprTag::This, ExprTag::Super] {
                found
                    .this
                    .extend(index.of(tag).iter().filter_map(|&e| self.this_use(file, e)));
            }
            found.this.sort_by_key(|&(class, ..)| class);
        }
        found
    }

    fn is_reachable_without(
        &self,
        file: FileId,
        from: FlowId,
        store: Store,
        search: &mut Search,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        search.pending.clear();
        search.pending.push((from, 0));
        while let Some((mut flow, mut block)) = search.pending.pop() {
            loop {
                if flow.is_none() {
                    return true;
                }
                if !search.seen.insert((flow, block)) {
                    break;
                }
                flow = match bound.flow[flow.idx()] {
                    Flow::Unreachable => break,
                    Flow::Start { .. } => return true,
                    Flow::StartInvoked { outer, .. } => outer,
                    Flow::Assign { before, target } => {
                        let is_store = match (target, store) {
                            (FlowTarget::Var(d), Store::Variable(symbol)) => {
                                bound.pat_symbol[hir[d].pat.idx()] == symbol
                            }
                            (FlowTarget::Pat(pat), Store::Variable(symbol)) => {
                                bound.pat_symbol[pat.idx()] == symbol
                            }
                            (FlowTarget::Expr(e), Store::Variable(symbol)) => {
                                matches!(hir[e].kind, ExprKind::Ident(_))
                                    && bound.expr_symbol[e.idx()] == symbol
                            }
                            (FlowTarget::Expr(e), Store::Field(field)) => match hir[e].kind {
                                ExprKind::Dot { obj, name, .. } => {
                                    name == field && matches!(hir[obj].kind, ExprKind::This)
                                }
                                ExprKind::Index { obj, index, .. } => {
                                    matches!(hir[obj].kind, ExprKind::This)
                                        && self.property_named_by_constant_symbol(file, index)
                                            == Some(field)
                                }
                                _ => false,
                            },
                            _ => false,
                        };
                        if is_store
                            && !matches!(target, FlowTarget::Expr(e) if self.is_in_default_of_assignment_pattern(file, e))
                        {
                            break;
                        }
                        before
                    }
                    Flow::Call { before, call } => {
                        if matches!(store, Store::Super)
                            && matches!(hir[call].kind, ExprKind::Call(c) if matches!(hir[hir[c].callee].kind, ExprKind::Super))
                        {
                            break;
                        }
                        before
                    }
                    Flow::Cond { before, .. }
                    | Flow::Switch { before, .. }
                    | Flow::ArrayMutation { before, .. } => before,
                    Flow::Reduce {
                        before,
                        label,
                        instead,
                    } => {
                        search.reduced.push((label, instead, block));
                        block = search.reduced.len() as u32;
                        before
                    }
                    Flow::Loop { start, len } => match bound.edges(start, len).first() {
                        Some(&entry) => entry,
                        None => break,
                    },
                    Flow::Label { start, len } => {
                        let mut edges = bound.edges(start, len);
                        if let Some(&(label, instead, around)) = (block as usize)
                            .checked_sub(1)
                            .and_then(|number| search.reduced.get(number))
                            && label == flow
                        {
                            edges = match bound.flow[instead.idx()] {
                                Flow::Label { start, len } => bound.edges(start, len),
                                _ => &[],
                            };
                            block = around;
                        }
                        search
                            .pending
                            .extend(edges.iter().map(|&edge| (edge, block)));
                        break;
                    }
                };
            }
        }
        false
    }

    pub fn field_starts_undefined(&mut self, sym: Sym, extended: &[(FileId, ClassId)]) -> bool {
        let Some((file, decl)) = self.files().value_declaration(sym) else {
            return true;
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (class, name, stored) = match decl {
            Decl::Member(m) => {
                let member = &hir[m];
                let MemberOwner::Class(class) = bound.member_owner[m.idx()] else {
                    return false;
                };
                if member.kind != MemberKind::Property {
                    return false;
                }
                if member.flags.contains(Flags::OPTIONAL) {
                    return true;
                }
                if member.flags.contains(Flags::STATIC) {
                    return member.init.is_none();
                }
                let Some(name) = self.known_member_name(file, member.key) else {
                    return true;
                };
                if member
                    .flags
                    .intersects(Flags::ACCESSOR | Flags::AMBIENT | Flags::ABSTRACT)
                    || self.is_field_omitted(file, m)
                {
                    return true;
                }
                (
                    class,
                    name,
                    if member.init.is_some() {
                        Stored::ByInitializer(m)
                    } else {
                        Stored::ByConstructor
                    },
                )
            }
            Decl::ParameterProperty(p) => {
                let Some(class) = self.constructor_class(file, bound.param_fn[p.idx()]) else {
                    return true;
                };
                let PatKind::Ident(name) = hir[hir[p].pat].kind else {
                    return true;
                };
                if hir[p].flags.contains(Flags::OPTIONAL) {
                    return true;
                }
                (class, name, Stored::AsParameter)
            }
            _ => return false,
        };
        if !self.has_fully_visible_construction(file, class, extended)
            || !self.this_never_escapes_construction(extended)
        {
            return true;
        }
        let store = match stored {
            Stored::ByConstructor => Some(Store::Field(name)),
            _ if !extended.is_empty() => Some(Store::Super),
            _ => None,
        };
        let mut search = Search::default();
        for this_use in self.this_uses(file, class, extended).iter() {
            if this_use.reads.is_some() && this_use.reads != name {
                continue;
            }
            let is_early = match (this_use.at, stored) {
                (ThisUseSite::Parameters, _) => true,
                (ThisUseSite::Initializer(other), Stored::ByInitializer(own)) => other <= own,
                (ThisUseSite::Initializer(_), _) => true,
                (ThisUseSite::Body(flow), _) => store
                    .is_some_and(|store| self.is_reachable_without(file, flow, store, &mut search)),
            };
            if is_early {
                return true;
            }
        }
        if !matches!(stored, Stored::ByConstructor) {
            return false;
        }
        let Some(constructor) = self.class_constructor(file, class) else {
            return true;
        };
        self.is_reachable_without(
            file,
            bound.fns[constructor.idx()].exit,
            Store::Field(name),
            &mut search,
        )
    }

    fn constructor_class(&self, file: FileId, func: FnId) -> Option<ClassId> {
        let bound = self.bound(file);
        if func.is_none() || self.hir(file)[func].kind != FnKind::Constructor {
            return None;
        }
        match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(class) => Some(class),
                _ => None,
            },
            _ => None,
        }
    }

    fn has_fully_visible_construction(
        &self,
        file: FileId,
        class: ClassId,
        extended: &[(FileId, ClassId)],
    ) -> bool {
        let hir = self.hir(file);
        let is_decorated = |modifiers: Span<ModifierId>| {
            modifiers
                .iter()
                .any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)))
        };
        !self.is_untyped_file(file)
            && self.is_compiled(file)
            && !hir[class].flags.contains(Flags::AMBIENT)
            && hir[class].extends.is_some() != extended.is_empty()
            && !is_decorated(hir[class].modifiers)
            && !hir[class]
                .members
                .iter()
                .any(|member| is_decorated(hir[member].modifiers))
    }

    pub(super) fn this_never_escapes_construction(
        &mut self,
        classes: &[(FileId, ClassId)],
    ) -> bool {
        let Some((&(file, class), extended)) = classes.split_first() else {
            return true;
        };
        if let Some(&known) = self.aot.storage.keeps_this.get(&(file, class)) {
            return known;
        }
        let keeps_this = self.has_fully_visible_construction(file, class, extended)
            && self.this_never_escapes_construction(extended)
            && self
                .this_uses(file, class, extended)
                .iter()
                .all(|this_use| this_use.reads.is_some());
        self.aot
            .storage
            .keeps_this
            .insert((file, class), keeps_this);
        keeps_this
    }

    pub fn this_escapes_during_construction(&mut self, classes: &[(FileId, ClassId)]) -> bool {
        !self.this_never_escapes_construction(classes)
    }

    pub fn initializers_that_use_this(&mut self, file: FileId, class: ClassId) -> Vec<MemberId> {
        let found = self.storage_facts(file);
        let first = found.this.partition_point(|&(of, ..)| of < class);
        (found.this[first..].iter())
            .take_while(|&&(of, ..)| of == class)
            .filter_map(|&(_, at, _)| match at {
                ThisUseSite::Initializer(member) => Some(member),
                _ => None,
            })
            .collect()
    }

    pub fn initializers_where_this_escapes(
        &mut self,
        file: FileId,
        class: ClassId,
        extended: &[(FileId, ClassId)],
    ) -> Vec<MemberId> {
        (self.this_uses(file, class, extended).iter())
            .filter(|this_use| this_use.reads.is_none())
            .filter_map(|this_use| match this_use.at {
                ThisUseSite::Initializer(member) => Some(member),
                _ => None,
            })
            .collect()
    }

    fn this_uses(
        &mut self,
        file: FileId,
        class: ClassId,
        extended: &[(FileId, ClassId)],
    ) -> Rc<[Use]> {
        if let Some(known) = self.aot.storage.this_uses.get(&(file, class)) {
            return Rc::clone(known);
        }
        let found = self.storage_facts(file);
        let first = found.this.partition_point(|&(of, ..)| of < class);
        let uses: Rc<[Use]> = (found.this[first..].iter())
            .take_while(|&&(of, ..)| of == class)
            .filter_map(|&(_, at, access)| match access {
                Access::Reads(name) if self.is_data_field(file, class, extended, name) => {
                    Some(Use { at, reads: name })
                }
                Access::Stores(name) if self.is_data_field(file, class, extended, name) => None,
                _ => Some(Use {
                    at,
                    reads: Atom::NONE,
                }),
            })
            .collect();
        self.aot
            .storage
            .this_uses
            .insert((file, class), Rc::clone(&uses));
        uses
    }

    fn is_data_field(
        &self,
        file: FileId,
        class: ClassId,
        extended: &[(FileId, ClassId)],
        name: Atom,
    ) -> bool {
        for &(file, class) in std::iter::once(&(file, class)).chain(extended) {
            let hir = self.hir(file);
            let member = (hir[class].members.iter())
                .filter(|&member| !self.is_field_omitted(file, member))
                .map(|member| &hir[member])
                .find(|m| {
                    !m.flags.intersects(Flags::STATIC | Flags::AMBIENT)
                        && self.known_member_name(file, m.key) == Some(name)
                });
            if let Some(member) = member {
                return member.kind == MemberKind::Property
                    && !member.flags.intersects(Flags::ACCESSOR | Flags::ABSTRACT);
            }
            let is_parameter_property =
                self.class_constructor(file, class)
                    .is_some_and(|constructor| {
                        hir[constructor].params.iter().any(|p| {
                        hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                            && matches!(hir[hir[p].pat].kind, PatKind::Ident(key) if key == name)
                    })
                    });
            if is_parameter_property {
                return true;
            }
        }
        false
    }

    fn this_use(&self, file: FileId, e: ExprId) -> Option<(ClassId, ThisUseSite, Access)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = bound.expr_parent[e.idx()];
        let is_this = matches!(hir[e].kind, ExprKind::This);
        if !is_this
            && matches!(parent, Parent::Expr(call) if call.is_some() && matches!(hir[call].kind, ExprKind::Call(c) if hir[c].callee == e))
        {
            return None;
        }
        let mut is_in_arrow = false;
        let mut statement = StmtId::NONE;
        let mut at = parent;
        let (class, at) = loop {
            at = match at {
                Parent::Expr(x) if x.is_some() => bound.expr_parent[x.idx()],
                Parent::Stmt(s) if s.is_some() => {
                    if statement.is_none() {
                        statement = s;
                    }
                    bound.stmt_parent[s.idx()]
                }
                Parent::FnBody(func) if hir[func].kind == FnKind::Arrow => {
                    (is_in_arrow, statement) = (true, StmtId::NONE);
                    self.parent_of_node(file, at)
                }
                Parent::ParamDefault(p) if hir[bound.param_fn[p.idx()]].kind == FnKind::Arrow => {
                    (is_in_arrow, statement) = (true, StmtId::NONE);
                    self.parent_of_node(file, at)
                }
                Parent::FnBody(func) => {
                    let class = self.constructor_class(file, func)?;
                    break match statement.some() {
                        _ if !is_in_arrow => (class, ThisUseSite::Body(bound.expr_flow[e.idx()])),
                        Some(statement) => {
                            (class, ThisUseSite::Body(bound.stmt_flow[statement.idx()]))
                        }
                        None => (class, ThisUseSite::Parameters),
                    };
                }
                Parent::ParamDefault(p) => {
                    break (
                        self.constructor_class(file, bound.param_fn[p.idx()])?,
                        ThisUseSite::Parameters,
                    );
                }
                Parent::MemberInit(m) => match bound.member_owner[m.idx()] {
                    MemberOwner::Class(class) if !hir[m].flags.contains(Flags::STATIC) => {
                        break (class, ThisUseSite::Initializer(m));
                    }
                    _ => return None,
                },
                Parent::MemberKey(m) => match bound.member_owner[m.idx()] {
                    MemberOwner::Class(class) => bound.class_owner[class.idx()].to_parent(),
                    _ => return None,
                },
                Parent::Decorator(class, _) | Parent::ClassExtends(class) => {
                    bound.class_owner[class.idx()].to_parent()
                }
                Parent::MethodKey(p) => Parent::Expr(bound.prop_owner[p.idx()]),
                Parent::None | Parent::File | Parent::Module(_) => return None,
                _ => self.parent_of_node(file, at),
            };
        };
        let access = match parent {
            Parent::Expr(access) if access.is_some() && is_this && !is_in_arrow => access,
            _ => return Some((class, at, Access::Leaks)),
        };
        let name = match hir[access].kind {
            ExprKind::Dot { name, .. } => Some(name),
            ExprKind::Index { obj, index, .. } if obj == e => {
                self.property_named_by_constant_symbol(file, index)
            }
            _ => None,
        };
        let Some(name) = name else {
            return Some((class, at, Access::Leaks));
        };
        let mut callee = access;
        while let Parent::Expr(outer) = bound.expr_parent[callee.idx()]
            && outer.is_some()
            && matches!(
                hir[outer].kind,
                ExprKind::NonNull(_) | ExprKind::As { .. } | ExprKind::Satisfies { .. }
            )
        {
            callee = outer;
        }
        let is_called = matches!(bound.expr_parent[callee.idx()], Parent::Expr(call)
            if call.is_some() && matches!(hir[call].kind, ExprKind::Call(c) | ExprKind::TaggedTemplate(c) if hir[c].callee == callee));
        let access = match bound.access_kind(hir, access) {
            _ if is_called => Access::Leaks,
            AccessKind::Write => Access::Stores(name),
            AccessKind::Read | AccessKind::ReadWrite => Access::Reads(name),
        };
        Some((class, at, access))
    }
}
