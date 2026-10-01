//! Answers questions about types, on demand. Nothing is computed until it is asked for, everything that is computed is
//! kept, and a question that comes back to itself is answered "unresolved".
//!
//! [`Program`] is shared by all threads and only ever grows. A [`Checker`] belongs to one thread: it has the stack of questions
//! being answered and whatever else is only true for the moment.

mod call;
mod context;
mod decl;
mod decorators;
pub mod errors;
mod errors_access;
mod errors_assign;
mod errors_call;
mod errors_circular;
mod errors_decl;
mod errors_duplicates;
mod errors_emit_helpers;
mod errors_flow;
mod errors_grammar;
mod errors_heritage;
mod errors_implicit;
mod errors_iteration;
mod errors_js;
mod errors_jsx;
mod errors_misc;
mod errors_modules;
mod errors_order;
mod errors_overloads;
mod errors_reflect_collision;
mod errors_small;
mod errors_unused;
mod errors_x_aliases;
mod errors_x_classes;
mod errors_x_enums_names;
mod errors_x_identifiers;
mod errors_x_modules;
mod errors_x_operators;
mod errors_x_properties_jsx;
pub(crate) mod errors_x_regexp_scanner;
mod errors_x_signatures;
mod errors_x_statements;
mod errors_x_typenodes;
pub mod explain;
mod explain_relation;
mod explain_table;
mod expr;
mod fix_t7;
mod fix_t8;
mod flow;
mod infer;
mod instantiate;
mod jsx;
mod mapped;
mod order;
mod print;
mod relate;
mod related;
mod shape;
mod spans;
mod symbols;
mod unions;

use crate::atom::{Atom, known};
use crate::bind::{Bound, SymFlags};
use crate::hir::{self, *};
use crate::local::MaybeLocal;
use crate::program::{FileId, Files, Sym};
use crate::table::{Bases, ById, ByIdKept, ByKey, ByNode, ByNodeKept, IdSet, NodeSet, RawWord};
use crate::types::Prop;
use crate::types::*;
use crate::util::{FxHashMap, List};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

pub use call::ResolvedCall;
pub use shape::Members;

const RECENT_SIGS: usize = 256;

/// What trying a candidate for a call came to, if none of the arguments waits for the others.
struct Trial {
    candidate: SigId,
    result: SigId,
    /// `what_only_holds_for_now` at the end of it.
    held: (u64, u64),
}

/// An answer that holds while the question at `depth` on the stack is the one numbered `serial`.
#[derive(Copy, Clone)]
struct Held {
    ty: TypeId,
    depth: usize,
    serial: u64,
    /// A question came back to itself while it was worked out.
    came_back: bool,
}

/// The type of each node of one kind.
struct Slots(ByNode<(FileId, u32), RawWord>);

impl Slots {
    fn new(bases: &Bases) -> Slots {
        Slots(ByNode::new(bases))
    }
    /// Set in a slot whose type rests on something that could not be found out.
    const UNCERTAIN: u32 = 1 << 31;

    #[inline]
    fn get(&self, file: FileId, index: usize) -> Option<TypeId> {
        match self.0.raw((file, index as u32)) & !Self::UNCERTAIN {
            0 => None,
            n => Some(TypeId(n - 1)),
        }
    }
    #[inline]
    fn set_uncertain(&self, file: FileId, index: usize, ty: TypeId) {
        self.0.set_raw(
            (file, index as u32),
            (ty.0 + 1) | Self::UNCERTAIN,
            ty.is_local(),
        );
    }
    #[inline]
    fn set(&self, file: FileId, index: usize, ty: TypeId) {
        self.0
            .set_raw((file, index as u32), ty.0 + 1, ty.is_local());
    }
}

pub struct Program {
    pub files: Files,
    pub types: TypeStore,

    expr_types: Slots,
    /// What `expr_types` would hold for a file that is at hand in some thread (see `local`): a slot for each of its expressions. A
    /// checker holds on to those of its file, and need not ask the thread for them.
    exprs_at_hand: ByIdKept<FileId, Arc<[AtomicU32]>>,
    type_node_types: Slots,
    fn_return_types: Slots,
    pat_types: Slots,
    literal_prop_types: Slots,
    symbol_types: ByNode<Sym, TypeId>,
    /// The names, functions and members whose type depends on itself.
    circular_pats: NodeSet<(FileId, PatId)>,
    circular_returns: NodeSet<(FileId, FnId)>,
    circular_members: NodeSet<(FileId, MemberId)>,
    /// Properties declared by assignment declarations whose type depends on itself, keyed by the first declaration
    /// (`symbol.ValueDeclaration`). `reportCircularityError` reports 7022 there.
    circular_assignments: NodeSet<(FileId, ExprId)>,
    /// Symbols whose `Query::Symbol` was part of a resolution cycle. `reportCircularityError` reports 7022 for `export default e`,
    /// `export = e` and CommonJS exports.
    circular_symbols: NodeSet<Sym>,
    /// References whose control flow walk reached depth 2000 (2563). `getTypeAtFlowNode`
    flows_too_deep: NodeSet<(FileId, ExprId)>,
    /// The classes and interfaces whose base types depend on themselves, the aliases that do, and the mapped types whose keys do.
    circular_bases: NodeSet<Sym>,
    circular_aliases: NodeSet<Sym>,
    circular_mapped_keys: NodeSet<(FileId, TypeNodeId)>,
    /// Type nodes at which 2615 is reported: the type of a property of a mapped type depends on itself. See
    /// `first_checked_type_node`.
    circular_mapped_props: NodeSet<(FileId, TypeNodeId)>,
    /// `GetGlobalDiagnostics`: what is wrong and is in no file. `Cannot find global type 'Array'.` The code, and what goes into the message.
    global_errors: std::sync::Mutex<std::collections::BTreeSet<(u32, Vec<String>)>>,
    /// Which property of which mapped type it is, for the message.
    circular_mapped_prop_names: ByNodeKept<(FileId, TypeNodeId), (TypeId, Atom)>,
    /// `MappedType.containsError`
    mapped_types_with_errors: IdSet<TypeId>,
    /// Type nodes whose resolution produced a tuple of 10,000 or more elements (2799). `TupleNormalizer.normalize`
    too_large_tuples: NodeSet<(FileId, TypeNodeId)>,
    /// The variables in a circle that goes through a call: whoever asks first is told what the initializer comes to.
    circular_through_call: NodeSet<(FileId, PatId)>,
    /// `NodeCheckFlagsInitializerIsUndefinedComputed` and `NodeCheckFlagsInitializerIsUndefined`
    initializer_is_undefined: ByNode<(FileId, ParamId), bool>,
    declared_types: ByNode<Sym, TypeId>,
    /// The unions that a type alias, or an alias with type arguments, stands for.
    named_unions: IdSet<TypeId>,
    /// The unions that have been seen to have no intersection among their members.
    unions_without_intersections: IdSet<TypeId>,
    /// The generic references made from a deferred type reference node (`isDeferredTypeReferenceNode`), and their generic instantiations.
    deferred_references: IdSet<TypeId>,
    /// `UnionType.origin` of a union that `getIntersectionTypeEx` produced by distributing an intersection over its union
    /// members: the members of that intersection.
    union_origins: ByIdKept<TypeId, Arc<[TypeId]>>,
    /// The generic alias and the arguments a type was made from (`Type.alias`), for a type that could not have come of other
    /// arguments or without the alias. Types are hash-consed: `T | undefined` is the same type whoever wrote it, and has none.
    alias_of: ByIdKept<TypeId, (Sym, Arc<[TypeId]>)>,
    shapes: ByIdKept<TypeId, shape::Resolved>,
    /// `intersectionTypes`, for those that have a union among them.
    distributed_intersections: ByKey<(Box<[TypeId]>, bool), TypeId>,
    /// See `note_alias_of_union`.
    /// For putting types into words: the first type alias without type parameters, in the order of the files and outside the default
    /// library, that is written as a union or an intersection and stands for the type. Filled in at once, when it is first asked for:
    /// what a message says does not go by what happens to have been looked at before.
    plain_alias_of: ById<TypeId, Option<Sym>>,
    are_plain_aliases_known: std::sync::OnceLock<()>,
    /// How many files somebody has taken on to find out what their aliases stand for.
    plain_aliases_resolved: std::sync::atomic::AtomicUsize,
    generic_union_aliases: NodeSet<Sym>,
    sig_params: ByIdKept<SigId, Box<[SigParam]>>,
    sig_type_params: ByIdKept<SigId, Box<[TypeId]>>,
    call_signatures: ByIdKept<TypeId, Box<[SigId]>>,
    construct_signatures: ByIdKept<TypeId, Box<[SigId]>>,
    /// By the first of several signatures: the list they are in, then the same list in the order `candidates_in_order` puts it in.
    candidate_orders: ByIdKept<SigId, Box<[SigId]>>,
    /// What `members` says of a type, once that holds for good.
    members: ById<TypeId, shape::KeptMembers>,
    instantiations: ByKey<(TypeId, MapperId), TypeId>,
    outer_type_params: ByNodeKept<(FileId, crate::bind::ScopeId), Arc<[TypeId]>>,
    /// `type_param`
    declared_type_params: ByNode<(FileId, TypeParamId), TypeId>,
    /// `identity_mapper`
    identity_mappers: ByNode<(FileId, crate::bind::ScopeId), MapperId>,
    base_types: ByNodeKept<Sym, Arc<[TypeId]>>,
    calls: ByNode<(FileId, ExprId), ResolvedCall>,
    /// `getCandidateForOverloadFailure` for a failed call with a single signature. `calls` holds the signature that the errors
    /// are reported against.
    failure_sigs: ByNode<(FileId, ExprId), SigId>,
    /// What `resolveCall` reported of a call the first time it was resolved again while it was being resolved, with the notes.
    said_of_calls_resolved_again:
        ByNodeKept<(FileId, ExprId), (Vec<errors::Diagnostic>, Vec<explain::Note>)>,
    /// The contextual type of an argument that has to wait for the others, once the call knows it.
    arg_contexts: ByNode<(FileId, ExprId), TypeId>,
    /// Calls with a `const` type parameter in some overload that are resolved to an overload before it, or that it does not apply to.
    calls_outside_const_context: NodeSet<(FileId, ExprId)>,
    relations: ByKey<(TypeId, TypeId, u8), u8>,
    variances: ByNodeKept<Sym, Arc<[u8]>>,
    member_types: ByNode<(FileId, MemberId), TypeId>,
    /// `resolvedType` of a property declared by assignment declarations, keyed by the first declaration.
    assigned_prop_types: ByNode<(FileId, ExprId), TypeId>,
    /// `awaited_no_alias`, asked on its own account, once it holds for good.
    awaited_types: ById<TypeId, Option<TypeId>>,
    /// `resolvedType` of a property of a mapped type, keyed by the mapped type and the property name. `getTypeOfMappedSymbol`
    mapped_prop_types: ByKey<(TypeId, Atom), TypeId>,
    /// See `optional_property_kept`.
    optional_properties: ById<TypeId, TypeId>,
    intersected_props: ByKey<(TypeId, Atom), TypeId>,
    /// `isDiscriminantProperty`, by union and property name.
    discriminants: ByKey<(TypeId, Atom), bool>,
    never_intersections: ById<TypeId, bool>,
    /// `getMappedTargetWithSymbol` of a mapped type.
    mapped_targets: ById<TypeId, TypeId>,
    inferred_constraints: ById<TypeId, Option<TypeId>>,
    constraints: ById<TypeId, TypeId>,
    /// See `holder_of_index_signatures`.
    tuple_bases: ById<TypeId, TypeId>,
    /// `T | undefined` for `T`: see `optional_kept`.
    optional_types: ById<TypeId, TypeId>,
    /// `global_ref` of a name, without type arguments.
    plain_global_refs: ById<Atom, TypeId>,
    /// The types whose base constraint depends on itself (`circularConstraintType`).
    circular_constraints: IdSet<TypeId>,
    /// `constraint_of_type_param` of a type parameter, once it holds for good.
    type_param_constraints: ById<TypeId, Option<TypeId>>,
    enum_values: ByNodeKept<(FileId, EnumMemberId), Option<EnumValue>>,
    /// `default_of_type_param` of a type parameter, once it holds for good.
    type_param_defaults: ById<TypeId, Option<TypeId>>,
    conditionals: ByKey<(FileId, TypeNodeId, MapperId), TypeId>,
    /// What the parameter of each mapped type extends, if anything. See `constraint_of_mapped_param`.
    mapped_param_constraints: ByNode<(FileId, TypeNodeId), Option<TypeId>>,
    /// Memo entries whose evaluation hit an instantiation limit, and those 2589 has been reported for. See `note_depth`.
    excessive: ByKey<Deep, ()>,
    excessive_reported: ByKey<Deep, ()>,
    /// Whether `excessive` has an entry. Saves the lookup on every memo hit.
    has_excessive: AtomicBool,
    /// What `global_type_of_arity` found, by name and number of type parameters.
    global_types: ByKey<(Atom, u8), Option<Sym>>,
    /// `global_type_symbol`, of the names known from the start.
    global_type_symbols: ById<Atom, Option<Sym>>,
    /// The parent type node of each type node, per file. See `type_parents`.
    type_parents: ByIdKept<FileId, Arc<Vec<TypeNodeId>>>,
    /// `String`, `Number` and the like, as `apparent_type` has them for the primitives, by name.
    wrapper_types: ById<Atom, TypeId>,
}

impl Program {
    /// Where the memory of what has been worked out is: what, how many, how many bytes.
    pub fn sizes(&self) -> Vec<(String, usize, usize)> {
        let mut out = self.types.sizes();
        let (mut count, mut bytes) = (0, 0);
        for resolved in self.shapes.kept() {
            count += 1;
            bytes += resolved.bytes();
        }
        out.push(("shapes".to_owned(), count, bytes));
        let boxes = |name: &str, lens: &mut dyn Iterator<Item = usize>, size: usize| {
            let (mut count, mut bytes) = (0, 0);
            for len in lens {
                count += 1;
                bytes += 16 + len * size + if len > 0 { 16 } else { 0 };
            }
            (name.to_owned(), count, bytes)
        };
        out.push(boxes(
            "kept: parameters of signatures",
            &mut self.sig_params.kept().map(|b| b.len()),
            size_of::<SigParam>(),
        ));
        out.push(boxes(
            "kept: type parameters of signatures",
            &mut self.sig_type_params.kept().map(|b| b.len()),
            4,
        ));
        out.push(boxes(
            "kept: call signatures of types",
            &mut self.call_signatures.kept().map(|b| b.len()),
            4,
        ));
        out.push(boxes(
            "kept: construct signatures of types",
            &mut self.construct_signatures.kept().map(|b| b.len()),
            4,
        ));
        out.push(boxes(
            "kept: union origins",
            &mut self.union_origins.kept().map(|b| b.len()),
            4,
        ));
        out.push(boxes(
            "kept: aliases of types",
            &mut self.alias_of.kept().map(|b| b.1.len() + 4),
            4,
        ));
        let map = |name: &str, len: usize, entry: usize| (name.to_owned(), len, len * (entry + 11));
        out.push(map("map: instantiations", self.instantiations.len(), 12));
        out.push(map("map: relations", self.relations.len(), 12));
        out.push(map("map: conditionals", self.conditionals.len(), 16));
        out.push(map(
            "map: mapped property types",
            self.mapped_prop_types.len(),
            12,
        ));
        out.push(map(
            "map: intersected properties",
            self.intersected_props.len(),
            12,
        ));
        let mut by_node = |name: &str, (cells, used, size): (usize, usize, usize)| {
            out.push((
                format!("by node: {name} ({used} of {cells} cells in use)"),
                cells,
                cells * size,
            ));
        };
        by_node("expression types", self.expr_types.0.fill());
        by_node("type node types", self.type_node_types.0.fill());
        by_node("return types", self.fn_return_types.0.fill());
        by_node("binding types", self.pat_types.0.fill());
        by_node("literal property types", self.literal_prop_types.0.fill());
        by_node("symbol types", self.symbol_types.fill());
        by_node("declared types", self.declared_types.fill());
        by_node("calls", self.calls.fill());
        by_node("failure signatures", self.failure_sigs.fill());
        by_node("argument contexts", self.arg_contexts.fill());
        by_node("assigned property types", self.assigned_prop_types.fill());
        by_node("member types", self.member_types.fill());
        out
    }

    pub fn new(files: Files) -> Program {
        let bases = |len: fn(&crate::program::Module) -> usize| {
            Bases::new(files.modules.iter().map(|m| len(m)))
        };
        let exprs = bases(|m| m.hir.exprs.len());
        let type_nodes = bases(|m| m.hir.types.len());
        let fns = bases(|m| m.hir.fns.len());
        let pats = bases(|m| m.hir.pats.len());
        let props = bases(|m| m.hir.props.len());
        let members = bases(|m| m.hir.members.len());
        let params = bases(|m| m.hir.params.len());
        let enum_members = bases(|m| m.hir.enum_members.len());
        let scopes = bases(|m| m.bound.scopes.len());
        let type_params = bases(|m| m.hir.type_params.len());
        let symbols = bases(|m| m.bound.symbols.len());
        Program {
            types: TypeStore::new(),
            expr_types: Slots::new(&exprs),
            exprs_at_hand: Default::default(),
            type_node_types: Slots::new(&type_nodes),
            fn_return_types: Slots::new(&fns),
            pat_types: Slots::new(&pats),
            literal_prop_types: Slots::new(&props),
            symbol_types: ByNode::new(&symbols),
            circular_pats: NodeSet::new(&pats),
            circular_returns: NodeSet::new(&fns),
            circular_members: NodeSet::new(&members),
            circular_assignments: NodeSet::new(&exprs),
            circular_symbols: NodeSet::new(&symbols),
            flows_too_deep: NodeSet::new(&exprs),
            circular_bases: NodeSet::new(&symbols),
            circular_aliases: NodeSet::new(&symbols),
            circular_mapped_keys: NodeSet::new(&type_nodes),
            circular_mapped_props: NodeSet::new(&type_nodes),
            global_errors: Default::default(),
            circular_mapped_prop_names: ByNodeKept::new(&type_nodes),
            mapped_types_with_errors: Default::default(),
            too_large_tuples: NodeSet::new(&type_nodes),
            circular_through_call: NodeSet::new(&pats),
            initializer_is_undefined: ByNode::new(&params),
            declared_types: ByNode::new(&symbols),
            named_unions: Default::default(),
            unions_without_intersections: Default::default(),
            deferred_references: Default::default(),
            union_origins: Default::default(),
            alias_of: Default::default(),
            shapes: Default::default(),
            distributed_intersections: Default::default(),
            plain_alias_of: Default::default(),
            are_plain_aliases_known: Default::default(),
            plain_aliases_resolved: Default::default(),
            generic_union_aliases: NodeSet::new(&symbols),
            sig_params: Default::default(),
            sig_type_params: Default::default(),
            call_signatures: Default::default(),
            construct_signatures: Default::default(),
            candidate_orders: Default::default(),
            members: Default::default(),
            instantiations: Default::default(),
            outer_type_params: ByNodeKept::new(&scopes),
            declared_type_params: ByNode::new(&type_params),
            identity_mappers: ByNode::new(&scopes),
            base_types: ByNodeKept::new(&symbols),
            calls: ByNode::new(&exprs),
            failure_sigs: ByNode::new(&exprs),
            said_of_calls_resolved_again: ByNodeKept::new(&exprs),
            arg_contexts: ByNode::new(&exprs),
            calls_outside_const_context: NodeSet::new(&exprs),
            relations: Default::default(),
            variances: ByNodeKept::new(&symbols),
            member_types: ByNode::new(&members),
            assigned_prop_types: ByNode::new(&exprs),
            awaited_types: Default::default(),
            mapped_prop_types: Default::default(),
            optional_properties: Default::default(),
            intersected_props: Default::default(),
            discriminants: Default::default(),
            never_intersections: Default::default(),
            mapped_targets: Default::default(),
            inferred_constraints: Default::default(),
            constraints: Default::default(),
            tuple_bases: Default::default(),
            optional_types: Default::default(),
            plain_global_refs: Default::default(),
            circular_constraints: Default::default(),
            type_param_constraints: Default::default(),
            enum_values: ByNodeKept::new(&enum_members),
            type_param_defaults: Default::default(),
            conditionals: Default::default(),
            mapped_param_constraints: ByNode::new(&type_nodes),
            excessive: Default::default(),
            excessive_reported: Default::default(),
            has_excessive: AtomicBool::new(false),
            global_types: Default::default(),
            global_type_symbols: Default::default(),
            type_parents: Default::default(),
            wrapper_types: Default::default(),
            files,
        }
    }

    /// `GetGlobalDiagnostics`: what has been found wrong that is in no file, once all files have been checked. In order, each once.
    pub fn global_errors(&self) -> Vec<(u32, Vec<String>)> {
        // `initializeChecker`: these there have to be, whether or not anything uses them.
        let mut needed = vec![
            "IArguments",
            "Array",
            "Object",
            "Function",
            "String",
            "Number",
            "Boolean",
            "RegExp",
        ];
        // `getGlobalStrictFunctionType`
        if self.files.options.strict_bind_call_apply {
            needed.extend(["CallableFunction", "NewableFunction"]);
        }
        let mut all = self.global_errors.lock().unwrap().clone();
        for name in needed {
            let is_there = self
                .files
                .atoms
                .lookup(name.as_bytes())
                .is_some_and(|atom| self.files.global(atom, SymFlags::TYPE).is_some());
            if !is_there {
                all.insert((2318, vec![name.to_owned()]));
            }
        }
        all.into_iter().collect()
    }

    pub fn checker(&self) -> Checker<'_> {
        let file_at_hand = FileId(crate::local::file());
        let empty_slots =
            |count: usize| -> Arc<[AtomicU32]> { (0..count).map(|_| AtomicU32::new(0)).collect() };
        let exprs_at_hand = if file_at_hand.0 == u32::MAX {
            empty_slots(0)
        } else {
            self.exprs_at_hand.get(&file_at_hand).unwrap_or_else(|| {
                let count = self.files.hir(file_at_hand).exprs.len();
                self.exprs_at_hand.insert(file_at_hand, empty_slots(count))
            })
        };
        Checker {
            p: self,
            file_at_hand,
            exprs_at_hand,
            stack: Vec::new(),
            frames: Vec::new(),
            pending_circular_mapped_props: Vec::new(),
            last_enter: EnterOutcome::Entered,
            resolution_start: 0,
            asking_for_context: false,
            eager: Vec::new(),
            loop_values: Vec::new(),
            contextual_binding_patterns: Vec::new(),
            reporting_nonexistent: Vec::new(),
            came_full_circle: false,
            left_a_circle: false,
            cycles: 0,
            depth: 0,
            contextual: Vec::new(),
            inference: Vec::new(),
            instantiation_depth: 0,
            recent_instantiations: Default::default(),
            deferring_type_arguments: 0,
            reports_depth: false,
            deep_events: 0,
            unreported_event: 0,
            aliased_reference: false,
            excessive_at: Vec::new(),
            free_relaters: Vec::new(),
            reliability: 0,
            in_variance_computation: false,
            variances_in_progress: Vec::new(),
            simplified: FxHashMap::default(),
            cond_true_memo: FxHashMap::default(),
            cond_distributive_memo: FxHashMap::default(),
            relation_gave_up: false,
            relation_too_complex: false,
            relation_too_deep: false,
            checking: None,
            never_in_progress: Vec::new(),
            recent_members: Box::new([shape::RecentMembers::NONE; shape::RECENT_MEMBERS]),
            recent_signatures: Box::new(
                [(TypeId(u32::MAX), &[] as &[SigId]); shape::RECENT_SIGNATURES],
            ),
            recent_intersected_props: Box::new(
                [((TypeId(u32::MAX), Atom::NONE), TypeId::NEVER); shape::RECENT_PROPS],
            ),
            retracing: false,
            explaining: Vec::new(),
            keeps_arg_contexts: false,
            context_checked_for: FxHashMap::default(),
            uncertain: false,
            union_too_complex: false,
            recent_unions: Default::default(),
            deadline: None,
            constraint_stack: Vec::new(),
            trap_on_timeout: std::env::var_os("BUN_SEMA_TIME_TRAP").is_some(),
            trap_on_low_stack: std::env::var_os("BUN_SEMA_DEBUG_STACK").is_some(),
            deepest_stack: std::cell::Cell::new(0),
            ran_out_of_stack: std::cell::Cell::new(false),
            exprs_by_kind: None,
            shapes_for_now: Vec::new(),
            held_for_now: FxHashMap::default(),
            trials: FxHashMap::default(),
            named_plain_aliases_of: None,
            explains: false,
            only_syntax: false,
            notes: Default::default(),
            timed_out: false,
            ticks: 0,
            flow_depth: 0,
            inline_level: 0,
            walk_declared: TypeId::NEVER,
            constant_depth: 0,
            recent_sig_params: Box::new([(SigId(u32::MAX), &[] as &[SigParam]); RECENT_SIGS]),
            recent_sig_type_params: Box::new([(SigId(u32::MAX), &[] as &[TypeId]); RECENT_SIGS]),
            awaiting: Vec::new(),
            reachability_crosses_functions: false,
            reachability_past_exhaustive_switches: false,
            iife_resolving: Vec::new(),
            starts_unassigned: false,
            inferential: None,
            flow_loops: Vec::new(),
            met_loop_under_way: false,
            reverse_mapped_source_stack: Vec::new(),
            reverse_mapped_target_stack: Vec::new(),
            reverse_expanding: 0,
            discriminants: FxHashMap::default(),
            flow_memo: Default::default(),
            skip_binding_patterns: 0,
            discriminated: FxHashMap::default(),
            optional_member: false,
            contextual_properties: FxHashMap::default(),
            candidate_holes: Vec::new(),
            trace_cycles: std::env::var_os("BUN_SEMA_TRACE_CYCLES").is_some(),
            trace_relations: std::env::var_os("BUN_SEMA_TRACE_RELATIONS").is_some(),
            trace_slow_relations: std::env::var_os("BUN_SEMA_TRACE_SLOW_RELATIONS").is_some(),
            resolving: Vec::new(),
            pending_failure_sig: None,
            jsx_resolving: Vec::new(),
            prepared: Default::default(),
            last_prepared: (FileId(u32::MAX), FnId::NONE),
            prepared_exprs: (FileId(u32::MAX), Vec::new()),
            provisional: 0,
            provisional_floor: 0,
            provisional_arg_contexts: FxHashMap::default(),
            forces_provisional_contexts: false,
            outside_const_context: Vec::new(),
            stack_base: stack_pointer(),
            stack_limit: 6 << 20,
            work: 0,
            work_trap: std::env::var("BUN_SEMA_WORK_TRAP")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(u64::MAX),
        }
    }
}

/// A question that may come back to itself.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Query {
    Expr(FileId, ExprId),
    Symbol(Sym),
    Declared(Sym),
    Return(FileId, FnId),
    Shape(TypeId),
    Bases(Sym),
    Constraint(TypeId),
    InferredConstraint(TypeId),
    Call(FileId, ExprId),
    Pat(FileId, PatId),
    LiteralProp(FileId, PropId),
    TypeNode(FileId, TypeNodeId),
    Member(FileId, MemberId),
    /// The type of a property declared by assignment declarations, identified by the first declaration (`symbol.ValueDeclaration`).
    Assigned(FileId, ExprId),
    /// The type of a property of a mapped type: the mapped type and the property name. `getTypeOfMappedSymbol`
    MappedProp(TypeId, Atom),
    Enum(FileId, EnumMemberId),
    Cond(FileId, TypeNodeId, MapperId),
    /// Whether the initializer of a parameter can be `undefined`.
    InitializerIsUndefined(FileId, ParamId),
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

/// The key of a memo entry that `note_depth` tracks.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) enum Deep {
    /// `Program::instantiations`
    Instantiation(TypeId, MapperId),
    /// `Program::conditionals`
    Conditional(FileId, TypeNodeId, MapperId),
}

impl MaybeLocal for Deep {
    #[inline]
    fn is_local(&self) -> bool {
        match self {
            Deep::Instantiation(ty, mapper) => ty.is_local() || mapper.is_local(),
            Deep::Conditional(file, _, mapper) => file.is_local() || mapper.is_local(),
        }
    }
}

/// `Checker.currentNode`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum CurrentNode {
    Expr(FileId, ExprId),
    TypeNode(FileId, TypeNodeId),
}

const MAX_DEPTH: usize = 220;

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
}

pub struct Checker<'p> {
    pub p: &'p Program,
    stack: Vec<Query>,
    /// For each entry of `stack`.
    frames: Vec<QueryFrame>,
    /// For each open `Query::MappedProp` that is part of a cycle: its index in `stack` and the type node to report 2615 at.
    /// `circular_mapped_property` commits the entry when the query is left.
    pending_circular_mapped_props: Vec<(usize, (FileId, TypeNodeId))>,
    /// How the last `enter` ended. `leave` and `excessively_deep` reset it to `Entered`.
    last_enter: EnterOutcome,
    /// The patterns whose implied type is being worked out to be what their initializer is expected to be, and how deep the
    /// stack was when that began.
    contextual_binding_patterns: Vec<(FileId, PatId, usize)>,
    /// `nonExistentProperties`: property accesses whose 2339 message is being printed, with `stack.len()` when printing started.
    reporting_nonexistent: Vec<(FileId, ExprId, usize)>,
    /// How deep the stack was wherever something was asked that TypeScript would not have asked at that point, or not yet.
    /// A circle that goes through there may be nobody's fault but the resolver's: it is unknown, not an error.
    eager: Vec<usize>,
    /// The entries of `eager` that stand for the value assigned on the back edge of a loop that is being worked out. TypeScript asks
    /// for that value there as well: see `is_circle_of_initializers`.
    loop_values: Vec<usize>,
    /// A call is being asked what it expects of an argument, not what it gives.
    asking_for_context: bool,
    /// From where in `stack` on a question counts as under way.
    resolution_start: usize,
    /// Why the last `enter` refused: what was asked is one of TypeScript's own resolutions and is under way.
    came_full_circle: bool,
    /// What the last `leave` left was in a circle.
    left_a_circle: bool,
    /// How many questions have come back to themselves.
    cycles: u64,
    depth: usize,
    /// Expressions that are being checked against a type somebody pushed, innermost last.
    contextual: Vec<(FileId, ExprId, TypeId)>,
    inference: Vec<infer::Inference>,
    instantiation_depth: u32,
    /// What was last read from or put into `Program::instantiations`.
    recent_instantiations: instantiate::Recent,
    /// How many `instantiate_deferred_type_arguments` are trying an argument: a limit hit meanwhile is not reported.
    deferring_type_arguments: u32,
    /// Set while `check_excessive_depth` runs: an instantiation limit is reported at `current_node`.
    reports_depth: bool,
    /// How many times an instantiation limit was hit, or a memo entry that depends on one was read. A change across an
    /// evaluation means that the error type of a limit went into the result.
    deep_events: u64,
    /// `deep_events` after the last hit that could not be reported.
    unreported_event: u64,
    /// `getAliasSymbolForTypeNode`: the type reference being resolved is the whole body of a type alias.
    aliased_reference: bool,
    /// Where 2589 was reported (file, start). `check_excessive_depth` drains it.
    excessive_at: Vec<(FileId, u32)>,
    free_relaters: Vec<relate::Relater>,
    /// What the comparisons under way found out about how far the variance being measured can be trusted.
    reliability: u8,
    in_variance_computation: bool,
    variances_in_progress: Vec<Sym>,
    simplified: FxHashMap<(TypeId, bool), TypeId>,
    /// `resolvedTrueType`, keyed by the conditional type and whether it is read as a source.
    cond_true_memo: FxHashMap<(TypeId, bool), TypeId>,
    /// `resolvedConstraintOfDistributive`. `None` is `noConstraintType`.
    cond_distributive_memo: FxHashMap<TypeId, Option<TypeId>>,
    /// A comparison was cut short. What it answered is not to be told anybody.
    pub(super) relation_gave_up: bool,
    /// Set when a comparison exhausts `Relater::relation_count` (2859). The caller clears it before comparing.
    pub(super) relation_too_complex: bool,
    /// Set when a comparison reaches 100 nested comparisons (2321). The caller clears it before comparing.
    pub(super) relation_too_deep: bool,
    /// The file whose errors are being looked for. For debugging.
    pub(super) checking: Option<FileId>,
    /// The intersections it is being found out of whether anything can be them.
    pub(super) never_in_progress: Vec<TypeId>,
    /// What was last found in `Program::members`, in the tables of signatures and in `intersected_props`, by the low bits of the key.
    recent_members: Box<[shape::RecentMembers<'p>; shape::RECENT_MEMBERS]>,
    recent_signatures: Box<[(TypeId, &'p [SigId]); shape::RECENT_SIGNATURES]>,
    recent_intersected_props: Box<[((TypeId, Atom), TypeId); shape::RECENT_PROPS]>,
    /// For debugging: a relation is gone through again, without what is remembered of relations, and printed.
    pub(super) retracing: bool,
    /// The pairs `explain_not_assignable` is on its way through.
    pub(super) explaining: Vec<(TypeId, TypeId)>,
    /// A call that is resolved is gone over again, for its errors: what its arguments are expected to be stays what it is.
    pub(super) keeps_arg_contexts: bool,
    /// `NodeCheckFlagsContextChecked` for function expressions among the arguments of a call with several candidates: the candidate
    /// whose attempt checked the function first. Only that attempt infers from the function's annotations. `None` once the attempt
    /// has ended.
    pub(super) context_checked_for: FxHashMap<(FileId, ExprId), Option<SigId>>,
    /// Since it was last reset, narrowing went by something whose type could not be found out: an assigned value, what may
    /// be a type guard. What came of it is a guess, and nothing is to be reported on the strength of it.
    pub(super) uncertain: bool,
    /// Set when `union_reduced` or `intersection_ex` gives up on a union that is too complex to represent (2590). The caller
    /// clears it first.
    pub(super) union_too_complex: bool,
    /// What `union` last made of two types, the one with the lower number first.
    recent_unions: instantiate::Recent,
    deadline: Option<std::time::Instant>,
    /// The `stack` of `getResolvedBaseConstraint`: what the constraints being worked out, one for the sake of the other, are instances of.
    constraint_stack: Vec<relate::RecursionId>,
    trap_on_timeout: bool,
    trap_on_low_stack: bool,
    deepest_stack: std::cell::Cell<usize>,
    ran_out_of_stack: std::cell::Cell<bool>,
    /// Of the file that was last asked about.
    exprs_by_kind: Option<(FileId, std::rc::Rc<hir::ExprsByKind>)>,
    /// The file at hand in this thread when the checker was made: see `local`. `u32::MAX` if there was none.
    file_at_hand: FileId,
    /// See `Program::exprs_at_hand`.
    exprs_at_hand: Arc<[AtomicU32]>,
    /// See `shape_for_now`.
    shapes_for_now: Vec<Box<shape::Resolved>>,
    /// The types of properties of object literals that only hold for now: see `hold_for_now`.
    held_for_now: FxHashMap<(FileId, PropId), Held>,
    /// The last candidate tried for a call that is being resolved: see `instantiate_for_call_as`.
    trials: FxHashMap<(FileId, ExprId), Trial>,
    /// The file at hand whose type aliases `plain_alias_of` has been filled in for.
    named_plain_aliases_of: Option<FileId>,
    /// What is noted of errors is kept: somebody is going to read it.
    explains: bool,
    /// `GetSyntacticDiagnostics`: only what the parser and the scanner say is reported.
    only_syntax: bool,
    notes: std::cell::RefCell<Vec<explain::Note>>,
    timed_out: bool,
    ticks: u32,
    flow_depth: u32,
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
    /// Whether a function that is written where control cannot get to counts as unreachable itself.
    reachability_crosses_functions: bool,
    /// Whether a `switch` that leaves nothing out can be got past, as far as `is_reachable` goes. That there is nothing left a
    /// variable can be there is something known of it: only where control cannot get at all is nothing known.
    reachability_past_exhaustive_switches: bool,
    /// The calls of functions written on the spot whose arguments are being looked at to type the parameters.
    iife_resolving: Vec<(FileId, ExprId)>,
    /// The reference whose flow is being walked holds `undefined` until something is assigned to it.
    starts_unassigned: bool,
    /// The argument whose type is asked for in order to infer from it: its type variables stay (`CheckModeInferential`).
    pub(super) inferential: Option<(FileId, ExprId)>,
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
    /// Set when a reference evaluates to `silentNeverType`: a `never` narrowed from the incomplete type of a loop under analysis
    /// (`newFlowType`).
    met_loop_under_way: bool,
    /// What mapped types were made from is being worked out from what they came to, for these.
    reverse_mapped_source_stack: Vec<TypeId>,
    reverse_mapped_target_stack: Vec<TypeId>,
    reverse_expanding: u8,
    discriminants: FxHashMap<(TypeId, Atom), bool>,
    /// What narrowing has worked out once and for all.
    flow_memo: flow::FlowMemo,
    trace_cycles: bool,
    /// Say which property or signature a relation between two object types fails on.
    pub(super) trace_relations: bool,
    trace_slow_relations: bool,
    /// Asking what is expected regardless of what patterns imply.
    skip_binding_patterns: u32,
    /// `discriminatedContextualTypes`: what `discriminate_by_object_members` makes of an object literal and a union, where
    /// that holds for good.
    discriminated: FxHashMap<(FileId, ExprId, TypeId), TypeId>,
    /// The member `infer_from_member` is about to look at may be left out.
    optional_member: bool,
    /// See `contextual_property_of_value`.
    contextual_properties: FxHashMap<(TypeId, Atom), Option<TypeId>>,
    /// For each overloaded call being resolved: the type parameters of its candidates, as holes.
    candidate_holes: Vec<call::CandidateHoles>,
    /// The next target to be related to is a member of an intersection.
    resolving: Vec<call::Resolving<'p>>,
    /// The `failure_sigs` entry of the call that `resolve_among` just resolved. `resolve_call` takes it, and stores it only together
    /// with the entry of `calls`.
    pending_failure_sig: Option<SigId>,
    /// The JSX elements whose components' type arguments are being worked out, and what each takes for properties.
    jsx_resolving: Vec<(FileId, ExprId, TypeId)>,
    /// Functions whose context `prepare_enclosing` has seen to.
    prepared: crate::util::FxHashSet<(FileId, FnId)>,
    last_prepared: (FileId, FnId),
    /// A file, and which of its expressions have been through `prepare_around`.
    prepared_exprs: (FileId, Vec<bool>),
    /// Non-zero while types are computed under assumptions that may not hold: nothing is kept.
    provisional: u32,
    /// How many questions were open when the outermost trial began.
    provisional_floor: usize,
    provisional_arg_contexts: FxHashMap<(FileId, ExprId), TypeId>,
    /// Every contextual type recorded now belongs to a trial.
    forces_provisional_contexts: bool,
    /// The calls whose overloads without a `const` type parameter are being tried.
    outside_const_context: Vec<(FileId, ExprId)>,
    /// Where the stack was when the checker was made, and how far below that it may go.
    stack_base: usize,
    stack_limit: usize,
    /// Questions asked so far.
    pub work: u64,
    /// For finding what does not end: panic at this many. `BUN_SEMA_WORK_TRAP`.
    work_trap: u64,
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
        self.p.files.hir(file)
    }

    #[inline]
    pub fn bound(&self, file: FileId) -> &'p Bound {
        self.p.files.bound(file)
    }

    #[inline]
    pub fn data(&self, ty: TypeId) -> &'p TypeData {
        self.p.types.get(ty)
    }

    #[inline]
    pub fn intern(&self, data: TypeData) -> TypeId {
        self.p.types.intern(data)
    }

    /// The type parameter `tp` of `file`, as declared.
    #[inline]
    pub fn type_param(&self, file: FileId, tp: TypeParamId) -> TypeId {
        match self.p.declared_type_params.get(&(file, tp)) {
            Some(kept) => kept,
            None => self.intern_type_param(file, tp),
        }
    }

    #[inline(never)]
    fn intern_type_param(&self, file: FileId, tp: TypeParamId) -> TypeId {
        let made = self.intern(TypeData::TypeParam(file, tp, MapperId::IDENTITY));
        self.p.declared_type_params.insert((file, tp), made)
    }

    /// `cloneTypeParameter`: the type parameter `tp` of a signature found where the type parameters around the signature stand
    /// for what `around` says. Where each stands for itself nothing was instantiated, and it is the declared one
    /// (`resolveObjectTypeMembers`, `getObjectTypeInstantiation`).
    pub fn cloned_type_param(&self, file: FileId, tp: TypeParamId, around: MapperId) -> TypeId {
        let around = if self.p.types.mapping(around).iter().all(|p| p.0 == p.1) {
            MapperId::IDENTITY
        } else {
            around
        };
        self.intern(TypeData::TypeParam(file, tp, around))
    }

    #[inline]
    fn files(&self) -> &'p Files {
        &self.p.files
    }

    /// `node.Parent` for each type node of `file`, as `getConditionalFlowTypeOfType` walks it. Empty for a file without a
    /// conditional type.
    pub(super) fn type_parents(&self, file: FileId) -> Arc<Vec<TypeNodeId>> {
        if let Some(cached) = self.p.type_parents.get(&file) {
            return cached;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let has_conditional = hir
            .types
            .iter()
            .any(|node| matches!(node.kind, TypeNodeKind::Cond { .. }));
        let parents = if has_conditional {
            Self::type_node_parents(hir, bound)
        } else {
            Vec::new()
        };
        self.p.type_parents.insert(file, Arc::new(parents))
    }

    // ───────────────────────────── questions in progress ─────────────────────────────

    /// From now on only what the parser and the scanner say of a file is reported: `GetSyntacticDiagnostics`.
    pub fn set_only_syntax(&mut self, only_syntax: bool) {
        self.only_syntax = only_syntax;
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

    /// For finding runaway recursion: `BUN_SEMA_DEBUG_STACK=1`.
    #[inline]
    pub(crate) fn guard(&self, what: &str) {
        if self.trap_on_low_stack {
            self.trap_if_stack_is_low(what);
        }
    }

    #[cold]
    #[inline(never)]
    fn trap_if_stack_is_low(&self, what: &str) {
        if self.is_stack_low() {
            panic!(
                "stack low in {what}: {:?}\n{}",
                &self.stack[self.stack.len().saturating_sub(30)..],
                std::backtrace::Backtrace::force_capture()
            );
        }
    }

    /// From now on, no more than `limit` is spent. What is not known by then stays unknown, and nothing is said about it.
    pub fn set_time_limit(&mut self, limit: std::time::Duration) {
        self.deadline = Some(std::time::Instant::now() + limit);
        self.timed_out = false;
    }

    pub fn timed_out(&self) -> bool {
        self.timed_out
    }

    /// For finding what does not end: `BUN_SEMA_TIME_TRAP=1` stops with a backtrace where the time limit is passed.
    #[inline]
    pub(crate) fn time_trap(&mut self) {
        if self.trap_on_timeout {
            self.trap_if_out_of_time();
        }
    }

    #[cold]
    #[inline(never)]
    fn trap_if_out_of_time(&mut self) {
        if self.is_out_of_time() {
            if let Some(&Query::Cond(file, node, _)) = self
                .stack
                .iter()
                .rev()
                .find(|q| matches!(q, Query::Cond(..)))
            {
                eprintln!(
                    "CONDITIONAL {} at {}",
                    self.files().module(file).path,
                    self.hir(file)[node].pos
                );
            }
            for query in &self.stack {
                let at = match *query {
                    Query::Expr(file, e) | Query::Call(file, e) => {
                        Some((file, self.hir(file)[e].pos))
                    }
                    Query::LiteralProp(file, p) => {
                        let value = self.hir(file)[p].value;
                        value.is_some().then(|| (file, self.hir(file)[value].pos))
                    }
                    _ => None,
                };
                if let Some((file, pos)) = at {
                    eprintln!("  {query:?} {}:{pos}", self.files().module(file).path);
                }
            }
            panic!(
                "out of time: {:?}\n{}",
                &self.stack,
                std::backtrace::Backtrace::force_capture()
            );
        }
    }

    /// Looks at the clock once in a while.
    #[inline]
    fn is_out_of_time(&mut self) -> bool {
        if self.timed_out {
            return true;
        }
        self.ticks = self.ticks.wrapping_add(1);
        self.ticks & 0x3ff == 0 && self.is_past_the_deadline()
    }

    #[cold]
    #[inline(never)]
    fn is_past_the_deadline(&mut self) -> bool {
        if let Some(deadline) = self.deadline
            && std::time::Instant::now() > deadline
        {
            self.timed_out = true;
        }
        self.timed_out
    }

    /// `false`: the question is being answered further down the stack.
    #[inline]
    fn enter(&mut self, q: Query) -> bool {
        self.work += 1;
        self.came_full_circle = false;
        if self.is_out_of_time() || self.work == self.work_trap || self.is_stack_low() {
            return self.refuse_for_lack_of_time_or_stack();
        }
        // To one who asks what it expects of an argument, a call under way is under way however long ago it was begun.
        let from = if matches!(q, Query::Call(..)) && self.asking_for_context {
            0
        } else {
            self.resolution_start
        };
        if let Some(i) = self.stack[from..].iter().rposition(|x| *x == q)
            && self.comes_back_to(q, i + from)
        {
            return false;
        }
        if self.stack.len() >= MAX_DEPTH {
            return self.refuse_as_too_deep();
        }
        self.last_enter = EnterOutcome::Entered;
        self.stack.push(q);
        self.frames.push(QueryFrame {
            serial: self.work,
            entry_depth: self.instantiation_depth,
            tainted: false,
            circular: false,
        });
        true
    }

    #[cold]
    #[inline(never)]
    fn refuse_for_lack_of_time_or_stack(&mut self) -> bool {
        self.last_enter = EnterOutcome::Refused;
        if !self.timed_out {
            if self.work == self.work_trap {
                panic!(
                    "work trap: {:?}\n{}",
                    &self.stack,
                    std::backtrace::Backtrace::force_capture()
                );
            }
            if std::env::var_os("BUN_SEMA_DEBUG_STACK").is_some() {
                panic!(
                    "stack low: {:?}\n{}",
                    &self.stack[self.stack.len().saturating_sub(30)..],
                    std::backtrace::Backtrace::force_capture()
                );
            }
        }
        self.gave_up();
        false
    }

    #[cold]
    #[inline(never)]
    fn refuse_as_too_deep(&mut self) -> bool {
        self.last_enter = EnterOutcome::Refused;
        if self.trace_cycles {
            eprintln!("too deep: {:?}", &self.stack[self.stack.len() - 12..]);
        }
        self.gave_up();
        false
    }

    /// What `enter` makes of a `q` that is under way at `stack[i]`. `false`: it is begun once more.
    #[cold]
    #[inline(never)]
    fn comes_back_to(&mut self, q: Query, i: usize) -> bool {
        // `findResolutionCycleStartIndex` looks no further down than a resolution that has its answer: what is asked for is
        // begun once more, and comes to that answer.
        if self.is_resolution(q) && self.is_answered_since(i) {
            return false;
        }
        self.last_enter = EnterOutcome::Refused;
        // What is being computed between there and here is computed without the answer, so it only holds for now.
        self.mark_tainted_from(i + 1);
        // TypeScript does not notice an expression that is looked at again while it is being looked at: it goes the
        // same way once more, and the first resolution on that way is the one to come back to itself.
        // A call that is asked what it expects of an argument while it is being resolved is another matter
        // (`resolvingSignature`): whoever asks goes without an answer, and nothing is wrong.
        let marked =
            !(matches!(q, Query::Call(..)) && self.asking_for_context) && self.mark_circle_from(i);
        self.came_full_circle = marked && self.is_resolution(q);
        if marked && self.is_runaway(i) {
            self.last_enter = EnterOutcome::Runaway;
            if self.trace_cycles {
                eprintln!("RUNAWAY {q:?}");
            }
        }
        self.cycles += 1;
        if self.trace_cycles {
            eprintln!("cycle: {:?}", &self.stack[i..]);
        }
        true
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
            && !cycle
                .windows(2)
                .any(|pair| is_type_node(&pair[0]) && is_type_node(&pair[1]))
            && !(is_type_node(&cycle[0]) && cycle.last().is_some_and(is_type_node))
            && frames
                .windows(2)
                .all(|pair| pair[1].entry_depth <= pair[0].entry_depth + 1)
            && frames
                .last()
                .is_some_and(|last| self.instantiation_depth <= last.entry_depth + 1)
    }

    /// `pushTypeResolution` finding what is asked for under way at `i`: everything from there up that is a resolution is in the
    /// circle, and comes to `any`. `false`, and nothing is marked: TypeScript does not look that far down, or would not have asked.
    fn mark_circle_from(&mut self, i: usize) -> bool {
        if i < self.resolution_start || self.is_answered_since(i) {
            return false;
        }
        // Every entry of `loop_values` is an entry of `eager` too.
        let barriers = self.eager.iter().filter(|&&from| from > i).count();
        let loop_values = self.loop_values.iter().filter(|&&from| from > i).count();
        if barriers > loop_values || barriers > 0 && !self.is_circle_of_initializers(i) {
            return false;
        }
        // The first resolution of a call hides what is below it, itself included: one that can be seen is resolved again. So does a
        // variable that is in a circle already: it has had its answer since the circle was found (`typeResolutionHasProperty`).
        let through_call = self.stack[i..].iter().any(|q| matches!(q, Query::Call(..)))
            || self.stack[..i]
                .iter()
                .zip(&self.frames[..i])
                .any(|(q, frame)| frame.circular && matches!(q, Query::Pat(..) | Query::Symbol(_)));
        for j in i..self.stack.len() {
            let q = self.stack[j];
            if !self.is_resolution(q) {
                continue;
            }
            if self.trace_cycles && !self.frames[j].circular {
                eprintln!("CIRCLE {:?} in {:?}", q, &self.stack[i..]);
                if std::env::var_os("BUN_SEMA_TRAP_CIRCLE").is_some() {
                    panic!("circle\n{}", std::backtrace::Backtrace::force_capture());
                }
            }
            self.frames[j].circular = true;
            if through_call && let Query::Pat(file, pat) = q {
                self.p.circular_through_call.insert((file, pat), ());
            }
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
            self.p.circular_mapped_props.insert(node, ());
            self.p.mapped_types_with_errors.insert(mapped, ());
            self.p
                .circular_mapped_prop_names
                .insert(node, (mapped, name));
        }
    }

    /// Whether `q` is a question TypeScript keeps track of as well (`TypeSystemPropertyName`): the type of something with a name,
    /// what a function returns, what a class or an interface extends, what a type alias stands for, the base constraint of a type,
    /// whether the initializer of a parameter can be `undefined`.
    /// One that depends on itself is an error there, and `any`; here anything else that does is unknown.
    fn is_resolution(&self, q: Query) -> bool {
        match q {
            Query::Return(..)
            | Query::Member(..)
            | Query::Assigned(..)
            | Query::MappedProp(..)
            | Query::Bases(_)
            | Query::Constraint(_)
            | Query::InitializerIsUndefined(..) => true,
            // `getTypeOfSymbol` tests for a variable or a property first. `getTypeOfFuncClassEnumModule` and `getTypeOfEnumMember`
            // push no resolution.
            Query::Symbol(sym) => {
                let flags = self.files().flags(sym);
                flags.intersects(
                    SymFlags::VARIABLE | SymFlags::EXPORT_VALUE | SymFlags::MODULE_EXPORTS,
                ) || !flags.intersects(
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

    /// `typeResolutionHasProperty`, of the resolutions from `i` up: whether one that is under way has been given its answer
    /// meanwhile, by the same question asked where this one could not be seen, or by another thread.
    fn is_answered_since(&self, i: usize) -> bool {
        self.stack[i..].iter().any(|&q| {
            self.is_resolution(q)
                && match q {
                    Query::Symbol(sym) => self.p.symbol_types.get(&sym).is_some(),
                    Query::Pat(file, pat) => self.p.pat_types.get(file, pat.idx()).is_some(),
                    Query::Return(file, func) => {
                        self.p.fn_return_types.get(file, func.idx()).is_some()
                    }
                    Query::Member(file, member) => {
                        self.p.member_types.get(&(file, member)).is_some()
                    }
                    Query::Assigned(file, first) => {
                        self.p.assigned_prop_types.get(&(file, first)).is_some()
                    }
                    Query::MappedProp(mapped, name) => {
                        self.p.mapped_prop_types.get(&(mapped, name)).is_some()
                    }
                    Query::Declared(sym) => self.p.declared_types.get(&sym).is_some(),
                    Query::Bases(sym) => self.p.base_types.get(&sym).is_some(),
                    Query::Constraint(ty) => self.p.constraints.get(&ty).is_some(),
                    Query::InitializerIsUndefined(file, param) => self
                        .p
                        .initializer_is_undefined
                        .get(&(file, param))
                        .is_some(),
                    _ => false,
                }
        })
    }

    /// A question went unanswered only because of how deep it was asked. Asked from elsewhere it has an answer, so
    /// nothing that is being computed from the lack of one may be kept.
    fn gave_up(&mut self) {
        self.mark_tainted_from(0);
        self.cycles += 1;
    }

    /// `c.currentNode`, derived from the queries in progress. `checkExpression` always sets it. `getTypeFromTypeNode` never does, but
    /// `checkSourceElement` visits a type node before anything resolves it: the type nodes `check_excessive_depth` starts from, a
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
    /// after a refusal other than `EnterOutcome::Runaway`, and at the depth limit of `instantiate` under a conditional type.
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
        self.record_excessive_depth();
        TypeId::ANY
    }

    /// Counts one hit of an instantiation limit. Returns whether 2589 was reported for it.
    fn record_excessive_depth(&mut self) -> bool {
        self.deep_events += 1;
        self.p.has_excessive.store(true, Ordering::Relaxed);
        // tsgo instantiates the type arguments of a deferred type reference later, with another `currentNode`.
        if self.deferring_type_arguments > 0 {
            self.unreported_event = self.deep_events;
            return false;
        }
        // Under `eager`, tsgo evaluates this later or never, with another `currentNode`.
        if self.reports_depth
            && self.eager.is_empty()
            && let Some(current) = self.current_node()
        {
            let at = match current {
                CurrentNode::Expr(file, e) => (file, self.error_start_inside_parentheses(file, e)),
                CurrentNode::TypeNode(file, node) => (file, self.hir(file)[node].pos),
            };
            self.excessive_at.push(at);
            return true;
        }
        // There is no node to report at. No open query is memoized, so `check_excessive_depth` evaluates them again in check order.
        // `cycles` stays as it is: `instantiations` keeps its entries, which bounds the repeated work.
        self.unreported_event = self.deep_events;
        self.mark_tainted_from(0);
        false
    }

    /// Tracks the memo entries that depend on an instantiation limit. tsgo caches the error type like any other result, so it
    /// reports 2589 once per cache entry, at the node that is current when the entry is computed. We may compute an entry with no
    /// node to report at. The first memo hit that has one then stands for that computation.
    /// `events`: `Some(deep_events before the evaluation)` if `key` was just evaluated and is about to be memoized, `None` if `key`
    /// was found in its memo.
    #[inline]
    pub(super) fn note_depth(&mut self, key: Deep, events: Option<u64>) {
        let is_relevant = match events {
            Some(before) => self.deep_events != before,
            None => self.p.has_excessive.load(Ordering::Relaxed),
        };
        if is_relevant {
            self.note_excessive(key, events);
        }
    }

    fn note_excessive(&mut self, key: Deep, events: Option<u64>) {
        let is_reported = match events {
            Some(before) => {
                self.p.excessive.insert(key, ());
                self.unreported_event <= before
            }
            None => {
                if self.p.excessive.get(&key).is_none() {
                    return;
                }
                if self.p.excessive_reported.get(&key).is_some() {
                    self.deep_events += 1;
                    return;
                }
                self.record_excessive_depth()
            }
        };
        if is_reported {
            self.p.excessive_reported.insert(key, ());
        }
    }

    /// Whether the answer holds whoever asks, and so may be kept.
    #[inline]
    fn leave(&mut self) -> bool {
        self.stack.pop();
        self.last_enter = EnterOutcome::Entered;
        let frame = self.frames.pop().unwrap();
        self.left_a_circle = frame.circular;
        !frame.tainted
    }

    /// The answers to the questions from `stack[from]` up do not hold whoever asks.
    fn mark_tainted_from(&mut self, from: usize) {
        for frame in &mut self.frames[from..] {
            frame.tainted = true;
        }
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
            Some((of, index)) if *of == file => index.clone(),
            _ => {
                let index = std::rc::Rc::new(hir::ExprsByKind::new(self.hir(file)));
                self.exprs_by_kind = Some((file, index.clone()));
                index
            }
        }
    }

    /// Changes whenever something happens that keeps what is being worked out from holding for whoever asks next: a question came back to
    /// itself, something was read that rests on a candidate being tried out, or an instantiation went too deep, which is said again
    /// to everybody who gets there.
    #[inline]
    fn what_only_holds_for_now(&self) -> (u64, u64) {
        (self.cycles as u64, self.deep_events as u64)
    }

    /// An answer that was worked out while something it rests on was still open (a question it came back to, a candidate being tried
    /// out) does not hold for good. It does hold for as long as the outermost question that does not hold for good either is open:
    /// until then everything it rests on stays as it is. Asked again meanwhile, it is not worked out again. Without this, questions
    /// that each lead to all the others, like the rows of a table that is expected to be an array of its own rows, are gone through
    /// in every order there is.
    fn hold_for_now(&mut self, file: FileId, p: PropId, ty: TypeId, came_back: bool) {
        if let Some(outermost) = self.frames.iter().position(|frame| frame.tainted) {
            self.held_for_now.insert(
                (file, p),
                Held {
                    ty,
                    depth: outermost,
                    serial: self.frames[outermost].serial,
                    came_back,
                },
            );
        }
    }

    /// What `hold_for_now` was told, if it still holds. Whatever is being worked out from it does not hold for good either.
    fn held_for_now(&mut self, file: FileId, p: PropId) -> Option<TypeId> {
        if self.held_for_now.is_empty() {
            return None;
        }
        if self.stack.is_empty() {
            self.held_for_now.clear();
            return None;
        }
        let held = *self.held_for_now.get(&(file, p))?;
        if self.frames.get(held.depth).map(|frame| frame.serial) != Some(held.serial) {
            self.held_for_now.remove(&(file, p));
            return None;
        }
        // Reading it leaves the marks that working it out again would: `cycles` moves only if it did then.
        if held.came_back {
            self.taint_from(held.depth);
        } else {
            self.mark_tainted_from(held.depth);
        }
        Some(held.ty)
    }

    /// Something that only holds while a candidate is tried out was just read: what is being computed from it, up to
    /// where the trial began, does not hold afterwards. Everything else computed meanwhile does, and is kept.
    fn note_provisional_read(&mut self) {
        if self.provisional == 0 {
            return;
        }
        self.mark_tainted_from(self.provisional_floor.min(self.frames.len()));
        self.cycles += 1;
    }

    /// Something that only holds for now was just read, put there when `stack` was `depth` deep: the answers to the questions
    /// begun since are not kept. So of a loop under way: `getResolvedSignature` stores nothing while `flowLoopStack` has
    /// something on it, and `checkExpressionCached` empties it first.
    fn taint_from(&mut self, depth: usize) {
        if depth >= self.frames.len() {
            return;
        }
        self.mark_tainted_from(depth);
        self.cycles += 1;
    }

    /// Whether what is being computed right now depends on a trial.
    fn is_provisional_here(&self) -> bool {
        self.provisional > 0
            && self.frames.len() > self.provisional_floor
            && self.is_innermost_tainted()
    }

    // ───────────────────────────── kinds of types ─────────────────────────────

    #[inline]
    pub fn is_any(&self, ty: TypeId) -> bool {
        ty == TypeId::ANY || ty == TypeId::UNRESOLVED
    }

    #[inline]
    pub fn has_type_variables(&self, ty: TypeId) -> bool {
        self.p
            .types
            .flags(ty)
            .contains(TypeFlags::HAS_TYPE_VARIABLES)
    }

    pub fn is_union(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Union(_))
    }

    /// The members of a union; the type itself otherwise; nothing for `never`.
    #[inline]
    pub fn parts(&self, ty: TypeId) -> &'p [TypeId] {
        self.p.types.parts(ty)
    }

    pub fn is_object_type(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Ref { .. }
                | TypeData::Tuple { .. }
                | TypeData::Anon { .. }
                | TypeData::Fns { .. }
                | TypeData::Synth(_)
                | TypeData::ReverseMapped { .. }
        )
    }

    pub fn is_type_variable(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::TypeParam(..)
                | TypeData::ThisParam(_)
                | TypeData::Marker(_)
                | TypeData::IndexedAccess { .. }
        )
    }

    /// A type whose members cannot be known before its type parameters are.
    pub fn is_deferred(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::TypeParam(..)
                | TypeData::ThisParam(_)
                | TypeData::Marker(_)
                | TypeData::IndexedAccess { .. }
                | TypeData::Cond { .. }
                | TypeData::Keyof(_)
        )
    }

    pub fn is_literal(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::StringLit { .. }
                | TypeData::NumberLit { .. }
                | TypeData::BigIntLit { .. }
                | TypeData::BoolLit { .. }
                | TypeData::EnumLit { .. }
        )
    }

    /// A type with one value. `void` is not one. `TypeFlagsUnit`
    pub fn is_unit(&self, ty: TypeId) -> bool {
        self.is_literal(ty)
            || ty.is_undefined()
            || ty.is_null()
            || matches!(
                self.data(ty),
                TypeData::UniqueSymbol { .. } | TypeData::Enum { .. }
            )
    }

    pub fn is_string_like(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Intrinsic(Intrinsic::String)
            | TypeData::StringLit { .. }
            | TypeData::Template { .. }
            | TypeData::StringMapping { .. }
            | TypeData::EnumLit {
                value: EnumValue::String(_),
                ..
            } => true,
            _ => false,
        }
    }

    pub fn is_number_like(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Intrinsic(Intrinsic::Number)
                | TypeData::NumberLit { .. }
                | TypeData::EnumLit {
                    value: EnumValue::Number(_),
                    ..
                }
                | TypeData::Enum { .. }
        )
    }

    pub fn is_bigint_like(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Intrinsic(Intrinsic::BigInt) | TypeData::BigIntLit { .. }
        )
    }

    pub fn is_boolean_like(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::BoolLit { .. })
    }

    pub fn is_symbol_like(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Intrinsic(Intrinsic::Symbol) | TypeData::UniqueSymbol { .. }
        )
    }

    pub fn is_nullish(&self, ty: TypeId) -> bool {
        ty.is_undefined() || ty.is_null() || ty == TypeId::VOID
    }

    pub fn is_primitive(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Intrinsic(
                Intrinsic::String | Intrinsic::Number | Intrinsic::BigInt | Intrinsic::Symbol,
            )
            | TypeData::StringLit { .. }
            | TypeData::NumberLit { .. }
            | TypeData::BigIntLit { .. }
            | TypeData::BoolLit { .. }
            | TypeData::EnumLit { .. }
            | TypeData::Enum { .. }
            | TypeData::UniqueSymbol { .. }
            | TypeData::Template { .. }
            | TypeData::StringMapping { .. } => true,
            _ => self.is_nullish(ty),
        }
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
                let members: Vec<TypeId> = members
                    .iter()
                    .map(|&m| self.with_freshness(m, false))
                    .collect();
                self.union(&members)
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
            TypeData::Union(members) => {
                let members: Vec<TypeId> =
                    members.iter().map(|&m| self.base_of_literal(m)).collect();
                self.union(&members)
            }
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
                let members: Vec<TypeId> = members.iter().map(|&m| self.widen_literal(m)).collect();
                self.union(&members)
            }
            _ if self.is_fresh_literal(ty) => self.base_of_literal(ty),
            _ => ty,
        }
    }

    // ───────────────────────────── well-known global types ─────────────────────────────

    /// An error that is in no file: `c.error(nil, ..)`.
    pub(super) fn report_global_error(&self, code: u32, args: Vec<String>) {
        self.p.global_errors.lock().unwrap().insert((code, args));
    }

    pub fn global_type_symbol(&self, name: Atom) -> Option<Sym> {
        // The table goes by the number of the name: it is for the names known from the start, which come first.
        if name.0 >= known::sym_iterator.0 {
            return self.files().global(name, SymFlags::TYPE);
        }
        if let Some(kept) = self.p.global_type_symbols.get(&name) {
            return kept;
        }
        let files = self.files();
        let found = files.global(name, SymFlags::TYPE);
        // What an alias means is a matter of what it stands for, which may be under way.
        if files
            .globals
            .get(&name)
            .is_none_or(|&sym| !files.flags(sym).contains(SymFlags::ALIAS))
        {
            self.p.global_type_symbols.insert(name, found);
        }
        found
    }

    /// `getGlobalType`: the global class or interface `name` that has `arity` type parameters. Anything else of that name is as
    /// good as nothing.
    pub fn global_type_of_arity(&self, name: Atom, arity: usize) -> Option<Sym> {
        let key = (name, arity as u8);
        if let Some(found) = self.p.global_types.get(&key) {
            return found;
        }
        let found = self.global_type_symbol(name).filter(|&sym| {
            self.files()
                .flags(sym)
                .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
                && self.type_argument_arity(sym).1 == arity
        });
        self.p.global_types.insert(key, found)
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

    /// `createPromiseLikeType`, of what has been awaited.
    pub fn promise_like_of(&mut self, value: TypeId) -> TypeId {
        match self.global_ref(known::PromiseLike, &[value]) {
            TypeId::EMPTY_OBJECT => TypeId::UNKNOWN,
            promise => promise,
        }
    }

    /// `createPromiseReturnType`, without its errors: what is in error can be anything.
    pub fn promise_return_of(&mut self, value: TypeId) -> TypeId {
        match self.promise_of(value) {
            TypeId::UNKNOWN => TypeId::ANY,
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

    fn is_global_ref(&self, ty: TypeId, name: Atom) -> Option<&'p [TypeId]> {
        match self.data(ty) {
            TypeData::Ref { target, args } if self.files().symbol(*target).name == name => {
                (self.global_type_symbol(name) == Some(*target)).then_some(&**args)
            }
            _ => None,
        }
    }

    /// The element type of `T[]` or `readonly T[]`.
    pub fn array_element(&self, ty: TypeId) -> Option<TypeId> {
        let TypeData::Ref { target, args } = self.data(ty) else {
            return None;
        };
        let name = self.files().symbol(*target).name;
        if (name == known::Array || name == known::ReadonlyArray)
            && self.global_type_symbol(name) == Some(*target)
        {
            args.first().copied()
        } else {
            None
        }
    }

    pub fn is_array(&self, ty: TypeId) -> bool {
        self.array_element(ty).is_some()
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
                *info = ElemFlags::REQUIRED;
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
        if let ([element], [ElemFlags::REST]) = (&types[..], &infos[..]) {
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
