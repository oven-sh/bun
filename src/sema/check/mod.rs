//! Answers type queries on demand. Nothing is computed until it is requested, every result is
//! cached, and a circular query yields "unresolved".
//!
//! [`Program`] is shared by all threads and only ever grows. A [`Checker`] belongs to one thread
//! and owns the stack of queries in progress and all other transient state.

/// Concatenates the pieces.
macro_rules! cat {
    ($($piece:expr),+ $(,)?) => { [$(&$piece[..]),+].concat() };
}

mod alias;
mod call;
mod check_order;
mod check_source_file;
pub mod commit;
mod context;
mod decl;
mod decorators;
mod enclosing_declaration;
pub mod errors;
mod errors_access;
mod errors_aliases;
mod errors_assign;
mod errors_call;
mod errors_circular;
mod errors_classes;
mod errors_collisions;
mod errors_decl;
mod errors_declaration_emit;
mod errors_duplicates;
mod errors_emit_helpers;
mod errors_enums_names;
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
mod errors_names_and_exports;
mod errors_operators;
mod errors_order;
mod errors_overloads;
mod errors_signatures;
mod errors_small;
mod errors_statements;
mod errors_type_nodes;
mod errors_unused;
pub mod explain;
mod explain_relation;
mod expr;
mod flow;
mod grammarchecks;
mod infer;
mod instantiate;
pub mod jsdoc;
mod jsx;
mod late_bound;
mod links;
mod loop_cycles;
mod mapped;
mod order;
mod print;
pub(crate) mod regexp_scanner;
mod relate;
mod related;
mod related_expected;
pub mod services;
mod shape;
mod shortcuts;
mod signature_links;
mod sink;
pub mod spans;
mod symbol_ids;
#[cfg(feature = "baselines")]
#[path = "../standalone/symbol_writer.rs"]
pub mod symbol_writer;
mod symbols;
pub mod task;
#[cfg(feature = "baselines")]
#[path = "../standalone/type_writer.rs"]
pub mod type_writer;
mod union_property;
mod unions;
#[cfg(feature = "baselines")]
#[path = "../standalone/visit_node.rs"]
mod visit_node;

use crate::atom::{Atom, Atoms, known};
use crate::bind::{AssignmentKind, AssignmentTarget, Bound, ModuleInstanceState, SymFlags};
use crate::hir::{self, *};
use crate::local::MaybeLocal;
use crate::program::{FileId, Files, Sym};
use crate::session::{Arena, ArenaBox, Session};
use crate::session::{ArenaVec, vec_from_iter_in};
use crate::table::{At, Bases, Buffered, ById, ByIdIndirect, ByKey, ByNode, ByNodeIndirect};
use crate::table::{FileLocal, OfExpressions};
use crate::types::Prop;
use crate::types::*;
use crate::util::{FxHashMap, List};
use bun_threading::Guarded;
use errors_aliases::SpecifierSite;
use errors_names_and_exports::{root_declaration, root_pattern};
use errors_type_nodes::array_element_type_node;
use errors_type_nodes::has_parse_diagnostics;
use errors_type_nodes::start_of_type;
pub use regexp_scanner::get_spelling_suggestion;
use regexp_scanner::spelling_suggestion;
use shape::members_among;
use sink::{Arg, Reported};
use spans::end_of_brackets;
use spans::is_identifier_part;
use spans::skip_trivia;
use spans::start_of_token_before;
use spans::token_end;
use spans::{is_word_at, word_at, word_end, word_start};
use spans::{skip_trivia_back, trim_trivia_end};
use std::hash::{Hash, Hasher};
use std::hint::cold_path;
use symbols::AliasTarget;
use task::{Open, OrderDependent, Stored, Task};

pub use call::ResolvedCall;
pub use shape::Members;
pub use spans::compute_ecma_line_starts;

const RECENT_SIGS: usize = 256;
const RECENT_TYPE_PARAMS: usize = 64;

/// A non-cacheable query result. It's valid while `frames[depth]` has the serial number `serial`.
#[derive(Copy, Clone)]
struct Provisional {
    /// The result as one word: a `TypeId`, a `Packed` value, or a pointer for `Query::Shape`.
    raw: u64,
    depth: u32,
    /// A hit taints the frames from this index up. `u32::MAX` means none, see `cache_provisionally`.
    from: u32,
    /// `stack.len()` when the query was pushed.
    height: u32,
    /// Bit set of what happened while it was computed:
    /// - 1: `cycles` was incremented
    /// - 2: `limits` was incremented
    /// - 4: an incomplete flow-loop type was read
    /// - 8: a query was rejected for lack of native stack or query depth
    /// - 16: the cycle passes a barrier (`is_behind_barrier`)
    /// - 32: a request for members got the members in place, which bit 1 doesn't cover
    /// - 64: `anySignature` was read
    event_bits: u8,
    serial: u64,
}

/// Calls `$each!` with the names of the `Buffered` fields of `Program`. A table whose entries
/// contain handles into another table comes after that table, so `shapes` is before `members`. This
/// is the only list, so a new `Buffered` field must be added here.
macro_rules! buffered_fields {
    ($each:ident) => {
        $each!(
            type_node_types fn_return_types pat_types literal_prop_types symbol_types
            circular_base_types circular_alias_targets circular_mapped_constraints circular_write_types
            base_constructor_types symbol_reference_links mapped_types_with_errors declared_types shapes
            distributed_intersections sig_params
            sig_type_params resolved_return_types call_signatures construct_signatures candidate_orders members
            resolved_type_arguments instantiations key_properties composed outer_type_params declared_type_params
            identity_mappers identity_mappers_with_adopted base_types context_checked relations variances
            awaited_types mapped_prop_types reverse_mapped_cache optional_properties intersected_props
            union_properties union_objects intersection_objects keys_of_properties never_intersections mapped_targets inferred_constraints constraints plain_global_refs
            equivalent_base_types type_param_constraints enum_values type_param_defaults
            circular_type_param_defaults conditionals
            mapped_param_constraints
            expr_types flows_too_deep calls call_return_types call_diagnostics diagnostics_of_re_resolved_calls
            effects_signatures resolved_effects_signatures context_free_expr_types context_free_types
            type_predicates_from_body initializer_is_undefined circular_initializers circular_returns deferred_nodes
            resolved_parameter_symbols
            calls_before_signatures untyped_signatures_in_js jsx_fragment_types
            blocks_too_large_for_flow_analysis
        )
    };
}
pub(crate) use buffered_fields;

/// The policy type of the `Buffered` field `$field`. It identifies the slot where a task keeps its
/// local part of the table.
macro_rules! buffered {
    ($field:ident) => {
        Buffered<At<{ task::slot_of(stringify!($field)) }>>
    };
    ($field:ident, of expressions) => {
        Buffered<OfExpressions<{ task::slot_of(stringify!($field)) }>>
    };
}

/// Like `buffered_fields`, for the `FileLocal` fields. Only a pure cache may be `FileLocal`, that is, a
/// function of published entries. Anything tsgo stores on a node, symbol or signature is `Buffered`, so
/// that a task sees an outer evaluation's result together with what was evaluated inside it.
macro_rules! file_local_fields {
    ($each:ident) => {
        $each!(flow_node_reachable jsx_attributes_types)
    };
}
pub(crate) use file_local_fields;

/// The signature passed to `assignContextualParameterTypes`, if it was called, and a flag that's
/// true if `instantiateSignature` created it for the call.
pub(crate) type AssignedSignature = (Option<SigId>, bool);

pub struct Program<'s> {
    /// Owns the arenas for the program and everything computed from it.
    pub session: &'s Session,
    /// `Task::order_dependent_variances` of the valid commits so far: the first value for each
    /// symbol. Written at a commit and by `share_variances`, read on a cache miss in `variances_worker`. Any thread
    /// can add to this map, so it's on the regular heap. See `release`.
    serial_variances: Guarded<FxHashMap<Sym, &'s [u8]>>,
    /// See `commit`.
    commits: commit::Commits<'s>,
    /// The union of all tasks' `Checker::referenced_properties`. The task that checks a declaration's
    /// file doesn't see what other tasks have marked, so `finish_file` retracts what that task reported.
    /// Being a union, it doesn't depend on task order. Tasks write to this set directly.
    properties_referenced_before: Guarded<crate::util::FxHashSet<Sym>>,
    /// `autoArrayType`
    auto_array_type: TypeId,
    /// See `Services::file_info`. Built on first use.
    package_names_of_linked_files: std::sync::OnceLock<FxHashMap<FileId, Vec<u8>>>,
    pub files: &'s Files<'s>,
    pub types: TypeStore<'s>,

    /// `links.resolvedType` of an expression (`checkExpressionCached`). Also serves as a memo where
    /// tsgo rechecks an expression.
    expr_types:
        ByNode<(FileId, ExprId), TypeId, buffered!(expr_types, of expressions), &'s Session>,
    type_node_types: ByNode<(FileId, TypeNodeId), TypeId, buffered!(type_node_types), &'s Session>,
    /// The flag, here and in `pat_types`, `declared_types` and `constraints`, is true if the type
    /// is the result of a resolution cycle (`!popTypeResolution()`).
    fn_return_types:
        ByNode<(FileId, FnId), (TypeId, bool), buffered!(fn_return_types), &'s Session>,
    pat_types: ByNode<(FileId, PatId), (TypeId, bool), buffered!(pat_types), &'s Session>,
    literal_prop_types:
        ByNode<(FileId, PropId), TypeId, buffered!(literal_prop_types), &'s Session>,
    symbol_types: ByNode<Sym, TypeId, buffered!(symbol_types), &'s Session>,
    /// The parameters for which `parameterInitializerContainsUndefined` closed a cycle. Their entry
    /// in `pat_types` is older than the cycle.
    circular_initializers:
        ByNode<(FileId, PatId), (), buffered!(circular_initializers), &'s Session>,
    /// The classes and interfaces whose base types were requested while they were being resolved
    /// (2310).
    circular_base_types: ByNode<Sym, (), buffered!(circular_base_types), &'s Session>,
    /// The aliases whose `aliasTarget` is `unknownSymbol` because `resolveAlias` found a cycle
    /// through a type (2303).
    circular_alias_targets: ByNode<Sym, (), buffered!(circular_alias_targets), &'s Session>,
    /// The mapped types whose key has a circular constraint (2313), keyed by node and mapper. Their
    /// `constraintType` is `errorType`.
    circular_mapped_constraints: ByKey<
        (FileId, TypeNodeId, MapperId),
        (),
        buffered!(circular_mapped_constraints),
        &'s Session,
    >,
    /// The annotations of the setters whose `writeType` is `anyType` because
    /// `getWriteTypeOfAccessors` found a cycle (2502).
    circular_write_types:
        ByKey<(FileId, TypeNodeId), (), buffered!(circular_write_types), &'s Session>,
    /// The functions for which 7023 was reported and whose entry in `fn_return_types` isn't the result of the cycle.
    /// Either the entry is in flight and keeps its inferred type, or the cycle belongs to a composite signature.
    circular_returns: ByNode<(FileId, FnId), (), buffered!(circular_returns), &'s Session>,
    /// The calls that found no signature among members that were in place, or while index
    /// signatures were being computed. The callee may be the static side of a class whose members
    /// were in place and whose signatures were not (`resolveAnonymousTypeMembers`).
    calls_before_signatures:
        ByNode<(FileId, ExprId), (), buffered!(calls_before_signatures), &'s Session>,
    /// References whose control flow walk reached depth 2000 (2563). `getTypeAtFlowNode`
    flows_too_deep: ByNode<(FileId, ExprId), (), buffered!(flows_too_deep), &'s Session>,
    /// The same for references that aren't expressions: a binding pattern, a function, the name of
    /// a parameter, a synthesized access. `FindAncestor(reference, IsFunctionOrModuleBlock)`.
    blocks_too_large_for_flow_analysis:
        ByKey<(FileId, Node), (), buffered!(blocks_too_large_for_flow_analysis), &'s Session>,
    /// `getEffectsSignature`, by call.
    effects_signatures: ByNode<
        (FileId, ExprId),
        Option<SigId>,
        buffered!(effects_signatures, of expressions),
        &'s Session,
    >,
    /// `links.effectsSignature` of the calls that `getEffectsSignature` has to resolve because
    /// they're generic or overloaded.
    resolved_effects_signatures: ByNode<
        (FileId, ExprId),
        Option<SigId>,
        buffered!(resolved_effects_signatures, of expressions),
        &'s Session,
    >,
    /// `links.contextFreeType` of an expression (`getContextFreeTypeOfExpression`).
    /// `context_free_types` is that of a function.
    context_free_expr_types: ByNode<
        (FileId, ExprId),
        TypeId,
        buffered!(context_free_expr_types, of expressions),
        &'s Session,
    >,
    /// `flowNodeReachable`
    flow_node_reachable: ByNode<(FileId, crate::bind::FlowId), bool, FileLocal, &'s Session>,
    /// `sig.resolvedTypePredicate` for a function without a return type annotation.
    type_predicates_from_body: ByNodeIndirect<
        (FileId, FnId),
        Option<decl::Predicate>,
        buffered!(type_predicates_from_body),
        &'s Session,
    >,
    /// `resolvedBaseConstructorType` of each class.
    base_constructor_types: ByNode<Sym, TypeId, buffered!(base_constructor_types), &'s Session>,
    /// `symbolReferenceLinks`: the symbols `Resolve` found when called with `isUse`, where the
    /// caller records that. `check_unused` computes the rest.
    symbol_reference_links: ByNode<Sym, (), buffered!(symbol_reference_links), &'s Session>,
    /// `GetGlobalDiagnostics`: errors that don't belong to a file, like
    /// `Cannot find global type 'Array'.` Each entry is the code and the message arguments.
    global_errors: bun_threading::Guarded<std::collections::BTreeSet<(u32, Vec<Vec<u8>>)>>,
    sink: sink::Sink<'s>,
    /// `MappedType.containsError`
    mapped_types_with_errors: ById<TypeId, (), buffered!(mapped_types_with_errors), &'s Session>,
    /// `NodeCheckFlagsInitializerIsUndefinedComputed` and `NodeCheckFlagsInitializerIsUndefined`
    initializer_is_undefined:
        ByNode<(FileId, ParamId), bool, buffered!(initializer_is_undefined), &'s Session>,
    /// `links.resolvedType != nil` for the symbol of a parameter that `is_resolved_on_request`. The
    /// type is in `pat_types` either way.
    resolved_parameter_symbols:
        ByNode<(FileId, ParamId), (), buffered!(resolved_parameter_symbols), &'s Session>,
    /// See `is_untyped_signature_in_js_file`.
    untyped_signatures_in_js:
        ByNode<(FileId, FnId), bool, buffered!(untyped_signatures_in_js), &'s Session>,
    /// For a type alias, the flag is true if `typeAliasLinks.typeParameters` is nil because no
    /// evaluation has ended with a successful `popTypeResolution`.
    declared_types: ByNode<Sym, (TypeId, bool), buffered!(declared_types), &'s Session>,
    shapes: ByIdIndirect<TypeId, shape::Resolved<'s>, buffered!(shapes), &'s Session>,
    /// `intersectionTypes`, for sets that contain a union.
    distributed_intersections:
        ByKey<unions::IntersectionKey, TypeId, buffered!(distributed_intersections), &'s Session>,
    sig_params: ByIdIndirect<SigId, ArenaBox<'s, [SigParam]>, buffered!(sig_params), &'s Session>,
    sig_type_params:
        ByIdIndirect<SigId, ArenaBox<'s, [TypeId]>, buffered!(sig_type_params), &'s Session>,
    /// `Signature.resolvedReturnType` of a signature with a `target`.
    resolved_return_types: ById<SigId, TypeId, buffered!(resolved_return_types), &'s Session>,
    call_signatures:
        ByIdIndirect<TypeId, ArenaBox<'s, [SigId]>, buffered!(call_signatures), &'s Session>,
    construct_signatures:
        ByIdIndirect<TypeId, ArenaBox<'s, [SigId]>, buffered!(construct_signatures), &'s Session>,
    /// Keyed by the first of several signatures. The value is the list they're in, followed by the
    /// same list in the order that `candidates_in_order` produces.
    candidate_orders:
        ByIdIndirect<SigId, ArenaBox<'s, [SigId]>, buffered!(candidate_orders), &'s Session>,
    /// The result of `members` for a type, once it is final.
    members: ByIdIndirect<TypeId, shape::CachedMembers, buffered!(members), &'s Session>,
    /// `TypeReference.resolvedTypeArguments` of a deferred type reference.
    resolved_type_arguments: ByIdIndirect<
        TypeId,
        ArenaBox<'s, [TypeId]>,
        buffered!(resolved_type_arguments),
        &'s Session,
    >,
    instantiations: ByKey<(TypeId, MapperId), TypeId, buffered!(instantiations), &'s Session>,
    /// `UnionType.keyPropertyName`, `constituentMap`
    key_properties: ByIdIndirect<
        TypeId,
        Option<(Atom, FxHashMap<TypeId, TypeId>)>,
        buffered!(key_properties),
        &'s Session,
    >,
    /// `compose`
    composed: ByKey<(MapperId, MapperId), MapperId, buffered!(composed), &'s Session>,
    outer_type_params: ByNodeIndirect<
        (FileId, crate::bind::ScopeId),
        ArenaBox<'s, [TypeId]>,
        buffered!(outer_type_params),
        &'s Session,
    >,
    /// `type_param`
    declared_type_params:
        ByNode<(FileId, TypeParamId), TypeId, buffered!(declared_type_params), &'s Session>,
    /// `identity_mapper`
    identity_mappers:
        ByNode<(FileId, crate::bind::ScopeId), MapperId, buffered!(identity_mappers), &'s Session>,
    identity_mappers_with_adopted: ByNode<
        (FileId, crate::bind::ScopeId),
        MapperId,
        buffered!(identity_mappers_with_adopted),
        &'s Session,
    >,
    base_types: ByNodeIndirect<Sym, ArenaBox<'s, [TypeId]>, buffered!(base_types), &'s Session>,
    /// `links.resolvedSignature`. `Checker::cached_resolved_signature` reads it together with
    /// `call_return_types`, and `cache_call` writes both.
    calls: ByNode<(FileId, ExprId), Option<SigId>, buffered!(calls, of expressions), &'s Session>,
    /// `ResolvedCall::ret` of the entry in `calls`. It's a separate table because a cell has 32 bits.
    call_return_types:
        ByNode<(FileId, ExprId), TypeId, buffered!(call_return_types, of expressions), &'s Session>,
    /// `links.deferredNodes` for a file that the task wasn't checking at the time. See `check_node_deferred`.
    deferred_nodes: ByNode<(FileId, ExprId), (), buffered!(deferred_nodes), &'s Session>,
    /// `links.jsxFragmentType` of a source file.
    jsx_fragment_types: ByKey<FileId, TypeId, buffered!(jsx_fragment_types), &'s Session>,
    /// `getEffectiveFirstArgumentForJsxSignature` of the signature a JSX element is resolved to,
    /// keyed by the element.
    jsx_attributes_types: ByNode<(FileId, JsxId), TypeId, FileLocal, &'s Session>,
    /// The diagnostics `resolveCall` reported for a call at its final resolution, with their
    /// related information.
    call_diagnostics:
        ByNodeIndirect<(FileId, ExprId), Vec<Reported>, buffered!(call_diagnostics), &'s Session>,
    /// `NodeCheckFlagsContextChecked`, with the signature passed to
    /// `assignContextualParameterTypes`. `None` means it wasn't called.
    context_checked:
        ByNode<(FileId, FnId), AssignedSignature, buffered!(context_checked), &'s Session>,
    /// `contextFreeTypes` for a function.
    context_free_types: ByNode<(FileId, FnId), TypeId, buffered!(context_free_types), &'s Session>,
    /// The diagnostics `resolveCall` reported for a call the first time it was resolved again while
    /// its resolution was in progress, with their related information.
    diagnostics_of_re_resolved_calls: ByNodeIndirect<
        (FileId, ExprId),
        Vec<Reported>,
        buffered!(diagnostics_of_re_resolved_calls),
        &'s Session,
    >,
    relations: ByKey<relate::Key, u8, buffered!(relations), &'s Session>,
    variances: ByNodeIndirect<Sym, &'s [u8], buffered!(variances), &'s Session>,
    /// `CachedTypeKindAwaitedType`. `None` means `awaited_no_alias` with an empty `awaitedTypeStack` has no result.
    awaited_types: ById<TypeId, Option<TypeId>, buffered!(awaited_types), &'s Session>,
    /// `getTypeOfMappedSymbol`: `resolvedType` of a property of a mapped type, keyed by the mapped
    /// type and the property name.
    mapped_prop_types: ByKey<(TypeId, Atom), TypeId, buffered!(mapped_prop_types), &'s Session>,
    /// `reverseMappedCache`
    reverse_mapped_cache: ByKey<
        (TypeId, TypeId, TypeId),
        Option<TypeId>,
        buffered!(reverse_mapped_cache),
        &'s Session,
    >,
    /// See `cached_optional_property`.
    optional_properties: ById<TypeId, TypeId, buffered!(optional_properties), &'s Session>,
    intersected_props: ByKey<(TypeId, Atom), TypeId, buffered!(intersected_props), &'s Session>,
    /// `UnionOrIntersectionType.propertyCache`. The property is wrapped in a synthetic type.
    union_properties:
        ByKey<(TypeId, Atom), Option<TypeId>, buffered!(union_properties), &'s Session>,
    /// `UnionOrIntersectionType.resolvedProperties` of a union: `union_as_object`.
    union_objects: ById<TypeId, TypeId, buffered!(union_objects), &'s Session>,
    /// An object type with the signatures and the index signatures of an intersection:
    /// `structured_members`.
    intersection_objects: ById<TypeId, TypeId, buffered!(intersection_objects), &'s Session>,
    /// `get_literal_type_from_properties` without index flags. Instantiations under several
    /// mappers arrive at one object type.
    keys_of_properties: ById<TypeId, TypeId, buffered!(keys_of_properties), &'s Session>,
    never_intersections: ById<TypeId, bool, buffered!(never_intersections), &'s Session>,
    /// `getMappedTargetWithSymbol` of a mapped type.
    mapped_targets: ById<TypeId, TypeId, buffered!(mapped_targets), &'s Session>,
    inferred_constraints:
        ById<TypeId, Option<TypeId>, buffered!(inferred_constraints), &'s Session>,
    /// `ConstrainedType.resolvedBaseConstraint`. `None` is `noConstraintType`, and the flag means
    /// `circularConstraintType`.
    constraints: ById<TypeId, (Option<TypeId>, bool), buffered!(constraints), &'s Session>,
    /// `global_ref` of a name, without type arguments.
    plain_global_refs: ById<Atom, TypeId, buffered!(plain_global_refs), &'s Session>,
    /// `CachedTypeKindEquivalentBaseType`
    equivalent_base_types:
        ById<TypeId, Option<TypeId>, buffered!(equivalent_base_types), &'s Session>,
    /// `constraint_of_type_param` of a type parameter, once it is final.
    type_param_constraints:
        ById<TypeId, Option<TypeId>, buffered!(type_param_constraints), &'s Session>,
    enum_values: ByNodeIndirect<
        (FileId, EnumMemberId),
        decl::Evaluated,
        buffered!(enum_values),
        &'s Session,
    >,
    /// `default_of_type_param` of a type parameter, once it is final.
    type_param_defaults: ById<TypeId, Option<TypeId>, buffered!(type_param_defaults), &'s Session>,
    /// The type parameters whose `resolvedDefaultType` is `circularConstraintType`.
    circular_type_param_defaults:
        ById<TypeId, (), buffered!(circular_type_param_defaults), &'s Session>,
    /// `ConditionalRoot.instantiations`, for the keys without an alias. The flag is true if `non_cacheable_mark`
    /// didn't change while the type was computed, so `getConditionalType` would return the same type again.
    conditionals:
        ByKey<(FileId, TypeNodeId, MapperId), (TypeId, bool), buffered!(conditionals), &'s Session>,
    /// Each mapped type's parameter constraint, if any. See `constraint_of_mapped_param`.
    mapped_param_constraints: ByNode<
        (FileId, TypeNodeId),
        Option<TypeId>,
        buffered!(mapped_param_constraints),
        &'s Session,
    >,
}

/// Contains no ids. The arguments are printed when it's created, and `take_reported_from` never
/// hands a table a callback (`Reported::deferred`).
impl crate::types::Follow for Reported {
    fn visit<V: crate::types::Visitor>(&self, visitor: &mut V) {
        visitor.plain(&(self.file.0, self.start, self.end, self.code));
    }
}

impl crate::types::Follow for decl::Predicate {
    fn visit<V: crate::types::Visitor>(&self, visitor: &mut V) {
        let decl::Predicate {
            param,
            name,
            ty,
            asserts,
        } = self;
        visitor.plain(&(param, asserts));
        name.visit(visitor);
        ty.visit(visitor);
    }
}

/// A finished checker's task and largest caches, all empty. The next checker on the thread reuses their memory. It's
/// about 20 KB, so it's boxed to keep stack frames small.
pub struct Spare<'s> {
    task: Task<'s>,
    task_facts: shortcuts::TaskFacts,
    simplified: [shortcuts::TypeMap<TypeId>; 2],
    reduced_unions: shortcuts::TypeMap<TypeId>,
    links: links::TypeLinks,
    signature_links: signature_links::SignatureLinks,
    widened_types: shortcuts::TypeMap<TypeId>,
    apparent_types_of_intersections: shortcuts::TypeMap<TypeId>,
}

/// `Checker::rechecked_exprs` and `Checker::rechecked_members`.
type Rechecked = (
    FxHashMap<(FileId, ExprId), TypeId>,
    FxHashMap<(FileId, PropId), TypeId>,
);

impl<'s> Program<'s> {
    pub fn new(session: &'s Session, files: &'s Files<'s>) -> Program<'s> {
        // Nothing that mentions a leaf file's node is published, so the shared part has no capacity
        // for those nodes, and `Bases::at` returns `None` for them. The counts are read in one pass
        // because the modules are far apart in memory.
        let counts = files.modules.iter().map(|m| {
            let counts = [
                m.hir.exprs.len(),
                m.hir.types.len(),
                m.hir.fns.len(),
                m.hir.pats.len(),
                m.hir.props.len(),
                m.hir.params.len(),
                m.hir.enum_members.len(),
                m.bound.scopes.len(),
                m.hir.type_params.len(),
                m.bound.symbols.len(),
            ];
            (m.is_leaf, counts)
        });
        let counts: Vec<(bool, [usize; 10])> = counts.collect();
        let bases = |kind: usize| {
            let shared = counts.iter().map(|it| if it.0 { 0 } else { it.1[kind] });
            Bases::new_in(shared, &session)
                .with_counts(counts.iter().map(|it| it.1[kind]), &session)
        };
        let [
            exprs,
            type_nodes,
            fns,
            pats,
            props,
            params,
            enum_members,
            scopes,
            type_params,
            symbols,
        ] = std::array::from_fn(bases);
        let mut types = TypeStore::new_in(session, files.atoms);
        let arena = session.arena();
        let auto_array_type =
            types.publish_constant(match files.global_type_of_arity(known::Array, 1) {
                Some(target) => TypeData::Ref {
                    target,
                    args: TypeArguments::given_in(&[TypeId::AUTO], arena),
                },
                // It's only a marker, so without a global `Array` it still has to be a distinct type.
                None => TypeData::Synth(ArenaBox::new_in(
                    Shape {
                        literal: Literalness::AutoArray,
                        ..Shape::new_in(arena)
                    },
                    arena,
                )),
            });
        types.share_records();
        let mut program = Program {
            session,
            serial_variances: Guarded::default(),
            commits: commit::Commits::new_in(session.arena())
                .for_files(files.ranks(), session.arena()),
            properties_referenced_before: Default::default(),
            auto_array_type,
            package_names_of_linked_files: Default::default(),
            types,
            expr_types: ByNode::new_in(&exprs, session),
            type_node_types: ByNode::new_in(&type_nodes, session),
            fn_return_types: ByNode::new_in(&fns, session),
            pat_types: ByNode::new_in(&pats, session),
            literal_prop_types: ByNode::new_in(&props, session),
            symbol_types: ByNode::new_in(&symbols, session),
            circular_initializers: ByNode::new_in(&pats, session),
            circular_base_types: ByNode::new_in(&symbols, session),
            circular_alias_targets: ByNode::new_in(&symbols, session),
            circular_mapped_constraints: ByKey::new_in(session),
            circular_write_types: ByKey::new_in(session),
            circular_returns: ByNode::new_in(&fns, session),
            calls_before_signatures: ByNode::new_in(&exprs, session),
            flows_too_deep: ByNode::new_in(&exprs, session),
            effects_signatures: ByNode::new_in(&exprs, session),
            resolved_effects_signatures: ByNode::new_in(&exprs, session),
            context_free_expr_types: ByNode::new_in(&exprs, session),
            // A `FileLocal` table has no shared array, so it ignores the bases.
            flow_node_reachable: ByNode::new_in(&exprs, session),
            type_predicates_from_body: ByNodeIndirect::new_in(&fns, session),
            base_constructor_types: ByNode::new_in(&symbols, session),
            sink: sink::Sink::new_in(files.modules.len(), session.arena()),
            symbol_reference_links: ByNode::new_in(&symbols, session),
            global_errors: Default::default(),
            mapped_types_with_errors: ById::new_in(session),
            initializer_is_undefined: ByNode::new_in(&params, session),
            resolved_parameter_symbols: ByNode::new_in(&params, session),
            untyped_signatures_in_js: ByNode::new_in(&fns, session),
            declared_types: ByNode::new_in(&symbols, session),
            shapes: ByIdIndirect::new_in(session),
            distributed_intersections: ByKey::new_in(session),
            sig_params: ByIdIndirect::new_in(session),
            sig_type_params: ByIdIndirect::new_in(session),
            resolved_return_types: ById::new_in(session),
            call_signatures: ByIdIndirect::new_in(session),
            construct_signatures: ByIdIndirect::new_in(session),
            candidate_orders: ByIdIndirect::new_in(session),
            members: ByIdIndirect::new_in(session),
            resolved_type_arguments: ByIdIndirect::new_in(session),
            instantiations: ByKey::new_in(session),
            key_properties: ByIdIndirect::new_in(session),
            composed: ByKey::new_in(session),
            outer_type_params: ByNodeIndirect::new_in(&scopes, session),
            declared_type_params: ByNode::new_in(&type_params, session),
            identity_mappers: ByNode::new_in(&scopes, session),
            identity_mappers_with_adopted: ByNode::new_in(&scopes, session),
            base_types: ByNodeIndirect::new_in(&symbols, session),
            calls: ByNode::new_in(&exprs, session),
            call_return_types: ByNode::new_in(&exprs, session),
            deferred_nodes: ByNode::new_in(&exprs, session),
            jsx_fragment_types: ByKey::new_in(session),
            blocks_too_large_for_flow_analysis: ByKey::new_in(session),
            jsx_attributes_types: ByNode::new_in(&exprs, session),
            call_diagnostics: ByNodeIndirect::new_in(&exprs, session),
            context_checked: ByNode::new_in(&fns, session),
            context_free_types: ByNode::new_in(&fns, session),
            diagnostics_of_re_resolved_calls: ByNodeIndirect::new_in(&exprs, session),
            relations: ByKey::new_in(session),
            variances: ByNodeIndirect::new_in(&symbols, session),
            awaited_types: ById::new_in(session),
            mapped_prop_types: ByKey::new_in(session),
            reverse_mapped_cache: ByKey::new_in(session),
            optional_properties: ById::new_in(session),
            intersected_props: ByKey::new_in(session),
            union_properties: ByKey::new_in(session),
            never_intersections: ById::new_in(session),
            mapped_targets: ById::new_in(session),
            union_objects: ById::new_in(session),
            intersection_objects: ById::new_in(session),
            keys_of_properties: ById::new_in(session),
            inferred_constraints: ById::new_in(session),
            constraints: ById::new_in(session),
            plain_global_refs: ById::new_in(session),
            equivalent_base_types: ById::new_in(session),
            type_param_constraints: ById::new_in(session),
            enum_values: ByNodeIndirect::new_in(&enum_members, session),
            type_param_defaults: ById::new_in(session),
            circular_type_param_defaults: ById::new_in(session),
            conditionals: ByKey::new_in(session),
            mapped_param_constraints: ByNode::new_in(&type_nodes, session),
            files,
        };
        task::number_tables(&mut program);
        program
    }

    /// Frees what the program owns on the regular heap: the diagnostics, and the keys or values of
    /// two tables with few entries. Everything else is in the session's arenas and is freed with
    /// them, so a program that's itself allocated in an arena doesn't need `Drop`.
    pub fn release(&mut self) {
        let session = self.session;
        let no_nodes = Bases::none_in(&session);
        self.sink.release();
        self.types.release();
        self.commits.release();
        *self.serial_variances.get_mut() = FxHashMap::default();
        *self.global_errors.get_mut() = Default::default();
        self.call_diagnostics = ByNodeIndirect::new_in(&no_nodes, session);
        self.diagnostics_of_re_resolved_calls = ByNodeIndirect::new_in(&no_nodes, session);
        self.key_properties = ByIdIndirect::new_in(session);
        self.distributed_intersections = ByKey::new_in(session);
    }

    /// `GetGlobalDiagnostics`. Returns the errors that don't belong to a file, sorted and
    /// deduplicated. Call it after all files have been checked.
    pub fn global_errors(&self) -> Vec<(u32, Vec<Vec<u8>>)> {
        if self.files.modules.is_empty() {
            return Vec::new();
        }
        let mut required = self.required_global_types();
        if required.any(|(name, arity)| self.files.get_global_type(name, arity).is_err()) {
            self.checker().check_required_global_types(None);
        }
        self.global_errors.lock().iter().cloned().collect()
    }

    /// The global types that `initializeChecker` requests from `getGlobalType` with `reportErrors`,
    /// whether or not anything uses them, each with its type parameter count.
    fn required_global_types(&self) -> impl Iterator<Item = (Atom, usize)> {
        // `getGlobalStrictFunctionType`
        let strict: &[(Atom, usize)] = if self.files.options.strict_bind_call_apply {
            &[(known::CallableFunction, 0), (known::NewableFunction, 0)]
        } else {
            &[]
        };
        let first = [
            (known::IArguments, 0),
            (known::Array, 1),
            (known::Object, 0),
            (known::Function, 0),
        ];
        let last = [
            (known::String, 0),
            (known::Number, 0),
            (known::Boolean, 0),
            (known::RegExp, 0),
        ];
        first.into_iter().chain(strict.iter().copied()).chain(last)
    }

    pub fn checker(&self) -> Checker<'_, 's> {
        self.checker_reusing(None)
    }

    /// Returns a new task and empty caches, for a thread's first checker.
    fn empty_spare(&self) -> Box<Spare<'s>> {
        Box::new(Spare {
            task: Task::new_in(self.session.arena(), &self.types),
            task_facts: Default::default(),
            simplified: Default::default(),
            reduced_unions: Default::default(),
            links: Default::default(),
            signature_links: Default::default(),
            widened_types: Default::default(),
            apparent_types_of_intersections: Default::default(),
        })
    }

    /// Returns a new checker. `spare` is what `Checker::into_spare` returned on this thread, and
    /// the new checker reuses its memory.
    pub fn checker_reusing<'p>(&'p self, spare: Option<Box<Spare<'s>>>) -> Checker<'p, 's> {
        let arena = self.session.arena();
        let spare = spare.unwrap_or_else(|| self.empty_spare());

        Checker {
            p: self,
            arena,
            task: spare.task,
            left_frame: None,
            files: self.files,
            variance_type_parameter: Atom::NONE,
            auto_array_type: self.auto_array_type,
            stack: Vec::new(),
            in_progress: [0; 1024],
            frames: Vec::new(),
            last_enter: EnterOutcome::Entered,
            resolution_start: 0,
            eager: Vec::new(),
            loop_values: Vec::new(),
            unmarked_rejections: 0,
            non_circular_returns: Vec::new(),
            array_or_tuple_constraint_requests: Vec::new(),
            mapped_instantiations_in_progress: Vec::new(),
            contextual_binding_patterns: Vec::new(),
            requested_assignment_target: None,
            looked_at_type_node: None,
            late_bound_members: Default::default(),
            late_bound_declarations: Default::default(),
            this_types: Default::default(),
            this_types_in_progress: Vec::new(),
            thisless_members: Default::default(),
            instantiated_symbol_links: Default::default(),
            late_binding: Vec::new(),
            late_binding_by_symbol: Vec::new(),
            permanently_early_bound: Default::default(),
            declared_members_in_progress: Vec::new(),
            reporting_nonexistent: Vec::new(),
            declared_index_infos_in_progress: Vec::new(),
            anonymous_members_in_place: Vec::new(),
            index_infos_in_instantiation: Vec::new(),
            enum_values_in_progress: Vec::new(),
            inheriting: Vec::new(),
            base_types_so_far: Vec::new(),
            members_resolved_before_base_types: Vec::new(),
            resolving_at_base_types: Vec::new(),
            mapped_constraints_in_progress: Vec::new(),
            mapped_props_reentered_through_members: Vec::new(),
            serialization_level: 0,
            flow_type_cache: Default::default(),
            flow_type_cache_depth: usize::MAX,
            flow_invocation_count: 0,
            discarded: None,
            non_existent_properties: Default::default(),
            signatures_resolved_with_errors_discarded: Vec::new(),
            expressions_cached_with_errors_discarded: Vec::new(),
            starts_of_discarded_errors: Vec::new(),
            printing_closes_cycles: false,
            reprinting: false,
            printing_floors: Vec::new(),
            serialized_types: Default::default(),
            context_free_level: usize::MAX,
            calls_to_resolve_afresh: None,
            calls_resolved_afresh: Vec::new(),
            found_cycle: false,
            left_a_cycle: false,
            stale_resolutions: Vec::new(),
            unpopped_resolutions: Default::default(),
            popped_for_symbol: None,
            circular_before_parameter_symbol: Default::default(),
            parameter_symbol_taken_as_unresolved: None,
            taints: 0,
            incomplete_flow_taints: 0,
            checked_type_references: (None, Vec::new()),
            taints_before_patterns: 0,
            cycles: 0,
            lowest_taint: usize::MAX,
            context_checked_under: Vec::new(),
            initializers_resolved_by_nested_visit: Vec::new(),
            resolved_parameter_types: Default::default(),
            partial_sig_params: Default::default(),
            declared_parameters: Default::default(),
            listed_in_unions: Default::default(),
            quick_initializers: Vec::new(),
            contextual: Vec::new(),
            pulls_contextual_types_at: usize::MAX,
            rechecks_at: usize::MAX,
            mode_of_recheck: CheckMode::empty(),
            type_only_node: None,
            rechecked_exprs: Default::default(),
            rechecked_members: Default::default(),
            spare_rechecked: Vec::new(),
            inference_contexts: Vec::new(),
            instantiation_depth: 0,
            outermost_comparison: None,
            instantiation_count: 0,
            instantiations_computed: 0,
            recent_instantiations: Default::default(),
            recent_composed: Default::default(),
            recent_with_this: Default::default(),
            recent_const_type_variables: Default::default(),
            recent_derived_sigs: Default::default(),
            known_mapped_prop_types: Default::default(),
            unresolved_members: Vec::new(),
            unresolved_members_hits: 0,
            members_in_place_hits: 0,
            members_in_place_hit_at: 0,
            lowest_unresolved_members_hit: u32::MAX,
            active_mappers: Default::default(),
            limits: 0,
            instantiation_limit_hits: 0,
            limits_in_earlier_files: 0,
            comparisons_of_deeply_nested_types: 0,
            relations_of_this_task: Default::default(),
            stores_relations_per_task: false,
            constraints_of_this_task: Default::default(),
            constraint_cuts: Default::default(),
            instantiations_in_progress: Vec::new(),
            keys_of_properties_in_progress: Vec::new(),
            instantiations_up_to_a_limit: Default::default(),
            relations_cut_short: Default::default(),
            enum_relation: Default::default(),
            enum_literal_types: Default::default(),
            task_facts: spare.task_facts,
            relation_sizes: [0; 6],
            variances_cut_short: Default::default(),
            free_relaters: Vec::new(),
            spare_inferences: Vec::new(),
            reliability: 0,
            in_variance_computation: false,
            is_marker_comparison: false,
            is_trial_comparison: false,
            variances_in_progress: Vec::new(),
            variances_marked_empty: Vec::new(),
            suspended_variances: Vec::new(),
            in_progress_variance_reads: 0,
            variances_measured: Vec::new(),
            failed_type_argument: 0,
            order_dependent: Default::default(),
            order_dependent_uses: 0,
            simplified: spare.simplified,
            inherited_names: [0; 4],
            inherited_name_set: None,
            cond_distributive_memo: Default::default(),
            relation_too_complex: false,
            current_source_element: None,
            is_type_checked: false,
            is_emitting: false,
            cached_by_emit: Vec::new(),
            reported: Vec::new(),
            is_checking_in_flow_loop: false,
            never_checked: Default::default(),
            never_in_progress: Vec::new(),
            reduced_unions: spare.reduced_unions,
            union_members: Default::default(),
            unlisted_intersections: Default::default(),
            sibling_intersections: None,
            mapped_types_in_progress: Default::default(),
            never_in_progress_from: Vec::new(),
            reverse_mapped_inferences_from: Vec::new(),
            defaults_in_progress: Vec::new(),
            identical_base_types_in_progress: Vec::new(),
            names_of_small_numbers: Default::default(),
            interface_declarations: Default::default(),
            counted_export_declarations: Default::default(),
            has_class_or_function_declaration: Default::default(),
            generic_mapped_types_in_progress: Vec::new(),
            generic_mapped_types_cut_short: Vec::new(),
            recent_members: Box::new([shape::RecentMembers::NONE; shape::RECENT_MEMBERS]),
            recent_unions: Default::default(),
            recent_unreduced_unions: Default::default(),
            unions_of_union_types: Default::default(),
            union_calls: Default::default(),
            constraint_stack: Vec::new(),
            constraints_marked_circular: Vec::new(),
            circular_constraint_origins: Vec::new(),
            type_arguments_in_instantiation: Vec::new(),
            conditional_constraint_depth: 0,
            deepest_stack: std::cell::Cell::new(0),
            ran_out_of_stack: std::cell::Cell::new(false),
            scopes_inside_exprs: Default::default(),
            spread_indices_of_many: Default::default(),
            times_cut_short: std::cell::Cell::new(0),
            exprs_by_kind: None,
            provisional_shapes: Default::default(),
            provisional: Default::default(),
            taint_events: Vec::new(),
            cycle_at: 0,
            limit_at: 0,
            rejected_at: 0,
            enclosing_module_specifier_mode: None,
            emit_resolver_links: Default::default(),
            exporting_modules: None,
            expected: Requested::All,
            declaration_file: None,
            declaration_indent: None,
            has_ambient_context: false,
            suggestions_among_globals: Default::default(),
            checked_leaves: Default::default(),
            links: spare.links,
            signature_links: spare.signature_links,
            reparsed_for_await: None,
            flow_analysis_disabled: Vec::new(),
            inline_level: 0,
            walk_declared: TypeId::NEVER,
            constants_in_evaluation: Vec::new(),
            recent_sig_params: Box::new([(SigId(u32::MAX), &[] as &[SigParam]); RECENT_SIGS]),
            recent_sig_type_params: Box::new([(SigId(u32::MAX), &[] as &[TypeId]); RECENT_SIGS]),
            recent_type_params: Box::new(std::array::from_fn(|_| {
                std::cell::Cell::new(((FileId(u32::MAX), TypeParamId(0)), TypeId::UNRESOLVED))
            })),
            recent_steps: Box::new(std::array::from_fn(|_| {
                std::cell::Cell::new(((FileId(u32::MAX), FnId(0), MapperId::IDENTITY), None))
            })),
            awaiting: Vec::new(),
            last_flow_node: (FileId(u32::MAX), crate::bind::FlowId::NONE, false),
            undefined_properties: Default::default(),
            synthetic_default_import_types: Default::default(),
            referenced_properties: Default::default(),
            tracked_names: Vec::new(),
            unused_private_members: Vec::new(),
            widening_contexts: Vec::new(),
            widened_types: spare.widened_types,
            iteration_types_cache: Default::default(),
            reported_iteration_requests: Vec::new(),
            iife_resolving: Vec::new(),
            any_signature_reads: 0,
            any_signature_read_at: 0,
            flow_loops: Vec::new(),
            reverse_mapped_source_stack: Vec::new(),
            reverse_mapped_target_stack: Vec::new(),
            reverse_expanding: 0,
            flow_memo: Default::default(),
            discriminated: Default::default(),
            conditional_roots: Default::default(),
            contextual_properties: Default::default(),
            apparent_types_of_intersections: spare.apparent_types_of_intersections,
            apparent_types_with_this_argument: Default::default(),
            deferred_nodes: Default::default(),
            deferred_type_parameters: Vec::new(),
            unresolved_identifiers: Vec::new(),
            unknown_symbols: Default::default(),
            withheld_until_the_file_ends: Vec::new(),
            files_with_errors: Default::default(),
            alias_targets_reported: Default::default(),
            alias_targets_in_progress: Vec::new(),
            is_deferred_node: Default::default(),
            deferred_diagnostics: Vec::new(),
            save_deferred_diagnostics: false,
            node_check_flags: Default::default(),
            within_unreachable_code: false,
            reported_unreachable_nodes: Vec::new(),
            renamed_binding_elements_in_types: Vec::new(),
            unvisited_exprs: Vec::new(),
            checked_with_contextual_type: Vec::new(),
            contextual_signatures_at_check: Vec::new(),
            call_resolution_errors: None,
            is_call_re_resolved: false,
            untyped_call_resolved_again: None,
            assigned_parameters: Vec::new(),
            assigned_unknown: Vec::new(),
            context_checking: Vec::new(),
            context_checked_here: Default::default(),
            in_check_identifier: Vec::new(),
            resolved_meanwhile: Vec::new(),
            signatures_resolved_within: Vec::new(),
            restrictive_instantiations: Default::default(),
            unresolved_renamed_params: Default::default(),
            pinned_restrictive_instantiations: Default::default(),
            left_a_renamed_param_unchanged: Default::default(),
            instantiating_generic_argument: None,
            prepared: Default::default(),
            last_prepared: (FileId(u32::MAX), FnId::NONE),
            prepared_exprs: (FileId(u32::MAX), Vec::new()),
            stack_base: stack_pointer(),
            stack_limit: 6 << 20,
            work: 0,
            scopes_begun: 0,
            work_trap: WORK_TRAP_DISARMED,
            rejected_expressions: Vec::new(),
            side_effect_free: Default::default(),
            context_sensitive_functions: Default::default(),
            context_sensitivity_visits: Default::default(),
            unwind_to: usize::MAX,
            unwind_work: 0,
            restart_with: None,
        }
    }
}

bun_core::declare_scope!(SemaCycles, hidden);

/// The value of `Checker::work_trap` that `Checker::work` never reaches.
const WORK_TRAP_DISARMED: u64 = u64::MAX;

/// See `Checker::begin_scope`.
#[must_use]
struct Scope {
    /// `Checker::lowest_taint` of the enclosing scope.
    outer_taint: usize,
    /// `frames.len()` when it began, to compare with `lowest_taint`.
    frames: u32,
    /// `non_cacheable_mark()` when it began, for `end_scope_by_counters`.
    counters: (u64, u64),
    /// `Task::held_back` when it began, for `Stored::since`.
    held_back: u64,
}

/// A query that may be circular.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Query {
    Expr(FileId, ExprId),
    /// Never entered. It owns the diagnostics that `getTypeOfExpression` reports for the expression
    /// while a loop is analyzed. Every task that analyzes the loop reports them, and the final
    /// check of the expression, which owns `Expr`, doesn't.
    ExprInFlowLoop(FileId, ExprId),
    Symbol(Sym),
    Declared(Sym),
    Return(FileId, FnId),
    /// `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`: the return type of a contextually
    /// typed function, computed the first time the function is checked. No resolution is pushed for
    /// it, so any caller that requests the return type in the meantime starts its own resolution.
    ReturnAtFirstLook(FileId, FnId),
    /// `TypeSystemPropertyNameResolvedReturnType` of a signature with a `target`. It encloses the
    /// resolution of the declared signature (`Return`) and the instantiation of its result.
    ReturnOfSignature(SigId),
    Shape(TypeId),
    /// `getPropertiesOfUnionOrIntersectionType` of an intersection, whose `Shape` is
    /// `resolveIntersectionTypeMembers`. See `structured_members`.
    Properties(TypeId),
    Bases(Sym),
    /// `TypeSystemPropertyNameResolvedBaseConstructorType`
    BaseConstructor(Sym),
    Constraint(TypeId),
    InferredConstraint(TypeId),
    Call(FileId, ExprId),
    Pat(FileId, PatId),
    /// `getTypeOfSymbol` of a parameter whose name is the pattern. For such a pattern, `Pat` is
    /// `getTypeForVariableLikeDeclaration`, which doesn't push a resolution. Both store in `pat_types`.
    ParameterSymbol(FileId, PatId),
    LiteralProp(FileId, PropId),
    TypeNode(FileId, TypeNodeId),
    /// The type of a property of a mapped type: the mapped type and the property name. `getTypeOfMappedSymbol`
    MappedProp(TypeId, Atom),
    Enum(FileId, EnumMemberId),
    Cond(FileId, TypeNodeId, MapperId),
    /// Asks if a parameter's initializer can be `undefined`.
    InitializerIsUndefined(FileId, ParamId),
    /// `TypeSystemPropertyNameResolvedTypeArguments`
    TypeArguments(TypeId),
    /// `TypeSystemPropertyNameAliasTarget`, around the types that `getTargetOfAliasDeclaration` requests.
    /// The link step finds a cycle that consists only of aliases (`AliasSymbolLinks::is_circular`).
    AliasTarget(Sym),
    /// `TypeSystemPropertyNameWriteType` of the accessors whose setter has the annotation at the
    /// node.
    WriteType(FileId, TypeNodeId),
    /// The relation cache entry for two types, keyed by a hash of their printed names, which is the
    /// same in every task. It's never on the stack and only owns the diagnostic of a stack depth
    /// overflow (`error_about_comparison_at_current_node`). The entry of a `MappedProp` gets one
    /// too (`circular_mapped_property`).
    Comparison(u64),
}

/// Hashes what `#[derive(Hash)]` hashes. Written out so that it's inlined, which drops the `match` where the caller
/// has just built the query.
impl Hash for Query {
    #[inline(always)]
    fn hash<H: Hasher>(&self, state: &mut H) {
        std::mem::discriminant(self).hash(state);
        match *self {
            Query::Expr(file, e) | Query::ExprInFlowLoop(file, e) | Query::Call(file, e) => {
                (file, e).hash(state);
            }
            Query::Symbol(sym)
            | Query::Declared(sym)
            | Query::Bases(sym)
            | Query::BaseConstructor(sym)
            | Query::AliasTarget(sym) => sym.hash(state),
            Query::Return(file, function) | Query::ReturnAtFirstLook(file, function) => {
                (file, function).hash(state);
            }
            Query::ReturnOfSignature(sig) => sig.hash(state),
            Query::Shape(ty)
            | Query::Properties(ty)
            | Query::Constraint(ty)
            | Query::InferredConstraint(ty)
            | Query::TypeArguments(ty) => ty.hash(state),
            Query::Pat(file, pat) | Query::ParameterSymbol(file, pat) => (file, pat).hash(state),
            Query::LiteralProp(file, prop) => (file, prop).hash(state),
            Query::TypeNode(file, node) | Query::WriteType(file, node) => (file, node).hash(state),
            Query::MappedProp(ty, name) => (ty, name).hash(state),
            Query::Enum(file, member) => (file, member).hash(state),
            Query::Cond(file, node, mapper) => (file, node, mapper).hash(state),
            Query::InitializerIsUndefined(file, param) => (file, param).hash(state),
            Query::Comparison(names) => names.hash(state),
        }
    }
}

/// A record that `Mentioned` still has to visit, or has visited.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Mention {
    Type(TypeId),
    Signature(SigId),
    Mapper(MapperId),
    Components(ComponentsId),
}

/// Searches a record, and the records it references, for a node or symbol of a file that `is_near` accepts. See
/// `Checker::is_reachable_only_by_importers`.
struct Mentioned<'a> {
    is_near: &'a dyn Fn(FileId) -> bool,
    is_found: bool,
    seen: crate::util::FxHashSet<Mention>,
    to_visit: Vec<Mention>,
}

impl Mentioned<'_> {
    fn record(&mut self, record: Mention) {
        if !self.is_found && self.seen.insert(record) {
            self.to_visit.push(record);
        }
    }
}

impl Visitor for Mentioned<'_> {
    fn atom(&mut self, _: Atom) {}
    fn components(&mut self, id: ComponentsId) {
        self.record(Mention::Components(id));
    }
    fn mapper(&mut self, id: MapperId) {
        self.record(Mention::Mapper(id));
    }
    fn sig(&mut self, id: SigId) {
        self.record(Mention::Signature(id));
    }
    fn ty(&mut self, id: TypeId) {
        self.record(Mention::Type(id));
    }
    fn file(&mut self, file: FileId) {
        self.is_found |= (self.is_near)(file);
    }
    fn plain<T: std::hash::Hash + ?Sized>(&mut self, _: &T) {}
}

/// True if tsgo detects a cycle that comes back to `q`. See `Checker::close_ring_from`.
fn is_guarded(q: Query) -> bool {
    !matches!(
        q,
        Query::TypeNode(..) | Query::Cond(..) | Query::InferredConstraint(_)
    )
}

impl Query {
    /// Returns the file whose syntax the key refers to, or `None` if the key is a type or a signature.
    #[inline]
    fn syntax(self) -> Option<FileId> {
        match self {
            Query::Expr(file, _)
            | Query::ExprInFlowLoop(file, _)
            | Query::Call(file, _)
            | Query::LiteralProp(file, _)
            | Query::Return(file, _)
            | Query::ReturnAtFirstLook(file, _)
            | Query::Pat(file, _)
            | Query::ParameterSymbol(file, _)
            | Query::InitializerIsUndefined(file, _)
            | Query::TypeNode(file, _)
            | Query::Cond(file, ..)
            | Query::Enum(file, _) => Some(file),
            Query::Symbol(sym)
            | Query::Declared(sym)
            | Query::Bases(sym)
            | Query::BaseConstructor(sym) => Some(sym.file),
            Query::ReturnOfSignature(_)
            | Query::Shape(_)
            | Query::Properties(_)
            | Query::Constraint(_)
            | Query::InferredConstraint(_)
            | Query::MappedProp(..)
            | Query::TypeArguments(_)
            | Query::AliasTarget(_)
            | Query::WriteType(..)
            | Query::Comparison(_) => None,
        }
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
        const SKIP_BINDING_PATTERNS = 1 << 3;
    }
}

/// `ContextualInfo`
#[derive(Copy, Clone)]
struct ContextualInfo {
    file: FileId,
    node: ExprId,
    /// `None` for `pushCachedContextualType` of a node without a contextual type.
    t: Option<TypeId>,
    is_cache: bool,
}

/// `InferenceContextInfo`
struct InferenceContextInfo {
    file: FileId,
    node: ExprId,
    /// `None` for `pushInferenceContext(node, nil)`. Boxed because it's moved back and forth
    /// between here and the code that works on it.
    context: Option<Box<infer::Inference>>,
}

/// The result of an `enter` call.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum EnterOutcome {
    Entered,
    /// Out of time, stack or depth, or a cycle that tsgo detects, defers or never runs into.
    Rejected,
}

/// `Checker.currentNode`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum CurrentNode {
    Expr(FileId, ExprId),
    TypeNode(FileId, TypeNodeId),
    Node(FileId, Node),
}

/// Metadata for an entry of `Checker::stack`.
#[derive(Copy, Clone)]
struct QueryFrame {
    /// A number unique to this query.
    serial: u64,
    /// `instantiation_depth` when it was pushed.
    entry_depth: u32,
    /// A query it made re-entered an entry below it.
    tainted: bool,
    /// It `is_resolution`, and is part of a cycle of resolutions. See `mark_cycle_from`.
    circular: bool,
    /// Its diagnostics are dropped because the result depends on a cycle, a speculative evaluation
    /// or a provisional type, and will be recomputed.
    drops_reported: bool,
    /// The length of `Checker::reported` when it was pushed. Later entries belong to it.
    reported_from: u32,
    /// Its index in `Checker::in_progress`.
    class: u16,
    /// `typeResolutionHasProperty`: this checker has cached a result for the same query since the frame was pushed.
    has_result: bool,
    /// Non-cacheable because an incomplete flow-loop type was read (`taint_from`).
    incomplete_flow: bool,
    /// It's a `Query::Expr`, and a nested visit of the expression has stored its type since the
    /// frame was pushed. Every later visit is a cache hit, which reports nothing.
    is_stored_by_nested_visit: bool,
    /// It's a `Query::Expr` or a `Query::LiteralProp`, and has read members from `anonymous_members_in_place`.
    /// `checkExpression` doesn't store anything, and the next visit sees whatever members exist by then, so no
    /// type is stored here either. Not set if there's no next visit, see `note_members_in_place_read_above`.
    has_read_members_in_place: bool,
    /// `getNarrowableTypeForReference` reached `isConstraintPosition` under it, so whether the
    /// constraints are substituted depends on the check mode and the contextual type. See `is_rechecked`.
    may_substitute_constraints: bool,
    /// It's the `Query::Expr` under which `getQuickTypeOfExpression` runs. That isn't a
    /// `checkExpression`, so `c.currentNode` doesn't change.
    is_quick_type: bool,
    /// `Checker::current_source_element` when it was pushed.
    source_element: Option<CurrentNode>,
    /// `Task::held_back` when it was pushed, for `Stored::since`.
    held_back: u64,
}

/// Which diagnostics of a file `check_file` computes.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Requested {
    /// `GetSyntacticDiagnostics`: the diagnostics of the parser and the scanner.
    Syntactic,
    /// The same, for a caller that then requests the types it needs, as typescript-eslint and tsgolint do,
    /// and doesn't read diagnostics. A file that `has_types_that_depend_on_order` is checked in full, as
    /// under `All`. If it's too large for control flow analysis (TS2563), that check turns the analysis off
    /// one block at a time and stores the types of everything else before any rule requests them.
    Types,
    /// .. and `GetDeclarationDiagnostics`. The declaration transformer queries the checker only
    /// about what the file exports.
    Declaration,
    /// .. and `getBindAndCheckDiagnostics`.
    All,
}

pub struct Checker<'p, 's> {
    pub p: &'p Program<'s>,
    /// The arena of the thread that runs the task. It's for the records the task creates, which may
    /// be published. Everything else that a task allocates is on the regular heap.
    pub arena: &'s Arena,
    /// The task that this checker runs. Every access to a `Buffered` or `FileLocal` table takes it
    /// as an argument because it owns the write buffer.
    task: Task<'s>,
    /// The tainted frame that `leave` popped last, for `cache_provisionally`.
    left_frame: Option<QueryFrame>,
    files: &'p Files<'s>,
    /// `varianceTypeParameter`: its name.
    variance_type_parameter: Atom,
    /// `autoArrayType`
    auto_array_type: TypeId,
    stack: Vec<Query>,
    /// One per entry of `stack`.
    frames: Vec<QueryFrame>,
    /// How many entries of `stack` fall into each class. A query whose class is empty isn't in progress.
    in_progress: [u16; 1024],
    /// The result of the last `enter`. `leave` and `excessively_deep` reset it to `Entered`.
    last_enter: EnterOutcome,
    /// The patterns whose implied type is being computed as the contextual type of their
    /// initializer, and the stack depth when that began.
    contextual_binding_patterns: Vec<(FileId, PatId, usize)>,
    /// `left` of the latest `getTypeOfExpression(left)` of `getContextualTypeForAssignmentExpression`.
    requested_assignment_target: Option<(FileId, ExprId)>,
    /// The type node whose type `precheck_type_node` is requesting.
    looked_at_type_node: Option<(FileId, TypeNodeId)>,
    /// `membersAndExportsLinks`, keyed by container and side.
    late_bound_members: FxHashMap<(Sym, bool), late_bound::LateBoundMembers>,
    /// `symbolNodeLinks.Get(decl).resolvedSymbol != nil`: the declarations that `lateBindMember`
    /// has bound, for the containers in `late_binding`.
    late_bound_declarations: crate::util::FxHashSet<(FileId, crate::bind::Decl)>,
    /// `has_this_type` of an interface.
    this_types: FxHashMap<Sym, bool>,
    /// The interfaces for which `has_this_type` is in progress.
    this_types_in_progress: Vec<Sym>,
    /// See `is_thisless_for_this_mapper`.
    thisless_members: FxHashMap<Sym, bool>,
    /// `links.resolvedType` of instantiated symbols, by target and mapper. Only contains the ones that differ from what
    /// the target's type gives. See `link_of_instantiated_symbol`.
    instantiated_symbol_links: FxHashMap<Sym, Vec<(MapperId, TypeId)>>,
    /// The `getResolvedMembersOrExportsOfSymbol` calls that are binding computed names, with `earlySymbols` in
    /// `links[resolutionKind]`. Each entry is the depth of `stack` at that point, the container, and true for
    /// the exports. See `is_late_binding`. If `earlySymbols` is nil, only the outermost call has an entry.
    late_binding: Vec<(usize, Sym, bool)>,
    /// The containers (with true for the exports) for which `getLateBoundSymbol` itself is calling
    /// `getMembersOfSymbol` or `getExportsOfSymbol`.
    late_binding_by_symbol: Vec<(Sym, bool)>,
    /// The sides for which `resolveDeclaredMembers` or `resolveAnonymousTypeMembers` assigned
    /// `earlySymbols` at the request of a computed name that was being bound for `late_binding_by_symbol`.
    /// No outer call assigns the members again, so no type of the container gets the late-bound members.
    permanently_early_bound: crate::util::FxHashSet<(Sym, bool)>,
    /// The `resolveDeclaredMembers` calls that are inside `getMembersOfSymbol`. Each assigns
    /// `declaredMembers` once the names are bound. See `gets_early_symbols_permanently`.
    declared_members_in_progress: Vec<shape::Declaring>,
    /// `nonExistentProperties`: property accesses whose 2339 message is being printed, with
    /// `stack.len()` when printing started.
    reporting_nonexistent: Vec<(FileId, ExprId, usize)>,
    /// The `resolveDeclaredMembers` calls that are inside `getIndexInfosOfSymbol`, with `declaredMembersResolved` set.
    /// Each entry is the depth of `stack` at that point (with the `Query::Shape` on top if `resolveObjectTypeMembers`
    /// is the caller) and the first member of the declaration whose computed name is some string, number or symbol. The
    /// last field is `None` for members that aren't the instance side of a class or interface.
    declared_index_infos_in_progress: Vec<(usize, FileId, MemberId, Option<shape::Declaring>)>,
    /// The `resolveAnonymousTypeMembers` calls for a class or enum value that are past their first
    /// `setStructuredTypeMembers`, so `ObjectFlagsMembersResolved` is set. Each entry is the type's
    /// origin, the members assigned so far, and the height of `stack` at that point.
    anonymous_members_in_place: Vec<(Origin, shape::MembersInPlace, usize)>,
    /// The `resolveAnonymousTypeMembers` calls for an instantiated type that are inside
    /// `instantiateIndexInfos`, with `ObjectFlagsMembersResolved` set and no members.
    index_infos_in_instantiation: Vec<shape::IndexInfosInInstantiation>,
    /// The enum declarations that `computeEnumMemberValues` is working on, which have
    /// `NodeCheckFlagsEnumValuesComputed`. Each comes with `enumMemberLinks.Get(member).value` of
    /// the members reached so far.
    enum_values_in_progress: Vec<((FileId, EnumId), Vec<decl::Evaluated>)>,
    /// The classes and interfaces whose shapes are resolving the members of their base types, by shape key.
    /// `resolveObjectTypeMembers` calls `setStructuredTypeMembers` with the declared members before that. The second
    /// field is `t` of `resolveObjectTypeMembers`, because only that reference has `ObjectFlagsUnresolvedMembers`.
    inheriting: Vec<(TypeId, TypeId)>,
    /// `resolvedBaseTypes` of each class or interface whose base types are being resolved.
    base_types_so_far: Vec<(Sym, Vec<TypeId>)>,
    /// The classes and interfaces whose members were resolved while their `getBaseTypes` was in
    /// progress. Their `ObjectFlagsMembersResolved` lasts until `getBaseTypes` returns. Each entry
    /// is the shape key, the shape, and the index of the entry in `base_types_so_far`.
    members_resolved_before_base_types: Vec<(TypeId, &'p shape::Resolved<'p>, usize)>,
    /// `t` of each `resolveObjectTypeMembers` call that's inside `getBaseTypes(source)`. When that
    /// returns, the call sets `t`'s members and overwrites whatever a request in the meantime has set.
    resolving_at_base_types: Vec<TypeId>,
    /// `pushTypeResolution(key, ResolvedBaseConstraint)`. Each entry is the key of a mapped type
    /// whose constraint type is being resolved, the height of `stack` at that time, and a flag
    /// that's true if a cycle has closed around it (`mark_cycle_from`).
    mapped_constraints_in_progress: Vec<((FileId, TypeNodeId, MapperId), usize, bool)>,
    /// The indices in `stack` of the `MappedProp` frames that were re-entered through what
    /// `resolveMappedTypeMembers` resolves before the symbol exists (`type_of_mapped_prop`).
    mapped_props_reentered_through_members: Vec<usize>,
    /// `c.serializationLevel`: how many `TypeToString` calls are in progress, counting those whose
    /// resolutions are made eagerly.
    serialization_level: u32,
    /// `c.flowTypeCache`, for the loop back edge being traversed.
    flow_type_cache: FxHashMap<(FileId, ExprId), TypeId>,
    /// `stack.len()` when that traversal began, or `usize::MAX` if no back edge is being traversed.
    flow_type_cache_depth: usize,
    /// `c.flowInvocationCount`
    flow_invocation_count: u64,
    /// Where `add_diagnostic` stores a diagnostic it discards.
    discarded: Option<sink::Reported>,
    /// `NodeCheckFlagsTypeChecked` on the name of a property access, meaning its 2339 has been
    /// created. `true` if it was also discarded.
    non_existent_properties: FxHashMap<(FileId, ExprId), bool>,
    /// The calls in the file being checked whose `links.resolvedSignature` was assigned at
    /// `maxSerializationLevel`. The errors that `resolveCall` reported in the callee, the type
    /// arguments and the arguments were discarded, and nothing checks them again.
    signatures_resolved_with_errors_discarded: Vec<ExprId>,
    /// The same for `links.resolvedType` of the expressions in the file being checked that
    /// `is_checked_by_check_expression_cached`.
    expressions_cached_with_errors_discarded: Vec<ExprId>,
    /// The start of each error in the file being checked that was discarded at `maxSerializationLevel`.
    starts_of_discarded_errors: Vec<u32>,
    /// True if the next `with_printer` isn't a barrier for cycle detection, because it prints when
    /// and what tsgo prints.
    printing_closes_cycles: bool,
    /// True while recreating a message that was dropped along with an uncached result. Its types
    /// are printed behind the barrier and don't count as a level. tsgo creates the message once.
    reprinting: bool,
    /// The height of `stack` when each `typeToStringEx` in progress began.
    printing_floors: Vec<usize>,
    serialized_types: print::SerializedTypes,
    /// The height of `inference_contexts` while `getContextFreeTypeOfExpression` or
    /// `report_discarded_errors_of` rechecks an expression. Diagnostics reported then are kept.
    context_free_level: usize,
    /// `resolved_signature` resolves the calls in this range of a file as if they had never been
    /// resolved, and doesn't store the results. See `context_free_type_of_freshly_resolved_call`.
    calls_to_resolve_afresh: Option<(FileId, u32, u32)>,
    /// The calls resolved that way, each with its result, or `None` while it's being resolved.
    calls_resolved_afresh: Vec<(ExprId, Option<ResolvedCall>)>,
    /// The stack depth at each point where a query was made that TypeScript wouldn't have made
    /// there, or not yet. A cycle through such a point may be an artifact of this resolver, so the
    /// result is unresolved rather than an error.
    eager: Vec<usize>,
    /// The entries of `eager` that represent the value assigned on the back edge of a loop in
    /// progress. TypeScript requests that value there as well. See `is_cycle_of_initializers`.
    loop_values: Vec<usize>,
    /// How many cycles `mark_cycle_from` has left unmarked because of `eager`. If it grows during a
    /// walk of a loop, tsgo doesn't make that walk. See `Flow::Loop` in `flow_type`.
    unmarked_rejections: u64,
    /// The height of `stack` at each request of `getNonCircularReturnTypeOfSignature` in progress.
    non_circular_returns: Vec<usize>,
    /// The height of `stack` at each request of `hasArrayOrTypeTypeConstraint` in progress.
    array_or_tuple_constraint_requests: Vec<usize>,
    /// The `getObjectTypeInstantiation` calls on mapped types that missed the cache on their key
    /// and haven't assigned `instantiations[key]` yet.
    mapped_instantiations_in_progress: Vec<mapped::MappedInstantiation>,
    /// The index in `stack` from which a query counts as in progress.
    resolution_start: usize,
    /// True if the last `enter` rejected the query because it's one of TypeScript's own resolutions and is in progress.
    found_cycle: bool,
    /// True if the frame popped by the last `leave` was in a cycle.
    left_a_cycle: bool,
    /// The stale entries on `typeResolutions` above a resolution in progress.
    /// `getTypeOfVariableOrParameterOrPropertyWorker` returns the type of `module` or `exports`
    /// without `popTypeResolution`, so every resolution around it pops the entry above its own and
    /// leaves its own behind. Listed from the bottom. Each entry is the height of `stack` below it
    /// and `!result`. Each has its property (`typeResolutionHasProperty`).
    stale_resolutions: Vec<(usize, bool)>,
    /// The `module` and `exports` symbols whose entry was left there.
    unpopped_resolutions: crate::util::FxHashSet<Sym>,
    /// The result of `pop_type_resolution` for a `Query::Pat`, passed on to the `Query::Symbol` right below it.
    popped_for_symbol: Option<bool>,
    /// The binding elements that got their type from `reportCircularityError` while
    /// `links.resolvedType` of their parameter's symbol, which `is_resolved_on_request`, was still
    /// nil. A default in the pattern reads them while that symbol is being resolved.
    circular_before_parameter_symbol: crate::util::FxHashSet<(FileId, PatId)>,
    /// The parameter of one of those, set while `report_on_circular_pat` handles it.
    parameter_symbol_taken_as_unresolved: Option<(FileId, ParamId)>,
    /// Number of times frames were marked non-cacheable for any reason except `mark_tainted_by_pattern_from`.
    taints: u64,
    /// How many of those, and of `cycles`, come from `taint_from`.
    incomplete_flow_taints: u64,
    /// See `is_type_reference_checked`: the file, and a bit for each of its type nodes.
    checked_type_references: (Option<FileId>, Vec<u64>),
    /// `taints` when the first entry of `contextual_binding_patterns` was pushed, or `u64::MAX` if
    /// the innermost frame was non-cacheable then.
    taints_before_patterns: u64,
    /// Number of circular queries.
    cycles: u64,
    /// The lowest index given to `mark_tainted_from` since the innermost `begin_scope`.
    lowest_taint: usize,
    /// `contextualInfos`
    contextual: Vec<ContextualInfo>,
    /// The height of `stack` at which `getContextualType` finds nothing pushed. There, the contextual
    /// types recorded by call resolution (`arg_contexts`) aren't read, and an argument's contextual type
    /// comes from the parameters of `links.resolvedSignature`. A query entered above that height is
    /// evaluated normally, so its cached result doesn't depend on the caller. `usize::MAX` means nowhere.
    pulls_contextual_types_at: usize,
    /// The height of `stack` at which `checkExpression` isn't memoized. There, an expression is rechecked, and its
    /// cached type is neither read nor replaced. See `get_type_of_expression_after_check`. `usize::MAX` means nowhere.
    rechecks_at: usize,
    /// `checkMode` of the non-memoized check. See `check_mode`.
    mode_of_recheck: CheckMode,
    /// `node` of the innermost `getTypeOfExpression` in progress, which is checked under
    /// `CheckModeTypeOnly`. See `is_checked_type_only`.
    type_only_node: Option<(FileId, ExprId)>,
    /// Results of rechecks with nothing pushed, which are the same for any caller. Keyed by
    /// expression, and by member of an object literal or JSX attribute.
    rechecked_exprs: FxHashMap<(FileId, ExprId), TypeId>,
    rechecked_members: FxHashMap<(FileId, PropId), TypeId>,
    /// Empty maps that `set_rechecked_aside` reuses.
    spare_rechecked: Vec<Rechecked>,
    /// `inferenceContextInfos`
    inference_contexts: Vec<InferenceContextInfo>,
    instantiation_depth: u32,
    /// The `errorNode` of the comparison that began while no query or instantiation was in progress
    /// and hasn't ended yet. See `begin_comparison`.
    outermost_comparison: Option<Option<(FileId, u32, u32)>>,
    /// `instantiationCount`: the instantiations computed since the last statement, type node or expression check began.
    instantiation_count: u32,
    /// How many instantiations missed every cache.
    instantiations_computed: u64,
    /// The entries most recently read from or written to `Program::instantiations`.
    recent_instantiations: instantiate::Recent,
    /// The entries most recently read from or written to `Program::composed`.
    recent_composed: instantiate::Recent,
    /// The references that `type_with_this_argument_ex` made most recently, keyed by the reference and the argument.
    recent_with_this: instantiate::Recent,
    /// `is_const_type_variable`, keyed by the type and 1 + the depth.
    recent_const_type_variables: instantiate::Recent,
    /// Keyed by a signature and a `relate::DerivedSig`.
    recent_derived_sigs: instantiate::Recent,
    /// The types that `type_of_mapped_prop` found in `Program::mapped_prop_types`, keyed by what
    /// decides which entry it reads: the mapped type in the property's source, the property's mapper
    /// and its name. It isn't a `Recent` because the properties of a union of a hundred `Omit<..>`
    /// are read in turn, over and over, and there are more of them than a `Recent` has slots.
    known_mapped_prop_types: FxHashMap<(TypeId, MapperId, Atom), TypeId>,
    /// `ObjectFlagsUnresolvedMembers`. `resolveObjectTypeMembers` calls `setStructuredTypeMembers` with the members
    /// that the class or interface declares before it instantiates the base types. A request for the type reference's
    /// members in the meantime finds no inherited members. With `class C<T extends B> extends B<T["p"]>` and `R` =
    /// `C<R>`, `R["p"]` is `unknown` there, and the base type of `R` is `B<unknown>` from then on.
    ///
    /// Here all references share the declared type's members, and the instantiated base type is
    /// `compose(first, second)`, where `first` is the mapper of an inherited member and `second` is
    /// the mapper of the reference's members. There's one entry per `compose` in progress:
    /// `second`, and the height of `frames` when it began.
    unresolved_members: Vec<(MapperId, u32)>,
    /// How many times `members` skipped the inherited members. Each one also counts in `cycles`.
    unresolved_members_hits: u64,
    /// How many times a request for members got the members in place. That covers `unresolved_members_hits`,
    /// a re-entered query that `has_members_in_place`, `has_no_members_in_place`, and a provisional result
    /// that follows from any of them. Each one also counts in `cycles`, so no other memo stores what follows
    /// from it. tsgo doesn't mark anything there. What tsgo assigns once, no matter what's in progress, is
    /// stored here as well: `compose` (`resolveObjectTypeMembers`), `resolve_type_arguments`
    /// (`getTypeArguments`) and `instantiate_index_infos` (`resolveAnonymousTypeMembers`). Otherwise n type
    /// references that each need a member of the others are resolved n! times.
    members_in_place_hits: u64,
    /// `work` at the last of them.
    members_in_place_hit_at: u64,
    /// The lowest index in `unresolved_members` that had a hit since the innermost `compose` in progress began.
    lowest_unresolved_members_hit: u32,
    active_mappers: instantiate::ActiveMappers,
    /// How many times `error_at_current_node` had nothing to report since `check_file` began. The
    /// computation in progress at that point isn't cached.
    limits: u64,
    /// How many times `instantiate` returned the error type at a limit since `check_file` began.
    instantiation_limit_hits: u64,
    /// The sum of the two at the end of each file that `check_file` has finished.
    limits_in_earlier_files: u64,
    /// How many comparisons were `TernaryMaybe` because both types were deeply nested (`isDeeplyNestedType`).
    /// That depends on the comparisons in progress and on the order in which the types were created.
    comparisons_of_deeply_nested_types: u64,
    /// Only in a task that commits. The comparisons that succeed because a nested comparison was `TernaryMaybe`, for
    /// two deeply nested types or at 100 levels. Another task may get a different result, and in `Program::relations`
    /// the first result would win for every task. See `known_relation`. It lives as long as the task, like
    /// everything the task has derived from it.
    relations_of_this_task: FxHashMap<relate::Key, u8>,
    /// True if `insert_relation` stores in `relations_of_this_task`.
    stores_relations_per_task: bool,
    /// The same for base constraints that were cut short, or that follow from one that was. Where
    /// the cut happens depends on how deep the computation was when it reached the type. See
    /// `known_constraint`.
    constraints_of_this_task: FxHashMap<TypeId, (Option<TypeId>, bool)>,
    /// How many times a base constraint was cut short, or an entry of `constraints_of_this_task` was read.
    constraint_cuts: std::cell::Cell<u64>,
    /// Only in a task that commits. The keys of the `instantiate_cached` calls in progress that missed the
    /// cache, and the types of the `get_literal_type_from_properties` calls in progress. Of two calls with the
    /// same key, the outer one stores last and its entry wins, so the inner one doesn't write immediately.
    instantiations_in_progress: Vec<(TypeId, MapperId)>,
    keys_of_properties_in_progress: Vec<TypeId>,
    /// The results withheld from `Program::instantiations` because `instantiate` returned the error
    /// type at a limit, each with the serial number of the mapper's activation and a flag that's
    /// true if `limits` changed. While the mapper is active, no path to the limit is taken twice
    /// (`activeTypeMappersCaches`). The next caller hits the limit itself. An entry stored while no mapper was active has
    /// the number 0 and serves every caller until the end of the file.
    instantiations_up_to_a_limit: FxHashMap<(TypeId, MapperId), (u32, TypeId, bool)>,
    /// The same for the results of `check_type_related_to` and of `variances_of` during which `cuts` changed.
    relations_cut_short: FxHashMap<relate::Key, (u64, bool)>,
    /// `enumRelation`, keyed by the source and target symbols.
    enum_relation: FxHashMap<(Sym, Sym), bool>,
    /// `enumLiteralTypes` and `enumNaNLiteralTypes`, keyed by the enum symbol and the value.
    enum_literal_types: FxHashMap<(Sym, crate::types::EnumValue), TypeId>,
    /// See `shortcuts::task_fact`.
    task_facts: shortcuts::TaskFacts,
    /// `Relation.size()`, indexed by `relate::Relation`: the entries of `relations` that this task has
    /// stored. The entries from files that a single checker would have checked earlier aren't counted.
    relation_sizes: [i32; 6],
    variances_cut_short: FxHashMap<Sym, (u64, &'s [u8])>,
    #[expect(
        clippy::vec_box,
        reason = "taking one moves a pointer instead of 280 bytes"
    )]
    free_relaters: Vec<Box<relate::Relater>>,
    /// Each equals `Inference::for_params(&[], None)`. They're swapped in for an inference that's taken out.
    #[expect(
        clippy::vec_box,
        reason = "taking one moves a pointer instead of 592 bytes"
    )]
    spare_inferences: Vec<Box<infer::Inference>>,
    /// The flags that the comparisons in progress have set about the reliability of the variance being computed.
    reliability: u8,
    in_variance_computation: bool,
    /// True if the next `related` call compares two marker types for `variances_of`. Consumed on entry.
    is_marker_comparison: bool,
    /// True if the next `related` call is the speculative comparison of `check_type_related_to_ex`.
    /// See `Relater::stores_failures_locally`.
    pub(super) is_trial_comparison: bool,
    variances_in_progress: Vec<Sym>,
    /// In-progress symbols that a cycle re-entered. Their variances read as empty until the measurement finishes.
    variances_marked_empty: Vec<Sym>,
    /// Measurements suspended by a restart. Their marker types still count as marker types.
    suspended_variances: Vec<Sym>,
    /// Counts requests for the variances of a symbol that is still being measured.
    in_progress_variance_reads: u64,
    /// The entries cached since the outermost `variances_worker` call on the stack began.
    variances_measured: Vec<(Sym, &'s [u8])>,
    /// After `type_arguments_related_to` returns false, the index of the unrelated pair.
    failed_type_argument: u32,
    /// The index of each symbol in `Task::order_dependent_variances`.
    order_dependent: FxHashMap<Sym, u32>,
    /// How many times variances in `order_dependent` were used.
    order_dependent_uses: u64,
    /// `simplifiedForReading` and `simplifiedForWriting`.
    simplified: [shortcuts::TypeMap<TypeId>; 2],
    /// A 256-bit filter of the property names of `Object`, `Function`, `CallableFunction` and
    /// `NewableFunction`. A name whose bit is clear isn't one of them. All zero means it isn't built yet.
    pub(super) inherited_names: [u64; 4],
    /// The names themselves, to check a name whose bit is set. `None` if it isn't built yet, or if the members
    /// of one of the four types aren't stored, so that looking up a name in that type resolves them again.
    pub(super) inherited_name_set: Option<crate::util::FxHashSet<Atom>>,
    /// `resolvedConstraintOfDistributive`. `None` is `noConstraintType`.
    cond_distributive_memo: FxHashMap<TypeId, Option<TypeId>>,
    /// Set when a comparison exhausts `Relater::relation_count` (2859). A caller that wants to know clears it before
    /// comparing and then puts the old value back, so once it's set outside such a caller it stays set.
    pub(super) relation_too_complex: bool,
    /// `c.currentNode`, as `checkSourceElement` and `checkDeferredNode` set it. See `current_node`.
    pub(super) current_source_element: Option<CurrentNode>,
    /// `NodeCheckFlagsTypeChecked` of `task.file`: `check_file` has finished it.
    is_type_checked: bool,
    /// True while `check_file` answers the queries that `Emit` makes before the check (`Options::emits_first`).
    is_emitting: bool,
    /// The computed names of `task.file` whose expression `GetConstantValue` was the first to
    /// check. `checkExpressionCached` has then assigned the `links.resolvedType` that
    /// `checkComputedPropertyName` tests before it checks and reports.
    cached_by_emit: Vec<ExprId>,
    /// The diagnostics reported for the queries in progress, and with none in progress. See `sink`.
    reported: Vec<Reported>,
    /// True while `check_expression` runs for `check_expression_in_flow_loop`, possibly in a file
    /// other than the task's. It then records nothing for the end of `checkSourceFile`, which is
    /// the file walk's job, and it checks the calls that it visits.
    is_checking_in_flow_loop: bool,
    /// The spans of `task.file` that `checkSourceFile` never visits. The passes that iterate over
    /// all nodes of a kind do visit them.
    never_checked: std::cell::RefCell<Vec<(u32, u32)>>,
    /// The intersections being tested for being uninhabited.
    pub(super) never_in_progress: Vec<TypeId>,
    /// `resolvedReducedType` of a union, once the answer for every member is final.
    reduced_unions: shortcuts::TypeMap<TypeId>,
    /// See `union_property`.
    union_members: union_property::UnionMembers<'p>,
    /// See check/unlisted_intersections.rs.
    unlisted_intersections: shape::UnlistedIntersections<'p>,
    /// See check/sibling_intersections.rs. `Some` while `reduced_members` filters a union.
    sibling_intersections: Option<shape::SiblingIntersections<'p>>,
    /// Mapped types whose members are being resolved. See `has_base_type_in_progress`.
    mapped_types_in_progress: smallvec::SmallVec<[TypeId; 4]>,
    /// The height of `stack` at which `is_empty_intersection` began, for each one in progress.
    pub(super) never_in_progress_from: Vec<usize>,
    /// The height of `stack` at which the worker of each `inferReverseMappedType` in progress began.
    pub(super) reverse_mapped_inferences_from: Vec<usize>,
    /// The type parameters whose `resolvedDefaultType` is `resolvingDefaultType`, each with the height
    /// of `stack` when that began. The flag is true once it has become `circularConstraintType`.
    defaults_in_progress: Vec<(TypeId, usize, bool)>,
    /// The type references for which `getSingleBaseForNonAugmentingSubtype` has set
    /// `ObjectFlagsIdenticalBaseTypeCalculated` and hasn't returned, each with the height of `stack` when that began.
    identical_base_types_in_progress: Vec<(TypeId, usize)>,
    /// `number_name` of each index, or `NONE` if it hasn't been requested.
    names_of_small_numbers: std::cell::RefCell<Vec<Atom>>,
    interface_declarations: FxHashMap<Sym, std::rc::Rc<errors_heritage::InterfaceDeclarations>>,
    /// For `check_namespace_merge_order`: whether a class or a function is among the declarations of a symbol.
    has_class_or_function_declaration: FxHashMap<Sym, bool>,
    /// For `check_external_module_exports`: how many declarations of an exported symbol count as duplicates.
    counted_export_declarations: FxHashMap<Sym, usize>,
    /// The mapped types with an `as` clause for which `isGenericMappedType` is in progress.
    generic_mapped_types_in_progress: Vec<(FileId, TypeNodeId)>,
    /// The ones for which it hit the `instantiation_count` limit since `check_file` began.
    generic_mapped_types_cut_short: Vec<TypeId>,
    /// The entries most recently found in `Program::members`, indexed by the low bits of the key.
    recent_members: Box<[shape::RecentMembers<'p>; shape::RECENT_MEMBERS]>,
    /// The most recent results of `union` for two types, the lower id first.
    recent_unions: instantiate::Recent,
    /// The same for `union_unreduced`, in the order of the arguments.
    recent_unreduced_unions: instantiate::Recent,
    /// `unionOfUnionTypes`, for `UnionReductionSubtype`: the lower id first.
    unions_of_union_types: FxHashMap<(TypeId, TypeId), TypeId>,
    union_calls: unions::UnionCalls,
    /// The `stack` of `getResolvedBaseConstraint`: the recursion identities of the nested
    /// constraint computations in progress.
    constraint_stack: Vec<relate::RecursionId>,
    /// The types whose `Query::Constraint` is in flight and was marked at a rejected `enter`.
    /// `pushTypeResolution` marks every entry from the start of the cycle to the top of the stack.
    /// The frame's `leave` removes the type and stores the flag.
    constraints_marked_circular: Vec<TypeId>,
    /// The type parameters whose constraint this task has found to be circular, each with
    /// `c.currentNode` at that moment. `None` under `eager`, or in a check after `check_source_file`.
    circular_constraint_origins: Vec<(TypeId, Option<CurrentNode>)>,
    /// The deferred type references for which `resolve_type_arguments` is in
    /// `c.instantiateTypes(typeArguments, d.mapper)`, outermost first. A reference can appear many
    /// times, because no `Query` is in flight at that point (`popTypeResolution` has already run).
    type_arguments_in_instantiation: Vec<TypeId>,
    /// `conditionalConstraintDepth`
    conditional_constraint_depth: u32,
    deepest_stack: std::cell::Cell<usize>,
    ran_out_of_stack: std::cell::Cell<bool>,
    /// `enclosing_scope_of_expr` for the contents of these expressions.
    scopes_inside_exprs: std::cell::RefCell<FxHashMap<(FileId, ExprId), crate::bind::ScopeId>>,
    /// `spread_indices` of the array literals and the calls with many elements or arguments.
    spread_indices_of_many: FxHashMap<(FileId, ExprId), Option<(usize, usize)>>,
    /// How often the native stack ran low, or a result of `relations_cut_short` or `variances_cut_short` was read.
    times_cut_short: std::cell::Cell<u64>,
    /// For the most recently queried file.
    exprs_by_kind: Option<(FileId, std::rc::Rc<hir::ExprsByKind>)>,
    /// See `provisional_shape`, which returns a reference to one and pushes the next.
    provisional_shapes: crate::util::memory::LocalVec<shape::Resolved<'s>>,
    /// Non-cacheable query results, kept for reuse while the computation that made them
    /// non-cacheable is in flight. See `cache_provisionally`.
    provisional: FxHashMap<Query, Provisional>,
    /// `work` and `from` of each call of `mark_tainted_by_pattern_from` and `taint_from`, in order.
    /// An event is dropped when a later one has a lower or equal `from`, so `from` increases and
    /// the length is bounded by the depth of `stack`. See `lowest_taint_since`.
    taint_events: Vec<(u64, u32)>,
    /// `work` when `cycles` was last incremented, when `limits` was, and when a query was last
    /// rejected by `bailed_out`. `QueryFrame::serial` is `work` when the frame was pushed, so the
    /// event happened since then if the value is at least the serial number.
    cycle_at: u64,
    limit_at: u64,
    rejected_at: u64,
    /// `GetModeForUsageLocation` of `TryGetModuleSpecifierFromDeclaration(enclosingDeclaration)`,
    /// while the name of an import or an export is printed.
    enclosing_module_specifier_mode: Option<ResolutionMode>,
    emit_resolver_links: errors_declaration_emit::EmitResolverLinks,
    /// See `Checker::modules_that_export`. Unlike `emit_resolver_links`, it's the same for every file.
    exporting_modules: Option<std::rc::Rc<errors_declaration_emit::ExportingModules>>,
    expected: Requested,
    /// The output `get_declaration_diagnostics` leaves for `checked`.
    declaration_file: Option<Vec<u8>>,
    /// During declaration emit: the indentation depth of the current line.
    declaration_indent: Option<usize>,
    /// True if anything in the file being checked is in an ambient context.
    has_ambient_context: bool,
    suggestions_among_globals: errors::SuggestionsAmongGlobals,
    checked_leaves: errors::CheckedLeaves,
    /// The derived parts of conditional and mapped types, and the aliases of types.
    links: links::TypeLinks,
    /// The derived parts of signatures.
    signature_links: signature_links::SignatureLinks,
    /// `reparseTopLevelAwait`: the statements of that file that end up in an await context. Sorted.
    /// Computed on first use.
    reparsed_for_await: Option<Vec<StmtId>>,
    /// `flowAnalysisDisabled`: the files for which it's set, in the order it was set. There's more than
    /// one if a query from a file that's too long reaches another file that's too long. Only
    /// `checkBlock` restores it, so after a reference outside any function or module block it stays set
    /// for the rest of the file. In tsgo it applies to every reference, including one in another file
    /// that a query reaches in the meantime, whose `errorType` then ends up in what the query stores.
    flow_analysis_disabled: Vec<FileId>,
    /// Nesting depth of the `const ok = test` conditions being inlined.
    inline_level: u32,
    /// The declared type of the reference that the flow walk in progress narrows.
    walk_declared: TypeId,
    /// The constants whose initializers `evaluateEntity` is evaluating.
    constants_in_evaluation: Vec<(FileId, VarDeclId)>,
    /// The most recent final results of `sig_params` and `sig_type_params`, indexed by the low bits
    /// of the signature id.
    recent_sig_params: Box<[(SigId, &'p [SigParam]); RECENT_SIGS]>,
    recent_sig_type_params: Box<[(SigId, &'p [TypeId]); RECENT_SIGS]>,
    /// The most recent results of `type_param`, indexed by the low bits of the type parameter's number.
    recent_type_params: Box<[std::cell::Cell<((FileId, TypeParamId), TypeId)>; RECENT_TYPE_PARAMS]>,
    /// The most recent results of `steps_of_sig_mapper` for functions with type parameters, indexed by the low bits of
    /// the mapper id.
    recent_steps: Box<[std::cell::Cell<instantiate::Steps>; RECENT_SIGS]>,
    /// The unions whose members are being awaited.
    awaiting: Vec<TypeId>,
    /// `lastFlowNode`, `lastFlowNodeReachable`
    last_flow_node: (FileId, crate::bind::FlowId, bool),
    /// `undefinedProperties`
    undefined_properties: FxHashMap<Atom, Prop<'s>>,
    /// `cachedTypes[CachedTypeKindSyntheticType]`, keyed by a module's type. True if the cached
    /// type has a synthetic `default`.
    synthetic_default_import_types: FxHashMap<TypeId, bool>,
    /// `symbolReferenceLinks` of the private members marked by an access in a file other than the
    /// one that declares them (`mark_property_as_referenced`).
    referenced_properties: crate::util::FxHashSet<Sym>,
    /// `Resolve` with `isUse` in `trackComputedName` and `trackExistingEntityName`: the file and
    /// the scope it starts from, the name and the meaning. `check_unused` of that file resolves it
    /// again.
    tracked_names: Vec<(FileId, crate::bind::ScopeId, Atom, SymFlags)>,
    /// `Checked::unused_private_members` of the file being checked.
    unused_private_members: Vec<(Sym, u32)>,
    /// The contexts of the unions being widened. A `*WideningContext` is an index into it.
    widening_contexts: Vec<symbols::WideningContext<'p>>,
    /// `cachedTypes[CachedTypeKindWidened]`
    widened_types: shortcuts::TypeMap<TypeId>,
    /// `iterationTypesCache`, keyed by the type and `IterationUse::cache_flags`. The flag is true
    /// if tsgo has the entry too (`iterable_types`).
    iteration_types_cache: FxHashMap<(TypeId, u8), (symbols::Iter3, bool)>,
    /// The keys of the entries whose request has reported something that a frame in progress may
    /// still drop, each with `work` at that time, in that order (`settle_iteration_requests`).
    reported_iteration_requests: Vec<(u64, (TypeId, u8))>,
    /// The calls of immediately invoked function expressions whose arguments are being checked to
    /// type the parameters.
    iife_resolving: Vec<(FileId, ExprId)>,
    /// How often `resolved_signature` has returned `anySignature` for a call in `iife_resolving`.
    any_signature_reads: u32,
    /// `work` at the last of them.
    any_signature_read_at: u64,
    /// The loops in progress, for any walk (`flowLoopStack`): the loop, the reference, its declared
    /// and its initial type, the antecedent types collected so far, and the depth of `stack` when
    /// the pass began.
    flow_loops: Vec<(
        crate::bind::FlowId,
        flow::Reference,
        TypeId,
        TypeId,
        TypeId,
        usize,
    )>,
    /// The types for which a reverse mapped type inference is in progress, each with its push number. See
    /// `is_at_least_as_new`.
    reverse_mapped_source_stack: Vec<(TypeId, u32)>,
    reverse_mapped_target_stack: Vec<(TypeId, u32)>,
    reverse_expanding: u8,
    flow_memo: flow::FlowMemo,
    /// `deferredNodes` of the file being checked, an ordered set.
    deferred_nodes: std::collections::VecDeque<ExprId>,
    /// The class expressions that have two entries in `deferred_nodes`, the first for their type
    /// parameters. The flag is true once `checkDeferredNodes` has reached the first.
    deferred_type_parameters: Vec<(ExprId, bool)>,
    /// The identifiers that `getResolvedSymbol` couldn't resolve, held until `report_unresolved_identifiers`.
    unresolved_identifiers: Vec<(FileId, ExprId, Atom)>,
    /// `links.resolvedSymbol == c.unknownSymbol` for identifiers in the file being checked, meaning
    /// the `onFailedToResolveSymbol` error has been created. `true` if it was also discarded.
    unknown_symbols: FxHashMap<ExprId, bool>,
    /// Entries of `Log::node_keys`. See the function of the same name.
    withheld_until_the_file_ends: Vec<[u32; 3]>,
    /// The other files in which this task has found an error since its last commit. See `View::hides`.
    files_with_errors: crate::util::FxHashSet<FileId>,
    /// The aliases that `check_target_of_alias_symbol` has reported on since `check_file` began:
    /// `aliasSymbolLinks.aliasTarget != nil`, or `resolveAlias` is in progress.
    alias_targets_reported: crate::util::FxHashSet<Sym>,
    /// The ones for which `resolveAlias` is in progress.
    alias_targets_in_progress: Vec<Sym>,
    is_deferred_node: crate::util::FxHashSet<ExprId>,
    /// `deferredDiagnosticCallbacks`: the declarations for which `checkWeakMapSetCollision` or
    /// `checkReflectCollision` is deferred. The other callbacks are in `reported`
    /// (`Reported::deferred`).
    deferred_diagnostics: Vec<Node>,
    /// `saveDeferredDiagnostics`
    save_deferred_diagnostics: bool,
    /// `nodeLinks.flags` for the file being checked.
    node_check_flags: FxHashMap<Node, u8>,
    /// `withinUnreachableCode`
    within_unreachable_code: bool,
    /// `reportedUnreachableNodes` for the file being checked.
    reported_unreachable_nodes: Vec<StmtId>,
    /// `renamedBindingElementsInTypes`
    renamed_binding_elements_in_types: Vec<PatPropId>,
    /// The expressions in the file being checked whose parent's check returned before reaching
    /// them, each with the start of its node: initializers and computed property names
    /// (`checkVariableLikeDeclaration`), operands of `yield` (`checkYieldExpression`). Such an
    /// expression is checked only if the type of a declaration is computed from it.
    unvisited_exprs: Vec<(u32, ExprId)>,
    /// The initializers in the parameters of functions without a body that `getTypeFromBindingElement`
    /// has checked. `checkExpressionWithContextualType` doesn't store a type, and with a type parameter in scope nothing
    /// else does either.
    checked_with_contextual_type: Vec<(FileId, ExprId)>,
    /// `getContextualSignature` as `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` got it, before the
    /// inference context instantiates it, for the functions for which `contextual_param_type_at_check` is requested.
    contextual_signatures_at_check: Vec<((FileId, FnId), SigId)>,
    /// `discriminatedContextualTypes`: the result of `discriminate_by_object_members` for an object
    /// literal and a union, if it's final.
    discriminated: FxHashMap<(FileId, ExprId, TypeId), TypeId>,
    /// Caches a `ConditionalRoot` per conditional type node, once the types of its check and extends nodes are final.
    conditional_roots: FxHashMap<(FileId, TypeNodeId), mapped::ConditionalRoot>,
    /// See `contextual_property_of_value`.
    contextual_properties: FxHashMap<(TypeId, Atom, Option<TypeId>), Option<TypeId>>,
    /// `resolvedApparentType` of an intersection, where the `this` argument is the intersection itself.
    apparent_types_of_intersections: shortcuts::TypeMap<TypeId>,
    /// `cachedTypes[CachedTypeKindApparentType]`, keyed by the intersection and a different `this` argument.
    apparent_types_with_this_argument: FxHashMap<(TypeId, TypeId), TypeId>,
    /// The diagnostics `resolveCall` has just reported. `resolved_signature` takes them, and stores
    /// them only together with the entry of `calls`.
    call_resolution_errors: Option<Vec<Reported>>,
    /// True if the call that `resolve_signature` is resolving was already being resolved.
    is_call_re_resolved: bool,
    /// The call whose arguments `resolveUntypedCall` is checking, if the call was already being
    /// resolved and its callee is `any`. See
    /// `contextually_check_function_expression_or_object_literal_method`.
    untyped_call_resolved_again: Option<(FileId, ExprId)>,
    /// The indices in `stack` of the parameters whose type `assignParameterType` is computing. It doesn't
    /// push a type resolution, so a cycle through such a parameter's initializer isn't the parameter's cycle.
    assigned_parameters: Vec<usize>,
    /// The patterns of the parameters whose `links.resolvedType` is `unknown` while
    /// `assignParameterType` computes the type of the pattern to replace it.
    assigned_unknown: Vec<(FileId, PatId)>,
    /// The functions whose first check is in progress, see `context_checked`. They're published to
    /// `Program::context_checked`, for every thread, only together with the results of the first check.
    /// A thread that found one without the other would continue without doing its own first check. The
    /// third field is the number of parameters for which `assignParameterType` has returned.
    context_checking: Vec<((FileId, crate::hir::FnId), AssignedSignature, usize)>,
    /// The functions whose entry in `Program::context_checked` this checker wrote or tried to
    /// write. See `is_context_checked`.
    context_checked_here: crate::util::FxHashSet<(FileId, crate::hir::FnId)>,
    /// The functions whose first check isn't published because a frame in progress is tainted, with the index and
    /// serial of the lowest such frame. tsgo sets `NodeCheckFlagsContextChecked` and assigns the parameter types no
    /// matter what's in progress. So until that frame is popped, the function counts as checked, with that signature.
    context_checked_under: Vec<(usize, u64, (FileId, crate::hir::FnId), AssignedSignature)>,
    /// `links.resolvedType` of an initializer that `checkExpressionCached` is checking, as assigned
    /// by a nested `checkExpressionCached` of the same initializer. Each entry is the index and
    /// serial of the outermost visit's frame, and the type. See `check_declaration_initializer`.
    initializers_resolved_by_nested_visit: Vec<(usize, u64, TypeId)>,
    /// The parameters of instantiated signatures, by index, whose `links.resolvedType` is assigned.
    /// `sig_params` computes the types of all parameters at once. See
    /// `note_parameter_types_resolved`.
    resolved_parameter_types: crate::util::FxHashSet<(SigId, u32)>,
    /// The `sig_params_with_first` lists that are missing a type, each with the number of
    /// parameters before the first one without a type.
    partial_sig_params: FxHashMap<SigId, (usize, &'p [SigParam])>,
    /// Pairs of a type and a union for which `is_empty_intersection` has looked up every property
    /// name of the type in the union, and the results are stored.
    listed_in_unions: crate::util::FxHashSet<(TypeId, TypeId)>,
    /// The results of `declared_parameter` for all parameters of a function, once `is_declared_parameter_settled`.
    declared_parameters: FxHashMap<(FileId, FnId), &'p [SigParam]>,
    /// Ranges of `stack`: the resolutions of declarations whose initializer
    /// `getQuickTypeOfExpression` is evaluating, and those of a `...rest`. See
    /// `is_flow_loop_visible`.
    quick_initializers: Vec<(usize, usize)>,
    /// `NodeCheckFlagsInCheckIdentifier`: the patterns for which `getNarrowedTypeOfSymbol` is in
    /// progress.
    in_check_identifier: Vec<(FileId, crate::hir::PatId)>,
    /// `resolvedSignature = result`, while `resolveCall` reports the errors of a call that no
    /// candidate accepts.
    resolved_meanwhile: Vec<(FileId, ExprId, call::ResolvedCall)>,
    /// `links.resolvedSignature` of a call that's being resolved, assigned by the first resolution
    /// nested in the outermost one that returns, if `Program::calls` doesn't accept that result.
    /// `getResolvedSignature` returns it instead of the result of each enclosing resolution.
    signatures_resolved_within: Vec<(FileId, ExprId, call::ResolvedCall)>,
    /// `cachedTypes[CachedTypeKindRestrictiveInstantiation][t] == t`: the conditional types that
    /// `getRestrictiveInstantiation` has returned.
    restrictive_instantiations: crate::util::FxHashSet<TypeId>,
    /// The type parameters that `getUniqueTypeParameters` renamed and whose constraint hasn't been
    /// requested since (`tp.constraint == nil`). They have no constraint declaration, so
    /// `getRestrictiveTypeParameter` returns such a type parameter unchanged.
    unresolved_renamed_params: crate::util::FxHashSet<TypeId>,
    /// `cachedTypes[CachedTypeKindRestrictiveInstantiation]` for the types in which a renamed type
    /// parameter was left unchanged. The entry stays when the constraint is requested later.
    pinned_restrictive_instantiations: crate::util::FxHashMap<TypeId, TypeId>,
    /// True if the restrictive instantiation in progress left such a type parameter unchanged.
    left_a_renamed_param_unchanged: std::cell::Cell<bool>,
    /// The argument whose generic signature `instantiateTypeWithSingleGenericCallSignature` is
    /// instantiating, and the depth of `stack` when it began. `currentNode` is still the argument.
    instantiating_generic_argument: Option<(FileId, ExprId, usize)>,
    /// Functions whose context `prepare_enclosing` has already prepared.
    prepared: crate::util::FxHashSet<(FileId, FnId)>,
    last_prepared: (FileId, FnId),
    /// A file, and which of its expressions `prepare_ancestors` has processed.
    prepared_exprs: (FileId, Vec<bool>),
    /// The stack pointer when the checker was created, and how far below that it may go.
    stack_base: usize,
    stack_limit: usize,
    /// Number of queries made so far.
    pub work: u64,
    /// Number of `begin_scope` calls so far for a result that's permanent once stored. It excludes
    /// the calls for a memo that evicts entries, like `FlowMemo::types_with_facts`, which begins
    /// another scope for the same question without computing anything new.
    scopes_begun: u64,
    /// `enter` takes its slow path when `work` reaches this value. It's the next value of `work`
    /// while `rejected_expressions` isn't empty, and `WORK_TRAP_DISARMED` otherwise.
    work_trap: u64,
    /// The file, start and end of the expressions in which a query was rejected for lack of native
    /// stack. See `reject_for_lack_of_stack`.
    rejected_expressions: Vec<(FileId, u32, u32)>,
    /// `is_side_effect_free` of the binary expressions with a long chain of binary expressions on their left.
    side_effect_free: std::cell::RefCell<FxHashMap<(FileId, ExprId), bool>>,
    /// `isContextSensitive` of the functions in a long chain where each function returns nothing but the next one.
    context_sensitive_functions: std::cell::RefCell<FxHashMap<(FileId, FnId), bool>>,
    /// How many functions it has visited.
    context_sensitivity_visits: std::cell::Cell<u64>,
    /// Set when a query was rejected for lack of stack. `enter` rejects every query while `stack` is
    /// higher than this. `usize::MAX` if no query was rejected. See `starts_over_from_lower`.
    unwind_to: usize,
    /// `work` of the next `enter` while unwinding. That `enter` takes the slow path (`work_trap`).
    unwind_work: u64,
    /// The innermost resolution that was in progress at the rejection. The frame at `unwind_to`
    /// resolves it and starts over.
    restart_with: Option<Query>,
}

/// Returns the thread's stack pointer minus a constant. Only the difference between two results is
/// used. `StackCheck` reads the register rather than the address of a local, because under a
/// sanitizer that detects use after return, locals whose address is taken aren't on the stack at all.
#[inline(always)]
fn stack_pointer() -> usize {
    // Without a bound, `remaining` counts from address 0.
    bun_core::StackCheck::default().remaining()
}

impl<'p, 's> Checker<'p, 's> {
    // ───────────────────────────── access ─────────────────────────────

    #[inline]
    pub fn hir(&self, file: FileId) -> &'p hir::File<'s> {
        self.files.hir(file)
    }

    #[inline]
    pub fn bound(&self, file: FileId) -> &'p Bound<'s> {
        self.files.bound(file)
    }

    #[inline]
    pub fn data(&self, ty: TypeId) -> &'p TypeData<'p> {
        self.types().get(ty)
    }

    /// A view of the published types plus the task-local ones, which is everything the task sees.
    #[inline(always)]
    pub fn types(&self) -> Types<'p, 's> {
        Types::new(&self.p.types, &self.task.own)
    }

    #[inline]
    pub fn atoms(&self) -> Atoms<'p, 's> {
        Atoms::new(&self.p.files.atoms, &self.task.own)
    }

    #[inline]
    pub fn intern(&self, data: TypeData<'s>) -> TypeId {
        self.types().intern(data)
    }

    /// `intern` for a type with lists, which are copied to the arena only if the type is new.
    #[inline]
    pub fn intern_key(&self, key: TypeKey<'_>) -> TypeId {
        self.types().intern_key(key)
    }

    /// `intern_key`. For `first_request`, see `Types::as_first_request`.
    #[inline]
    fn intern_key_as(&self, key: TypeKey<'_>, first_request: FirstRequest) -> TypeId {
        let types = self.types();
        types.as_first_request(first_request, || types.intern_key(key))
    }

    /// Copies `items` into the arena, to store in a type, a signature or a table value.
    #[inline]
    pub fn list<T: Copy>(&self, items: &[T]) -> ArenaBox<'s, [T]> {
        ArenaBox::copy_from_slice_in(items, self.arena)
    }

    #[inline]
    pub fn list_of<T>(&self, items: impl IntoIterator<Item = T>) -> ArenaBox<'s, [T]> {
        ArenaBox::from_iter_in(items, self.arena)
    }

    #[inline]
    pub fn boxed<T>(&self, value: T) -> ArenaBox<'s, T> {
        ArenaBox::new_in(value, self.arena)
    }

    /// `IndexInfo.components`
    #[inline]
    pub fn index_components(&self, id: ComponentsId) -> &'p [IndexComponent] {
        self.types().components(id)
    }

    /// Returns the type parameter `tp` of `file`, as declared.
    #[inline]
    pub fn type_param(&self, file: FileId, tp: TypeParamId) -> TypeId {
        let recent = &self.recent_type_params[tp.0 as usize % RECENT_TYPE_PARAMS];
        if recent.get().0 == (file, tp) {
            return recent.get().1;
        }
        let declared = match self.p.declared_type_params.get(&self.task, &(file, tp)) {
            Some(cached) => cached,
            None => self.intern_type_param(file, tp),
        };
        recent.set(((file, tp), declared));
        declared
    }

    #[inline(never)]
    fn intern_type_param(&self, file: FileId, tp: TypeParamId) -> TypeId {
        use crate::bind::{Decl::TypeParam, ScopeKind};
        // `getDeclaredTypeOfTypeParameter(getSymbolOfDeclaration(tp))`: the declarations of a class
        // or an interface declare their type parameters in `symbol.Members`, so type parameters
        // with the same name are one symbol and one type.
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
        let created = self.intern(TypeData::TypeParam(of, first, MapperId::IDENTITY));
        (self.p.declared_type_params).insert(&self.task, (file, tp), created, Stored::new())
    }

    /// `cloneTypeParameter`: the type parameter `tp` of a signature found where the signature's outer
    /// type parameters are mapped by `outer_mapper`. With an identity mapping nothing was instantiated, so
    /// it's the declared type parameter (`resolveObjectTypeMembers`, `getObjectTypeInstantiation`).
    pub fn cloned_type_param(
        &self,
        file: FileId,
        tp: TypeParamId,
        outer_mapper: MapperId,
    ) -> TypeId {
        let outer_mapper = if self
            .types()
            .mapping(outer_mapper)
            .iter()
            .all(|p| p.0 == p.1)
        {
            MapperId::IDENTITY
        } else {
            outer_mapper
        };
        self.intern(TypeData::TypeParam(file, tp, outer_mapper))
    }

    #[inline]
    fn files(&self) -> &'p Files<'s> {
        self.files
    }

    // ───────────────────────────── queries in progress ─────────────────────────────

    /// Sets which diagnostics `check_file` computes from now on.
    pub fn set_requested(&mut self, expected: Requested) {
        self.expected = expected;
    }

    /// True if there's little stack left for recursion.
    #[inline]
    pub(crate) fn is_stack_low(&self) -> bool {
        let used = self.stack_base.saturating_sub(stack_pointer());
        self.deepest_stack.set(used.max(self.deepest_stack.get()));
        if used > self.stack_limit {
            cold_path();
            self.ran_out_of_stack.set(true);
            self.times_cut_short.set(self.times_cut_short.get() + 1);
            self.note_gave_up();
            return true;
        }
        false
    }

    /// `is_stack_low` for the printer. The printer elides what's nested too deeply, which doesn't
    /// drop an error, so this doesn't count as running out of stack. The threshold leaves enough
    /// stack for the queries that the printer makes.
    #[inline]
    pub(crate) fn is_stack_low_for_printing(&self) -> bool {
        self.stack_base.saturating_sub(stack_pointer()) > self.stack_limit - self.stack_limit / 8
    }

    /// True if half of the stack that queries may use is in use. It's for a recursion that
    /// typescript-go ends at `instantiationCount`, on a stack that grows.
    #[inline]
    pub(crate) fn is_half_of_stack_in_use(&self) -> bool {
        self.stack_base.saturating_sub(stack_pointer()) > self.stack_limit / 2
    }

    /// True if three quarters of the stack that queries may use are in use. A chain of declarations
    /// starts over at this point (`starts_over_from_lower`), while there's still stack for the
    /// recursion between two queries, which only checks `is_stack_low`.
    #[inline]
    pub(crate) fn is_most_of_stack_in_use(&self) -> bool {
        self.stack_base.saturating_sub(stack_pointer()) > self.stack_limit - self.stack_limit / 4
    }

    /// Returns the most stack in use at any query.
    pub fn deepest_stack(&self) -> usize {
        self.deepest_stack.get()
    }

    /// Returns false if the query is already in progress further down the stack.
    #[inline]
    fn enter(&mut self, q: Query) -> bool {
        self.work += 1;
        self.found_cycle = false;
        if (self.work == self.work_trap || self.is_stack_low()) && self.reject_for_lack_of_stack(q)
        {
            return false;
        }
        let class = (crate::util::fx_hash(&q) >> 54) as u16;
        let from = self.resolution_start;
        // `checkExpression` and `checkPropertyAssignment` have no re-entrancy guard, so an uncached
        // check runs again while it's in progress.
        if !(matches!(q, Query::Expr(..) | Query::LiteralProp(..)) && self.is_rechecking())
            && self.in_progress[class as usize] != 0
            && let Some(i) = self.position_in_progress(q, from)
            && self.on_reentry(q, i + from)
        {
            return false;
        }
        if self.is_most_of_stack_in_use() && self.starts_over_from_lower(q) {
            return false;
        }
        self.last_enter = EnterOutcome::Entered;
        if self.stack.is_empty() {
            self.reset_instantiation_count_if_idle();
        }
        self.stack.push(q);
        self.in_progress[class as usize] += 1;
        // A query made under a context that a non-cacheable query has pushed is non-cacheable too.
        let tainted = !self.inference_contexts.is_empty() && self.is_innermost_tainted();
        // Diagnostics reported under a loop in progress are kept (`taint_from`).
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
            is_stored_by_nested_visit: false,
            has_read_members_in_place: false,
            may_substitute_constraints: false,
            is_quick_type: false,
            source_element: self.current_source_element,
            held_back: self.task.held_back(),
        });
        true
    }

    /// Returns the position of the innermost `q` in `stack[from..]`.
    #[cold]
    #[inline(never)]
    fn position_in_progress(&self, q: Query, from: usize) -> Option<usize> {
        self.stack[from..].iter().rposition(|x| *x == q)
    }

    /// The slow path of the first test in `enter`. Returns false if `q` isn't rejected.
    ///
    /// After a rejection no query in flight is cacheable. Every later query about a part of the same
    /// expression or type node would descend the same chain and be rejected again, which costs depth^3
    /// for nested calls. So the outermost one in flight is recorded, and until the end of `check_file`
    /// every query about an expression or a type node inside it is rejected immediately.
    #[cold]
    #[inline(never)]
    fn reject_for_lack_of_stack(&mut self, q: Query) -> bool {
        if self.unwind_to != usize::MAX {
            if self.work == self.unwind_work && self.stack.len() > self.unwind_to {
                self.unwind_work = self.work + 1;
                self.work_trap = self.work + 1;
                self.last_enter = EnterOutcome::Rejected;
                self.bailed_out_from(self.unwind_to);
                return true;
            }
            // The frame has been popped, and it isn't one that starts over.
            self.unwind_to = usize::MAX;
            self.restart_with = None;
        }
        let is_low = self.is_stack_low();
        if is_low {
            self.reject_outermost_in_flight(q);
            // Not every query is about an expression or a type node. One that continues regardless ends up here again.
            self.unwind_to = 0;
            self.unwind_work = self.work + 1;
            self.restart_with = None;
        }
        // Every later `enter` takes this path.
        self.work_trap = if self.rejected_expressions.is_empty() && !is_low {
            WORK_TRAP_DISARMED
        } else {
            self.work + 1
        };
        if !is_low && !self.is_rejected(q) {
            return false;
        }
        self.last_enter = EnterOutcome::Rejected;
        self.bailed_out();
        true
    }

    /// Returns the file, start and end of the expression or type node that `q` is about.
    fn span_of_query(&self, q: Query) -> Option<(FileId, u32, u32)> {
        match q {
            Query::Expr(file, e) | Query::Call(file, e) => {
                Some((file, self.start_of(file, e), self.end_of_expr(file, e)))
            }
            Query::TypeNode(file, node) => {
                let node = &self.hir(file)[node];
                Some((file, node.pos, node.end.max(node.pos)))
            }
            _ => None,
        }
    }

    fn is_in_rejected_expression(&self, (file, start, end): (FileId, u32, u32)) -> bool {
        let contains =
            |outer: &(FileId, u32, u32)| outer.0 == file && outer.1 <= start && end <= outer.2;
        self.rejected_expressions.iter().any(contains)
    }

    /// True if `q` is about part of one of the `rejected_expressions`.
    fn is_rejected(&self, q: Query) -> bool {
        !self.rejected_expressions.is_empty()
            && (self.span_of_query(q)).is_some_and(|span| self.is_in_rejected_expression(span))
    }

    /// Adds the outermost expression or type node in flight to `rejected_expressions`. `q` is the innermost.
    fn reject_outermost_in_flight(&mut self, q: Query) {
        let mut in_flight = self.stack.iter().chain([&q]);
        let outermost = in_flight.find_map(|&q| Some((q, self.span_of_query(q)?)));
        if let Some((outermost, span)) = outermost
            && !self.is_in_rejected_expression(span)
        {
            let span = match outermost {
                Query::TypeNode(..) => self.enclosing_statement_span(span),
                _ => span,
            };
            self.rejected_expressions.push(span);
        }
    }

    /// Returns the span of the top-level statement that contains `span`. That's what is rejected for a type node.
    ///
    /// `checkSourceElement` isn't a query, and it requests a type node's type after visiting the node's
    /// children. So the outermost type node in flight is the one it has just returned to, and the next
    /// one it returns to encloses that. That one would descend to the rejected node and be cut short,
    /// then the one around it, and so on, which costs depth^2, and more with the search in `stack`.
    fn enclosing_statement_span(&self, span: (FileId, u32, u32)) -> (FileId, u32, u32) {
        let hir = self.hir(span.0);
        let mut statements = hir.ids(hir.body).map(|s| hir[s].loc);
        match statements.find(|loc| (loc.pos..loc.end).contains(&span.1)) {
            Some(loc) => (span.0, loc.pos, loc.end.max(span.2)),
            None => span,
        }
    }

    /// Called when `is_most_of_stack_in_use` and `q` would use more. tsgo has a stack that grows.
    /// Returns true if `q` is rejected.
    ///
    /// A variable's type, a function's return type and a symbol's declared type are the same from any stack
    /// height, as long as nothing in progress is a context for them. In that case the outermost such frame
    /// resolves the innermost one from its own height, where it can use the stack that the frames in
    /// between took, and then starts over (`retry_too_deep_query`). The frames below it don't see a
    /// rejection. A cycle that needs more stack than there is never closes, and is rejected again.
    ///
    /// None of the frames in between cache their result. A frame that continued regardless would recompute,
    /// from its lower height, what the frames above it couldn't finish, and a chain of functions that's n
    /// links too long would cost n^3. So every query is rejected until `stack` is back at `unwind_to`.
    ///
    /// Anything else continues with the stack that's left. See `reject_for_lack_of_stack`.
    #[cold]
    #[inline(never)]
    fn starts_over_from_lower(&mut self, q: Query) -> bool {
        let starts_over =
            |q: &Query| matches!(q, Query::Symbol(_) | Query::Return(..) | Query::Declared(_));
        let has_no_context = self.flow_loops.is_empty()
            && self.inference_contexts.is_empty()
            && self.eager.is_empty()
            && self.contextual_binding_patterns.is_empty()
            && self.printing_floors.is_empty()
            && self.assigned_parameters.is_empty()
            && self.context_checking.is_empty()
            && self.context_checked_under.is_empty();
        let outermost = self.stack.iter().position(starts_over);
        let innermost = match starts_over(&q) {
            true => Some(q),
            false => self.stack.iter().rev().find(|q| starts_over(q)).copied(),
        };
        let (Some(outermost), Some(innermost)) = (outermost, innermost) else {
            return false;
        };
        if !has_no_context || self.stack[outermost] == innermost {
            return false;
        }
        bun_core::scoped_log!(
            SemaCycles,
            "too deep: {:?}",
            &self.stack[self.stack.len().saturating_sub(12)..]
        );
        self.last_enter = EnterOutcome::Rejected;
        self.unwind_work = self.work + 1;
        self.work_trap = self.work + 1;
        self.unwind_to = outermost;
        self.restart_with = Some(innermost);
        self.bailed_out_from(outermost);
        true
    }

    /// Call after the `leave` of a `Query::Symbol`, a `Query::Return` or a `Query::Declared`, if
    /// `stack.len() == unwind_to`. Returns true if the caller should start over because the query
    /// that `starts_over_from_lower` rejected now has a result.
    #[cold]
    #[inline(never)]
    fn retry_too_deep_query(&mut self) -> bool {
        // Every `enter` since the rejection was rejected in turn.
        let is_unwinding = self.unwind_work == self.work + 1;
        let restart_with = self.restart_with.take().filter(|_| is_unwinding);
        self.unwind_to = usize::MAX;
        self.work_trap = if self.rejected_expressions.is_empty() {
            WORK_TRAP_DISARMED
        } else {
            self.work + 1
        };
        let is_resolved = match restart_with {
            Some(Query::Symbol(sym)) => {
                self.type_of_symbol(sym);
                self.p.symbol_types.get(&self.task, &sym).is_some()
            }
            Some(Query::Declared(sym)) => {
                self.declared_type(sym);
                self.p.declared_types.get(&self.task, &sym).is_some()
            }
            Some(Query::Return(file, func)) => {
                self.return_type_of_fn(file, func);
                let key = (file, func);
                self.p.fn_return_types.get(&self.task, &key).is_some()
            }
            _ => return false,
        };
        if !is_resolved {
            self.ran_out_of_stack.set(true);
            self.bailed_out();
        }
        is_resolved
    }

    /// Called when the checker has come back around to `stack[i]`. Calls `Task::close_cycle`, unless the ring
    /// gives the same result no matter where it's entered. tsgo goes around until it reaches a member that it
    /// guards. Type syntax and conditional types have no guard, so a ring with only one other member closes at
    /// that member, wherever it was entered. And base constraints that lead to each other are all circular.
    pub(super) fn close_ring_from(&self, i: usize) {
        let mut guarded = self.stack[i..].iter().filter(|&&q| is_guarded(q));
        let are_constraints = matches!(guarded.next(), Some(Query::Constraint(_)));
        if guarded.any(|q| !are_constraints || !matches!(q, Query::Constraint(_))) {
            self.close_cycle(i);
        }
    }

    /// Calls `Task::close_cycle` for a cycle whose queries are all in `stack[from..]`.
    pub(super) fn close_cycle(&self, from: usize) {
        let members = self.stack[from..].iter().map(crate::util::fx_hash);
        (self.task).close_cycle(|| self.is_reachable_only_by_importers(from), members);
    }

    /// True if only files that import the current file can run any query in `stack[from..]`.
    ///
    /// That's the case when every query is about, or mentions, a declaration in the current file's import cycle
    /// (`Components`), and those files declare nothing global. An importer comes after the files it imports in program
    /// order, unless they import each other.
    fn is_reachable_only_by_importers(&self, from: usize) -> bool {
        let (files, Some(visited)) = (self.files(), self.task.file) else {
            return false;
        };
        let component_of = |file: FileId| files.components.of_file.get(file.idx());
        let is_near = |file: FileId| {
            component_of(file) == component_of(visited) && files.module(file).is_closed
        };
        let mut mentioned = Mentioned {
            is_near: &is_near,
            is_found: false,
            seen: Default::default(),
            to_visit: Vec::new(),
        };
        self.stack[from..].iter().all(|&q| {
            mentioned.is_found = q.syntax().is_some_and(is_near);
            match q {
                Query::Shape(ty)
                | Query::Properties(ty)
                | Query::Constraint(ty)
                | Query::InferredConstraint(ty)
                | Query::TypeArguments(ty)
                | Query::MappedProp(ty, _) => mentioned.ty(ty),
                Query::ReturnOfSignature(signature) => mentioned.sig(signature),
                Query::Cond(_, _, mapper) => mentioned.mapper(mapper),
                Query::AliasTarget(alias) => mentioned.file(alias.file),
                Query::WriteType(file, _) => mentioned.file(file),
                _ => {}
            }
            while let Some(record) = mentioned.to_visit.pop().filter(|_| !mentioned.is_found) {
                match record {
                    Mention::Type(ty) => self.data(ty).visit(&mut mentioned),
                    Mention::Signature(signature) => {
                        self.types().sig(signature).visit(&mut mentioned)
                    }
                    Mention::Mapper(mapper) => {
                        for &(from, to) in self.types().mapping(mapper) {
                            mentioned.ty(from);
                            mentioned.ty(to);
                        }
                    }
                    Mention::Components(list) => {
                        self.types().components(list).visit(&mut mentioned)
                    }
                }
            }
            mentioned.to_visit.clear();
            mentioned.seen.clear();
            mentioned.is_found
        })
    }

    /// Like `close_ring_from`, for in-progress state that isn't a query and was started when `stack` had
    /// `height` entries. tsgo silently continues with the partial state. If it had entered the cycle at
    /// one of the resolutions in between, it would have reported a circular reference there instead.
    pub(super) fn close_cycle_above(&self, height: usize) {
        self.task.hold_back();
        if self.stack[height..].iter().any(|&q| self.is_resolution(q)) {
            self.close_cycle(height);
        }
    }

    /// Handles an `enter` of a `q` that's in progress at `stack[i]`. Returns false if `q` is restarted.
    #[cold]
    #[inline(never)]
    fn on_reentry(&mut self, q: Query, i: usize) -> bool {
        self.close_ring_from(i);
        // `findResolutionCycleStartIndex` doesn't search below a resolution that has its result, so
        // the query is restarted and arrives at that result.
        if self.is_resolution(q) && self.is_resolved_since(i) {
            return false;
        }
        // `assignParameterType` and `assignBindingElementTypes` don't push a type resolution, and
        // they assign `links.resolvedType` at the end. A request in the meantime resolves the
        // declaration itself. That doesn't apply to a request that tsgo might not make (`eager`).
        if self.assigned_parameters.contains(&i) && !self.is_behind_barrier(i + 1) {
            return false;
        }
        // `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` sets `NodeCheckFlagsContextChecked` before it
        // assigns the parameter types. So the function expression is checked again and gets its type immediately.
        if self.is_function_in_context_check(q) {
            return false;
        }
        // `getConditionalTypeInstantiation` has no re-entrancy check and caches its result only when it
        // returns, so the conditional type is evaluated again. The recursion ends at a type resolution
        // that detects a cycle, at members that are already installed, or at an instantiation limit.
        if matches!(q, Query::Cond(..)) {
            return false;
        }
        // `getDeclaredTypeOfEnum`, `getDeclaredTypeOfEnumMember` and `getTypeOfEnumMember` have no
        // re-entrancy check either. The second visit uses the values that `computeEnumMemberValues`
        // has assigned so far (`enum_values_in_progress`).
        let is_enum_query = match q {
            Query::Declared(sym) => {
                let flags = self.files().flags(sym);
                flags.intersects(SymFlags::ENUM | SymFlags::ENUM_MEMBER)
            }
            Query::Symbol(sym) => self.files().flags(sym).contains(SymFlags::ENUM_MEMBER),
            _ => false,
        };
        if is_enum_query && !self.is_resolution(q) {
            return false;
        }
        // Neither does `getTypeFromTypeNode`. The result gets one more level per round, up to the limit.
        if matches!(q, Query::TypeNode(..)) && self.is_runaway(i) {
            return false;
        }
        // `checkExpression`, `checkPropertyAssignment`, `getTypeFromTypeNode` and, for a declaration
        // whose name is a pattern, `getTypeForVariableLikeDeclaration` have no re-entrancy guard. The
        // second visit doesn't close a cycle if it ends in one of these ways:
        // - It gets `any` for the return type that's being resolved.
        // - It does without the base constraint that's being resolved.
        // - It finds the members in place, the intersection as is, no equivalent base type, or a
        //   function that gets its type immediately.
        // - It's below a stale entry, where `findResolutionCycleStartIndex` stops.
        // - It reaches the `typeToStringEx` call that led here, with no type resolution on the way, and
        //   prints one serialization level higher. That can close a cycle through what the first call
        //   is resolving. At `maxSerializationLevel` the printer returns "?" and resolves nothing.
        let first_printing = self.printing_floors.iter().find(|&&floor| floor > i);
        let is_through_printing = first_printing
            .is_some_and(|&floor| !self.stack[i..floor].iter().any(|&q| self.is_resolution(q)));
        if matches!(
            q,
            Query::Expr(..) | Query::LiteralProp(..) | Query::TypeNode(..) | Query::Pat(..)
        ) && !self.is_resolution(q)
            && (is_through_printing && !self.reprinting
                || self.ends_at_non_circular_return(i)
                || self.ends_at_array_or_tuple_constraint(i)
                || self.ends_at_members_in_place(i)
                || self.ends_at_reduction_in_progress(i)
                || self.ends_at_reverse_mapped_inference_in_progress(i)
                || self.ends_at_default_in_progress(i)
                || self.ends_at_identical_base_type_in_progress(i)
                || self.ends_at_function_in_context_check(i)
                || self.is_below_stale_resolution(i))
        {
            return false;
        }
        // `resolveIntersectionTypeMembers` has no guard either, and calls `setStructuredTypeMembers` at the end.
        // The same goes for `getPropertiesOfUnionOrIntersectionType`, which sets `resolvedProperties` at the end.
        if matches!(q, Query::Shape(ty) | Query::Properties(ty) if matches!(self.data(ty), TypeData::Intersection(_)))
            && self.ends_at_reduction_in_progress(i)
        {
            return false;
        }
        self.last_enter = EnterOutcome::Rejected;
        // Everything in progress between there and here is computed without the result, so it's provisional.
        let from = i + usize::from(!self.is_requested_eagerly(i));
        // The exception is a repeated request for base types. `getBaseTypes` ends by resetting the
        // members of the class or interface itself, and whatever else was resolved stays. In
        // `interface D extends M<D>`, that's the members that `M<D>` got from `D` without a base type.
        let from = match q {
            Query::Bases(sym) => {
                // `t.objectFlags &^= ObjectFlagsMembersResolved` applies only to the declared type.
                // Its shape can also be keyed with the declared type as the `this` argument.
                let declared = self.p.declared_types.get(&self.task, &sym).map(|it| it.0);
                let own_arguments = declared.and_then(|declared| match self.data(declared) {
                    TypeData::Ref { args, .. } => args.actual(),
                    _ => None,
                });
                let is_own = |f: &Query| {
                    let Query::Shape(t) = *f else { return false };
                    let TypeData::Ref { target, args } = self.data(t) else {
                        return false;
                    };
                    *target == sym
                        && (declared.is_none_or(|declared| declared == t)
                            || matches!((args.actual(), own_arguments), (Some(args), Some(own))
                                if args.split_last() == declared.as_ref().map(|this| (this, own))))
                };
                let own = self.stack[from..].iter().rposition(is_own);
                own.map_or(self.stack.len(), |above| from + above)
            }
            _ => from,
        };
        if from < self.stack.len() {
            let lowest_taint = self.lowest_taint;
            self.mark_tainted_from(from);
            // A comparison that requested those members began below them, so its result stays.
            if matches!(q, Query::Bases(_)) {
                self.lowest_taint = lowest_taint.min(from + 1);
            }
        }
        // TypeScript doesn't detect an expression that's rechecked while it's being checked. It follows
        // the same path again, and the first resolution on that path becomes circular. A call that's
        // queried for an argument's contextual type while it's being resolved is different
        // (`resolvingSignature`): the caller gets no result, and that isn't an error. The same holds
        // for members that are already installed, and for a path that leads to `typeToStringEx` first.
        let marked = !self.ends_at_members_in_place(i)
            && (self.is_resolution(q) || !is_through_printing)
            && self.mark_cycle_from(i);
        self.found_cycle = marked && self.is_resolution(q);
        if self.has_members_in_place(q) {
            self.note_members_in_place();
        } else {
            self.note_cycle();
        }
        self.task.closed_a_cycle = true;
        bun_core::scoped_log!(SemaCycles, "cycle: {:?}", &self.stack[i..]);
        // `checkExpression` has no re-entrancy guard. The expression is checked again, up to the resolution
        // on that path that has just become circular, which is `any` there. So when a call is resolved
        // again, its callee has its type and its arguments have their contextual types. See
        // `recheck_in_flow_loop` for a path that ends at a visible loop. `getTypeFromTypeNode` has no guard
        // either, so the node has its type for the next request. Neither do `checkPropertyAssignment` and,
        // for a declaration whose name is a pattern, `getTypeForVariableLikeDeclaration`.
        let restarts = matches!(
            q,
            Query::Expr(..) | Query::TypeNode(..) | Query::Pat(..) | Query::LiteralProp(..)
        ) && !self.is_resolution(q);
        !(marked && restarts && self.frames[i + 1..].iter().any(|frame| frame.circular))
    }

    /// True if `q` requests the members of a type literal, of a function, class, enum or module as a value,
    /// or of a mapped type. For a type literal, `resolveAnonymousTypeMembers` begins with
    /// `setStructuredTypeMembers(t, nil, nil, nil, nil)`. `resolveAnonymousTypeMembers` calls
    /// `setStructuredTypeMembers` before it requests the base constructor type or a signature, and
    /// `resolveMappedTypeMembers` before anything else ("such that recursive references see an empty object
    /// type"). So for any caller in the meantime, `resolveStructuredTypeMembers` returns immediately.
    fn has_members_in_place(&self, q: Query) -> bool {
        matches!(q, Query::Shape(ty) if matches!(
            self.data(ty),
            TypeData::Anon {
                origin: Origin::TypeLiteral(..)
                    | Origin::ClassStatic(_)
                    | Origin::Function(_)
                    | Origin::EnumObject(_)
                    | Origin::Module(_)
                    | Origin::GlobalThis
                    | Origin::Mapped(..),
                ..
            }
        ))
    }

    /// True if the first resolution on the path from `stack[i]` is a return type that
    /// `getNonCircularReturnTypeOfSignature` or `getContextualReturnType` has requested.
    fn ends_at_non_circular_return(&self, i: usize) -> bool {
        !self.non_circular_returns.is_empty()
            && (self.stack[i..].iter().position(|&q| self.is_resolution(q))).is_some_and(|above| {
                matches!(
                    self.stack[i + above],
                    Query::Return(..) | Query::ReturnOfSignature(_)
                ) && self.non_circular_returns.contains(&(i + above))
            })
    }

    /// True if the first resolution on the path from `stack[i]` is a base constraint that `instantiateMappedType`
    /// has requested. It doesn't request one that `findResolutionCycleStartIndex` finds.
    fn ends_at_array_or_tuple_constraint(&self, i: usize) -> bool {
        !self.array_or_tuple_constraint_requests.is_empty()
            && (self.stack[i..].iter().position(|&q| self.is_resolution(q))).is_some_and(|above| {
                matches!(self.stack[i + above], Query::Constraint(_))
                    && (self.array_or_tuple_constraint_requests).contains(&(i + above))
            })
    }

    /// True if repeating the path from `stack[i]` ends before it reaches a resolution, at an
    /// intersection whose properties `getReducedType` is examining. `getReducedType` sets
    /// `ObjectFlagsIsNeverIntersectionComputed` first, and returns the intersection the next time.
    fn ends_at_reduction_in_progress(&self, i: usize) -> bool {
        if self.never_in_progress_from.is_empty() {
            return false;
        }
        let resolution = self.first_resolution_from(i);
        let mut began = self.never_in_progress_from.iter();
        began.any(|&height| height > i && height <= resolution)
    }

    /// True if repeating the path from `stack[i]` ends before it reaches a resolution, at an
    /// `inferReverseMappedType` whose worker is running. The next one for the same source and
    /// target has both `reverseExpandingFlags` and infers nothing.
    fn ends_at_reverse_mapped_inference_in_progress(&self, i: usize) -> bool {
        if self.reverse_mapped_inferences_from.is_empty() {
            return false;
        }
        let resolution = self.first_resolution_from(i);
        let mut began = self.reverse_mapped_inferences_from.iter();
        began.any(|&height| height > i && height <= resolution)
    }

    /// Returns the index in `stack` of the first resolution from `stack[i]` up, or `stack.len()` if there is none.
    fn first_resolution_from(&self, i: usize) -> usize {
        let mut from_here = self.stack[i..].iter();
        let resolution = from_here.position(|&q| self.is_resolution(q));
        resolution.map_or(self.stack.len(), |at| i + at)
    }

    /// True if repeating the path from `stack[i]` ends before it reaches a resolution, at a type
    /// parameter whose default is being resolved. `getResolvedTypeParameterDefault` assigns
    /// `resolvingDefaultType` first, and returns `circularConstraintType` the next time.
    fn ends_at_default_in_progress(&self, i: usize) -> bool {
        if self.defaults_in_progress.is_empty() {
            return false;
        }
        let resolution = self.first_resolution_from(i);
        let mut began = self.defaults_in_progress.iter();
        began.any(|&(_, height, _)| height > i && height <= resolution)
    }

    /// True if repeating the path from `stack[i]` ends before it reaches a resolution, at a type
    /// reference whose base types `getSingleBaseForNonAugmentingSubtype` has requested. It sets
    /// `ObjectFlagsIdenticalBaseTypeCalculated` first, and returns nil the next time.
    fn ends_at_identical_base_type_in_progress(&self, i: usize) -> bool {
        if self.identical_base_types_in_progress.is_empty() {
            return false;
        }
        let resolution = self.first_resolution_from(i);
        let mut began = self.identical_base_types_in_progress.iter();
        began.any(|&(_, height)| height > i && height <= resolution)
    }

    /// True if `q` is the check of a function expression or of a method of an object literal for
    /// which `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` has set
    /// `NodeCheckFlagsContextChecked` and hasn't returned.
    fn is_function_in_context_check(&self, q: Query) -> bool {
        matches!(q, Query::Expr(file, e)
            if matches!(self.hir(file)[e].kind, ExprKind::Fn(func)
                if self.context_checking.iter().any(|c| c.0 == (file, func))))
    }

    /// True if repeating the path from `stack[i]` ends before it reaches a resolution, at such a
    /// function. It gets its type immediately, and neither its parameters nor its return type are
    /// requested again. False for a request that tsgo might not make (`eager`).
    fn ends_at_function_in_context_check(&self, i: usize) -> bool {
        if self.context_checking.is_empty() || self.eager.iter().any(|&from| from > i) {
            return false;
        }
        let resolution = self.first_resolution_from(i);
        let mut before_first_resolution = self.stack[i..resolution].iter();
        before_first_resolution.any(|&q| self.is_function_in_context_check(q))
    }

    /// True if repeating the path from `stack[i]` ends before it reaches a resolution, at members
    /// that are already installed or at the values of an enum declaration that are being computed.
    fn ends_at_members_in_place(&self, i: usize) -> bool {
        let before_first_resolution = self.stack[i..]
            .iter()
            .take_while(|&&q| !self.is_resolution(q));
        before_first_resolution.enumerate().any(|(above, &q)| {
            // `resolveDeclaredMembers` has them in place while it resolves the index signatures,
            // and `getResolvedMembersOrExportsOfSymbol` has the early-bound ones in place while it
            // binds the rest. `computeEnumMemberValues` has set `NodeCheckFlagsEnumValuesComputed`.
            self.has_members_in_place(q)
                || matches!(q, Query::Enum(..))
                || (self.declared_index_infos_in_progress.iter()).any(|it| it.0 == i + above + 1)
                || self.late_binding.iter().any(|it| it.0 == i + above + 1)
        })
    }

    /// True if re-entering `stack[i]` is a recursion that tsgo doesn't detect. `getTypeFromTypeNode`,
    /// `getTypeAliasInstantiation` and `getConditionalType` don't push a type resolution and cache their result
    /// only when they return, so a cycle that consists only of type nodes and conditional types runs into an
    /// instantiation limit. tsgo ends the cycle where it defers a type reference
    /// (`getObjectTypeInstantiation`), which here is an `instantiate` nested in the reference's `instantiate`.
    fn is_runaway(&self, i: usize) -> bool {
        let (cycle, frames) = (&self.stack[i..], &self.frames[i..]);
        cycle
            .iter()
            .all(|q| matches!(q, Query::TypeNode(..) | Query::Cond(..)))
            // Every round adds an instantiation level. That can happen without a conditional type,
            // because `instantiateMappedArrayType` instantiates the template immediately.
            && (cycle.iter().any(|q| matches!(q, Query::Cond(..)))
                || self.instantiation_depth > frames[0].entry_depth)
            && (frames.iter().zip(&frames[1..])).all(|(a, b)| b.entry_depth <= a.entry_depth + 1)
            && frames
                .last()
                .is_some_and(|last| self.instantiation_depth <= last.entry_depth + 1)
    }

    /// True if the query at `stack[i]` is itself one that TypeScript wouldn't have made there (`eager`). What it finds
    /// in progress differs from what TypeScript finds where it does make the query. For example, the parameter types of
    /// `a` are computed for `a()` behind the barrier of `getResolvedSignature`, and TypeScript requests one after that
    /// call has returned. So a cycle that closes at this query isn't marked, and the query has no result either.
    fn is_requested_eagerly(&self, i: usize) -> bool {
        self.eager.contains(&i) && !self.loop_values.contains(&i)
    }

    /// `pushTypeResolution` when the query is already in progress at `i`. Every resolution from
    /// there up is in the cycle and resolves to `any`. Returns false and marks nothing if
    /// TypeScript doesn't search that far down, or wouldn't have made the query.
    fn mark_cycle_from(&mut self, i: usize) -> bool {
        if i < self.resolution_start || self.is_resolved_since(i) {
            return false;
        }
        // Every entry of `loop_values` is an entry of `eager` too.
        let barriers = self.eager.iter().filter(|&&from| from > i).count();
        let loop_values = self.loop_values.iter().filter(|&&from| from > i).count();
        if self.is_requested_eagerly(i)
            || barriers > loop_values
            || barriers > 0 && !self.is_cycle_of_initializers(i)
        {
            self.unmarked_rejections += 1;
            return false;
        }
        for j in i..self.stack.len() {
            let q = self.stack[j];
            if !self.is_resolution(q) || j != i && self.assigned_parameters.contains(&j) {
                continue;
            }
            if !self.frames[j].circular {
                bun_core::scoped_log!(SemaCycles, "CIRCLE {:?} in {:?}", q, &self.stack[i..]);
            }
            self.frames[j].circular = true;
        }
        for in_progress in &mut self.mapped_constraints_in_progress {
            in_progress.2 |= in_progress.1 > i;
        }
        true
    }

    /// The end of `getTypeOfMappedSymbol`, where `popTypeResolution` finds the cycle. Reports 2615 at `c.currentNode`.
    pub(super) fn circular_mapped_property(
        &mut self,
        mapped: TypeId,
        name: Atom,
        reentered_through_members: bool,
    ) {
        // `resolveMappedTypeMembers` resolves the constraint `keyof R` first, and
        // `resolveReverseMappedTypeMembers` resolves the type of every property of `R`'s source.
        // tsgo finds a cycle through one of those there, with no mapped symbol in progress.
        if reentered_through_members
            && (self.types().object_flags(mapped)).contains(ObjectFlags::HAS_REVERSE_MAPPED)
        {
            return;
        }
        let at = match self.current_node().or(self.current_source_element) {
            Some(current) => self.span_of_current_node(current),
            // A check after `check_source_file`. See `error_at_current_node`.
            None => match self.outermost_comparison.flatten() {
                Some(error_node) => error_node,
                None => return,
            },
        };
        let property = match self.prop_ref(mapped, name) {
            Some((prop, _)) => Arg::Prop(prop),
            None => Arg::Atom(name),
        };
        let diagnostic = self.new_diagnostic(at, 2615, &[property, Arg::Type(mapped)]);
        // The id of `mapped` can be task-local, and each task is at a different node.
        let declaration = self.mapped_origin(mapped).map(|it| (it.0, it.1));
        let entry = crate::util::fx_hash(&(diagnostic.code, declaration, &diagnostic.args));
        self.add_diagnostic_of(Some(Query::Comparison(entry)), diagnostic);
    }

    /// True if `q` is a query that TypeScript tracks as well (`TypeSystemPropertyName`): the type of a named
    /// declaration, the return type of a function, the base types of a class or an interface, the target of a
    /// type alias, the base constraint of a type, or whether a parameter's initializer can be `undefined`. In
    /// TypeScript a circular one is an error and resolves to `any`. Here, any other circular query is unresolved.
    fn is_resolution(&self, q: Query) -> bool {
        match q {
            Query::Return(..)
            | Query::ReturnOfSignature(_)
            | Query::MappedProp(..)
            | Query::Bases(_)
            | Query::BaseConstructor(_)
            | Query::Constraint(_)
            | Query::InitializerIsUndefined(..)
            | Query::TypeArguments(_)
            | Query::AliasTarget(_)
            | Query::WriteType(..)
            | Query::ParameterSymbol(..) => true,
            // `getTypeOfSymbol` tests for a variable or a property first.
            // `getTypeOfFuncClassEnumModule` and `getTypeOfEnumMember` don't push a resolution.
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
            // A missing name is an identifier.
            Query::Pat(file, pat) => {
                matches!(
                    self.hir(file)[pat].kind,
                    PatKind::Ident(_) | PatKind::Missing
                )
            }
            // `getTypeOfAccessors` of an accessor of an object literal. `Query::Return` of the
            // getter is only `getReturnTypeOfSignature`.
            Query::LiteralProp(file, p) => {
                matches!(self.hir(file)[p].kind, PropKind::Getter | PropKind::Setter)
            }
            // `getDeclaredTypeOfTypeAlias` is the only one to push `TypeSystemPropertyNameDeclaredType`.
            Query::Declared(sym) => self.files().flags(sym).contains(SymFlags::TYPE_ALIAS),
            _ => false,
        }
    }

    /// `typeResolutionHasProperty` for the frames from `i` up. In tsgo, `links` belong to one
    /// checker. A result that another thread has cached in the meantime is a valid value for any
    /// caller, but it's unrelated to the queries this checker has in flight.
    fn is_resolved_since(&self, i: usize) -> bool {
        self.frames[i..].iter().any(|frame| frame.has_result) || self.is_below_stale_resolution(i)
    }

    /// True if there's a stale entry on `typeResolutions` above `stack[i]`.
    fn is_below_stale_resolution(&self, i: usize) -> bool {
        (self.stale_resolutions.last()).is_some_and(|stale| stale.0 > i)
    }

    /// False if `q` isn't on `stack`. Reads the per-class counter that `enter` tests before it scans the stack.
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

    /// Call when this checker has cached a result for `q`. Marks the frames of `q` that are still on the stack.
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

    /// See `QueryFrame::is_stored_by_nested_visit`.
    #[inline]
    fn note_stored_by_nested_visit(&mut self, q: Query) {
        if !self.may_be_in_flight(q) {
            return;
        }
        cold_path();
        let frames = self.frames.iter_mut().zip(&self.stack);
        for (frame, _) in frames.filter(|x| *x.1 == q) {
            frame.is_stored_by_nested_visit = true;
        }
    }

    /// See `QueryFrame::has_read_members_in_place`. `height` is that of the
    /// `anonymous_members_in_place` entry that was read. A comparison that began since then isn't
    /// stored either, because in tsgo the entry of one that began earlier replaces it.
    fn note_members_in_place_read_above(&mut self, height: usize) {
        self.lowest_taint = self.lowest_taint.min(height);
        for at in height..self.stack.len() {
            let q = self.stack[at];
            // `checkExpressionCached` does store, and then nothing visits the expression or any
            // part of it again, except a visit that's already in progress further down.
            if let Query::Expr(file, e) = q
                && self.is_checked_by_check_expression_cached(file, e)
                && !self.quick_initializers.iter().any(|quick| quick.1 == at)
                && !self.stack[..at].contains(&q)
            {
                break;
            }
            self.frames[at].has_read_members_in_place |=
                matches!(q, Query::Expr(..) | Query::LiteralProp(..));
        }
    }

    /// True if every check of `e` is a `checkExpressionCached`, because it's the initializer of a variable,
    /// parameter or property (`checkDeclarationInitializer`, `checkVariableLikeDeclaration`), or the
    /// expression of a `return` statement (`checkAndAggregateReturnExpressionTypes`, `checkReturnStatement`).
    fn is_checked_by_check_expression_cached(&self, file: FileId, e: ExprId) -> bool {
        use crate::bind::Parent;
        let hir = self.hir(file);
        match self.bound(file).parent_of_expr(e) {
            Parent::VarInit(_) | Parent::ParamDefault(_) => true,
            Parent::MemberInit(m) => hir[m].init == e,
            Parent::Stmt(s) => s.is_some() && matches!(hir[s].kind, StmtKind::Return(_)),
            _ => false,
        }
    }

    /// Changes whenever a computation is cut short at a point that depends on the depth of the
    /// caller: an instantiation limit was hit, or the native stack ran low.
    fn cuts(&self) -> u64 {
        self.limits + self.times_cut_short.get()
    }

    /// Changes whenever a query is rejected or a computation is cut short. If it's the same before
    /// and after, what was computed in between is complete and may outlive the frames around it.
    fn interruptions(&self) -> (u64, u64, u64) {
        (self.unmarked_rejections, self.cuts(), self.rejected_at)
    }

    /// Call when a result that was cut short has been read. Records the same marks as recomputing
    /// it would, so that results computed from it are recorded in turn.
    fn cut_short_again(&mut self) {
        self.times_cut_short.set(self.times_cut_short.get() + 1);
        self.bailed_out();
    }

    /// Call when a query was rejected only because of the depth at which it was made. Made from
    /// elsewhere it would have a result, so nothing computed from the missing result may be cached.
    fn bailed_out(&mut self) {
        self.bailed_out_from(0);
    }

    /// `bailed_out` for the case where the frame at `from` makes the query again. See `starts_over_from_lower`.
    fn bailed_out_from(&mut self, from: usize) {
        self.note_gave_up();
        self.mark_tainted_from(from);
        self.note_cycle();
        self.rejected_at = self.work;
    }

    /// True if `q` is a `checkExpression` call. A method or accessor of an object literal isn't an expression,
    /// and `checkObjectLiteralMethod` calls `checkFunctionExpressionOrObjectLiteralMethod` itself.
    fn is_check_expression(&self, q: Query) -> bool {
        matches!(q, Query::Expr(file, e)
            if !matches!(self.hir(file)[e].kind, ExprKind::Fn(func)
                if !matches!(self.hir(file)[func].kind, FnKind::Expr | FnKind::Arrow)))
    }

    /// `c.currentNode`. What `checkExpression` sets is derived from the queries in progress. `getTypeFromTypeNode`
    /// never sets it, but `checkSourceElement` visits a type node before anything resolves it: a type node in an
    /// expression (`checkAssertion`), the type arguments of a call (`resolveCall`), the signature of a function
    /// expression (`looked_at_type_node`), and the type nodes that the checks after `check_source_file` query. A
    /// type node reached through any other query is resolved on demand and doesn't change `currentNode`. Returns
    /// `None` if `currentNode` is what `checkSourceElement` set, see `current_source_element`.
    pub(super) fn current_node(&self) -> Option<CurrentNode> {
        if let Some((file, e, depth)) = self.instantiating_generic_argument
            && !(self.stack.iter().zip(&self.frames).skip(depth))
                .any(|(&q, frame)| !frame.is_quick_type && self.is_check_expression(q))
        {
            return Some(CurrentNode::Expr(file, e));
        }
        let innermost_expr = (self.stack.iter().zip(&self.frames))
            .rposition(|(&q, frame)| !frame.is_quick_type && self.is_check_expression(q));
        // `checkSourceElement` has set it since the innermost `checkExpression` began.
        let before = innermost_expr.and_then(|i| self.frames[i].source_element);
        if self.current_source_element != before {
            return None;
        }
        let mut inner = &self.stack[innermost_expr.unwrap_or(0)..];
        let mut current = None;
        if innermost_expr.is_some()
            && let [Query::Expr(file, e), rest @ ..] = inner
        {
            current = Some(CurrentNode::Expr(*file, *e));
            if !matches!(
                self.hir(*file)[*e].kind,
                ExprKind::As { .. }
                    | ExprKind::Satisfies { .. }
                    | ExprKind::Instantiation { .. }
                    | ExprKind::Call(_)
                    | ExprKind::New(_)
                    | ExprKind::TaggedTemplate(_)
                    | ExprKind::Jsx(_)
            ) && !matches!(rest, [Query::TypeNode(of, node), ..]
                if self.looked_at_type_node == Some((*of, *node)))
            {
                return current;
            }
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

    /// `IsPartOfTypeNode(c.currentNode)`
    fn is_current_node_part_of_type_node(&self) -> bool {
        let Some(current) = self.current_node().or(self.current_source_element) else {
            return false;
        };
        let (file, node) = self.node_of_current_node(current);
        self.hir(file).is_part_of_type_node(node)
    }

    fn node_of_current_node(&self, current: CurrentNode) -> (FileId, Node) {
        match current {
            CurrentNode::Expr(file, e) => (file, self.hir(file).node(e)),
            CurrentNode::TypeNode(file, node) => (file, self.hir(file).node(node)),
            CurrentNode::Node(file, node) => (file, node),
        }
    }

    /// `GetErrorRangeForNode(c.currentNode)`
    fn span_of_current_node(&self, current: CurrentNode) -> (FileId, u32, u32) {
        match current {
            CurrentNode::Expr(file, e) => (
                file,
                self.error_start_inside_parentheses(file, e),
                self.error_end_inside_parentheses(file, e),
            ),
            CurrentNode::TypeNode(file, node) => (
                file,
                self.hir(file)
                    .skip_trivia_of_node_at(self.hir(file)[node].pos),
                self.end_of_type_node(file, node),
            ),
            CurrentNode::Node(file, node) => {
                let (start, end) = self.get_error_range_for_node(file, node);
                (file, start, end)
            }
        }
    }

    /// `instantiateTypeWithAlias`, `getConditionalType`: an instantiation limit was hit. Reports
    /// 2589 at `currentNode` and returns the error type. Safe to call after any rejected `enter`.
    /// Returns `UNRESOLVED` where the recursion here isn't evidence of recursion in tsgo: after a
    /// rejection, and more than 60 levels of `instantiate` deep under a conditional type.
    pub(super) fn excessively_deep(&mut self) -> TypeId {
        if !self.is_limit_in_tsgo() {
            return TypeId::UNRESOLVED;
        }
        self.error_at_current_node(2589);
        TypeId::ERROR
    }

    /// `excessively_deep` for `tailCount == 1000` in `getConditionalType`. Every call counts from 0, so the result is
    /// the same at any depth, and the queries in progress store theirs. The next request finds the error type in
    /// `root.instantiations` and reports nothing.
    pub(super) fn too_many_tail_calls(&mut self) -> TypeId {
        if !self.is_limit_in_tsgo() {
            return TypeId::UNRESOLVED;
        }
        self.report_at_current_node(2589);
        TypeId::ERROR
    }

    fn is_limit_in_tsgo(&mut self) -> bool {
        self.note_gave_up();
        // Only the call right after a rejected `enter` sees the rejection.
        match std::mem::replace(&mut self.last_enter, EnterOutcome::Entered) {
            EnterOutcome::Rejected => false,
            // `getConditionalType` loops where `conditional_type` recurses, so a tail call costs one
            // level of `instantiate` here and none in tsgo. `instantiate` allows at least 60 levels.
            EnterOutcome::Entered => {
                self.instantiation_depth <= 60
                    || !self.stack.iter().any(|q| matches!(q, Query::Cond(..)))
            }
        }
    }

    /// `instantiateTypeWithAlias`: `instantiationDepth == 100`. `instantiation_depth` counts what tsgo counts under a
    /// conditional type too, because `resolve_conditional` follows a tail call in a loop, as `getConditionalType` does.
    pub(super) fn instantiation_too_deep(&mut self) -> TypeId {
        self.note_gave_up();
        self.instantiation_limit_hits += 1;
        if std::mem::replace(&mut self.last_enter, EnterOutcome::Entered) == EnterOutcome::Rejected
        {
            return TypeId::UNRESOLVED;
        }
        self.error_at_current_node(2589);
        TypeId::ERROR
    }

    /// `checkSourceElement`, `checkDeferredNode` and `checkExpressionEx` begin with
    /// `c.instantiationCount = 0`, so the limit of 5,000,000 applies to one statement or expression. The
    /// checks that `check_file` runs after `check_source_file` are parts of those functions. They visit the
    /// nodes in their own loops, and nothing marks where the check of a node begins. But whatever such a
    /// check requests begins while nothing is in progress. `enter`, `begin_comparison` and `instantiate`
    /// call this, and every instantiation is under one of them. Returns true if nothing is in progress.
    pub(super) fn reset_instantiation_count_if_idle(&mut self) -> bool {
        let is_idle = self.stack.is_empty()
            && self.instantiation_depth == 0
            && self.current_source_element.is_none()
            && self.outermost_comparison.is_none();
        if is_idle {
            self.instantiation_count = 0;
        }
        is_idle
    }

    /// Call at the start of a `checkTypeRelatedToEx` run, or of `checkTypeAssignableToAndOptionallyElaborate`,
    /// which has several runs. `error_node` is its `errorNode`. Returns true if no query, instantiation or
    /// comparison is in progress. Pass the result to `end_comparison`.
    pub(super) fn begin_comparison(&mut self, error_node: Option<(FileId, u32, u32)>) -> bool {
        let is_outermost = self.stack.is_empty()
            && self.instantiation_depth == 0
            && self.outermost_comparison.is_none();
        if is_outermost {
            self.reset_instantiation_count_if_idle();
            self.outermost_comparison = Some(error_node);
        }
        is_outermost
    }

    pub(super) fn end_comparison(&mut self, is_outermost: bool) {
        if is_outermost {
            self.outermost_comparison = None;
        }
    }

    /// `c.error_at(c.currentNode, ..)`: the computation in progress has reached a limit. Like a
    /// tsgo checker, the task reports it once, at the node it's checking at that moment, and stores
    /// the results of the queries that began at depth 0. What a task sees is a function of the
    /// program, so which task reaches the limit, and at which node, is too.
    #[cold]
    fn error_at_current_node(&mut self, code: u32) {
        if !self.report_at_current_node(code) {
            return;
        }
        // A query that began under an instantiation had less depth left than the same query has
        // from depth 0, where a finite type doesn't reach the limit. tsgo stores its result
        // regardless, and which types that breaks depends on the order in which it checks files.
        if let Some(from) = self.frames.iter().position(|frame| frame.entry_depth > 0) {
            self.mark_tainted_from(from);
            // That doesn't apply to an infinite type (`is_runaway`), that is, a type node that's in
            // progress several times.
            for i in from..self.stack.len() {
                let q = self.stack[i];
                if matches!(q, Query::TypeNode(..))
                    && (self.stack[..i].contains(&q) || self.stack[i + 1..].contains(&q))
                {
                    self.frames[i].tainted = false;
                }
            }
        }
    }

    /// Returns false if there's no node to report at. Nothing in progress is stored then.
    fn report_at_current_node(&mut self, code: u32) -> bool {
        self.note_gave_up();
        // Under `eager`, tsgo evaluates this later or never, with another `currentNode`.
        let is_reported = self.eager.is_empty();
        // Outside of an expression, `c.currentNode` is the statement or declaration that `checkSourceElement`
        // is at. The checks after `check_source_file` don't know it. The `errorNode` of their comparison
        // begins at the same position for an assignment, a variable declaration and a `return` statement.
        let at = match self.current_node() {
            Some(current) => Some(self.span_of_current_node(current)),
            // A comparison without an `errorNode` that `check_source_file` makes: of a rest
            // parameter with an array type (2370), of the two types of an assertion.
            None => self.outermost_comparison.flatten().or_else(|| {
                let current = self.current_source_element?;
                Some(self.span_of_current_node(current))
            }),
        };
        let Some(at) = at.filter(|_| is_reported) else {
            // The result is the error type, to which everything is related, and tsgo reports 2589.
            // The count is reset as in tsgo, so the file isn't reported as clean.
            if is_reported && self.instantiation_count >= 5_000_000 {
                self.ran_out_of_stack.set(true);
            }
            self.note_limit();
            self.mark_tainted_from(0);
            return false;
        };
        // Past the limit of 5,000,000, every further instantiation in the statement reports the same error.
        // `sort_and_deduplicate_diagnostics` would keep only one, so don't accumulate millions until then.
        if !self.is_last_diagnostic_of_task(at, code) {
            self.add_diagnostic_of(None, Reported::bare(at, code));
        }
        true
    }

    /// 2859 in `checkTypeRelatedToEx` without an error node: `errorNode = c.currentNode`.
    #[cold]
    fn error_about_comparison_at_current_node(&mut self, args: &[Arg<'_>]) {
        let current = self.current_node().or(self.current_source_element);
        if let (Some(current), true) = (current, self.eager.is_empty()) {
            let at = self.span_of_current_node(current);
            let diagnostic = self.new_diagnostic(at, 2859, args);
            // tsgo caches the overflow in the relation cache, so the next comparison of the two
            // types is a cache hit and reports nothing.
            let mut hasher = crate::util::FxHasher::default();
            std::hash::Hash::hash(&diagnostic.args, &mut hasher);
            let comparison = Query::Comparison(std::hash::Hasher::finish(&hasher));
            self.add_diagnostic_of(Some(comparison), diagnostic);
        }
    }

    /// See `pulls_contextual_types_at`.
    #[inline]
    fn pulls_contextual_types(&self) -> bool {
        self.stack.len() == self.pulls_contextual_types_at
    }

    /// Pops the frame of `q`. Returns `Ok` if the result is final, with a token that permits storing it. Returns
    /// `Err` if the result depends on a frame that's still in progress, so it may only go to `cache_provisionally`.
    #[inline]
    fn leave(&mut self, q: Query) -> Result<Stored, Open> {
        let popped = self.stack.pop();
        debug_assert!(popped == Some(q));
        self.last_enter = EnterOutcome::Entered;
        let frame = self.frames.pop().unwrap();
        self.in_progress[frame.class as usize] -= 1;
        if self.in_progress[frame.class as usize] != 0 {
            cold_path();
            if !frame.tainted || frame.circular {
                self.note_result(q);
            }
        }
        self.left_a_cycle = if self.stale_resolutions.is_empty() {
            frame.circular
        } else {
            cold_path();
            self.pop_type_resolution(q, frame.circular)
        };
        if self.reported.len() > frame.reported_from as usize {
            cold_path();
            self.settle_reported(frame, q);
        }
        if frame.tainted {
            cold_path();
            self.left_frame = Some(frame);
            return Err(Open);
        }
        Ok(Stored::since(frame.held_back))
    }

    /// `leave` for `module` or `exports`. The first time, its entry stays on `typeResolutions`. Only its
    /// own file refers to it, and `checkSourceFile` checks every reference. So for a single checker,
    /// which visits the files in program order, the first time is no later than the check of that file.
    fn leave_without_pop(&mut self, symbol: Sym) -> Result<Stored, Open> {
        let is_resolved_by_check = self.task.file.is_some_and(|current| {
            current != symbol.file && self.is_checked_no_later_than(symbol.file, current)
        });
        if !is_resolved_by_check
            && let Some(frame) = self.frames.last()
            && self.unpopped_resolutions.insert(symbol)
        {
            let (height, circular) = (self.frames.len() - 1, frame.circular);
            let above = (self.stale_resolutions).partition_point(|stale| stale.0 <= height);
            self.stale_resolutions.insert(above, (height, circular));
        }
        self.leave(Query::Symbol(symbol))
    }

    /// `popTypeResolution` for the frame of `q`, which `leave` has just popped, while there are
    /// `stale_resolutions`. It pops the last entry, so a resolution with stale entries above its
    /// own gets the result of the last of them, and its own entry stays behind in their place.
    /// `circular` is `!result` of `q`'s entry. Returns `!result` of the popped entry.
    #[cold]
    #[inline(never)]
    fn pop_type_resolution(&mut self, q: Query, circular: bool) -> bool {
        let height = self.stack.len();
        let above = (self.stale_resolutions).partition_point(|stale| stale.0 <= height);
        for stale in &mut self.stale_resolutions[above..] {
            stale.0 = height;
        }
        let pat_result = self.popped_for_symbol.take();
        let is_module_exports = matches!(q, Query::Symbol(symbol)
            if self.files().flags(symbol).contains(SymFlags::MODULE_EXPORTS));
        let mut popped = pat_result.unwrap_or(circular);
        if pat_result.is_none()
            && !is_module_exports
            && self.is_resolution(q)
            && above < self.stale_resolutions.len()
            && let Some((_, last)) = self.stale_resolutions.pop()
        {
            self.stale_resolutions.insert(above, (height, circular));
            popped = last;
            // The two queries are one resolution in tsgo.
            if let Query::Pat(file, pat) = q {
                let symbol = self.bound(file).pat_symbol[pat.idx()];
                if symbol.is_some()
                    && self.stack.last() == Some(&Query::Symbol(self.files().sym(file, symbol)))
                {
                    self.popped_for_symbol = Some(popped);
                }
            }
        }
        // Nothing is going to pop them, and there's no entry below them to close a cycle at.
        if !self.stack.iter().any(|&below| self.is_resolution(below)) {
            self.stale_resolutions.clear();
        }
        popped
    }

    /// See `rechecks_at`.
    #[inline]
    fn is_rechecking(&self) -> bool {
        self.stack.len() == self.rechecks_at
    }

    /// The `checkMode` parameter of `checkExpression`. Cached results are checked in
    /// `CheckModeNormal`.
    #[inline]
    fn check_mode(&self) -> CheckMode {
        if self.is_rechecking() {
            cold_path();
            self.mode_of_recheck
        } else {
            CheckMode::empty()
        }
    }

    /// Starts rechecking: while `stack` stays at its current height, expressions are rechecked with
    /// nothing pushed. Returns the argument for `end_recheck`.
    fn begin_recheck(&mut self) -> (usize, usize) {
        let height = self.stack.len();
        (
            std::mem::replace(&mut self.pulls_contextual_types_at, height),
            std::mem::replace(&mut self.rechecks_at, height),
        )
    }

    /// Suspends rechecking: while `stack` stays at its current height, expressions are checked once
    /// (`checkExpressionCached`). Returns the argument for `end_recheck`.
    fn suspend_recheck(&mut self) -> (usize, usize) {
        (
            std::mem::replace(&mut self.pulls_contextual_types_at, usize::MAX),
            std::mem::replace(&mut self.rechecks_at, usize::MAX),
        )
    }

    fn end_recheck(&mut self, outer: (usize, usize)) {
        (self.pulls_contextual_types_at, self.rechecks_at) = outer;
    }

    /// Marks the results of the queries from `stack[from]` up as not valid for every caller.
    fn mark_tainted_from(&mut self, from: usize) {
        self.taints += 1;
        self.mark_tainted_by_pattern_from(from);
    }

    /// `mark_tainted_from` for the case where an identifier declared in a pattern in
    /// `contextual_binding_patterns` evaluated to `any`. Not counted in `taints`.
    fn mark_tainted_by_pattern_from(&mut self, from: usize) {
        self.lowest_taint = self.lowest_taint.min(from);
        self.note_taint_event(from);
        self.note_state_was_read();
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

    /// Returns the lowest index from which frames were tainted since the frame with the serial
    /// number `serial` was pushed, or `usize::MAX` if there was no such event.
    fn lowest_taint_since(&self, serial: u64) -> usize {
        let first = self.taint_events.partition_point(|event| event.0 < serial);
        let event = self.taint_events.get(first);
        event.map_or(usize::MAX, |event| event.1 as usize)
    }

    /// Drops the innermost query's diagnostics, whether or not its result is cached.
    fn drop_reported(&mut self) {
        if let Some(frame) = self.frames.last_mut() {
            frame.drops_reported = true;
        }
    }

    /// Begins a computation that isn't a query on `stack` but whose result is cached, such as a type comparison.
    #[inline]
    fn begin_scope(&mut self) -> Scope {
        self.scopes_begun += 1;
        Scope {
            outer_taint: std::mem::replace(&mut self.lowest_taint, usize::MAX),
            frames: self.frames.len() as u32,
            counters: self.non_cacheable_mark(),
            held_back: self.task.held_back(),
        }
    }

    /// `leave`, for the computation since `begin_scope`. It counts as a frame on top of those in
    /// flight when it began. A cycle among queries that were entered and left since then is closed,
    /// so those queries have their final results, and so does the computation.
    #[inline]
    fn end_scope(&mut self, scope: Scope) -> Result<Stored, Open> {
        let is_open = self.lowest_taint <= scope.frames as usize;
        self.end_scope_as(scope, is_open)
    }

    /// `end_scope` for a memo that's guarded only by the counters. Returns `Ok` iff `non_cacheable_mark()`
    /// hasn't changed since `begin_scope`. A taint event that doesn't change a counter is ignored here.
    #[inline]
    fn end_scope_by_counters(&mut self, scope: Scope) -> Result<Stored, Open> {
        let is_open = self.non_cacheable_mark() != scope.counters;
        self.end_scope_as(scope, is_open)
    }

    /// `end_scope` for a memo with its own test.
    #[inline]
    fn end_scope_as(
        &mut self,
        Scope {
            outer_taint,
            held_back,
            ..
        }: Scope,
        is_open: bool,
    ) -> Result<Stored, Open> {
        self.lowest_taint = self.lowest_taint.min(outer_taint);
        if is_open {
            Err(Open)
        } else {
            Ok(Stored::since(held_back))
        }
    }

    /// Returns permission to store the result that a member of a resolution cycle gets, which is `any` or the error
    /// type. tsgo caches it for every member (`!popTypeResolution()`) and after a failed `pushTypeResolution`, even
    /// where `leave` returns `Err`. The value is a constant, so it isn't derived from an unfinished result.
    ///
    /// The entry waits for a commit, but what the task computes from it until then looks like any
    /// other result, hence `Task::stop_writing_immediately`. Which member gets it can depend on where
    /// the task entered the cycle, see `close_ring_from`.
    fn cycle_result(&self) -> Stored {
        debug_assert!(self.left_a_cycle || self.found_cycle);
        self.task.stop_writing_immediately();
        Stored::new()
    }

    /// Returns permission to store the result of `q`, for which `leave` has just returned `Err`, if
    /// the only reason is a loop's incomplete type (`taint_from`). It's for a result that tsgo
    /// computes with `flowLoopStack` as it is and stores anyway. Nothing computes it again, so what
    /// was reported for it belongs to the entry, as after an `Ok`, and no frame below drops it.
    fn incomplete_flow_result(&mut self, q: Query) -> Option<Stored> {
        let frame = self.left_frame.take()?;
        if !frame.incomplete_flow || frame.drops_reported {
            return None;
        }
        if self.reported.len() > frame.reported_from as usize {
            let finished = QueryFrame {
                tainted: false,
                ..frame
            };
            self.settle_reported(finished, q);
        }
        Some(Stored::new())
    }

    fn is_innermost_tainted(&self) -> bool {
        self.frames.last().is_some_and(|frame| frame.tainted)
    }

    /// Returns the expressions of `file` grouped by kind, for callers that need a few kinds and would
    /// otherwise iterate over all expressions. It's built once per file. The handle doesn't borrow
    /// `self`, so this works: `let index = self.exprs_by_kind(file); for &e in index.of(ExprTag::Call)`.
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

    /// Changes whenever an event makes the computation in progress invalid for the next caller: a
    /// query was circular, a result was read that depends on a candidate being tried, or an
    /// instantiation went too deep, which is reported again to every caller that gets there.
    #[inline]
    fn non_cacheable_mark(&self) -> (u64, u64) {
        (self.cycles, self.limits)
    }

    /// Stores `raw`, the result of `q`, for which `leave` has just returned `Err(open)`.
    /// `provisional` returns it while it's valid.
    ///
    /// A frame is non-cacheable if its result depends on a query in flight (a cycle), on a rejected query (native
    /// stack, instantiation depth) or on a binding pattern whose implied type is being computed. Nothing is
    /// written to a shared cache then. The result stays valid until the outermost non-cacheable frame is popped,
    /// because everything it depends on is unchanged until then. It's stored in `provisional` for that time.
    /// Otherwise it would be recomputed on every use, and a computation that uses each sub-result twice would
    /// cost 2^depth. After that frame is popped, the next use computes the result from a clean state.
    ///
    /// A result that depends on an incomplete flow-loop type is valid for a shorter time. The
    /// incomplete type of a loop changes when the traversal of one of its back edges returns. So
    /// the scope is a frame that was pushed during the traversal in progress of the innermost loop:
    /// the frame at the stack height at which that loop was pushed, or the outermost frame marked
    /// by `taint_from` if that is higher.
    ///
    /// A result that depends on a rejected query (`bailed_out`) is reused only at the same or a
    /// greater stack height, where recomputing it would be rejected again. A query from a lower
    /// height has more capacity and may succeed, so it recomputes.
    ///
    /// A hit has the same effects as recomputing the result, and no more. A type comparison in
    /// flight isn't stored in `relations` if a frame at or below its own height is tainted before
    /// it ends, so a hit that taints too much turns that memo table off.
    /// - A frame that `enter` pushed as tainted, and that no taint event reached, doesn't taint a caller when it's
    ///   recomputed. So a hit taints nothing. It's a hit only where `enter` would push a tainted frame again.
    /// - Otherwise a hit taints from the lowest index of the events since the frame was pushed, which
    ///   is one above the cycle head. The entry is valid only while the head is in flight too.
    #[cold]
    #[inline(never)]
    fn cache_provisionally(&mut self, q: Query, raw: u64, _: Open) {
        let Some(frame) = self.left_frame.take() else {
            return;
        };
        // A frame that `enter` pushed above a resolution inherits the mark of the frame below it, but it hasn't seen a
        // loop from below the resolution (`is_flow_loop_visible`). So its result is no more short-lived than that of
        // any other non-cacheable frame. It's also requested from places where the loop isn't visible, where a result
        // that follows from a loop isn't a hit. Every use would then recompute it, and nested uses cost uses ^ depth.
        let flow = frame.incomplete_flow && self.is_in_flow_loop();
        // tsgo recomputes it, and then finds the loop in `flowLoopCache`, whereas this computation
        // only saw the types collected so far.
        if flow && self.is_flow_loop_cached_since(frame.serial) {
            return;
        }
        let scope = if flow {
            let innermost_loop = self.flow_loops.last().map(|in_progress| in_progress.5);
            let outermost = self.frames.iter().position(|frame| frame.incomplete_flow);
            (outermost.zip(innermost_loop))
                .map(|(outermost, innermost_loop)| outermost.max(innermost_loop))
        } else {
            self.frames.iter().position(|frame| frame.tainted)
        };
        // An event from the frame's own index up hasn't tainted a caller.
        let from = self.lowest_taint_since(frame.serial);
        let from = (from < self.frames.len()).then_some(from);
        let is_behind_barrier = !flow && from.is_some_and(|from| self.is_behind_barrier(from));
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
                    event_bits: since(self.cycle_at)
                        | since(self.limit_at) << 1
                        | u8::from(flow) << 2
                        | since(self.rejected_at) << 3
                        | u8::from(is_behind_barrier) << 4
                        | since(self.members_in_place_hit_at) << 5
                        | since(self.any_signature_read_at) << 6,
                    serial: scope.serial,
                },
            );
        }
    }

    /// True if `mark_cycle_from` rejects a cycle whose head is `stack[from - 1]` because of `eager`.
    fn is_behind_barrier(&self, from: usize) -> bool {
        let above = |barriers: &[usize]| barriers.iter().filter(|&&at| at >= from).count();
        above(&self.eager) > above(&self.loop_values)
    }

    /// Returns the result that `cache_provisionally` stored for `q`, if it's still valid.
    #[inline]
    fn provisional(&mut self, q: Query) -> Option<u64> {
        if self.provisional.is_empty() {
            return None;
        }
        cold_path();
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
        if entry.event_bits & 8 != 0 && self.stack.len() < entry.height as usize {
            return None;
        }
        // `checkExpressionCached` empties `flowLoopStack`, so what follows from a loop's incomplete
        // type is recomputed where the loop isn't visible.
        if entry.event_bits & 4 != 0 && !self.is_flow_loop_visible(depth) {
            return None;
        }
        // Without the barrier the cycle is marked.
        if entry.event_bits & 16 != 0 && !self.is_behind_barrier(entry.from as usize) {
            return None;
        }
        // The same test as in `enter`.
        if entry.from == u32::MAX
            && (self.inference_contexts.is_empty() || !self.is_innermost_tainted())
        {
            return None;
        }
        if entry.event_bits & 8 != 0 {
            self.rejected_at = self.work;
        }
        // The counters that guard the other memo tables change if they changed then.
        match (entry.from, entry.event_bits & 4) {
            (u32::MAX, _) => {}
            (from, 0) => self.mark_tainted_from(from as usize),
            (from, _) => self.taint_from(from as usize),
        }
        if entry.event_bits & 1 != 0 {
            self.note_cycle();
        }
        if entry.event_bits & 32 != 0 {
            self.note_members_in_place();
        }
        if entry.event_bits & 2 != 0 {
            self.note_limit();
        }
        if entry.event_bits & 64 != 0 {
            self.note_any_signature();
        }
        Some(entry.raw)
    }

    /// `provisional` for a caller that reads what tsgo assigned when the computation returned.
    /// Nothing is recomputed, so a hit has no side effects. Also returns `None` for a result that
    /// depends on more than a cycle and members in place.
    fn provisional_as_assigned(&self, q: Query) -> Option<u64> {
        let entry = self.provisional.get(&q)?;
        let scope = self.frames.get(entry.depth as usize)?;
        let is_valid = scope.serial == entry.serial
            && entry.from != u32::MAX
            && entry.event_bits & !(1 | 32) == 0;
        is_valid.then_some(entry.raw)
    }

    /// Calls `Task::hold_back`. The computations in progress have read something that's only valid for this
    /// checker's current stack: a query in progress, members that are in place, `anySignature`, the incomplete
    /// type of a loop, a limit, or a result that follows from one of these. Most of them don't store anything
    /// then. Some do, as tsgo does, based on their own test (`end_scope_as`, `end_scope_by_counters`, a frame
    /// that members in place don't taint). What they store is only for this task.
    #[inline]
    fn note_state_was_read(&self) {
        self.task.hold_back();
    }

    /// Call when the checker gives up: at an instantiation limit (2589), a union size limit (2590) or a
    /// comparison limit (2859), for lack of native stack, or at a depth at which a query is rejected. The
    /// result then isn't a function of the question alone. How far from the limit a computation begins, and
    /// how much of it is left to do, depends on what was computed before, which for a task that sees commits
    /// includes what it found there. Such a task is discarded.
    #[cold]
    #[inline(never)]
    pub(super) fn note_gave_up(&self) {
        self.note_state_was_read();
        self.task.discard();
    }

    /// Increments `cycles`.
    #[inline]
    fn note_cycle(&mut self) {
        self.cycles += 1;
        self.cycle_at = self.work;
        self.note_state_was_read();
    }

    /// Increments `cycles` for a request for members that got the members in place. See `members_in_place_hits`.
    #[inline]
    fn note_members_in_place(&mut self) {
        self.close_cycle(0);
        self.count_members_in_place();
    }

    /// Like `note_members_in_place`, when the partial members belong to `key`, so the cycle starts
    /// at its `Query::Shape`.
    fn note_members_in_place_of(&mut self, key: TypeId) {
        let from = self.stack.iter().rposition(|&q| q == Query::Shape(key));
        self.close_cycle(from.unwrap_or(0));
        self.count_members_in_place();
    }

    fn count_members_in_place(&mut self) {
        self.cycles += 1;
        self.members_in_place_hits += 1;
        self.members_in_place_hit_at = self.work;
        self.note_state_was_read();
    }

    /// Increments `any_signature_reads`.
    #[inline]
    fn note_any_signature(&mut self) {
        self.any_signature_reads += 1;
        self.any_signature_read_at = self.work;
        self.note_state_was_read();
    }

    /// Increments `limits`.
    #[inline]
    fn note_limit(&mut self) {
        self.limits += 1;
        self.limit_at = self.work;
        self.note_state_was_read();
    }

    /// Call when a provisional value was just read that was stored when `stack` was `depth` deep. The results of
    /// the queries started since then aren't cached. This applies to a loop in progress: `getResolvedSignature`
    /// doesn't store anything while `flowLoopStack` isn't empty, and `checkExpressionCached` empties it first.
    /// Their diagnostics are kept, because `getTypeOfExpression` reports as usual.
    fn taint_from(&mut self, depth: usize) {
        if depth >= self.frames.len() {
            return;
        }
        self.lowest_taint = self.lowest_taint.min(depth);
        self.note_taint_event(depth);
        // `getTypeOfVariableOrParameterOrProperty` stores what `getQuickTypeOfExpression` returns,
        // which checks the callee with the loops visible, and the type of a `...rest`. Nothing stores
        // the type of a pattern around a binding element, which is recomputed for the next element.
        for at in depth..self.frames.len() {
            let is_quick = |&(from, to): &(usize, usize)| (from..to).contains(&at);
            if self.quick_initializers.iter().any(is_quick) && self.is_resolution(self.stack[at]) {
                continue;
            }
            self.frames[at].tainted = true;
            self.frames[at].incomplete_flow = true;
        }
        self.taints += 1;
        self.incomplete_flow_taints += 1;
        self.note_cycle();
    }

    // ───────────────────────────── kinds of types ─────────────────────────────

    #[inline]
    pub fn is_any(&self, ty: TypeId) -> bool {
        ty == TypeId::UNRESOLVED || self.has_any_flag(ty)
    }

    /// `TypeFlagsAny`: `anyType`, `errorType`, or the type of a type name that doesn't resolve.
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
        // A missing identifier has no text. It resolves to `unknownSymbol`, for which
        // `getTypeReferenceType` returns `errorType`.
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
            args: self.list(args),
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

    #[inline(always)]
    pub fn is_union(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::UNION != 0
    }

    /// Returns a union's members, nothing for `never`, and the type itself for anything else.
    #[inline]
    pub fn parts(&self, ty: TypeId) -> &'p [TypeId] {
        self.types().parts(ty)
    }

    /// `TypeFlagsObject`, except for an evolving array.
    #[inline(always)]
    pub fn is_object_type(&self, ty: TypeId) -> bool {
        self.types().is_object_type(ty)
    }

    #[inline]
    pub fn is_type_variable(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::TYPE_VARIABLE != 0
    }

    /// `ObjectFlagsAnonymous`
    pub(super) fn is_anonymous_object_type(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Anon { origin, .. } => !matches!(origin, Origin::Mapped(..)),
            TypeData::Fns { .. } | TypeData::Synth(_) | TypeData::ReverseMapped { .. } => true,
            _ => false,
        }
    }

    /// True for a type whose members can't be resolved until its type parameters are instantiated.
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

    /// `getUnionTypeFromSortedList` sets the flag on the union of the two boolean literal types,
    /// regardless of its alias or origin.
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

    /// `TypeFlagsPrimitive`, except for the unions that have it: `boolean`, an enum.
    #[inline]
    pub fn is_primitive(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::PRIMITIVE != 0 && self.flags(ty) & tf::UNION == 0
    }

    /// True if `f` holds for every member of `ty`.
    pub fn every_type(&self, ty: TypeId, f: impl Fn(&Self, TypeId) -> bool) -> bool {
        match self.data(ty) {
            TypeData::Union(members) => members.iter().all(|&m| f(self, m)),
            _ => f(self, ty),
        }
    }

    /// `every_type(ty, is_unit)`
    pub(crate) fn is_every_type_unit(&self, ty: TypeId) -> bool {
        // An enum member has `ENUM_LITERAL` in addition to its value's flag. An intersection is never a unit type.
        let others = self.types().member_flags(ty) & !(tf::UNIT | tf::ENUM_LITERAL);

        others == 0 && !self.may_be_reduced(ty)
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

    /// `t.freshType` or `t.regularType` of a literal type. Any other type is returned unchanged.
    fn with_freshness(&self, ty: TypeId, fresh: bool) -> TypeId {
        if !fresh && self.has_no_fresh_literal(ty) {
            return ty;
        }
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
        !self.has_no_fresh_literal(ty) && relate::is_fresh_literal_kind(self.data(ty))
    }

    /// Returns the literal type as an annotation would denote it.
    pub fn regular(&mut self, ty: TypeId) -> TypeId {
        if self.has_no_fresh_literal(ty) {
            return ty;
        }
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

    /// `getBaseTypeOfLiteralType`: `"a"` becomes `string`, fresh or not, and so do
    /// `` `a${string}` `` and `Uppercase<T>`.
    pub fn base_of_literal(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::StringLit { .. }
            | TypeData::Template { .. }
            | TypeData::StringMapping { .. } => TypeId::STRING,
            TypeData::NumberLit { .. } => TypeId::NUMBER,
            TypeData::BigIntLit { .. } => TypeId::BIGINT,
            TypeData::BoolLit { .. } => TypeId::BOOLEAN,
            TypeData::EnumLit { member, .. } => self.enum_type_of_member(*member),
            // `getBaseTypeOfEnumLikeType`: an enum without members is its own base type.
            TypeData::Enum { symbol, .. }
                if self.files().flags(*symbol).contains(SymFlags::ENUM_MEMBER) =>
            {
                self.enum_type_of_member(*symbol)
            }
            TypeData::Union(_) => self.map_type(ty, |c, m| c.base_of_literal(m)),
            _ => ty,
        }
    }

    /// Returns the type of a mutable location initialized with `ty`. A fresh `"a"` becomes `string`.
    pub fn widen_literal(&mut self, ty: TypeId) -> TypeId {
        if self.has_no_fresh_literal(ty) {
            return ty;
        }
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

    /// Reports an error that isn't in any file: `c.error(nil, ..)`. It belongs to the entry of the
    /// innermost query, or to the task.
    pub(super) fn report_global_error(&mut self, code: u32, args: Vec<Vec<u8>>) {
        let owner = self.stack.last().copied();
        let diagnostic = Reported::new(explain::NOWHERE, code, sink::held(args));
        self.add_diagnostic_of(owner, diagnostic);
    }

    /// `getGlobalSymbol`. `diagnostic` is the message to report if there's no such symbol.
    /// `resolveName` has no location, so `onFailedToResolveSymbol` reports outside any file.
    pub(super) fn get_global_symbol(
        &mut self,
        name: Atom,
        meaning: SymFlags,
        diagnostic: Option<u32>,
    ) -> Option<Sym> {
        let symbol = self.files.global(name, meaning);
        if symbol.is_none()
            && let Some(name_not_found_message) = diagnostic
        {
            let diagnostic = self.name_not_found_diagnostic(
                None,
                explain::NOWHERE,
                Arg::Atom(name),
                name,
                meaning,
                name_not_found_message,
            );
            let owner = self.stack.last().copied();
            self.add_diagnostic_of(owner, diagnostic);
        }
        symbol
    }

    #[inline]
    pub fn global_type_symbol(&self, name: Atom) -> Option<Sym> {
        self.files.global_type_symbol(name)
    }

    /// `getGlobalType`: the global class or interface `name` that has `arity` type parameters. Any
    /// other declaration of that name counts as missing.
    #[inline]
    pub fn global_type_of_arity(&self, name: Atom, arity: usize) -> Option<Sym> {
        self.files.global_type_of_arity(name, arity)
    }

    /// `getGlobalType` with `reportErrors`. `None` means `emptyGenericType`, or `emptyObjectType` for an `arity` of 0.
    pub(super) fn get_global_type(&mut self, name: Atom, arity: usize) -> Option<Sym> {
        let (code, symbol) = match self.files.get_global_type(name, arity) {
            Ok(symbol) => return Some(symbol),
            Err(error) => error,
        };
        let Some(symbol) = symbol else {
            return self.get_global_symbol(name, SymFlags::TYPE, Some(code));
        };
        let declaration = self.files.global_type_declaration(symbol);
        let error_node =
            declaration.and_then(|(file, node)| self.error_span_of_declaration(file, node));
        // Only 2317 mentions the number.
        let args = [Arg::Atom(name), Arg::Number(arity)];
        let args = &args[..1 + usize::from(code == 2317)];
        let diagnostic = self.new_diagnostic(error_node.unwrap_or(explain::NOWHERE), code, args);
        let owner = self.stack.last().copied();
        self.add_diagnostic_of(owner, diagnostic);
        None
    }

    /// Reports what `initializeChecker`'s `getGlobalType` calls report at a declaration in `file`,
    /// or outside any file for `None`.
    fn check_required_global_types(&mut self, file: Option<FileId>) {
        let p = self.p;
        for (name, arity) in p.required_global_types() {
            if let Err((_, symbol)) = self.files.get_global_type(name, arity) {
                let declaration = symbol.and_then(|it| self.files.global_type_declaration(it));
                if declaration.map(|(declared_in, _)| declared_in) == file {
                    self.get_global_type(name, arity);
                }
            }
        }
    }

    /// Returns `Name<args>` for a global class or interface. If it doesn't exist the result is
    /// `{}`, which is a valid result, not a missing one (`createTypeFromGenericGlobalType`, and
    /// `getGlobalType` itself for one without type parameters).
    pub fn global_ref(&mut self, name: Atom, args: &[TypeId]) -> TypeId {
        match self.global_type_of_arity(name, args.len()) {
            Some(target) => self.intern_key(TypeKey::Ref { target, args }),
            None => TypeId::EMPTY_OBJECT,
        }
    }

    /// `global_ref` for the case where the global type's resolver has `reportErrors`.
    pub(super) fn global_ref_checked(&mut self, name: Atom, args: &[TypeId]) -> TypeId {
        match self.get_global_type(name, args.len()) {
            Some(target) => self.intern_key(TypeKey::Ref { target, args }),
            None => TypeId::EMPTY_OBJECT,
        }
    }

    pub fn array_of(&mut self, element: TypeId) -> TypeId {
        self.array_as(element, false, FirstRequest::NONE)
    }

    pub fn readonly_array_of(&mut self, element: TypeId) -> TypeId {
        self.array_as(element, true, FirstRequest::NONE)
    }

    /// `global_ref` for `Array` or `ReadonlyArray`. `globalReadonlyArrayType` is `globalArrayType`
    /// if `ReadonlyArray` doesn't exist. For `first_request`, see `Types::as_first_request`.
    pub(super) fn array_as(
        &mut self,
        element: TypeId,
        readonly: bool,
        first_request: FirstRequest,
    ) -> TypeId {
        let name = if readonly && self.global_type_of_arity(known::ReadonlyArray, 1).is_some() {
            known::ReadonlyArray
        } else {
            known::Array
        };
        let args = &[element];
        match self.global_type_of_arity(name, 1) {
            Some(target) => self.intern_key_as(TypeKey::Ref { target, args }, first_request),
            None => TypeId::EMPTY_OBJECT,
        }
    }

    /// `createPromiseType`
    pub fn promise_of(&mut self, promised_type: TypeId) -> TypeId {
        // `getGlobalPromiseTypeChecked`
        let Some(target) = self.get_global_type(known::Promise, 1) else {
            return TypeId::UNKNOWN;
        };
        let unwrapped = self.unwrap_awaited_type(promised_type);
        let promised_type = self.awaited_no_alias(unwrapped).unwrap_or(TypeId::UNKNOWN);
        self.intern_key(TypeKey::Ref {
            target,
            args: &[promised_type],
        })
    }

    /// `createPromiseReturnType`. `error_node` is `fn`, which is an `import()` call
    /// (`is_import_call`) or an async function.
    pub(super) fn create_promise_return_type(
        &mut self,
        error_node: (FileId, u32, u32),
        is_import_call: bool,
        promised_type: TypeId,
    ) -> TypeId {
        let promise_type = self.promise_of(promised_type);
        if promise_type == TypeId::UNKNOWN {
            self.error_at(error_node, if is_import_call { 2711 } else { 2697 }, &[]);
            return TypeId::ERROR;
        }
        // `getGlobalPromiseConstructorSymbol`
        let constructor = self.get_global_symbol(known::Promise, SymFlags::VALUE, Some(2468));
        if constructor.is_none() {
            self.error_at(error_node, if is_import_call { 2712 } else { 2705 }, &[]);
        }
        promise_type
    }

    /// `createGeneratorType`
    pub fn generator_of(
        &mut self,
        yielded: TypeId,
        returned: TypeId,
        next: TypeId,
        is_async: bool,
    ) -> TypeId {
        let (generator, iterable_iterator) = if is_async {
            (known::AsyncGenerator, known::AsyncIterableIterator)
        } else {
            (known::Generator, known::IterableIterator)
        };
        // `resolveIterationType`
        let (yielded, returned) = if is_async {
            (
                self.awaited_or_none(yielded).unwrap_or(TypeId::UNKNOWN),
                self.awaited_or_none(returned).unwrap_or(TypeId::UNKNOWN),
            )
        } else {
            (yielded, returned)
        };
        let args = [yielded, returned, next];
        if self.global_type_of_arity(generator, 3).is_some() {
            return self.global_ref(generator, &args);
        }
        // "Fall back to the global IterableIterator type."
        self.global_ref_checked(iterable_iterator, &args)
    }

    /// True if `ty` is a reference to `getGlobalType(name, arity)`.
    fn is_reference_to_global(&self, ty: TypeId, name: Atom, arity: usize) -> bool {
        matches!(self.data(ty), TypeData::Ref { target, .. }
            if self.files().symbol(*target).name == name
                && self.global_type_of_arity(name, arity) == Some(*target))
    }

    /// Returns the type arguments of `ty`, if it's a reference to `getGlobalType(name, arity)`.
    fn is_global_ref(&mut self, ty: TypeId, name: Atom, arity: usize) -> Option<&'p [TypeId]> {
        if self.is_reference_to_global(ty, name, arity) {
            Some(self.type_arguments(ty))
        } else {
            None
        }
    }

    /// Returns the element type of `T[]` or `readonly T[]`.
    pub fn array_element(&mut self, ty: TypeId) -> Option<TypeId> {
        if self.is_array(ty) {
            self.type_arguments(ty).first().copied()
        } else {
            None
        }
    }

    /// `isArrayType`
    pub fn is_array(&self, ty: TypeId) -> bool {
        self.is_reference_to_global(ty, known::Array, 1)
            || self.is_reference_to_global(ty, known::ReadonlyArray, 1)
    }

    pub fn is_tuple(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Tuple { .. })
    }

    pub fn is_array_or_tuple(&self, ty: TypeId) -> bool {
        self.is_array(ty) || self.is_tuple(ty)
    }

    /// `createNormalizedTupleTypeEx`, once the variadic elements that are known have been spread (`normalized_tuple`).
    pub fn tuple(&mut self, elems: &[TypeId], flags: &[ElemFlags], readonly: bool) -> TypeId {
        self.tuple_as(elems, flags, readonly, FirstRequest::NONE)
    }

    /// `tuple`. `first_request` applies to the result, see `Types::as_first_request`.
    pub(super) fn tuple_as(
        &mut self,
        elems: &[TypeId],
        flags: &[ElemFlags],
        readonly: bool,
        first_request: FirstRequest,
    ) -> TypeId {
        if !flags
            .iter()
            .any(|f| f.intersects(ElemFlags::OPTIONAL | ElemFlags::REST | ElemFlags::VARIADIC))
        {
            let key = TypeKey::Tuple {
                elems,
                flags,
                readonly,
            };
            return self.intern_key_as(key, first_request);
        }
        // `TupleNormalizer.add`: an optional element may be undefined.
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
        // `TupleNormalizer.normalize`: an element before a required element is required too.
        for info in &mut infos[..last_required] {
            if info.contains(ElemFlags::OPTIONAL) {
                *info = ElemFlags::REQUIRED.with_label(info.labeled_declaration());
            }
        }
        // Everything from the first rest element to the last optional or rest element collapses
        // into one rest element.
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
            return self.array_as(*element, readonly, first_request);
        }
        let key = TypeKey::Tuple {
            elems: &types,
            flags: &infos,
            readonly,
        };
        self.intern_key_as(key, first_request)
    }

    pub fn synth(&self, mut shape: Shape<'s>) -> TypeId {
        // A symbol that's given its type has no mapper (`createSymbolWithType`, `getSpreadSymbol`).
        // Keeping the mapper of the property it was made from would make the shape look generic forever.
        for prop in &mut shape.props {
            if let PropSource::Type(_) | PropSource::Copy(..) = prop.source {
                prop.mapper = MapperId::IDENTITY;
            }
        }
        self.intern(TypeData::Synth(self.boxed(shape)))
    }

    /// `addOptionality`: `T | undefined`, which only strictNullChecks distinguishes from `T`.
    pub fn optional(&mut self, ty: TypeId) -> TypeId {
        if !self.p.files.options.strict_null_checks {
            return ty;
        }
        self.union(&[ty, TypeId::UNDEFINED])
    }

    /// Returns the type read through an index signature that may have no entry, under noUncheckedIndexedAccess:
    /// `getUnionType([ty, missingType])`, regardless of strictNullChecks and exactOptionalPropertyTypes.
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

    /// `addOptionalityEx(ty, isProperty = true, true)`: the type of an optional property or element of type `ty`.
    pub fn optional_property(&mut self, ty: TypeId) -> TypeId {
        if !self.p.files.options.strict_null_checks {
            return ty;
        }
        let missing = self.undefined_or_missing();
        self.union(&[ty, missing])
    }

    /// `removeMissingType`
    #[inline(always)]
    pub fn remove_missing_type(&mut self, ty: TypeId, is_optional: bool) -> TypeId {
        if is_optional && self.p.files.options.exact_optional_property_types {
            self.filter(ty, |_, m| m != TypeId::MISSING)
        } else {
            ty
        }
    }

    /// `removeMissingOrUndefinedType`
    pub fn remove_missing_or_undefined_type(&mut self, ty: TypeId) -> TypeId {
        if self.p.files.options.exact_optional_property_types {
            self.filter(ty, |_, m| m != TypeId::MISSING)
        } else {
            self.type_with_ne_undefined(ty)
        }
    }

    /// `containsMissingType`
    pub fn contains_missing_type(&self, ty: TypeId) -> bool {
        self.parts(ty).contains(&TypeId::MISSING)
    }
}
