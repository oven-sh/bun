//! Answers type queries on demand. Nothing is computed until it is requested, every result is
//! cached, and a circular query yields "unresolved".
//!
//! [`Program`] is shared by all threads and only ever grows. A [`Checker`] belongs to one thread:
//! it has the stack of queries in progress and all other transient state.

/// Concatenates the pieces.
macro_rules! cat {
    ($($piece:expr),+ $(,)?) => { [$(&$piece[..]),+].concat() };
}

mod alias;
mod call;
mod check_source_file;
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
mod jsx;
mod late_bound;
mod loop_cycles;
mod mapped;
mod order;
mod print;
pub(crate) mod regexp_scanner;
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
use crate::session::{Arena, ArenaBox, Session};
use crate::session::{ArenaHashMap, ArenaHashSet, ArenaVec, map_in, set_in, vec_from_iter_in};
use crate::table::{Bases, Buffered, ById, ByIdIndirect, ByKey, ByNode, ByNodeIndirect, FileLocal};
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
use spans::{is_word_at, word_at, word_before, word_end, word_start};
use spans::{skip_trivia_back, trim_trivia_end};
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
    /// read (4), a query was refused for lack of native stack or query depth (8), the cycle passes a barrier (16, `is_behind_barrier`),
    /// a request for members got those in place (32), which (1) does not include, `anySignature` was read (64).
    moved: u8,
    serial: u64,
}

/// Calls `$each!` with the names of the `Buffered` fields of `Program`, in the order in which a
/// barrier may publish them: a table whose entries hold handles of another one comes after it, so
/// `shapes` is before `members`. This is the only list: a new `Buffered` field must be added here.
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
            mapped_param_constraints
            expr_types flows_too_deep calls call_return_types call_diagnostics diagnostics_of_re_resolved_calls
            effects_signatures resolved_effects_signatures context_free_expr_types context_free_types
            type_predicates_from_body initializer_is_undefined circular_initializers circular_returns deferred_nodes
            calls_before_signatures untyped_signatures_in_js
        )
    };
}
pub(crate) use buffered_fields;

/// The same for the `FileLocal` fields. Only a pure cache is `FileLocal`: a function of entries
/// that are published. What tsgo stores on a node, a symbol or a signature is `Buffered`, so that a
/// task sees the result of an outer evaluation together with what was evaluated inside it.
macro_rules! file_local_fields {
    ($each:ident) => {
        $each!(flow_node_reachable jsx_attributes_types)
    };
}
pub(crate) use file_local_fields;

pub struct Program<'s> {
    /// The arenas that the program and everything computed from it are in.
    pub session: &'s Session,
    /// Whether a query of any task has been circular. Written at a barrier, from
    /// `Finished::closed_a_cycle`.
    pub closed_a_cycle: AtomicBool,
    /// `Finished::order_dependent_variances` of the valid tasks so far: the first value in serial order for each symbol. Written at a
    /// barrier (`Program::validate`), read on a cache miss in `variances_worker`.
    serial_variances: Guarded<ArenaHashMap<'s, Sym, &'s [u8]>>,
    /// `autoArrayType`
    auto_array_type: TypeId,
    pub files: &'s Files<'s>,
    pub types: TypeStore<'s>,

    /// `links.resolvedType` of an expression (`checkExpressionCached`). Also serves as a memo where
    /// tsgo rechecks an expression.
    expr_types: ByNode<(FileId, ExprId), TypeId, Buffered, &'s Session>,
    type_node_types: ByNode<(FileId, TypeNodeId), TypeId, Buffered, &'s Session>,
    /// The flag, here and in `pat_types`, `declared_types` and `constraints`: the type is the result of a resolution cycle
    /// (`!popTypeResolution()`).
    fn_return_types: ByNode<(FileId, FnId), (TypeId, bool), Buffered, &'s Session>,
    pat_types: ByNode<(FileId, PatId), (TypeId, bool), Buffered, &'s Session>,
    literal_prop_types: ByNode<(FileId, PropId), TypeId, Buffered, &'s Session>,
    symbol_types: ByNode<Sym, TypeId, Buffered, &'s Session>,
    /// The parameters for which `parameterInitializerContainsUndefined` closed a cycle. Their entry in `pat_types` is older than the cycle.
    circular_initializers: ByNode<(FileId, PatId), (), Buffered, &'s Session>,
    /// The symbols whose type is the result of a resolution cycle.
    circular_symbols: ByNode<Sym, (), Buffered, &'s Session>,
    /// The functions for which 7023 was reported and whose entry in `fn_return_types` is not the result of the cycle: it is in flight and
    /// keeps its inferred type, or the cycle is that of a composite signature.
    circular_returns: ByNode<(FileId, FnId), (), Buffered, &'s Session>,
    /// The calls that found no signature while index signatures were being computed. The callee may
    /// be the static side of a class whose members were in place and whose signatures were not
    /// (`resolveAnonymousTypeMembers`).
    calls_before_signatures: ByNode<(FileId, ExprId), (), Buffered, &'s Session>,
    /// References whose control flow walk reached depth 2000 (2563). `getTypeAtFlowNode`
    flows_too_deep: ByNode<(FileId, ExprId), (), Buffered, &'s Session>,
    /// `getEffectsSignature`, by call.
    effects_signatures: ByNode<(FileId, ExprId), Option<SigId>, Buffered, &'s Session>,
    /// `links.effectsSignature` of the calls `getEffectsSignature` has to resolve: generic or overloaded.
    resolved_effects_signatures: ByNode<(FileId, ExprId), Option<SigId>, Buffered, &'s Session>,
    /// `links.contextFreeType` of an expression (`getContextFreeTypeOfExpression`). `context_free_types` is that of a function.
    context_free_expr_types: ByNode<(FileId, ExprId), TypeId, Buffered, &'s Session>,
    /// `flowNodeReachable`
    flow_node_reachable: ByNode<(FileId, crate::bind::FlowId), bool, FileLocal, &'s Session>,
    /// `sig.resolvedTypePredicate` for a function without a return type annotation.
    type_predicates_from_body:
        ByNodeIndirect<(FileId, FnId), Option<decl::Predicate>, Buffered, &'s Session>,
    /// `resolvedBaseConstructorType` of each class.
    base_constructor_types: ByNode<Sym, TypeId, Buffered, &'s Session>,
    /// `symbolReferenceLinks`: the symbols `Resolve` found when called with `isUse`, where the
    /// caller records that. `check_unused` computes the rest.
    symbol_reference_links: ByNode<Sym, (), Buffered, &'s Session>,
    /// `GetGlobalDiagnostics`: errors that belong to no file. `Cannot find global type 'Array'.`
    /// The code and the message arguments.
    global_errors: bun_threading::Guarded<std::collections::BTreeSet<(u32, Vec<Vec<u8>>)>>,
    sink: sink::Sink<'s>,
    /// `MappedType.containsError`
    mapped_types_with_errors: ById<TypeId, (), Buffered, &'s Session>,
    /// `NodeCheckFlagsInitializerIsUndefinedComputed` and `NodeCheckFlagsInitializerIsUndefined`
    initializer_is_undefined: ByNode<(FileId, ParamId), bool, Buffered, &'s Session>,
    /// See `is_untyped_signature_in_js_file`.
    untyped_signatures_in_js: ByNode<(FileId, FnId), bool, Buffered, &'s Session>,
    declared_types: ByNode<Sym, (TypeId, bool), Buffered, &'s Session>,
    shapes: ByIdIndirect<TypeId, shape::Resolved<'s>, Buffered, &'s Session>,
    /// `intersectionTypes`, for sets that contain a union. The key: the set, `IntersectionFlagsNoConstraintReduction`, and whether the set
    /// is split in halves, which gives the result another `origin`.
    distributed_intersections:
        ByKey<(Box<[TypeId]>, bool, bool), (TypeId, bool), Buffered, &'s Session>,
    sig_params: ByIdIndirect<SigId, ArenaBox<'s, [SigParam]>, Buffered, &'s Session>,
    sig_type_params: ByIdIndirect<SigId, ArenaBox<'s, [TypeId]>, Buffered, &'s Session>,
    /// `Signature.resolvedReturnType` of a signature with a `target`.
    resolved_return_types: ById<SigId, TypeId, Buffered, &'s Session>,
    call_signatures: ByIdIndirect<TypeId, ArenaBox<'s, [SigId]>, Buffered, &'s Session>,
    construct_signatures: ByIdIndirect<TypeId, ArenaBox<'s, [SigId]>, Buffered, &'s Session>,
    /// Keyed by the first of several signatures: the list they are in, then the same list in the
    /// order `candidates_in_order` produces.
    candidate_orders: ByIdIndirect<SigId, ArenaBox<'s, [SigId]>, Buffered, &'s Session>,
    /// The result of `members` for a type, once it is final.
    members: ByIdIndirect<TypeId, shape::CachedMembers, Buffered, &'s Session>,
    /// `TypeReference.resolvedTypeArguments` of a deferred type reference.
    resolved_type_arguments: ByIdIndirect<TypeId, ArenaBox<'s, [TypeId]>, Buffered, &'s Session>,
    instantiations: ByKey<(TypeId, MapperId), TypeId, Buffered, &'s Session>,
    /// `UnionType.keyPropertyName`, `constituentMap`
    key_properties:
        ByIdIndirect<TypeId, Option<(Atom, FxHashMap<TypeId, TypeId>)>, Buffered, &'s Session>,
    /// `compose`
    composed: ByKey<(MapperId, MapperId), MapperId, Buffered, &'s Session>,
    outer_type_params: ByNodeIndirect<
        (FileId, crate::bind::ScopeId),
        ArenaBox<'s, [TypeId]>,
        Buffered,
        &'s Session,
    >,
    /// `type_param`
    declared_type_params: ByNode<(FileId, TypeParamId), TypeId, Buffered, &'s Session>,
    /// `identity_mapper`
    identity_mappers: ByNode<(FileId, crate::bind::ScopeId), MapperId, Buffered, &'s Session>,
    identity_mappers_with_adopted:
        ByNode<(FileId, crate::bind::ScopeId), MapperId, Buffered, &'s Session>,
    base_types: ByNodeIndirect<Sym, ArenaBox<'s, [TypeId]>, Buffered, &'s Session>,
    /// `links.resolvedSignature`. `Checker::cached_resolved_signature` reads it together with `call_return_types`, `cache_call` writes both.
    calls: ByNode<(FileId, ExprId), Option<SigId>, Buffered, &'s Session>,
    /// `ResolvedCall::ret` of the entry of `calls`. A cell has 32 bits.
    call_return_types: ByNode<(FileId, ExprId), TypeId, Buffered, &'s Session>,
    /// `links.deferredNodes` for a file that the task was not checking at the time. See
    /// `check_node_deferred`.
    deferred_nodes: ByNode<(FileId, ExprId), (), Buffered, &'s Session>,
    /// `getEffectiveFirstArgumentForJsxSignature` of the signature a JSX element is resolved to,
    /// keyed by the element.
    jsx_attributes_types: ByNode<(FileId, JsxId), TypeId, FileLocal, &'s Session>,
    /// The diagnostics `resolveCall` reported for a call at its final resolution, with their
    /// related information.
    call_diagnostics: ByNodeIndirect<(FileId, ExprId), Vec<Reported>, Buffered, &'s Session>,
    /// `NodeCheckFlagsContextChecked`, with the signature passed to
    /// `assignContextualParameterTypes`. `None`: it was not called.
    context_checked: ByNode<(FileId, FnId), Option<SigId>, Buffered, &'s Session>,
    /// `contextFreeTypes` for a function.
    context_free_types: ByNode<(FileId, FnId), TypeId, Buffered, &'s Session>,
    /// The diagnostics `resolveCall` reported for a call the first time it was resolved again while
    /// its resolution was in progress, with their related information.
    diagnostics_of_re_resolved_calls:
        ByNodeIndirect<(FileId, ExprId), Vec<Reported>, Buffered, &'s Session>,
    relations: ByKey<relate::Key, u8, Buffered, &'s Session>,
    variances: ByNodeIndirect<Sym, &'s [u8], Buffered, &'s Session>,
    /// `resolvedType` of a property declared by assignment declarations, keyed by the first
    /// declaration.
    /// `awaited_no_alias` as a top-level query, once it is final.
    awaited_types: ById<TypeId, Option<TypeId>, Buffered, &'s Session>,
    /// `resolvedType` of a property of a mapped type, keyed by the mapped type and the property name. `getTypeOfMappedSymbol`
    mapped_prop_types: ByKey<(TypeId, Atom), TypeId, Buffered, &'s Session>,
    /// `reverseMappedCache`
    reverse_mapped_cache: ByKey<(TypeId, TypeId, TypeId), Option<TypeId>, Buffered, &'s Session>,
    /// See `cached_optional_property`.
    optional_properties: ById<TypeId, TypeId, Buffered, &'s Session>,
    intersected_props: ByKey<(TypeId, Atom), TypeId, Buffered, &'s Session>,
    /// `UnionOrIntersectionType.propertyCache`. A synthetic type holds the property.
    union_properties: ByKey<(TypeId, Atom), Option<TypeId>, Buffered, &'s Session>,
    never_intersections: ById<TypeId, bool, Buffered, &'s Session>,
    /// `getMappedTargetWithSymbol` of a mapped type.
    mapped_targets: ById<TypeId, TypeId, Buffered, &'s Session>,
    inferred_constraints: ById<TypeId, Option<TypeId>, Buffered, &'s Session>,
    constraints: ById<TypeId, (TypeId, bool), Buffered, &'s Session>,
    /// `global_ref` of a name, without type arguments.
    plain_global_refs: ById<Atom, TypeId, Buffered, &'s Session>,
    /// `CachedTypeKindEquivalentBaseType`
    equivalent_base_types: ById<TypeId, Option<TypeId>, Buffered, &'s Session>,
    /// `constraint_of_type_param` of a type parameter, once it is final.
    type_param_constraints: ById<TypeId, Option<TypeId>, Buffered, &'s Session>,
    enum_values: ByNodeIndirect<(FileId, EnumMemberId), decl::Evaluated, Buffered, &'s Session>,
    /// `default_of_type_param` of a type parameter, once it is final.
    type_param_defaults: ById<TypeId, Option<TypeId>, Buffered, &'s Session>,
    conditionals: ByKey<(FileId, TypeNodeId, MapperId), TypeId, Buffered, &'s Session>,
    /// The constraint of the parameter of each mapped type, if any. See
    /// `constraint_of_mapped_param`.
    mapped_param_constraints: ByNode<(FileId, TypeNodeId), Option<TypeId>, Buffered, &'s Session>,
}

/// No id: the arguments are printed when it is created.
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

impl<'s> Program<'s> {
    /// The footprint of the shared part of every table, with the name of the field. It reads every
    /// cell: for `--timing`.
    pub fn table_footprints(&self) -> Vec<(&'static str, crate::table::Footprint)> {
        macro_rules! each {
            ($($field:ident)*) => { vec![$((stringify!($field), self.$field.footprint())),*] };
        }
        buffered_fields!(each)
    }

    pub fn new(session: &'s Session, files: &'s Files<'s>) -> Program<'s> {
        // Nothing that mentions a node of a leaf file is published, so the shared part has no
        // capacity for them. `Bases::at` returns `None` for its nodes.
        let bases = |len: fn(&crate::program::Module) -> usize| {
            let count = |m: &crate::program::ModuleCell| if m.is_leaf { 0 } else { len(m) };
            Bases::new_in(files.modules.iter().map(count), &session)
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
        let types = TypeStore::new_in(session);
        let arena = session.arena();
        let auto_array_type =
            types.publish_constant(match files.global_type_of_arity(known::Array, 1) {
                Some(target) => TypeData::Ref {
                    target,
                    args: ArenaBox::copy_from_slice_in(&[TypeId::AUTO], arena).into(),
                },
                // It is a marker: without a global `Array` it is still a distinct type.
                None => TypeData::Synth(ArenaBox::new_in(
                    Shape {
                        literal: Literalness::AutoArray,
                        ..Shape::new_in(arena)
                    },
                    arena,
                )),
            });
        let mut program = Program {
            session,
            closed_a_cycle: Default::default(),
            serial_variances: Guarded::new(map_in(session.arena())),
            auto_array_type,
            types,
            expr_types: ByNode::new_in(&exprs, session),
            type_node_types: ByNode::new_in(&type_nodes, session),
            fn_return_types: ByNode::new_in(&fns, session),
            pat_types: ByNode::new_in(&pats, session),
            literal_prop_types: ByNode::new_in(&props, session),
            symbol_types: ByNode::new_in(&symbols, session),
            circular_initializers: ByNode::new_in(&pats, session),
            circular_symbols: ByNode::new_in(&symbols, session),
            circular_returns: ByNode::new_in(&fns, session),
            calls_before_signatures: ByNode::new_in(&exprs, session),
            flows_too_deep: ByNode::new_in(&exprs, session),
            effects_signatures: ByNode::new_in(&exprs, session),
            resolved_effects_signatures: ByNode::new_in(&exprs, session),
            context_free_expr_types: ByNode::new_in(&exprs, session),
            // A `FileLocal` table has no shared array, so it does not look at the bases.
            flow_node_reachable: ByNode::new_in(&exprs, session),
            type_predicates_from_body: ByNodeIndirect::new_in(&fns, session),
            base_constructor_types: ByNode::new_in(&symbols, session),
            sink: sink::Sink::new_in(files.modules.len(), session.arena()),
            symbol_reference_links: ByNode::new_in(&symbols, session),
            global_errors: Default::default(),
            mapped_types_with_errors: ById::new_in(session),
            initializer_is_undefined: ByNode::new_in(&params, session),
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
            inferred_constraints: ById::new_in(session),
            constraints: ById::new_in(session),
            plain_global_refs: ById::new_in(session),
            equivalent_base_types: ById::new_in(session),
            type_param_constraints: ById::new_in(session),
            enum_values: ByNodeIndirect::new_in(&enum_members, session),
            type_param_defaults: ById::new_in(session),
            conditionals: ByKey::new_in(session),
            mapped_param_constraints: ByNode::new_in(&type_nodes, session),
            files,
        };
        task::number_tables(&mut program);
        program
    }

    /// Frees what the program owns on the regular heap: the diagnostics, and the keys or values of
    /// two tables with few entries. Everything else is in the arenas of the session and is freed
    /// with them, so a program that is itself allocated in an arena needs no `Drop`.
    pub fn release(&mut self) {
        let session = self.session;
        let no_nodes = Bases::none_in(&session);
        self.sink.release();
        *self.global_errors.get_mut() = Default::default();
        self.call_diagnostics = ByNodeIndirect::new_in(&no_nodes, session);
        self.diagnostics_of_re_resolved_calls = ByNodeIndirect::new_in(&no_nodes, session);
        self.key_properties = ByIdIndirect::new_in(session);
        self.distributed_intersections = ByKey::new_in(session);
    }

    /// `GetGlobalDiagnostics`: the errors found that belong to no file, once all files have been
    /// checked. Sorted and deduplicated.
    pub fn global_errors(&self) -> Vec<(u32, Vec<Vec<u8>>)> {
        if self.files.modules.is_empty() {
            return Vec::new();
        }
        // `initializeChecker`: these must exist, whether or not anything uses them.
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

    pub fn checker(&self) -> Checker<'_, 's> {
        let arena = self.session.arena();
        let checker = Checker {
            p: self,
            arena,
            task: Task::new_in(arena),
            left_frame: None,
            files: self.files,
            variance_type_parameter: Atom::NONE,
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
            non_circular_returns: Vec::new(),
            contextual_binding_patterns: Vec::new(),
            late_bound_members: Default::default(),
            late_binding_exports: Vec::new(),
            reporting_nonexistent: Vec::new(),
            declared_index_infos_in_progress: Vec::new(),
            serialization_level: 0,
            flow_type_cache: Default::default(),
            flow_type_cache_depth: usize::MAX,
            flow_invocation_count: 0,
            discarded: None,
            non_existent_properties: Default::default(),
            printing_closes_cycles: false,
            reprinting: false,
            printing_floors: Vec::new(),
            context_free_level: usize::MAX,
            found_cycle: false,
            left_a_cycle: false,
            taints: 0,
            checked_type_references: (None, Vec::new()),
            taints_before_patterns: 0,
            cycles: 0,
            lowest_taint: usize::MAX,
            context_checked_under: Vec::new(),
            quick_initializers: Vec::new(),
            depth: 0,
            contextual: Vec::new(),
            pulls_contextual_types_at: usize::MAX,
            rechecks_at: usize::MAX,
            mode_of_recheck: CheckMode::empty(),
            rechecked_exprs: Default::default(),
            rechecked_members: Default::default(),
            automatic_assignments: None,
            literals_checked_under: Default::default(),
            inference_contexts: Vec::new(),
            instantiation_depth: 0,
            outermost_comparison: None,
            instantiation_count: 0,
            recent_instantiations: Default::default(),
            recent_composed: Default::default(),
            unresolved_members: Vec::new(),
            unresolved_members_hits: 0,
            members_in_place_hits: 0,
            members_in_place_hit_at: 0,
            lowest_unresolved_members_hit: u32::MAX,
            active_mappers: Default::default(),
            limits: 0,
            instantiation_limit_hits: 0,
            comparisons_of_deeply_nested_types: 0,
            instantiations_up_to_a_limit: Default::default(),
            relations_cut_short: Default::default(),
            generic_relation_entries_not_published: 0,
            variances_cut_short: Default::default(),
            free_relaters: Vec::new(),
            reliability: 0,
            in_variance_computation: false,
            is_marker_comparison: false,
            is_trial_comparison: false,
            variances_in_progress: Vec::new(),
            variance_cycles: 0,
            variances_measured: Vec::new(),
            failed_type_argument: 0,
            order_dependent: Default::default(),
            order_dependent_filter: 0,
            simplified: Default::default(),
            inherited_names: [0; 4],
            cond_distributive_memo: Default::default(),
            relation_too_complex: false,
            relation_too_deep: false,
            current_source_element: None,
            is_type_checked: false,
            is_emitting: false,
            cached_by_emit: Vec::new(),
            reported: Vec::new(),
            never_checked: Default::default(),
            never_in_progress: Vec::new(),
            never_in_progress_from: Vec::new(),
            generic_mapped_types_in_progress: Vec::new(),
            generic_mapped_types_cut_short: Vec::new(),
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
            provisional: Default::default(),
            taint_events: Vec::new(),
            cycle_at: 0,
            limit_at: 0,
            refused_at: 0,
            enclosing_module_specifier_mode: None,
            emit_resolver_links: Default::default(),
            expected: Requested::All,
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
            undefined_properties: Default::default(),
            widening_contexts: Vec::new(),
            widened_types: Default::default(),
            iife_resolving: Vec::new(),
            any_signature_reads: 0,
            any_signature_read_at: 0,
            flow_loops: Vec::new(),
            reverse_mapped_source_stack: Vec::new(),
            reverse_mapped_target_stack: Vec::new(),
            reverse_expanding: 0,
            flow_memo: Default::default(),
            discriminated: Default::default(),
            contextual_properties: Default::default(),
            deferred_nodes: Default::default(),
            deferred_type_parameters: Vec::new(),
            unresolved_identifiers: Vec::new(),
            is_deferred_node: Default::default(),
            deferred_diagnostics: Vec::new(),
            node_check_flags: Default::default(),
            within_unreachable_code: false,
            reported_unreachable_nodes: Vec::new(),
            call_resolution_errors: None,
            is_call_re_resolved: false,
            untyped_call_resolved_again: None,
            assigned_parameters: Vec::new(),
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
            unwind_to: usize::MAX,
            unwind_work: 0,
            restart_with: None,
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
    /// `Checker::lowest_taint` of the enclosing scope.
    outer_taint: usize,
    /// `frames.len()` when it began, to compare with `lowest_taint`.
    frames: u32,
    /// `non_cacheable_mark()` when it began, for `end_scope_by_counters`.
    counters: (u64, u64),
}

/// A query that may be circular.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
enum Query {
    Expr(FileId, ExprId),
    Symbol(Sym),
    Declared(Sym),
    Return(FileId, FnId),
    /// `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`: the return type of a
    /// contextually typed function, computed the first time the function is checked. No resolution
    /// is pushed for it: any caller that requests the return type in the meantime starts its own
    /// resolution.
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
    /// stack: it only owns the diagnostic of a stack depth overflow (`error_about_comparison_at_current_node`).
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
    Node(FileId, Node),
}

/// For unbounded recursion. tsgo has no limit. A declaration without an annotation whose type is
/// that of the next one takes three queries: `Symbol`, `Pat`, `Expr`, or `Return`, `Expr`, `Call`.
/// One query takes 1 to 2 KB of stack in a release build, which `is_stack_low` guards. See
/// `refuse_as_too_deep`.
const MAX_DEPTH: usize = 1000;

/// The metadata of an entry of `Checker::stack`.
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
    /// Its diagnostics are dropped: the result depends on a cycle, a speculative evaluation or a
    /// provisional type, and is recomputed.
    drops_reported: bool,
    /// The length of `Checker::reported` when it was pushed. Later entries are reported for it.
    reported_from: u32,
    /// Its index in `Checker::in_progress`.
    class: u16,
    /// `typeResolutionHasProperty`: this checker has cached a result for the same query since the frame was pushed.
    has_result: bool,
    /// Non-cacheable because an incomplete flow-loop type was read (`taint_from`).
    incomplete_flow: bool,
    /// It is a `Query::Expr`, and a nested visit of the expression has stored its type since the
    /// frame was pushed. Every later visit is a cache hit, which reports nothing.
    is_stored_by_nested_visit: bool,
}

/// Which diagnostics of a file `check_file` computes.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Requested {
    /// `GetSyntacticDiagnostics`: the diagnostics of the parser and the scanner.
    Syntactic,
    /// .. and `GetDeclarationDiagnostics`. The declaration transformer queries the checker only
    /// about what the file exports.
    Declaration,
    /// .. and `getBindAndCheckDiagnostics`.
    All,
}

pub struct Checker<'p, 's> {
    pub p: &'p Program<'s>,
    /// The arena of the thread that runs the task: for the records that the task creates, which may be
    /// published. Everything else that a task allocates is on the regular heap.
    pub arena: &'s Arena,
    /// The task that this checker runs. Every access to a `Buffered` or `FileLocal` table takes it: it owns the write buffer.
    task: Task<'s>,
    /// The tainted frame that `leave` popped last, for `cache_provisionally`.
    left_frame: Option<QueryFrame>,
    files: &'p Files<'s>,
    /// `varianceTypeParameter`: its name.
    variance_type_parameter: Atom,
    /// A file that the task has checked, and the first JSX node and the first fragment of it that
    /// `checkExpression` reached.
    first_jsx: (FileId, Option<ExprId>, Option<ExprId>),
    /// `autoArrayType`
    auto_array_type: TypeId,
    stack: Vec<Query>,
    /// For each entry of `stack`.
    frames: Vec<QueryFrame>,
    /// How many entries of `stack` fall into each class. A query whose class is empty is not in
    /// progress.
    in_progress: [u16; 1024],
    /// For each open `Query::MappedProp` that is part of a cycle: its index in `stack` and the type node to report 2615 at.
    /// `circular_mapped_property` commits the entry when the query is left.
    pending_circular_mapped_props: Vec<(usize, (FileId, TypeNodeId))>,
    /// The cycles through a property of a mapped type that this task has found: the type node at which 2615 is reported, the
    /// mapped type, the property. Until `check_circular_mapped_properties`.
    circular_mapped_props: Vec<((FileId, TypeNodeId), TypeId, Atom)>,
    /// How the last `enter` ended. `leave` and `excessively_deep` reset it to `Entered`.
    last_enter: EnterOutcome,
    /// The patterns whose implied type is being computed as the contextual type of their
    /// initializer, and the stack depth when that began.
    contextual_binding_patterns: Vec<(FileId, PatId, usize)>,
    /// `membersAndExportsLinks`, keyed by container and side.
    late_bound_members: FxHashMap<(Sym, bool), late_bound::LateBoundMembers>,
    /// The classes whose static members with computed names `getExportsOfSymbol` is binding, for
    /// `resolveAnonymousTypeMembers`. See `origin_shape_in_the_meantime`.
    late_binding_exports: Vec<Sym>,
    /// `nonExistentProperties`: property accesses whose 2339 message is being printed, with `stack.len()` when printing started.
    reporting_nonexistent: Vec<(FileId, ExprId, usize)>,
    /// `resolveDeclaredMembers` is at `getIndexInfosOfSymbol`, with `declaredMembersResolved` set.
    /// For each one in progress: the depth of `stack` at that point, with the `Query::Shape` on
    /// top, and the first member of the declaration whose computed name is some string, number or
    /// symbol.
    declared_index_infos_in_progress: Vec<(usize, FileId, MemberId)>,
    /// `c.serializationLevel`: how many `TypeToString` calls are in progress, counting those whose
    /// resolutions are made eagerly.
    serialization_level: u32,
    /// `c.flowTypeCache`, for the loop back edge being traversed. `true`: the context-free type of the node (`c.contextFreeTypes`).
    flow_type_cache: FxHashMap<(FileId, ExprId, bool), TypeId>,
    /// `stack.len()` when that traversal began. `usize::MAX`: no back edge is being traversed.
    flow_type_cache_depth: usize,
    /// `c.flowInvocationCount`
    flow_invocation_count: u64,
    /// Where `add_diagnostic` stores a diagnostic it discards.
    discarded: Option<sink::Reported>,
    /// `NodeCheckFlagsTypeChecked` on the name of a property access: its 2339 has been created.
    /// `true`: and discarded.
    non_existent_properties: FxHashMap<(FileId, ExprId), bool>,
    /// The next `with_printer` is not a barrier for cycle detection: it prints when and what tsgo
    /// prints.
    printing_closes_cycles: bool,
    /// A message is being recreated that was dropped with a result that was not cached: its types
    /// are printed behind the barrier, and do not count as a level. tsgo creates it once. Or tsgo
    /// creates the message after the check of the file (`addDeferredDiagnostic`).
    reprinting: bool,
    /// The height of `stack` when each `typeToStringEx` in progress began.
    printing_floors: Vec<usize>,
    /// The height of `inference_contexts` while `getContextFreeTypeOfExpression` rechecks an
    /// expression: diagnostics reported then are kept.
    context_free_level: usize,
    /// The stack depth at each point where a query was made that TypeScript would not have made
    /// there, or not yet.
    /// A cycle through such a point may be an artifact of this resolver: the result is unresolved,
    /// not an error.
    eager: Vec<usize>,
    /// The entries of `eager` that represent the value assigned on the back edge of a loop in
    /// progress. TypeScript requests that value there as well: see `is_cycle_of_initializers`.
    loop_values: Vec<usize>,
    /// The height of `stack` at each request of `getNonCircularReturnTypeOfSignature` in progress.
    non_circular_returns: Vec<usize>,
    /// The index in `stack` from which a query counts as in progress.
    resolution_start: usize,
    /// Why the last `enter` refused: the query is one of TypeScript's own resolutions and is in
    /// progress.
    found_cycle: bool,
    /// The frame popped by the last `leave` was in a cycle.
    left_a_cycle: bool,
    /// Number of times frames were marked non-cacheable for any reason except `mark_tainted_by_pattern_from`.
    taints: u64,
    /// See `is_type_reference_checked`: the file, and a bit for each of its type nodes.
    checked_type_references: (Option<FileId>, Vec<u64>),
    /// `taints` when the first entry of `contextual_binding_patterns` was pushed. `u64::MAX` if the innermost frame was non-cacheable then.
    taints_before_patterns: u64,
    /// Number of circular queries.
    cycles: u64,
    /// The lowest index given to `mark_tainted_from` since the innermost `begin_scope`.
    lowest_taint: usize,
    depth: usize,
    /// Expressions being checked against a pushed contextual type, innermost last.
    contextual: Vec<(FileId, ExprId, TypeId)>,
    /// The height of `stack` at which `getContextualType` finds nothing pushed: the contextual
    /// types recorded by call resolution (`arg_contexts`) are not read, and the contextual type of
    /// an argument comes from the parameters of `links.resolvedSignature`. A query entered above
    /// that height is evaluated normally, so that its cached result does not depend on the caller.
    /// `usize::MAX`: nowhere.
    pulls_contextual_types_at: usize,
    /// The height of `stack` at which `checkExpression` is not memoized: an expression is
    /// rechecked, and its cached type is neither read nor replaced. See
    /// `get_type_of_expression_after_check`. `usize::MAX`: nowhere.
    rechecks_at: usize,
    /// `checkMode` of the non-memoized check. See `check_mode`.
    mode_of_recheck: CheckMode,
    /// Results of rechecks with nothing pushed: they are the same for any caller. Keyed by
    /// expression, and by member of an object literal or JSX attribute.
    rechecked_exprs: FxHashMap<(FileId, ExprId), TypeId>,
    rechecked_members: FxHashMap<(FileId, PropId), TypeId>,
    /// While `array_literal_types_in_automatic_variable` repeats the control flow analysis of a
    /// reference: the reference, and each value assigned to it with its type.
    automatic_assignments: Option<((FileId, ExprId), Vec<(ExprId, TypeId)>)>,
    /// `arg_type_under`: the type of a literal argument under a parameter type.
    literals_checked_under: FxHashMap<(FileId, ExprId, TypeId, u8), TypeId>,
    /// `inferenceContextInfos`
    inference_contexts: Vec<InferenceContextInfo>,
    instantiation_depth: u32,
    /// The comparison that began while no query and no instantiation was in progress and has not
    /// ended: its `errorNode`. See `begin_comparison`.
    outermost_comparison: Option<Option<(FileId, u32, u32)>>,
    /// `instantiationCount`: the instantiations computed since the last statement, type node or expression check began.
    instantiation_count: u32,
    /// The entries most recently read from or written to `Program::instantiations`.
    recent_instantiations: instantiate::Recent,
    /// The entries most recently read from or written to `Program::composed`.
    recent_composed: instantiate::Recent,
    /// `ObjectFlagsUnresolvedMembers`. `resolveObjectTypeMembers` calls `setStructuredTypeMembers`
    /// with the members that the class or interface declares before it instantiates the base
    /// types. A request for the members of the type reference in the meantime finds no inherited
    /// member: with `class C<T extends B> extends B<T["p"]>` and `R` = `C<R>`, `R["p"]` is
    /// `unknown` there, and the base type of `R` is `B<unknown>` from then on.
    /// Here all references share the members of the declared type, and the instantiated base type
    /// is `compose(first, second)`: `first` is the mapper of an inherited member, `second` that of
    /// the members of the reference. An entry per `compose` in progress: `second`, and the height
    /// of `frames` when it began.
    unresolved_members: Vec<(MapperId, u32)>,
    /// How many times `members` has left out the inherited members. Each time is counted in
    /// `cycles` too.
    unresolved_members_hits: u64,
    /// How many times a request for members got those that were in place: `unresolved_members_hits`,
    /// a re-entered query that `has_members_in_place`, and a provisional result that follows from
    /// either. Each time is counted in `cycles` too, so no other memo stores what follows. tsgo
    /// marks nothing there. What it assigns once, whatever is in progress, is stored here as well:
    /// `compose` (`resolveObjectTypeMembers`) and `resolve_type_arguments` (`getTypeArguments`).
    /// Otherwise n type references that need a member of each other are resolved n! times.
    members_in_place_hits: u64,
    /// `work` at the last of them.
    members_in_place_hit_at: u64,
    /// The lowest index in `unresolved_members` for which it has, since the innermost `compose` in
    /// progress began.
    lowest_unresolved_members_hit: u32,
    active_mappers: instantiate::ActiveMappers,
    /// How many times `error_at_current_node` had nothing to report since `check_file` began: the
    /// computation in progress is not cached.
    limits: u64,
    /// How many times `instantiate` returned the error type at a limit since `check_file` began.
    instantiation_limit_hits: u64,
    /// How many comparisons were `TernaryMaybe` because both types were deeply nested (`isDeeplyNestedType`). That depends on the
    /// comparisons in progress and on the order in which the types were created.
    comparisons_of_deeply_nested_types: u64,
    /// The results withheld from `Program::instantiations` because `instantiate` returned the error type at a limit, with the serial number
    /// of the activation of the mapper, and whether `limits` moved. While the mapper is active no
    /// path to the limit is taken twice (`activeTypeMappersCaches`). The next caller hits the limit
    /// itself.
    instantiations_up_to_a_limit: FxHashMap<(TypeId, MapperId), (u32, TypeId, bool)>,
    /// The same for the results of `check_type_related_to` and of `variances_of` during which `cuts` moved.
    relations_cut_short: FxHashMap<relate::Key, (u64, bool)>,
    /// Entries of `relations` under a generic key whose hash included a task-local id. They are not
    /// published: see `relate::Key`.
    pub(super) generic_relation_entries_not_published: u64,
    variances_cut_short: FxHashMap<Sym, (u64, &'s [u8])>,
    free_relaters: Vec<relate::Relater>,
    /// What the comparisons in progress found about the reliability of the variance being computed.
    reliability: u8,
    in_variance_computation: bool,
    /// The next call of `related` compares two marker types for `variances_of`. Consumed on entry.
    is_marker_comparison: bool,
    /// The next `related` is the speculative comparison of `check_type_related_to_ex`: see
    /// `Relater::caches_failures`.
    pub(super) is_trial_comparison: bool,
    variances_in_progress: Vec<Sym>,
    /// How many times `variances_worker` was re-entered for a symbol in `variances_in_progress`.
    variance_cycles: u32,
    /// The entries cached since the outermost `variances_worker` call on the stack began.
    variances_measured: Vec<(Sym, &'s [u8])>,
    /// After `type_arguments_related_to` returns false: the index of the pair that is not related.
    failed_type_argument: u32,
    /// The index of each symbol in `Task::order_dependent_variances`.
    order_dependent: FxHashMap<Sym, u32>,
    /// A 64-bit Bloom filter for the keys of `order_dependent`.
    order_dependent_filter: u64,
    simplified: FxHashMap<(TypeId, bool), TypeId>,
    /// A 256-bit filter of the property names of `Object`, `Function`, `CallableFunction` and
    /// `NewableFunction`: a name whose bit is clear is not one of them. All zero: not built yet.
    pub(super) inherited_names: [u64; 4],
    /// `resolvedConstraintOfDistributive`. `None` is `noConstraintType`.
    cond_distributive_memo: FxHashMap<TypeId, Option<TypeId>>,
    /// Set when a comparison exhausts `Relater::relation_count` (2859). The caller clears it before comparing.
    pub(super) relation_too_complex: bool,
    /// Whether the last `checkTypeRelatedToEx` reached 100 nested comparisons (2321).
    pub(super) relation_too_deep: bool,
    /// `c.currentNode`, as `checkSourceElement` and `checkDeferredNode` set it. See `current_node`.
    pub(super) current_source_element: Option<CurrentNode>,
    /// `NodeCheckFlagsTypeChecked` of `task.file`: `check_file` has finished it.
    is_type_checked: bool,
    /// `check_file` is at what `Emit` asks the checker before the check (`Options::emits_first`).
    is_emitting: bool,
    /// The computed names of `task.file` whose expression `GetConstantValue` was the first to
    /// check: `checkExpressionCached` has assigned the `links.resolvedType` that
    /// `checkComputedPropertyName` tests before it checks and reports.
    cached_by_emit: Vec<ExprId>,
    /// The diagnostics reported for the queries in progress, and with none in progress: see `sink`.
    reported: Vec<Reported>,
    /// The spans of `task.file` that `checkSourceFile` never visits. The passes that iterate over
    /// all nodes of a kind do visit them.
    never_checked: std::cell::RefCell<Vec<(u32, u32)>>,
    /// The intersections being tested for being uninhabited.
    pub(super) never_in_progress: Vec<TypeId>,
    /// The height of `stack` at which `is_empty_intersection` began, for each one in progress.
    pub(super) never_in_progress_from: Vec<usize>,
    /// The mapped types with an `as` clause for which `isGenericMappedType` is in progress.
    generic_mapped_types_in_progress: Vec<TypeId>,
    /// Those for which it has ended at the limit of `instantiation_count` since `check_file` began.
    generic_mapped_types_cut_short: Vec<TypeId>,
    /// The entries most recently found in `Program::members`, in the signature tables and in
    /// `intersected_props`, indexed by the low bits of the key.
    recent_members: Box<[shape::RecentMembers<'p>; shape::RECENT_MEMBERS]>,
    recent_signatures: Box<[(TypeId, &'p [SigId]); shape::RECENT_SIGNATURES]>,
    recent_intersected_props: Box<[((TypeId, Atom), TypeId); shape::RECENT_PROPS]>,
    /// The most recent results of `union` for two types, the lower id first.
    recent_unions: instantiate::Recent,
    /// The `stack` of `getResolvedBaseConstraint`: the recursion identities of the nested
    /// constraint computations in progress.
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
    /// For the most recently queried file.
    exprs_by_kind: Option<(FileId, std::rc::Rc<hir::ExprsByKind>)>,
    /// See `provisional_shape`, which returns a reference into the box and pushes the next.
    #[expect(clippy::vec_box)]
    provisional_shapes: Vec<Box<shape::Resolved<'s>>>,
    /// Non-cacheable query results, for reuse while the computation that made them non-cacheable is in flight. See `cache_provisionally`.
    provisional: FxHashMap<Query, Provisional>,
    /// `work` and `from` of each call of `mark_tainted_by_pattern_from` and `taint_from`, in order. An event is dropped when a later one has a
    /// lower or equal `from`, so `from` increases and the length is bounded by the depth of `stack`. See `lowest_taint_since`.
    taint_events: Vec<(u64, u32)>,
    /// `work` when `cycles` was last incremented, when `limits` was, and when a query was last refused by `bailed_out`. `QueryFrame::serial` is
    /// `work` when the frame was pushed, so the event happened since then if the value is not lower than the serial number.
    cycle_at: u64,
    limit_at: u64,
    refused_at: u64,
    /// `GetModeForUsageLocation` of `TryGetModuleSpecifierFromDeclaration(enclosingDeclaration)`, while the name of an import or an
    /// export is printed.
    enclosing_module_specifier_mode: Option<ResolutionMode>,
    emit_resolver_links: errors_declaration_emit::EmitResolverLinks,
    expected: Requested,
    /// The output `get_declaration_diagnostics` leaves for `checked`.
    declaration_file: Option<Vec<u8>>,
    /// During declaration emit: the indentation depth of the current line.
    declaration_indent: Option<usize>,
    /// Whether anything in the file that is being checked is in an ambient context.
    has_ambient_context: bool,
    /// `reparseTopLevelAwait`: the statements of that file that end up in an await context. Sorted.
    /// Computed on first use.
    parsed_again_for_await: Option<Vec<StmtId>>,
    /// `flowAnalysisDisabled`: the file whose nodes the `.types` writer rechecks with the flag set.
    flow_analysis_disabled_in: Option<FileId>,
    /// Nesting depth of the `const ok = test` conditions being inlined.
    inline_level: u32,
    /// The declared type of the reference that the flow walk in progress narrows.
    walk_declared: TypeId,
    constant_depth: u32,
    /// The most recent final results of `sig_params` and `sig_type_params`, indexed by the low bits
    /// of the signature id.
    recent_sig_params: Box<[(SigId, &'p [SigParam]); RECENT_SIGS]>,
    recent_sig_type_params: Box<[(SigId, &'p [TypeId]); RECENT_SIGS]>,
    /// The unions whose members are being awaited.
    awaiting: Vec<TypeId>,
    /// `lastFlowNode`, `lastFlowNodeReachable`
    last_flow_node: (FileId, crate::bind::FlowId, bool),
    /// `undefinedProperties`. In tsgo it lives as long as a checker, which checks many files. Here
    /// a checker checks one. The widened type of an exported variable is cached in the shared memo
    /// by the first caller, with the table of that checker, so the order of its printed properties
    /// can vary with more than one thread. If that is flagged, the table is for what is not cached
    /// there.
    undefined_properties: FxHashMap<Atom, Prop<'s>>,
    /// The contexts of the unions being widened. A `*WideningContext` is an index into it.
    widening_contexts: Vec<symbols::WideningContext<'p>>,
    /// `cachedTypes[CachedTypeKindWidened]`
    widened_types: FxHashMap<TypeId, TypeId>,
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
    /// The types for which a reverse mapped type inference is in progress.
    reverse_mapped_source_stack: Vec<TypeId>,
    reverse_mapped_target_stack: Vec<TypeId>,
    reverse_expanding: u8,
    /// Final results of narrowing.
    flow_memo: flow::FlowMemo,
    /// `deferredNodes` of the file being checked.
    /// `deferredNodes`, an ordered set.
    deferred_nodes: std::collections::VecDeque<ExprId>,
    /// The class expressions that have two entries in `deferred_nodes`, the first for their type
    /// parameters, and whether `checkDeferredNodes` has come to the first.
    deferred_type_parameters: Vec<(ExprId, bool)>,
    /// The identifiers `getResolvedSymbol` could not resolve, until
    /// `report_unresolved_identifiers`.
    unresolved_identifiers: Vec<(FileId, ExprId, Atom)>,
    is_deferred_node: crate::util::FxHashSet<ExprId>,
    /// `deferredDiagnosticCallbacks`: the declarations for which `checkWeakMapSetCollision` or
    /// `checkReflectCollision` is deferred.
    deferred_diagnostics: Vec<Node>,
    /// `nodeLinks.flags` for the file being checked.
    node_check_flags: FxHashMap<Node, u8>,
    /// `withinUnreachableCode`
    within_unreachable_code: bool,
    /// `reportedUnreachableNodes` for the file being checked.
    reported_unreachable_nodes: Vec<StmtId>,
    /// `discriminatedContextualTypes`: the result of `discriminate_by_object_members` for an object
    /// literal and a union, where it is final.
    discriminated: FxHashMap<(FileId, ExprId, TypeId), TypeId>,
    /// See `contextual_property_of_value`.
    contextual_properties: FxHashMap<(TypeId, Atom), Option<TypeId>>,
    /// The next target to be related to is a member of an intersection.
    /// The diagnostics `resolveCall` has just reported. `resolved_signature` takes them, and stores
    /// them only together with the entry of `calls`.
    call_resolution_errors: Option<Vec<Reported>>,
    /// The call that `resolve_signature` is resolving was already being resolved.
    is_call_re_resolved: bool,
    /// The call whose arguments `resolveUntypedCall` is checking, if the call was already being
    /// resolved and its callee is `any`. See
    /// `contextually_check_function_expression_or_object_literal_method`.
    untyped_call_resolved_again: Option<(FileId, ExprId)>,
    /// The indices in `stack` of the parameters whose type `assignParameterType` is computing. It
    /// pushes no type resolution, so a cycle through the initializer of one is not its cycle.
    assigned_parameters: Vec<usize>,
    /// `links.resolvedSignature != nil` for the calls that this checker has resolved and that
    /// `Program::calls` may not have: tsgo caches a signature that was resolved inside a cycle,
    /// `calls` does not. Whether a call is deferred under `CheckModeSkipGenericFunctions` depends
    /// on both.
    resolved_signatures: crate::util::FxHashSet<(FileId, ExprId)>,
    /// The functions whose first check is in progress, see `context_checked`. They are published to
    /// `Program::context_checked`, for every thread, only once the results of the first check are:
    /// a thread that found one without the other would continue without a first check of its own.
    context_checking: Vec<((FileId, crate::hir::FnId), Option<SigId>)>,
    /// The functions whose entry in `Program::context_checked` this checker wrote or tried to write. See `is_context_checked`.
    context_checked_here: crate::util::FxHashSet<(FileId, crate::hir::FnId)>,
    /// The functions whose first check is not published because a frame in progress is tainted,
    /// with the index and the serial of the lowest such frame. tsgo sets
    /// `NodeCheckFlagsContextChecked` and assigns the parameter types whatever is in progress. So
    /// until that frame is left the function is checked, with that signature.
    context_checked_under: Vec<(usize, u64, (FileId, crate::hir::FnId), Option<SigId>)>,
    /// Ranges of `stack`: the resolutions of declarations whose initializer
    /// `getQuickTypeOfExpression` is evaluating. See `is_flow_loop_visible`.
    quick_initializers: Vec<(usize, usize)>,
    /// `NodeCheckFlagsInCheckIdentifier`: the patterns for which `getNarrowedTypeOfSymbol` is in
    /// progress.
    in_check_identifier: Vec<(FileId, crate::hir::PatId)>,
    /// `resolvedSignature = result`, while `resolveCall` reports the errors of a call that no
    /// candidate accepts.
    resolved_meanwhile: Vec<(FileId, ExprId, call::ResolvedCall)>,
    /// The two types of each restrictive comparison in progress, innermost last: the results of
    /// `getRestrictiveInstantiation`.
    restrictive_operands: Vec<(TypeId, TypeId)>,
    /// Functions whose context `prepare_enclosing` has already prepared.
    prepared: crate::util::FxHashSet<(FileId, FnId)>,
    last_prepared: (FileId, FnId),
    /// A file, and which of its expressions `prepare_around` has processed.
    prepared_exprs: (FileId, Vec<bool>),
    /// The stack pointer when the checker was created, and how far below that it may go.
    stack_base: usize,
    stack_limit: usize,
    /// Number of queries made so far.
    pub work: u64,
    /// `enter` takes its slow path when `work` has this value: the next value of `work` while `refused_expressions` is not empty,
    /// `WORK_TRAP_DISARMED` otherwise.
    work_trap: u64,
    /// The file, start and end of the expressions in which a query was refused for lack of native stack. See `refuse_for_lack_of_stack`.
    refused_expressions: Vec<(FileId, u32, u32)>,
    /// A query was refused at `MAX_DEPTH`: `enter` refuses every query while `stack` is higher than this. `usize::MAX`: none was. See
    /// `refuse_as_too_deep`.
    unwind_to: usize,
    /// `work` of the next `enter` while that is so. It takes the slow path (`work_trap`).
    unwind_work: u64,
    /// The innermost resolution that was in progress at the refusal. The frame at `unwind_to` resolves it and starts over.
    restart_with: Option<Query>,
}

/// The stack pointer of the thread, less a constant: only the difference of two results is used.
/// `StackCheck` reads the register, not the address of a local: under a sanitizer that detects use
/// after return, locals whose address is taken are not on the stack at all.
#[inline(always)]
fn stack_pointer() -> usize {
    // Without a bound, what remains is counted from address 0.
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

    /// The published types and the task-local ones: everything the task sees.
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

    /// A copy of `items`, to store in a type, a signature or a value of a table.
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
        let created = self.intern(TypeData::TypeParam(of, first, MapperId::IDENTITY));
        (self.p.declared_type_params).insert(&self.task, (file, tp), created, Stored::new())
    }

    /// `cloneTypeParameter`: the type parameter `tp` of a signature found where the outer type
    /// parameters of the signature are mapped by `around`. With an identity mapping nothing was
    /// instantiated, and it is the declared one (`resolveObjectTypeMembers`,
    /// `getObjectTypeInstantiation`).
    pub fn cloned_type_param(&self, file: FileId, tp: TypeParamId, around: MapperId) -> TypeId {
        let around = if self.types().mapping(around).iter().all(|p| p.0 == p.1) {
            MapperId::IDENTITY
        } else {
            around
        };
        self.intern(TypeData::TypeParam(file, tp, around))
    }

    #[inline]
    fn files(&self) -> &'p Files<'s> {
        self.files
    }

    /// Whether `file` contains a conditional or a mapped type node: in any other file,
    /// `getConditionalFlowTypeOfType` finds nothing among the ancestors.
    #[inline]
    pub(super) fn has_conditional_or_mapped_type(&self, file: FileId) -> bool {
        self.files.has_conditional_or_mapped_type(file)
    }

    // ───────────────────────────── queries in progress ─────────────────────────────

    /// From now on `check_file` computes these.
    pub fn set_requested(&mut self, expected: Requested) {
        self.expected = expected;
    }

    /// How much stack the thread has from here on. Queries that need more yield "unresolved".
    pub fn set_stack_limit(&mut self, bytes: usize) {
        self.stack_base = stack_pointer();
        self.stack_limit = bytes;
    }

    /// Whether little stack is left for recursion.
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

    /// Whether half of the stack that queries may use is in use. For a recursion that
    /// typescript-go ends at `instantiationCount`, on a stack that grows.
    #[inline]
    pub(crate) fn is_half_of_stack_in_use(&self) -> bool {
        self.stack_base.saturating_sub(stack_pointer()) > self.stack_limit / 2
    }

    /// Whether a query was refused for lack of stack. Errors may be missing because of it.
    pub fn ran_out_of_stack(&self) -> bool {
        self.ran_out_of_stack.get()
    }

    /// The maximum stack in use at any query.
    pub fn deepest_stack(&self) -> usize {
        self.deepest_stack.get()
    }

    /// `false`: the query is already in progress further down the stack.
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
        // `checkExpression` and `checkPropertyAssignment` have no re-entrancy guard: an uncached check
        // runs again while it is in progress.
        if !(matches!(q, Query::Expr(..) | Query::LiteralProp(..)) && self.is_rechecking())
            && self.in_progress[class as usize] != 0
            && let Some(i) = self.stack[from..].iter().rposition(|x| *x == q)
            && self.on_reentry(q, i + from)
        {
            return false;
        }
        if self.stack.len() >= MAX_DEPTH {
            return self.refuse_as_too_deep(q);
        }
        self.last_enter = EnterOutcome::Entered;
        if self.stack.is_empty() {
            self.reset_instantiation_count_if_idle();
        }
        self.stack.push(q);
        self.in_progress[class as usize] += 1;
        if let Some((file, kind)) = q.syntax()
            && Some(file) != self.task.file
        {
            self.note_foreign_evaluation(file, kind);
        }
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
        });
        true
    }

    /// Counts the evaluation of a query about `file`, which is not the file the task is checking,
    /// if `file` is a source file in another component of the import graph. Nothing has published
    /// the result, so the task computes its own copy. A declaration file does not count: every task
    /// resolves nodes of the library for itself.
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
    /// After a refusal no query in flight is cacheable. Every later query about a part of the same
    /// expression would descend the same chain and be refused again, which costs depth^3 for nested
    /// calls. So the outermost expression in flight is recorded, and until the end of `check_file`
    /// every query about an expression inside it is refused immediately.
    #[cold]
    #[inline(never)]
    fn refuse_for_lack_of_stack(&mut self, q: Query) -> bool {
        if self.unwind_to != usize::MAX {
            if self.work == self.unwind_work && self.stack.len() > self.unwind_to {
                self.unwind_work = self.work + 1;
                self.work_trap = self.work + 1;
                self.last_enter = EnterOutcome::Refused;
                self.bailed_out_from(self.unwind_to);
                return true;
            }
            // The frame has been left, and it is not one that starts over.
            self.unwind_to = usize::MAX;
            self.restart_with = None;
        }
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
        self.bailed_out();
        true
    }

    /// `q` would be entry `MAX_DEPTH` of `stack`. Always `false`.
    ///
    /// The result of no frame in progress is cached. A frame that goes on regardless computes
    /// again, from its lower height, what the frames above it could not finish: a chain of
    /// functions that is n links too long costs n^3. So every query is refused until `stack` is
    /// back at `unwind_to`.
    ///
    /// The type of a variable, the return type of a function and the declared type of a symbol are
    /// the same from any height, if nothing in progress is a context for them. Then the outermost such frame resolves the
    /// innermost one from its own height, where that has the depth which the frames in between
    /// took, and starts over: `resolve_what_was_too_deep`. The frames below it see no refusal. A
    /// cycle that is longer than `MAX_DEPTH` never closes, and is refused again.
    #[cold]
    #[inline(never)]
    fn refuse_as_too_deep(&mut self, q: Query) -> bool {
        self.last_enter = EnterOutcome::Refused;
        bun_core::scoped_log!(
            SemaCycles,
            "too deep: {:?}",
            &self.stack[self.stack.len() - 12..]
        );
        let starts_over =
            |q: &Query| matches!(q, Query::Symbol(_) | Query::Return(..) | Query::Declared(_));
        let is_without_context = self.flow_loops.is_empty()
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
        self.unwind_work = self.work + 1;
        self.work_trap = self.work + 1;
        match (outermost, innermost) {
            (Some(outermost), Some(innermost))
                if is_without_context && self.stack[outermost] != innermost =>
            {
                self.unwind_to = outermost;
                self.restart_with = Some(innermost);
            }
            _ => {
                self.unwind_to = 0;
                self.restart_with = None;
                self.ran_out_of_stack.set(true);
            }
        }
        self.bailed_out_from(self.unwind_to);
        false
    }

    /// After the `leave` of a `Query::Symbol`, a `Query::Return` or a `Query::Declared`, if
    /// `stack.len() == unwind_to`.
    /// Returns whether the caller is to start over: what `refuse_as_too_deep` refused has a result.
    #[cold]
    #[inline(never)]
    fn resolve_what_was_too_deep(&mut self) -> bool {
        // Every `enter` since the refusal was refused in turn.
        let is_unwinding = self.unwind_work == self.work + 1;
        let restart_with = self.restart_with.take().filter(|_| is_unwinding);
        self.unwind_to = usize::MAX;
        self.work_trap = if self.refused_expressions.is_empty() {
            WORK_TRAP_DISARMED
        } else {
            self.work + 1
        };
        let is_resolved = match restart_with {
            Some(Query::Symbol(sym)) => {
                self.type_of_symbol(sym);
                self.p.symbol_types.get(&mut self.task, &sym).is_some()
            }
            Some(Query::Declared(sym)) => {
                self.declared_type(sym);
                self.p.declared_types.get(&mut self.task, &sym).is_some()
            }
            Some(Query::Return(file, func)) => {
                self.return_type_of_fn(file, func);
                let key = (file, func);
                self.p.fn_return_types.get(&mut self.task, &key).is_some()
            }
            _ => return false,
        };
        if !is_resolved {
            self.ran_out_of_stack.set(true);
            self.bailed_out();
        }
        is_resolved
    }

    /// How `enter` handles a `q` that is in progress at `stack[i]`. `false`: it is restarted.
    #[cold]
    #[inline(never)]
    fn on_reentry(&mut self, q: Query, i: usize) -> bool {
        // `findResolutionCycleStartIndex` searches no further down than a resolution that has its
        // result: the query is restarted, and arrives at that result.
        if self.is_resolution(q) && self.is_resolved_since(i) {
            return false;
        }
        // `assignParameterType` and `assignBindingElementTypes` push no type resolution, and assign
        // `links.resolvedType` at their end. A request in the meantime resolves the declaration
        // itself. Not a request that tsgo may not make (`eager`).
        if self.assigned_parameters.contains(&i) && !self.eager.iter().any(|&from| from > i) {
            return false;
        }
        // `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` sets
        // `NodeCheckFlagsContextChecked` before it assigns the parameter types. The function
        // expression is checked again, and has its type at once.
        if let Query::Expr(file, e) = q
            && let ExprKind::Fn(func) = self.hir(file)[e].kind
            && self.context_checking.iter().any(|c| c.0 == (file, func))
        {
            return false;
        }
        // `getConditionalTypeInstantiation` has no re-entrancy check and caches its result only when it returns, so the conditional type
        // is evaluated again. The recursion ends at a type resolution that detects a cycle, at members that are already installed, or
        // at an instantiation limit.
        if matches!(q, Query::Cond(..)) {
            return false;
        }
        // `checkExpression`, `checkPropertyAssignment`, `getTypeFromTypeNode` and, for a declaration
        // whose name is a pattern, `getTypeForVariableLikeDeclaration` have no re-entrancy guard. The
        // second visit takes `any` for the return type that is being resolved, or finds the members
        // in place or the intersection as it is, and closes no cycle.
        // Or it comes to the `typeToStringEx` call that led here, with no type resolution on the way,
        // and prints one serialization level higher. That can close a cycle through what the first
        // call is resolving. At `maxSerializationLevel` the printer returns "?" and resolves nothing.
        let first_printing = self.printing_floors.iter().find(|&&floor| floor > i);
        let is_through_printing = first_printing
            .is_some_and(|&floor| !self.stack[i..floor].iter().any(|&q| self.is_resolution(q)));
        if matches!(
            q,
            Query::Expr(..) | Query::LiteralProp(..) | Query::TypeNode(..) | Query::Pat(..)
        ) && !self.is_resolution(q)
            && (is_through_printing && !self.reprinting
                || self.ends_at_non_circular_return(i)
                || self.ends_at_declared_members(i)
                || self.ends_at_reduction_in_progress(i))
        {
            return false;
        }
        self.last_enter = EnterOutcome::Refused;
        // Everything in progress between there and here is computed without the result, so it is
        // provisional.
        self.mark_tainted_from(i + usize::from(!self.is_requested_eagerly(i)));
        // TypeScript does not detect an expression that is rechecked while it is being checked: it
        // follows the same path again, and the first resolution on that path is the one that
        // becomes circular.
        // A call that is queried for the contextual type of an argument while it is being resolved
        // is different (`resolvingSignature`): the caller gets no result, and that is not an error.
        // The same holds for members that are already installed, and for a path that leads to
        // `typeToStringEx` first.
        let marked = !self.ends_at_members_in_place(i)
            && (self.is_resolution(q) || !is_through_printing)
            && self.mark_cycle_from(i);
        self.found_cycle = marked && self.is_resolution(q);
        if marked && self.is_runaway(i) {
            self.last_enter = EnterOutcome::Runaway;
            bun_core::scoped_log!(SemaCycles, "RUNAWAY {:?}", q);
        }
        if self.has_members_in_place(q) {
            self.note_members_in_place();
        } else {
            self.note_cycle();
        }
        self.task.closed_a_cycle = true;
        bun_core::scoped_log!(SemaCycles, "cycle: {:?}", &self.stack[i..]);
        // `checkExpression` has no re-entrancy guard. The expression is checked again, up to the
        // resolution on that path that has just become circular, which is `any` there. So the
        // callee of a call that is resolved again has its type, and the arguments their contextual
        // types. See `recheck_in_flow_loop` for a path that ends at a loop that is visible.
        // `getTypeFromTypeNode` has none either: the node has its type for the next request.
        !(marked
            && matches!(q, Query::Expr(..) | Query::TypeNode(..))
            && self.frames[i + 1..].iter().any(|frame| frame.circular))
    }

    /// Whether `q` requests the members of a function, class, enum or module as a value, or of a
    /// mapped type.
    /// `resolveAnonymousTypeMembers` calls `setStructuredTypeMembers` before it requests the base
    /// constructor type or a signature, and `resolveMappedTypeMembers` before anything else ("such
    /// that recursive references see an empty object type"). So for any caller in the meantime
    /// `resolveStructuredTypeMembers` returns immediately.
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

    /// Whether the first resolution on the path from `stack[i]` is a return type that
    /// `getNonCircularReturnTypeOfSignature` has requested.
    fn ends_at_non_circular_return(&self, i: usize) -> bool {
        !self.non_circular_returns.is_empty()
            && (self.stack[i..].iter().position(|&q| self.is_resolution(q))).is_some_and(|above| {
                matches!(
                    self.stack[i + above],
                    Query::Return(..) | Query::ReturnOfSignature(_)
                ) && self.non_circular_returns.contains(&(i + above))
            })
    }

    /// Whether repeating the path from `stack[i]` ends before it reaches a resolution, at members
    /// whose index signatures are being resolved: `resolveDeclaredMembers` sets
    /// `declaredMembersResolved` first.
    fn ends_at_declared_members(&self, i: usize) -> bool {
        if self.declared_index_infos_in_progress.is_empty() {
            return false;
        }
        let mut from_here = self.stack[i..].iter();
        let resolution = from_here.position(|&q| self.is_resolution(q));
        let resolution = resolution.map_or(self.stack.len(), |at| i + at);
        let mut began = self.declared_index_infos_in_progress.iter();
        began.any(|it| it.0 > i && it.0 <= resolution)
    }

    /// Whether repeating the path from `stack[i]` ends before it reaches a resolution, at an
    /// intersection whose properties `getReducedType` is examining: it sets
    /// `ObjectFlagsIsNeverIntersectionComputed` first, and returns the intersection the next time.
    fn ends_at_reduction_in_progress(&self, i: usize) -> bool {
        if self.never_in_progress_from.is_empty() {
            return false;
        }
        let mut from_here = self.stack[i..].iter();
        let resolution = from_here.position(|&q| self.is_resolution(q));
        let resolution = resolution.map_or(self.stack.len(), |at| i + at);
        let mut began = self.never_in_progress_from.iter();
        began.any(|&height| height > i && height <= resolution)
    }

    /// Whether repeating the path from `stack[i]` ends before it reaches a resolution, at members
    /// that are already installed.
    fn ends_at_members_in_place(&self, i: usize) -> bool {
        let before_first_resolution = self.stack[i..]
            .iter()
            .take_while(|&&q| !self.is_resolution(q));
        before_first_resolution.enumerate().any(|(above, &q)| {
            // `resolveDeclaredMembers` has them in place while it resolves the index signatures.
            self.has_members_in_place(q)
                || (self.declared_index_infos_in_progress.iter()).any(|it| it.0 == i + above + 1)
        })
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

    /// Whether the query at `stack[i]` is itself one that TypeScript would not have made there
    /// (`eager`). What it finds in progress differs from what TypeScript finds where it does make
    /// the query: the types of the parameters of `a` are computed for `a()` behind the barrier of
    /// `getResolvedSignature`, and TypeScript asks for one after that call has returned. So a cycle
    /// that closes at it is not marked, and it has no result either.
    fn is_requested_eagerly(&self, i: usize) -> bool {
        self.eager.contains(&i) && !self.loop_values.contains(&i)
    }

    /// `pushTypeResolution` when the query is already in progress at `i`: every resolution from
    /// there up is in the cycle, and resolves to `any`. `false`, and nothing is marked: TypeScript
    /// does not search that far down, or would not have made the query.
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
        } else if self.eager.is_empty()
            && let Some(current) = self.current_node().or(self.current_source_element)
            && !matches!(current, CurrentNode::TypeNode(..))
            // `resolveMappedTypeMembers` resolves the constraint `keyof R` first, and
            // `resolveReverseMappedTypeMembers` the type of every property of the source of `R`. tsgo
            // finds a cycle through one of those there, with no mapped symbol in progress.
            && !(self.types().object_flags(mapped)).contains(ObjectFlags::HAS_REVERSE_MAPPED)
        {
            // `c.currentNode` is the expression that is being checked or, outside of one, the node
            // `checkSourceElement` is at.
            let at = self.place_of_current_node(current);
            let property = match self.prop_ref(mapped, name) {
                Some((prop, _)) => Arg::Prop(prop),
                None => Arg::Atom(name),
            };
            let diagnostic = self.new_diagnostic(at, 2615, &[property, Arg::Type(mapped)]);
            self.add_diagnostic_of(Some(Query::MappedProp(mapped, name)), diagnostic);
        }
    }

    /// Whether `q` is a query TypeScript tracks as well (`TypeSystemPropertyName`): the type of a
    /// named declaration, the return type of a function, the base types of a class or an interface,
    /// the target of a type alias, the base constraint of a type, whether the initializer of a
    /// parameter can be `undefined`.
    /// A circular one is an error there, and `any`; here any other circular query is unresolved.
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
            // A missing name is an identifier.
            Query::Pat(file, pat) => {
                matches!(
                    self.hir(file)[pat].kind,
                    PatKind::Ident(_) | PatKind::Missing
                )
            }
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

    /// See `QueryFrame::is_stored_by_nested_visit`.
    #[cold]
    #[inline(never)]
    fn note_stored_by_nested_visit(&mut self, q: Query) {
        let frames = self.frames.iter_mut().zip(&self.stack);
        for (frame, _) in frames.filter(|x| *x.1 == q) {
            frame.is_stored_by_nested_visit = true;
        }
    }

    /// Changes whenever a computation is cut short at a point that depends on the depth of the
    /// caller: an instantiation limit was hit, or the native stack ran low.
    fn cuts(&self) -> u64 {
        self.limits + self.times_cut_short.get()
    }

    /// A result that was cut short has been read. Records the same marks as recomputing it would,
    /// so that results computed from it are recorded in turn.
    fn cut_short_again(&mut self) {
        self.times_cut_short.set(self.times_cut_short.get() + 1);
        self.bailed_out();
    }

    /// A query was refused only because of the depth at which it was made. Made from elsewhere it
    /// has a result, so nothing being computed from the missing result may be cached.
    fn bailed_out(&mut self) {
        self.bailed_out_from(0);
    }

    /// `bailed_out`, where the frame at `from` makes the query again: see `refuse_as_too_deep`.
    fn bailed_out_from(&mut self, from: usize) {
        self.mark_tainted_from(from);
        self.note_cycle();
        self.refused_at = self.work;
    }

    /// `c.currentNode`. What `checkExpression` sets is derived from the queries in progress.
    /// `getTypeFromTypeNode` never sets it, but `checkSourceElement` visits a type node before
    /// anything resolves it: the type nodes `check_type_node` queries, a type node in an expression
    /// (`checkAssertion`), and the type arguments of a call (`resolveCall`). A type node reached
    /// through any other query is resolved on demand and does not change `currentNode`.
    /// `None`: `currentNode` is what `checkSourceElement` set, see `current_source_element`.
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

    /// `GetErrorRangeForNode(c.currentNode)`
    fn place_of_current_node(&self, current: CurrentNode) -> (FileId, u32, u32) {
        match current {
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
            CurrentNode::Node(file, node) => {
                let (start, end) = self.get_error_range_for_node(file, node);
                (file, start, end)
            }
        }
    }

    /// `instantiateTypeWithAlias`, `getConditionalType`: an instantiation limit was hit. Reports
    /// 2589 at `currentNode` and returns the error type. Safe to call after any `enter` that
    /// refused. Returns `UNRESOLVED` where the recursion here is no evidence of recursion in tsgo:
    /// after a refusal other than `EnterOutcome::Runaway`, and more than 60 levels of `instantiate`
    /// deep under a conditional type.
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
        self.instantiation_limit_hits += 1;
        if std::mem::replace(&mut self.last_enter, EnterOutcome::Entered) == EnterOutcome::Refused {
            return TypeId::UNRESOLVED;
        }
        self.error_at_current_node(2589);
        TypeId::ERROR
    }

    /// `checkSourceElement`, `checkDeferredNode` and `checkExpressionEx` begin with
    /// `c.instantiationCount = 0`: the limit of 5,000,000 is for one statement or expression.
    /// The checks that `check_file` runs after `check_source_file` are parts of those functions.
    /// They visit the nodes in loops of their own, and nothing marks where the check of a node
    /// begins. But whatever such a check requests begins while nothing is in progress. `enter`,
    /// `begin_comparison` and `instantiate` call this, and every instantiation is under one of
    /// them. Returns whether nothing is in progress.
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

    /// A run of `checkTypeRelatedToEx` begins, or `checkTypeAssignableToAndOptionallyElaborate`,
    /// which has several. `error_node`: its `errorNode`. Returns whether no query, instantiation
    /// or comparison is in progress, for `end_comparison`.
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
    /// tsgo checker, the task reports it once, at the node it is checking at that moment, and
    /// stores the results of the queries that began at depth 0. What a task sees is a function of
    /// the program, so which task reaches the limit, and at which node, is too.
    #[cold]
    fn error_at_current_node(&mut self, code: u32) {
        // Under `eager`, tsgo evaluates this later or never, with another `currentNode`.
        let is_reported = self.eager.is_empty();
        // Outside of an expression, `c.currentNode` is the statement or declaration that
        // `checkSourceElement` is at. The checks after `check_source_file` do not know it. The
        // `errorNode` of their comparison begins at the same position for an assignment, a
        // variable declaration and a `return` statement.
        let at = match self.current_node() {
            Some(current) => Some(self.place_of_current_node(current)),
            // A comparison without an `errorNode` that `check_source_file` makes: of a rest
            // parameter with an array type (2370), of the two types of an assertion.
            None => self.outermost_comparison.flatten().or_else(|| {
                let current = self.current_source_element?;
                Some(self.place_of_current_node(current))
            }),
        };
        let Some(at) = at.filter(|_| is_reported) else {
            // The result is the error type, to which everything is related, and tsgo reports
            // 2589. The count is reset as in tsgo, so the file is not reported as clean.
            if is_reported && self.instantiation_count >= 5_000_000 {
                self.ran_out_of_stack.set(true);
            }
            self.note_limit();
            return self.mark_tainted_from(0);
        };
        self.add_diagnostic_of(None, Reported::bare(at, code));
        // A query that began under an instantiation had less depth left than the same query has
        // from depth 0, where a finite type does not reach the limit. tsgo stores its result
        // regardless, and which types that breaks depends on the order in which it checks files.
        if let Some(from) = self.frames.iter().position(|frame| frame.entry_depth > 0) {
            self.mark_tainted_from(from);
        }
    }

    /// `checkTypeRelatedToEx` without an error node: `errorNode = c.currentNode`.
    #[cold]
    fn error_about_comparison_at_current_node(&mut self, code: u32, args: &[Arg<'_>]) {
        let current = self.current_node().or(self.current_source_element);
        if let (Some(current), true) = (current, self.eager.is_empty()) {
            let at = self.place_of_current_node(current);
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
        self.left_a_cycle = frame.circular;
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

    /// The `checkMode` parameter of `checkExpression`. Cached results are checked in
    /// `CheckModeNormal`.
    #[inline]
    fn check_mode(&self) -> CheckMode {
        if self.is_rechecking() {
            self.mode_of_recheck
        } else {
            CheckMode::empty()
        }
    }

    /// From here on, while `stack` stays at its current height, expressions are rechecked, with
    /// nothing pushed. Returns the argument for `end_recheck`.
    fn begin_recheck(&mut self) -> (usize, usize) {
        let height = self.stack.len();
        (
            std::mem::replace(&mut self.pulls_contextual_types_at, height),
            std::mem::replace(&mut self.rechecks_at, height),
        )
    }

    /// From here on, while `stack` stays at its current height, expressions are checked once
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

    /// The results of the queries from `stack[from]` up are not valid for every caller.
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

    /// The diagnostics of the innermost query are dropped, whether or not its result is cached.
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
        debug_assert!(self.left_a_cycle || self.found_cycle);
        Stored::new()
    }

    fn is_innermost_tainted(&self) -> bool {
        self.frames.last().is_some_and(|frame| frame.tainted)
    }

    fn is_innermost_in_cycle(&self) -> bool {
        self.frames.last().is_some_and(|frame| frame.circular)
    }

    /// The expressions of `file` grouped by kind, for callers that need a few kinds and would
    /// otherwise iterate over all expressions. It is built once per file. The handle borrows
    /// nothing: `let index = self.exprs_by_kind(file); for &e in index.of(ExprTag::Call)`.
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
        (self.cycles as u64, self.limits)
    }

    /// Stores `raw`, the result of `q`, for which `leave` has just returned `Err(open)`.
    /// `provisional` returns it while it is valid.
    ///
    /// A frame is non-cacheable if its result depends on a query in flight (a cycle), on a refused
    /// query (native stack, `MAX_DEPTH`, instantiation depth) or on a binding pattern whose implied
    /// type is being computed. Nothing is written to a shared cache then. The result stays valid
    /// until the outermost non-cacheable frame is popped, because everything it depends on is
    /// unchanged until then. It is stored in `provisional` for that time. Otherwise it would be
    /// computed again on every use, and a computation that uses each sub-result twice would cost
    /// 2^depth. After that frame is popped, the next use computes the result from a clean state.
    ///
    /// A result that depends on an incomplete flow-loop type is valid for a shorter time. The
    /// incomplete type of a loop changes when the traversal of one of its back edges returns. So
    /// the scope is a frame that was pushed during the traversal in progress of the innermost loop:
    /// the frame at the stack height at which that loop was pushed, or the outermost frame marked
    /// by `taint_from` if that is higher.
    ///
    /// A result that depends on a refused query (`bailed_out`) is reused only at the same or a greater
    /// stack height, where computing it again would be refused again. A query from a lower height
    /// has more capacity and may succeed, so it computes.
    ///
    /// A hit has the effects of computing the result again, and no more. A type comparison in
    /// flight is not stored in `relations` if a frame at or below its own height is tainted before
    /// it ends, so a hit that taints too much turns that memo table off.
    /// - A frame that `enter` pushed as tainted, and that no taint event reached, taints no caller
    ///   when it is computed again. A hit taints nothing. It is a hit only where `enter` would push
    ///   a tainted frame again.
    /// - Otherwise a hit taints from the lowest index of the events since the frame was pushed: one
    ///   above the cycle head. The entry is valid only while the head is in flight too.
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
                    moved: since(self.cycle_at)
                        | since(self.limit_at) << 1
                        | u8::from(flow) << 2
                        | since(self.refused_at) << 3
                        | u8::from(is_behind_barrier) << 4
                        | since(self.members_in_place_hit_at) << 5
                        | since(self.any_signature_read_at) << 6,
                    serial: scope.serial,
                },
            );
        }
    }

    /// Whether `mark_cycle_from` refuses a cycle whose head is `stack[from - 1]` because of `eager`.
    fn is_behind_barrier(&self, from: usize) -> bool {
        let above = |barriers: &[usize]| barriers.iter().filter(|&&at| at >= from).count();
        above(&self.eager) > above(&self.loop_values)
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
        // `checkExpressionCached` empties `flowLoopStack`: what follows from the incomplete type of
        // a loop is computed again where the loop is not visible.
        if entry.moved & 4 != 0 && !self.is_flow_loop_visible(depth) {
            return None;
        }
        // Without the barrier the cycle is marked.
        if entry.moved & 16 != 0 && !self.is_behind_barrier(entry.from as usize) {
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
        if entry.moved & 32 != 0 {
            self.note_members_in_place();
        }
        if entry.moved & 2 != 0 {
            self.note_limit();
        }
        if entry.moved & 64 != 0 {
            self.note_any_signature();
        }
        Some(entry.raw)
    }

    /// Increments `cycles`.
    #[inline]
    fn note_cycle(&mut self) {
        self.cycles += 1;
        self.cycle_at = self.work;
    }

    /// Increments `cycles` for a request for members that got those in place. See
    /// `members_in_place_hits`.
    #[inline]
    fn note_members_in_place(&mut self) {
        self.cycles += 1;
        self.members_in_place_hits += 1;
        self.members_in_place_hit_at = self.work;
    }

    /// Increments `any_signature_reads`.
    #[inline]
    fn note_any_signature(&mut self) {
        self.any_signature_reads += 1;
        self.any_signature_read_at = self.work;
    }

    /// Increments `limits`.
    #[inline]
    fn note_limit(&mut self) {
        self.limits += 1;
        self.limit_at = self.work;
    }

    /// A provisional value was just read, stored when `stack` was `depth` deep: the results of the
    /// queries started since then are not cached. This applies to a loop in progress:
    /// `getResolvedSignature` stores nothing while `flowLoopStack` is not empty, and
    /// `checkExpressionCached` empties it first. Their diagnostics are kept: `getTypeOfExpression`
    /// reports as usual.
    fn taint_from(&mut self, depth: usize) {
        if depth >= self.frames.len() {
            return;
        }
        self.lowest_taint = self.lowest_taint.min(depth);
        self.note_taint_event(depth);
        // `getTypeOfVariableOrParameterOrProperty` stores what `getQuickTypeOfExpression` returns,
        // which checks the callee with the loops visible.
        let quick = &self.quick_initializers;
        for (i, frame) in self.frames[depth..].iter_mut().enumerate() {
            if quick
                .iter()
                .any(|&(from, to)| (from..to).contains(&(depth + i)))
            {
                continue;
            }
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
        // A missing identifier has no text: `unknownSymbol`, for which `getTypeReferenceType`
        // returns `errorType`.
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

    #[inline]
    pub fn is_union(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::UNION != 0
    }

    /// The members of a union; the type itself otherwise; nothing for `never`.
    #[inline]
    pub fn parts(&self, ty: TypeId) -> &'p [TypeId] {
        self.types().parts(ty)
    }

    /// `TypeFlagsObject`, except for an evolving array.
    #[inline]
    pub fn is_object_type(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::OBJECT != 0 && !matches!(self.data(ty), TypeData::EvolvingArray(_))
    }

    #[inline]
    pub fn is_type_variable(&self, ty: TypeId) -> bool {
        self.flags(ty) & tf::TYPE_VARIABLE != 0
    }

    /// `ObjectFlagsAnonymous`
    pub(super) fn is_anonymous_object_type(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Anon { origin, .. } => !matches!(origin, Origin::Mapped(..)),
            TypeData::Fns { .. } | TypeData::Synth(_) => true,
            _ => false,
        }
    }

    /// A type whose members cannot be resolved before its type parameters are instantiated.
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

    /// `getUnionTypeFromSortedList` sets it on the union of the two boolean literal types, whatever
    /// alias or origin that has.
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

    /// Whether `f` holds for every member of `ty`.
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
        relate::is_fresh_literal_kind(self.data(ty))
    }

    /// The literal type as an annotation would denote it.
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

    /// The type of a mutable location initialized with `ty`: a fresh `"a"` becomes `string`.
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

    /// `getGlobalType`: the global class or interface `name` that has `arity` type parameters. Any
    /// other declaration of that name counts as missing.
    #[inline]
    pub fn global_type_of_arity(&self, name: Atom, arity: usize) -> Option<Sym> {
        self.files.global_type_of_arity(name, arity)
    }

    /// `Name<args>` for a global class or interface. If it does not exist the result is `{}`, which
    /// is a valid result, not a missing one (`createTypeFromGenericGlobalType`, and `getGlobalType`
    /// itself for one without type parameters).
    pub fn global_ref(&mut self, name: Atom, args: &[TypeId]) -> TypeId {
        match self.global_type_of_arity(name, args.len()) {
            Some(target) => self.intern_key(TypeKey::Ref { target, args }),
            None => TypeId::EMPTY_OBJECT,
        }
    }

    pub fn array_of(&mut self, element: TypeId) -> TypeId {
        self.global_ref(known::Array, &[element])
    }

    /// `globalReadonlyArrayType` is `globalArrayType` if `ReadonlyArray` does not exist.
    pub fn readonly_array_of(&mut self, element: TypeId) -> TypeId {
        let name = if self.global_type_of_arity(known::ReadonlyArray, 1).is_some() {
            known::ReadonlyArray
        } else {
            known::Array
        };
        self.global_ref(name, &[element])
    }

    /// `createPromiseType` for an awaited type: `unknown` if `Promise` does not exist.
    pub fn promise_of(&mut self, value: TypeId) -> TypeId {
        match self.global_ref(known::Promise, &[value]) {
            TypeId::EMPTY_OBJECT => TypeId::UNKNOWN,
            promise => promise,
        }
    }

    /// `createGeneratorType`: if `Generator` does not exist `IterableIterator` is used, and if
    /// neither exists, `{}`, and the missing `IterableIterator` is reported, without a file.
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
            // `getGlobalIterableIteratorTypeChecked`
            if self.global_type_symbol(iterator).is_none() {
                self.report_global_error(2318, vec![self.atom_text(iterator)]);
            }
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
            return self.intern_key(TypeKey::Tuple {
                elems,
                flags,
                readonly,
            });
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
                *info = ElemFlags::REQUIRED.with_label(info.label());
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
            return if readonly {
                self.readonly_array_of(*element)
            } else {
                self.array_of(*element)
            };
        }
        self.intern_key(TypeKey::Tuple {
            elems: &types,
            flags: &infos,
            readonly,
        })
    }

    pub fn synth(&self, shape: Shape<'s>) -> TypeId {
        self.intern(TypeData::Synth(self.boxed(shape)))
    }

    /// `T | undefined`, which only strictNullChecks distinguishes from `T`. `addOptionality`
    pub fn optional(&mut self, ty: TypeId) -> TypeId {
        if !self.p.files.options.strict_null_checks {
            return ty;
        }
        self.union(&[ty, TypeId::UNDEFINED])
    }

    /// The type read through an index signature that may have no entry, under
    /// noUncheckedIndexedAccess: `getUnionType([ty, missingType])`, regardless of strictNullChecks
    /// and exactOptionalPropertyTypes.
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

    /// The type of an optional property or element of type `ty`. `addOptionalityEx(ty, isProperty =
    /// true, true)`
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
