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
use crate::module::ModeAwareCache;
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

#[derive(Default)]
pub struct NodeBuilderSymbolLinks {
    pub specifier_cache: ModeAwareCache<Vec<u8>>,
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
