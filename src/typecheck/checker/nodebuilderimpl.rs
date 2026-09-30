// checker/nodebuilderimpl.go: how types, symbols and signatures become synthetic nodes. The receiver `b` is the unit handle plus the checker, whose field `node_builder.impl_` holds the state.
use crate::ast::{
    Ast, Kind, NodeFlags, NodeId, NodeListId, SymbolFlags, SymbolId, get_source_file_of_node,
    is_identifier, is_import_type_node, is_type_reference_node,
};
use crate::checker::symboltracker::SymbolTrackerImpl;
use crate::checker::{
    Checker, ObjectFlags, SignatureFlags, SignatureId, TypeFacts, TypeFlags, TypeId, TypeMapperId,
    is_optional_declaration,
};
use crate::collections::{CopyOnWriteMap, CopyOnWriteSet, Set};
use crate::nodebuilder::{Flags, InternalFlags};
use crate::printer::SymbolAccessibility;
use crate::printer::{EmitContext, NodeFactory, new_node_factory};
use crate::pseudochecker::{PseudoChecker, new_pseudo_checker};
use bun_collections::HashMap;

// Upstream keys these records by ast.GetSymbolId and ast.GetNodeId: the ids of this port are the identities.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct CompositeSymbolIdentity {
    pub is_constructor_node: bool,
    pub symbol_id: SymbolId,
    pub node_id: NodeId,
}

#[derive(Clone, Copy, Debug)]
pub struct TrackedSymbolArgs {
    pub symbol: SymbolId,
    pub enclosing_declaration: NodeId,
    pub meaning: SymbolFlags,
}

#[derive(Clone, Default)]
pub struct SerializedTypeEntry {
    pub node: NodeId,
    pub truncating: bool,
    pub added_length: isize,
    pub tracked_symbols: Vec<TrackedSymbolArgs>,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct CompositeTypeCacheIdentity {
    pub type_id: TypeId,
    pub flags: Flags,
    pub internal_flags: InternalFlags,
}

#[derive(Default)]
pub struct NodeBuilderLinks {
    // Collection of types serialized at this location
    pub serialized_types: HashMap<CompositeTypeCacheIdentity, SerializedTypeEntry>,
    // If present, this is a fake scope injected into an enclosing declaration chain.
    pub fake_scope_for_signature_declaration: Option<Vec<u8>>,
}

// `specifierCache` is a module.ModeAwareCache upstream: a map keyed by the name and the resolution mode.
#[derive(Default)]
pub struct NodeBuilderSymbolLinks {
    pub specifier_cache: HashMap<(Vec<u8>, ModuleKind), Vec<u8>>,
}

// `host` is the program of the checker and has no field here.
#[derive(Default)]
pub struct NodeBuilderContext {
    pub tracker: SymbolTrackerImpl,
    pub approximate_length: isize,
    pub max_truncation_length: isize,
    pub encountered_error: bool,
    pub truncating: bool,
    pub reported_diagnostic: bool,
    pub flags: Flags,
    pub internal_flags: InternalFlags,
    pub depth: isize,
    // -1 means no expansion, 0+ = verbosity levels
    pub max_expansion_depth: isize,
    pub type_stack: Vec<TypeId>,
    pub can_increase_expansion_depth: bool,
    pub expansion_truncated: bool,
    pub enclosing_declaration: NodeId,
    pub enclosing_file: NodeId,
    pub infer_type_parameters: Vec<TypeId>,
    pub visited_types: Set<TypeId>,
    pub symbol_depth: HashMap<CompositeSymbolIdentity, isize>,
    pub tracked_symbols: Vec<TrackedSymbolArgs>,
    pub mapper: TypeMapperId,
    pub reverse_mapped_stack: Vec<SymbolId>,
    pub enclosing_symbol_types: HashMap<SymbolId, TypeId>,
    pub suppress_report_inference_fallback: bool,
    pub remapped_symbol_references: HashMap<SymbolId, SymbolId>,
    // per signature scope state
    pub type_parameter_names: CopyOnWriteMap<TypeId, NodeId>,
    pub type_parameter_names_by_text: CopyOnWriteSet<Vec<u8>>,
    pub type_parameter_names_by_text_next_name_count: CopyOnWriteMap<Vec<u8>, isize>,
    pub type_parameter_symbol_list: CopyOnWriteSet<SymbolId>,
}

// The fields of NodeBuilderImpl. `f` is made from the emit context on demand and `ch` is the checker that owns this state.
#[derive(Default)]
pub struct NodeBuilderImplState {
    pub e: EmitContext,
    pub pc: PseudoChecker,
    // cache
    pub links: HashMap<NodeId, NodeBuilderLinks>,
    pub symbol_links: HashMap<SymbolId, NodeBuilderSymbolLinks>,
    // state
    pub ctx: Option<Box<NodeBuilderContext>>,
    // What a read or a write of a nil context gets: upstream dereferences nil there.
    pub nil_ctx: NodeBuilderContext,
    // symbols for synthesized identifiers, needed for e.g. inlay hints
    pub id_to_symbol: HashMap<NodeId, SymbolId>,
}

impl NodeBuilderImplState {
    pub fn ctx(&self) -> &NodeBuilderContext {
        match self.ctx.as_deref() {
            Some(ctx) => ctx,
            None => &self.nil_ctx,
        }
    }

    pub fn ctx_mut(&mut self) -> &mut NodeBuilderContext {
        let Self { ctx, nil_ctx, .. } = self;
        match ctx.as_deref_mut() {
            Some(ctx) => ctx,
            None => nil_ctx,
        }
    }
}

pub const DEFAULT_MAXIMUM_TRUNCATION_LENGTH: isize = 160;
pub const NO_TRUNCATION_MAXIMUM_TRUNCATION_LENGTH: isize = 1_000_000;

// `*NodeBuilderImpl`: the receiver of the upstream methods.
#[derive(Clone, Copy, Default)]
pub struct NodeBuilderImpl;

// What saveRestoreFlags captures: upstream returns a function that puts these back.
#[derive(Clone, Copy)]
pub struct SavedFlags {
    flags: Flags,
    internal_flags: InternalFlags,
    depth: isize,
}

// Node builder utility functions

pub fn new_node_builder_impl(
    ch: &Checker<'_>,
    e: EmitContext,
    id_to_symbol: Option<HashMap<NodeId, SymbolId>>,
) -> NodeBuilderImplState {
    let id_to_symbol = id_to_symbol.unwrap_or_default();
    NodeBuilderImplState {
        e,
        id_to_symbol,
        pc: new_pseudo_checker(ch.strict_null_checks, ch.exact_optional_property_types),
        ..NodeBuilderImplState::default()
    }
}

impl NodeBuilderImpl {
    #[inline]
    pub(crate) fn ctx<'c>(self, c: &'c Checker<'_>) -> &'c NodeBuilderContext {
        c.node_builder.impl_.ctx()
    }

    #[inline]
    pub(crate) fn ctx_mut<'c>(self, c: &'c mut Checker<'_>) -> &'c mut NodeBuilderContext {
        c.node_builder.impl_.ctx_mut()
    }

    // `b.f`: the node factory of the emit context, whose hooks mark and link the nodes it makes.
    #[inline]
    pub(crate) fn f<'c>(self, c: &'c mut Checker<'_>) -> NodeFactory<'c> {
        new_node_factory(c.ast, &mut c.node_builder.impl_.e)
    }

    pub(crate) fn save_restore_flags(self, c: &Checker<'_>) -> SavedFlags {
        let ctx = self.ctx(c);
        SavedFlags {
            flags: ctx.flags,
            internal_flags: ctx.internal_flags,
            depth: ctx.depth,
        }
    }

    pub(crate) fn restore_flags(self, c: &mut Checker<'_>, saved: SavedFlags) {
        let ctx = self.ctx_mut(c);
        ctx.flags = saved.flags;
        ctx.internal_flags = saved.internal_flags;
        ctx.depth = saved.depth;
    }

    pub(crate) fn check_truncation_length(self, c: &mut Checker<'_>) -> bool {
        let ctx = self.ctx_mut(c);
        if ctx.truncating {
            return ctx.truncating;
        }
        let max_length = if ctx.flags.intersects(Flags::NO_TRUNCATION) {
            NO_TRUNCATION_MAXIMUM_TRUNCATION_LENGTH
        } else if ctx.max_truncation_length > 0 {
            ctx.max_truncation_length
        } else {
            DEFAULT_MAXIMUM_TRUNCATION_LENGTH
        };
        ctx.truncating = ctx.approximate_length > max_length;
        ctx.truncating
    }

    // isExpandableType reports whether t has a named representation that could be inlined as its structural form during hover expansion.
    pub(crate) fn is_expandable_type(
        self,
        c: &mut Checker<'_>,
        _t: TypeId,
        _is_alias: bool,
    ) -> bool {
        c.stand_in("NodeBuilderImpl.isExpandableType")
    }

    // isTypeOnStack reports whether t is already being processed in the current expansion, excluding the last element (the type that typeToTypeNode is serializing).
    pub(crate) fn is_type_on_stack(self, c: &Checker<'_>, t: TypeId) -> bool {
        let type_stack = &self.ctx(c).type_stack;
        let count = type_stack.len().saturating_sub(1);
        type_stack.iter().take(count).any(|entry| *entry == t)
    }

    // shouldExpandType decides whether to expand this type at the current depth: at the boundary it sets canIncreaseExpansionDepth to signal that a higher verbosity level would reveal more detail.
    pub(crate) fn should_expand_type(self, c: &mut Checker<'_>, t: TypeId, is_alias: bool) -> bool {
        if self.ctx(c).max_expansion_depth < 0 {
            return false;
        }
        if !self.is_expandable_type(c, t, is_alias) {
            return false;
        }
        if self.is_type_on_stack(c, t) {
            return false;
        }
        let ctx = self.ctx_mut(c);
        if ctx.depth < ctx.max_expansion_depth {
            return true;
        }
        ctx.can_increase_expansion_depth = true;
        false
    }

    // isActivelyExpanding reports whether the current depth is below maxExpansionDepth, meaning type-node reuse should be skipped so typeToTypeNode can expand named types.
    pub(crate) fn is_actively_expanding(self, c: &Checker<'_>) -> bool {
        let ctx = self.ctx(c);
        ctx.max_expansion_depth > 0 && ctx.depth < ctx.max_expansion_depth
    }

    // checkTypeExpandability probes whether a type (or its type arguments) could be expanded, for use after type-node reuse where shouldExpandType was never called.
    pub(crate) fn check_type_expandability(self, c: &mut Checker<'_>, t: TypeId) {
        {
            let ctx = self.ctx(c);
            if ctx.max_expansion_depth < 0 || t.is_nil() || ctx.can_increase_expansion_depth {
                return;
            }
        }
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        // Push t onto the type stack so shouldExpandType's cycle detection works correctly.
        self.ctx_mut(c).type_stack.push(t);
        self.check_type_expandability_worker(c, t);
        self.ctx_mut(c).type_stack.pop();
    }

    // The body of checkTypeExpandability after the push: upstream pops the stack in a defer.
    fn check_type_expandability_worker(self, c: &mut Checker<'_>, t: TypeId) {
        // If t is an ancestor in the current expansion, return early to avoid unbounded recursion.
        if self.is_type_on_stack(c, t) {
            return;
        }
        if !c.types[t].alias.is_nil() {
            self.should_expand_type(c, t, true);
        }
        if !self.ctx(c).can_increase_expansion_depth {
            self.should_expand_type(c, t, false);
        }
        if self.ctx(c).can_increase_expansion_depth {
            return;
        }
        // Recurse into type arguments (e.g., check Apple in Promise<Apple>).
        if c.types[t].object_flags.intersects(ObjectFlags::REFERENCE) {
            let type_arguments = c.get_type_arguments(t);
            for arg in type_arguments.as_slice() {
                self.check_type_expandability(c, *arg);
                if self.ctx(c).can_increase_expansion_depth {
                    return;
                }
            }
        }
    }

    pub(crate) fn append_reference_to_type(
        self,
        c: &mut Checker<'_>,
        root: NodeId,
        ref_: NodeId,
    ) -> NodeId {
        let a = c.ast;
        if is_import_type_node(a, root) {
            // Upstream notes that nested type arguments of the qualifier are silently elided here.
            let imprt = a.as_import_type_node(root);
            // then move qualifiers
            let ids = get_access_stack(a, ref_);
            let mut qualifier = imprt.qualifier;
            for id in ids {
                if !qualifier.is_nil() {
                    qualifier = self.f(c).new_qualified_name(qualifier, id);
                } else {
                    qualifier = id;
                }
            }
            let type_arguments = a.type_argument_list(ref_);
            return self.f(c).update_import_type_node(
                root,
                imprt.is_type_of,
                imprt.argument,
                imprt.attributes,
                qualifier,
                type_arguments,
            );
        } else if is_type_reference_node(a, root) {
            let type_ref = a.as_type_reference_node(root);
            if self
                .ctx(c)
                .flags
                .intersects(Flags::USE_INSTANTIATION_EXPRESSIONS)
                && !type_ref.type_arguments.is_nil()
                && !a.nodes(type_ref.type_arguments).as_slice().is_empty()
            {
                let access = self.create_access_expression(c, type_ref.type_name);
                let mut expr =
                    self.create_expression_with_type_arguments(c, access, type_ref.type_arguments);
                for id in get_access_stack(a, ref_) {
                    expr = self.f(c).new_property_access_expression(
                        expr,
                        NodeId::NIL,
                        id,
                        NodeFlags::NONE,
                    );
                }
                return expr;
            }
            let mut type_name = type_ref.type_name;
            for id in get_access_stack(a, ref_) {
                type_name = self.f(c).new_qualified_name(type_name, id);
            }
            let type_arguments = a.type_argument_list(ref_);
            return self
                .f(c)
                .update_type_reference_node(root, type_name, type_arguments);
        }
        let mut expr = self.create_access_expression(c, root);
        for id in get_access_stack(a, ref_) {
            expr = self
                .f(c)
                .new_property_access_expression(expr, NodeId::NIL, id, NodeFlags::NONE);
        }
        expr
    }
}

pub(crate) fn get_access_stack(a: Ast<'_>, ref_: NodeId) -> Vec<NodeId> {
    let mut state = a.as_type_reference_node(ref_).type_name;
    let mut ids: Vec<NodeId> = Vec::new();
    // A nil or a foreign node ends the walk: upstream dereferences it.
    while !state.is_nil() && !is_identifier(a, state) {
        if a.kind(state) != Kind::QualifiedName {
            break;
        }
        let entity = a.as_qualified_name(state);
        ids.insert(0, entity.right);
        state = entity.left;
    }
    ids.insert(0, state);
    ids
}

pub(crate) fn is_class_instance_side(c: &mut Checker<'_>, t: TypeId) -> bool {
    let symbol = c.types[t].symbol;
    !symbol.is_nil()
        && c.ast.sym(symbol).flags.intersects(SymbolFlags::CLASS)
        && (t == c.get_declared_type_of_class_or_interface(symbol)
            || (c.types[t].flags.intersects(TypeFlags::OBJECT)
                && c.types[t]
                    .object_flags
                    .intersects(ObjectFlags::IS_CLASS_INSTANCE_CLONE)))
}

impl NodeBuilderImpl {
    pub(crate) fn create_elided_information_placeholder(self, c: &mut Checker<'_>) -> NodeId {
        self.ctx_mut(c).approximate_length += 3;
        if !self.ctx(c).flags.intersects(Flags::NO_TRUNCATION) {
            let name = self.f(c).new_identifier(b"...");
            return self.f(c).new_type_reference_node(name, NodeListId::NIL);
        }
        let any = self.f(c).new_keyword_type_node(Kind::AnyKeyword);
        let a = c.ast;
        c.node_builder.impl_.e.add_synthetic_leading_comment(
            a,
            any,
            Kind::MultiLineCommentTrivia,
            b"elided",
            false,
        )
    }
}

// Reads the tracker of the current context: `b.ctx.tracker.X(...)` upstream.
impl NodeBuilderImpl {
    pub(crate) fn track_symbol(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
    ) -> bool {
        let a = c.ast;
        SymbolTrackerImpl::track_symbol(a, self.ctx_mut(c), symbol, enclosing_declaration, meaning)
    }
}

// One entry of the names that mapToTypeNodes has generated.
#[derive(Clone, Copy)]
struct SeenName {
    t: TypeId,
    i: usize,
}

impl NodeBuilderImpl {
    // The placeholder node of a truncated list: a comment on `any` without truncation, else a reference named by `text`.
    fn new_elision_node(self, c: &mut Checker<'_>, comment: &[u8], text: &[u8]) -> NodeId {
        if self.ctx(c).flags.intersects(Flags::NO_TRUNCATION) {
            let any = self.f(c).new_keyword_type_node(Kind::AnyKeyword);
            let a = c.ast;
            c.node_builder.impl_.e.add_synthetic_leading_comment(
                a,
                any,
                Kind::MultiLineCommentTrivia,
                comment,
                false,
            )
        } else {
            let name = self.f(c).new_identifier(text);
            self.f(c).new_type_reference_node(name, NodeListId::NIL)
        }
    }

    pub(crate) fn map_to_type_nodes(
        self,
        c: &mut Checker<'_>,
        list: &[TypeId],
        is_bare_list: bool,
    ) -> NodeListId {
        let (Some(&first), Some(&last)) = (list.first(), list.last()) else {
            return NodeListId::NIL;
        };
        if self.check_truncation_length(c) {
            if !is_bare_list {
                let node = self.new_elision_node(c, b"elided", b"...");
                return self.f(c).new_node_list(&[node]);
            } else if list.len() > 2 {
                let head = self.type_to_type_node(c, first);
                let tail = self.type_to_type_node(c, last);
                let more = list.len() - 2;
                let middle = self.new_elision_node(
                    c,
                    format!("... {more} more elided ...").as_bytes(),
                    format!("... {more} more ...").as_bytes(),
                );
                return self.f(c).new_node_list(&[head, middle, tail]);
            }
        }
        let may_have_name_collisions = !self
            .ctx(c)
            .flags
            .intersects(Flags::USE_FULLY_QUALIFIED_TYPE);
        // collections.MultiMap: the groups are kept in the order of their first name, upstream ranges over a map.
        let mut seen_names: Vec<Vec<SeenName>> = Vec::new();
        let mut seen_index: HashMap<Vec<u8>, usize> = HashMap::default();
        let mut result: Vec<NodeId> = Vec::with_capacity(list.len());
        for (i, t) in list.iter().copied().enumerate() {
            let display_index = i + 1;
            if self.check_truncation_length(c) && (display_index + 2 < list.len() - 1) {
                let more = list.len() - display_index;
                let node = self.new_elision_node(
                    c,
                    format!("... {more} more elided ...").as_bytes(),
                    format!("... {more} more ...").as_bytes(),
                );
                result.push(node);
                let type_node = self.type_to_type_node(c, last);
                if !type_node.is_nil() {
                    result.push(type_node);
                }
                break;
            }
            // Account for whitespace + separator
            self.ctx_mut(c).approximate_length += 2;
            let type_node = self.type_to_type_node(c, t);
            if !type_node.is_nil() {
                result.push(type_node);
                let a = c.ast;
                if may_have_name_collisions && is_identifier_type_reference(a, type_node) {
                    let name = a.text(a.as_type_reference_node(type_node).type_name);
                    let seen = SeenName {
                        t,
                        i: result.len() - 1,
                    };
                    match seen_index.get(name).copied() {
                        Some(group) => {
                            if let Some(group) = seen_names.get_mut(group) {
                                group.push(seen);
                            }
                        }
                        None => {
                            seen_index.insert(name.to_vec(), seen_names.len());
                            seen_names.push(vec![seen]);
                        }
                    }
                }
            }
        }
        if may_have_name_collisions {
            // To avoid printing types like `[Foo, Foo]` or `Bar & Bar` where occurrences of the same name come from different namespaces, regenerate each such entry with the `UseFullyQualifiedType` flag enabled.
            let restore_flags = self.save_restore_flags(c);
            self.ctx_mut(c).flags |= Flags::USE_FULLY_QUALIFIED_TYPE;
            for types in &seen_names {
                if !array_is_homogeneous(types, |x, y| types_are_same_reference(c, x.t, y.t)) {
                    for seen in types {
                        let node = self.type_to_type_node(c, seen.t);
                        if let Some(slot) = result.get_mut(seen.i) {
                            *slot = node;
                        }
                    }
                }
            }
            self.restore_flags(c, restore_flags);
        }
        self.f(c).new_node_list(&result)
    }

    pub(crate) fn serialize_type_name(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
        is_type_of: bool,
        type_arguments: NodeListId,
    ) -> NodeId {
        let mut meaning = SymbolFlags::TYPE;
        if is_type_of {
            meaning = SymbolFlags::VALUE;
        }
        let symbol = c.resolve_entity_name(node, meaning, true, false, node);
        if symbol.is_nil() {
            return NodeId::NIL;
        }
        let mut resolved_symbol = symbol;
        if c.ast.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
            resolved_symbol = c.resolve_alias(symbol);
        }
        let enclosing_declaration = self.ctx(c).enclosing_declaration;
        if c.is_symbol_accessible(symbol, enclosing_declaration, meaning, false)
            .accessibility
            != SymbolAccessibility::Accessible
        {
            return NodeId::NIL;
        }
        self.symbol_to_type_node(c, resolved_symbol, meaning, type_arguments)
    }
}

pub(crate) fn is_identifier_type_reference(a: Ast<'_>, node: NodeId) -> bool {
    is_type_reference_node(a, node) && is_identifier(a, a.as_type_reference_node(node).type_name)
}

pub(crate) fn array_is_homogeneous<T>(
    array: &[T],
    mut comparer: impl FnMut(&T, &T) -> bool,
) -> bool {
    let Some((first, rest)) = array.split_first() else {
        return true;
    };
    for target in rest {
        if !comparer(first, target) {
            return false;
        }
    }
    true
}

pub(crate) fn types_are_same_reference(c: &Checker<'_>, a: TypeId, b: TypeId) -> bool {
    let (ta, tb) = (&c.types[a], &c.types[b]);
    a == b
        || !ta.symbol.is_nil() && ta.symbol == tb.symbol
        || !ta.alias.is_nil() && ta.alias == tb.alias
}

impl NodeBuilderImpl {
    pub(crate) fn set_comment_range(self, c: &mut Checker<'_>, node: NodeId, range_: NodeId) {
        let enclosing_file = self.ctx(c).enclosing_file;
        let a = c.ast;
        if !range_.is_nil()
            && !enclosing_file.is_nil()
            && enclosing_file == get_source_file_of_node(a, range_)
        {
            // Copy comments to node for declaration emit
            c.node_builder.impl_.e.assign_comment_range(a, node, range_);
        }
    }

    pub(crate) fn type_node_is_equivalent_to_type(
        self,
        c: &mut Checker<'_>,
        annotated_declaration: NodeId,
        t: TypeId,
        type_from_type_node: TypeId,
    ) -> bool {
        if type_from_type_node == t {
            return true;
        }
        if annotated_declaration.is_nil() {
            return false;
        }
        // used to be hasEffectiveQuestionToken for JSDoc
        if is_optional_declaration(c.ast, annotated_declaration) {
            return c.get_type_with_facts(t, TypeFacts::NE_UNDEFINED) == type_from_type_node;
        }
        false
    }

    pub(crate) fn can_reuse_existing_js_type_node(
        self,
        c: &mut Checker<'_>,
        existing: NodeId,
        t: TypeId,
    ) -> bool {
        c.get_intended_type_from_jsdoc_type_reference(existing).is_nil()
            && self.existing_type_node_is_not_reference_or_is_reference_with_compatible_type_argument_count(c, existing, t)
    }

    pub(crate) fn try_get_resolved_symbol_from_type_node(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
    ) -> SymbolId {
        if node.is_nil() || c.ast.parent(node).is_nil() {
            return SymbolId::NIL;
        }
        // call to ensure symbol is resolved
        c.get_type_from_type_node(node);
        match c.symbol_node_links.try_get(node) {
            Some(links) => links.resolved_symbol,
            None => SymbolId::NIL,
        }
    }

    pub(crate) fn existing_type_node_is_not_reference_or_is_reference_with_compatible_type_argument_count(
        self,
        c: &mut Checker<'_>,
        existing: NodeId,
        t: TypeId,
    ) -> bool {
        // In JS, you can say something like `Foo` and get a `Foo<any>` implicitly - we don't want to preserve that original `Foo` in these cases, though.
        if !c.types[t].object_flags.intersects(ObjectFlags::REFERENCE) {
            return true;
        }
        if !is_type_reference_node(c.ast, existing) {
            return true;
        }
        let symbol = self.try_get_resolved_symbol_from_type_node(c, existing);
        if symbol.is_nil() {
            return true;
        }
        // `type` is a reference type and `existing` is a type reference node, but they must refer to the same target type before their type argument counts are compared.
        let existing_target = c.get_declared_type_of_symbol(symbol);
        let target = c.as_type_reference(t).target;
        if existing_target.is_nil() || existing_target != target {
            return true;
        }
        let type_parameters = c.as_interface_type(target).type_parameters();
        c.ast.type_arguments(existing).len() >= c.get_min_type_argument_count(type_parameters)
    }

    pub(crate) fn try_reuse_existing_non_parameter_type_node(
        self,
        c: &mut Checker<'_>,
        existing: NodeId,
        t: TypeId,
        host: NodeId,
        annotation_type: TypeId,
    ) -> NodeId {
        let mut host = host;
        let mut annotation_type = annotation_type;
        if host.is_nil() {
            host = self.ctx(c).enclosing_declaration;
        }
        if annotation_type.is_nil() {
            annotation_type = self.get_type_from_type_node(c, existing, true);
        }
        if !annotation_type.is_nil()
            && self.type_node_is_equivalent_to_type(c, host, t, annotation_type)
            && self.can_reuse_existing_js_type_node(c, existing, t)
        {
            let result = self.try_reuse_existing_node_helper(c, existing);
            if !result.is_nil() {
                return result;
            }
        }
        NodeId::NIL
    }

    // `t` is the type whose structured part upstream receives.
    pub(crate) fn get_resolved_type_without_abstract_construct_signatures(
        self,
        c: &mut Checker<'_>,
        t: TypeId,
    ) -> TypeId {
        let all_construct_signatures = c.as_structured_type(t).construct_signatures();
        if all_construct_signatures.as_slice().is_empty() {
            return t;
        }
        let cached = c
            .as_structured_type(t)
            .object_type_without_abstract_construct_signatures;
        if !cached.is_nil() {
            return cached;
        }
        let construct_signatures: Vec<SignatureId> = all_construct_signatures
            .as_slice()
            .iter()
            .copied()
            .filter(|signature| {
                !c.signatures[*signature]
                    .flags
                    .intersects(SignatureFlags::ABSTRACT)
            })
            .collect();
        if construct_signatures.len() == all_construct_signatures.as_slice().len() {
            c.as_structured_type_mut(t)
                .object_type_without_abstract_construct_signatures = t;
            return t;
        }
        let symbol = c.types[t].symbol;
        let members = c.as_structured_type(t).members;
        let call_signatures = c.as_structured_type(t).call_signatures();
        let index_infos = c.as_structured_type(t).index_infos;
        let construct_signatures = c.list(&construct_signatures);
        let type_copy = c.new_anonymous_type(
            symbol,
            members,
            call_signatures,
            construct_signatures,
            index_infos,
        );
        c.as_structured_type_mut(t)
            .object_type_without_abstract_construct_signatures = type_copy;
        c.as_structured_type_mut(type_copy)
            .object_type_without_abstract_construct_signatures = type_copy;
        type_copy
    }
}

impl NodeBuilderImpl {
    pub(crate) fn symbol_to_node(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        meaning: SymbolFlags,
    ) -> NodeId {
        if self
            .ctx(c)
            .internal_flags
            .intersects(InternalFlags::WRITE_COMPUTED_PROPS)
        {
            let a = c.ast;
            let value_declaration = a.sym(symbol).value_declaration;
            if !value_declaration.is_nil() {
                let name = get_name_of_declaration(a, value_declaration);
                if !name.is_nil() && is_computed_property_name(a, name) {
                    return name;
                }
            }
            if c.value_symbol_links.has(symbol) {
                let name_type = c.value_symbol_links.get(symbol).name_type;
                if !name_type.is_nil()
                    && c.types[name_type]
                        .flags
                        .intersects(TypeFlags::ENUM_LITERAL | TypeFlags::UNIQUE_ES_SYMBOL)
                {
                    let name_type_symbol = c.types[name_type].symbol;
                    let old_enclosing = self.ctx(c).enclosing_declaration;
                    self.ctx_mut(c).enclosing_declaration =
                        a.sym(name_type_symbol).value_declaration;
                    let expression = self.symbol_to_expression(c, name_type_symbol, meaning);
                    let result = self.f(c).new_computed_property_name(expression);
                    self.ctx_mut(c).enclosing_declaration = old_enclosing;
                    return result;
                }
            }
        }
        self.symbol_to_expression(c, symbol, meaning)
    }

    pub(crate) fn symbol_to_name(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        meaning: SymbolFlags,
        expects_identifier: bool,
    ) -> NodeId {
        let chain = self.lookup_symbol_chain(c, symbol, meaning, false);
        let ctx = self.ctx_mut(c);
        if expects_identifier
            && chain.len() != 1
            && !ctx.encountered_error
            && ctx
                .flags
                .intersects(Flags::ALLOW_QUALIFIED_NAME_IN_PLACE_OF_IDENTIFIER)
        {
            ctx.encountered_error = true;
        }
        self.create_entity_name_from_symbol_chain(c, &chain, chain.len() as isize - 1)
    }

    pub(crate) fn create_entity_name_from_symbol_chain(
        self,
        c: &mut Checker<'_>,
        chain: &[SymbolId],
        index: isize,
    ) -> NodeId {
        let Some(&symbol) = usize::try_from(index).ok().and_then(|i| chain.get(i)) else {
            return c.fail("index out of range in createEntityNameFromSymbolChain");
        };
        if index == 0 {
            self.ctx_mut(c).flags |= Flags::IN_INITIAL_ENTITY_NAME;
        }
        let symbol_name = self.get_name_of_symbol_as_written(c, symbol);
        if index == 0 {
            let ctx = self.ctx_mut(c);
            ctx.flags = Flags(ctx.flags.0 ^ Flags::IN_INITIAL_ENTITY_NAME.0);
        }
        let identifier = self.new_identifier(c, &symbol_name, symbol);
        c.node_builder
            .impl_
            .e
            .add_emit_flags(identifier, EmitFlags::NO_ASCII_ESCAPING);
        if index > 0 {
            let left = self.create_entity_name_from_symbol_chain(c, chain, index - 1);
            return self.f(c).new_qualified_name(left, identifier);
        }
        identifier
    }

    pub(crate) fn symbol_to_entity_name_node(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
    ) -> NodeId {
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        let a = c.ast;
        let identifier = self.new_identifier(c, a.sym(symbol).name, symbol);
        let parent = a.sym(symbol).parent;
        if !parent.is_nil() {
            let left = self.symbol_to_entity_name_node(c, parent);
            return self.f(c).new_qualified_name(left, identifier);
        }
        identifier
    }

    // The `with { "resolution-mode": mode }` attributes of an import type.
    fn new_resolution_mode_attributes(self, c: &mut Checker<'_>, mode: &[u8]) -> NodeId {
        let name = self.new_string_literal(c, b"resolution-mode");
        let value = self.new_string_literal(c, mode);
        let attribute = self.f(c).new_import_attribute(name, value);
        let list = self.f(c).new_node_list(&[attribute]);
        self.f(c)
            .new_import_attributes(Kind::WithKeyword, list, false)
    }

    pub(crate) fn symbol_to_type_node(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        mask: SymbolFlags,
        type_arguments: NodeListId,
    ) -> NodeId {
        // If we're using aliases outside the current scope, dont bother with the module
        let yield_module_symbol = !self
            .ctx(c)
            .flags
            .intersects(Flags::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE);
        let chain = self.lookup_symbol_chain(c, symbol, mask, yield_module_symbol);
        let Some(&root) = chain.first() else {
            // `lookupSymbolChain` should always at least return the input symbol and issue an error
            return NodeId::NIL;
        };
        let a = c.ast;
        let is_type_of = mask == SymbolFlags::VALUE;
        if a.sym(root)
            .declarations
            .as_slice()
            .iter()
            .any(|declaration| has_non_global_augmentation_external_module_symbol(a, *declaration))
        {
            // module is root, must use `ImportTypeNode`
            let mut non_root_parts = NodeId::NIL;
            if chain.len() > 1 {
                non_root_parts = self.create_access_from_symbol_chain(
                    c,
                    &chain,
                    chain.len() as isize - 1,
                    1,
                    type_arguments,
                );
            }
            let mut type_parameter_nodes = type_arguments;
            if type_parameter_nodes.is_nil() {
                type_parameter_nodes = self.lookup_type_parameter_nodes(c, &chain, 0);
            }
            let enclosing_declaration = self.ctx(c).enclosing_declaration;
            let context_file = get_source_file_of_node(
                a,
                c.node_builder.impl_.e.most_original(enclosing_declaration),
            );
            let target_file = get_source_file_of_module(a, root);
            let mut specifier: Vec<u8> = Vec::new();
            let mut attributes = NodeId::NIL;
            let module_resolution_kind = c.compiler_options.get_module_resolution_kind();
            let is_node_resolution = module_resolution_kind == ModuleResolutionKind::Node16
                || module_resolution_kind == ModuleResolutionKind::NodeNext;
            if is_node_resolution {
                // An `import` type directed at an esm format file is only going to resolve in esm mode - set the esm mode assertion
                if !target_file.is_nil()
                    && !context_file.is_nil()
                    && c.program.get_emit_module_format_of_file(target_file) == ModuleKind::ESNext
                    && c.program.get_emit_module_format_of_file(target_file)
                        != c.program.get_emit_module_format_of_file(context_file)
                {
                    specifier = self.get_specifier_for_module_symbol(c, root, ModuleKind::ESNext);
                    attributes = self.new_resolution_mode_attributes(c, b"import");
                }
            }
            if specifier.is_empty() {
                specifier = self.get_specifier_for_module_symbol(c, root, ModuleKind::None);
            }
            if !self
                .ctx(c)
                .flags
                .intersects(Flags::ALLOW_NODE_MODULES_RELATIVE_PATHS)
                && bun_core::strings::contains(&specifier, b"/node_modules/")
            {
                let old_specifier = specifier.clone();
                if is_node_resolution {
                    // We might be able to write a portable import type using a mode override; try specifier generation again, but with a different mode set
                    let mut swapped_mode = ModuleKind::ESNext;
                    if c.program.get_emit_module_format_of_file(context_file) == ModuleKind::ESNext
                    {
                        swapped_mode = ModuleKind::CommonJS;
                    }
                    specifier = self.get_specifier_for_module_symbol(c, root, swapped_mode);
                    if bun_core::strings::contains(&specifier, b"/node_modules/") {
                        // Still unreachable :(
                        specifier = old_specifier.clone();
                    } else {
                        let mut mode_str: &[u8] = b"require";
                        if swapped_mode == ModuleKind::ESNext {
                            mode_str = b"import";
                        }
                        attributes = self.new_resolution_mode_attributes(c, mode_str);
                    }
                }
                if attributes.is_nil() {
                    // A reference that dives into a `node_modules` folder is an error: declaration files with such references are liable to fail when published.
                    let ctx = self.ctx_mut(c);
                    ctx.encountered_error = true;
                    SymbolTrackerImpl::report_likely_unsafe_import_required_error(
                        ctx,
                        &old_specifier,
                        a.sym(symbol).name,
                    );
                }
            }
            let specifier_literal = self.new_string_literal(c, &specifier);
            let lit = self.f(c).new_literal_type_node(specifier_literal);
            // specifier + import("")
            self.ctx_mut(c).approximate_length += specifier.len() as isize + 10;
            if non_root_parts.is_nil() || is_entity_name(a, non_root_parts) {
                return self.f(c).new_import_type_node(
                    is_type_of,
                    lit,
                    attributes,
                    non_root_parts,
                    type_parameter_nodes,
                );
            }
            let split_node = get_topmost_indexed_access_type(a, non_root_parts);
            let split = a.as_indexed_access_type_node(split_node);
            let qualifier = a.as_type_reference_node(split.object_type).type_name;
            let import_type = self.f(c).new_import_type_node(
                is_type_of,
                lit,
                attributes,
                qualifier,
                type_parameter_nodes,
            );
            return self
                .f(c)
                .new_indexed_access_type_node(import_type, split.index_type);
        }
        let entity_name = self.create_access_from_symbol_chain(
            c,
            &chain,
            chain.len() as isize - 1,
            0,
            type_arguments,
        );
        if is_indexed_access_type_node(a, entity_name) {
            // Indexed accesses can never be `typeof`
            return entity_name;
        }
        if is_entity_name(a, entity_name) {
            if is_type_of {
                return self.f(c).new_type_query_node(entity_name, NodeListId::NIL);
            }
            return self
                .f(c)
                .new_type_reference_node(entity_name, type_arguments);
        }
        if is_type_of && is_expression_with_type_arguments(a, entity_name) {
            let expr = a.as_expression_with_type_arguments(entity_name);
            let expression = self.f(c).deep_clone_node(expr.expression);
            return self
                .f(c)
                .new_type_query_node(expression, expr.type_arguments);
        }
        entity_name
    }
}

pub(crate) fn get_topmost_indexed_access_type(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    loop {
        let object_type = a.as_indexed_access_type_node(node).object_type;
        if !is_indexed_access_type_node(a, object_type) {
            return node;
        }
        node = object_type;
    }
}

impl NodeBuilderImpl {
    pub(crate) fn create_access_from_symbol_chain(
        self,
        c: &mut Checker<'_>,
        chain: &[SymbolId],
        index: isize,
        stopper: isize,
        override_type_arguments: NodeListId,
    ) -> NodeId {
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        let a = c.ast;
        let mut type_parameter_nodes = override_type_arguments;
        if index != chain.len() as isize - 1 {
            type_parameter_nodes = self.lookup_type_parameter_nodes(c, chain, index);
        }
        let Some(&symbol) = usize::try_from(index).ok().and_then(|i| chain.get(i)) else {
            return c.fail("index out of range in createAccessFromSymbolChain");
        };
        let mut parent = SymbolId::NIL;
        if index > 0 {
            parent = usize::try_from(index - 1)
                .ok()
                .and_then(|i| chain.get(i))
                .copied()
                .unwrap_or(SymbolId::NIL);
        }
        let name_of_symbol = a.sym(symbol).name;
        let mut symbol_name: Vec<u8> = Vec::new();
        if index == 0 {
            self.ctx_mut(c).flags |= Flags::IN_INITIAL_ENTITY_NAME;
            symbol_name = self.get_name_of_symbol_as_written(c, symbol);
            let ctx = self.ctx_mut(c);
            ctx.approximate_length += symbol_name.len() as isize + 1;
            ctx.flags = Flags(ctx.flags.0 ^ Flags::IN_INITIAL_ENTITY_NAME.0);
        } else if !parent.is_nil() {
            // lookup a ref to symbol within parent to handle export aliases
            let exports = c.get_exports_of_symbol(parent);
            if !exports.is_nil() {
                // avoid exhaustive iteration in the common case
                let res = a.table_get(exports, name_of_symbol);
                if name_of_symbol != INTERNAL_SYMBOL_NAME_EXPORT_EQUALS
                    && !is_late_bound_name(name_of_symbol)
                    && !res.is_nil()
                    && !c.get_symbol_if_same_reference(res, symbol).is_nil()
                {
                    symbol_name = name_of_symbol.to_vec();
                } else {
                    // must collect all results and sort them - exports are randomly iterated
                    let mut results: HashMap<SymbolId, &[u8]> = HashMap::default();
                    let mut result_symbols: Vec<SymbolId> = Vec::new();
                    for entry in 0..a.table_len(exports) {
                        let (name, ex) = a.table_entry_at(exports, entry);
                        if !c.get_symbol_if_same_reference(ex, symbol).is_nil()
                            && !is_late_bound_name(name)
                            && name != INTERNAL_SYMBOL_NAME_EXPORT_EQUALS
                        {
                            if results.insert(ex, name).is_none() {
                                result_symbols.push(ex);
                            }
                        }
                    }
                    if !result_symbols.is_empty() {
                        c.sort_symbols(&mut result_symbols);
                        if let Some(name) = result_symbols.first().and_then(|s| results.get(s)) {
                            symbol_name = name.to_vec();
                        }
                    }
                }
            }
        }
        if symbol_name.is_empty() {
            let mut name = NodeId::NIL;
            for d in a.sym(symbol).declarations.as_slice() {
                name = get_name_of_declaration(a, *d);
                if !name.is_nil() {
                    break;
                }
            }
            if !name.is_nil()
                && is_computed_property_name(a, name)
                && is_entity_name(a, a.expression(name))
            {
                let lhs = self.create_access_from_symbol_chain(
                    c,
                    chain,
                    index - 1,
                    stopper,
                    override_type_arguments,
                );
                if is_entity_name(a, lhs) {
                    let lhs_query = self.f(c).new_type_query_node(lhs, NodeListId::NIL);
                    let object_type = self.f(c).new_parenthesized_type_node(lhs_query);
                    let index_type = self
                        .f(c)
                        .new_type_query_node(a.expression(name), NodeListId::NIL);
                    return self
                        .f(c)
                        .new_indexed_access_type_node(object_type, index_type);
                }
                return lhs;
            }
            symbol_name = self.get_name_of_symbol_as_written(c, symbol);
        }
        self.ctx_mut(c).approximate_length += symbol_name.len() as isize + 1;
        if !self
            .ctx(c)
            .flags
            .intersects(Flags::FORBID_INDEXED_ACCESS_SYMBOL_REFERENCES)
            && !parent.is_nil()
        {
            let members = c.get_members_of_symbol(parent);
            let member = if members.is_nil() {
                SymbolId::NIL
            } else {
                a.table_get(members, name_of_symbol)
            };
            if !member.is_nil() && !c.get_symbol_if_same_reference(member, symbol).is_nil() {
                // Should use an indexed access
                let lhs = self.create_access_from_symbol_chain(
                    c,
                    chain,
                    index - 1,
                    stopper,
                    override_type_arguments,
                );
                let literal = self.new_string_literal(c, &symbol_name);
                if is_indexed_access_type_node(a, lhs) {
                    let index_type = self.f(c).new_literal_type_node(literal);
                    return self.f(c).new_indexed_access_type_node(lhs, index_type);
                }
                let object_type = self.f(c).new_type_reference_node(lhs, type_parameter_nodes);
                let index_type = self.f(c).new_literal_type_node(literal);
                return self
                    .f(c)
                    .new_indexed_access_type_node(object_type, index_type);
            }
        }
        let identifier = self.new_identifier(c, &symbol_name, symbol);
        c.node_builder
            .impl_
            .e
            .add_emit_flags(identifier, EmitFlags::NO_ASCII_ESCAPING);
        if index > stopper {
            let lhs = self.create_access_from_symbol_chain(
                c,
                chain,
                index - 1,
                stopper,
                override_type_arguments,
            );
            if !self
                .ctx(c)
                .flags
                .intersects(Flags::USE_INSTANTIATION_EXPRESSIONS)
                || is_entity_name(a, lhs)
                    && (type_parameter_nodes.is_nil()
                        || a.nodes(type_parameter_nodes).as_slice().is_empty())
            {
                return self.f(c).new_qualified_name(lhs, identifier);
            }
            let access = self.create_access_expression(c, lhs);
            let property_access = self.f(c).new_property_access_expression(
                access,
                NodeId::NIL,
                identifier,
                NodeFlags::NONE,
            );
            return self.create_expression_with_type_arguments(
                c,
                property_access,
                type_parameter_nodes,
            );
        }
        identifier
    }

    pub(crate) fn symbol_to_expression(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        mask: SymbolFlags,
    ) -> NodeId {
        let chain = self.lookup_symbol_chain(c, symbol, mask, false);
        self.create_expression_from_symbol_chain(c, &chain, chain.len() as isize - 1)
    }

    pub(crate) fn create_expression_from_symbol_chain(
        self,
        c: &mut Checker<'_>,
        chain: &[SymbolId],
        index: isize,
    ) -> NodeId {
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        let a = c.ast;
        let type_parameter_nodes =
            self.lookup_expression_chain_type_argument_nodes(c, chain, index);
        let Some(&symbol) = usize::try_from(index).ok().and_then(|i| chain.get(i)) else {
            return c.fail("index out of range in createExpressionFromSymbolChain");
        };
        if index == 0 {
            self.ctx_mut(c).flags |= Flags::IN_INITIAL_ENTITY_NAME;
        }
        let mut symbol_name = self.get_name_of_symbol_as_written(c, symbol);
        if index == 0 {
            let ctx = self.ctx_mut(c);
            ctx.flags = Flags(ctx.flags.0 ^ Flags::IN_INITIAL_ENTITY_NAME.0);
        }
        if starts_with_single_or_double_quote(&symbol_name)
            && a.sym(symbol)
                .declarations
                .as_slice()
                .iter()
                .any(|d| has_non_global_augmentation_external_module_symbol(a, *d))
        {
            let specifier = self.get_specifier_for_module_symbol(c, symbol, ModuleKind::None);
            self.ctx_mut(c).approximate_length += 2 + specifier.len() as isize;
            return self.new_string_literal(c, &specifier);
        }
        if index == 0 || can_use_property_access(&symbol_name) {
            let identifier = self.new_identifier(c, &symbol_name, symbol);
            c.node_builder
                .impl_
                .e
                .add_emit_flags(identifier, EmitFlags::NO_ASCII_ESCAPING);
            self.ctx_mut(c).approximate_length += 1 + symbol_name.len() as isize;
            if index > 0 {
                let left = self.create_expression_from_symbol_chain(c, chain, index - 1);
                let result = self.f(c).new_property_access_expression(
                    left,
                    NodeId::NIL,
                    identifier,
                    NodeFlags::NONE,
                );
                c.node_builder
                    .impl_
                    .e
                    .add_emit_flags(result, EmitFlags::NO_INDENTATION);
                return self.create_expression_with_type_arguments(c, result, type_parameter_nodes);
            }
            return self.create_expression_with_type_arguments(c, identifier, type_parameter_nodes);
        }
        if starts_with_square_bracket(&symbol_name) {
            symbol_name = symbol_name
                .get(1..symbol_name.len() - 1)
                .unwrap_or(&[])
                .to_vec();
        }
        let mut expression = NodeId::NIL;
        if starts_with_single_or_double_quote(&symbol_name)
            && !a.sym(symbol).flags.intersects(SymbolFlags::ENUM_MEMBER)
        {
            let literal_text = unquote_string(&symbol_name);
            self.ctx_mut(c).approximate_length += literal_text.len() as isize + 2;
            expression =
                self.new_string_literal_ex(c, &literal_text, symbol_name.first() == Some(&b'\''));
        } else if crate::jsnum::from_string(&symbol_name).string().as_slice()
            == symbol_name.as_slice()
        {
            // Upstream notes that nothing guarantees the name is not a negative number here.
            self.ctx_mut(c).approximate_length += symbol_name.len() as isize;
            expression = self
                .f(c)
                .new_numeric_literal(&symbol_name, TokenFlags::NONE);
        }
        if expression.is_nil() {
            self.ctx_mut(c).approximate_length += symbol_name.len() as isize;
            expression = self.new_identifier(c, &symbol_name, symbol);
            c.node_builder
                .impl_
                .e
                .add_emit_flags(expression, EmitFlags::NO_ASCII_ESCAPING);
        }
        // []
        self.ctx_mut(c).approximate_length += 2;
        let left = self.create_expression_from_symbol_chain(c, chain, index - 1);
        let element_access =
            self.f(c)
                .new_element_access_expression(left, NodeId::NIL, expression, NodeFlags::NONE);
        self.create_expression_with_type_arguments(c, element_access, type_parameter_nodes)
    }
}

pub(crate) fn can_use_property_access(name: &[u8]) -> bool {
    if name.is_empty() {
        return false;
    }
    // Upstream notes that Strada only tested the first character with isIdentifierStart here.
    if let Some(rest) = name.strip_prefix(b"#") {
        return name.len() > 1 && is_identifier_text(rest, LanguageVariant::Standard);
    }
    is_identifier_text(name, LanguageVariant::Standard)
}

pub(crate) fn starts_with_single_or_double_quote(str: &[u8]) -> bool {
    str.starts_with(b"'") || str.starts_with(b"\"")
}

pub(crate) fn starts_with_square_bracket(str: &[u8]) -> bool {
    str.starts_with(b"[")
}

pub(crate) fn is_default_binding_context(a: Ast<'_>, location: NodeId) -> bool {
    a.kind(location) == Kind::SourceFile || is_ambient_module(a, location)
}

impl NodeBuilderImpl {
    pub(crate) fn get_name_of_symbol_from_name_type(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
    ) -> Vec<u8> {
        if c.value_symbol_links.has(symbol) {
            let name_type = c.value_symbol_links.get(symbol).name_type;
            if name_type.is_nil() {
                return Vec::new();
            }
            let name_type_flags = c.types[name_type].flags;
            if name_type_flags.intersects(TypeFlags::STRING_OR_NUMBER_LITERAL) {
                let value = c.as_literal_type(name_type).value;
                let name: Vec<u8> = match value {
                    LiteralValue::String(v) => v.to_vec(),
                    LiteralValue::Number(v) => crate::jsnum::Number(v).string(),
                    _ => Vec::new(),
                };
                if !is_identifier_text(&name, LanguageVariant::Standard)
                    && !is_numeric_literal_name(&name)
                {
                    return c.value_to_string(&value);
                }
                if is_numeric_literal_name(&name) && name.starts_with(b"-") {
                    return [b"[".as_slice(), &name, b"]"].concat();
                }
                return name;
            }
            if name_type_flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) {
                let unique_symbol = c.types[name_type].symbol;
                let text = self.get_name_of_symbol_as_written(c, unique_symbol);
                return [b"[".as_slice(), &text, b"]"].concat();
            }
        }
        Vec::new()
    }

    // Gets a human-readable name for a symbol: unlike `symbolName(symbol)` it keeps the quotes of a string literal name and a number as written. Not for the right-hand side of a `.`.
    pub(crate) fn get_name_of_symbol_as_written(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
    ) -> Vec<u8> {
        let a = c.ast;
        let mut symbol = symbol;
        if let Some(result) = self.ctx(c).remapped_symbol_references.get(&symbol).copied() {
            symbol = result;
        }
        let sym = a.sym(symbol);
        let declarations = sym.declarations.as_slice();
        {
            let ctx = self.ctx(c);
            // It must print as `default` when it is not the first part of an entity name, when the symbol is synthesized, or when it is not in the same binding context (source file, module declaration).
            if sym.name == INTERNAL_SYMBOL_NAME_DEFAULT
                && !ctx
                    .flags
                    .intersects(Flags::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE)
                && (!ctx.flags.intersects(Flags::IN_INITIAL_ENTITY_NAME)
                    || declarations.is_empty()
                    || (!ctx.enclosing_declaration.is_nil()
                        && find_ancestor(
                            a,
                            declarations.first().copied().unwrap_or(NodeId::NIL),
                            |n| is_default_binding_context(a, n),
                        ) != find_ancestor(a, ctx.enclosing_declaration, |n| {
                            is_default_binding_context(a, n)
                        })))
            {
                return b"default".to_vec();
            }
        }
        if let Some(&declaration) = declarations.first() {
            // Try using a declaration with a name, first
            let name = declarations
                .iter()
                .map(|d| get_name_of_declaration(a, *d))
                .find(|name| !name.is_nil())
                .unwrap_or(NodeId::NIL);
            if !name.is_nil() {
                if is_computed_property_name(a, name)
                    && !sym.check_flags.intersects(CheckFlags::LATE)
                {
                    if c.value_symbol_links.has(symbol) {
                        let name_type = c.value_symbol_links.get(symbol).name_type;
                        if !name_type.is_nil()
                            && c.types[name_type]
                                .flags
                                .intersects(TypeFlags::STRING_OR_NUMBER_LITERAL)
                        {
                            let result = self.get_name_of_symbol_from_name_type(c, symbol);
                            if !result.is_empty() {
                                return result;
                            }
                        }
                    }
                }
                return declaration_name_to_string(a, name);
            }
            // Declaration may be nameless, but we'll try anyway
            let parent = a.parent(declaration);
            if !parent.is_nil() && a.kind(parent) == Kind::VariableDeclaration {
                return declaration_name_to_string(a, a.name(parent));
            }
            if is_class_expression(a, declaration)
                || is_function_expression(a, declaration)
                || is_arrow_function(a, declaration)
            {
                if let Some(ctx) = c.node_builder.impl_.ctx.as_deref_mut() {
                    if !ctx.encountered_error
                        && !ctx.flags.intersects(Flags::ALLOW_ANONYMOUS_IDENTIFIER)
                    {
                        ctx.encountered_error = true;
                    }
                }
                match a.kind(declaration) {
                    Kind::ClassExpression => return b"(Anonymous class)".to_vec(),
                    Kind::FunctionExpression | Kind::ArrowFunction => {
                        return b"(Anonymous function)".to_vec();
                    }
                    _ => {}
                }
            }
        }
        let name = self.get_name_of_symbol_from_name_type(c, symbol);
        if !name.is_empty() {
            return name;
        }
        escape_internal_symbol_name(sym.name)
    }

    // The full set of type parameters for a generic class or interface type consists of its outer type parameters plus its locally declared type parameters.
    pub(crate) fn get_type_parameters_of_class_or_interface(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
    ) -> Vec<TypeId> {
        let mut result: Vec<TypeId> = Vec::new();
        result.extend_from_slice(
            c.get_outer_type_parameters_of_class_or_interface(symbol)
                .as_slice(),
        );
        result.extend_from_slice(
            c.get_local_type_parameters_of_class_or_interface_or_type_alias(symbol)
                .as_slice(),
        );
        result
    }

    pub(crate) fn lookup_type_parameter_nodes(
        self,
        c: &mut Checker<'_>,
        chain: &[SymbolId],
        index: isize,
    ) -> NodeListId {
        let Some(&symbol) = usize::try_from(index).ok().and_then(|i| chain.get(i)) else {
            c.assert(false, "chain != nil && 0 <= index && index < len(chain)");
            return NodeListId::NIL;
        };
        if self.ctx(c).type_parameter_symbol_list.has(&symbol) {
            return NodeListId::NIL;
        }
        self.ctx_mut(c).type_parameter_symbol_list.add(symbol);
        if self
            .ctx(c)
            .flags
            .intersects(Flags::WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME)
            && index < chain.len() as isize - 1
        {
            let type_argument_nodes = self.lookup_instantiated_type_argument_nodes(c, chain, index);
            if !type_argument_nodes.is_nil() {
                return type_argument_nodes;
            }
            let type_parameter_nodes =
                self.type_parameters_to_type_parameter_declarations(c, symbol);
            if !type_parameter_nodes.is_empty() {
                return self.f(c).new_node_list(&type_parameter_nodes);
            }
            return NodeListId::NIL;
        }
        NodeListId::NIL
    }

    pub(crate) fn lookup_symbol_chain(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        meaning: SymbolFlags,
        yield_module_symbol: bool,
    ) -> Vec<SymbolId> {
        let enclosing_declaration = self.ctx(c).enclosing_declaration;
        self.track_symbol(c, symbol, enclosing_declaration, meaning);
        self.lookup_symbol_chain_worker(c, symbol, meaning, yield_module_symbol)
    }

    pub(crate) fn lookup_symbol_chain_worker(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        meaning: SymbolFlags,
        yield_module_symbol: bool,
    ) -> Vec<SymbolId> {
        // Try to get qualified name if the symbol is not a type parameter and there is an enclosing declaration.
        let is_type_parameter = c
            .ast
            .sym(symbol)
            .flags
            .intersects(SymbolFlags::TYPE_PARAMETER);
        let ctx = self.ctx(c);
        if !is_type_parameter
            && (!ctx.enclosing_declaration.is_nil()
                || ctx.flags.intersects(Flags::USE_FULLY_QUALIFIED_TYPE))
            && !ctx
                .internal_flags
                .intersects(InternalFlags::DO_NOT_INCLUDE_SYMBOL_CHAIN)
        {
            let chain = self.get_symbol_chain(c, symbol, meaning, true, yield_module_symbol);
            c.assert(!chain.is_empty(), "len(chain) > 0");
            chain
        } else {
            vec![symbol]
        }
    }
}

struct SortedSymbolNamePair {
    sym: SymbolId,
    name: Vec<u8>,
}

impl NodeBuilderImpl {
    // `end_of_chain` is false for recursive calls: non-recursive calls should always output something.
    pub(crate) fn get_symbol_chain(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        meaning: SymbolFlags,
        end_of_chain: bool,
        yield_module_symbol: bool,
    ) -> Vec<SymbolId> {
        if !c.stack_check.is_safe_to_recurse() {
            c.stack_limit::<()>();
            return Vec::new();
        }
        let a = c.ast;
        let enclosing_declaration = self.ctx(c).enclosing_declaration;
        let use_only_external_aliasing = self
            .ctx(c)
            .flags
            .intersects(Flags::USE_ONLY_EXTERNAL_ALIASING);
        let mut accessible_symbol_chain = c.get_accessible_symbol_chain(
            symbol,
            enclosing_declaration,
            meaning,
            use_only_external_aliasing,
        );
        let mut qualifier_meaning = meaning;
        if accessible_symbol_chain.len() > 1 {
            qualifier_meaning = get_qualified_left_meaning(meaning);
        }
        let needs_parent = match accessible_symbol_chain.first().copied() {
            None => true,
            Some(first) => c.needs_qualification(first, enclosing_declaration, qualifier_meaning),
        };
        if needs_parent {
            // Go up and add our parent.
            let root = accessible_symbol_chain.first().copied().unwrap_or(symbol);
            let parents = c.get_containers_of_symbol(root, enclosing_declaration, meaning);
            if !parents.is_empty() {
                let mut parent_specifiers: Vec<SortedSymbolNamePair> =
                    Vec::with_capacity(parents.len());
                for parent in parents {
                    let is_module = a
                        .sym(parent)
                        .declarations
                        .as_slice()
                        .iter()
                        .any(|d| has_non_global_augmentation_external_module_symbol(a, *d));
                    let name = if is_module {
                        self.get_specifier_for_module_symbol(c, parent, ModuleKind::None)
                    } else {
                        Vec::new()
                    };
                    parent_specifiers.push(SortedSymbolNamePair { sym: parent, name });
                }
                parent_specifiers.sort_by(|x, y| self.sort_by_best_name(c, x, y).cmp(&0));
                for pair in &parent_specifiers {
                    let parent = pair.sym;
                    let parent_chain = self.get_symbol_chain(
                        c,
                        parent,
                        get_qualified_left_meaning(meaning),
                        false,
                        yield_module_symbol,
                    );
                    if !parent_chain.is_empty() {
                        let parent_exports = a.sym(parent).exports;
                        if !parent_exports.is_nil() {
                            let exported =
                                a.table_get(parent_exports, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS);
                            if !exported.is_nil()
                                && !c.get_symbol_if_same_reference(exported, symbol).is_nil()
                            {
                                // parentChain root is symbol: symbol is a module `export=`, so there is no need to look up an alias for the symbol in itself.
                                accessible_symbol_chain = parent_chain;
                                break;
                            }
                        }
                        let mut next_syms = accessible_symbol_chain;
                        if next_syms.is_empty() {
                            let mut fallback = c.get_alias_for_symbol_in_container(parent, symbol);
                            if fallback.is_nil() {
                                fallback = symbol;
                            }
                            next_syms.push(fallback);
                        }
                        accessible_symbol_chain = parent_chain;
                        accessible_symbol_chain.extend_from_slice(&next_syms);
                        break;
                    }
                }
            }
        }
        if !accessible_symbol_chain.is_empty() {
            return accessible_symbol_chain;
        }
        // If this is the last part of outputting the symbol, always output. A parent symbol that is an anonymous type is not written.
        if end_of_chain
            || !a
                .sym(symbol)
                .flags
                .intersects(SymbolFlags::TYPE_LITERAL | SymbolFlags::OBJECT_LITERAL)
        {
            // If a parent symbol is an external module, don't write it. (We prefer just `x` vs `"foo/bar".x`.)
            if !end_of_chain
                && !yield_module_symbol
                && a.sym(symbol)
                    .declarations
                    .as_slice()
                    .iter()
                    .any(|d| has_non_global_augmentation_external_module_symbol(a, *d))
            {
                return Vec::new();
            }
            return vec![symbol];
        }
        Vec::new()
    }

    fn sort_by_best_name(
        self,
        c: &Checker<'_>,
        a: &SortedSymbolNamePair,
        b: &SortedSymbolNamePair,
    ) -> isize {
        let specifier_a = &a.name;
        let specifier_b = &b.name;
        if !specifier_a.is_empty() && !specifier_b.is_empty() {
            let is_b_relative = path_is_relative(specifier_b);
            if path_is_relative(specifier_a) == is_b_relative {
                // Both relative or both non-relative, sort by number of parts
                return count_path_components(specifier_a) - count_path_components(specifier_b);
            }
            if is_b_relative {
                // A is non-relative, B is relative: prefer A
                return -1;
            }
            // A is relative, B is non-relative: prefer B
            return 1;
        }
        // must sort symbols for stable ordering
        c.compare_symbols(a.sym, b.sym)
    }
}

pub(crate) fn can_have_module_specifier(a: Ast<'_>, node: NodeId) -> bool {
    if node.is_nil() {
        return false;
    }
    matches!(
        a.kind(node),
        Kind::VariableDeclaration
            | Kind::BindingElement
            | Kind::ImportDeclaration
            | Kind::ExportDeclaration
            | Kind::ImportEqualsDeclaration
            | Kind::ImportClause
            | Kind::NamespaceExport
            | Kind::NamespaceImport
            | Kind::ExportSpecifier
            | Kind::ImportSpecifier
            | Kind::ImportType
    )
}

pub fn try_get_module_specifier_from_declaration(a: Ast<'_>, node: NodeId) -> NodeId {
    let res = try_get_module_specifier_from_declaration_worker(a, node);
    if res.is_nil() || !is_string_literal(a, res) {
        return NodeId::NIL;
    }
    res
}

fn try_get_module_specifier_from_declaration_worker(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::VariableDeclaration | Kind::BindingElement => {
            let require_call = find_ancestor(a, a.initializer(node), |node| {
                is_require_call(a, node, true)
            });
            if require_call.is_nil() {
                return NodeId::NIL;
            }
            a.arguments(require_call)
                .as_slice()
                .first()
                .copied()
                .unwrap_or(NodeId::NIL)
        }
        Kind::ImportDeclaration | Kind::ExportDeclaration | Kind::JSDocImportTag => {
            a.module_specifier(node)
        }
        Kind::ImportEqualsDeclaration => {
            let ref_ = a.as_import_equals_declaration(node).module_reference;
            if a.kind(ref_) != Kind::ExternalModuleReference {
                return NodeId::NIL;
            }
            a.expression(ref_)
        }
        Kind::ImportClause | Kind::NamespaceExport => a.module_specifier(a.parent(node)),
        Kind::NamespaceImport | Kind::ExportSpecifier => {
            a.module_specifier(a.parent(a.parent(node)))
        }
        Kind::ImportSpecifier => a.module_specifier(a.parent(a.parent(a.parent(node)))),
        Kind::ImportType => {
            if is_literal_import_type_node(a, node) {
                return a
                    .as_literal_type_node(a.as_import_type_node(node).argument)
                    .literal;
            }
            NodeId::NIL
        }
        _ => a.unhandled("tryGetModuleSpecifierFromDeclarationWorker", node),
    }
}

impl NodeBuilderImpl {
    pub(crate) fn get_specifier_for_module_symbol(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        override_import_mode: ModuleKind,
    ) -> Vec<u8> {
        let a = c.ast;
        let symbol_name = a.sym(symbol).name;
        let mut file = get_declaration_of_kind(a, symbol, Kind::SourceFile);
        if file.is_nil() {
            let mut equivalent_symbol = SymbolId::NIL;
            for d in a.sym(symbol).declarations.as_slice() {
                equivalent_symbol =
                    c.get_file_symbol_if_file_symbol_export_equals_container(*d, symbol);
                if !equivalent_symbol.is_nil() {
                    break;
                }
            }
            if !equivalent_symbol.is_nil() {
                file = get_declaration_of_kind(a, equivalent_symbol, Kind::SourceFile);
            }
        }
        if file.is_nil() && is_ambient_module_symbol_name(symbol_name) {
            return strip_quotes(symbol_name);
        }
        let context_file = self.ctx(c).enclosing_file;
        if context_file.is_nil() {
            if is_ambient_module_symbol_name(symbol_name) {
                return strip_quotes(symbol_name);
            }
            let module_file = get_source_file_of_module(a, symbol);
            return a.as_source_file(module_file).file_name().to_vec();
        }
        let enclosing_declaration = c
            .node_builder
            .impl_
            .e
            .most_original(self.ctx(c).enclosing_declaration);
        let mut original_module_specifier = NodeId::NIL;
        if can_have_module_specifier(a, enclosing_declaration) {
            original_module_specifier =
                try_get_module_specifier_from_declaration(a, enclosing_declaration);
        }
        let mut resolution_mode = override_import_mode;
        if resolution_mode == ModuleKind::None && !original_module_specifier.is_nil() {
            resolution_mode = c
                .program
                .get_mode_for_usage_location(context_file, original_module_specifier);
        } else if resolution_mode == ModuleKind::None {
            resolution_mode = c.program.get_default_resolution_mode_for_file(context_file);
        }
        let cache_key = (
            a.as_source_file(context_file).path().to_vec(),
            resolution_mode,
        );
        if let Some(result) = c
            .node_builder
            .impl_
            .symbol_links
            .entry(symbol)
            .or_default()
            .specifier_cache
            .get(&cache_key)
        {
            return result.clone();
        }
        // For declaration bundles the specifier is generated relative to the common source dir, as the declaration emitter does for ambient module declarations: a non-relative specifier preference does that.
        let specifier_pref = ImportModuleSpecifierPreference::ProjectRelative;
        let mut ending_pref = ImportModuleSpecifierEndingPreference::None;
        if resolution_mode == ModuleKind::ESNext {
            ending_pref = ImportModuleSpecifierEndingPreference::Js;
        }
        let all_specifiers = get_module_specifiers(
            c,
            symbol,
            context_file,
            UserPreferences {
                import_module_specifier_preference: specifier_pref,
                import_module_specifier_ending: ending_pref,
                ..UserPreferences::default()
            },
            ModuleSpecifierOptions {
                override_import_mode,
            },
            false,
        );
        let specifier = all_specifiers.into_iter().next().unwrap_or_default();
        c.node_builder
            .impl_
            .symbol_links
            .entry(symbol)
            .or_default()
            .specifier_cache
            .insert(cache_key, specifier.clone());
        specifier
    }

    pub(crate) fn type_parameter_to_declaration_with_constraint(
        self,
        c: &mut Checker<'_>,
        type_parameter: TypeId,
        constraint_node: NodeId,
    ) -> NodeId {
        let restore_flags = self.save_restore_flags(c);
        // Avoids potential infinite loop when building for a claimspace with a generic
        let ctx = self.ctx_mut(c);
        ctx.flags = ctx
            .flags
            .without(Flags::WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME);
        let modifier_flags = c.get_type_parameter_modifiers(type_parameter);
        let modifiers = create_modifiers_from_modifier_flags(modifier_flags, &mut |kind| {
            self.f(c).new_modifier(kind)
        });
        let mut modifiers_list = ModifierListId::NIL;
        if !modifiers.is_empty() {
            modifiers_list = self.f(c).new_modifier_list(&modifiers);
        }
        let name = self.type_parameter_to_name(c, type_parameter);
        let default_parameter = c.get_default_from_type_parameter(type_parameter);
        let mut default_parameter_declaration_node = NodeId::NIL;
        if !default_parameter.is_nil() {
            default_parameter_declaration_node = self.type_to_type_node(c, default_parameter);
        }
        self.restore_flags(c, restore_flags);
        self.f(c).new_type_parameter_declaration(
            modifiers_list,
            name,
            constraint_node,
            NodeId::NIL,
            default_parameter_declaration_node,
        )
    }

    // Unlike the utility `setTextRange` this applies the location only when it is in the file of the active context, copies a `range` that is not synthetic so it loses its positions, and sets up the `.original` pointer.
    pub(crate) fn set_text_range(
        self,
        c: &mut Checker<'_>,
        range_: NodeId,
        location: NodeId,
    ) -> NodeId {
        if range_.is_nil() {
            return range_;
        }
        let a = c.ast;
        let mut range_ = range_;
        let enclosing_file = self.ctx(c).enclosing_file;
        if !node_is_synthesized(a, range_)
            || !a.flags(range_).intersects(NodeFlags::SYNTHESIZED)
            || enclosing_file.is_nil()
            || enclosing_file
                != get_source_file_of_node(a, c.node_builder.impl_.e.most_original(range_))
        {
            let original = range_;
            // if `range` is synthesized or originates in another file, copy it so it definitely has synthetic positions
            range_ = self.f(c).clone_node(range_);
            a.set_loc(range_, new_text_range(-1, -1));
            if let Some(symbol) = c.node_builder.impl_.id_to_symbol.get(&original).copied() {
                c.node_builder.impl_.id_to_symbol.insert(range_, symbol);
            }
        }
        if range_ == location || location.is_nil() {
            return range_;
        }
        // Don't overwrite the original node if `range` has an `original` node that points either directly or indirectly to `location`
        let mut original = c.node_builder.impl_.e.original(range_);
        while !original.is_nil() && original != location {
            original = c.node_builder.impl_.e.original(original);
        }
        if original.is_nil() {
            c.node_builder
                .impl_
                .e
                .set_original_ex(a, range_, location, true);
        }
        // only set positions if range comes from the same file since copying text across files isn't supported by the emitter
        if !enclosing_file.is_nil()
            && enclosing_file
                == get_source_file_of_node(a, c.node_builder.impl_.e.most_original(location))
        {
            a.set_loc(range_, a.loc(location));
            return range_;
        }
        a.set_loc(range_, new_text_range(-1, -1));
        range_
    }

    pub(crate) fn type_parameter_shadows_other_type_parameter_in_scope(
        self,
        c: &mut Checker<'_>,
        name: &[u8],
        type_parameter: TypeId,
    ) -> bool {
        let enclosing_declaration = self.ctx(c).enclosing_declaration;
        let result = c.resolve_name(
            enclosing_declaration,
            name,
            SymbolFlags::TYPE,
            None,
            false,
            false,
        );
        if !result.is_nil()
            && c.ast
                .sym(result)
                .flags
                .intersects(SymbolFlags::TYPE_PARAMETER)
        {
            return result != c.types[type_parameter].symbol;
        }
        false
    }

    pub(crate) fn type_parameter_to_name(
        self,
        c: &mut Checker<'_>,
        type_parameter: TypeId,
    ) -> NodeId {
        let a = c.ast;
        let generate_names = self
            .ctx(c)
            .flags
            .intersects(Flags::GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS);
        if generate_names {
            if let Some(cached) = self.ctx(c).type_parameter_names.get(&type_parameter) {
                return cached;
            }
        }
        let symbol = c.types[type_parameter].symbol;
        let mut result = self.symbol_to_name(c, symbol, SymbolFlags::TYPE, true);
        if !is_identifier(a, result) {
            return self.f(c).new_identifier(b"(Missing type parameter)");
        }
        if !symbol.is_nil() {
            if let Some(&decl) = a.sym(symbol).declarations.as_slice().first() {
                if !decl.is_nil() && is_type_parameter_declaration(a, decl) {
                    result = self.set_text_range(c, result, a.name(decl));
                }
            }
        }
        if generate_names {
            let raw_text = a.text(result).to_vec();
            let mut i = self
                .ctx(c)
                .type_parameter_names_by_text_next_name_count
                .get(&raw_text)
                .unwrap_or(0);
            let mut text = raw_text.clone();
            loop {
                if !self.ctx(c).type_parameter_names_by_text.has(&text)
                    && !self.type_parameter_shadows_other_type_parameter_in_scope(
                        c,
                        &text,
                        type_parameter,
                    )
                {
                    break;
                }
                i += 1;
                text = [raw_text.as_slice(), b"_", i.to_string().as_bytes()].concat();
            }
            if text != raw_text {
                result = self.new_identifier(c, &text, symbol);
            }
            // avoiding iterations of the above loop is worth it when `i` gets large, so the max `i` used thus far is cached
            let ctx = self.ctx_mut(c);
            ctx.type_parameter_names_by_text_next_name_count
                .set(raw_text, i);
            ctx.type_parameter_names.set(type_parameter, result);
            ctx.type_parameter_names_by_text.add(text);
        }
        result
    }

    pub(crate) fn is_mapped_type_homomorphic(self, c: &mut Checker<'_>, mapped: TypeId) -> bool {
        !c.get_homomorphic_type_variable(mapped).is_nil()
    }

    pub(crate) fn is_homomorphic_mapped_type_with_non_homomorphic_instantiation(
        self,
        c: &mut Checker<'_>,
        mapped: TypeId,
    ) -> bool {
        let target = c.as_mapped_type(mapped).target;
        !target.is_nil()
            && !self.is_mapped_type_homomorphic(c, mapped)
            && self.is_mapped_type_homomorphic(c, target)
    }
}
