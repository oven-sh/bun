//! Answers questions about types, on demand. Nothing is computed until it is asked for, everything that is computed is
//! kept, and a question that comes back to itself is answered "unresolved".
//!
//! [`Program`] is shared by all threads and only ever grows. A [`Checker`] belongs to one thread: it has the stack of questions
//! being answered and whatever else is only true for the moment.

/// The pieces, one after the other.
macro_rules! cat {
    ($($piece:expr),+ $(,)?) => { [$(&$piece[..]),+].concat() };
}

mod alias;
mod call;
mod context;
mod decl;
mod decorators;
mod enclosing_declaration;
pub mod errors;
mod errors_access;
mod errors_assign;
mod errors_call;
mod errors_circular;
mod errors_decl;
mod errors_declaration_emit;
mod errors_duplicates;
mod errors_emit_helpers;
mod errors_flow;
mod errors_grammar;
mod errors_grammar_modifiers;
mod errors_heritage;
mod errors_implicit;
mod errors_isolated_declarations;
mod errors_iteration;
pub(crate) mod errors_js;
mod errors_jsx;
mod errors_misc;
mod errors_modules;
mod errors_order;
mod errors_overloads;
mod errors_small;
mod errors_unused;
mod errors_x_aliases;
mod errors_x_classes;
mod errors_x_collisions;
mod errors_x_enums_names;
mod errors_x_modules;
mod errors_x_operators;
pub(crate) mod errors_x_regexp_scanner;
mod errors_x_signatures;
mod errors_x_statements;
mod errors_x_typenodes;
pub mod explain;
mod explain_relation;
mod expr;
mod fix_t7;
mod flow;
mod grammarchecks;
mod in_order;
mod infer;
mod instantiate;
mod jsx;
mod late_bound;
mod mapped;
mod order;
mod print;
mod relate;
mod related;
mod related_expected;
mod shape;
mod sink;
pub(crate) mod spans;
#[cfg(feature = "baselines")]
#[path = "../standalone/symbol_writer.rs"]
pub mod symbol_writer;
mod symbols;
pub mod task;
#[cfg(feature = "baselines")]
#[path = "../standalone/type_writer.rs"]
pub mod type_writer;
mod unions;
#[cfg(feature = "baselines")]
#[path = "../standalone/visit_node.rs"]
mod visit_node;

use crate::atom::{Atom, Atoms, known};
use crate::bind::{AssignmentKind, AssignmentTarget, Bound, ModuleInstanceState, SymFlags};
use crate::hir::{self, *};
use crate::local::MaybeLocal;
use crate::program::{FileId, Files, Sym};
use crate::table::{Bases, Buffered, ById, ByIdIndirect, ByKey, ByNode, ByNodeIndirect, FileLocal};
use crate::types::Prop;
use crate::types::*;
use crate::util::{FxHashMap, List};
use bun_threading::Guarded;
use errors_modules::{root_declaration, root_pattern};
use errors_x_aliases::SpecifierSite;
pub use errors_x_regexp_scanner::get_spelling_suggestion;
use errors_x_regexp_scanner::spelling_suggestion;
use errors_x_typenodes::array_element_type_node;
use errors_x_typenodes::has_parse_diagnostics;
use shape::members_among;
use sink::{Arg, Reported};
use spans::end_of_brackets;
use spans::is_identifier_part;
use spans::skip_trivia;
use spans::start_of_token_before;
use spans::token_end;
use spans::{is_word_at, word_at, word_before, word_end, word_start};
use spans::{skip_trivia_back, trim_trivia_end};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use symbols::AliasTarget;
use task::{Open, OrderDependent, Stored, Task};

pub use call::ResolvedCall;
pub use shape::Members;
pub use spans::compute_ecma_line_starts;

const RECENT_SIGS: usize = 256;

/// A non-cacheable query result. It is valid while `frames[depth]` has the serial number `serial`.
#[derive(Copy, Clone)]
struct Provisional {
    /// The result as one word: a `TypeId`, a `Packed` value, or a pointer for `Query::Shape`.
    raw: u64,
    depth: u32,
    /// A hit taints the frames from this index up. `u32::MAX`: none, see `cache_provisionally`.
    from: u32,
    /// `stack.len()` when the query was pushed.
    height: u32,
    /// What happened while it was computed: `cycles` was incremented (1), `limits` was incremented (2), an incomplete flow-loop type was
    /// read (4), a query was refused for lack of native stack or query depth (8).
    moved: u8,
    serial: u64,
}

/// Calls `$each!` with the names of the `Buffered` fields of `Program`, in the order in which a barrier may publish them: a table whose
/// entries hold handles of another one comes after it, so `shapes` is before `members`. THE ONE LIST: a new `Buffered` field goes in here.
macro_rules! buffered_fields {
    ($each:ident) => {
        $each!(
            type_node_types fn_return_types pat_types literal_prop_types symbol_types circular_symbols
            base_constructor_types symbol_reference_links mapped_types_with_errors declared_types shapes
            distributed_intersections sig_params
            sig_type_params resolved_return_types call_signatures construct_signatures candidate_orders members
            resolved_type_arguments instantiations key_properties composed outer_type_params declared_type_params
            identity_mappers identity_mappers_with_adopted base_types context_checked relations variances
            awaited_types mapped_prop_types reverse_mapped_cache optional_properties intersected_props
            union_properties never_intersections mapped_targets inferred_constraints constraints plain_global_refs
            equivalent_base_types type_param_constraints enum_values type_param_defaults conditionals
            mapped_param_constraints wrapper_types
            expr_types flows_too_deep calls call_return_types call_diagnostics diagnostics_of_re_resolved_calls
            effects_signatures resolved_effects_signatures context_free_expr_types context_free_types
            type_predicates_from_body initializer_is_undefined circular_initializers circular_returns deferred_nodes
        )
    };
}
pub(crate) use buffered_fields;

/// The same for the `FileLocal` fields. ONLY A PURE CACHE IS `FileLocal`: a function of entries that are published. What tsgo keeps on a node, a
/// symbol or a signature is `Buffered`, so that a task sees the result of an outer evaluation together with what was evaluated inside it.
macro_rules! file_local_fields {
    ($each:ident) => {
        $each!(flow_node_reachable jsx_attributes_types)
    };
}
pub(crate) use file_local_fields;

pub struct Program {
    /// Whether a query of any task has come back to itself. Written at a barrier, from `Finished::closed_a_cycle`.
    pub closed_a_circle: AtomicBool,
    /// `Finished::order_dependent_variances` of the valid tasks so far: the first value in serial order for each symbol. Written at a
    /// barrier (`Program::validate`), read on a cache miss in `variances_worker`.
    serial_variances: Guarded<FxHashMap<Sym, Arc<[u8]>>>,
    /// `autoArrayType`
    auto_array_type: TypeId,
    pub files: Arc<Files>,
    pub types: TypeStore,

    /// `links.resolvedType` of an expression (`checkExpressionCached`). Also our memo where tsgo checks an expression again.
    expr_types: ByNode<(FileId, ExprId), TypeId, Buffered>,
    type_node_types: ByNode<(FileId, TypeNodeId), TypeId, Buffered>,
    /// The flag, here and in `pat_types`, `declared_types` and `constraints`: the type is the result of a resolution cycle
    /// (`!popTypeResolution()`).
    fn_return_types: ByNode<(FileId, FnId), (TypeId, bool), Buffered>,
    pat_types: ByNode<(FileId, PatId), (TypeId, bool), Buffered>,
    literal_prop_types: ByNode<(FileId, PropId), TypeId, Buffered>,
    symbol_types: ByNode<Sym, TypeId, Buffered>,
    /// The parameters for which `parameterInitializerContainsUndefined` closed a cycle. Their entry in `pat_types` is older than the cycle.
    circular_initializers: ByNode<(FileId, PatId), (), Buffered>,
    /// The symbols whose type is the result of a resolution cycle.
    circular_symbols: ByNode<Sym, (), Buffered>,
    /// The functions for which 7023 was reported and whose entry in `fn_return_types` is not the result of the cycle: it is in flight and
    /// keeps its inferred type, or the cycle is that of a composite signature.
    circular_returns: ByNode<(FileId, FnId), (), Buffered>,
    /// References whose control flow walk reached depth 2000 (2563). `getTypeAtFlowNode`
    flows_too_deep: ByNode<(FileId, ExprId), (), Buffered>,
    /// `getEffectsSignature`, by call.
    effects_signatures: ByNode<(FileId, ExprId), Option<SigId>, Buffered>,
    /// `links.effectsSignature` of the calls `getEffectsSignature` has to resolve: generic or overloaded.
    resolved_effects_signatures: ByNode<(FileId, ExprId), Option<SigId>, Buffered>,
    /// `links.contextFreeType` of an expression (`getContextFreeTypeOfExpression`). `context_free_types` is that of a function.
    context_free_expr_types: ByNode<(FileId, ExprId), TypeId, Buffered>,
    /// `flowNodeReachable`
    flow_node_reachable: ByNode<(FileId, crate::bind::FlowId), bool, FileLocal>,
    /// `sig.resolvedTypePredicate`, of a function that does not say what it returns.
    type_predicates_from_body: ByNodeIndirect<(FileId, FnId), Option<decl::Predicate>, Buffered>,
    /// `resolvedBaseConstructorType` of each class.
    base_constructor_types: ByNode<Sym, TypeId, Buffered>,
    /// `symbolReferenceLinks`: what `Resolve` found when it was asked with `isUse`, where that is noted by who asks. `check_unused`
    /// works out the rest.
    symbol_reference_links: ByNode<Sym, (), Buffered>,
    /// `GetGlobalDiagnostics`: what is wrong and is in no file. `Cannot find global type 'Array'.` The code, and what goes into the message.
    global_errors: bun_threading::Guarded<std::collections::BTreeSet<(u32, Vec<Vec<u8>>)>>,
    sink: sink::Sink,
    /// `MappedType.containsError`
    mapped_types_with_errors: ById<TypeId, (), Buffered>,
    /// `NodeCheckFlagsInitializerIsUndefinedComputed` and `NodeCheckFlagsInitializerIsUndefined`
    initializer_is_undefined: ByNode<(FileId, ParamId), bool, Buffered>,
    declared_types: ByNode<Sym, (TypeId, bool), Buffered>,
    shapes: ByIdIndirect<TypeId, shape::Resolved, Buffered>,
    /// `intersectionTypes`, for sets that contain a union. The key: the set, `IntersectionFlagsNoConstraintReduction`, and whether the set
    /// is split in halves, which gives the result another `origin`.
    distributed_intersections: ByKey<(Box<[TypeId]>, bool, bool), (TypeId, bool), Buffered>,
    sig_params: ByIdIndirect<SigId, Box<[SigParam]>, Buffered>,
    sig_type_params: ByIdIndirect<SigId, Box<[TypeId]>, Buffered>,
    /// `Signature.resolvedReturnType` of a signature with a `target`.
    resolved_return_types: ById<SigId, TypeId, Buffered>,
    call_signatures: ByIdIndirect<TypeId, Box<[SigId]>, Buffered>,
    construct_signatures: ByIdIndirect<TypeId, Box<[SigId]>, Buffered>,
    /// By the first of several signatures: the list they are in, then the same list in the order `candidates_in_order` puts it in.
    candidate_orders: ByIdIndirect<SigId, Box<[SigId]>, Buffered>,
    /// What `members` says of a type, once that holds for good.
    members: ByIdIndirect<TypeId, shape::CachedMembers, Buffered>,
    /// `TypeReference.resolvedTypeArguments` of a deferred type reference.
    resolved_type_arguments: ByIdIndirect<TypeId, Box<[TypeId]>, Buffered>,
    instantiations: ByKey<(TypeId, MapperId), TypeId, Buffered>,
    /// `UnionType.keyPropertyName`, `constituentMap`
    key_properties: ByIdIndirect<TypeId, Option<(Atom, FxHashMap<TypeId, TypeId>)>, Buffered>,
    /// `compose`
    composed: ByKey<(MapperId, MapperId), MapperId, Buffered>,
    outer_type_params: ByNodeIndirect<(FileId, crate::bind::ScopeId), Arc<[TypeId]>, Buffered>,
    /// `type_param`
    declared_type_params: ByNode<(FileId, TypeParamId), TypeId, Buffered>,
    /// `identity_mapper`
    identity_mappers: ByNode<(FileId, crate::bind::ScopeId), MapperId, Buffered>,
    identity_mappers_with_adopted: ByNode<(FileId, crate::bind::ScopeId), MapperId, Buffered>,
    base_types: ByNodeIndirect<Sym, Arc<[TypeId]>, Buffered>,
    /// `links.resolvedSignature`. `Checker::cached_resolved_signature` reads it together with `call_return_types`, `cache_call` writes both.
    calls: ByNode<(FileId, ExprId), Option<SigId>, Buffered>,
    /// `ResolvedCall::ret` of the entry of `calls`. A cell has 32 bits.
    call_return_types: ByNode<(FileId, ExprId), TypeId, Buffered>,
    /// `links.deferredNodes`, of a file that the task was not going through at the time. See `check_node_deferred`.
    deferred_nodes: ByNode<(FileId, ExprId), (), Buffered>,
    /// `getEffectiveFirstArgumentForJsxSignature` of the signature a JSX element is resolved to, by the element.
    jsx_attributes_types: ByNode<(FileId, JsxId), TypeId, FileLocal>,
    /// What `resolveCall` reported of a call when it was resolved for good, with the notes.
    call_diagnostics: ByNodeIndirect<(FileId, ExprId), Vec<Reported>, Buffered>,
    /// `NodeCheckFlagsContextChecked`, with what `assignContextualParameterTypes` was given. `None`: it was not called.
    context_checked: ByNode<(FileId, FnId), Option<SigId>, Buffered>,
    /// `contextFreeTypes`, of a function.
    context_free_types: ByNode<(FileId, FnId), TypeId, Buffered>,
    /// What `resolveCall` reported of a call the first time it was resolved again while it was being resolved, with the notes.
    diagnostics_of_re_resolved_calls: ByNodeIndirect<(FileId, ExprId), Vec<Reported>, Buffered>,
    relations: ByKey<relate::Key, u8, Buffered>,
    variances: ByNodeIndirect<Sym, Arc<[u8]>, Buffered>,
    /// `resolvedType` of a property declared by assignment declarations, keyed by the first declaration.
    /// `awaited_no_alias`, asked on its own account, once it holds for good.
    awaited_types: ById<TypeId, Option<TypeId>, Buffered>,
    /// `resolvedType` of a property of a mapped type, keyed by the mapped type and the property name. `getTypeOfMappedSymbol`
    mapped_prop_types: ByKey<(TypeId, Atom), TypeId, Buffered>,
    /// `reverseMappedCache`
    reverse_mapped_cache: ByKey<(TypeId, TypeId, TypeId), Option<TypeId>, Buffered>,
    /// See `cached_optional_property`.
    optional_properties: ById<TypeId, TypeId, Buffered>,
    intersected_props: ByKey<(TypeId, Atom), TypeId, Buffered>,
    /// `UnionOrIntersectionType.propertyCache`. A made-up type holds the property.
    union_properties: ByKey<(TypeId, Atom), Option<TypeId>, Buffered>,
    never_intersections: ById<TypeId, bool, Buffered>,
    /// `getMappedTargetWithSymbol` of a mapped type.
    mapped_targets: ById<TypeId, TypeId, Buffered>,
    inferred_constraints: ById<TypeId, Option<TypeId>, Buffered>,
    constraints: ById<TypeId, (TypeId, bool), Buffered>,
    /// `global_ref` of a name, without type arguments.
    plain_global_refs: ById<Atom, TypeId, Buffered>,
    /// `CachedTypeKindEquivalentBaseType`
    equivalent_base_types: ById<TypeId, Option<TypeId>, Buffered>,
    /// `constraint_of_type_param` of a type parameter, once it holds for good.
    type_param_constraints: ById<TypeId, Option<TypeId>, Buffered>,
    enum_values: ByNodeIndirect<(FileId, EnumMemberId), decl::Evaluated, Buffered>,
    /// `default_of_type_param` of a type parameter, once it holds for good.
    type_param_defaults: ById<TypeId, Option<TypeId>, Buffered>,
    conditionals: ByKey<(FileId, TypeNodeId, MapperId), TypeId, Buffered>,
    /// What the parameter of each mapped type extends, if anything. See `constraint_of_mapped_param`.
    mapped_param_constraints: ByNode<(FileId, TypeNodeId), Option<TypeId>, Buffered>,
    /// `String`, `Number` and the like, as `apparent_type` has them for the primitives, by name.
    wrapper_types: ById<Atom, TypeId, Buffered>,
}

/// No id: the arguments are printed when it is made.
impl crate::types::Follow for Reported {
    fn visit<V: crate::types::Visitor>(&self, visitor: &mut V) {
        visitor.plain(&(self.file.0, self.start, self.end, self.code));
    }
    fn follow(&mut self, _: &crate::types::Link) {}
}

impl crate::types::Follow for decl::Predicate {
    fn visit<V: crate::types::Visitor>(&self, visitor: &mut V) {
        let decl::Predicate { param, ty, asserts } = self;
        visitor.plain(&(param, asserts));
        ty.visit(visitor);
    }
    fn follow(&mut self, link: &crate::types::Link) {
        self.ty.follow(link);
    }
}

impl Program {
    /// What the published half of every table holds, with the name of the field. It reads every cell: for `--timing`.
    pub fn table_footprints(&self) -> Vec<(&'static str, crate::table::Footprint)> {
        macro_rules! each {
            ($($field:ident)*) => { vec![$((stringify!($field), self.$field.footprint())),*] };
        }
        buffered_fields!(each)
    }

    pub fn new(files: Arc<Files>) -> Program {
        // Nothing that mentions a node of a leaf file is published, so the published half has no room for them. `Bases::at` returns `None`
        // for its nodes.
        let bases = |len: fn(&crate::program::Module) -> usize| {
            let count = |m: &crate::program::ModuleCell| if m.is_leaf { 0 } else { len(m) };
            Bases::new(files.modules.iter().map(count))
        };
        let exprs = bases(|m| m.hir.exprs.len());
        let type_nodes = bases(|m| m.hir.types.len());
        let fns = bases(|m| m.hir.fns.len());
        let pats = bases(|m| m.hir.pats.len());
        let props = bases(|m| m.hir.props.len());
        let params = bases(|m| m.hir.params.len());
        let enum_members = bases(|m| m.hir.enum_members.len());
        let scopes = bases(|m| m.bound.scopes.len());
        let type_params = bases(|m| m.hir.type_params.len());
        let symbols = bases(|m| m.bound.symbols.len());
        let types = TypeStore::new();
        let auto_array_type =
            types.publish_constant(match files.global_type_of_arity(known::Array, 1) {
                Some(target) => TypeData::Ref {
                    target,
                    args: (&[TypeId::AUTO][..]).into(),
                },
                // It is a marker: without a global `Array` it is a type of its own all the same.
                None => TypeData::Synth(Box::new(Shape {
                    literal: Literalness::AutoArray,
                    ..Shape::default()
                })),
            });
        let mut program = Program {
            closed_a_circle: Default::default(),
            serial_variances: Guarded::new(FxHashMap::default()),
            auto_array_type,
            types,
            expr_types: ByNode::new(&exprs),
            type_node_types: ByNode::new(&type_nodes),
            fn_return_types: ByNode::new(&fns),
            pat_types: ByNode::new(&pats),
            literal_prop_types: ByNode::new(&props),
            symbol_types: ByNode::new(&symbols),
            circular_initializers: ByNode::new(&pats),
            circular_symbols: ByNode::new(&symbols),
            circular_returns: ByNode::new(&fns),
            flows_too_deep: ByNode::new(&exprs),
            effects_signatures: ByNode::new(&exprs),
            resolved_effects_signatures: ByNode::new(&exprs),
            context_free_expr_types: ByNode::new(&exprs),
            // A `FileLocal` table has no shared array, so it does not look at the bases.
            flow_node_reachable: ByNode::new(&exprs),
            type_predicates_from_body: ByNodeIndirect::new(&fns),
            base_constructor_types: ByNode::new(&symbols),
            sink: sink::Sink::new(files.modules.len()),
            symbol_reference_links: ByNode::new(&symbols),
            global_errors: Default::default(),
            mapped_types_with_errors: Default::default(),
            initializer_is_undefined: ByNode::new(&params),
            declared_types: ByNode::new(&symbols),
            shapes: Default::default(),
            distributed_intersections: Default::default(),
            sig_params: Default::default(),
            sig_type_params: Default::default(),
            resolved_return_types: Default::default(),
            call_signatures: Default::default(),
            construct_signatures: Default::default(),
            candidate_orders: Default::default(),
            members: Default::default(),
            resolved_type_arguments: Default::default(),
            instantiations: Default::default(),
            key_properties: Default::default(),
            composed: Default::default(),
            outer_type_params: ByNodeIndirect::new(&scopes),
            declared_type_params: ByNode::new(&type_params),
            identity_mappers: ByNode::new(&scopes),
            identity_mappers_with_adopted: ByNode::new(&scopes),
            base_types: ByNodeIndirect::new(&symbols),
            calls: ByNode::new(&exprs),
            call_return_types: ByNode::new(&exprs),
            deferred_nodes: ByNode::new(&exprs),
            jsx_attributes_types: ByNode::new(&bases(|m| m.hir.jsx.len())),
            call_diagnostics: ByNodeIndirect::new(&exprs),
            context_checked: ByNode::new(&fns),
            context_free_types: ByNode::new(&fns),
            diagnostics_of_re_resolved_calls: ByNodeIndirect::new(&exprs),
            relations: Default::default(),
            variances: ByNodeIndirect::new(&symbols),
            awaited_types: Default::default(),
            mapped_prop_types: Default::default(),
            reverse_mapped_cache: Default::default(),
            optional_properties: Default::default(),
            intersected_props: Default::default(),
            union_properties: Default::default(),
            never_intersections: Default::default(),
            mapped_targets: Default::default(),
            inferred_constraints: Default::default(),
            constraints: Default::default(),
            plain_global_refs: Default::default(),
            equivalent_base_types: Default::default(),
            type_param_constraints: Default::default(),
            enum_values: ByNodeIndirect::new(&enum_members),
            type_param_defaults: Default::default(),
            conditionals: Default::default(),
            mapped_param_constraints: ByNode::new(&type_nodes),
            wrapper_types: Default::default(),
            files,
        };
        task::number_tables(&mut program);
        program
    }

    /// `GetGlobalDiagnostics`: what has been found wrong that is in no file, once all files have been checked. In order, each once.
    pub fn global_errors(&self) -> Vec<(u32, Vec<Vec<u8>>)> {
        if self.files.modules.is_empty() {
            return Vec::new();
        }
        // `initializeChecker`: these there have to be, whether or not anything uses them.
        let mut needed: Vec<&[u8]> = vec![
            b"IArguments",
            b"Array",
            b"Object",
            b"Function",
            b"String",
            b"Number",
            b"Boolean",
            b"RegExp",
        ];
        // `getGlobalStrictFunctionType`
        if self.files.options.strict_bind_call_apply {
            needed.extend([&b"CallableFunction"[..], b"NewableFunction"]);
        }
        let mut all = self.global_errors.lock().clone();
        for name in needed {
            let exists = self
                .files
                .atoms
                .lookup(name)
                .is_some_and(|atom| self.files.global(atom, SymFlags::TYPE).is_some());
            if !exists {
                all.insert((2318, vec![name.to_vec()]));
            }
        }
        all.into_iter().collect()
    }

    pub fn checker(&self) -> Checker<'_> {
        let checker = Checker {
            p: self,
            task: Task::new(),
            left_frame: None,
            files: &self.files,
            first_jsx: (FileId(u32::MAX), None, None),
            auto_array_type: self.auto_array_type,
            stack: Vec::new(),
            in_progress: [0; 1024],
            frames: Vec::new(),
            pending_circular_mapped_props: Vec::new(),
            circular_mapped_props: Vec::new(),
            last_enter: EnterOutcome::Entered,
            resolution_start: 0,
            eager: Vec::new(),
            loop_values: Vec::new(),
            contextual_binding_patterns: Vec::new(),
            late_bound_members: FxHashMap::default(),
            reporting_nonexistent: Vec::new(),
            declared_index_infos_in_progress: Vec::new(),
            serialization_level: 0,
            flow_type_cache: FxHashMap::default(),
            flow_type_cache_depth: usize::MAX,
            flow_invocation_count: 0,
            discarded: None,
            non_existent_properties: Default::default(),
            printing_closes_circles: false,
            reprinting: false,
            printing_floors: Vec::new(),
            context_free_level: usize::MAX,
            found_cycle: false,
            left_a_circle: false,
            taints: 0,
            taints_before_patterns: 0,
            cycles: 0,
            lowest_taint: usize::MAX,
            depth: 0,
            contextual: Vec::new(),
            pulls_contextual_types_at: usize::MAX,
            rechecks_at: usize::MAX,
            mode_of_recheck: CheckMode::empty(),
            rechecked_exprs: FxHashMap::default(),
            rechecked_members: FxHashMap::default(),
            literals_checked_under: FxHashMap::default(),
            inference_contexts: Vec::new(),
            instantiation_depth: 0,
            instantiation_count: 0,
            recent_instantiations: Default::default(),
            limits: 0,
            instantiations_up_to_a_limit: FxHashMap::default(),
            relations_cut_short: FxHashMap::default(),
            generic_relation_entries_not_published: 0,
            variances_cut_short: FxHashMap::default(),
            free_relaters: Vec::new(),
            reliability: 0,
            in_variance_computation: false,
            is_marker_comparison: false,
            is_trial_comparison: false,
            variances_in_progress: Vec::new(),
            variance_cycles: 0,
            variances_measured: Vec::new(),
            failed_type_argument: 0,
            order_dependent: FxHashMap::default(),
            order_dependent_filter: 0,
            simplified: FxHashMap::default(),
            inherited_names: [0; 4],
            cond_distributive_memo: FxHashMap::default(),
            relation_too_complex: false,
            relations_too_deep: Vec::new(),
            is_type_checked: false,
            reported: Vec::new(),
            never_checked: Default::default(),
            never_in_progress: Vec::new(),
            recent_members: Box::new([shape::RecentMembers::NONE; shape::RECENT_MEMBERS]),
            recent_signatures: Box::new(
                [(TypeId(u32::MAX), &[] as &[SigId]); shape::RECENT_SIGNATURES],
            ),
            recent_intersected_props: Box::new(
                [((TypeId(u32::MAX), Atom::NONE), TypeId::NEVER); shape::RECENT_PROPS],
            ),
            recent_unions: Default::default(),
            constraint_stack: Vec::new(),
            constraints_marked_circular: Vec::new(),
            type_arguments_in_instantiation: Vec::new(),
            conditional_constraint_depth: 0,
            deepest_stack: std::cell::Cell::new(0),
            ran_out_of_stack: std::cell::Cell::new(false),
            times_cut_short: std::cell::Cell::new(0),
            exprs_by_kind: None,
            provisional_shapes: Vec::new(),
            provisional: FxHashMap::default(),
            taint_events: Vec::new(),
            cycle_at: 0,
            limit_at: 0,
            refused_at: 0,
            enclosing_module_specifier_mode: None,
            emit_resolver_links: Default::default(),
            wanted: Requested::All,
            declaration_file: None,
            declaration_indent: None,
            has_ambient_context: false,
            parsed_again_for_await: None,
            flow_analysis_disabled_in: None,
            inline_level: 0,
            walk_declared: TypeId::NEVER,
            constant_depth: 0,
            recent_sig_params: Box::new([(SigId(u32::MAX), &[] as &[SigParam]); RECENT_SIGS]),
            recent_sig_type_params: Box::new([(SigId(u32::MAX), &[] as &[TypeId]); RECENT_SIGS]),
            awaiting: Vec::new(),
            last_flow_node: (FileId(u32::MAX), crate::bind::FlowId::NONE, false),
            undefined_properties: FxHashMap::default(),
            widening_contexts: Vec::new(),
            widened_types: FxHashMap::default(),
            iife_resolving: Vec::new(),
            flow_loops: Vec::new(),
            reverse_mapped_source_stack: Vec::new(),
            reverse_mapped_target_stack: Vec::new(),
            reverse_expanding: 0,
            flow_memo: Default::default(),
            discriminated: FxHashMap::default(),
            contextual_properties: FxHashMap::default(),
            deferred_nodes: Default::default(),
            unresolved_identifiers: Vec::new(),
            is_deferred_node: Default::default(),
            deferred_diagnostics: Vec::new(),
            node_check_flags: Default::default(),
            within_unreachable_code: false,
            reported_unreachable_nodes: Vec::new(),
            call_resolution_errors: None,
            context_checking: Vec::new(),
            context_checked_here: Default::default(),
            resolved_signatures: Default::default(),
            in_check_identifier: Vec::new(),
            resolved_meanwhile: Vec::new(),
            restrictive_operands: Vec::new(),
            prepared: Default::default(),
            last_prepared: (FileId(u32::MAX), FnId::NONE),
            prepared_exprs: (FileId(u32::MAX), Vec::new()),
            stack_base: stack_pointer(),
            stack_limit: 6 << 20,
            work: 0,
            work_trap: WORK_TRAP_DISARMED,
            refused_expressions: Vec::new(),
        };
        checker
    }
}

bun_core::declare_scope!(SemaCycles, hidden);

/// The value of `Checker::work_trap` that `Checker::work` never reaches.
const WORK_TRAP_DISARMED: u64 = u64::MAX;

/// See `Checker::begin_scope`.
#[must_use]
struct Scope {
    /// `Checker::lowest_taint` of the scope around it.
    outer_taint: usize,
    /// `frames.len()` when it began, to compare with `lowest_taint`.
    frames: u32,
    /// `non_cacheable_mark()` when it began, for `end_scope_by_counters`.
    counters: (u64, u64),
}

/// A question that may come back to itself.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
enum Query {
    Expr(FileId, ExprId),
    Symbol(Sym),
    Declared(Sym),
    Return(FileId, FnId),
    /// `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`: what a function that something is expected of returns, worked out
    /// the first time the function is looked at. No resolution is pushed for it: whoever asks for the return type meanwhile begins
    /// a resolution of their own.
    ReturnAtFirstLook(FileId, FnId),
    /// `TypeSystemPropertyNameResolvedReturnType` of a signature with a `target`. It encloses the resolution of the declared
    /// signature (`Return`) and the instantiation of its result.
    ReturnOfSignature(SigId),
    Shape(TypeId),
    Bases(Sym),
    /// `TypeSystemPropertyNameResolvedBaseConstructorType`
    BaseConstructor(Sym),
    Constraint(TypeId),
    InferredConstraint(TypeId),
    Call(FileId, ExprId),
    Pat(FileId, PatId),
    LiteralProp(FileId, PropId),
    TypeNode(FileId, TypeNodeId),
    /// The type of a property of a mapped type: the mapped type and the property name. `getTypeOfMappedSymbol`
    MappedProp(TypeId, Atom),
    Enum(FileId, EnumMemberId),
    Cond(FileId, TypeNodeId, MapperId),
    /// Whether the initializer of a parameter can be `undefined`.
    InitializerIsUndefined(FileId, ParamId),
    /// `TypeSystemPropertyNameResolvedTypeArguments`
    TypeArguments(TypeId),
    /// The relation cache entry for two types, keyed by a hash of their printed names, which is the same in every task. Never on the
    /// stack: it only owns the diagnostic of a stack depth overflow (`error_at_current_expression`).
    Comparison(u64),
}

/// The names that go with `Finished::foreign_evaluations`, for `--timing`.
pub const FOREIGN_EVALUATION_KINDS: [&str; 14] = Query::SYNTAX_KINDS;

impl Query {
    /// The kinds whose key names syntax, for `Task::foreign_evaluations`. The first eight are inference, and `--timing` sums them. The
    /// others are mostly type syntax, which every task resolves for itself.
    const SYNTAX_KINDS: [&'static str; 14] = [
        "Expr",
        "Call",
        "LiteralProp",
        "Return",
        "ReturnAtFirstLook",
        "Pat",
        "InitializerIsUndefined",
        "Symbol",
        "TypeNode",
        "Declared",
        "Cond",
        "Enum",
        "Bases",
        "BaseConstructor",
    ];

    /// The file whose syntax the key names, and the index of the kind in `SYNTAX_KINDS`. `None`: the key is a type or a signature.
    #[inline]
    fn syntax(self) -> Option<(FileId, usize)> {
        Some(match self {
            Query::Expr(file, _) => (file, 0),
            Query::Call(file, _) => (file, 1),
            Query::LiteralProp(file, _) => (file, 2),
            Query::Return(file, _) => (file, 3),
            Query::ReturnAtFirstLook(file, _) => (file, 4),
            Query::Pat(file, _) => (file, 5),
            Query::InitializerIsUndefined(file, _) => (file, 6),
            Query::Symbol(sym) => (sym.file, 7),
            Query::TypeNode(file, _) => (file, 8),
            Query::Declared(sym) => (sym.file, 9),
            Query::Cond(file, ..) => (file, 10),
            Query::Enum(file, _) => (file, 11),
            Query::Bases(sym) => (sym.file, 12),
            Query::BaseConstructor(sym) => (sym.file, 13),
            Query::ReturnOfSignature(_)
            | Query::Shape(_)
            | Query::Constraint(_)
            | Query::InferredConstraint(_)
            | Query::MappedProp(..)
            | Query::TypeArguments(_)
            | Query::Comparison(_) => return None,
        })
    }
}

bitflags::bitflags! {
    /// `CheckMode`. `CheckModeNormal` is `empty()`.
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    struct CheckMode: u8 {
        const CONTEXTUAL = 1 << 0;
        const INFERENTIAL = 1 << 1;
        const SKIP_CONTEXT_SENSITIVE = 1 << 2;
        const SKIP_GENERIC_FUNCTIONS = 1 << 3;
        const IS_FOR_SIGNATURE_HELP = 1 << 4;
        const REST_BINDING_ELEMENT = 1 << 5;
        const TYPE_ONLY = 1 << 6;
        const FORCE_TUPLE = 1 << 7;
    }
}

bitflags::bitflags! {
    /// `ContextFlags`
    #[derive(Copy, Clone, PartialEq, Eq)]
    struct ContextFlags: u8 {
        const SIGNATURE = 1 << 0;
        const NO_CONSTRAINTS = 1 << 1;
        const IGNORE_NODE_INFERENCES = 1 << 2;
        const SKIP_BINDING_PATTERNS = 1 << 3;
    }
}

/// `InferenceContextInfo`
struct InferenceContextInfo {
    file: FileId,
    node: ExprId,
    /// `None`: `pushInferenceContext(node, nil)`.
    context: Option<infer::Inference>,
}

/// How an `enter` ended.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum EnterOutcome {
    Entered,
    /// Out of time, stack or depth, or a cycle that tsgo detects, defers or never runs into.
    Refused,
    /// A cycle that tsgo does not detect: it recurses until `instantiationDepth == 100` or `tailCount == 1000`. See `is_runaway`.
    Runaway,
}

/// `Checker.currentNode`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum CurrentNode {
    Expr(FileId, ExprId),
    TypeNode(FileId, TypeNodeId),
}

/// For recursion that does not end. tsgo has no limit, and what is refused here costs dear: `gave_up` lets nothing that is under way be
/// kept. A chain of 36 functions that each return what the next returns is 220 questions deep. One question takes some 2.3 KB of
/// stack, `is_stack_low` sees to that.
const MAX_DEPTH: usize = 1000;

/// What goes with an entry of `Checker::stack`.
#[derive(Copy, Clone)]
struct QueryFrame {
    /// A number no other question has had.
    serial: u64,
    /// `instantiation_depth` when it was pushed.
    entry_depth: u32,
    /// Something it asked came back to an entry below it.
    tainted: bool,
    /// It `is_resolution`, and is part of a circle of such. See `mark_circle_from`.
    circular: bool,
    /// What is reported for it is dropped: the answer rests on a circle, a trial or a guess, and is worked out again.
    drops_reported: bool,
    /// How long `Checker::reported` was when it was pushed. What comes after is reported for it.
    reported_from: u32,
    /// Where it is counted in `Checker::in_progress`.
    class: u16,
    /// `typeResolutionHasProperty`: this checker has cached a result for the same query since the frame was pushed.
    has_result: bool,
    /// Non-cacheable because an incomplete flow-loop type was read (`taint_from`).
    incomplete_flow: bool,
}

/// Which diagnostics of a file `check_file` works out.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Requested {
    /// `GetSyntacticDiagnostics`: what the parser and the scanner say.
    Syntactic,
    /// .. and `GetDeclarationDiagnostics`. The declaration transformer asks the checker about what the file exports and nothing else.
    Declaration,
    /// .. and `getBindAndCheckDiagnostics`.
    All,
}

pub struct Checker<'p> {
    pub p: &'p Program,
    /// The task that this checker runs. Every access to a `Buffered` or `FileLocal` table takes it: it owns the write buffer.
    task: Task,
    /// The tainted frame that `leave` popped last, for `cache_provisionally`.
    left_frame: Option<QueryFrame>,
    files: &'p Files,
    /// A file that the task has gone through, and the JSX node and the fragment of it that `checkExpression` came to first.
    first_jsx: (FileId, Option<ExprId>, Option<ExprId>),
    /// `autoArrayType`
    auto_array_type: TypeId,
    stack: Vec<Query>,
    /// For each entry of `stack`.
    frames: Vec<QueryFrame>,
    /// How many entries of `stack` fall into each class. A question whose class is empty is not under way.
    in_progress: [u16; 1024],
    /// For each open `Query::MappedProp` that is part of a cycle: its index in `stack` and the type node to report 2615 at.
    /// `circular_mapped_property` commits the entry when the query is left.
    pending_circular_mapped_props: Vec<(usize, (FileId, TypeNodeId))>,
    /// The cycles through a property of a mapped type that this task has found: the type node at which 2615 is reported, the
    /// mapped type, the property. Until `check_circular_mapped_properties`.
    circular_mapped_props: Vec<((FileId, TypeNodeId), TypeId, Atom)>,
    /// How the last `enter` ended. `leave` and `excessively_deep` reset it to `Entered`.
    last_enter: EnterOutcome,
    /// The patterns whose implied type is being worked out to be what their initializer is expected to be, and how deep the
    /// stack was when that began.
    contextual_binding_patterns: Vec<(FileId, PatId, usize)>,
    /// `membersAndExportsLinks`, by container and side.
    late_bound_members: FxHashMap<(Sym, bool), late_bound::LateBoundMembers>,
    /// `nonExistentProperties`: property accesses whose 2339 message is being printed, with `stack.len()` when printing started.
    reporting_nonexistent: Vec<(FileId, ExprId, usize)>,
    /// `resolveDeclaredMembers` is at `getIndexInfosOfSymbol`, with `declaredMembersResolved` set. For each that is under way: how deep
    /// `stack` was when it got there, with the `Query::Shape` on top, and the first member of the declaration whose computed name is
    /// some string, number or symbol.
    declared_index_infos_in_progress: Vec<(usize, FileId, MemberId)>,
    /// `c.serializationLevel`: how many `TypeToString` are under way, of those whose resolutions are made at once.
    serialization_level: u32,
    /// `c.flowTypeCache`, for the loop back edge being traversed. `true`: the context-free type of the node (`c.contextFreeTypes`).
    flow_type_cache: FxHashMap<(FileId, ExprId, bool), TypeId>,
    /// `stack.len()` when that traversal began. `usize::MAX`: no back edge is being traversed.
    flow_type_cache_depth: usize,
    /// `c.flowInvocationCount`
    flow_invocation_count: u64,
    /// Where `add_diagnostic` puts what it discards.
    discarded: Option<sink::Reported>,
    /// `NodeCheckFlagsTypeChecked` on the name of a property access: its 2339 has been made. `true`: and discarded.
    non_existent_properties: crate::util::FxHashMap<(FileId, ExprId), bool>,
    /// The next `with_printer` is no barrier to circles: it prints when and what tsgo prints.
    printing_closes_circles: bool,
    /// A message is made again that was dropped with an answer that was not kept: its types are printed behind the barrier, and
    /// count no level. tsgo makes it once.
    reprinting: bool,
    /// How high `stack` was when each `typeToStringEx` under way began.
    printing_floors: Vec<usize>,
    /// How high `inference_contexts` is while `getContextFreeTypeOfExpression` checks something afresh: what is reported then stands.
    context_free_level: usize,
    /// How deep the stack was wherever something was asked that TypeScript would not have asked at that point, or not yet.
    /// A circle that goes through there may be nobody's fault but the resolver's: it is unknown, not an error.
    eager: Vec<usize>,
    /// The entries of `eager` that stand for the value assigned on the back edge of a loop that is being worked out. TypeScript asks
    /// for that value there as well: see `is_circle_of_initializers`.
    loop_values: Vec<usize>,
    /// From where in `stack` on a question counts as under way.
    resolution_start: usize,
    /// Why the last `enter` refused: what was asked is one of TypeScript's own resolutions and is under way.
    found_cycle: bool,
    /// What the last `leave` left was in a circle.
    left_a_circle: bool,
    /// Number of times frames were marked non-cacheable for any reason except `mark_tainted_by_pattern_from`.
    taints: u64,
    /// `taints` when the first entry of `contextual_binding_patterns` was pushed. `u64::MAX` if the innermost frame was non-cacheable then.
    taints_before_patterns: u64,
    /// How many questions have come back to themselves.
    cycles: u64,
    /// The lowest index given to `mark_tainted_from` since the innermost `begin_scope`.
    lowest_taint: usize,
    depth: usize,
    /// Expressions that are being checked against a type somebody pushed, innermost last.
    contextual: Vec<(FileId, ExprId, TypeId)>,
    /// How high `stack` is where `getContextualType` finds nothing pushed: what call resolution recorded as pushed (`arg_contexts`)
    /// is not read, and an argument is expected to be what `links.resolvedSignature` takes. A question entered on top of that is
    /// answered as ever, so that what is kept of it does not depend on who asked. `usize::MAX`: nowhere.
    pulls_contextual_types_at: usize,
    /// How high `stack` is where `checkExpression` is not memoised: an expression is checked again, its kept type neither read nor
    /// replaced. See `get_type_of_expression_after_check`. `usize::MAX`: nowhere.
    rechecks_at: usize,
    /// `checkMode` of the check that is not memoised. See `check_mode`.
    mode_of_recheck: CheckMode,
    /// What checking again has come to, with nothing pushed: it is the same whoever asks. By expression, and by member of an object
    /// literal or JSX attribute.
    rechecked_exprs: FxHashMap<(FileId, ExprId), TypeId>,
    rechecked_members: FxHashMap<(FileId, PropId), TypeId>,
    /// `arg_type_under`: the type of a literal argument under a parameter type.
    literals_checked_under: FxHashMap<(FileId, ExprId, TypeId, u8), TypeId>,
    /// `inferenceContextInfos`
    inference_contexts: Vec<InferenceContextInfo>,
    instantiation_depth: u32,
    /// `instantiationCount`: the instantiations computed since the last statement, type node or expression check began.
    instantiation_count: u32,
    /// What was last read from or put into `Program::instantiations`.
    recent_instantiations: instantiate::Recent,
    /// How many times `error_at_current_node` had nothing to say since `check_file` began: what was being worked out is not kept.
    limits: u64,
    /// What `Program::instantiations` does not get for that reason, with the number of the outermost question under way. While that
    /// is open no way to the limit is gone twice. Whoever asks next runs into the limit itself.
    instantiations_up_to_a_limit: FxHashMap<(TypeId, MapperId), (u64, TypeId)>,
    /// The same for the results of `check_type_related_to` and of `variances_of` during which `cuts` moved.
    relations_cut_short: FxHashMap<relate::Key, (u64, bool)>,
    /// Entries of `relations` under a generic key whose hash took in an own id. They are not published: see `relate::Key`.
    pub(super) generic_relation_entries_not_published: u64,
    variances_cut_short: FxHashMap<Sym, (u64, Arc<[u8]>)>,
    free_relaters: Vec<relate::Relater>,
    /// What the comparisons under way found out about how far the variance being measured can be trusted.
    reliability: u8,
    in_variance_computation: bool,
    /// The next call of `related` compares two marker types for `variances_of`. Consumed on entry.
    is_marker_comparison: bool,
    /// The next `related` is the trial of `check_type_related_to_ex`: see `Relater::caches_failures`.
    pub(super) is_trial_comparison: bool,
    variances_in_progress: Vec<Sym>,
    /// How many times `variances_worker` was re-entered for a symbol in `variances_in_progress`.
    variance_cycles: u32,
    /// The entries cached since the outermost `variances_worker` call on the stack began.
    variances_measured: Vec<(Sym, Arc<[u8]>)>,
    /// After `type_arguments_related_to` returns false: the index of the pair that is not related.
    failed_type_argument: u32,
    /// The index of each symbol in `Task::order_dependent_variances`.
    order_dependent: FxHashMap<Sym, u32>,
    /// A 64-bit Bloom filter for the keys of `order_dependent`.
    order_dependent_filter: u64,
    simplified: FxHashMap<(TypeId, bool), TypeId>,
    /// A bit for each of 256 numbers that the name of a property of `Object`, `Function`, `CallableFunction` or `NewableFunction` falls on:
    /// a name that falls on another is none of theirs. All zero: not made yet.
    pub(super) inherited_names: [u64; 4],
    /// `resolvedConstraintOfDistributive`. `None` is `noConstraintType`.
    cond_distributive_memo: FxHashMap<TypeId, Option<TypeId>>,
    /// Set when a comparison exhausts `Relater::relation_count` (2859). The caller clears it before comparing.
    pub(super) relation_too_complex: bool,
    /// The two types of each `checkTypeRelatedToEx` that has reached 100 nested comparisons (2321). The caller clears it before comparing.
    pub(super) relations_too_deep: Vec<(TypeId, TypeId)>,
    /// `NodeCheckFlagsTypeChecked` of `task.file`: `check_file` is through with it.
    is_type_checked: bool,
    /// What has been reported for the questions under way, and with none under way: see `sink`.
    reported: Vec<Reported>,
    /// From where to where in `task.file` `checkSourceFile` never comes. The passes that go through all nodes of a kind do.
    never_checked: std::cell::RefCell<Vec<(u32, u32)>>,
    /// The intersections it is being found out of whether anything can be them.
    pub(super) never_in_progress: Vec<TypeId>,
    /// What was last found in `Program::members`, in the tables of signatures and in `intersected_props`, by the low bits of the key.
    recent_members: Box<[shape::RecentMembers<'p>; shape::RECENT_MEMBERS]>,
    recent_signatures: Box<[(TypeId, &'p [SigId]); shape::RECENT_SIGNATURES]>,
    recent_intersected_props: Box<[((TypeId, Atom), TypeId); shape::RECENT_PROPS]>,
    /// What `union` last made of two types, the one with the lower number first.
    recent_unions: instantiate::Recent,
    /// The `stack` of `getResolvedBaseConstraint`: what the constraints being worked out, one for the sake of the other, are instances of.
    constraint_stack: Vec<relate::RecursionId>,
    /// The types whose `Query::Constraint` is in flight and was marked at a refused `enter`: `pushTypeResolution` marks every entry from
    /// the start of the cycle to the top of the stack. The `leave` of the frame takes the type out and stores the flag.
    constraints_marked_circular: Vec<TypeId>,
    /// The deferred type references for which `resolve_type_arguments` is in `c.instantiateTypes(typeArguments, d.mapper)`, outermost first.
    /// One can be there many times: no `Query` is in flight at that point, as `popTypeResolution` has run.
    type_arguments_in_instantiation: Vec<TypeId>,
    /// `conditionalConstraintDepth`
    conditional_constraint_depth: u32,
    deepest_stack: std::cell::Cell<usize>,
    ran_out_of_stack: std::cell::Cell<bool>,
    /// How often the native stack ran low, or a result of `relations_cut_short` or `variances_cut_short` was read.
    times_cut_short: std::cell::Cell<u64>,
    /// Of the file that was last asked about.
    exprs_by_kind: Option<(FileId, std::rc::Rc<hir::ExprsByKind>)>,
    /// See `provisional_shape`, which hands out a reference to what is in the box and pushes the next.
    #[expect(clippy::vec_box)]
    provisional_shapes: Vec<Box<shape::Resolved>>,
    /// Non-cacheable query results, for reuse while the computation that made them non-cacheable is in flight. See `cache_provisionally`.
    provisional: FxHashMap<Query, Provisional>,
    /// `work` and `from` of each call of `mark_tainted_by_pattern_from` and `taint_from`, in order. An event is dropped when a later one has a
    /// lower or equal `from`, so `from` increases and the length is bounded by the depth of `stack`. See `lowest_taint_since`.
    taint_events: Vec<(u64, u32)>,
    /// `work` when `cycles` was last incremented, when `limits` was, and when a query was last refused by `gave_up`. `QueryFrame::serial` is
    /// `work` when the frame was pushed, so the event happened since then if the value is not lower than the serial number.
    cycle_at: u64,
    limit_at: u64,
    refused_at: u64,
    /// `GetModeForUsageLocation` of `TryGetModuleSpecifierFromDeclaration(enclosingDeclaration)`, while the name of an import or an
    /// export is printed.
    enclosing_module_specifier_mode: Option<ResolutionMode>,
    emit_resolver_links: errors_declaration_emit::EmitResolverLinks,
    wanted: Requested,
    /// What `get_declaration_diagnostics` leaves for `checked`.
    declaration_file: Option<Vec<u8>>,
    /// While a declaration file is written: how deep the line that is being written is indented.
    declaration_indent: Option<usize>,
    /// Whether anything in the file that is being checked is in an ambient context.
    has_ambient_context: bool,
    /// `reparseTopLevelAwait`: the statements of that file that end up in an await context. Sorted. Found out when first asked for.
    parsed_again_for_await: Option<Vec<StmtId>>,
    /// `flowAnalysisDisabled`: the file whose nodes the writer of `.types` checks again with the flag set.
    flow_analysis_disabled_in: Option<FileId>,
    /// How many `const ok = test` are being looked through.
    inline_level: u32,
    /// The declared type of what the flow walk under way narrows.
    walk_declared: TypeId,
    constant_depth: u32,
    /// What `sig_params` and `sig_type_params` last said that holds for good, by the low bits of the signature's number.
    recent_sig_params: Box<[(SigId, &'p [SigParam]); RECENT_SIGS]>,
    recent_sig_type_params: Box<[(SigId, &'p [TypeId]); RECENT_SIGS]>,
    /// The unions whose members are being awaited.
    awaiting: Vec<TypeId>,
    /// `lastFlowNode`, `lastFlowNodeReachable`
    last_flow_node: (FileId, crate::bind::FlowId, bool),
    /// `undefinedProperties`. There it lasts as long as a checker, which checks many files. Here a checker checks one. The widened
    /// type of an exported variable is kept in the shared memo by whoever asks first, with the table of that checker, so the ORDER of
    /// its printed properties can vary with more than one thread. If that is flagged, the table is for what is not kept there.
    undefined_properties: FxHashMap<Atom, Prop>,
    /// Those of the unions being widened. A `*WideningContext` is a place in it.
    widening_contexts: Vec<symbols::WideningContext<'p>>,
    /// `cachedTypes[CachedTypeKindWidened]`
    widened_types: FxHashMap<TypeId, TypeId>,
    /// The calls of functions written on the spot whose arguments are being looked at to type the parameters.
    iife_resolving: Vec<(FileId, ExprId)>,
    /// The loops being worked out, by whichever walk (`flowLoopStack`): the loop, what is narrowed, its declared and its initial
    /// type, what has reached the loop so far, and how deep `stack` was when the round began.
    flow_loops: Vec<(
        crate::bind::FlowId,
        flow::Reference,
        TypeId,
        TypeId,
        TypeId,
        usize,
    )>,
    /// What mapped types were made from is being worked out from what they came to, for these.
    reverse_mapped_source_stack: Vec<TypeId>,
    reverse_mapped_target_stack: Vec<TypeId>,
    reverse_expanding: u8,
    /// What narrowing has worked out once and for all.
    flow_memo: flow::FlowMemo,
    /// `deferredNodes` of the file being checked.
    /// `deferredNodes`, an ordered set.
    deferred_nodes: std::collections::VecDeque<ExprId>,
    /// The identifiers `getResolvedSymbol` found nothing for, until `report_unresolved_identifiers`.
    unresolved_identifiers: Vec<(FileId, ExprId, Atom)>,
    is_deferred_node: crate::util::FxHashSet<ExprId>,
    /// `deferredDiagnosticCallbacks`: the declarations `checkWeakMapSetCollision` or `checkReflectCollision` is put off for.
    deferred_diagnostics: Vec<Node>,
    /// `nodeLinks.flags`, of the file that is being checked.
    node_check_flags: FxHashMap<Node, u8>,
    /// `withinUnreachableCode`
    within_unreachable_code: bool,
    /// `reportedUnreachableNodes`, of the file being checked.
    reported_unreachable_nodes: Vec<StmtId>,
    /// `discriminatedContextualTypes`: what `discriminate_by_object_members` makes of an object literal and a union, where
    /// that holds for good.
    discriminated: FxHashMap<(FileId, ExprId, TypeId), TypeId>,
    /// See `contextual_property_of_value`.
    contextual_properties: FxHashMap<(TypeId, Atom), Option<TypeId>>,
    /// The next target to be related to is a member of an intersection.
    /// What `resolveCall` has just reported. `resolved_signature` takes it, and stores it only together with the entry of `calls`.
    call_resolution_errors: Option<Vec<Reported>>,
    /// `links.resolvedSignature != nil` of the calls that this checker has had resolved and that `Program::calls` may not have: tsgo caches
    /// a signature that was resolved inside a cycle, `calls` does not. Whether a call is put off under `CheckModeSkipGenericFunctions` goes
    /// by the two together.
    resolved_signatures: crate::util::FxHashSet<(FileId, ExprId)>,
    /// The functions whose first look is under way, see `context_checked`. They are in `Program::context_checked`, for every thread,
    /// once what the first look works out is: whoever found the one without the other would go on without a first look of its own.
    context_checking: Vec<((FileId, crate::hir::FnId), Option<SigId>)>,
    /// The functions whose entry in `Program::context_checked` this checker wrote or tried to write. See `is_context_checked`.
    context_checked_here: crate::util::FxHashSet<(FileId, crate::hir::FnId)>,
    /// `NodeCheckFlagsInCheckIdentifier`: the patterns `getNarrowedTypeOfSymbol` is at.
    in_check_identifier: Vec<(FileId, crate::hir::PatId)>,
    /// `resolvedSignature = result`, while `resolveCall` reports the errors of a call that nothing takes.
    resolved_meanwhile: Vec<(FileId, ExprId, call::ResolvedCall)>,
    /// The two types of each restrictive comparison under way, innermost last: what `getRestrictiveInstantiation` returned.
    restrictive_operands: Vec<(TypeId, TypeId)>,
    /// Functions whose context `prepare_enclosing` has seen to.
    prepared: crate::util::FxHashSet<(FileId, FnId)>,
    last_prepared: (FileId, FnId),
    /// A file, and which of its expressions have been through `prepare_around`.
    prepared_exprs: (FileId, Vec<bool>),
    /// Where the stack was when the checker was made, and how far below that it may go.
    stack_base: usize,
    stack_limit: usize,
    /// Questions asked so far.
    pub work: u64,
    /// `enter` takes its slow path when `work` has this value: the next value of `work` while `refused_expressions` is not empty,
    /// `WORK_TRAP_DISARMED` otherwise.
    work_trap: u64,
    /// The file, start and end of the expressions in which a query was refused for lack of native stack. See `refuse_for_lack_of_stack`.
    refused_expressions: Vec<(FileId, u32, u32)>,
}

/// Where the stack of the thread has got to. The register, not the address of a local: under a sanitizer that looks for uses after a
/// return, locals whose address is taken are not on the stack at all.
#[inline(always)]
fn stack_pointer() -> usize {
    #[cfg(target_arch = "x86_64")]
    {
        let sp: usize;
        // SAFETY: reading the register has no effect.
        unsafe {
            core::arch::asm!("mov {}, rsp", out(reg) sp, options(nomem, nostack, preserves_flags))
        };
        sp
    }
    #[cfg(target_arch = "aarch64")]
    {
        let sp: usize;
        // SAFETY: reading the register has no effect.
        unsafe {
            core::arch::asm!("mov {}, sp", out(reg) sp, options(nomem, nostack, preserves_flags))
        };
        sp
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        let probe = 0u8;
        (&raw const probe).addr()
    }
}

impl<'p> Checker<'p> {
    // ───────────────────────────── access ─────────────────────────────

    #[inline]
    pub fn hir(&self, file: FileId) -> &'p hir::File {
        self.files.hir(file)
    }

    #[inline]
    pub fn bound(&self, file: FileId) -> &'p Bound {
        self.files.bound(file)
    }

    #[inline]
    pub fn data(&self, ty: TypeId) -> &'p TypeData {
        self.types().get(ty)
    }

    /// The published types and the task's own: all that the task sees.
    #[inline(always)]
    pub fn types(&self) -> Types<'p> {
        Types::new(&self.p.types, &self.task.own)
    }

    #[inline]
    pub fn atoms(&self) -> Atoms<'p> {
        Atoms::new(&self.p.files.atoms, &self.task.own)
    }

    #[inline]
    pub fn intern(&self, data: TypeData) -> TypeId {
        self.types().intern(data)
    }

    /// `IndexInfo.components`
    #[inline]
    pub fn index_components(&self, id: ComponentsId) -> &'p [IndexComponent] {
        self.types().components(id)
    }

    /// The type parameter `tp` of `file`, as declared.
    #[inline]
    pub fn type_param(&self, file: FileId, tp: TypeParamId) -> TypeId {
        match self.p.declared_type_params.get(&self.task, &(file, tp)) {
            Some(kept) => kept,
            None => self.intern_type_param(file, tp),
        }
    }

    #[inline(never)]
    fn intern_type_param(&self, file: FileId, tp: TypeParamId) -> TypeId {
        use crate::bind::{Decl::TypeParam, ScopeKind};
        // `getDeclaredTypeOfTypeParameter(getSymbolOfDeclaration(tp))`: the declarations of a class or an interface declare their type
        // parameters in `symbol.Members`, so those of one name are one symbol and one type.
        let (bound, files) = (self.bound(file), self.files());
        let scope = bound.scopes.get(bound.type_param_scope[tp.idx()].idx());
        let declarations = match scope.map(|scope| scope.kind) {
            Some(ScopeKind::Class(_) | ScopeKind::Interface(_)) => {
                files.decls_of(files.sym(file, bound.type_param_symbol[tp.idx()]))
            }
            _ => List::default(),
        };
        let (of, first) = declarations
            .iter()
            .find_map(|&(of, declaration)| match declaration {
                TypeParam(first) => Some((of, first)),
                _ => None,
            })
            .unwrap_or((file, tp));
        let made = self.intern(TypeData::TypeParam(of, first, MapperId::IDENTITY));
        (self.p.declared_type_params).insert(&self.task, (file, tp), made, Stored::new())
    }

    /// `cloneTypeParameter`: the type parameter `tp` of a signature found where the type parameters around the signature stand
    /// for what `around` says. Where each stands for itself nothing was instantiated, and it is the declared one
    /// (`resolveObjectTypeMembers`, `getObjectTypeInstantiation`).
    pub fn cloned_type_param(&self, file: FileId, tp: TypeParamId, around: MapperId) -> TypeId {
        let around = if self.types().mapping(around).iter().all(|p| p.0 == p.1) {
            MapperId::IDENTITY
        } else {
            around
        };
        self.intern(TypeData::TypeParam(file, tp, around))
    }

    #[inline]
    fn files(&self) -> &'p Files {
        self.files
    }

    /// Whether a conditional or a mapped type is written in `file`: in any other, `getConditionalFlowTypeOfType` finds nothing on its way up.
    #[inline]
    pub(super) fn has_conditional_or_mapped_type(&self, file: FileId) -> bool {
        self.files.has_conditional_or_mapped_type(file)
    }

    // ───────────────────────────── questions in progress ─────────────────────────────

    /// From now on `check_file` works out these.
    pub fn set_requested(&mut self, wanted: Requested) {
        self.wanted = wanted;
    }

    /// How much stack the thread has from here on. Questions that need more are answered "unresolved".
    pub fn set_stack_limit(&mut self, bytes: usize) {
        self.stack_base = stack_pointer();
        self.stack_limit = bytes;
    }

    /// Whether there is little room left to recurse in.
    #[inline]
    pub(crate) fn is_stack_low(&self) -> bool {
        let used = self.stack_base.saturating_sub(stack_pointer());
        if used > self.deepest_stack.get() {
            self.deepest_stack.set(used);
        }
        if used > self.stack_limit {
            self.ran_out_of_stack.set(true);
            self.times_cut_short.set(self.times_cut_short.get() + 1);
            return true;
        }
        false
    }

    /// Whether a question has gone unanswered for want of room to recurse in. Errors may be missing for it.
    pub fn ran_out_of_stack(&self) -> bool {
        self.ran_out_of_stack.get()
    }

    /// The most stack that was in use when a question was asked.
    pub fn deepest_stack(&self) -> usize {
        self.deepest_stack.get()
    }

    /// `false`: the question is being answered further down the stack.
    #[inline]
    fn enter(&mut self, q: Query) -> bool {
        self.work += 1;
        self.found_cycle = false;
        if (self.work == self.work_trap || self.is_stack_low()) && self.refuse_for_lack_of_stack(q)
        {
            return false;
        }
        let class = (crate::util::fx_hash(&q) >> 54) as u16;
        let from = self.resolution_start;
        // `checkExpression` and `checkPropertyAssignment` have no guard: what is checked by value is checked again while it is being
        // checked.
        if !(matches!(q, Query::Expr(..) | Query::LiteralProp(..)) && self.is_rechecking())
            && self.in_progress[class as usize] != 0
            && let Some(i) = self.stack[from..].iter().rposition(|x| *x == q)
            && self.on_reentry(q, i + from)
        {
            return false;
        }
        if self.stack.len() >= MAX_DEPTH {
            return self.refuse_as_too_deep();
        }
        self.last_enter = EnterOutcome::Entered;
        self.stack.push(q);
        self.in_progress[class as usize] += 1;
        if let Some((file, kind)) = q.syntax()
            && Some(file) != self.task.file
        {
            self.note_foreign_evaluation(file, kind);
        }
        // What is asked under what a question that only holds for now has pushed only holds for now.
        let tainted = !self.inference_contexts.is_empty() && self.is_innermost_tainted();
        // What is reported under a loop that is under way stands (`taint_from`).
        let drops_reported =
            tainted && self.frames.last().is_some_and(|frame| frame.drops_reported);
        let incomplete_flow = tainted
            && self
                .frames
                .last()
                .is_some_and(|frame| frame.incomplete_flow);
        self.frames.push(QueryFrame {
            class,
            serial: self.work,
            entry_depth: self.instantiation_depth,
            tainted,
            circular: false,
            drops_reported,
            reported_from: self.reported.len() as u32,
            has_result: false,
            incomplete_flow,
        });
        true
    }

    /// Counts the evaluation of a query about `file`, which is not the file that the task goes through, if `file` is a source file in
    /// another component of the import graph. Nothing has published the result, so the task computes a copy of its own. A declaration
    /// file does not count: every task resolves nodes of the library for itself.
    #[inline(never)]
    fn note_foreign_evaluation(&mut self, file: FileId, kind: usize) {
        let Some(own) = self.task.file else {
            return;
        };
        let component_of = &self.files.components.of_file;
        if self.hir(file).kind != FileKind::Declaration
            && component_of[file.idx()] != component_of[own.idx()]
        {
            self.task.foreign_evaluations[kind] += 1;
        }
    }

    /// The slow path of the first test in `enter`. `false`: `q` is not refused.
    ///
    /// After a refusal no query in flight is cacheable. Every later query about a part of the same expression would descend the same
    /// chain and be refused again, which costs depth^3 for nested calls. So the outermost expression in flight is recorded, and until the
    /// end of `check_file` every query about an expression inside it is refused at once.
    #[cold]
    #[inline(never)]
    fn refuse_for_lack_of_stack(&mut self, q: Query) -> bool {
        let span_of = |c: &Self, q: Query| match q {
            Query::Expr(file, e) | Query::Call(file, e) => {
                Some((file, c.start_of(file, e), c.end_of_expr(file, e)))
            }
            _ => None,
        };
        let is_refused = |c: &Self, (file, start, end): (FileId, u32, u32)| {
            let contains =
                |outer: &(FileId, u32, u32)| outer.0 == file && outer.1 <= start && end <= outer.2;
            c.refused_expressions.iter().any(contains)
        };
        let queried = span_of(self, q);
        let is_low = self.is_stack_low();
        if is_low {
            let outermost = self.stack.iter().find_map(|&q| span_of(self, q));
            if let Some(outermost) = outermost.or(queried)
                && !is_refused(self, outermost)
            {
                self.refused_expressions.push(outermost);
            }
        }
        // Every later `enter` takes this path.
        self.work_trap = if self.refused_expressions.is_empty() {
            WORK_TRAP_DISARMED
        } else {
            self.work + 1
        };
        if !is_low && !queried.is_some_and(|queried| is_refused(self, queried)) {
            return false;
        }
        self.last_enter = EnterOutcome::Refused;
        self.gave_up();
        true
    }

    #[cold]
    #[inline(never)]
    fn refuse_as_too_deep(&mut self) -> bool {
        self.last_enter = EnterOutcome::Refused;
        self.ran_out_of_stack.set(true);
        bun_core::scoped_log!(
            SemaCycles,
            "too deep: {:?}",
            &self.stack[self.stack.len() - 12..]
        );
        self.gave_up();
        false
    }

    /// What `enter` makes of a `q` that is under way at `stack[i]`. `false`: it is begun once more.
    #[cold]
    #[inline(never)]
    fn on_reentry(&mut self, q: Query, i: usize) -> bool {
        // `findResolutionCycleStartIndex` looks no further down than a resolution that has its answer: what is asked for is
        // begun once more, and comes to that answer.
        if self.is_resolution(q) && self.is_resolved_since(i) {
            return false;
        }
        // `getConditionalTypeInstantiation` has no re-entrancy check and caches its result only when it returns, so the conditional type
        // is evaluated again. The recursion ends at a type resolution that detects a cycle, at members that are already installed, or
        // at an instantiation limit.
        if matches!(q, Query::Cond(..)) {
            return false;
        }
        self.last_enter = EnterOutcome::Refused;
        // What is being computed between there and here is computed without the answer, so it only holds for now.
        self.mark_tainted_from(i + 1);
        // TypeScript does not notice an expression that is looked at again while it is being looked at: it goes the
        // same way once more, and the first resolution on that way is the one to come back to itself.
        // A call that is asked what it expects of an argument while it is being resolved is another matter
        // (`resolvingSignature`): whoever asks goes without an answer, and nothing is wrong. So are members that are in place.
        // Exception: if the first frame above the re-entered expression is a `typeToStringEx` call, with no type resolution in
        // between, the second pass prints one serialization level higher, and at `maxSerializationLevel` the printer returns "?"
        // without resolving anything. That recursion terminates without a cycle.
        let first_printing = self.printing_floors.iter().find(|&&floor| floor > i);
        let is_through_printing = first_printing
            .is_some_and(|&floor| !self.stack[i..floor].iter().any(|&q| self.is_resolution(q)));
        let marked = !self.ends_at_members_in_place(i)
            && (self.is_resolution(q) || !is_through_printing)
            && self.mark_circle_from(i);
        self.found_cycle = marked && self.is_resolution(q);
        if marked && self.is_runaway(i) {
            self.last_enter = EnterOutcome::Runaway;
            bun_core::scoped_log!(SemaCycles, "RUNAWAY {:?}", q);
        }
        self.note_cycle();
        self.task.closed_a_cycle = true;
        bun_core::scoped_log!(SemaCycles, "cycle: {:?}", &self.stack[i..]);
        true
    }

    /// Whether `q` asks for the members of a function, class, enum or module as a value, or of a mapped type.
    /// `resolveAnonymousTypeMembers` calls `setStructuredTypeMembers` before it asks for the base constructor type or a signature, and
    /// `resolveMappedTypeMembers` before anything else ("such that recursive references see an empty object type"). So for whoever asks
    /// meanwhile `resolveStructuredTypeMembers` returns at once.
    fn has_members_in_place(&self, q: Query) -> bool {
        matches!(q, Query::Shape(ty) if matches!(
            self.data(ty),
            TypeData::Anon {
                origin: Origin::ClassStatic(_)
                    | Origin::Function(_)
                    | Origin::EnumObject(_)
                    | Origin::Module(_)
                    | Origin::GlobalThis
                    | Origin::Mapped(..),
                ..
            }
        ))
    }

    /// Whether going the way from `stack[i]` once more ends before it comes to a resolution, at members that are in place.
    fn ends_at_members_in_place(&self, i: usize) -> bool {
        let before_first_resolution = self.stack[i..]
            .iter()
            .take_while(|&&q| !self.is_resolution(q));
        before_first_resolution
            .into_iter()
            .any(|&q| self.has_members_in_place(q))
    }

    /// Whether re-entering `stack[i]` is a recursion that tsgo does not detect. `getTypeFromTypeNode`, `getTypeAliasInstantiation` and
    /// `getConditionalType` push no type resolution and cache their result only when they return, so a cycle of type nodes and
    /// conditional types alone runs into an instantiation limit. tsgo ends the cycle where it defers a type reference
    /// (`isDeferredTypeReferenceNode`, `getObjectTypeInstantiation`): at an element type or a type argument. That is a type node
    /// directly inside a type node, or an `instantiate` nested in the `instantiate` of the reference.
    fn is_runaway(&self, i: usize) -> bool {
        let is_type_node = |q: &Query| matches!(q, Query::TypeNode(..));
        let (cycle, frames) = (&self.stack[i..], &self.frames[i..]);
        cycle
            .iter()
            .all(|q| matches!(q, Query::TypeNode(..) | Query::Cond(..)))
            && !(cycle.iter().zip(&cycle[1..])).any(|(a, b)| is_type_node(a) && is_type_node(b))
            && !(is_type_node(&cycle[0]) && cycle.last().is_some_and(is_type_node))
            && (frames.iter().zip(&frames[1..])).all(|(a, b)| b.entry_depth <= a.entry_depth + 1)
            && frames
                .last()
                .is_some_and(|last| self.instantiation_depth <= last.entry_depth + 1)
    }

    /// `pushTypeResolution` finding what is asked for under way at `i`: everything from there up that is a resolution is in the
    /// circle, and comes to `any`. `false`, and nothing is marked: TypeScript does not look that far down, or would not have asked.
    fn mark_circle_from(&mut self, i: usize) -> bool {
        if i < self.resolution_start || self.is_resolved_since(i) {
            return false;
        }
        // Every entry of `loop_values` is an entry of `eager` too.
        let barriers = self.eager.iter().filter(|&&from| from > i).count();
        let loop_values = self.loop_values.iter().filter(|&&from| from > i).count();
        if barriers > loop_values || barriers > 0 && !self.is_circle_of_initializers(i) {
            return false;
        }
        for j in i..self.stack.len() {
            let q = self.stack[j];
            if !self.is_resolution(q) {
                continue;
            }
            if !self.frames[j].circular {
                bun_core::scoped_log!(SemaCycles, "CIRCLE {:?} in {:?}", q, &self.stack[i..]);
            }
            self.frames[j].circular = true;
            if matches!(q, Query::MappedProp(..))
                && let Some(node) = self.first_checked_type_node(j)
            {
                match self
                    .pending_circular_mapped_props
                    .iter_mut()
                    .find(|pending| pending.0 == j)
                {
                    Some(pending) => pending.1 = pending.1.min(node),
                    None => self.pending_circular_mapped_props.push((j, node)),
                }
            }
        }
        true
    }

    /// `c.currentNode` in `getTypeOfMappedSymbol` for the `Query::MappedProp` at `stack[frame]`, computed when a cycle through it
    /// closes. tsgo reports 2615 at the node `checkSourceElement` is at when the property is first resolved, so the position follows
    /// check order, not the order of queries here. Resolving any type node on the stack leads into the cycle, so the first of
    /// them in check order is the answer. Type nodes are numbered children first, the order in which `checkSourceElement`
    /// resolves them.
    fn first_checked_type_node(&self, frame: usize) -> Option<(FileId, TypeNodeId)> {
        // `checkExpression` makes its expression the current node until it returns. A type node is still current when the property
        // is resolved only if no expression is checked on the way: up to `frame`, or around the cycle to the top of the stack.
        let is_expr = |q: &Query| matches!(q, Query::Expr(..));
        let below = self.stack[..frame]
            .iter()
            .rposition(is_expr)
            .map_or(0, |i| i + 1);
        let above = self.stack[frame..]
            .iter()
            .rposition(is_expr)
            .map_or(frame, |i| frame + i + 1);
        let candidates = self.stack[below..frame].iter().chain(&self.stack[above..]);
        candidates
            .filter_map(|q| match *q {
                Query::TypeNode(file, node) if self.is_resolved_by_check(file, node) => {
                    Some((file, node))
                }
                _ => None,
            })
            .min()
    }

    /// Whether `checkSourceElement` resolves the type of `node` when it visits the node. `checkArrayType`, `checkTypeOperator`,
    /// `checkConditionalType` and `checkInferType` only visit the children. Declaration files are not checked (`skipLibCheck`).
    fn is_resolved_by_check(&self, file: FileId, node: TypeNodeId) -> bool {
        let hir = self.hir(file);
        hir.kind != FileKind::Declaration
            && matches!(
                hir[node].kind,
                TypeNodeKind::Ref { .. }
                    | TypeNodeKind::Import { .. }
                    | TypeNodeKind::Typeof { .. }
                    | TypeNodeKind::Object(_)
                    | TypeNodeKind::Tuple(_)
                    | TypeNodeKind::Union(_)
                    | TypeNodeKind::Intersection(_)
                    | TypeNodeKind::Template { .. }
                    | TypeNodeKind::IndexedAccess { .. }
                    | TypeNodeKind::Mapped(_)
            )
    }

    /// `getTypeOfMappedSymbol`: reports 2615 for the `Query::MappedProp` that was just left in a cycle.
    pub(super) fn circular_mapped_property(&mut self, mapped: TypeId, name: Atom) {
        let frame = self.stack.len();
        if let Some(i) = self
            .pending_circular_mapped_props
            .iter()
            .position(|pending| pending.0 == frame)
        {
            let (_, node) = self.pending_circular_mapped_props.swap_remove(i);
            let stored = self.cycle_result();
            (self.p.mapped_types_with_errors).insert(&mut self.task, mapped, (), stored);
            self.circular_mapped_props.push((node, mapped, name));
        }
    }

    /// Whether `q` is a question TypeScript keeps track of as well (`TypeSystemPropertyName`): the type of something with a name,
    /// what a function returns, what a class or an interface extends, what a type alias stands for, the base constraint of a type,
    /// whether the initializer of a parameter can be `undefined`.
    /// One that depends on itself is an error there, and `any`; here anything else that does is unknown.
    fn is_resolution(&self, q: Query) -> bool {
        match q {
            Query::Return(..)
            | Query::ReturnOfSignature(_)
            | Query::MappedProp(..)
            | Query::Bases(_)
            | Query::BaseConstructor(_)
            | Query::Constraint(_)
            | Query::InitializerIsUndefined(..)
            | Query::TypeArguments(_) => true,
            // `getTypeOfSymbol` tests for a variable or a property first. `getTypeOfFuncClassEnumModule` and `getTypeOfEnumMember`
            // push no resolution.
            Query::Symbol(sym) => {
                let flags = self.files().flags(sym);
                flags.intersects(SymFlags::VARIABLE | SymFlags::PROPERTY | SymFlags::MODULE_EXPORTS)
                    || !flags.intersects(
                        SymFlags::FUNCTION
                            | SymFlags::CLASS
                            | SymFlags::ENUM
                            | SymFlags::VALUE_MODULE
                            | SymFlags::ENUM_MEMBER,
                    )
            }
            Query::Pat(file, pat) => matches!(self.hir(file)[pat].kind, PatKind::Ident(_)),
            // `getDeclaredTypeOfTypeAlias` is the only one to push `TypeSystemPropertyNameDeclaredType`.
            Query::Declared(sym) => self.files().flags(sym).contains(SymFlags::TYPE_ALIAS),
            _ => false,
        }
    }

    /// `typeResolutionHasProperty` for the frames from `i` up. In tsgo `links` belong to one checker. A result that another thread
    /// has cached in the meantime is a valid value for any caller, but is unrelated to the queries this checker has in flight.
    fn is_resolved_since(&self, i: usize) -> bool {
        self.frames[i..].iter().any(|frame| frame.has_result)
    }

    /// False if `q` is not on `stack`. Reads the per-class counter that `enter` tests before it scans the stack.
    #[inline]
    fn may_be_in_flight(&self, q: Query) -> bool {
        self.in_progress[(crate::util::fx_hash(&q) >> 54) as usize] != 0
    }

    /// `resolvedX == nil && findResolutionCycleStartIndex(target, property) >= 0`, from this checker's own state.
    fn is_resolving(&self, q: Query) -> bool {
        let from = self.resolution_start.min(self.stack.len());
        self.may_be_in_flight(q)
            && self.stack[from..]
                .iter()
                .rposition(|x| *x == q)
                .is_some_and(|i| !self.is_resolved_since(from + i))
    }

    /// A result for `q` has been cached by this checker. Marks the frames of `q` that are still on the stack.
    #[cold]
    #[inline(never)]
    fn note_result(&mut self, q: Query) {
        if self.is_resolution(q) {
            for (frame, _) in self
                .frames
                .iter_mut()
                .zip(&self.stack)
                .filter(|x| *x.1 == q)
            {
                frame.has_result = true;
            }
        }
    }

    /// Moves whenever a computation is cut short at a point that depends on how deep the caller is: an instantiation limit was hit, or the
    /// native stack ran low.
    fn cuts(&self) -> u64 {
        self.limits + self.times_cut_short.get()
    }

    /// A result that was cut short has been read. Leaves the marks that computing it again would, so that what is computed from it is
    /// recorded in its turn.
    fn cut_short_again(&mut self) {
        self.times_cut_short.set(self.times_cut_short.get() + 1);
        self.gave_up();
    }

    /// A question went unanswered only because of how deep it was asked. Asked from elsewhere it has an answer, so
    /// nothing that is being computed from the lack of one may be kept.
    fn gave_up(&mut self) {
        self.mark_tainted_from(0);
        self.note_cycle();
        self.refused_at = self.work;
    }

    /// `c.currentNode`, derived from the queries in progress. `checkExpression` always sets it. `getTypeFromTypeNode` never does, but
    /// `checkSourceElement` visits a type node before anything resolves it: the type nodes `check_type_node` asks about, a
    /// type written in an expression (`checkAssertion`), and the type arguments of a call (`resolveCall`). A type node reached
    /// through any other query is resolved on demand and leaves `currentNode` alone.
    pub(super) fn current_node(&self) -> Option<CurrentNode> {
        let innermost_expr = self
            .stack
            .iter()
            .rposition(|q| matches!(q, Query::Expr(..)));
        let mut inner = &self.stack[innermost_expr.unwrap_or(0)..];
        let mut current = None;
        if let [Query::Expr(file, e), rest @ ..] = inner {
            current = Some(CurrentNode::Expr(*file, *e));
            inner = match rest {
                [Query::Call(..), rest @ ..] => rest,
                _ => rest,
            };
        }
        for q in inner {
            let Query::TypeNode(file, node) = *q else {
                break;
            };
            current = Some(CurrentNode::TypeNode(file, node));
        }
        current
    }

    /// `instantiateTypeWithAlias`, `getConditionalType`: an instantiation limit was hit. Reports 2589 at `currentNode` and returns the
    /// error type. Safe to call after any `enter` that refused. Returns `UNRESOLVED` where our recursion is no evidence of tsgo's:
    /// after a refusal other than `EnterOutcome::Runaway`, and more than 60 levels of `instantiate` deep under a conditional type.
    pub(super) fn excessively_deep(&mut self) -> TypeId {
        // Only the call right after a refused `enter` sees the refusal.
        let is_limit_in_tsgo = match std::mem::replace(&mut self.last_enter, EnterOutcome::Entered)
        {
            EnterOutcome::Runaway => true,
            EnterOutcome::Refused => false,
            // `getConditionalType` loops where `conditional_type` recurses: a tail call costs one level of `instantiate` here and
            // none in tsgo. `instantiate` allows at least 60 levels.
            EnterOutcome::Entered => {
                self.instantiation_depth <= 60
                    || !self.stack.iter().any(|q| matches!(q, Query::Cond(..)))
            }
        };
        if !is_limit_in_tsgo {
            return TypeId::UNRESOLVED;
        }
        self.error_at_current_node(2589);
        TypeId::ERROR
    }

    /// `instantiateTypeWithAlias`: `instantiationDepth == 100`. `instantiation_depth` counts what tsgo counts under a conditional type
    /// too: `resolve_conditional` follows a tail call in a loop, as `getConditionalType` does.
    pub(super) fn instantiation_too_deep(&mut self) -> TypeId {
        if std::mem::replace(&mut self.last_enter, EnterOutcome::Entered) == EnterOutcome::Refused {
            return TypeId::UNRESOLVED;
        }
        self.error_at_current_node(2589);
        TypeId::ERROR
    }

    /// `c.error_at(c.currentNode, ..)`: the computation in progress has reached a limit. As a checker of tsgo's, the task reports it once,
    /// at the node it is checking at that moment, and stores the result. What a task sees is a function of the program, so which task
    /// reaches the limit, and at which node, is too.
    #[cold]
    fn error_at_current_node(&mut self, code: u32) {
        // Under `eager`, tsgo evaluates this later or never, with another `currentNode`.
        let is_reported = self.eager.is_empty();
        let Some(current) = self.current_node().filter(|_| is_reported) else {
            self.note_limit();
            return self.mark_tainted_from(0);
        };
        let at = match current {
            CurrentNode::Expr(file, e) => (
                file,
                self.error_start_inside_parentheses(file, e),
                self.error_end_inside_parentheses(file, e),
            ),
            CurrentNode::TypeNode(file, node) => (
                file,
                self.hir(file)[node].pos,
                self.end_of_type_node(file, node),
            ),
        };
        self.add_diagnostic_of(None, Reported::bare(at, code));
    }

    /// `error_at_current_node`, with arguments, where `c.currentNode` is an expression. Elsewhere nothing is said here: see
    /// `relations_too_deep`.
    #[cold]
    fn error_at_current_expression(&mut self, code: u32, args: &[Arg<'_>]) {
        if let (Some(CurrentNode::Expr(file, e)), true) =
            (self.current_node(), self.eager.is_empty())
        {
            let at = (
                file,
                self.error_start_inside_parentheses(file, e),
                self.error_end_inside_parentheses(file, e),
            );
            let diagnostic = self.new_diagnostic(at, code, args);
            // tsgo caches the overflow in the relation cache, so the next comparison of the two types is a cache hit and reports nothing.
            let mut hasher = crate::util::FxHasher::default();
            std::hash::Hash::hash(&(code, &diagnostic.args), &mut hasher);
            let comparison = Query::Comparison(std::hash::Hasher::finish(&hasher));
            self.add_diagnostic_of(Some(comparison), diagnostic);
        }
    }

    /// See `pulls_contextual_types_at`.
    #[inline]
    fn pulls_contextual_types(&self) -> bool {
        self.stack.len() == self.pulls_contextual_types_at
    }

    /// Pops the frame of `q`. `Ok`: the result is finished, and the token is the permission to store it. `Err`: it depends on a frame that
    /// is still in progress, and may only go to `cache_provisionally`.
    #[inline]
    fn leave(&mut self, q: Query) -> Result<Stored, Open> {
        let popped = self.stack.pop();
        debug_assert!(popped == Some(q));
        self.last_enter = EnterOutcome::Entered;
        let frame = self.frames.pop().unwrap();
        self.in_progress[frame.class as usize] -= 1;
        if self.in_progress[frame.class as usize] != 0 && (!frame.tainted || frame.circular) {
            self.note_result(q);
        }
        self.left_a_circle = frame.circular;
        if self.reported.len() > frame.reported_from as usize {
            self.settle_reported(frame, q);
        }
        if frame.tainted {
            self.left_frame = Some(frame);
            return Err(Open);
        }
        Ok(Stored::new())
    }

    /// See `rechecks_at`.
    #[inline]
    fn is_rechecking(&self) -> bool {
        self.stack.len() == self.rechecks_at
    }

    /// The `checkMode` parameter of `checkExpression`. What is kept is checked in `CheckModeNormal`.
    #[inline]
    fn check_mode(&self) -> CheckMode {
        if self.is_rechecking() {
            self.mode_of_recheck
        } else {
            CheckMode::empty()
        }
    }

    /// From here, and as long as `stack` is as high as it is, expressions are checked again, with nothing pushed. Returns what
    /// `end_recheck` takes.
    fn begin_recheck(&mut self) -> (usize, usize) {
        let height = self.stack.len();
        (
            std::mem::replace(&mut self.pulls_contextual_types_at, height),
            std::mem::replace(&mut self.rechecks_at, height),
        )
    }

    /// From here, and as long as `stack` is as high as it is, expressions are checked once (`checkExpressionCached`). Returns what
    /// `end_recheck` takes.
    fn suspend_recheck(&mut self) -> (usize, usize) {
        (
            std::mem::replace(&mut self.pulls_contextual_types_at, usize::MAX),
            std::mem::replace(&mut self.rechecks_at, usize::MAX),
        )
    }

    fn end_recheck(&mut self, outer: (usize, usize)) {
        (self.pulls_contextual_types_at, self.rechecks_at) = outer;
    }

    /// The answers to the questions from `stack[from]` up do not hold whoever asks.
    fn mark_tainted_from(&mut self, from: usize) {
        self.taints += 1;
        self.mark_tainted_by_pattern_from(from);
    }

    /// `mark_tainted_from`, because an identifier declared in a pattern in `contextual_binding_patterns` evaluated to `any`. Not counted in
    /// `taints`.
    fn mark_tainted_by_pattern_from(&mut self, from: usize) {
        self.lowest_taint = self.lowest_taint.min(from);
        self.note_taint_event(from);
        for frame in &mut self.frames[from..] {
            frame.tainted = true;
            frame.drops_reported = true;
        }
    }

    fn note_taint_event(&mut self, from: usize) {
        let is_covered = |event: &(u64, u32)| event.1 as usize >= from;
        while self.taint_events.last().is_some_and(is_covered) {
            self.taint_events.pop();
        }
        self.taint_events.push((self.work, from as u32));
    }

    /// The lowest index from which frames were tainted since the frame with the serial number `serial` was pushed. `usize::MAX`: no event.
    fn lowest_taint_since(&self, serial: u64) -> usize {
        let first = self.taint_events.partition_point(|event| event.0 < serial);
        let event = self.taint_events.get(first);
        event.map_or(usize::MAX, |event| event.1 as usize)
    }

    /// What is reported for the innermost question is dropped, whether or not the answer is kept.
    fn drop_reported(&mut self) {
        if let Some(frame) = self.frames.last_mut() {
            frame.drops_reported = true;
        }
    }

    /// Begins a computation that is not a query on `stack` but whose result is cached, such as a type comparison.
    #[inline]
    fn begin_scope(&mut self) -> Scope {
        Scope {
            outer_taint: std::mem::replace(&mut self.lowest_taint, usize::MAX),
            frames: self.frames.len() as u32,
            counters: self.non_cacheable_mark(),
        }
    }

    /// `leave`, for the computation since `begin_scope`. It counts as a frame on top of those in flight when it began. A cycle among
    /// queries that were entered and left since then is closed: those queries have their final results, and so has the computation.
    #[inline]
    fn end_scope(&mut self, scope: Scope) -> Result<Stored, Open> {
        let is_open = self.lowest_taint <= scope.frames as usize;
        self.end_scope_as(scope, is_open)
    }

    /// `end_scope` for a memo that is guarded by the counters alone: `Ok` iff `non_cacheable_mark()` has not moved since
    /// `begin_scope`. A taint event that moves no counter does not count here.
    #[inline]
    fn end_scope_by_counters(&mut self, scope: Scope) -> Result<Stored, Open> {
        let is_open = self.non_cacheable_mark() != scope.counters;
        self.end_scope_as(scope, is_open)
    }

    /// `end_scope` for a memo with a test of its own.
    #[inline]
    fn end_scope_as(&mut self, scope: Scope, is_open: bool) -> Result<Stored, Open> {
        self.lowest_taint = self.lowest_taint.min(scope.outer_taint);
        if is_open {
            Err(Open)
        } else {
            Ok(Stored::new())
        }
    }

    /// Permission to store the result that a member of a resolution cycle gets: `any` or the error type. tsgo caches it for every member
    /// (`!popTypeResolution()`) and after a failed `pushTypeResolution`, also where `leave` returns `Err`. The value is a constant, derived
    /// from no unfinished result.
    fn cycle_result(&self) -> Stored {
        debug_assert!(self.left_a_circle || self.found_cycle);
        Stored::new()
    }

    fn is_innermost_tainted(&self) -> bool {
        self.frames.last().is_some_and(|frame| frame.tainted)
    }

    fn is_innermost_in_a_circle(&self) -> bool {
        self.frames.last().is_some_and(|frame| frame.circular)
    }

    /// The expressions of `file` kind by kind, for whoever is after a few kinds and would otherwise go through all of them. It is put
    /// together once for a file. The handle borrows nothing: `let index = self.exprs_by_kind(file); for &e in index.of(ExprTag::Call)`.
    pub(crate) fn exprs_by_kind(&mut self, file: FileId) -> std::rc::Rc<hir::ExprsByKind> {
        match &self.exprs_by_kind {
            Some((of, index)) if *of == file => std::rc::Rc::clone(index),
            _ => {
                let index = std::rc::Rc::new(hir::ExprsByKind::new(self.hir(file)));
                self.exprs_by_kind = Some((file, std::rc::Rc::clone(&index)));
                index
            }
        }
    }

    /// Changes whenever something happens that keeps what is being worked out from holding for whoever asks next: a question came back to
    /// itself, something was read that rests on a candidate being tried out, or an instantiation went too deep, which is said again
    /// to everybody who gets there.
    #[inline]
    fn non_cacheable_mark(&self) -> (u64, u64) {
        (self.cycles as u64, self.limits)
    }

    /// Keeps `raw`, the result of `q`, for which `leave` has just returned `Err(open)`. `provisional` returns it while it is valid.
    ///
    /// A frame is non-cacheable if its result depends on a query in flight (a cycle), on a refused query (native stack, `MAX_DEPTH`,
    /// instantiation depth) or on a binding pattern whose implied type is being computed. Nothing is written to a shared cache then.
    /// The result stays valid until the outermost non-cacheable frame is popped, because everything it depends on is unchanged until
    /// then. It is stored in `provisional` for that time. Otherwise it would be computed again on every use, and a computation
    /// that uses each sub-result twice would cost 2^depth. After that frame is popped, the next use computes the result from a clean state.
    ///
    /// A result that depends on an incomplete flow-loop type is valid for a shorter time. The incomplete type of a loop changes when the
    /// traversal of one of its back edges returns. So the scope is a frame that was pushed during the traversal in progress of the
    /// innermost loop: the frame at the stack height at which that loop was pushed, or the outermost frame marked by `taint_from` if that
    /// is higher.
    ///
    /// A result that depends on a refused query (`gave_up`) is reused only at the same or a greater stack height, where computing it
    /// again would be refused again. A query from a lower height has more room and may succeed, so it computes.
    ///
    /// A hit has the effects of computing the result again, and no more. A type comparison in flight is not stored in `relations` if a
    /// frame at or below its own height is tainted before it ends, so a hit that taints too much turns that memo table off.
    /// - A frame that `enter` pushed as tainted, and that no taint event reached, taints no caller when it is computed again. A hit
    ///   taints nothing. It is a hit only where `enter` would push a tainted frame again.
    /// - Otherwise a hit taints from the lowest index of the events since the frame was pushed: one above the cycle head. The entry
    ///   is valid only while the head is in flight too.
    #[cold]
    #[inline(never)]
    fn cache_provisionally(&mut self, q: Query, raw: u64, _: Open) {
        let Some(frame) = self.left_frame.take() else {
            return;
        };
        let flow = frame.incomplete_flow;
        let scope = if flow {
            // No loop on `flow_loops`: `type_of_expr_outside_loops` has set them aside, so the height is unknown and nothing is stored.
            let innermost_loop = self.flow_loops.last().map(|in_progress| in_progress.5);
            let outermost = self.frames.iter().position(|frame| frame.incomplete_flow);
            (outermost.zip(innermost_loop))
                .map(|(outermost, innermost_loop)| outermost.max(innermost_loop))
        } else {
            self.frames.iter().position(|frame| frame.tainted)
        };
        // An event from the frame's own index up has tainted no caller.
        let from = self.lowest_taint_since(frame.serial);
        let from = (from < self.frames.len()).then_some(from);
        let scope = scope.map(|depth| match from {
            Some(from) if !flow => depth.max(from.saturating_sub(1)),
            _ => depth,
        });
        if !frame.circular
            && let Some(depth) = scope
            && let Some(scope) = self.frames.get(depth)
        {
            let since = |at: u64| u8::from(at >= frame.serial);
            self.provisional.insert(
                q,
                Provisional {
                    raw,
                    depth: depth as u32,
                    from: match from {
                        Some(_) if flow => depth as u32,
                        Some(from) => from as u32,
                        None => u32::MAX,
                    },
                    height: self.stack.len() as u32,
                    moved: since(self.cycle_at)
                        | since(self.limit_at) << 1
                        | u8::from(flow) << 2
                        | since(self.refused_at) << 3,
                    serial: scope.serial,
                },
            );
        }
    }

    /// The result `cache_provisionally` stored for `q`, if it is still valid.
    #[inline]
    fn provisional(&mut self, q: Query) -> Option<u64> {
        if self.provisional.is_empty() {
            return None;
        }
        self.provisional_hit(q)
    }

    #[inline(never)]
    fn provisional_hit(&mut self, q: Query) -> Option<u64> {
        if self.stack.is_empty() {
            // `clear` costs O(capacity).
            if self.provisional.capacity() > 1024 {
                self.provisional = FxHashMap::default();
            }
            self.provisional.clear();
            return None;
        }
        let entry = *self.provisional.get(&q)?;
        let depth = entry.depth as usize;
        if self.frames.get(depth).map(|frame| frame.serial) != Some(entry.serial) {
            self.provisional.remove(&q);
            return None;
        }
        if entry.moved & 8 != 0 && self.stack.len() < entry.height as usize {
            return None;
        }
        // The test of `enter`.
        if entry.from == u32::MAX
            && (self.inference_contexts.is_empty() || !self.is_innermost_tainted())
        {
            return None;
        }
        if entry.moved & 8 != 0 {
            self.refused_at = self.work;
        }
        // The counters that guard the other memo tables move if they moved then.
        match (entry.from, entry.moved & 4) {
            (u32::MAX, _) => {}
            (from, 0) => self.mark_tainted_from(from as usize),
            (from, _) => self.taint_from(from as usize),
        }
        if entry.moved & 1 != 0 {
            self.note_cycle();
        }
        if entry.moved & 2 != 0 {
            self.note_limit();
        }
        Some(entry.raw)
    }

    /// Increments `cycles`.
    #[inline]
    fn note_cycle(&mut self) {
        self.cycles += 1;
        self.cycle_at = self.work;
    }

    /// Increments `limits`.
    #[inline]
    fn note_limit(&mut self) {
        self.limits += 1;
        self.limit_at = self.work;
    }

    /// Something that only holds for now was just read, put there when `stack` was `depth` deep: the answers to the questions
    /// begun since are not kept. So of a loop under way: `getResolvedSignature` stores nothing while `flowLoopStack` has
    /// something on it, and `checkExpressionCached` empties it first. What they report stands: `getTypeOfExpression` reports as ever.
    fn taint_from(&mut self, depth: usize) {
        if depth >= self.frames.len() {
            return;
        }
        self.lowest_taint = self.lowest_taint.min(depth);
        self.note_taint_event(depth);
        for frame in &mut self.frames[depth..] {
            frame.tainted = true;
            frame.incomplete_flow = true;
        }
        self.taints += 1;
        self.note_cycle();
    }

    // ───────────────────────────── kinds of types ─────────────────────────────

    #[inline]
    pub fn is_any(&self, ty: TypeId) -> bool {
        ty == TypeId::UNRESOLVED || self.has_any_flag(ty)
    }

    /// `TypeFlagsAny`: `anyType`, `errorType`, or the type of a type name that does not resolve.
    #[inline]
    pub fn has_any_flag(&self, ty: TypeId) -> bool {
        ty.is_any() || self.is_unresolved_name(ty)
    }

    /// `isErrorType`
    #[inline]
    pub fn is_error_type(&self, ty: TypeId) -> bool {
        ty == TypeId::ERROR || self.is_unresolved_name(ty)
    }

    #[inline]
    fn is_unresolved_name(&self, ty: TypeId) -> bool {
        self.types().is_unresolved_name(ty)
    }

    /// `getUnresolvedSymbolForEntityName`, `getTypeFromTypeAliasReference`
    pub(super) fn unresolved_name_type(&mut self, names: &[Atom], args: &[TypeId]) -> TypeId {
        // A missing identifier has no text: `unknownSymbol`, of which `getTypeReferenceType` makes `errorType`.
        if names.last() == Some(&known::empty) {
            return TypeId::ERROR;
        }
        let mut path: Vec<u8> = Vec::new();
        for (i, &name) in names.iter().enumerate() {
            if i > 0 {
                path.push(b'.');
            }
            path.extend_from_slice(self.atoms().bytes(name));
        }
        let name = self.atoms().intern(&path);
        self.intern(TypeData::UnresolvedName {
            name,
            args: args.into(),
        })
    }

    #[inline]
    pub fn has_type_variables(&self, ty: TypeId) -> bool {
        self.types()
            .object_flags(ty)
            .contains(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES)
    }

    /// `Type.flags`
    #[inline]
    pub fn flags(&self, ty: TypeId) -> u32 {
        self.types().flags(ty)
    }

    #[inline]
    pub fn is_union(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::UNION != 0
    }

    /// The members of a union; the type itself otherwise; nothing for `never`.
    #[inline]
    pub fn parts(&self, ty: TypeId) -> &'p [TypeId] {
        self.types().parts(ty)
    }

    /// `TypeFlagsObject`, but for an evolving array.
    #[inline]
    pub fn is_object_type(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::OBJECT != 0 && !matches!(self.data(ty), TypeData::EvolvingArray(_))
    }

    #[inline]
    pub fn is_type_variable(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::TYPE_VARIABLE != 0
    }

    /// A type whose members cannot be known before its type parameters are.
    #[inline]
    pub fn is_deferred(&self, ty: TypeId) -> bool {
        self.flags(ty) & (tf::INSTANTIABLE_NON_PRIMITIVE | tf::INDEX) != 0
    }

    #[inline]
    pub fn is_literal(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::LITERAL != 0
    }

    #[inline]
    pub fn is_unit(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::UNIT != 0
    }

    #[inline]
    pub fn is_string_like(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::STRING_LIKE != 0
    }

    #[inline]
    pub fn is_number_like(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::NUMBER_LIKE != 0
    }

    #[inline]
    pub fn is_bigint_like(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::BIGINT_LIKE != 0
    }

    /// `getUnionTypeFromSortedList` gives it to the union of the two boolean literal types, whatever alias or origin that has.
    #[inline]
    pub fn is_boolean(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::BOOLEAN != 0
    }

    #[inline]
    pub fn is_boolean_like(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::BOOLEAN_LITERAL != 0
    }

    #[inline]
    pub fn is_symbol_like(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::ES_SYMBOL_LIKE != 0
    }

    #[inline]
    pub fn is_nullish(&self, ty: TypeId) -> bool {
        self.flags(ty) & (tf::NULLABLE | tf::VOID) != 0
    }

    /// `TypeFlagsPrimitive`, but for the unions that have it: `boolean`, an enum.
    #[inline]
    pub fn is_primitive(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::PRIMITIVE != 0 && self.flags(ty) & tf::UNION == 0
    }

    /// Whether every member of `ty` passes.
    pub fn every_type(&self, ty: TypeId, f: impl Fn(&Self, TypeId) -> bool) -> bool {
        match self.data(ty) {
            TypeData::Union(members) => members.iter().all(|&m| f(self, m)),
            _ => f(self, ty),
        }
    }

    pub fn some_type(&self, ty: TypeId, f: impl Fn(&Self, TypeId) -> bool) -> bool {
        match self.data(ty) {
            TypeData::Union(members) => members.iter().any(|&m| f(self, m)),
            _ => f(self, ty),
        }
    }

    // ───────────────────────────── literals ─────────────────────────────

    pub fn string_literal(&self, value: Atom, fresh: bool) -> TypeId {
        self.intern(TypeData::StringLit { value, fresh })
    }

    /// `getNumberLiteralType`: there is one `NaN` and one zero.
    pub fn number_literal(&self, value: f64, fresh: bool) -> TypeId {
        let value = if value.is_nan() {
            f64::NAN
        } else if value == 0.0 {
            0.0
        } else {
            value
        };
        self.intern(TypeData::NumberLit {
            bits: value.to_bits(),
            fresh,
        })
    }

    pub fn bool_literal(&self, value: bool, fresh: bool) -> TypeId {
        match (value, fresh) {
            (false, false) => TypeId::FALSE,
            (true, false) => TypeId::TRUE,
            (false, true) => TypeId::FRESH_FALSE,
            (true, true) => TypeId::FRESH_TRUE,
        }
    }

    fn with_freshness(&self, ty: TypeId, fresh: bool) -> TypeId {
        match *self.data(ty) {
            TypeData::StringLit { value, fresh: f } if f != fresh => {
                self.intern(TypeData::StringLit { value, fresh })
            }
            TypeData::NumberLit { bits, fresh: f } if f != fresh => {
                self.intern(TypeData::NumberLit { bits, fresh })
            }
            TypeData::BigIntLit {
                text,
                negative,
                fresh: f,
            } if f != fresh => self.intern(TypeData::BigIntLit {
                text,
                negative,
                fresh,
            }),
            TypeData::BoolLit { value, fresh: f } if f != fresh => self.bool_literal(value, fresh),
            TypeData::EnumLit {
                member,
                value,
                fresh: f,
            } if f != fresh => self.intern(TypeData::EnumLit {
                member,
                value,
                fresh,
            }),
            TypeData::Enum { symbol, fresh: f } if f != fresh => {
                self.intern(TypeData::Enum { symbol, fresh })
            }
            _ => ty,
        }
    }

    pub fn is_fresh_literal(&self, ty: TypeId) -> bool {
        matches!(
            *self.data(ty),
            TypeData::StringLit { fresh: true, .. }
                | TypeData::NumberLit { fresh: true, .. }
                | TypeData::BigIntLit { fresh: true, .. }
                | TypeData::BoolLit { fresh: true, .. }
                | TypeData::EnumLit { fresh: true, .. }
                | TypeData::Enum { fresh: true, .. }
        )
    }

    /// The literal type as an annotation would name it.
    pub fn regular(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Union(members) if members.iter().any(|&m| self.is_fresh_literal(m)) => {
                self.map_type(ty, |c, m| c.with_freshness(m, false))
            }
            _ => self.with_freshness(ty, false),
        }
    }

    pub fn fresh(&self, ty: TypeId) -> TypeId {
        self.with_freshness(ty, true)
    }

    /// `"a"` is `string`, whether or not it is fresh, and so are `` `a${string}` `` and `Uppercase<T>`. `getBaseTypeOfLiteralType`
    pub fn base_of_literal(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::StringLit { .. }
            | TypeData::Template { .. }
            | TypeData::StringMapping { .. } => TypeId::STRING,
            TypeData::NumberLit { .. } => TypeId::NUMBER,
            TypeData::BigIntLit { .. } => TypeId::BIGINT,
            TypeData::BoolLit { .. } => TypeId::BOOLEAN,
            TypeData::EnumLit { member, .. } => self.enum_type_of_member(*member),
            // `getBaseTypeOfEnumLikeType`: an enum without members is its own.
            TypeData::Enum { symbol, .. }
                if self.files().flags(*symbol).contains(SymFlags::ENUM_MEMBER) =>
            {
                self.enum_type_of_member(*symbol)
            }
            TypeData::Union(_) => self.map_type(ty, |c, m| c.base_of_literal(m)),
            _ => ty,
        }
    }

    /// What a mutable location initialized with `ty` holds: a fresh `"a"` is `string`.
    pub fn widen_literal(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Union(members) => {
                if !members.iter().any(|&m| self.is_fresh_literal(m)) {
                    return ty;
                }
                self.map_type(ty, |c, m| c.widen_literal(m))
            }
            _ if self.is_fresh_literal(ty) => self.base_of_literal(ty),
            _ => ty,
        }
    }

    // ───────────────────────────── well-known global types ─────────────────────────────

    /// An error that is in no file: `c.error(nil, ..)`. It belongs to the entry of the innermost query, or to the task.
    pub(super) fn report_global_error(&mut self, code: u32, args: Vec<Vec<u8>>) {
        let owner = self.stack.last().copied();
        let diagnostic = Reported::new(explain::NOWHERE, code, sink::held(args));
        self.add_diagnostic_of(owner, diagnostic);
    }

    #[inline]
    pub fn global_type_symbol(&self, name: Atom) -> Option<Sym> {
        self.files.global_type_symbol(name)
    }

    /// `getGlobalType`: the global class or interface `name` that has `arity` type parameters. Anything else of that name is as
    /// good as nothing.
    #[inline]
    pub fn global_type_of_arity(&self, name: Atom, arity: usize) -> Option<Sym> {
        self.files.global_type_of_arity(name, arity)
    }

    /// `Name<args>` for a global class or interface. Where there is none it is `{}`, which is an answer, not the lack of one
    /// (`createTypeFromGenericGlobalType`, and `getGlobalType` itself for one without type parameters).
    pub fn global_ref(&mut self, name: Atom, args: &[TypeId]) -> TypeId {
        match self.global_type_of_arity(name, args.len()) {
            Some(target) => self.intern(TypeData::Ref {
                target,
                args: args.into(),
            }),
            None => TypeId::EMPTY_OBJECT,
        }
    }

    pub fn array_of(&mut self, element: TypeId) -> TypeId {
        self.global_ref(known::Array, &[element])
    }

    /// `globalReadonlyArrayType` is `globalArrayType` where there is no `ReadonlyArray`.
    pub fn readonly_array_of(&mut self, element: TypeId) -> TypeId {
        let name = if self.global_type_of_arity(known::ReadonlyArray, 1).is_some() {
            known::ReadonlyArray
        } else {
            known::Array
        };
        self.global_ref(name, &[element])
    }

    /// `createPromiseType`, of what has been awaited: `unknown` where there is no `Promise`.
    pub fn promise_of(&mut self, value: TypeId) -> TypeId {
        match self.global_ref(known::Promise, &[value]) {
            TypeId::EMPTY_OBJECT => TypeId::UNKNOWN,
            promise => promise,
        }
    }

    /// `createGeneratorType`: where there is no `Generator` an `IterableIterator` does, and where there is neither, `{}`.
    pub fn generator_of(
        &mut self,
        yielded: TypeId,
        returned: TypeId,
        next: TypeId,
        is_async: bool,
    ) -> TypeId {
        // `resolveIterationType`
        let (yielded, returned) = if is_async {
            (self.awaited(yielded), self.awaited(returned))
        } else {
            (yielded, returned)
        };
        let (generator, iterator) = if is_async {
            (known::AsyncGenerator, known::AsyncIterableIterator)
        } else {
            (known::Generator, known::IterableIterator)
        };
        let name = if self.global_type_of_arity(generator, 3).is_some() {
            generator
        } else {
            iterator
        };
        self.global_ref(name, &[yielded, returned, next])
    }

    /// Whether `ty` is a reference to the global class or interface `name`.
    fn is_reference_to_global(&self, ty: TypeId, name: Atom) -> bool {
        matches!(self.data(ty), TypeData::Ref { target, .. }
            if self.files().symbol(*target).name == name
                && self.global_type_symbol(name) == Some(*target))
    }

    /// The type arguments of `ty`, if it is a reference to the global class or interface `name`.
    fn is_global_ref(&mut self, ty: TypeId, name: Atom) -> Option<&'p [TypeId]> {
        if self.is_reference_to_global(ty, name) {
            Some(self.type_arguments(ty))
        } else {
            None
        }
    }

    /// The element type of `T[]` or `readonly T[]`.
    pub fn array_element(&mut self, ty: TypeId) -> Option<TypeId> {
        if self.is_array(ty) {
            self.type_arguments(ty).first().copied()
        } else {
            None
        }
    }

    /// `isArrayType`
    pub fn is_array(&self, ty: TypeId) -> bool {
        self.is_reference_to_global(ty, known::Array)
            || self.is_reference_to_global(ty, known::ReadonlyArray)
    }

    pub fn is_tuple(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Tuple { .. })
    }

    pub fn is_array_or_tuple(&self, ty: TypeId) -> bool {
        self.is_array(ty) || self.is_tuple(ty)
    }

    /// `createNormalizedTupleTypeEx`, once the variadic elements that are known have been spread (`normalized_tuple`).
    pub fn tuple(&mut self, elems: &[TypeId], flags: &[ElemFlags], readonly: bool) -> TypeId {
        if !flags
            .iter()
            .any(|f| f.intersects(ElemFlags::OPTIONAL | ElemFlags::REST | ElemFlags::VARIADIC))
        {
            return self.intern(TypeData::Tuple {
                elems: elems.into(),
                flags: flags.into(),
                readonly,
            });
        }
        // `TupleNormalizer.add`: what may be left out may be undefined.
        let mut types = Vec::with_capacity(elems.len());
        for (&elem, flag) in elems.iter().zip(flags) {
            types.push(if flag.contains(ElemFlags::OPTIONAL) {
                self.optional_property(elem)
            } else {
                elem
            });
        }
        let mut infos = flags.to_vec();
        let last_required = flags
            .iter()
            .rposition(|f| f.contains(ElemFlags::REQUIRED))
            .unwrap_or(0);
        let first_rest = flags.iter().position(|f| f.contains(ElemFlags::REST));
        let last_loose = flags
            .iter()
            .rposition(|f| f.intersects(ElemFlags::OPTIONAL | ElemFlags::REST));
        // `TupleNormalizer.normalize`: what comes before an element that may not be left out may not be left out either.
        for info in &mut infos[..last_required] {
            if info.contains(ElemFlags::OPTIONAL) {
                *info = ElemFlags::REQUIRED.with_label(info.label());
            }
        }
        // From the first rest element to the last optional or rest element there was, it is all one rest element.
        if let (Some(first), Some(last)) = (first_rest, last_loose)
            && first < last
        {
            let merged: Vec<TypeId> = (first..=last)
                .map(|i| {
                    if infos[i].contains(ElemFlags::VARIADIC) {
                        self.indexed_access(types[i], TypeId::NUMBER)
                    } else {
                        types[i]
                    }
                })
                .collect();
            types[first] = self.union(&merged);
            types.drain(first + 1..=last);
            infos.drain(first + 1..=last);
        }
        // `getTupleTargetType`: `[...X[]]` is `X[]`.
        if let ([element], [only]) = (&types[..], &infos[..])
            && only.contains(ElemFlags::REST)
        {
            return if readonly {
                self.readonly_array_of(*element)
            } else {
                self.array_of(*element)
            };
        }
        self.intern(TypeData::Tuple {
            elems: types.into(),
            flags: infos.into(),
            readonly,
        })
    }

    pub fn synth(&self, shape: Shape) -> TypeId {
        self.intern(TypeData::Synth(Box::new(shape)))
    }

    /// `T | undefined`, which only strictNullChecks tells from `T`. `addOptionality`
    pub fn optional(&mut self, ty: TypeId) -> TypeId {
        if !self.p.files.options.strict_null_checks {
            return ty;
        }
        self.union(&[ty, TypeId::UNDEFINED])
    }

    /// What an index signature gives where it may have nothing to give, under noUncheckedIndexedAccess:
    /// `getUnionType([ty, missingType])`, whatever strictNullChecks and exactOptionalPropertyTypes say.
    pub fn with_missing(&mut self, ty: TypeId) -> TypeId {
        self.union(&[ty, TypeId::MISSING])
    }

    /// `undefinedOrMissingType`
    pub fn undefined_or_missing(&self) -> TypeId {
        if self.p.files.options.exact_optional_property_types {
            TypeId::MISSING
        } else {
            TypeId::UNDEFINED
        }
    }

    /// What a property or an element of type `ty` that may be left out holds. `addOptionalityEx(ty, isProperty = true, true)`
    pub fn optional_property(&mut self, ty: TypeId) -> TypeId {
        if !self.p.files.options.strict_null_checks {
            return ty;
        }
        let missing = self.undefined_or_missing();
        self.union(&[ty, missing])
    }

    /// `removeMissingType`
    pub fn remove_missing_type(&mut self, ty: TypeId, is_optional: bool) -> TypeId {
        if is_optional && self.p.files.options.exact_optional_property_types {
            self.filter(ty, |_, m| m != TypeId::MISSING)
        } else {
            ty
        }
    }

    /// `removeMissingOrUndefinedType`. Without the option it is `getTypeWithFacts(ty, TypeFactsNEUndefined)`, which `void` does
    /// not pass either.
    pub fn remove_missing_or_undefined_type(&mut self, ty: TypeId) -> TypeId {
        if self.p.files.options.exact_optional_property_types {
            self.filter(ty, |_, m| m != TypeId::MISSING)
        } else {
            self.filter(ty, |_, m| !m.is_undefined() && m != TypeId::VOID)
        }
    }

    /// `containsMissingType`
    pub fn contains_missing_type(&self, ty: TypeId) -> bool {
        self.parts(ty).contains(&TypeId::MISSING)
    }
}
