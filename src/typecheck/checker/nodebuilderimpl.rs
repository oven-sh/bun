// checker/nodebuilderimpl.go: how types, symbols and signatures become synthetic nodes. The receiver `b` is the unit handle plus the checker, whose field `node_builder.impl_` holds the state.
use crate::ast::{
    Ast, CheckFlags, INTERNAL_SYMBOL_NAME_DEFAULT, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
    INTERNAL_SYMBOL_NAME_PREFIX, Kind, ModifierFlags, ModifierListId, NodeFactory as _, NodeFlags,
    NodeId, NodeListId, NodeSink as _, NodeUpdater as _, SymbolFlags, SymbolId, TokenFlags,
    can_have_modifiers, create_modifiers_from_modifier_flags, escape_internal_symbol_name,
    find_ancestor, get_declaration_of_kind, get_first_identifier, get_name_of_declaration,
    get_source_file_of_module, get_source_file_of_node, get_symbol_id, has_inferred_type,
    is_accessor, is_ambient_module, is_ambient_module_symbol_name, is_arrow_function,
    is_binary_expression, is_binding_element, is_class_declaration, is_class_expression,
    is_class_like, is_computed_property_name, is_element_access_expression, is_entity_name,
    is_entity_name_expression, is_expression_with_type_arguments, is_function_expression,
    is_function_expression_or_arrow_function, is_identifier, is_import_type_node,
    is_indexed_access_type_node, is_js_type_alias_declaration, is_literal_import_type_node,
    is_modifier, is_parameter_declaration, is_private_identifier,
    is_property_access_entity_name_expression, is_property_access_expression,
    is_property_declaration, is_property_signature_declaration, is_qualified_name, is_require_call,
    is_static, is_string_literal, is_type_alias_declaration, is_type_parameter_declaration,
    is_type_query_node, is_type_reference_node, is_variable_declaration,
    is_variable_declaration_list, is_variable_like, is_variable_statement, modifiers_to_flags,
    node_is_synthesized, symbol_name, visit_each_child, walk_up_parenthesized_types,
};
use crate::checker::symbolaccessibility::{
    get_qualified_left_meaning, has_non_global_augmentation_external_module_symbol,
};
use crate::checker::symboltracker::SymbolTrackerImpl;
use crate::checker::{
    CheckMode, Checker, ElementFlags, EmitResolver, IndexInfoId, LiteralValue, MappedTypeModifiers,
    ObjectFlags, SignatureFlags, SignatureId, SignatureKind, TupleElementInfo, TypeAliasId,
    TypeFacts, TypeFlags, TypeId, TypeMapperId, TypePredicateId, TypePredicateKind,
    contains_non_missing_undefined_type, get_big_int_literal_value,
    get_declaration_modifier_flags_from_symbol, get_mapped_type_modifiers,
    get_name_from_index_info, is_late_bound_name, is_numeric_literal_name, is_optional_declaration,
    is_private_identifier_symbol, is_reserved_member_name, is_rest_parameter,
    is_this_type_parameter, is_tuple_type, is_type_any, new_type_mapper, prepend_type_mapping,
    pseudo_big_int_to_string,
};
use crate::collections::{CopyOnWriteMap, CopyOnWriteSet, Set};
use crate::core::{
    LanguageVariant, List, ModuleKind, ModuleResolutionKind, RESOLUTION_MODE_ESM,
    RESOLUTION_MODE_NONE, ResolutionMode, new_text_range,
};
use crate::diagnostics::MessageId;
use crate::modulespecifiers::{
    ImportModuleSpecifierEndingPreference, ImportModuleSpecifierPreference, ModuleSpecifierOptions,
    UserPreferences, count_path_components, get_module_specifiers,
};
use crate::nodebuilder::{Flags, InternalFlags};
use crate::printer::{EmitContext, EmitFlags, NodeFactory, SymbolAccessibility, new_node_factory};
use crate::pseudochecker::{
    PseudoChecker, PseudoType, PseudoTypeKind, could_already_refer_to_undefined_type,
    new_pseudo_checker, new_pseudo_type_union, pseudo_type_undefined,
};
use crate::scanner::{declaration_name_to_string, is_identifier_text};
use crate::stringutil::{strip_quotes, unquote_string};
use crate::tspath::path_is_relative;
use bun_collections::HashMap;

// Upstream keys these records by ast.GetSymbolId and ast.GetNodeId: the ids of this port are the identities, and get_symbol_id is still called where upstream calls it, as the first call assigns the number.
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
    pub specifier_cache: HashMap<(Vec<u8>, ResolutionMode), Vec<u8>>,
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
    pub(crate) fn f<'a, 'c>(self, c: &'c mut Checker<'a>) -> NodeFactory<'a, 'c> {
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
        c.node_builder.impl_.e.add_synthetic_leading_comment(
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
            c.node_builder.impl_.e.add_synthetic_leading_comment(
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
        let links = c.symbol_node_links.try_get(node);
        if links.is_nil() {
            return SymbolId::NIL;
        }
        c.symbol_node_links[links].resolved_symbol
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
            if c.value_symbol_links_has(symbol) {
                let name_type = {
                    let links = c.value_symbol_links_get(symbol);
                    c.value_symbol_links[links].name_type
                };
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
            let is_node_resolution = module_resolution_kind == ModuleResolutionKind::NODE16
                || module_resolution_kind == ModuleResolutionKind::NODE_NEXT;
            if is_node_resolution {
                // An `import` type directed at an esm format file is only going to resolve in esm mode - set the esm mode assertion
                if !target_file.is_nil()
                    && !context_file.is_nil()
                    && c.program.get_emit_module_format_of_file(target_file) == ModuleKind::ES_NEXT
                    && c.program.get_emit_module_format_of_file(target_file)
                        != c.program.get_emit_module_format_of_file(context_file)
                {
                    specifier = self.get_specifier_for_module_symbol(c, root, ModuleKind::ES_NEXT);
                    attributes = self.new_resolution_mode_attributes(c, b"import");
                }
            }
            if specifier.is_empty() {
                specifier = self.get_specifier_for_module_symbol(c, root, RESOLUTION_MODE_NONE);
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
                    let mut swapped_mode = ModuleKind::ES_NEXT;
                    if c.program.get_emit_module_format_of_file(context_file) == ModuleKind::ES_NEXT
                    {
                        swapped_mode = ModuleKind::COMMON_JS;
                    }
                    specifier = self.get_specifier_for_module_symbol(c, root, swapped_mode);
                    if bun_core::strings::contains(&specifier, b"/node_modules/") {
                        // Still unreachable :(
                        specifier = old_specifier.clone();
                    } else {
                        let mut mode_str: &[u8] = b"require";
                        if swapped_mode == ModuleKind::ES_NEXT {
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
                    let mut position = 0;
                    while let Some((name, ex)) = a.table_entry_at(exports, position) {
                        position += 1;
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
            let specifier = self.get_specifier_for_module_symbol(c, symbol, RESOLUTION_MODE_NONE);
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
        return name.len() > 1 && is_identifier_text(rest, LanguageVariant::STANDARD);
    }
    is_identifier_text(name, LanguageVariant::STANDARD)
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
        if c.value_symbol_links_has(symbol) {
            let name_type = {
                let links = c.value_symbol_links_get(symbol);
                c.value_symbol_links[links].name_type
            };
            if name_type.is_nil() {
                return Vec::new();
            }
            let name_type_flags = c.types[name_type].flags;
            if name_type_flags.intersects(TypeFlags::STRING_OR_NUMBER_LITERAL) {
                let value = c.as_literal_type(name_type).value.clone();
                let name: Vec<u8> = match value {
                    LiteralValue::String(v) => v.to_vec(),
                    LiteralValue::Number(v) => crate::jsnum::Number(v).string(),
                    _ => Vec::new(),
                };
                if !is_identifier_text(&name, LanguageVariant::STANDARD)
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
        get_symbol_id(a, symbol);
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
                    if c.value_symbol_links_has(symbol) {
                        let name_type = {
                            let links = c.value_symbol_links_get(symbol);
                            c.value_symbol_links[links].name_type
                        };
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
        escape_internal_symbol_name(sym.name).into_owned()
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
        get_symbol_id(c.ast, symbol);
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
                        self.get_specifier_for_module_symbol(c, parent, RESOLUTION_MODE_NONE)
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
        override_import_mode: ResolutionMode,
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
            return strip_quotes(symbol_name).to_vec();
        }
        let context_file = self.ctx(c).enclosing_file;
        if context_file.is_nil() {
            if is_ambient_module_symbol_name(symbol_name) {
                return strip_quotes(symbol_name).to_vec();
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
        if resolution_mode == RESOLUTION_MODE_NONE && !original_module_specifier.is_nil() {
            resolution_mode = c
                .program
                .get_mode_for_usage_location(context_file, original_module_specifier);
        } else if resolution_mode == RESOLUTION_MODE_NONE {
            resolution_mode = c.program.get_default_resolution_mode_for_file(context_file);
        }
        let cache_key = (
            a.as_source_file(context_file).path().0.clone(),
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
        if resolution_mode == RESOLUTION_MODE_ESM {
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
            MessageId::NIL,
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
            if let Some(cached) = self
                .ctx(c)
                .type_parameter_names
                .get(&type_parameter)
                .copied()
            {
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
                .copied()
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

impl NodeBuilderImpl {
    pub(crate) fn create_mapped_type_node_from_type(
        self,
        c: &mut Checker<'_>,
        t: TypeId,
    ) -> NodeId {
        let a = c.ast;
        c.assert(
            c.types[t].flags.intersects(TypeFlags::OBJECT),
            "t.Flags()&TypeFlagsObject != 0",
        );
        let declaration = c.as_mapped_type(t).declaration;
        let mapped_declaration = a.as_mapped_type_node(declaration);
        let mut readonly_token = NodeId::NIL;
        if !mapped_declaration.readonly_token.is_nil() {
            readonly_token = self
                .f(c)
                .new_token(a.kind(mapped_declaration.readonly_token));
        }
        let mut question_token = NodeId::NIL;
        if !mapped_declaration.question_token.is_nil() {
            question_token = self
                .f(c)
                .new_token(a.kind(mapped_declaration.question_token));
        }
        let appropriate_constraint_type_node: NodeId;
        let mut new_type_variable = NodeId::NIL;
        let mut template_type = c.get_template_type_from_mapped_type(t);
        let type_parameter = c.get_type_parameter_from_mapped_type(t);
        let generate_names = self
            .ctx(c)
            .flags
            .intersects(Flags::GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS);
        let modifiers_type = c.get_modifiers_type_from_mapped_type(t);
        let constraint_type = c.get_constraint_type_from_mapped_type(t);
        let needs_modifier_preserving_wrapper = !c
            .is_mapped_type_with_keyof_constraint_declaration(t)
            && !c.types[modifiers_type].flags.intersects(TypeFlags::UNKNOWN)
            && generate_names
            && !(c.types[constraint_type]
                .flags
                .intersects(TypeFlags::TYPE_PARAMETER)
                && {
                    let constraint = c.get_constraint_of_type_parameter(constraint_type);
                    !constraint.is_nil() && c.types[constraint].flags.intersects(TypeFlags::INDEX)
                });
        if c.is_mapped_type_with_keyof_constraint_declaration(t) {
            if generate_names
                && self.is_homomorphic_mapped_type_with_non_homomorphic_instantiation(c, t)
            {
                let new_symbol = c.new_symbol(SymbolFlags::TYPE_PARAMETER, b"T");
                let new_constraint_param = c.new_type_parameter(new_symbol);
                let name = self.type_parameter_to_name(c, new_constraint_param);
                let target = c.as_mapped_type(t).target;
                new_type_variable = self.f(c).new_type_reference_node(name, NodeListId::NIL);
                let target_template = c.get_template_type_from_mapped_type(target);
                let sources = [
                    c.get_type_parameter_from_mapped_type(target),
                    c.get_modifiers_type_from_mapped_type(target),
                ];
                let sources = c.list_of(&sources);
                let targets = c.list_of(&[type_parameter, new_constraint_param]);
                let mapper = new_type_mapper(c, sources, targets);
                template_type = c.instantiate_type(target_template, mapper);
            }
            let mut index_target = new_type_variable;
            if index_target.is_nil() {
                let modifiers_type = c.get_modifiers_type_from_mapped_type(t);
                index_target = self.type_to_type_node(c, modifiers_type);
            }
            appropriate_constraint_type_node = self
                .f(c)
                .new_type_operator_node(Kind::KeyOfKeyword, index_target);
        } else if needs_modifier_preserving_wrapper {
            let new_symbol = c.new_symbol(SymbolFlags::TYPE_PARAMETER, b"T");
            let new_param = c.new_type_parameter(new_symbol);
            let name = self.type_parameter_to_name(c, new_param);
            new_type_variable = self.f(c).new_type_reference_node(name, NodeListId::NIL);
            appropriate_constraint_type_node = new_type_variable;
        } else {
            let constraint_type = c.get_constraint_type_from_mapped_type(t);
            appropriate_constraint_type_node = self.type_to_type_node(c, constraint_type);
        }
        // typeParameterToDeclarationWithConstraint and the template and name types are built in the scope of the mapped type's own parameter.
        let scope_type_parameter = c.get_type_parameter_from_mapped_type(t);
        let cleanup = self.enter_new_scope(
            c,
            declaration,
            None,
            &[scope_type_parameter],
            None,
            TypeMapperId::NIL,
        );
        let type_parameter_declaration_node = self.type_parameter_to_declaration_with_constraint(
            c,
            type_parameter,
            appropriate_constraint_type_node,
        );
        let mut name_type_node = NodeId::NIL;
        if !mapped_declaration.name_type.is_nil() {
            let name_type = c.get_name_type_from_mapped_type(t);
            name_type_node = self.type_to_type_node(c, name_type);
        }
        let include_optional =
            get_mapped_type_modifiers(c, t).intersects(MappedTypeModifiers::INCLUDE_OPTIONAL);
        let template_without_missing = c.remove_missing_type(template_type, include_optional);
        let template_type_node = self.type_to_type_node(c, template_without_missing);
        self.exit_new_scope(c, cleanup);

        let result = self.f(c).new_mapped_type_node(
            readonly_token,
            type_parameter_declaration_node,
            name_type_node,
            question_token,
            template_type_node,
            NodeListId::NIL,
        );
        self.ctx_mut(c).approximate_length += 10;
        c.node_builder
            .impl_
            .e
            .add_emit_flags(result, EmitFlags::SINGLE_LINE);
        if generate_names
            && self.is_homomorphic_mapped_type_with_non_homomorphic_instantiation(c, t)
        {
            // homomorphic mapped type with a non-homomorphic naive inlining: wrap it with a conditional like `SomeModifiersType extends infer U ? {..the mapped type...} : never` to ensure the resulting type has the intended modifiers.
            let declared_constraint = a
                .as_type_parameter_declaration(mapped_declaration.type_parameter)
                .constraint;
            let mut raw_constraint_type_from_declaration =
                self.get_type_from_type_node(c, a.type_node(declared_constraint), false);
            if !raw_constraint_type_from_declaration.is_nil() {
                raw_constraint_type_from_declaration =
                    c.get_constraint_of_type_parameter(raw_constraint_type_from_declaration);
            }
            if raw_constraint_type_from_declaration.is_nil() {
                raw_constraint_type_from_declaration = c.unknown_type;
            }
            let mapper = c.as_mapped_type(t).mapper;
            let original_constraint =
                c.instantiate_type(raw_constraint_type_from_declaration, mapper);
            let mut original_constraint_node = NodeId::NIL;
            if !c.types[original_constraint]
                .flags
                .intersects(TypeFlags::UNKNOWN)
            {
                original_constraint_node = self.type_to_type_node(c, original_constraint);
            }
            let modifiers_type = c.get_modifiers_type_from_mapped_type(t);
            let check_type = self.type_to_type_node(c, modifiers_type);
            let variable_name = a.as_type_reference_node(new_type_variable).type_name;
            let name = self.f(c).clone_node(variable_name);
            let infer_parameter = self.f(c).new_type_parameter_declaration(
                ModifierListId::NIL,
                name,
                original_constraint_node,
                NodeId::NIL,
                NodeId::NIL,
            );
            let extends_type = self.f(c).new_infer_type_node(infer_parameter);
            let never = self.f(c).new_keyword_type_node(Kind::NeverKeyword);
            return self
                .f(c)
                .new_conditional_type_node(check_type, extends_type, result, never);
        } else if needs_modifier_preserving_wrapper {
            // a mapped type over a generic constraint can become homomorphic when the constraint is a `keyof` type: wrap it with a conditional like `Constraint extends infer T extends keyof ModifiersType ? {..the mapped type...} : never`.
            let constraint_type = c.get_constraint_type_from_mapped_type(t);
            let check_type = self.type_to_type_node(c, constraint_type);
            let variable_name = a.as_type_reference_node(new_type_variable).type_name;
            let name = self.f(c).clone_node(variable_name);
            let modifiers_type = c.get_modifiers_type_from_mapped_type(t);
            let modifiers_type_node = self.type_to_type_node(c, modifiers_type);
            let keyof_modifiers = self
                .f(c)
                .new_type_operator_node(Kind::KeyOfKeyword, modifiers_type_node);
            let infer_parameter = self.f(c).new_type_parameter_declaration(
                ModifierListId::NIL,
                name,
                keyof_modifiers,
                NodeId::NIL,
                NodeId::NIL,
            );
            let extends_type = self.f(c).new_infer_type_node(infer_parameter);
            let never = self.f(c).new_keyword_type_node(Kind::NeverKeyword);
            return self
                .f(c)
                .new_conditional_type_node(check_type, extends_type, result, never);
        }
        result
    }

    pub(crate) fn type_predicate_to_type_predicate_node(
        self,
        c: &mut Checker<'_>,
        predicate: TypePredicateId,
    ) -> NodeId {
        let kind = c.type_predicates[predicate].kind;
        let parameter_name_text = c.type_predicates[predicate].parameter_name;
        let predicate_type = c.type_predicates[predicate].t;
        let mut asserts_modifier = NodeId::NIL;
        if kind == TypePredicateKind::ASSERTS_IDENTIFIER || kind == TypePredicateKind::ASSERTS_THIS
        {
            asserts_modifier = self.f(c).new_token(Kind::AssertsKeyword);
        }
        let parameter_name;
        if kind == TypePredicateKind::IDENTIFIER || kind == TypePredicateKind::ASSERTS_IDENTIFIER {
            parameter_name = self.f(c).new_identifier(parameter_name_text);
            c.node_builder
                .impl_
                .e
                .add_emit_flags(parameter_name, EmitFlags::NO_ASCII_ESCAPING);
        } else {
            parameter_name = self.f(c).new_this_type_node();
        }
        let mut type_node = NodeId::NIL;
        if !predicate_type.is_nil() {
            type_node = self.type_to_type_node(c, predicate_type);
        }
        self.f(c)
            .new_type_predicate_node(asserts_modifier, parameter_name, type_node)
    }

    pub(crate) fn type_to_type_node_helper_with_possible_reusable_type_node(
        self,
        c: &mut Checker<'_>,
        t: TypeId,
        type_node: NodeId,
    ) -> NodeId {
        if t.is_nil() {
            return self.f(c).new_keyword_type_node(Kind::AnyKeyword);
        }
        if !self.is_actively_expanding(c)
            && !type_node.is_nil()
            && self.get_type_from_type_node(c, type_node, false) == t
        {
            let reused = self.try_reuse_existing_node_helper(c, type_node);
            if !reused.is_nil() {
                self.check_type_expandability(c, t);
                return reused;
            }
        }
        self.type_to_type_node(c, t)
    }

    pub(crate) fn type_parameter_to_declaration(
        self,
        c: &mut Checker<'_>,
        parameter: TypeId,
    ) -> NodeId {
        let constraint = c.get_constraint_of_type_parameter(parameter);
        let mut constraint_node = NodeId::NIL;
        if !constraint.is_nil() {
            let constraint_declaration = c.get_constraint_declaration(parameter);
            constraint_node = self.type_to_type_node_helper_with_possible_reusable_type_node(
                c,
                constraint,
                constraint_declaration,
            );
        }
        self.type_parameter_to_declaration_with_constraint(c, parameter, constraint_node)
    }

    pub(crate) fn type_parameters_to_type_parameter_declarations(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
    ) -> Vec<NodeId> {
        let a = c.ast;
        let target_symbol = c.get_target_symbol(symbol);
        let target_flags = a.sym(target_symbol).flags;
        if target_flags.intersects(SymbolFlags::CLASS | SymbolFlags::INTERFACE | SymbolFlags::ALIAS)
        {
            let mut results: Vec<NodeId> = Vec::new();
            let params = c.get_local_type_parameters_of_class_or_interface_or_type_alias(symbol);
            for param in params.as_slice() {
                results.push(self.type_parameter_to_declaration(c, *param));
            }
            return results;
        } else if target_flags.intersects(SymbolFlags::FUNCTION) {
            let mut results: Vec<NodeId> = Vec::new();
            let params = c.get_type_parameters_from_declaration(a.sym(symbol).value_declaration);
            for param in params.as_slice() {
                results.push(self.type_parameter_to_declaration(c, *param));
            }
            return results;
        }
        Vec::new()
    }
}

pub(crate) fn get_effective_parameter_declaration(a: Ast<'_>, symbol: SymbolId) -> NodeId {
    let parameter_declaration = get_declaration_of_kind(a, symbol, Kind::Parameter);
    if !parameter_declaration.is_nil() {
        return parameter_declaration;
    }
    if !a.sym(symbol).flags.intersects(SymbolFlags::TRANSIENT) {
        return get_declaration_of_kind(a, symbol, Kind::JSDocParameterTag);
    }
    NodeId::NIL
}

impl NodeBuilderImpl {
    pub(crate) fn symbol_to_parameter_declaration(
        self,
        c: &mut Checker<'_>,
        parameter_symbol: SymbolId,
        preserve_modifier_flags: bool,
    ) -> NodeId {
        let a = c.ast;
        let parameter_declaration = get_effective_parameter_declaration(a, parameter_symbol);
        let parameter_type = c.get_type_of_symbol(parameter_symbol);
        let parameter_type_node = self.serialize_type_for_declaration(
            c,
            parameter_declaration,
            parameter_type,
            parameter_symbol,
            true,
        );
        let mut modifiers = ModifierListId::NIL;
        if !self
            .ctx(c)
            .flags
            .intersects(Flags::OMIT_PARAMETER_MODIFIERS)
            && preserve_modifier_flags
            && !parameter_declaration.is_nil()
            && can_have_modifiers(a, parameter_declaration)
        {
            let mut clones: Vec<NodeId> = Vec::new();
            for node in a.modifier_nodes(parameter_declaration).as_slice() {
                if is_modifier(a, *node) {
                    clones.push(self.f(c).clone_node(*node));
                }
            }
            if !clones.is_empty() {
                modifiers = self.f(c).new_modifier_list(&clones);
            }
        }
        let parameter_check_flags = a.sym(parameter_symbol).check_flags;
        let is_rest = !parameter_declaration.is_nil()
            && is_rest_parameter(a, parameter_declaration)
            || parameter_check_flags.intersects(CheckFlags::REST_PARAMETER);
        let mut dot_dot_dot_token = NodeId::NIL;
        if is_rest {
            dot_dot_dot_token = self.f(c).new_token(Kind::DotDotDotToken);
        }
        let name = self.parameter_to_parameter_declaration_name(
            c,
            parameter_symbol,
            parameter_declaration,
        );
        let is_optional = !parameter_declaration.is_nil()
            && c.is_optional_parameter(parameter_declaration)
            || parameter_check_flags.intersects(CheckFlags::OPTIONAL_PARAMETER);
        let mut question_token = NodeId::NIL;
        if is_optional {
            question_token = self.f(c).new_token(Kind::QuestionToken);
        }
        let parameter_node = self.f(c).new_parameter_declaration(
            modifiers,
            dot_dot_dot_token,
            name,
            question_token,
            parameter_type_node,
            NodeId::NIL,
        );
        self.ctx_mut(c).approximate_length += a.sym(parameter_symbol).name.len() as isize + 3;
        parameter_node
    }

    pub(crate) fn parameter_to_parameter_declaration_name(
        self,
        c: &mut Checker<'_>,
        parameter_symbol: SymbolId,
        parameter_declaration: NodeId,
    ) -> NodeId {
        let a = c.ast;
        if parameter_declaration.is_nil() || a.name(parameter_declaration).is_nil() {
            return self.new_identifier(c, a.sym(parameter_symbol).name, parameter_symbol);
        }
        let name = a.name(parameter_declaration);
        match a.kind(name) {
            Kind::Identifier => {
                let cloned = self.f(c).deep_clone_node(name);
                c.node_builder
                    .impl_
                    .e
                    .set_emit_flags(cloned, EmitFlags::NO_ASCII_ESCAPING);
                c.node_builder
                    .impl_
                    .id_to_symbol
                    .insert(cloned, parameter_symbol);
                cloned
            }
            Kind::QualifiedName => {
                let cloned = self.f(c).deep_clone_node(a.as_qualified_name(name).right);
                c.node_builder
                    .impl_
                    .e
                    .set_emit_flags(cloned, EmitFlags::NO_ASCII_ESCAPING);
                c.node_builder
                    .impl_
                    .id_to_symbol
                    .insert(cloned, parameter_symbol);
                cloned
            }
            _ => self.clone_binding_name(c, name),
        }
    }

    pub(crate) fn clone_binding_name(self, c: &mut Checker<'_>, node: NodeId) -> NodeId {
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        let a = c.ast;
        if is_computed_property_name(a, node) && c.is_late_bindable_name(node) {
            let enclosing_declaration = self.ctx(c).enclosing_declaration;
            self.track_computed_name(c, a.expression(node), enclosing_declaration);
        }
        // `b.cloneBindingNameVisitor.VisitEachChild(node)`: the visitor calls cloneBindingName on every child and makes the nodes with `b.f`.
        let mut visited = visit_each_child(
            a,
            c,
            node,
            |c, child| NodeBuilderImpl.clone_binding_name(c, child),
            |c, run| run(&mut NodeBuilderImpl.f(c)),
        );
        if is_binding_element(a, visited) {
            let binding_element = a.as_binding_element(visited);
            // remove initializer
            visited = self.f(c).update_binding_element(
                visited,
                binding_element.dot_dot_dot_token,
                binding_element.property_name,
                a.name(visited),
                NodeId::NIL,
            );
        }
        if !node_is_synthesized(a, visited) {
            visited = self.f(c).deep_clone_node(visited);
        }
        c.node_builder.impl_.e.set_emit_flags(
            visited,
            EmitFlags::SINGLE_LINE | EmitFlags::NO_ASCII_ESCAPING,
        );
        visited
    }

    pub(crate) fn serialize_inferred_return_type_for_signature(
        self,
        c: &mut Checker<'_>,
        signature: SignatureId,
        return_type: TypeId,
    ) -> NodeId {
        let old_suppress_report_inference_fallback = self.ctx(c).suppress_report_inference_fallback;
        self.ctx_mut(c).suppress_report_inference_fallback = true;
        let type_predicate = c.get_type_predicate_of_signature(signature);
        let return_type_node;
        if !type_predicate.is_nil() {
            let mapper = self.ctx(c).mapper;
            let predicate = if !mapper.is_nil() {
                c.instantiate_type_predicate(type_predicate, mapper)
            } else {
                type_predicate
            };
            return_type_node = self.type_predicate_to_type_predicate_node_helper(c, predicate);
        } else {
            return_type_node = self.type_to_type_node(c, return_type);
        }
        self.ctx_mut(c).suppress_report_inference_fallback = old_suppress_report_inference_fallback;
        return_type_node
    }

    pub(crate) fn type_predicate_to_type_predicate_node_helper(
        self,
        c: &mut Checker<'_>,
        type_predicate: TypePredicateId,
    ) -> NodeId {
        let kind = c.type_predicates[type_predicate].kind;
        let parameter_name_text = c.type_predicates[type_predicate].parameter_name;
        let predicate_type = c.type_predicates[type_predicate].t;
        let mut asserts_modifier = NodeId::NIL;
        if kind == TypePredicateKind::ASSERTS_THIS || kind == TypePredicateKind::ASSERTS_IDENTIFIER
        {
            asserts_modifier = self.f(c).new_token(Kind::AssertsKeyword);
        }
        let parameter_name;
        if kind == TypePredicateKind::IDENTIFIER || kind == TypePredicateKind::ASSERTS_IDENTIFIER {
            parameter_name = self.new_identifier(c, parameter_name_text, SymbolId::NIL);
            c.node_builder
                .impl_
                .e
                .set_emit_flags(parameter_name, EmitFlags::NO_ASCII_ESCAPING);
        } else {
            parameter_name = self.f(c).new_this_type_node();
        }
        let mut type_node = NodeId::NIL;
        if !predicate_type.is_nil() {
            type_node = self.type_to_type_node(c, predicate_type);
        }
        self.f(c)
            .new_type_predicate_node(asserts_modifier, parameter_name, type_node)
    }
}

#[derive(Default)]
pub struct SignatureToSignatureDeclarationOptions {
    pub modifiers: Vec<NodeId>,
    pub name: NodeId,
    pub question_token: NodeId,
}

impl NodeBuilderImpl {
    pub(crate) fn signature_to_signature_declaration_helper(
        self,
        c: &mut Checker<'_>,
        signature: SignatureId,
        kind: Kind,
        options: Option<&SignatureToSignatureDeclarationOptions>,
    ) -> NodeId {
        let a = c.ast;
        let mut type_parameters: Vec<NodeId> = Vec::new();
        let (expanded_params, cleanup) = self.enter_signature_scope(c, signature);
        self.ctx_mut(c).approximate_length += 3;
        let target = c.signatures[signature].target;
        let mapper = c.signatures[signature].mapper;
        let signature_flags = c.signatures[signature].flags;
        if self
            .ctx(c)
            .flags
            .intersects(Flags::WRITE_TYPE_ARGUMENTS_OF_SIGNATURE)
            && !target.is_nil()
            && !mapper.is_nil()
            && !c.signatures[target].type_parameters.as_slice().is_empty()
        {
            let target_type_parameters = c.signatures[target].type_parameters;
            for parameter in target_type_parameters.as_slice() {
                let instantiated = c.instantiate_type(*parameter, mapper);
                type_parameters.push(self.type_to_type_node(c, instantiated));
            }
        } else {
            let own_type_parameters = c.signatures[signature].type_parameters;
            for parameter in own_type_parameters.as_slice() {
                type_parameters.push(self.type_parameter_to_declaration(c, *parameter));
            }
        }
        let restore_flags = self.save_restore_flags(c);
        let ctx = self.ctx_mut(c);
        ctx.flags = ctx.flags.without(Flags::SUPPRESS_ANY_RETURN_TYPE);
        // If the expanded parameter list had a variadic in a non-trailing position, don't expand it
        let last_expanded = expanded_params.last().copied();
        let has_non_trailing_rest = expanded_params.iter().any(|p| {
            Some(*p) != last_expanded
                && a.sym(*p).check_flags.intersects(CheckFlags::REST_PARAMETER)
        });
        let parameter_symbols: Vec<SymbolId> = if has_non_trailing_rest {
            c.signatures[signature].parameters.as_slice().to_vec()
        } else {
            expanded_params
        };
        let mut parameters: Vec<NodeId> = Vec::with_capacity(parameter_symbols.len() + 1);
        for parameter in parameter_symbols {
            parameters.push(self.symbol_to_parameter_declaration(
                c,
                parameter,
                kind == Kind::Constructor,
            ));
        }
        let this_parameter = if self.ctx(c).flags.intersects(Flags::OMIT_THIS_PARAMETER) {
            NodeId::NIL
        } else {
            self.try_get_this_parameter_declaration(c, signature)
        };
        if !this_parameter.is_nil() {
            parameters.insert(0, this_parameter);
        }
        self.restore_flags(c, restore_flags);

        let mut return_type_node = self.serialize_return_type_for_signature(c, signature, true);

        let mut modifiers: Vec<NodeId> = Vec::new();
        if let Some(options) = options {
            modifiers = options.modifiers.clone();
        }
        if kind == Kind::ConstructorType && signature_flags.intersects(SignatureFlags::ABSTRACT) {
            let flags = modifiers_to_flags(a, &modifiers);
            modifiers = create_modifiers_from_modifier_flags(
                flags | ModifierFlags::ABSTRACT,
                &mut |kind| self.f(c).new_modifier(kind),
            );
        }
        let param_list = self.f(c).new_node_list(&parameters);
        let mut type_param_list = NodeListId::NIL;
        if !type_parameters.is_empty() {
            type_param_list = self.f(c).new_node_list(&type_parameters);
        }
        let mut modifier_list = ModifierListId::NIL;
        if !modifiers.is_empty() {
            modifier_list = self.f(c).new_modifier_list(&modifiers);
        }
        let mut name = NodeId::NIL;
        if let Some(options) = options {
            name = options.name;
        }
        if name.is_nil() {
            name = self.f(c).new_identifier(b"");
        }

        let node = match kind {
            Kind::CallSignature => self.f(c).new_call_signature_declaration(
                type_param_list,
                param_list,
                return_type_node,
            ),
            Kind::ConstructSignature => self.f(c).new_construct_signature_declaration(
                type_param_list,
                param_list,
                return_type_node,
            ),
            Kind::MethodSignature => {
                let mut question_token = NodeId::NIL;
                if let Some(options) = options {
                    question_token = options.question_token;
                }
                self.f(c).new_method_signature_declaration(
                    modifier_list,
                    name,
                    question_token,
                    type_param_list,
                    param_list,
                    return_type_node,
                )
            }
            Kind::MethodDeclaration => self.f(c).new_method_declaration(
                modifier_list,
                NodeId::NIL,
                name,
                NodeId::NIL,
                type_param_list,
                param_list,
                return_type_node,
                NodeId::NIL,
                NodeId::NIL,
            ),
            Kind::Constructor => self.f(c).new_constructor_declaration(
                modifier_list,
                NodeListId::NIL,
                param_list,
                NodeId::NIL,
                NodeId::NIL,
                NodeId::NIL,
            ),
            Kind::GetAccessor => self.f(c).new_get_accessor_declaration(
                modifier_list,
                name,
                NodeListId::NIL,
                param_list,
                return_type_node,
                NodeId::NIL,
                NodeId::NIL,
            ),
            Kind::SetAccessor => self.f(c).new_set_accessor_declaration(
                modifier_list,
                name,
                NodeListId::NIL,
                param_list,
                NodeId::NIL,
                NodeId::NIL,
                NodeId::NIL,
            ),
            Kind::IndexSignature => self.f(c).new_index_signature_declaration(
                modifier_list,
                param_list,
                return_type_node,
            ),
            Kind::FunctionType => {
                if return_type_node.is_nil() {
                    let empty = self.f(c).new_identifier(b"");
                    return_type_node = self.f(c).new_type_reference_node(empty, NodeListId::NIL);
                }
                self.f(c)
                    .new_function_type_node(type_param_list, param_list, return_type_node)
            }
            Kind::ConstructorType => {
                if return_type_node.is_nil() {
                    let empty = self.f(c).new_identifier(b"");
                    return_type_node = self.f(c).new_type_reference_node(empty, NodeListId::NIL);
                }
                self.f(c).new_constructor_type_node(
                    modifier_list,
                    type_param_list,
                    param_list,
                    return_type_node,
                )
            }
            Kind::FunctionDeclaration => self.f(c).new_function_declaration(
                modifier_list,
                NodeId::NIL,
                name,
                type_param_list,
                param_list,
                return_type_node,
                NodeId::NIL,
                NodeId::NIL,
            ),
            Kind::FunctionExpression => {
                let statements = self.f(c).new_node_list(&[]);
                let body = self.f(c).new_block(statements, false);
                self.f(c).new_function_expression(
                    modifier_list,
                    NodeId::NIL,
                    name,
                    type_param_list,
                    param_list,
                    return_type_node,
                    NodeId::NIL,
                    body,
                )
            }
            Kind::ArrowFunction => {
                let statements = self.f(c).new_node_list(&[]);
                let body = self.f(c).new_block(statements, false);
                self.f(c).new_arrow_function(
                    modifier_list,
                    type_param_list,
                    param_list,
                    return_type_node,
                    NodeId::NIL,
                    NodeId::NIL,
                    body,
                )
            }
            _ => c.fail("Unhandled kind in signatureToSignatureDeclarationHelper"),
        };
        self.exit_new_scope(c, cleanup);
        node
    }
}

impl Checker<'_> {
    pub fn get_expanded_parameters(
        &mut self,
        sig: SignatureId,
        skip_union_expanding: bool,
    ) -> Vec<Vec<SymbolId>> {
        // The two closures of upstream's getExpandedParameters are local functions here: the methods of checker.go:27855 and 27881 have the same names and other bodies.
        fn get_uniq_associated_names_from_tuple_type(
            c: &mut Checker<'_>,
            t: TypeId,
            rest_symbol: SymbolId,
        ) -> Vec<Vec<u8>> {
            let target = c.as_type_reference(t).target;
            let element_infos = c.as_tuple_type(target).element_infos;
            let mut names: Vec<Vec<u8>> = Vec::with_capacity(element_infos.as_slice().len());
            for (i, info) in element_infos.as_slice().iter().enumerate() {
                names.push(c.get_tuple_element_label(*info, rest_symbol, i as isize));
            }
            if !names.is_empty() {
                let mut duplicates: Vec<usize> = Vec::new();
                let mut unique_names: HashMap<Vec<u8>, bool> = HashMap::default();
                for (i, name) in names.iter().enumerate() {
                    if unique_names.contains_key(name) {
                        duplicates.push(i);
                    } else {
                        unique_names.insert(name.clone(), true);
                    }
                }
                let mut counters: HashMap<Vec<u8>, isize> = HashMap::default();
                for i in duplicates {
                    let Some(base) = names.get(i).cloned() else {
                        continue;
                    };
                    let mut counter = counters.get(&base).copied().unwrap_or(1);
                    let mut name;
                    loop {
                        name = [base.as_slice(), b"_", counter.to_string().as_bytes()].concat();
                        if unique_names.contains_key(&name) {
                            counter += 1;
                            continue;
                        }
                        unique_names.insert(name.clone(), true);
                        break;
                    }
                    // Upstream stores the counter under the new name: `names[i]` is already replaced when `counters` is written.
                    counters.insert(name.clone(), counter + 1);
                    if let Some(slot) = names.get_mut(i) {
                        *slot = name;
                    }
                }
            }
            names
        }

        fn expand_signature_parameters_with_tuple_members(
            c: &mut Checker<'_>,
            sig: SignatureId,
            rest_type: TypeId,
            rest_index: usize,
            rest_symbol: SymbolId,
        ) -> Vec<SymbolId> {
            let element_types = c.get_type_arguments(rest_type);
            let associated_names =
                get_uniq_associated_names_from_tuple_type(c, rest_type, rest_symbol);
            let target = c.as_type_reference(rest_type).target;
            let element_infos = c.as_tuple_type(target).element_infos;
            let mut result: Vec<SymbolId> = c.signatures[sig]
                .parameters
                .as_slice()
                .get(..rest_index)
                .unwrap_or(&[])
                .to_vec();
            for (i, t) in element_types.as_slice().iter().copied().enumerate() {
                let name = c.text(associated_names.get(i).map_or(&[][..], Vec::as_slice));
                let flags = element_infos
                    .as_slice()
                    .get(i)
                    .map_or(ElementFlags::NONE, |info| info.flags);
                let mut check_flags = CheckFlags::NONE;
                if flags.intersects(ElementFlags::VARIABLE) {
                    check_flags = CheckFlags::REST_PARAMETER;
                } else if flags.intersects(ElementFlags::OPTIONAL) {
                    check_flags = CheckFlags::OPTIONAL_PARAMETER;
                }
                let symbol =
                    c.new_symbol_ex(SymbolFlags::FUNCTION_SCOPED_VARIABLE, name, check_flags);
                let resolved_type = if flags.intersects(ElementFlags::REST) {
                    c.create_array_type(t)
                } else {
                    t
                };
                let links = c.value_symbol_links_get(symbol);
                c.value_symbol_links[links].resolved_type = resolved_type;
                result.push(symbol);
            }
            result
        }

        if self.signatures[sig].has_rest_parameter() {
            let parameters = self.signatures[sig].parameters;
            let rest_index = parameters.as_slice().len().saturating_sub(1);
            let rest_symbol = parameters
                .as_slice()
                .get(rest_index)
                .copied()
                .unwrap_or(SymbolId::NIL);
            let rest_type = self.get_type_of_symbol(rest_symbol);
            if is_tuple_type(self, rest_type) {
                return vec![expand_signature_parameters_with_tuple_members(
                    self,
                    sig,
                    rest_type,
                    rest_index,
                    rest_symbol,
                )];
            } else if !skip_union_expanding
                && self.types[rest_type].flags.intersects(TypeFlags::UNION)
            {
                let union_types = self.as_union_type(rest_type).types;
                if union_types
                    .as_slice()
                    .iter()
                    .all(|t| is_tuple_type(self, *t))
                {
                    let mut result: Vec<Vec<SymbolId>> = Vec::new();
                    for t in union_types.as_slice() {
                        result.push(expand_signature_parameters_with_tuple_members(
                            self,
                            sig,
                            *t,
                            rest_index,
                            rest_symbol,
                        ));
                    }
                    return result;
                }
            }
        }
        vec![self.signatures[sig].parameters.as_slice().to_vec()]
    }
}

impl NodeBuilderImpl {
    pub(crate) fn try_get_this_parameter_declaration(
        self,
        c: &mut Checker<'_>,
        signature: SignatureId,
    ) -> NodeId {
        let this_parameter = c.signatures[signature].this_parameter;
        if !this_parameter.is_nil() {
            return self.symbol_to_parameter_declaration(c, this_parameter, false);
        }
        NodeId::NIL
    }

    // Serializes the return type of the signature by first trying to use the syntactic printer if possible and falling back to the checker type if not.
    pub(crate) fn serialize_return_type_for_signature(
        self,
        c: &mut Checker<'_>,
        signature: SignatureId,
        try_reuse: bool,
    ) -> NodeId {
        let a = c.ast;
        let suppress_any = self
            .ctx(c)
            .flags
            .intersects(Flags::SUPPRESS_ANY_RETURN_TYPE);
        let restore_flags = self.save_restore_flags(c);
        if suppress_any {
            // suppress only toplevel `any`s
            let ctx = self.ctx_mut(c);
            ctx.flags = ctx.flags.without(Flags::SUPPRESS_ANY_RETURN_TYPE);
        }
        let mut return_type_node = NodeId::NIL;
        let declaration = c.signatures[signature].declaration;
        let mut return_type;
        if !declaration.is_nil() && !node_is_synthesized(a, declaration) {
            let symbol = c.get_symbol_of_declaration(declaration);
            get_symbol_id(a, symbol);
            return_type = self
                .ctx(c)
                .enclosing_symbol_types
                .get(&symbol)
                .copied()
                .unwrap_or(TypeId::NIL);
            if return_type.is_nil() {
                let signature_return_type = c.get_return_type_of_signature(signature);
                let mapper = self.ctx(c).mapper;
                return_type = c.instantiate_type(signature_return_type, mapper);
            }
        } else {
            return_type = c.get_return_type_of_signature(signature);
        }
        if !(suppress_any && is_type_any(c, return_type)) {
            if !self.is_actively_expanding(c)
                && try_reuse
                && !self.ctx(c).enclosing_declaration.is_nil()
                && !declaration.is_nil()
                && !node_is_synthesized(a, declaration)
            {
                let declaration_symbol = c.get_symbol_of_declaration(declaration);
                let restore = self.add_symbol_type_to_context(c, declaration_symbol, return_type);
                let mut pt = c
                    .node_builder
                    .impl_
                    .pc
                    .get_return_type_of_signature(a, declaration);
                let report = !self.ctx(c).suppress_report_inference_fallback;
                if self.pseudo_type_equivalent_to_type(c, pt.as_deref(), return_type, false, report)
                {
                    let type_predicate = c.get_type_predicate_of_signature(signature);
                    if !type_predicate.is_nil()
                        && !self.pseudo_return_type_matches_predicate(
                            c,
                            pt.as_deref(),
                            type_predicate,
                        )
                    {
                        if !self.ctx(c).suppress_report_inference_fallback {
                            SymbolTrackerImpl::report_inference_fallback(
                                self.ctx_mut(c),
                                declaration,
                            );
                        }
                        pt = None;
                    }
                    if let Some(pt) = pt.as_deref() {
                        return_type_node =
                            self.pseudo_type_to_node_with_checker_fallback(c, pt, return_type);
                    }
                }
                self.restore_symbol_type_in_context(c, restore);
            }
            if return_type_node.is_nil() {
                return_type_node =
                    self.serialize_inferred_return_type_for_signature(c, signature, return_type);
            }
        }
        if return_type_node.is_nil() && !suppress_any {
            return_type_node = self.f(c).new_keyword_type_node(Kind::AnyKeyword);
        }
        self.restore_flags(c, restore_flags);
        return_type_node
    }
}

impl NodeBuilderImpl {
    pub(crate) fn is_trivially_serializable_computed_name(
        self,
        c: &mut Checker<'_>,
        e: NodeId,
    ) -> bool {
        let a = c.ast;
        let shape_good = !e.is_nil()
            && !a.name(e).is_nil()
            && is_computed_property_name(a, a.name(e))
            && is_entity_name_expression(a, a.expression(a.name(e)));
        if !shape_good {
            return false;
        }
        let enclosing_declaration = self.ctx(c).enclosing_declaration;
        EmitResolver
            .is_entity_name_visible(c, a.expression(a.name(e)), enclosing_declaration, false)
            .accessibility
            == SymbolAccessibility::Accessible
    }

    pub(crate) fn index_info_to_object_computed_names_or_signature_declaration(
        self,
        c: &mut Checker<'_>,
        index_info: IndexInfoId,
        type_node: NodeId,
    ) -> Vec<NodeId> {
        let a = c.ast;
        let components = c.index_infos[index_info].components;
        let is_readonly = c.index_infos[index_info].is_readonly;
        if !components.as_slice().is_empty() {
            // Index info is derived from object or class computed property names (plus explicit named members): those may be expanded at the top level of the object or class.
            let mut all_component_computed_names_serializable =
                !self.ctx(c).enclosing_declaration.is_nil();
            if all_component_computed_names_serializable {
                for component in components.as_slice() {
                    if !self.is_trivially_serializable_computed_name(c, *component) {
                        all_component_computed_names_serializable = false;
                        break;
                    }
                }
            }
            if all_component_computed_names_serializable {
                // Only use computed name serialization form if all components are visible and take the `a.b.c` form
                let mut new_components: Vec<NodeId> = Vec::new();
                for component in components.as_slice() {
                    // skip late bound props that contribute to the index signature - they'll be created by property creation anyway
                    if !c.has_late_bindable_name(*component) {
                        new_components.push(*component);
                    }
                }
                let mut bailed = false;
                let mut results: Vec<NodeId> = Vec::with_capacity(new_components.len());
                for e in new_components {
                    let name = self.reuse_node(c, a.name(e));
                    if name.is_nil() {
                        bailed = true;
                        results.push(NodeId::NIL);
                        continue;
                    }
                    let enclosing_declaration = self.ctx(c).enclosing_declaration;
                    self.track_computed_name(c, a.expression(a.name(e)), enclosing_declaration);
                    let mut mods = ModifierListId::NIL;
                    if is_readonly {
                        let readonly = self.f(c).new_modifier(Kind::ReadonlyKeyword);
                        mods = self.f(c).new_modifier_list(&[readonly]);
                    }
                    let mut postfix_token = NodeId::NIL;
                    if !a.postfix_token(e).is_nil() {
                        postfix_token = self.f(c).clone_node(a.postfix_token(e));
                    }
                    let current_type_node = if !type_node.is_nil() {
                        self.f(c).deep_clone_node(type_node)
                    } else {
                        let component_type = c.get_type_of_symbol(a.symbol(e));
                        self.type_to_type_node(c, component_type)
                    };
                    let sig = self.f(c).new_property_signature_declaration(
                        mods,
                        name,
                        postfix_token,
                        current_type_node,
                        NodeId::NIL,
                    );
                    a.set_loc(sig, a.loc(e));
                    results.push(sig);
                }
                if !bailed {
                    return results;
                }
            }
        }
        vec![self.index_info_to_index_signature_declaration_helper(c, index_info, type_node)]
    }

    pub(crate) fn index_info_to_index_signature_declaration_helper(
        self,
        c: &mut Checker<'_>,
        index_info: IndexInfoId,
        type_node: NodeId,
    ) -> NodeId {
        let name = get_name_from_index_info(c, index_info);
        let key_type = c.index_infos[index_info].key_type;
        let value_type = c.index_infos[index_info].value_type;
        let is_readonly = c.index_infos[index_info].is_readonly;
        let indexer_type_node = self.type_to_type_node(c, key_type);
        let parameter_name = self.new_identifier(c, &name, SymbolId::NIL);
        let indexing_parameter = self.f(c).new_parameter_declaration(
            ModifierListId::NIL,
            NodeId::NIL,
            parameter_name,
            NodeId::NIL,
            indexer_type_node,
            NodeId::NIL,
        );
        let mut type_node = type_node;
        if type_node.is_nil() {
            if value_type.is_nil() {
                type_node = self.f(c).new_keyword_type_node(Kind::AnyKeyword);
            } else {
                type_node = self.type_to_type_node(c, value_type);
            }
        }
        let ctx = self.ctx_mut(c);
        if value_type.is_nil() && !ctx.flags.intersects(Flags::ALLOW_EMPTY_INDEX_INFO_TYPE) {
            ctx.encountered_error = true;
        }
        ctx.approximate_length += name.len() as isize + 4;
        let mut modifiers = ModifierListId::NIL;
        if is_readonly {
            self.ctx_mut(c).approximate_length += 9;
            let readonly = self.f(c).new_modifier(Kind::ReadonlyKeyword);
            modifiers = self.f(c).new_modifier_list(&[readonly]);
        }
        let parameters = self.f(c).new_node_list(&[indexing_parameter]);
        self.f(c)
            .new_index_signature_declaration(modifiers, parameters, type_node)
    }
}

// hasTypeAnnotation reports whether declaration has a type annotation: a type alias is not a type annotation of the aliased value.
pub(crate) fn has_type_annotation(a: Ast<'_>, declaration: NodeId) -> bool {
    if declaration.is_nil() || a.type_node(declaration).is_nil() {
        return false;
    }
    if is_type_alias_declaration(a, declaration) || is_js_type_alias_declaration(a, declaration) {
        return false;
    }
    true
}

impl NodeBuilderImpl {
    // Unlike `typeToTypeNodeHelper` this sets up the `AllowUniqueESSymbolType` flag, so `unique symbol` is returned when appropriate for the input symbol rather than `typeof sym`.
    pub(crate) fn serialize_type_for_declaration(
        self,
        c: &mut Checker<'_>,
        declaration: NodeId,
        t: TypeId,
        symbol: SymbolId,
        try_reuse: bool,
    ) -> NodeId {
        let a = c.ast;
        let mut declaration = declaration;
        let mut t = t;
        let mut symbol = symbol;
        if declaration.is_nil() && !symbol.is_nil() {
            declaration = a.sym(symbol).value_declaration;
            if declaration.is_nil() {
                declaration = a
                    .sym(symbol)
                    .declarations
                    .as_slice()
                    .first()
                    .copied()
                    .unwrap_or(NodeId::NIL);
            }
        }
        if symbol.is_nil() {
            symbol = c.get_symbol_of_declaration(declaration);
        }
        if t.is_nil() {
            if symbol.is_nil() {
                if is_variable_like(a, declaration) {
                    t = c.get_type_for_variable_like_declaration(
                        declaration,
                        false,
                        CheckMode::NORMAL,
                    );
                } else {
                    t = c.error_type;
                }
            } else {
                get_symbol_id(a, symbol);
                t = self
                    .ctx(c)
                    .enclosing_symbol_types
                    .get(&symbol)
                    .copied()
                    .unwrap_or(TypeId::NIL);
                if t.is_nil() {
                    let symbol_flags = a.sym(symbol).flags;
                    let mapper = self.ctx(c).mapper;
                    if symbol_flags.intersects(SymbolFlags::ACCESSOR)
                        && a.kind(declaration) == Kind::SetAccessor
                    {
                        let write_type = c.get_write_type_of_symbol(symbol);
                        t = c.instantiate_type(write_type, mapper);
                    } else if !symbol_flags
                        .intersects(SymbolFlags::TYPE_LITERAL | SymbolFlags::SIGNATURE)
                    {
                        let symbol_type = c.get_type_of_symbol(symbol);
                        let widened = c.get_widened_literal_type(symbol_type);
                        t = c.instantiate_type(widened, mapper);
                    } else {
                        t = c.error_type;
                    }
                }
            }
        }
        let is_parameter_or_property = !declaration.is_nil()
            && (is_parameter_declaration(a, declaration)
                || is_property_signature_declaration(a, declaration)
                || is_property_declaration(a, declaration));
        let enclosing_declaration = self.ctx(c).enclosing_declaration;
        let requires_adding_undefined = is_parameter_or_property
            && EmitResolver.requires_adding_implicit_undefined(
                c,
                declaration,
                symbol,
                enclosing_declaration,
            );
        let add_undefined_for_parameter =
            requires_adding_undefined && is_parameter_declaration(a, declaration);
        if add_undefined_for_parameter {
            t = c.get_optional_type(t, false);
        }

        let restore_flags = self.save_restore_flags(c);
        let enclosing_file = self.ctx(c).enclosing_file;
        if c.types[t].flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL)
            && c.types[t].symbol == symbol
            && (enclosing_declaration.is_nil()
                || a.sym(symbol)
                    .declarations
                    .as_slice()
                    .iter()
                    .any(|d| get_source_file_of_node(a, *d) == enclosing_file))
        {
            self.ctx_mut(c).flags |= Flags::ALLOW_UNIQUE_ES_SYMBOL_TYPE;
        }
        let mut result = NodeId::NIL;
        let mut reported_inference_fallback = false;
        if !self.is_actively_expanding(c)
            && try_reuse
            && !enclosing_declaration.is_nil()
            && !declaration.is_nil()
            && (is_accessor(a, declaration)
                || (has_inferred_type(a, declaration)
                    && !node_is_synthesized(a, declaration)
                    && !c.types[t]
                        .object_flags
                        .intersects(ObjectFlags::REQUIRES_WIDENING)))
        {
            let mut remove = None;
            if !symbol.is_nil() {
                remove = Some(self.add_symbol_type_to_context(c, symbol, t));
            }
            let mut pt = if is_accessor(a, declaration) {
                c.node_builder.impl_.pc.get_type_of_accessor(a, declaration)
            } else {
                c.node_builder
                    .impl_
                    .pc
                    .get_type_of_declaration(a, declaration)
            };
            if pt
                .as_deref()
                .is_none_or(|pt| pt.kind == PseudoTypeKind::NoResult)
                && is_binary_expression(a, declaration)
                && !symbol.is_nil()
            {
                let decl = a
                    .sym(symbol)
                    .declarations
                    .as_slice()
                    .iter()
                    .copied()
                    .find(|d| has_type_annotation(a, *d));
                if let Some(decl) = decl {
                    pt = c.node_builder.impl_.pc.get_type_of_declaration(a, decl);
                }
            }
            let report_errors = !self.ctx(c).suppress_report_inference_fallback;
            let is_optional = !requires_adding_undefined
                && is_parameter_or_property
                && is_optional_declaration(a, declaration);
            if self.pseudo_type_equivalent_to_type(c, pt.as_deref(), t, is_optional, report_errors)
            {
                let ptt = self.pseudo_type_to_type(c, pt.as_deref());
                if !ptt.is_nil()
                    && requires_adding_undefined
                    && contains_non_missing_undefined_type(c, t)
                    && !contains_non_missing_undefined_type(c, ptt)
                {
                    pt = Some(new_pseudo_type_union(vec![
                        pt,
                        Some(pseudo_type_undefined()),
                    ]));
                }
                result = self.pseudo_type_to_node_with_checker_fallback_opt(c, pt.as_deref(), t);
            } else {
                reported_inference_fallback = report_errors
                    && pt.as_deref().is_some_and(|pt| {
                        pt.kind == PseudoTypeKind::Inferred
                            && !pt.as_pseudo_type_inferred().error_nodes.is_empty()
                    });
                let mut should_add_undefined = false;
                if requires_adding_undefined {
                    let ptt = self.pseudo_type_to_type(c, pt.as_deref());
                    if !ptt.is_nil() {
                        should_add_undefined = !contains_non_missing_undefined_type(c, ptt);
                    } else {
                        should_add_undefined =
                            !could_already_refer_to_undefined_type(a, pt.as_deref());
                    }
                }
                if should_add_undefined {
                    pt = Some(new_pseudo_type_union(vec![
                        pt,
                        Some(pseudo_type_undefined()),
                    ]));
                    if self.pseudo_type_equivalent_to_type(
                        c,
                        pt.as_deref(),
                        t,
                        false,
                        report_errors,
                    ) {
                        result =
                            self.pseudo_type_to_node_with_checker_fallback_opt(c, pt.as_deref(), t);
                        reported_inference_fallback = false;
                    }
                }
            }
            if let Some(remove) = remove {
                self.restore_symbol_type_in_context(c, remove);
            }
        }
        if result.is_nil() {
            if reported_inference_fallback {
                // The inference fallback was already reported for this type: suppress nested reports while it is serialized.
                let old_suppress = self.ctx(c).suppress_report_inference_fallback;
                self.ctx_mut(c).suppress_report_inference_fallback = true;
                result = self.type_to_type_node(c, t);
                self.ctx_mut(c).suppress_report_inference_fallback = old_suppress;
            } else {
                result = self.type_to_type_node(c, t);
            }
        }
        self.restore_flags(c, restore_flags);
        if result.is_nil() {
            return self.f(c).new_keyword_type_node(Kind::AnyKeyword);
        }
        result
    }

    // `pt` can be nil upstream only where the pseudochecker returned nil: the checker type is serialized then.
    fn pseudo_type_to_node_with_checker_fallback_opt(
        self,
        c: &mut Checker<'_>,
        pt: Option<&PseudoType>,
        t: TypeId,
    ) -> NodeId {
        match pt {
            Some(pt) => self.pseudo_type_to_node_with_checker_fallback(c, pt, t),
            None => c.fail("nil pseudo type in serializeTypeForDeclaration"),
        }
    }
}

pub const MAX_REVERSE_MAPPED_NESTING_INSPECTION_DEPTH: usize = 3;

impl NodeBuilderImpl {
    pub(crate) fn should_use_placeholder_for_property(
        self,
        c: &mut Checker<'_>,
        property_symbol: SymbolId,
    ) -> bool {
        // Use placeholders for reverse mapped types inferred from unresolved nested type or for excessively nested reverse mapped types.
        if !c
            .ast
            .sym(property_symbol)
            .check_flags
            .intersects(CheckFlags::REVERSE_MAPPED)
        {
            return false;
        }
        // inferred from an unresolved nested type
        if self
            .ctx(c)
            .reverse_mapped_stack
            .iter()
            .any(|s| *s == property_symbol)
        {
            return true;
        }
        if let Some(&last) = self.ctx(c).reverse_mapped_stack.last() {
            let links = c.reverse_mapped_symbol_links.try_get(last);
            if !links.is_nil() {
                let property_type = c.reverse_mapped_symbol_links[links].property_type;
                if !property_type.is_nil()
                    && !c.types[property_type]
                        .object_flags
                        .intersects(ObjectFlags::ANONYMOUS)
                {
                    return true;
                }
            }
        }
        // deeply nested reverse mapped types of the same type
        if self.ctx(c).reverse_mapped_stack.len() < MAX_REVERSE_MAPPED_NESTING_INSPECTION_DEPTH {
            return false;
        }
        let property_links = c.reverse_mapped_symbol_links.try_get(property_symbol);
        if property_links.is_nil() {
            return false;
        }
        let prop_mapped_type = c.reverse_mapped_symbol_links[property_links].mapped_type;
        if prop_mapped_type.is_nil() || c.types[prop_mapped_type].symbol.is_nil() {
            return false;
        }
        let prop_mapped_symbol = c.types[prop_mapped_type].symbol;
        let stack = &self.ctx(c).reverse_mapped_stack;
        for i in 0..stack.len() {
            if i > MAX_REVERSE_MAPPED_NESTING_INSPECTION_DEPTH {
                break;
            }
            let Some(&prop) = stack.get(stack.len() - 1 - i) else {
                break;
            };
            let links = c.reverse_mapped_symbol_links.try_get(prop);
            if !links.is_nil() {
                let mapped_type = c.reverse_mapped_symbol_links[links].mapped_type;
                if !mapped_type.is_nil() && c.types[mapped_type].symbol == prop_mapped_symbol {
                    return true;
                }
            }
        }
        false
    }

    pub(crate) fn track_computed_name(
        self,
        c: &mut Checker<'_>,
        access_expression: NodeId,
        enclosing_declaration: NodeId,
    ) {
        let a = c.ast;
        // get symbol of the first identifier of the entityName
        let first_identifier = get_first_identifier(a, access_expression);
        let text = a.text(first_identifier);
        let name = c.resolve_name(
            enclosing_declaration,
            text,
            SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE,
            MessageId::NIL,
            true,
            false,
        );
        if !name.is_nil() {
            self.track_symbol(c, name, enclosing_declaration, SymbolFlags::VALUE);
        } else {
            // Name does not resolve at target location, track symbol at dest location (should be inaccessible)
            let fallback = c.resolve_name(
                first_identifier,
                text,
                SymbolFlags::VALUE | SymbolFlags::EXPORT_VALUE,
                MessageId::NIL,
                true,
                false,
            );
            if !fallback.is_nil() {
                self.track_symbol(c, fallback, enclosing_declaration, SymbolFlags::VALUE);
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PropertyNameNodeKind {
    Identifier,
    NumericLiteral,
    StringLiteral,
}

// classifyPropertyName determines the kind of node that would be created for a property name: an identifier, a numeric literal, or a string literal.
fn classify_property_name(
    name: &[u8],
    string_named: bool,
    is_method: bool,
) -> PropertyNameNodeKind {
    if is_method && name == b"new" {
        return PropertyNameNodeKind::StringLiteral;
    }
    if is_identifier_text(name, LanguageVariant::STANDARD) {
        return PropertyNameNodeKind::Identifier;
    }
    if !string_named && is_numeric_literal_name(name) && crate::jsnum::from_string(name).0 >= 0.0 {
        PropertyNameNodeKind::NumericLiteral
    } else {
        PropertyNameNodeKind::StringLiteral
    }
}

impl NodeBuilderImpl {
    pub(crate) fn create_property_name_node_for_identifier_or_literal(
        self,
        c: &mut Checker<'_>,
        name: &[u8],
        single_quote: bool,
        string_named: bool,
        is_method: bool,
        symbol: SymbolId,
    ) -> NodeId {
        match classify_property_name(name, string_named, is_method) {
            PropertyNameNodeKind::Identifier => self.new_identifier(c, name, symbol),
            PropertyNameNodeKind::NumericLiteral => {
                self.f(c).new_numeric_literal(name, TokenFlags::NONE)
            }
            PropertyNameNodeKind::StringLiteral => self.f(c).new_string_literal(
                name,
                if single_quote {
                    TokenFlags::SINGLE_QUOTE
                } else {
                    TokenFlags::NONE
                },
            ),
        }
    }

    pub(crate) fn is_string_named(self, c: &mut Checker<'_>, d: NodeId) -> bool {
        let a = c.ast;
        let name = get_name_of_declaration(a, d);
        if name.is_nil() {
            return false;
        }
        if is_computed_property_name(a, name) {
            let t = c.check_expression(a.expression(name));
            return c.types[t].flags.intersects(TypeFlags::STRING_LIKE);
        }
        if is_element_access_expression(a, name) {
            let t = c.check_expression(a.as_element_access_expression(name).argument_expression);
            return c.types[t].flags.intersects(TypeFlags::STRING_LIKE);
        }
        is_string_literal(a, name)
    }

    pub(crate) fn is_single_quoted_string_named(self, c: &Checker<'_>, d: NodeId) -> bool {
        let a = c.ast;
        let name = get_name_of_declaration(a, d);
        !name.is_nil()
            && is_string_literal(a, name)
            && a.as_string_literal(name)
                .token_flags
                .intersects(TokenFlags::SINGLE_QUOTE)
    }

    pub(crate) fn get_property_name_node_for_symbol(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
    ) -> NodeId {
        let a = c.ast;
        let sym = a.sym(symbol);
        if !sym.value_declaration.is_nil() {
            let decl_name = a.name(sym.value_declaration);
            if !decl_name.is_nil() && is_private_identifier(a, decl_name) {
                return self.f(c).deep_clone_node(decl_name);
            }
        }
        let declarations = sym.declarations.as_slice();
        let mut string_named = !declarations.is_empty();
        for d in declarations {
            if !string_named {
                break;
            }
            string_named = self.is_string_named(c, *d);
        }
        let single_quote = !declarations.is_empty()
            && declarations
                .iter()
                .all(|d| self.is_single_quoted_string_named(c, *d));
        let is_method = sym.flags.intersects(SymbolFlags::METHOD);
        let from_name_type = self.get_property_name_node_for_symbol_from_name_type(
            c,
            symbol,
            enclosing_declaration,
            single_quote,
            string_named,
            is_method,
        );
        if !from_name_type.is_nil() {
            return from_name_type;
        }
        let mut name: Vec<u8> = sym.name.to_vec();
        let private_name_prefix = [INTERNAL_SYMBOL_NAME_PREFIX, b"#".as_slice()].concat();
        if let Some(rest) = sym.name.strip_prefix(private_name_prefix.as_slice()) {
            // symbol IDs are unstable - replace #nnn# with #private#
            let digits = rest.iter().take_while(|ch| ch.is_ascii_digit()).count();
            name = [b"__#private".as_slice(), rest.get(digits..).unwrap_or(&[])].concat();
        }
        self.create_property_name_node_for_identifier_or_literal(
            c,
            &name,
            single_quote,
            string_named,
            is_method,
            symbol,
        )
    }

    // See getNameForSymbolFromNameType for a stringy equivalent
    pub(crate) fn get_property_name_node_for_symbol_from_name_type(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        single_quote: bool,
        string_named: bool,
        is_method: bool,
    ) -> NodeId {
        let a = c.ast;
        let links = c.value_symbol_links_try_get(symbol);
        if links.is_nil() {
            return NodeId::NIL;
        }
        let name_type = c.value_symbol_links[links].name_type;
        if name_type.is_nil() {
            return NodeId::NIL;
        }
        let mut enum_enclosing_declaration = enclosing_declaration;
        if enum_enclosing_declaration.is_nil() && !self.ctx(c).enclosing_file.is_nil() {
            enum_enclosing_declaration = self.ctx(c).enclosing_file;
        }
        let name_type_flags = c.types[name_type].flags;
        let name_type_symbol = c.types[name_type].symbol;
        if name_type_flags.intersects(TypeFlags::ENUM_LITERAL) {
            let mut enum_symbol = a.sym(name_type_symbol).parent;
            if enum_symbol.is_nil() {
                enum_symbol = name_type_symbol;
            }
            if !enum_enclosing_declaration.is_nil()
                && c.is_symbol_accessible_by_flags(
                    enum_symbol,
                    enum_enclosing_declaration,
                    SymbolFlags::VALUE,
                )
            {
                let save_enclosing_declaration = self.ctx(c).enclosing_declaration;
                self.ctx_mut(c).enclosing_declaration = enum_enclosing_declaration;
                let expression = self.symbol_to_expression(c, name_type_symbol, SymbolFlags::VALUE);
                let result = self.f(c).new_computed_property_name(expression);
                self.ctx_mut(c).enclosing_declaration = save_enclosing_declaration;
                return result;
            }
        }
        if name_type_flags.intersects(TypeFlags::STRING_OR_NUMBER_LITERAL) {
            let name: Vec<u8> = match c.as_literal_type(name_type).value {
                LiteralValue::Number(v) => crate::jsnum::Number(v).string(),
                LiteralValue::String(v) => v.to_vec(),
                _ => Vec::new(),
            };
            if !is_identifier_text(&name, LanguageVariant::STANDARD)
                && (string_named || !is_numeric_literal_name(&name))
            {
                return self.f(c).new_string_literal(
                    &name,
                    if single_quote {
                        TokenFlags::SINGLE_QUOTE
                    } else {
                        TokenFlags::NONE
                    },
                );
            }
            if is_numeric_literal_name(&name) && name.first() == Some(&b'-') {
                let operand = self
                    .f(c)
                    .new_numeric_literal(name.get(1..).unwrap_or(&[]), TokenFlags::NONE);
                let negative = self
                    .f(c)
                    .new_prefix_unary_expression(Kind::MinusToken, operand);
                return self.f(c).new_computed_property_name(negative);
            }
            return self.create_property_name_node_for_identifier_or_literal(
                c,
                &name,
                single_quote,
                string_named,
                is_method,
                symbol,
            );
        }
        if name_type_flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) {
            let expression = self.symbol_to_expression(c, name_type_symbol, SymbolFlags::VALUE);
            return self.f(c).new_computed_property_name(expression);
        }
        NodeId::NIL
    }

    // Upstream appends to the slice it is given and returns it.
    pub(crate) fn add_property_to_element_list(
        self,
        c: &mut Checker<'_>,
        property_symbol: SymbolId,
        type_elements: &mut Vec<NodeId>,
    ) {
        let a = c.ast;
        let property = a.sym(property_symbol);
        let property_is_reverse_mapped =
            property.check_flags.intersects(CheckFlags::REVERSE_MAPPED);
        let property_type = if self.should_use_placeholder_for_property(c, property_symbol) {
            c.any_type
        } else {
            c.get_non_missing_type_of_symbol(property_symbol)
        };
        let save_enclosing_declaration = self.ctx(c).enclosing_declaration;
        self.ctx_mut(c).enclosing_declaration = NodeId::NIL;
        let first_declaration = property.declarations.as_slice().first().copied();
        if is_late_bound_name(property.name) {
            if let Some(decl) = first_declaration {
                if c.has_late_bindable_name(decl) {
                    if is_binary_expression(a, decl) {
                        let name = get_name_of_declaration(a, decl);
                        if !name.is_nil() && is_element_access_expression(a, name) {
                            let argument = a.as_element_access_expression(name).argument_expression;
                            if is_property_access_entity_name_expression(a, argument, false) {
                                self.track_computed_name(c, argument, save_enclosing_declaration);
                            }
                        }
                    } else {
                        self.track_computed_name(
                            c,
                            a.expression(a.name(decl)),
                            save_enclosing_declaration,
                        );
                    }
                }
            } else {
                let text = c.symbol_to_string(property_symbol);
                SymbolTrackerImpl::report_non_serializable_property(self.ctx_mut(c), &text);
            }
        }
        if !property.value_declaration.is_nil() {
            self.ctx_mut(c).enclosing_declaration = property.value_declaration;
        } else if let Some(decl) = first_declaration.filter(|decl| !decl.is_nil()) {
            self.ctx_mut(c).enclosing_declaration = decl;
        } else {
            self.ctx_mut(c).enclosing_declaration = save_enclosing_declaration;
        }
        let property_name =
            self.get_property_name_node_for_symbol(c, property_symbol, save_enclosing_declaration);
        self.ctx_mut(c).enclosing_declaration = save_enclosing_declaration;
        self.ctx_mut(c).approximate_length += symbol_name(a, property_symbol).len() as isize + 1;

        let parent_is_class = !property.parent.is_nil()
            && a.sym(property.parent).flags.intersects(SymbolFlags::CLASS);
        if property.flags.intersects(SymbolFlags::ACCESSOR) {
            let write_type = c.get_write_type_of_symbol(property_symbol);
            if !c.is_error_type(property_type) && !c.is_error_type(write_type) {
                let prop_declaration =
                    get_declaration_of_kind(a, property_symbol, Kind::PropertyDeclaration);
                if property_type != write_type || parent_is_class && prop_declaration.is_nil() {
                    let symbol_mapper = {
                        let links = c.value_symbol_links_get(property_symbol);
                        c.value_symbol_links[links].mapper
                    };
                    let getter_declaration =
                        get_declaration_of_kind(a, property_symbol, Kind::GetAccessor);
                    if !getter_declaration.is_nil() {
                        let mut getter_signature =
                            c.get_signature_from_declaration(getter_declaration);
                        if !symbol_mapper.is_nil() {
                            getter_signature =
                                c.instantiate_signature(getter_signature, symbol_mapper);
                        }
                        let getter = self.signature_to_signature_declaration_helper(
                            c,
                            getter_signature,
                            Kind::GetAccessor,
                            Some(&SignatureToSignatureDeclarationOptions {
                                name: property_name,
                                ..Default::default()
                            }),
                        );
                        self.set_comment_range(c, getter, getter_declaration);
                        type_elements.push(getter);
                    }
                    let setter_declaration =
                        get_declaration_of_kind(a, property_symbol, Kind::SetAccessor);
                    if !setter_declaration.is_nil() {
                        let mut setter_signature =
                            c.get_signature_from_declaration(setter_declaration);
                        if !symbol_mapper.is_nil() {
                            setter_signature =
                                c.instantiate_signature(setter_signature, symbol_mapper);
                        }
                        let setter = self.signature_to_signature_declaration_helper(
                            c,
                            setter_signature,
                            Kind::SetAccessor,
                            Some(&SignatureToSignatureDeclarationOptions {
                                name: property_name,
                                ..Default::default()
                            }),
                        );
                        self.set_comment_range(c, setter, setter_declaration);
                        type_elements.push(setter);
                    }
                    return;
                } else if parent_is_class
                    && !prop_declaration.is_nil()
                    && a.modifier_nodes(prop_declaration)
                        .as_slice()
                        .iter()
                        .any(|m| a.kind(*m) == Kind::AccessorKeyword)
                {
                    let fake_getter_signature = c.new_signature(
                        SignatureFlags::NONE,
                        NodeId::NIL,
                        List::NIL,
                        SymbolId::NIL,
                        List::NIL,
                        property_type,
                        TypePredicateId::NIL,
                        0,
                    );
                    let fake_getter_declaration = self.signature_to_signature_declaration_helper(
                        c,
                        fake_getter_signature,
                        Kind::GetAccessor,
                        Some(&SignatureToSignatureDeclarationOptions {
                            name: property_name,
                            ..Default::default()
                        }),
                    );
                    self.set_comment_range(c, fake_getter_declaration, prop_declaration);
                    type_elements.push(fake_getter_declaration);

                    let setter_param = c.new_symbol(SymbolFlags::FUNCTION_SCOPED_VARIABLE, b"arg");
                    let links = c.value_symbol_links_get(setter_param);
                    c.value_symbol_links[links].resolved_type = write_type;
                    let void_type = c.void_type;
                    let parameters = c.list_of(&[setter_param]);
                    let fake_setter_signature = c.new_signature(
                        SignatureFlags::NONE,
                        NodeId::NIL,
                        List::NIL,
                        SymbolId::NIL,
                        parameters,
                        void_type,
                        TypePredicateId::NIL,
                        0,
                    );
                    let fake_setter_declaration = self.signature_to_signature_declaration_helper(
                        c,
                        fake_setter_signature,
                        Kind::SetAccessor,
                        Some(&SignatureToSignatureDeclarationOptions {
                            name: property_name,
                            ..Default::default()
                        }),
                    );
                    type_elements.push(fake_setter_declaration);
                    return;
                }
            }
        }

        let mut optional_token = NodeId::NIL;
        if property.flags.intersects(SymbolFlags::OPTIONAL) {
            optional_token = self.f(c).new_token(Kind::QuestionToken);
        }
        if property
            .flags
            .intersects(SymbolFlags::FUNCTION | SymbolFlags::METHOD)
            && c.get_properties_of_object_type(property_type).len() == 0
            && !c.is_readonly_symbol(property_symbol)
        {
            let defined_type = c.filter_type(property_type, &mut |c, t| {
                !c.types[t].flags.intersects(TypeFlags::UNDEFINED)
            });
            let signatures = c.get_signatures_of_type(defined_type, SignatureKind::CALL);
            for signature in signatures.iter() {
                let method_declaration = self.signature_to_signature_declaration_helper(
                    c,
                    signature,
                    Kind::MethodSignature,
                    Some(&SignatureToSignatureDeclarationOptions {
                        name: property_name,
                        question_token: optional_token,
                        ..Default::default()
                    }),
                );
                let mut comment_source = c.signatures[signature].declaration;
                if comment_source.is_nil() {
                    comment_source = property.value_declaration;
                }
                self.set_comment_range(c, method_declaration, comment_source);
                type_elements.push(method_declaration);
            }
            if signatures.len() != 0 || optional_token.is_nil() {
                return;
            }
        }
        let property_type_node;
        if self.should_use_placeholder_for_property(c, property_symbol) {
            property_type_node = self.create_elided_information_placeholder(c);
        } else {
            if property_is_reverse_mapped {
                self.ctx_mut(c).reverse_mapped_stack.push(property_symbol);
            }
            if !property_type.is_nil() {
                property_type_node = self.serialize_type_for_declaration(
                    c,
                    NodeId::NIL,
                    property_type,
                    property_symbol,
                    true,
                );
            } else {
                property_type_node = self.f(c).new_keyword_type_node(Kind::AnyKeyword);
            }
            if property_is_reverse_mapped {
                self.ctx_mut(c).reverse_mapped_stack.pop();
            }
        }

        let mut modifiers = ModifierListId::NIL;
        if c.is_readonly_symbol(property_symbol) {
            let readonly = self.f(c).new_modifier(Kind::ReadonlyKeyword);
            modifiers = self.f(c).new_modifier_list(&[readonly]);
            self.ctx_mut(c).approximate_length += 9;
        }
        let property_signature = self.f(c).new_property_signature_declaration(
            modifiers,
            property_name,
            optional_token,
            property_type_node,
            NodeId::NIL,
        );
        self.set_comment_range(c, property_signature, property.value_declaration);
        type_elements.push(property_signature);
    }
}

// nodebuilder_hover.go isExpanding: whether hover expansion is on for this context.
pub(crate) fn is_expanding(ctx: &NodeBuilderContext) -> bool {
    ctx.max_expansion_depth != -1
}

impl NodeBuilderImpl {
    // `resolved_type` is the type whose structured part upstream receives.
    pub(crate) fn create_type_nodes_from_resolved_type(
        self,
        c: &mut Checker<'_>,
        resolved_type: TypeId,
    ) -> NodeListId {
        let a = c.ast;
        if self.check_truncation_length(c) {
            if self.ctx(c).flags.intersects(Flags::NO_TRUNCATION) {
                let elem = self.f(c).new_not_emitted_type_element();
                let commented = c.node_builder.impl_.e.add_synthetic_trailing_comment(
                    elem,
                    Kind::MultiLineCommentTrivia,
                    b"elided",
                    false,
                );
                return self.f(c).new_node_list(&[commented]);
            }
            let name = self.f(c).new_identifier(b"...");
            let signature = self.f(c).new_property_signature_declaration(
                ModifierListId::NIL,
                name,
                NodeId::NIL,
                NodeId::NIL,
                NodeId::NIL,
            );
            return self.f(c).new_node_list(&[signature]);
        }
        let mut type_elements: Vec<NodeId> = Vec::new();
        let call_signatures = c.as_structured_type(resolved_type).call_signatures();
        for signature in call_signatures.as_slice() {
            type_elements.push(self.signature_to_signature_declaration_helper(
                c,
                *signature,
                Kind::CallSignature,
                None,
            ));
        }
        let construct_signatures = c.as_structured_type(resolved_type).construct_signatures();
        for signature in construct_signatures.as_slice() {
            if c.signatures[*signature]
                .flags
                .intersects(SignatureFlags::ABSTRACT)
            {
                continue;
            }
            type_elements.push(self.signature_to_signature_declaration_helper(
                c,
                *signature,
                Kind::ConstructSignature,
                None,
            ));
        }
        let index_infos = c.as_structured_type(resolved_type).index_infos;
        let is_reverse_mapped = c.types[resolved_type]
            .object_flags
            .intersects(ObjectFlags::REVERSE_MAPPED);
        for info in index_infos.as_slice() {
            // Upstream passes the placeholder through core.IfElse, which evaluates it for every index info.
            let placeholder = self.create_elided_information_placeholder(c);
            let type_node = if is_reverse_mapped {
                placeholder
            } else {
                NodeId::NIL
            };
            let nodes = self
                .index_info_to_object_computed_names_or_signature_declaration(c, *info, type_node);
            type_elements.extend_from_slice(&nodes);
        }

        let properties = c.as_structured_type(resolved_type).properties;
        let properties = properties.as_slice();
        let Some(&last_property) = properties.last() else {
            return self.f(c).new_node_list(&type_elements);
        };

        let mut i: usize = 0;
        for property_symbol in properties.iter().copied() {
            let property = a.sym(property_symbol);
            if is_expanding(self.ctx(c)) && property.flags.intersects(SymbolFlags::PROTOTYPE) {
                continue;
            }
            i += 1;
            if self
                .ctx(c)
                .flags
                .intersects(Flags::WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL)
            {
                if property.flags.intersects(SymbolFlags::PROTOTYPE) {
                    continue;
                }
                if get_declaration_modifier_flags_from_symbol(a, property_symbol)
                    .intersects(ModifierFlags::PRIVATE | ModifierFlags::PROTECTED)
                {
                    SymbolTrackerImpl::report_private_in_base_of_class_expression(
                        self.ctx_mut(c),
                        property.name,
                    );
                }
                if is_private_identifier_symbol(a, property_symbol) {
                    let name = symbol_name(a, property_symbol);
                    SymbolTrackerImpl::report_private_in_base_of_class_expression(
                        self.ctx_mut(c),
                        &name,
                    );
                }
            }
            if self.check_truncation_length(c) && (i + 2 < properties.len() - 1) {
                let more = properties.len() - i;
                if self.ctx(c).flags.intersects(Flags::NO_TRUNCATION) {
                    if let Some(last) = type_elements.last().copied() {
                        let commented = c.node_builder.impl_.e.add_synthetic_trailing_comment(
                            last,
                            Kind::MultiLineCommentTrivia,
                            format!("... {more} more elided ...").as_bytes(),
                            false,
                        );
                        if let Some(slot) = type_elements.last_mut() {
                            *slot = commented;
                        }
                    }
                } else {
                    let name = self
                        .f(c)
                        .new_identifier(format!("... {more} more ...").as_bytes());
                    let signature = self.f(c).new_property_signature_declaration(
                        ModifierListId::NIL,
                        name,
                        NodeId::NIL,
                        NodeId::NIL,
                        NodeId::NIL,
                    );
                    type_elements.push(signature);
                }
                self.add_property_to_element_list(c, last_property, &mut type_elements);
                break;
            }
            self.add_property_to_element_list(c, property_symbol, &mut type_elements);
        }
        if !type_elements.is_empty() {
            self.f(c).new_node_list(&type_elements)
        } else {
            NodeListId::NIL
        }
    }

    pub(crate) fn create_type_node_from_object_type(
        self,
        c: &mut Checker<'_>,
        t: TypeId,
    ) -> NodeId {
        let a = c.ast;
        if c.is_generic_mapped_type(t)
            || (c.types[t].object_flags.intersects(ObjectFlags::MAPPED)
                && c.as_mapped_type(t).contains_error)
        {
            return self.create_mapped_type_node_from_type(c, t);
        }
        c.resolve_structured_type_members(t);
        let resolved = t;
        let call_sigs = c.as_structured_type(resolved).call_signatures();
        let ctor_sigs = c.as_structured_type(resolved).construct_signatures();
        let properties = c.as_structured_type(resolved).properties;
        let index_infos = c.as_structured_type(resolved).index_infos;
        let (call_sigs, ctor_sigs) = (call_sigs.as_slice(), ctor_sigs.as_slice());
        if properties.as_slice().is_empty() && index_infos.as_slice().is_empty() {
            if call_sigs.is_empty() && ctor_sigs.is_empty() {
                self.ctx_mut(c).approximate_length += 2;
                let members = self.f(c).new_node_list(&[]);
                let result = self.f(c).new_type_literal_node(members);
                c.node_builder
                    .impl_
                    .e
                    .set_emit_flags(result, EmitFlags::SINGLE_LINE);
                return result;
            }
            if let ([signature], []) = (call_sigs, ctor_sigs) {
                return self.signature_to_signature_declaration_helper(
                    c,
                    *signature,
                    Kind::FunctionType,
                    None,
                );
            }
            if let ([signature], []) = (ctor_sigs, call_sigs) {
                return self.signature_to_signature_declaration_helper(
                    c,
                    *signature,
                    Kind::ConstructorType,
                    None,
                );
            }
        }
        let abstract_signatures: Vec<SignatureId> = ctor_sigs
            .iter()
            .copied()
            .filter(|signature| {
                c.signatures[*signature]
                    .flags
                    .intersects(SignatureFlags::ABSTRACT)
            })
            .collect();
        if !abstract_signatures.is_empty() {
            let mut types: Vec<TypeId> = Vec::with_capacity(abstract_signatures.len() + 1);
            for s in &abstract_signatures {
                types.push(c.get_or_create_type_from_signature(*s));
            }
            // count the number of type elements excluding abstract constructors
            let property_count = if self
                .ctx(c)
                .flags
                .intersects(Flags::WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL)
            {
                properties
                    .as_slice()
                    .iter()
                    .filter(|p| !a.sym(**p).flags.intersects(SymbolFlags::PROTOTYPE))
                    .count()
            } else {
                properties.as_slice().len()
            };
            let type_element_count = call_sigs.len()
                + (ctor_sigs.len() - abstract_signatures.len())
                + index_infos.as_slice().len()
                + property_count;
            // don't include an empty object literal if there were no other static-side properties to write, i.e. `abstract class C { }` becomes `abstract new () => {}` and not `(abstract new () => {}) & {}`
            if type_element_count != 0 {
                // create a copy of the object type without any abstract construct signatures.
                types.push(
                    self.get_resolved_type_without_abstract_construct_signatures(c, resolved),
                );
            }
            let intersection = c.get_intersection_type(&types);
            return self.type_to_type_node(c, intersection);
        }

        let restore_flags = self.save_restore_flags(c);
        self.ctx_mut(c).flags |= Flags::IN_OBJECT_TYPE_LITERAL;
        let members = self.create_type_nodes_from_resolved_type(c, resolved);
        self.restore_flags(c, restore_flags);
        let type_literal_node = self.f(c).new_type_literal_node(members);
        self.ctx_mut(c).approximate_length += 2;
        let emit_flags = if self
            .ctx(c)
            .flags
            .intersects(Flags::MULTILINE_OBJECT_LITERALS)
        {
            EmitFlags::NONE
        } else {
            EmitFlags::SINGLE_LINE
        };
        c.node_builder
            .impl_
            .e
            .set_emit_flags(type_literal_node, emit_flags);
        type_literal_node
    }
}

pub(crate) fn get_type_alias_for_type_literal(c: &mut Checker<'_>, t: TypeId) -> SymbolId {
    let a = c.ast;
    let symbol = c.types[t].symbol;
    if !symbol.is_nil() && a.sym(symbol).flags.intersects(SymbolFlags::TYPE_LITERAL) {
        if let Some(&declaration) = a.sym(symbol).declarations.as_slice().first() {
            let node = walk_up_parenthesized_types(a, a.parent(declaration));
            if is_type_alias_declaration(a, node) {
                return c.get_symbol_of_declaration(node);
            }
        }
    }
    SymbolId::NIL
}

impl NodeBuilderImpl {
    pub(crate) fn should_write_type_of_function_symbol(
        self,
        c: &mut Checker<'_>,
        symbol: SymbolId,
        type_id: TypeId,
    ) -> (bool, SymbolId) {
        let a = c.ast;
        let mut symbol = symbol;
        let sym = a.sym(symbol);
        let mut is_static_method_symbol = false;
        if sym.flags.intersects(SymbolFlags::METHOD) {
            // typeof static method
            for declaration in sym.declarations.as_slice() {
                if is_static(a, *declaration)
                    && !c.is_late_bindable_index_signature(get_name_of_declaration(a, *declaration))
                {
                    is_static_method_symbol = true;
                    break;
                }
            }
        }
        let mut is_non_local_function_symbol = false;
        let mut is_function_expression_symbol = false;
        if sym.flags.intersects(SymbolFlags::FUNCTION) {
            if !sym.parent.is_nil() {
                // is exported function symbol
                is_non_local_function_symbol = true;
            } else {
                for declaration in sym.declarations.as_slice().iter().copied() {
                    let parent = a.parent(declaration);
                    if a.kind(parent) == Kind::SourceFile || a.kind(parent) == Kind::ModuleBlock {
                        is_non_local_function_symbol = true;
                        break;
                    }
                    // A function expression or an arrow function assigned to a const or let at the top level behaves like a function declaration: `const foo = function() {}`.
                    let parent2 = a.parent(parent);
                    let parent3 = a.parent(parent2);
                    let parent4 = a.parent(parent3);
                    if is_function_expression_or_arrow_function(a, declaration)
                        && is_variable_declaration(a, parent)
                        && is_variable_declaration_list(a, parent2)
                        && is_variable_statement(a, parent3)
                        && !parent4.is_nil()
                        && (a.kind(parent4) == Kind::SourceFile
                            || a.kind(parent4) == Kind::ModuleBlock)
                    {
                        is_non_local_function_symbol = true;
                        is_function_expression_symbol = true;
                        break;
                    }
                }
            }
        }
        if is_static_method_symbol || is_non_local_function_symbol {
            // typeof is allowed only for static/non local functions
            let enclosing_declaration = self.ctx(c).enclosing_declaration;
            if is_function_expression_symbol && !sym.value_declaration.is_nil() {
                let value_parent = a.parent(sym.value_declaration);
                if !value_parent.is_nil() && value_parent != enclosing_declaration {
                    // Use the symbol of the variable declaration, not the function expression, when the type is used outside of its own initializer.
                    symbol = c.get_merged_symbol(a.symbol(value_parent));
                }
            }
            // The type of the symbol uses itself recursively, and the build succeeds without a visibility error or no structural fallback is allowed.
            let use_type_of = self.ctx(c).flags.intersects(Flags::USE_TYPE_OF_FUNCTION)
                || self.ctx(c).visited_types.has(&type_id);
            let result = use_type_of
                && (!self.ctx(c).flags.intersects(Flags::USE_STRUCTURAL_FALLBACK)
                    || c.is_value_symbol_accessible(symbol, enclosing_declaration));
            return (result, symbol);
        }
        (false, symbol)
    }

    pub(crate) fn create_anonymous_type_node(self, c: &mut Checker<'_>, t: TypeId) -> NodeId {
        self.create_anonymous_type_node_ex(c, t, false, false)
    }

    pub(crate) fn should_emit_type_of_symbol(
        self,
        c: &mut Checker<'_>,
        force_expansion: bool,
        force_class_expansion: bool,
        is_instance_type: SymbolFlags,
        symbol: SymbolId,
        type_id: TypeId,
    ) -> (bool, SymbolId) {
        if force_expansion {
            return (false, symbol);
        }
        let a = c.ast;
        let sym = a.sym(symbol);
        // Always use 'typeof T' for type of class, enum, and module objects
        let non_function_result = sym.flags.intersects(SymbolFlags::CLASS)
            && !force_class_expansion
            && c.get_base_type_variable_of_class(symbol).is_nil()
            && !(!sym.value_declaration.is_nil()
                && is_class_like(a, sym.value_declaration)
                && self
                    .ctx(c)
                    .flags
                    .intersects(Flags::WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL)
                && (!is_class_declaration(a, sym.value_declaration) || {
                    let enclosing_declaration = self.ctx(c).enclosing_declaration;
                    c.is_symbol_accessible(symbol, enclosing_declaration, is_instance_type, false)
                        .accessibility
                        != SymbolAccessibility::Accessible
                }))
            || sym
                .flags
                .intersects(SymbolFlags::ENUM | SymbolFlags::VALUE_MODULE);
        if non_function_result {
            return (true, symbol);
        }
        self.should_write_type_of_function_symbol(c, symbol, type_id)
    }

    pub(crate) fn create_anonymous_type_node_ex(
        self,
        c: &mut Checker<'_>,
        t: TypeId,
        force_class_expansion: bool,
        force_expansion: bool,
    ) -> NodeId {
        let a = c.ast;
        let type_id = t;
        let symbol = c.types[t].symbol;
        if symbol.is_nil() {
            // Anonymous types without a symbol are never circular.
            return self.create_type_node_from_object_type(c, t);
        }
        let is_instantiation_expression_type = c.types[t]
            .object_flags
            .intersects(ObjectFlags::INSTANTIATION_EXPRESSION_TYPE);
        if is_instantiation_expression_type {
            let existing = c.as_instantiation_expression_type(t).node;
            // instantiationExpressionType.node is unreliable for constituents of unions and intersections: a reuse is only valid when the node resolves back to this type.
            if is_type_query_node(a, existing)
                && self.get_type_from_type_node(c, existing, false) == t
            {
                if self.ctx(c).visited_types.has(&type_id) {
                    return self.create_elided_information_placeholder(c);
                }
                self.ctx_mut(c).visited_types.add(type_id);
                let type_node = self.try_reuse_existing_non_parameter_type_node(
                    c,
                    existing,
                    t,
                    NodeId::NIL,
                    TypeId::NIL,
                );
                self.ctx_mut(c).visited_types.delete(&type_id);
                if !type_node.is_nil() {
                    return type_node;
                }
            }
            if self.ctx(c).visited_types.has(&type_id) {
                return self.create_elided_information_placeholder(c);
            }
            return self.visit_and_transform_type(
                c,
                t,
                NodeBuilderImpl::create_type_node_from_object_type,
            );
        }
        let is_instance_type = if is_class_instance_side(c, t) {
            SymbolFlags::TYPE
        } else {
            SymbolFlags::VALUE
        };
        let (ok, symbol) = self.should_emit_type_of_symbol(
            c,
            force_expansion,
            force_class_expansion,
            is_instance_type,
            symbol,
            type_id,
        );
        if ok {
            if self.should_expand_type(c, t, false) {
                self.ctx_mut(c).depth += 1;
            } else {
                return self.symbol_to_type_node(c, symbol, is_instance_type, NodeListId::NIL);
            }
        }
        if self.ctx(c).visited_types.has(&type_id) {
            // If type is an anonymous type literal in a type alias declaration, use type alias name
            let type_alias = get_type_alias_for_type_literal(c, t);
            if !type_alias.is_nil() {
                // The specified symbol flags need to be reinterpreted as type flags
                self.symbol_to_type_node(c, type_alias, SymbolFlags::TYPE, NodeListId::NIL)
            } else {
                self.create_elided_information_placeholder(c)
            }
        } else {
            self.visit_and_transform_type(c, t, NodeBuilderImpl::create_type_node_from_object_type)
        }
    }

    pub(crate) fn get_type_from_type_node(
        self,
        c: &mut Checker<'_>,
        node: NodeId,
        no_mapped_types: bool,
    ) -> TypeId {
        // A synthetic node without a parent has no type: upstream dereferences a nil node here.
        if node.is_nil() || c.ast.parent(node).is_nil() {
            return c.error_type;
        }
        let t = c.get_type_from_type_node(node);
        let mapper = self.ctx(c).mapper;
        if mapper.is_nil() {
            return t;
        }
        let instantiated = c.instantiate_type(t, mapper);
        if no_mapped_types && instantiated != t {
            return TypeId::NIL;
        }
        instantiated
    }

    pub(crate) fn type_to_type_node_or_circularity_elision(
        self,
        c: &mut Checker<'_>,
        t: TypeId,
    ) -> NodeId {
        if c.types[t].flags.intersects(TypeFlags::UNION) {
            if self.ctx(c).visited_types.has(&t) {
                let ctx = self.ctx_mut(c);
                if !ctx.flags.intersects(Flags::ALLOW_ANONYMOUS_IDENTIFIER) {
                    ctx.encountered_error = true;
                    SymbolTrackerImpl::report_cyclic_structure_error(ctx);
                }
                return self.create_elided_information_placeholder(c);
            }
            return self.visit_and_transform_type(c, t, NodeBuilderImpl::type_to_type_node);
        }
        self.type_to_type_node(c, t)
    }
}

impl NodeBuilderImpl {
    pub(crate) fn conditional_type_to_type_node(self, c: &mut Checker<'_>, t_: TypeId) -> NodeId {
        if self.check_truncation_length(c) {
            return self.create_elided_information_placeholder(c);
        }
        let a = c.ast;
        let (check_type, extends_type, root, mapper) = {
            let t = c.as_conditional_type(t_);
            (t.check_type, t.extends_type, t.root, t.mapper)
        };
        let (root_is_distributive, root_check_type, root_extends_type, root_node) = {
            let root = &c.conditional_roots[root];
            (
                root.is_distributive,
                root.check_type,
                root.extends_type,
                root.node,
            )
        };
        let root_infer_type_parameters: Vec<TypeId> = c.conditional_roots[root]
            .infer_type_parameters
            .as_slice()
            .to_vec();
        let check_type_node = self.type_to_type_node(c, check_type);
        self.ctx_mut(c).approximate_length += 15;
        if self
            .ctx(c)
            .flags
            .intersects(Flags::GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS)
            && root_is_distributive
            && !c.types[check_type]
                .flags
                .intersects(TypeFlags::TYPE_PARAMETER)
        {
            let new_symbol = c.new_symbol(SymbolFlags::TYPE_PARAMETER, b"T");
            let new_param = c.new_type_parameter(new_symbol);
            let name = self.type_parameter_to_name(c, new_param);
            let new_type_variable = self.f(c).new_type_reference_node(name, NodeListId::NIL);
            self.ctx_mut(c).approximate_length += 37;
            // 15 each for two added conditionals, 7 for an added infer type
            let new_mapper = prepend_type_mapping(c, root_check_type, new_param, mapper);
            let save_infer_type_parameters = std::mem::replace(
                &mut self.ctx_mut(c).infer_type_parameters,
                root_infer_type_parameters,
            );
            let instantiated_extends = c.instantiate_type(root_extends_type, new_mapper);
            let extends_type_node = self.type_to_type_node(c, instantiated_extends);
            self.ctx_mut(c).infer_type_parameters = save_infer_type_parameters;
            let root_conditional = a.as_conditional_type_node(root_node);
            let true_type = self.get_type_from_type_node(c, root_conditional.true_type, false);
            let instantiated_true = c.instantiate_type(true_type, new_mapper);
            let true_type_node =
                self.type_to_type_node_or_circularity_elision(c, instantiated_true);
            let false_type = self.get_type_from_type_node(c, root_conditional.false_type, false);
            let instantiated_false = c.instantiate_type(false_type, new_mapper);
            let false_type_node =
                self.type_to_type_node_or_circularity_elision(c, instantiated_false);

            // outermost conditional makes `T` a type parameter, allowing the inner conditionals to be distributive; second conditional makes `T` have `T & checkType` substitution; inner conditional runs the check the user provided on the check type (distributively) and returns the result.
            let variable_name = a.as_type_reference_node(new_type_variable).type_name;
            let new_id = self.f(c).clone_node(variable_name);
            let infer_parameter = self.f(c).new_type_parameter_declaration(
                ModifierListId::NIL,
                new_id,
                NodeId::NIL,
                NodeId::NIL,
                NodeId::NIL,
            );
            let synthetic_extends_node = self.f(c).new_infer_type_node(infer_parameter);
            let inner_check_conditional_node = self.f(c).new_conditional_type_node(
                new_type_variable,
                extends_type_node,
                true_type_node,
                false_type_node,
            );
            let name_clone = self.f(c).clone_node(name);
            let synthetic_check = self
                .f(c)
                .new_type_reference_node(name_clone, NodeListId::NIL);
            let check_type_clone = self.f(c).deep_clone_node(check_type_node);
            let never = self.f(c).new_keyword_type_node(Kind::NeverKeyword);
            let synthetic_true_node = self.f(c).new_conditional_type_node(
                synthetic_check,
                check_type_clone,
                inner_check_conditional_node,
                never,
            );
            let never = self.f(c).new_keyword_type_node(Kind::NeverKeyword);
            return self.f(c).new_conditional_type_node(
                check_type_node,
                synthetic_extends_node,
                synthetic_true_node,
                never,
            );
        }
        let save_infer_type_parameters = std::mem::replace(
            &mut self.ctx_mut(c).infer_type_parameters,
            root_infer_type_parameters,
        );
        let extends_type_node = self.type_to_type_node(c, extends_type);
        self.ctx_mut(c).infer_type_parameters = save_infer_type_parameters;
        let true_type = c.get_true_type_from_conditional_type(t_);
        let true_type_node = self.type_to_type_node_or_circularity_elision(c, true_type);
        let false_type = c.get_false_type_from_conditional_type(t_);
        let false_type_node = self.type_to_type_node_or_circularity_elision(c, false_type);
        self.f(c).new_conditional_type_node(
            check_type_node,
            extends_type_node,
            true_type_node,
            false_type_node,
        )
    }

    pub(crate) fn get_parent_symbol_of_type_parameter(
        self,
        c: &mut Checker<'_>,
        type_parameter: TypeId,
    ) -> SymbolId {
        let a = c.ast;
        let tp = get_declaration_of_kind(a, c.types[type_parameter].symbol, Kind::TypeParameter);
        // A type parameter without a declaration has no host: upstream dereferences nil here.
        if tp.is_nil() {
            return SymbolId::NIL;
        }
        let host = a.parent(tp);
        if host.is_nil() {
            return SymbolId::NIL;
        }
        c.get_symbol_of_node(host)
    }

    pub(crate) fn type_reference_to_type_node(self, c: &mut Checker<'_>, t: TypeId) -> NodeId {
        let a = c.ast;
        let mut type_arguments: Vec<TypeId> = c.get_type_arguments(t).as_slice().to_vec();
        let target = c.as_type_reference(t).target;
        if target == c.global_array_type || target == c.global_readonly_array_type {
            let element = type_arguments.first().copied().unwrap_or(TypeId::NIL);
            if self
                .ctx(c)
                .flags
                .intersects(Flags::WRITE_ARRAY_AS_GENERIC_TYPE)
            {
                let type_argument_node = self.type_to_type_node(c, element);
                let name: &[u8] = if target == c.global_array_type {
                    b"Array"
                } else {
                    b"ReadonlyArray"
                };
                let target_symbol = c.types[target].symbol;
                let identifier = self.new_identifier(c, name, target_symbol);
                let arguments = self.f(c).new_node_list(&[type_argument_node]);
                return self.f(c).new_type_reference_node(identifier, arguments);
            }
            let element_type = self.type_to_type_node(c, element);
            let array_type = self.f(c).new_array_type_node(element_type);
            if target == c.global_array_type {
                return array_type;
            }
            return self
                .f(c)
                .new_type_operator_node(Kind::ReadonlyKeyword, array_type);
        } else if c.types[target].object_flags.intersects(ObjectFlags::TUPLE) {
            let element_infos: Vec<TupleElementInfo> =
                c.as_tuple_type(target).element_infos.as_slice().to_vec();
            let readonly = c.as_tuple_type(target).readonly;
            for (i, arg) in type_arguments.iter_mut().enumerate() {
                let is_optional = element_infos
                    .get(i)
                    .is_some_and(|info| info.flags.intersects(ElementFlags::OPTIONAL));
                *arg = c.remove_missing_type(*arg, is_optional);
            }
            if !type_arguments.is_empty() {
                let arity = usize::try_from(c.get_type_reference_arity(t)).unwrap_or(0);
                let tuple_constituent_nodes =
                    self.map_to_type_nodes(c, type_arguments.get(..arity).unwrap_or(&[]), false);
                if !tuple_constituent_nodes.is_nil() {
                    // Upstream rewrites the nodes of the list in place: a list is immutable here, so the rewritten nodes make a new list.
                    let mut nodes: Vec<NodeId> =
                        a.nodes(tuple_constituent_nodes).as_slice().to_vec();
                    for (i, node) in nodes.iter_mut().enumerate() {
                        let Some(info) = element_infos.get(i).copied() else {
                            break;
                        };
                        let flags = info.flags;
                        if !info.labeled_declaration.is_nil() {
                            let dot_dot_dot = if flags.intersects(ElementFlags::VARIABLE) {
                                self.f(c).new_token(Kind::DotDotDotToken)
                            } else {
                                NodeId::NIL
                            };
                            let label = c.get_tuple_element_label(info, SymbolId::NIL, i as isize);
                            let name = self.new_identifier(c, &label, SymbolId::NIL);
                            let question = if flags.intersects(ElementFlags::OPTIONAL) {
                                self.f(c).new_token(Kind::QuestionToken)
                            } else {
                                NodeId::NIL
                            };
                            let element_type = if flags.intersects(ElementFlags::REST) {
                                self.f(c).new_array_type_node(*node)
                            } else {
                                *node
                            };
                            *node = self.f(c).new_named_tuple_member(
                                dot_dot_dot,
                                name,
                                question,
                                element_type,
                            );
                        } else if flags.intersects(ElementFlags::VARIABLE) {
                            let element_type = if flags.intersects(ElementFlags::REST) {
                                self.f(c).new_array_type_node(*node)
                            } else {
                                *node
                            };
                            *node = self.f(c).new_rest_type_node(element_type);
                        } else if flags.intersects(ElementFlags::OPTIONAL) {
                            *node = self.f(c).new_optional_type_node(*node);
                        }
                    }
                    let elements = self.f(c).new_node_list(&nodes);
                    let tuple_type_node = self.f(c).new_tuple_type_node(elements);
                    c.node_builder
                        .impl_
                        .e
                        .set_emit_flags(tuple_type_node, EmitFlags::SINGLE_LINE);
                    if readonly {
                        return self
                            .f(c)
                            .new_type_operator_node(Kind::ReadonlyKeyword, tuple_type_node);
                    }
                    return tuple_type_node;
                }
            }
            if self.ctx(c).encountered_error
                || self.ctx(c).flags.intersects(Flags::ALLOW_EMPTY_TUPLE)
            {
                let elements = self.f(c).new_node_list(&[]);
                let tuple_type_node = self.f(c).new_tuple_type_node(elements);
                c.node_builder
                    .impl_
                    .e
                    .set_emit_flags(tuple_type_node, EmitFlags::SINGLE_LINE);
                if readonly {
                    return self
                        .f(c)
                        .new_type_operator_node(Kind::ReadonlyKeyword, tuple_type_node);
                }
                return tuple_type_node;
            }
            self.ctx_mut(c).encountered_error = true;
            return NodeId::NIL;
        }
        let t_symbol = c.types[t].symbol;
        let enclosing_declaration = self.ctx(c).enclosing_declaration;
        if self
            .ctx(c)
            .flags
            .intersects(Flags::WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL)
            && !t_symbol.is_nil()
            && !a.sym(t_symbol).value_declaration.is_nil()
            && is_class_like(a, a.sym(t_symbol).value_declaration)
            && !c.is_value_symbol_accessible(t_symbol, enclosing_declaration)
        {
            return self.create_anonymous_type_node(c, t);
        }
        let outer_type_parameters: Vec<TypeId> = c
            .as_interface_type(target)
            .outer_type_parameters()
            .as_slice()
            .to_vec();
        let mut i: usize = 0;
        let mut result_type = NodeId::NIL;
        let length = outer_type_parameters.len();
        while i < length {
            // Find group of type arguments for type parameters with the same declaring container.
            let start = i;
            let parent = match outer_type_parameters.get(i) {
                Some(type_parameter) => {
                    self.get_parent_symbol_of_type_parameter(c, *type_parameter)
                }
                None => SymbolId::NIL,
            };
            loop {
                i += 1;
                let Some(&next) = outer_type_parameters.get(i) else {
                    break;
                };
                if self.get_parent_symbol_of_type_parameter(c, next) != parent {
                    break;
                }
            }
            // When type parameters are their own type arguments for the whole group (i.e. we have the default outer type arguments), we don't show the group.
            let outer_group = outer_type_parameters.get(start..i).unwrap_or(&[]);
            let argument_group = type_arguments.get(start..i).unwrap_or(&[]);
            if outer_group != argument_group {
                let type_argument_slice = self.map_to_type_nodes(c, argument_group, false);
                let restore_flags = self.save_restore_flags(c);
                self.ctx_mut(c).flags |= Flags::FORBID_INDEXED_ACCESS_SYMBOL_REFERENCES;
                let ref_ =
                    self.symbol_to_type_node(c, parent, SymbolFlags::TYPE, type_argument_slice);
                self.restore_flags(c, restore_flags);
                if result_type.is_nil() {
                    result_type = ref_;
                } else {
                    result_type = self.append_reference_to_type(c, result_type, ref_);
                }
            }
        }
        let mut type_argument_nodes = NodeListId::NIL;
        if !type_arguments.is_empty() {
            let mut type_parameter_count: usize = 0;
            let type_params: Vec<TypeId> = c
                .as_interface_type(target)
                .type_parameters()
                .as_slice()
                .to_vec();
            if !type_params.is_empty() {
                type_parameter_count = type_params.len().min(type_arguments.len());
                // Maybe we should do this for more types, but for now we only elide type arguments that are identical to their associated type parameters' defaults for `Iterable`, `IterableIterator`, `AsyncIterable`, and `AsyncIterableIterator` to provide backwards-compatible .d.ts emit due to each now having three type parameters instead of only one.
                let iterable = c.get_global_iterable_type();
                let iterable_iterator = c.get_global_iterable_iterator_type();
                let async_iterable = c.get_global_async_iterable_type();
                let async_iterable_iterator = c.get_global_async_iterable_iterator_type();
                if c.is_reference_to_type(t, iterable)
                    || c.is_reference_to_type(t, iterable_iterator)
                    || c.is_reference_to_type(t, async_iterable)
                    || c.is_reference_to_type(t, async_iterable_iterator)
                {
                    let reference_node = c.as_type_reference(t).node;
                    if reference_node.is_nil()
                        || !is_type_reference_node(a, reference_node)
                        || a.type_arguments(reference_node).is_nil()
                        || (a.type_arguments(reference_node).len() as usize) < type_parameter_count
                    {
                        while type_parameter_count > 0 {
                            let type_argument = type_arguments
                                .get(type_parameter_count - 1)
                                .copied()
                                .unwrap_or(TypeId::NIL);
                            let type_parameter = type_params
                                .get(type_parameter_count - 1)
                                .copied()
                                .unwrap_or(TypeId::NIL);
                            let default_type = c.get_default_from_type_parameter(type_parameter);
                            if default_type.is_nil()
                                || !c.is_type_identical_to(type_argument, default_type)
                            {
                                break;
                            }
                            type_parameter_count -= 1;
                        }
                    }
                }
            }
            type_argument_nodes = self.map_to_type_nodes(
                c,
                type_arguments.get(i..type_parameter_count).unwrap_or(&[]),
                false,
            );
        }
        let restore_flags = self.save_restore_flags(c);
        self.ctx_mut(c).flags |= Flags::FORBID_INDEXED_ACCESS_SYMBOL_REFERENCES;
        let final_ref =
            self.symbol_to_type_node(c, t_symbol, SymbolFlags::TYPE, type_argument_nodes);
        self.restore_flags(c, restore_flags);
        if result_type.is_nil() {
            final_ref
        } else {
            self.append_reference_to_type(c, result_type, final_ref)
        }
    }

    pub(crate) fn visit_and_transform_type(
        self,
        c: &mut Checker<'_>,
        t: TypeId,
        transform: fn(NodeBuilderImpl, &mut Checker<'_>, TypeId) -> NodeId,
    ) -> NodeId {
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        let a = c.ast;
        let type_id = t;
        let t_symbol = c.types[t].symbol;
        let object_flags = c.types[t].object_flags;
        let is_constructor_object = object_flags.intersects(ObjectFlags::ANONYMOUS)
            && !t_symbol.is_nil()
            && a.sym(t_symbol).flags.intersects(SymbolFlags::CLASS);
        let id: Option<CompositeSymbolIdentity> = if object_flags.intersects(ObjectFlags::REFERENCE)
            && !c.as_type_reference(t).node.is_nil()
        {
            Some(CompositeSymbolIdentity {
                is_constructor_node: false,
                symbol_id: SymbolId::NIL,
                node_id: c.as_type_reference(t).node,
            })
        } else if c.types[t].flags.intersects(TypeFlags::CONDITIONAL) {
            let root = c.as_conditional_type(t).root;
            Some(CompositeSymbolIdentity {
                is_constructor_node: false,
                symbol_id: SymbolId::NIL,
                node_id: c.conditional_roots[root].node,
            })
        } else if !t_symbol.is_nil() {
            get_symbol_id(a, t_symbol);
            Some(CompositeSymbolIdentity {
                is_constructor_node: is_constructor_object,
                symbol_id: t_symbol,
                node_id: NodeId::NIL,
            })
        } else {
            None
        };
        // Since instantiations of the same anonymous type have the same symbol, tracking symbols instead of types lets us catch infinitely expanding instantiations.
        let key = CompositeTypeCacheIdentity {
            type_id,
            flags: self.ctx(c).flags,
            internal_flags: self.ctx(c).internal_flags,
        };
        // Don't rely on type cache if we're expanding a type, because we need to compute `canIncreaseExpansionDepth`.
        let can_use_cache = self.ctx(c).max_expansion_depth < 0;
        let enclosing_declaration = self.ctx(c).enclosing_declaration;
        if can_use_cache && !enclosing_declaration.is_nil() {
            let cached_result = c
                .node_builder
                .impl_
                .links
                .get(&enclosing_declaration)
                .and_then(|links| links.serialized_types.get(&key))
                .cloned();
            if let Some(cached_result) = cached_result {
                for arg in &cached_result.tracked_symbols {
                    self.track_symbol(c, arg.symbol, arg.enclosing_declaration, arg.meaning);
                }
                let ctx = self.ctx_mut(c);
                if cached_result.truncating {
                    ctx.truncating = true;
                }
                ctx.approximate_length += cached_result.added_length;
                return self.f(c).deep_clone_node(cached_result.node);
            }
        }
        let mut depth: isize = 0;
        if let Some(id) = id {
            depth = self.ctx(c).symbol_depth.get(&id).copied().unwrap_or(0);
            if depth > 10 {
                return self.create_elided_information_placeholder(c);
            }
            self.ctx_mut(c).symbol_depth.insert(id, depth + 1);
        }
        self.ctx_mut(c).visited_types.add(type_id);
        let prev_tracked_symbols = std::mem::take(&mut self.ctx_mut(c).tracked_symbols);
        let start_length = self.ctx(c).approximate_length;
        let result = transform(self, c, t);
        let added_length = self.ctx(c).approximate_length - start_length;
        let tracked_symbols =
            std::mem::replace(&mut self.ctx_mut(c).tracked_symbols, prev_tracked_symbols);
        let (reported_diagnostic, encountered_error, truncating) = {
            let ctx = self.ctx(c);
            (
                ctx.reported_diagnostic,
                ctx.encountered_error,
                ctx.truncating,
            )
        };
        if can_use_cache && !reported_diagnostic && !encountered_error {
            c.node_builder
                .impl_
                .links
                .entry(enclosing_declaration)
                .or_default()
                .serialized_types
                .insert(
                    key,
                    SerializedTypeEntry {
                        node: result,
                        truncating,
                        added_length,
                        tracked_symbols,
                    },
                );
        }
        self.ctx_mut(c).visited_types.delete(&type_id);
        if let Some(id) = id {
            self.ctx_mut(c).symbol_depth.insert(id, depth);
        }
        result
    }
}

impl NodeBuilderImpl {
    pub(crate) fn type_to_type_node(self, c: &mut Checker<'_>, t: TypeId) -> NodeId {
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        let pushed = self.ctx(c).max_expansion_depth >= 0 && !t.is_nil();
        if pushed {
            self.ctx_mut(c).type_stack.push(t);
        }
        let mut alias_depth = false;
        let result = self.type_to_type_node_worker(c, t, &mut alias_depth);
        // The two defers of upstream, in their order: the depth of an expanded alias, then the type stack.
        if alias_depth {
            self.ctx_mut(c).depth -= 1;
        }
        if pushed {
            self.ctx_mut(c).type_stack.pop();
        }
        result
    }

    fn type_to_type_node_worker(
        self,
        c: &mut Checker<'_>,
        t: TypeId,
        alias_depth: &mut bool,
    ) -> NodeId {
        let a = c.ast;
        let mut t = t;
        let in_type_alias = self.ctx(c).flags.intersects(Flags::IN_TYPE_ALIAS);
        {
            let ctx = self.ctx_mut(c);
            ctx.flags = ctx.flags.without(Flags::IN_TYPE_ALIAS);
        }

        if t.is_nil() {
            let ctx = self.ctx_mut(c);
            if !ctx
                .flags
                .intersects(Flags::ALLOW_EMPTY_UNION_OR_INTERSECTION)
            {
                ctx.encountered_error = true;
                return NodeId::NIL;
            }
            ctx.approximate_length += 3;
            return self.f(c).new_keyword_type_node(Kind::AnyKeyword);
        }

        if !self.ctx(c).flags.intersects(Flags::NO_TYPE_REDUCTION) {
            t = c.get_reduced_type(t);
        }

        let flags = c.types[t].flags;
        let alias = c.types[t].alias;
        let t_symbol = c.types[t].symbol;
        if flags.intersects(TypeFlags::ANY) {
            if !alias.is_nil() {
                return self.type_alias_to_type_reference_node(c, alias);
            }
            if t == c.unresolved_type {
                let any = self.f(c).new_keyword_type_node(Kind::AnyKeyword);
                return c.node_builder.impl_.e.add_synthetic_leading_comment(
                    any,
                    Kind::MultiLineCommentTrivia,
                    b"unresolved",
                    false,
                );
            }
            self.ctx_mut(c).approximate_length += 3;
            let kind = if t == c.intrinsic_marker_type {
                Kind::IntrinsicKeyword
            } else {
                Kind::AnyKeyword
            };
            return self.f(c).new_keyword_type_node(kind);
        }
        if flags.intersects(TypeFlags::UNKNOWN) {
            return self.f(c).new_keyword_type_node(Kind::UnknownKeyword);
        }
        if flags.intersects(TypeFlags::STRING) {
            self.ctx_mut(c).approximate_length += 6;
            return self.f(c).new_keyword_type_node(Kind::StringKeyword);
        }
        if flags.intersects(TypeFlags::NUMBER) {
            self.ctx_mut(c).approximate_length += 6;
            return self.f(c).new_keyword_type_node(Kind::NumberKeyword);
        }
        if flags.intersects(TypeFlags::BIG_INT) {
            self.ctx_mut(c).approximate_length += 6;
            return self.f(c).new_keyword_type_node(Kind::BigIntKeyword);
        }
        if flags.intersects(TypeFlags::BOOLEAN) && alias.is_nil() {
            self.ctx_mut(c).approximate_length += 7;
            return self.f(c).new_keyword_type_node(Kind::BooleanKeyword);
        }
        let mut expanding_enum = false;
        if flags.intersects(TypeFlags::ENUM_LIKE) {
            if a.sym(t_symbol).flags.intersects(SymbolFlags::ENUM_MEMBER) {
                let parent_symbol = c.get_parent_of_symbol(t_symbol);
                let parent_name =
                    self.symbol_to_type_node(c, parent_symbol, SymbolFlags::TYPE, NodeListId::NIL);
                if c.get_declared_type_of_symbol(parent_symbol) == t {
                    return parent_name;
                }
                let member_name = symbol_name(a, t_symbol);
                if is_identifier_text(&member_name, LanguageVariant::STANDARD) {
                    let member_identifier = self.f(c).new_identifier(&member_name);
                    let member_reference = self
                        .f(c)
                        .new_type_reference_node(member_identifier, NodeListId::NIL);
                    return self.append_reference_to_type(c, parent_name, member_reference);
                }
                if is_import_type_node(a, parent_name) {
                    // Upstream sets `isTypeOf` on the node it just made: here the node is updated, which links the new node to it.
                    let import_type = a.as_import_type_node(parent_name);
                    let type_arguments = a.type_argument_list(parent_name);
                    let type_of_parent = self.f(c).update_import_type_node(
                        parent_name,
                        true,
                        import_type.argument,
                        import_type.attributes,
                        import_type.qualifier,
                        type_arguments,
                    );
                    let literal = self.new_string_literal(c, &member_name);
                    let index_type = self.f(c).new_literal_type_node(literal);
                    return self
                        .f(c)
                        .new_indexed_access_type_node(type_of_parent, index_type);
                } else if is_type_reference_node(a, parent_name) {
                    let type_name = a.as_type_reference_node(parent_name).type_name;
                    let object_type = self.f(c).new_type_query_node(type_name, NodeListId::NIL);
                    let literal = self.new_string_literal(c, &member_name);
                    let index_type = self.f(c).new_literal_type_node(literal);
                    return self
                        .f(c)
                        .new_indexed_access_type_node(object_type, index_type);
                }
                return c.fail("Unhandled type node kind returned from `symbolToTypeNode`.");
            }
            if !flags.intersects(TypeFlags::UNION) || !self.should_expand_type(c, t, false) {
                return self.symbol_to_type_node(c, t_symbol, SymbolFlags::TYPE, NodeListId::NIL);
            }
            expanding_enum = true;
        }
        if flags.intersects(TypeFlags::STRING_LITERAL) {
            let text: Vec<u8> = match c.as_literal_type(t).value {
                LiteralValue::String(v) => v.to_vec(),
                _ => Vec::new(),
            };
            self.ctx_mut(c).approximate_length += text.len() as isize + 2;
            let lit = self.new_string_literal(c, &text);
            c.node_builder
                .impl_
                .e
                .add_emit_flags(lit, EmitFlags::NO_ASCII_ESCAPING);
            return self.f(c).new_literal_type_node(lit);
        }
        if flags.intersects(TypeFlags::NUMBER_LITERAL) {
            let value = match c.as_literal_type(t).value {
                LiteralValue::Number(v) => v,
                _ => 0.0,
            };
            let text = crate::jsnum::Number(value).string();
            self.ctx_mut(c).approximate_length += text.len() as isize;
            if value < 0.0 {
                let operand = self
                    .f(c)
                    .new_numeric_literal(text.get(1..).unwrap_or(&[]), TokenFlags::NONE);
                let negative = self
                    .f(c)
                    .new_prefix_unary_expression(Kind::MinusToken, operand);
                return self.f(c).new_literal_type_node(negative);
            }
            let literal = self.f(c).new_numeric_literal(&text, TokenFlags::NONE);
            return self.f(c).new_literal_type_node(literal);
        }
        if flags.intersects(TypeFlags::BIG_INT_LITERAL) {
            let mut text = pseudo_big_int_to_string(get_big_int_literal_value(c, t));
            self.ctx_mut(c).approximate_length += text.len() as isize + 1;
            text.push(b'n');
            let literal = self.f(c).new_big_int_literal(&text, TokenFlags::NONE);
            return self.f(c).new_literal_type_node(literal);
        }
        if flags.intersects(TypeFlags::BOOLEAN_LITERAL) {
            let value = matches!(c.as_literal_type(t).value, LiteralValue::Boolean(true));
            let keyword = if value {
                self.ctx_mut(c).approximate_length += 4;
                Kind::TrueKeyword
            } else {
                self.ctx_mut(c).approximate_length += 5;
                Kind::FalseKeyword
            };
            let expression = self.f(c).new_keyword_expression(keyword);
            return self.f(c).new_literal_type_node(expression);
        }
        if flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) {
            if !self
                .ctx(c)
                .flags
                .intersects(Flags::ALLOW_UNIQUE_ES_SYMBOL_TYPE)
            {
                let enclosing_declaration = self.ctx(c).enclosing_declaration;
                if c.is_value_symbol_accessible(t_symbol, enclosing_declaration) {
                    self.ctx_mut(c).approximate_length += 6;
                    return self.symbol_to_type_node(
                        c,
                        t_symbol,
                        SymbolFlags::VALUE,
                        NodeListId::NIL,
                    );
                }
                SymbolTrackerImpl::report_inaccessible_unique_symbol_error(self.ctx_mut(c));
            }
            self.ctx_mut(c).approximate_length += 13;
            let symbol_keyword = self.f(c).new_keyword_type_node(Kind::SymbolKeyword);
            return self
                .f(c)
                .new_type_operator_node(Kind::UniqueKeyword, symbol_keyword);
        }
        if flags.intersects(TypeFlags::VOID) {
            self.ctx_mut(c).approximate_length += 4;
            return self.f(c).new_keyword_type_node(Kind::VoidKeyword);
        }
        if flags.intersects(TypeFlags::UNDEFINED) {
            self.ctx_mut(c).approximate_length += 9;
            return self.f(c).new_keyword_type_node(Kind::UndefinedKeyword);
        }
        if flags.intersects(TypeFlags::NULL) {
            self.ctx_mut(c).approximate_length += 4;
            let null = self.f(c).new_keyword_expression(Kind::NullKeyword);
            return self.f(c).new_literal_type_node(null);
        }
        if flags.intersects(TypeFlags::NEVER) {
            self.ctx_mut(c).approximate_length += 5;
            return self.f(c).new_keyword_type_node(Kind::NeverKeyword);
        }
        if flags.intersects(TypeFlags::ES_SYMBOL) {
            self.ctx_mut(c).approximate_length += 6;
            return self.f(c).new_keyword_type_node(Kind::SymbolKeyword);
        }
        if flags.intersects(TypeFlags::NON_PRIMITIVE) {
            self.ctx_mut(c).approximate_length += 6;
            return self.f(c).new_keyword_type_node(Kind::ObjectKeyword);
        }
        if is_this_type_parameter(c, t) {
            let ctx = self.ctx_mut(c);
            if ctx.flags.intersects(Flags::IN_OBJECT_TYPE_LITERAL) {
                if !ctx.encountered_error
                    && !ctx.flags.intersects(Flags::ALLOW_THIS_IN_OBJECT_LITERAL)
                {
                    ctx.encountered_error = true;
                }
                SymbolTrackerImpl::report_inaccessible_this_error(ctx);
            }
            ctx.approximate_length += 4;
            return self.f(c).new_this_type_node();
        }

        if !in_type_alias && !alias.is_nil() {
            let alias_symbol = c.alias_symbol(alias);
            let enclosing_declaration = self.ctx(c).enclosing_declaration;
            if self
                .ctx(c)
                .flags
                .intersects(Flags::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE)
                || c.is_type_symbol_accessible(alias_symbol, enclosing_declaration)
            {
                if !self.should_expand_type(c, t, true) {
                    let alias_type_arguments: Vec<TypeId> =
                        c.alias_type_arguments(alias).as_slice().to_vec();
                    let type_argument_nodes =
                        self.map_to_type_nodes(c, &alias_type_arguments, false);
                    let alias_sym = a.sym(alias_symbol);
                    if is_reserved_member_name(alias_sym.name)
                        && !alias_sym.flags.intersects(SymbolFlags::CLASS)
                    {
                        let empty = self.f(c).new_identifier(b"");
                        return self
                            .f(c)
                            .new_type_reference_node(empty, type_argument_nodes);
                    }
                    if !type_argument_nodes.is_nil() {
                        if let [only] = a.nodes(type_argument_nodes).as_slice() {
                            if alias_symbol == c.types[c.global_array_type].symbol {
                                return self.f(c).new_array_type_node(*only);
                            }
                        }
                    }
                    return self.symbol_to_type_node(
                        c,
                        alias_symbol,
                        SymbolFlags::TYPE,
                        type_argument_nodes,
                    );
                }
                self.ctx_mut(c).depth += 1;
                *alias_depth = true;
            }
        }

        let object_flags = c.types[t].object_flags;

        if object_flags.intersects(ObjectFlags::REFERENCE) {
            c.assert(
                flags.intersects(TypeFlags::OBJECT),
                "t.Flags()&TypeFlagsObject != 0",
            );
            if self.should_expand_type(c, t, false) {
                self.ctx_mut(c).depth += 1;
                let result = self.create_anonymous_type_node_ex(c, t, true, true);
                self.ctx_mut(c).depth -= 1;
                return result;
            }
            if !c.as_type_reference(t).node.is_nil() {
                return self.visit_and_transform_type(
                    c,
                    t,
                    NodeBuilderImpl::type_reference_to_type_node,
                );
            }
            return self.type_reference_to_type_node(c, t);
        }
        if flags.intersects(TypeFlags::TYPE_PARAMETER)
            || object_flags.intersects(ObjectFlags::CLASS_OR_INTERFACE)
        {
            if object_flags.intersects(ObjectFlags::CLASS_OR_INTERFACE)
                && self.should_expand_type(c, t, false)
            {
                self.ctx_mut(c).depth += 1;
                let result = self.create_anonymous_type_node_ex(c, t, true, true);
                self.ctx_mut(c).depth -= 1;
                return result;
            }
            if flags.intersects(TypeFlags::TYPE_PARAMETER)
                && self.ctx(c).infer_type_parameters.iter().any(|p| *p == t)
            {
                self.ctx_mut(c).approximate_length += symbol_name(a, t_symbol).len() as isize + 6;
                let mut constraint_node = NodeId::NIL;
                let constraint = c.get_constraint_of_type_parameter(t);
                if !constraint.is_nil() {
                    // The inferred constraint of an `infer T` is not written back when it matches the real one: it may mention the type being printed.
                    let inferred_constraint = c.get_inferred_type_parameter_constraint(t, true);
                    if !(!inferred_constraint.is_nil()
                        && c.is_type_identical_to(constraint, inferred_constraint))
                    {
                        self.ctx_mut(c).approximate_length += 9;
                        constraint_node = self.type_to_type_node(c, constraint);
                    }
                }
                let declaration =
                    self.type_parameter_to_declaration_with_constraint(c, t, constraint_node);
                return self.f(c).new_infer_type_node(declaration);
            }
            if self
                .ctx(c)
                .flags
                .intersects(Flags::GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS)
                && flags.intersects(TypeFlags::TYPE_PARAMETER)
            {
                let name = self.type_parameter_to_name(c, t);
                let text = a.text(name);
                self.ctx_mut(c).approximate_length += text.len() as isize;
                let identifier = self.new_identifier(c, text, t_symbol);
                return self
                    .f(c)
                    .new_type_reference_node(identifier, NodeListId::NIL);
            }
            // Ignore constraint/default when creating a usage (as opposed to declaration) of a type parameter.
            if !t_symbol.is_nil() {
                return self.symbol_to_type_node(c, t_symbol, SymbolFlags::TYPE, NodeListId::NIL);
            }
            let variance_type_parameter = c.variance_type_parameter;
            let name: Vec<u8> = if (t == c.marker_super_type_for_check
                || t == c.marker_sub_type_for_check)
                && !variance_type_parameter.is_nil()
                && !c.types[variance_type_parameter].symbol.is_nil()
            {
                let prefix: &[u8] = if t == c.marker_sub_type_for_check {
                    b"sub-"
                } else {
                    b"super-"
                };
                let variance_name = symbol_name(a, c.types[variance_type_parameter].symbol);
                [prefix, &variance_name].concat()
            } else {
                b"?".to_vec()
            };
            let identifier = self.new_identifier(c, &name, SymbolId::NIL);
            return self
                .f(c)
                .new_type_reference_node(identifier, NodeListId::NIL);
        }
        if flags.intersects(TypeFlags::UNION) && !c.as_union_type(t).origin.is_nil() {
            t = c.as_union_type(t).origin;
        }
        let flags = c.types[t].flags;
        if flags.intersects(TypeFlags::UNION | TypeFlags::INTERSECTION) {
            let types: Vec<TypeId> = if flags.intersects(TypeFlags::UNION) {
                let union_types: Vec<TypeId> = c.as_union_type(t).types.as_slice().to_vec();
                c.format_union_types(&union_types, expanding_enum)
            } else {
                c.as_intersection_type(t).types.as_slice().to_vec()
            };
            if let [only] = types.as_slice() {
                return self.type_to_type_node(c, *only);
            }
            let type_nodes = self.map_to_type_nodes(c, &types, true);
            if !type_nodes.is_nil() && !a.nodes(type_nodes).as_slice().is_empty() {
                if flags.intersects(TypeFlags::UNION) {
                    return self.f(c).new_union_type_node(type_nodes);
                }
                return self.f(c).new_intersection_type_node(type_nodes);
            }
            let ctx = self.ctx_mut(c);
            if !ctx.encountered_error
                && !ctx
                    .flags
                    .intersects(Flags::ALLOW_EMPTY_UNION_OR_INTERSECTION)
            {
                ctx.encountered_error = true;
            }
            return NodeId::NIL;
        }
        if object_flags.intersects(ObjectFlags::ANONYMOUS | ObjectFlags::MAPPED) {
            c.assert(
                flags.intersects(TypeFlags::OBJECT),
                "t.Flags()&TypeFlagsObject != 0",
            );
            // The type is an object literal type.
            return self.create_anonymous_type_node(c, t);
        }
        if flags.intersects(TypeFlags::INDEX) {
            let indexed_type = c.as_index_type(t).target;
            self.ctx_mut(c).approximate_length += 6;
            let index_type_node = self.type_to_type_node(c, indexed_type);
            return self
                .f(c)
                .new_type_operator_node(Kind::KeyOfKeyword, index_type_node);
        }
        if flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
            let texts: Vec<Vec<u8>> = c
                .as_template_literal_type(t)
                .texts
                .as_slice()
                .iter()
                .map(|text| text.to_vec())
                .collect();
            let types: Vec<TypeId> = c.as_template_literal_type(t).types.as_slice().to_vec();
            let head_text = texts.first().map_or(&[][..], Vec::as_slice);
            let template_head = self
                .f(c)
                .new_template_head(head_text, b"", TokenFlags::NONE);
            c.node_builder
                .impl_
                .e
                .add_emit_flags(template_head, EmitFlags::NO_ASCII_ESCAPING);
            let mut spans: Vec<NodeId> = Vec::with_capacity(types.len());
            for (i, span_type) in types.iter().copied().enumerate() {
                let text = texts.get(i + 1).map_or(&[][..], Vec::as_slice);
                let res = if i < types.len() - 1 {
                    self.f(c).new_template_middle(text, b"", TokenFlags::NONE)
                } else {
                    self.f(c).new_template_tail(text, b"", TokenFlags::NONE)
                };
                c.node_builder
                    .impl_
                    .e
                    .add_emit_flags(res, EmitFlags::NO_ASCII_ESCAPING);
                let span_type_node = self.type_to_type_node(c, span_type);
                spans.push(
                    self.f(c)
                        .new_template_literal_type_span(span_type_node, res),
                );
            }
            let template_spans = self.f(c).new_node_list(&spans);
            self.ctx_mut(c).approximate_length += 2;
            return self
                .f(c)
                .new_template_literal_type_node(template_head, template_spans);
        }
        if flags.intersects(TypeFlags::STRING_MAPPING) {
            let target = c.as_string_mapping_type(t).target;
            let type_node = self.type_to_type_node(c, target);
            let mapping_symbol = c.types[t].symbol;
            let arguments = self.f(c).new_node_list(&[type_node]);
            return self.symbol_to_type_node(c, mapping_symbol, SymbolFlags::TYPE, arguments);
        }
        if flags.intersects(TypeFlags::INDEXED_ACCESS) {
            let object_type = c.as_indexed_access_type(t).object_type;
            let index_type = c.as_indexed_access_type(t).index_type;
            let object_type_node = self.type_to_type_node(c, object_type);
            let index_type_node = self.type_to_type_node(c, index_type);
            self.ctx_mut(c).approximate_length += 2;
            return self
                .f(c)
                .new_indexed_access_type_node(object_type_node, index_type_node);
        }
        if flags.intersects(TypeFlags::CONDITIONAL) {
            return self.visit_and_transform_type(
                c,
                t,
                NodeBuilderImpl::conditional_type_to_type_node,
            );
        }
        if flags.intersects(TypeFlags::SUBSTITUTION) {
            let base_type = c.as_substitution_type(t).base_type;
            let type_node = self.type_to_type_node(c, base_type);
            if !c.is_no_infer_type(t) {
                return type_node;
            }
            let no_infer_symbol = c.get_global_type_alias_symbol(b"NoInfer", 1, false);
            if !no_infer_symbol.is_nil() {
                let arguments = self.f(c).new_node_list(&[type_node]);
                return self.symbol_to_type_node(c, no_infer_symbol, SymbolFlags::TYPE, arguments);
            }
            return type_node;
        }

        c.fail("Should be unreachable.")
    }

    pub(crate) fn new_string_literal(self, c: &mut Checker<'_>, text: &[u8]) -> NodeId {
        self.new_string_literal_ex(c, text, false)
    }

    pub(crate) fn new_string_literal_ex(
        self,
        c: &mut Checker<'_>,
        text: &[u8],
        is_single_quote: bool,
    ) -> NodeId {
        let mut flags = TokenFlags::NONE;
        if is_single_quote
            || self
                .ctx(c)
                .flags
                .intersects(Flags::USE_SINGLE_QUOTES_FOR_STRING_LITERAL_TYPE)
        {
            flags |= TokenFlags::SINGLE_QUOTE;
        }
        self.f(c).new_string_literal(text, flags)
    }

    // `(t *TypeAlias) ToTypeReferenceNode(b)` upstream.
    pub(crate) fn type_alias_to_type_reference_node(
        self,
        c: &mut Checker<'_>,
        alias: TypeAliasId,
    ) -> NodeId {
        let alias_symbol = c.alias_symbol(alias);
        let type_arguments: Vec<TypeId> = c.alias_type_arguments(alias).as_slice().to_vec();
        let name = self.symbol_to_entity_name_node(c, alias_symbol);
        let arguments = self.map_to_type_nodes(c, &type_arguments, false);
        self.f(c).new_type_reference_node(name, arguments)
    }

    pub(crate) fn new_identifier(
        self,
        c: &mut Checker<'_>,
        text: &[u8],
        symbol: SymbolId,
    ) -> NodeId {
        let id = self.f(c).new_identifier(text);
        if !symbol.is_nil() {
            c.node_builder.impl_.id_to_symbol.insert(id, symbol);
        }
        id
    }

    pub(crate) fn create_access_expression(self, c: &mut Checker<'_>, node: NodeId) -> NodeId {
        if !c.stack_check.is_safe_to_recurse() {
            return c.stack_limit();
        }
        let a = c.ast;
        if is_qualified_name(a, node) {
            let qualified = a.as_qualified_name(node);
            let left = self.create_access_expression(c, qualified.left);
            let right = self.f(c).deep_clone_node(qualified.right);
            return self.f(c).new_property_access_expression(
                left,
                NodeId::NIL,
                right,
                NodeFlags::NONE,
            );
        }
        if is_identifier(a, node)
            || is_property_access_expression(a, node)
            || is_expression_with_type_arguments(a, node)
        {
            return self.f(c).deep_clone_node(node);
        }
        c.fail_detail("unexpected access node kind: ", a.kind(node) as u32)
    }

    pub(crate) fn create_expression_with_type_arguments(
        self,
        c: &mut Checker<'_>,
        expr: NodeId,
        type_arguments: NodeListId,
    ) -> NodeId {
        if type_arguments.is_nil() || c.ast.nodes(type_arguments).as_slice().is_empty() {
            return expr;
        }
        self.f(c)
            .new_expression_with_type_arguments(expr, type_arguments)
    }

    pub(crate) fn lookup_instantiated_type_argument_nodes(
        self,
        c: &mut Checker<'_>,
        chain: &[SymbolId],
        index: isize,
    ) -> NodeListId {
        if self.should_write_type_parameters_in_qualified_name(c, chain, index) {
            let a = c.ast;
            let position = usize::try_from(index).unwrap_or(0);
            let (Some(&symbol), Some(&next_symbol)) =
                (chain.get(position), chain.get(position + 1))
            else {
                return NodeListId::NIL;
            };
            if !a
                .sym(next_symbol)
                .check_flags
                .intersects(CheckFlags::INSTANTIATED)
            {
                return NodeListId::NIL;
            }
            let mut target_symbol = symbol;
            if a.sym(symbol).flags.intersects(SymbolFlags::ALIAS)
                && !c.can_get_type_parameters_of_class_or_interface(symbol)
            {
                target_symbol = c.resolve_alias(symbol);
            }
            if !c.can_get_type_parameters_of_class_or_interface(target_symbol) {
                return NodeListId::NIL;
            }
            let mut params = self.get_type_parameters_of_class_or_interface(c, target_symbol);
            let target_mapper = {
                let links = c.value_symbol_links_get(next_symbol);
                c.value_symbol_links[links].mapper
            };
            if !target_mapper.is_nil() {
                for param in &mut params {
                    *param = c.map(target_mapper, *param);
                }
            }
            return self.map_to_type_nodes(c, &params, false);
        }
        NodeListId::NIL
    }

    pub(crate) fn lookup_expression_chain_type_argument_nodes(
        self,
        c: &mut Checker<'_>,
        chain: &[SymbolId],
        index: isize,
    ) -> NodeListId {
        if self.should_write_type_parameters_in_qualified_name(c, chain, index) {
            let Some(&symbol) = usize::try_from(index).ok().and_then(|i| chain.get(i)) else {
                return NodeListId::NIL;
            };
            get_symbol_id(c.ast, symbol);
            if self.ctx(c).type_parameter_symbol_list.has(&symbol) {
                return NodeListId::NIL;
            }
            self.ctx_mut(c).type_parameter_symbol_list.add(symbol);
            let type_argument_nodes = self.lookup_instantiated_type_argument_nodes(c, chain, index);
            if !type_argument_nodes.is_nil() {
                return type_argument_nodes;
            }
            let type_parameter_nodes =
                self.type_parameters_to_type_parameter_declarations(c, symbol);
            if !type_parameter_nodes.is_empty() {
                return self.f(c).new_node_list(&type_parameter_nodes);
            }
        }
        NodeListId::NIL
    }

    pub(crate) fn should_write_type_parameters_in_qualified_name(
        self,
        c: &Checker<'_>,
        chain: &[SymbolId],
        index: isize,
    ) -> bool {
        self.ctx(c)
            .flags
            .intersects(Flags::WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME)
            && index < chain.len() as isize - 1
    }
}
