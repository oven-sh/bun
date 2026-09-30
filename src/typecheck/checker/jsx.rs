// checker/jsx.go (layer X-JSX): JSX elements, fragments, attributes and children, the elaboration of JSX errors, the JSX namespace, its factory entities and the types that the namespace declares.
use crate::ast::{
    Arg, Ast, DiagnosticId, Factory, INTERNAL_SYMBOL_NAME_MISSING, Kind, ModifierListId,
    NodeFactory, NodeFlags, NodeId, Pragma, SymbolFlags, SymbolId, SymbolTableId,
    get_first_identifier, get_node_id, get_pragma_from_source_file, get_semantic_jsx_children,
    get_source_file_of_node, is_identifier, is_in_js_file, is_jsx_attribute, is_jsx_attribute_like,
    is_jsx_element, is_jsx_expression, is_jsx_fragment, is_jsx_namespaced_name,
    is_jsx_opening_element, is_jsx_opening_fragment, is_jsx_opening_like_element,
    is_jsx_self_closing_element, is_jsx_spread_attribute, is_jsx_text, symbol_name,
};
use crate::checker::{
    AccessFlags, CheckMode, Checker, ContextFlags, DiagnosticFactory,
    DiscriminatedContextualTypeKey, InferenceContextId, InferencePriority, IterationTypeKind,
    IterationUse, JsxElementLinks, JsxFlags, ObjectFlags, ObjectLiteralDiscriminator, RelationKind,
    SignatureFlags, SignatureId, SignatureKind, TypeAliasId, TypeFlags, TypeId, TypePredicateId,
    entity_name_to_string, get_string_literal_value, is_hyphenated_jsx_name,
    is_jsx_intrinsic_tag_name, is_type_any, new_type_mapper, some_type,
};
use crate::core::{JsxEmit, LanguageVariant, Link, List, Text, new_text_range};
use crate::diagnostics::{self, MessageId};
use crate::internal::FaultKind;
use crate::jsnum::Number;
use crate::scanner::{get_text_of_node, new_scanner, skip_trivia};
use std::cell::Cell;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct JsxReferenceKind(pub i32);

impl JsxReferenceKind {
    pub const COMPONENT: Self = Self(0);
    pub const FUNCTION: Self = Self(1);
    pub const MIXED: Self = Self(2);
}

pub struct JsxNames;

impl JsxNames {
    pub const JSX: &'static [u8] = b"JSX";
    pub const INTRINSIC_ELEMENTS: &'static [u8] = b"IntrinsicElements";
    pub const ELEMENT_CLASS: &'static [u8] = b"ElementClass";
    pub const ELEMENT_ATTRIBUTES_PROPERTY_NAME_CONTAINER: &'static [u8] =
        b"ElementAttributesProperty";
    pub const ELEMENT_CHILDREN_ATTRIBUTE_NAME_CONTAINER: &'static [u8] =
        b"ElementChildrenAttribute";
    pub const ELEMENT: &'static [u8] = b"Element";
    pub const ELEMENT_TYPE: &'static [u8] = b"ElementType";
    pub const INTRINSIC_ATTRIBUTES: &'static [u8] = b"IntrinsicAttributes";
    pub const INTRINSIC_CLASS_ATTRIBUTES: &'static [u8] = b"IntrinsicClassAttributes";
    pub const LIBRARY_MANAGED_ATTRIBUTES: &'static [u8] = b"LibraryManagedAttributes";
}

pub struct ReactNames;

impl ReactNames {
    pub const FRAGMENT: &'static [u8] = b"Fragment";
}

// `"JSX." + JsxNames.IntrinsicElements`
fn jsx_intrinsic_elements_type_name() -> Vec<u8> {
    let mut name = b"JSX.".to_vec();
    name.extend_from_slice(JsxNames::INTRINSIC_ELEMENTS);
    name
}

impl<'a> Checker<'a> {
    pub fn check_jsx_element(&mut self, node: NodeId, _check_mode: CheckMode) -> TypeId {
        self.check_node_deferred(node);
        self.get_jsx_element_type_at(node)
    }

    pub fn check_jsx_element_deferred(&mut self, node: NodeId) {
        let a = self.ast;
        let jsx_element = a.as_jsx_element(node);
        self.check_jsx_opening_like_element_or_opening_fragment(jsx_element.opening_element);
        // Perform resolution on the closing tag so that rename/go to definition/etc work
        let closing_tag_name = a.tag_name(jsx_element.closing_element);
        if is_jsx_intrinsic_tag_name(a, closing_tag_name) {
            self.get_intrinsic_tag_symbol(jsx_element.closing_element);
        } else {
            self.check_expression(closing_tag_name);
        }
        self.check_jsx_children(node, CheckMode::NORMAL);
    }

    pub fn check_jsx_expression(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        self.check_grammar_jsx_expression(node);
        let expression = a.expression(node);
        if expression.is_nil() {
            return self.error_type;
        }
        let t = self.check_expression_ex(expression, check_mode);
        if !a.as_jsx_expression(node).dot_dot_dot_token.is_nil()
            && t != self.any_type
            && !self.is_array_type(t)
        {
            self.error(
                node,
                diagnostics::JSX_SPREAD_CHILD_MUST_BE_AN_ARRAY_TYPE,
                &[],
            );
        }
        t
    }

    pub fn check_jsx_self_closing_element(
        &mut self,
        node: NodeId,
        _check_mode: CheckMode,
    ) -> TypeId {
        self.check_node_deferred(node);
        self.get_jsx_element_type_at(node)
    }

    pub fn check_jsx_self_closing_element_deferred(&mut self, node: NodeId) {
        self.check_jsx_opening_like_element_or_opening_fragment(node);
    }

    pub fn check_jsx_fragment(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        self.check_jsx_opening_like_element_or_opening_fragment(
            a.as_jsx_fragment(node).opening_fragment,
        );
        // by default, jsx:'react' will use jsxFactory = React.createElement and jsxFragmentFactory = React.Fragment if jsxFactory compiler option is provided, ensure jsxFragmentFactory compiler option or @jsxFrag pragma is provided too
        let node_source_file = get_source_file_of_node(a, node);
        if self.compiler_options.get_jsx_transform_enabled()
            && (!self.compiler_options.jsx_factory.is_empty()
                || get_pragma_from_source_file(a, node_source_file, b"jsx").is_some())
            && self.compiler_options.jsx_fragment_factory.is_empty()
            && get_pragma_from_source_file(a, node_source_file, b"jsxfrag").is_none()
        {
            let message = if !self.compiler_options.jsx_factory.is_empty() {
                diagnostics::THE_JSXFRAGMENTFACTORY_COMPILER_OPTION_MUST_BE_PROVIDED_TO_USE_JSX_FRAGMENTS_WITH_THE_JSXFACTORY_COMPILER_OPTION
            } else {
                diagnostics::AN_JSXFRAG_PRAGMA_IS_REQUIRED_WHEN_USING_AN_JSX_PRAGMA_WITH_JSX_FRAGMENTS
            };
            self.error(node, message, &[]);
        }
        self.check_jsx_children(node, CheckMode::NORMAL);
        let t = self.get_jsx_element_type_at(node);
        if self.is_error_type(t) {
            self.any_type
        } else {
            t
        }
    }

    pub fn check_jsx_attributes(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        self.check_node_deferred(node);
        self.create_jsx_attributes_type_from_attributes_property(self.ast.parent(node), check_mode)
    }

    pub fn check_jsx_opening_like_element_or_opening_fragment(&mut self, node: NodeId) {
        let a = self.ast;
        let is_node_opening_like_element = is_jsx_opening_like_element(a, node);
        if is_node_opening_like_element {
            self.check_grammar_jsx_element(node);
        }
        self.check_jsx_preconditions(node);
        self.mark_jsx_alias_referenced(node);
        let sig = self.get_resolved_signature(node, None, CheckMode::NORMAL);
        self.check_deprecated_signature(sig, node);
        if is_node_opening_like_element {
            let element_type_constraint = self.get_jsx_element_type_type_at(node);
            if !element_type_constraint.is_nil() {
                let tag_name = a.tag_name(node);
                let tag_type = if is_jsx_intrinsic_tag_name(a, tag_name) {
                    self.get_string_literal_type(a.text(tag_name))
                } else {
                    self.check_expression(tag_name)
                };
                let mut diags: Vec<DiagnosticId> = Vec::new();
                if !self.check_type_related_to_ex(
                    tag_type,
                    element_type_constraint,
                    RelationKind::Assignable,
                    tag_name,
                    diagnostics::ITS_TYPE_0_IS_NOT_A_VALID_JSX_ELEMENT_TYPE,
                    Some(&mut diags),
                ) {
                    // Upstream reads diags[0] without a length test: a failed check that left no diagnostic is an internal fault here.
                    match diags.first().copied() {
                        Some(first) => {
                            let tag_name_text = get_text_of_node(a, tag_name);
                            let chain = self.diagnostic_store.new_diagnostic_chain(
                                first,
                                diagnostics::X_0_CANNOT_BE_USED_AS_A_JSX_COMPONENT,
                                &[Arg::Str(&tag_name_text)],
                            );
                            self.add_diagnostic(chain);
                        }
                        None => self.fail("index out of range [0] with length 0"),
                    }
                }
            } else {
                let ref_kind = self.get_jsx_reference_kind(node);
                let return_type = self.get_return_type_of_signature(sig);
                self.check_jsx_return_assignable_to_appropriate_bound(ref_kind, return_type, node);
            }
        }
    }

    pub fn check_jsx_preconditions(&mut self, error_node: NodeId) {
        // Preconditions for using JSX
        if self.compiler_options.jsx == JsxEmit::NONE {
            self.error(
                error_node,
                diagnostics::CANNOT_USE_JSX_UNLESS_THE_JSX_FLAG_IS_PROVIDED,
                &[],
            );
        }
        if self.no_implicit_any && self.get_jsx_element_type_at(error_node).is_nil() {
            self.error(error_node, diagnostics::JSX_ELEMENT_IMPLICITLY_HAS_TYPE_ANY_BECAUSE_THE_GLOBAL_TYPE_JSX_ELEMENT_DOES_NOT_EXIST, &[]);
        }
    }

    pub fn check_jsx_return_assignable_to_appropriate_bound(
        &mut self,
        ref_kind: JsxReferenceKind,
        elem_instance_type: TypeId,
        opening_like_element: NodeId,
    ) {
        let a = self.ast;
        let mut diags: Vec<DiagnosticId> = Vec::new();
        match ref_kind {
            JsxReferenceKind::FUNCTION => {
                let sfc_return_constraint =
                    self.get_jsx_stateless_element_type_at(opening_like_element);
                if !sfc_return_constraint.is_nil() {
                    self.check_type_related_to_ex(
                        elem_instance_type,
                        sfc_return_constraint,
                        RelationKind::Assignable,
                        a.tag_name(opening_like_element),
                        diagnostics::ITS_RETURN_TYPE_0_IS_NOT_A_VALID_JSX_ELEMENT,
                        Some(&mut diags),
                    );
                }
            }
            JsxReferenceKind::COMPONENT => {
                let class_constraint = self.get_jsx_element_class_type_at(opening_like_element);
                if !class_constraint.is_nil() {
                    // Issue an error if this return type isn't assignable to JSX.ElementClass, failing that
                    self.check_type_related_to_ex(
                        elem_instance_type,
                        class_constraint,
                        RelationKind::Assignable,
                        a.tag_name(opening_like_element),
                        diagnostics::ITS_INSTANCE_TYPE_0_IS_NOT_A_VALID_JSX_ELEMENT,
                        Some(&mut diags),
                    );
                }
            }
            _ => {
                let sfc_return_constraint =
                    self.get_jsx_stateless_element_type_at(opening_like_element);
                let class_constraint = self.get_jsx_element_class_type_at(opening_like_element);
                if sfc_return_constraint.is_nil() || class_constraint.is_nil() {
                    return;
                }
                let combined = self
                    .get_union_type(List::from_slice(&[sfc_return_constraint, class_constraint]));
                self.check_type_related_to_ex(
                    elem_instance_type,
                    combined,
                    RelationKind::Assignable,
                    a.tag_name(opening_like_element),
                    diagnostics::ITS_ELEMENT_TYPE_0_IS_NOT_A_VALID_JSX_ELEMENT,
                    Some(&mut diags),
                );
            }
        }
        if let Some(&first) = diags.first() {
            let tag_name_text = get_text_of_node(a, a.tag_name(opening_like_element));
            let chain = self.diagnostic_store.new_diagnostic_chain(
                first,
                diagnostics::X_0_CANNOT_BE_USED_AS_A_JSX_COMPONENT,
                &[Arg::Str(&tag_name_text)],
            );
            self.add_diagnostic(chain);
        }
    }

    pub fn infer_jsx_type_arguments(
        &mut self,
        node: NodeId,
        signature: SignatureId,
        check_mode: CheckMode,
        context: InferenceContextId,
    ) -> List<'a, TypeId> {
        let a = self.ast;
        let param_type = self.get_effective_first_argument_for_jsx_signature(signature, node);
        let check_attr_type = self.check_expression_with_contextual_type(
            a.attributes(node),
            param_type,
            context,
            check_mode,
        );
        let inferences = self.inference_contexts[context].inferences;
        self.infer_types(
            inferences,
            check_attr_type,
            param_type,
            InferencePriority::NONE,
            false,
        );
        self.get_inferred_types(context)
    }

    pub fn get_contextual_type_for_jsx_expression(
        &mut self,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        let parent = a.parent(node);
        if is_jsx_attribute_like(a, parent) {
            return self.get_contextual_type(node, context_flags);
        }
        if is_jsx_element(a, parent) {
            return self.get_contextual_type_for_child_jsx_expression(parent, node, context_flags);
        }
        TypeId::NIL
    }

    pub fn get_contextual_type_for_jsx_attribute(
        &mut self,
        attribute: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        // When we trying to resolve JsxOpeningLikeElement as a stateless function element, we will already give its attributes a contextual type which is a type of the parameter of the signature we are trying out. If there is no contextual type (e.g. we are trying to resolve stateful component), get attributes type from resolving element's tagName
        if is_jsx_attribute(a, attribute) {
            let attributes_type =
                self.get_apparent_type_of_contextual_type(a.parent(attribute), context_flags);
            if attributes_type.is_nil() || is_type_any(self, attributes_type) {
                return TypeId::NIL;
            }
            return self.get_type_of_property_of_contextual_type(
                attributes_type,
                a.text(a.name(attribute)),
            );
        }
        self.get_contextual_type(a.parent(attribute), context_flags)
    }

    pub fn get_contextual_jsx_element_attributes_type(
        &mut self,
        node: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        if is_jsx_opening_element(a, node) && context_flags != ContextFlags::IGNORE_NODE_INFERENCES
        {
            let index =
                self.find_contextual_node(a.parent(node), context_flags == ContextFlags::NONE);
            if index >= 0 {
                // Contextually applied type is moved from attributes up to the outer jsx attributes so when walking up from the children they get hit _However_ to hit them from the _attributes_ we must look for them here; otherwise we'll used the declared type (as below) instead!
                return self
                    .contextual_infos
                    .get(index as usize)
                    .map_or(TypeId::NIL, |info| info.t);
            }
        }
        self.get_contextual_type_for_argument_at_index(node, 0)
    }

    pub fn get_contextual_type_for_child_jsx_expression(
        &mut self,
        node: NodeId,
        child: NodeId,
        context_flags: ContextFlags,
    ) -> TypeId {
        let a = self.ast;
        let attributes_type = self.get_apparent_type_of_contextual_type(
            a.attributes(a.as_jsx_element(node).opening_element),
            context_flags,
        );
        // JSX expression is in children of JSX Element, we will look for an "children" attribute (we get the name from JSX.ElementAttributesProperty)
        let namespace = self.get_jsx_namespace_at(node);
        let jsx_children_property_name = self.get_jsx_element_children_property_name(namespace);
        if !(!attributes_type.is_nil()
            && !is_type_any(self, attributes_type)
            && jsx_children_property_name != INTERNAL_SYMBOL_NAME_MISSING
            && !jsx_children_property_name.is_empty())
        {
            return TypeId::NIL;
        }
        let real_children = get_semantic_jsx_children(a, a.nodes(a.children(node)).as_slice());
        let child_index = real_children
            .iter()
            .position(|&real_child| real_child == child)
            .map_or(-1, |index| index as isize);
        let child_field_type = self
            .get_type_of_property_of_contextual_type(attributes_type, jsx_children_property_name);
        if child_field_type.is_nil() {
            return TypeId::NIL;
        }
        if real_children.len() == 1 {
            return child_field_type;
        }
        self.map_type_ex(
            child_field_type,
            &mut |c, t| {
                if c.is_array_like_type(t) {
                    let index_type = c.get_number_literal_type(Number(child_index as f64));
                    return c.get_indexed_access_type(t, index_type);
                }
                t
            },
            true,
        )
    }

    pub fn discriminate_contextual_type_by_jsx_attributes(
        &mut self,
        node: NodeId,
        contextual_type: TypeId,
    ) -> TypeId {
        let a = self.ast;
        let key = DiscriminatedContextualTypeKey {
            node_id: get_node_id(node),
            type_id: contextual_type,
        };
        let discriminated = self.discriminated_contextual_types.get(&key);
        if !discriminated.is_nil() {
            return discriminated;
        }
        let namespace = self.get_jsx_namespace_at(node);
        let jsx_children_property_name = self.get_jsx_element_children_property_name(namespace);
        let discriminant_properties = self.filter(a.properties(node), |c, p| {
            let symbol = a.symbol(p);
            if symbol.is_nil() || !is_jsx_attribute(a, p) {
                return false;
            }
            let initializer = a.initializer(p);
            (initializer.is_nil() || c.is_possibly_discriminant_value(initializer))
                && c.is_discriminant_property(contextual_type, a.sym(symbol).name)
        });
        let properties = self.get_properties_of_type(contextual_type);
        let discriminant_members = self.filter(properties, |c, s| {
            if !a.sym(s).flags.intersects(SymbolFlags::OPTIONAL) || a.symbol(node).is_nil() {
                return false;
            }
            let element = a.parent(a.parent(node));
            if a.sym(s).name == jsx_children_property_name
                && is_jsx_element(a, element)
                && !get_semantic_jsx_children(a, a.nodes(a.children(element)).as_slice()).is_empty()
            {
                return false;
            }
            a.table_get(a.sym(a.symbol(node)).members, a.sym(s).name)
                .is_nil()
                && c.is_discriminant_property(contextual_type, a.sym(s).name)
        });
        let mut discriminator = ObjectLiteralDiscriminator {
            props: discriminant_properties,
            members: discriminant_members,
        };
        let discriminated =
            self.discriminate_type_by_discriminable_items(contextual_type, &mut discriminator);
        let ok = self.discriminated_contextual_types.set(key, discriminated);
        self.map_set(ok);
        discriminated
    }

    pub fn elaborate_jsx_components(
        &mut self,
        node: NodeId,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        let a = self.ast;
        let mut reported_error = false;
        for &prop in a.properties(node).as_slice() {
            if !is_jsx_spread_attribute(a, prop) && !is_hyphenated_jsx_name(a.text(a.name(prop))) {
                let name_type = self.get_string_literal_type(a.text(a.name(prop)));
                if !name_type.is_nil() && !self.types[name_type].flags.intersects(TypeFlags::NEVER)
                {
                    reported_error = self.elaborate_element(
                        source,
                        target,
                        relation,
                        a.name(prop),
                        a.initializer(prop),
                        name_type,
                        MessageId::NIL,
                        None,
                        diagnostic_output.as_deref_mut(),
                    ) || reported_error;
                }
            }
        }
        if is_jsx_opening_element(a, a.parent(node)) && is_jsx_element(a, a.parent(a.parent(node)))
        {
            let containing_element = a.parent(a.parent(node)); // Containing JSXElement
            let namespace = self.get_jsx_namespace_at(node);
            let mut children_prop_name = self.get_jsx_element_children_property_name(namespace);
            if children_prop_name == INTERNAL_SYMBOL_NAME_MISSING {
                children_prop_name = b"children";
            }
            let children_name_type = self.get_string_literal_type(children_prop_name);
            let children_target_type = self.get_indexed_access_type(target, children_name_type);
            let valid_children =
                get_semantic_jsx_children(a, a.nodes(a.children(containing_element)).as_slice());
            if valid_children.is_empty() {
                return reported_error;
            }
            let more_than_one_real_children = valid_children.len() > 1;
            let array_like_target_parts;
            let non_array_like_target_parts;
            let iterable_type = self.get_global_iterable_type();
            if iterable_type != self.empty_generic_type {
                let any_iterable = self.create_iterable_type(self.any_type);
                array_like_target_parts = self.filter_type(children_target_type, &mut |c, t| {
                    c.is_type_assignable_to(t, any_iterable)
                });
                non_array_like_target_parts = self
                    .filter_type(children_target_type, &mut |c, t| {
                        !c.is_type_assignable_to(t, any_iterable)
                    });
            } else {
                array_like_target_parts = self.filter_type(children_target_type, &mut |c, t| {
                    c.is_array_or_tuple_like_type(t)
                });
                non_array_like_target_parts = self
                    .filter_type(children_target_type, &mut |c, t| {
                        !c.is_array_or_tuple_like_type(t)
                    });
            }
            let mut invalid_text_diagnostic = JsxInvalidTextDiagnostic {
                node,
                children_prop_name,
                children_target_type,
                invalid_text_diagnostic: MessageId::NIL,
                tag_name_text: Vec::new(),
                children_target_type_text: Vec::new(),
            };
            if more_than_one_real_children {
                if array_like_target_parts != self.never_type {
                    let child_types =
                        self.check_jsx_children(containing_element, CheckMode::NORMAL);
                    let child_types = self.list_of(&child_types);
                    let real_source = self.create_tuple_type(child_types);
                    let mut children = self
                        .generate_jsx_children(containing_element, &mut invalid_text_diagnostic);
                    reported_error = self.elaborate_iterable_or_array_like_target_elementwise(
                        &mut children,
                        real_source,
                        array_like_target_parts,
                        relation,
                        diagnostic_output.as_deref_mut(),
                    ) || reported_error;
                } else {
                    let source_children_type =
                        self.get_indexed_access_type(source, children_name_type);
                    if !self.is_type_related_to(
                        source_children_type,
                        children_target_type,
                        relation,
                    ) {
                        // arity mismatch
                        let children_target_type_text =
                            self.type_to_string_exported(children_target_type);
                        let diag = self.error(
                            a.tag_name(a.as_jsx_element(containing_element).opening_element),
                            diagnostics::THIS_JSX_TAG_S_0_PROP_EXPECTS_A_SINGLE_CHILD_OF_TYPE_1_BUT_MULTIPLE_CHILDREN_WERE_PROVIDED,
                            &[
                                Arg::Str(children_prop_name),
                                Arg::Str(&children_target_type_text),
                            ],
                        );
                        self.report_diagnostic(diag, diagnostic_output.as_deref_mut());
                        reported_error = true;
                    }
                }
            } else {
                if non_array_like_target_parts != self.never_type {
                    let child = valid_children.first().copied().unwrap_or(NodeId::NIL);
                    let e = self.get_elaboration_element_for_jsx_child(child, children_name_type);
                    if !e.error_node.is_nil() {
                        let mut create_diagnostic = |c: &mut Checker<'a>, prop: NodeId| {
                            invalid_text_diagnostic.create_diagnostic(c, prop)
                        };
                        let diagnostic_factory: Option<DiagnosticFactory<'_, 'a>> =
                            if e.create_diagnostic {
                                Some(&mut create_diagnostic)
                            } else {
                                None
                            };
                        reported_error = self.elaborate_element(
                            source,
                            target,
                            relation,
                            e.error_node,
                            e.inner_expression,
                            e.name_type,
                            MessageId::NIL,
                            diagnostic_factory,
                            diagnostic_output.as_deref_mut(),
                        ) || reported_error;
                    }
                } else {
                    let source_children_type =
                        self.get_indexed_access_type(source, children_name_type);
                    if !self.is_type_related_to(
                        source_children_type,
                        children_target_type,
                        relation,
                    ) {
                        // arity mismatch
                        let children_target_type_text =
                            self.type_to_string_exported(children_target_type);
                        let diag = self.error(
                            a.tag_name(a.as_jsx_element(containing_element).opening_element),
                            diagnostics::THIS_JSX_TAG_S_0_PROP_EXPECTS_TYPE_1_WHICH_REQUIRES_MULTIPLE_CHILDREN_BUT_ONLY_A_SINGLE_CHILD_WAS_PROVIDED,
                            &[
                                Arg::Str(children_prop_name),
                                Arg::Str(&children_target_type_text),
                            ],
                        );
                        self.report_diagnostic(diag, diagnostic_output.as_deref_mut());
                        reported_error = true;
                    }
                }
            }
        }
        reported_error
    }
}

// The variables of getInvalidTextualChildDiagnostic in elaborateJsxComponents: the message and its arguments are made for the first text child that reports, and kept.
pub struct JsxInvalidTextDiagnostic<'a> {
    node: NodeId,
    children_prop_name: Text<'a>,
    children_target_type: TypeId,
    invalid_text_diagnostic: MessageId,
    tag_name_text: Vec<u8>,
    children_target_type_text: Vec<u8>,
}

impl<'a> JsxInvalidTextDiagnostic<'a> {
    // The createDiagnostic closure of getElaborationElementForJsxChild: `NewDiagnosticForNode(prop, getInvalidTextDiagnostic()...)`.
    pub fn create_diagnostic(&mut self, c: &mut Checker<'a>, prop: NodeId) -> DiagnosticId {
        if self.invalid_text_diagnostic.is_nil() {
            let a = c.ast;
            self.tag_name_text = get_text_of_node(a, a.tag_name(a.parent(self.node)));
            self.invalid_text_diagnostic = diagnostics::X_0_COMPONENTS_DON_T_ACCEPT_TEXT_AS_CHILD_ELEMENTS_TEXT_IN_JSX_HAS_THE_TYPE_STRING_BUT_THE_EXPECTED_TYPE_OF_1_IS_2;
            self.children_target_type_text = c.type_to_string_exported(self.children_target_type);
        }
        c.new_diagnostic_for_node(
            prop,
            self.invalid_text_diagnostic,
            &[
                Arg::Str(&self.tag_name_text),
                Arg::Str(self.children_prop_name),
                Arg::Str(&self.children_target_type_text),
            ],
        )
    }
}

// createDiagnostic holds one closure upstream, the one that getElaborationElementForJsxChild makes for a text child: the field says whether the element has it, and JsxInvalidTextDiagnostic::create_diagnostic is its body.
#[derive(Clone, Copy, Default)]
pub struct JsxElaborationElement {
    pub error_node: NodeId,
    pub inner_expression: NodeId,
    pub name_type: TypeId,
    pub create_diagnostic: bool,
}

// The iterator of generateJsxChildren as its state: `next` runs the loop up to the next yield, so the literal type of each child is made when the consumer asks for it.
pub struct JsxChildrenIterator<'g, 'a> {
    node: NodeId,
    index: usize,
    member_offset: isize,
    get_invalid_text_diagnostic: &'g mut JsxInvalidTextDiagnostic<'a>,
}

impl<'a> JsxChildrenIterator<'_, 'a> {
    pub fn next(&mut self, c: &mut Checker<'a>) -> Option<JsxElaborationElement> {
        let a = c.ast;
        let children = a.nodes(a.children(self.node));
        while let Some(&child) = children.as_slice().get(self.index) {
            let i = self.index as isize;
            self.index += 1;
            let name_type = c.get_number_literal_type(Number((i - self.member_offset) as f64));
            let e = c.get_elaboration_element_for_jsx_child(child, name_type);
            if !e.error_node.is_nil() {
                return Some(e);
            }
            self.member_offset += 1;
        }
        None
    }
}

impl<'a> Checker<'a> {
    pub fn generate_jsx_children<'g>(
        &self,
        node: NodeId,
        get_invalid_text_diagnostic: &'g mut JsxInvalidTextDiagnostic<'a>,
    ) -> JsxChildrenIterator<'g, 'a> {
        JsxChildrenIterator {
            node,
            index: 0,
            member_offset: 0,
            get_invalid_text_diagnostic,
        }
    }

    pub fn get_elaboration_element_for_jsx_child(
        &self,
        child: NodeId,
        name_type: TypeId,
    ) -> JsxElaborationElement {
        let a = self.ast;
        match a.kind(child) {
            Kind::JsxExpression => {
                // child is of the type of the expression
                JsxElaborationElement {
                    error_node: child,
                    inner_expression: a.expression(child),
                    name_type,
                    create_diagnostic: false,
                }
            }
            Kind::JsxText => {
                if a.as_jsx_text(child).contains_only_trivia_white_spaces {
                    // Whitespace only jsx text isn't real jsx text
                    return JsxElaborationElement::default();
                }
                // child is a string
                JsxElaborationElement {
                    error_node: child,
                    inner_expression: NodeId::NIL,
                    name_type,
                    create_diagnostic: true,
                }
            }
            Kind::JsxElement | Kind::JsxSelfClosingElement | Kind::JsxFragment => {
                // child is of type JSX.Element
                JsxElaborationElement {
                    error_node: child,
                    inner_expression: child,
                    name_type,
                    create_diagnostic: false,
                }
            }
            _ => {
                let _: () = self.fail("Unhandled case in getElaborationElementForJsxChild");
                JsxElaborationElement::default()
            }
        }
    }

    pub fn elaborate_iterable_or_array_like_target_elementwise(
        &mut self,
        iterator: &mut JsxChildrenIterator<'_, 'a>,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        let a = self.ast;
        let tuple_or_array_like_target_parts =
            self.filter_type(target, &mut |c, t| c.is_array_or_tuple_like_type(t));
        let non_tuple_or_array_like_target_parts =
            self.filter_type(target, &mut |c, t| !c.is_array_or_tuple_like_type(t));
        // If `nonTupleOrArrayLikeTargetParts` is not `never`, then that should mean `Iterable` is defined.
        let mut iteration_type = TypeId::NIL;
        if non_tuple_or_array_like_target_parts != self.never_type {
            iteration_type = self.get_iteration_type_of_iterable(
                IterationUse::FOR_OF,
                IterationTypeKind::YIELD,
                non_tuple_or_array_like_target_parts,
                NodeId::NIL,
            );
        }
        let mut reported_error = false;
        while let Some(e) = iterator.next(self) {
            let prop = e.error_node;
            let next = e.inner_expression;
            let name_type = e.name_type;
            let mut target_prop_type = iteration_type;
            let mut target_indexed_prop_type = TypeId::NIL;
            if tuple_or_array_like_target_parts != self.never_type {
                target_indexed_prop_type = self.get_best_match_indexed_access_type_or_undefined(
                    source,
                    tuple_or_array_like_target_parts,
                    name_type,
                );
            }
            if !target_indexed_prop_type.is_nil()
                && !self.types[target_indexed_prop_type]
                    .flags
                    .intersects(TypeFlags::INDEXED_ACCESS)
            {
                if !iteration_type.is_nil() {
                    target_prop_type = self.get_union_type(List::from_slice(&[
                        iteration_type,
                        target_indexed_prop_type,
                    ]));
                } else {
                    target_prop_type = target_indexed_prop_type;
                }
            }
            if target_prop_type.is_nil() {
                continue;
            }
            let mut source_prop_type = self.get_indexed_access_type_or_undefined(
                source,
                name_type,
                AccessFlags::NONE,
                NodeId::NIL,
                TypeAliasId::NIL,
            );
            if source_prop_type.is_nil() {
                continue;
            }
            let prop_name = self.get_property_name_from_index(name_type, NodeId::NIL);
            if !self.check_type_related_to(
                source_prop_type,
                target_prop_type,
                relation,
                NodeId::NIL,
            ) {
                let elaborated = !next.is_nil()
                    && self.elaborate_error(
                        next,
                        source_prop_type,
                        target_prop_type,
                        relation,
                        MessageId::NIL,
                        diagnostic_output.as_deref_mut(),
                    );
                reported_error = true;
                if !elaborated {
                    // Issue error on the prop itself, since the prop couldn't elaborate the error. Use the expression type, if available.
                    let mut specific_source = source_prop_type;
                    if !next.is_nil() {
                        specific_source = self
                            .check_expression_for_mutable_location_with_contextual_type(
                                next,
                                source_prop_type,
                            );
                    }
                    if e.create_diagnostic {
                        // Use the custom diagnostic factory if provided (e.g., for JSX text children with dynamic error messages)
                        let diagnostic = iterator
                            .get_invalid_text_diagnostic
                            .create_diagnostic(self, prop);
                        self.report_diagnostic(diagnostic, diagnostic_output.as_deref_mut());
                    } else if self.exact_optional_property_types
                        && self
                            .is_exact_optional_property_mismatch(specific_source, target_prop_type)
                    {
                        let source_text = self.type_to_string_exported(specific_source);
                        let target_text = self.type_to_string_exported(target_prop_type);
                        let diag = self.create_diagnostic_for_node(
                            prop,
                            diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1_WITH_EXACTOPTIONALPROPERTYTYPES_COLON_TRUE_CONSIDER_ADDING_UNDEFINED_TO_THE_TYPE_OF_THE_TARGET,
                            &[Arg::Str(&source_text), Arg::Str(&target_text)],
                        );
                        self.report_diagnostic(diag, diagnostic_output.as_deref_mut());
                    } else {
                        let mut target_is_optional = false;
                        if &prop_name[..] != INTERNAL_SYMBOL_NAME_MISSING {
                            let mut target_symbol = self
                                .get_property_of_type(tuple_or_array_like_target_parts, &prop_name);
                            if target_symbol.is_nil() {
                                target_symbol = self.unknown_symbol;
                            }
                            target_is_optional =
                                a.sym(target_symbol).flags.intersects(SymbolFlags::OPTIONAL);
                        }
                        let mut source_is_optional = false;
                        if &prop_name[..] != INTERNAL_SYMBOL_NAME_MISSING {
                            let mut source_symbol = self.get_property_of_type(source, &prop_name);
                            if source_symbol.is_nil() {
                                source_symbol = self.unknown_symbol;
                            }
                            source_is_optional =
                                a.sym(source_symbol).flags.intersects(SymbolFlags::OPTIONAL);
                        }
                        target_prop_type =
                            self.remove_missing_type(target_prop_type, target_is_optional);
                        source_prop_type = self.remove_missing_type(
                            source_prop_type,
                            target_is_optional && source_is_optional,
                        );
                        let result = self.check_type_related_to_ex(
                            specific_source,
                            target_prop_type,
                            relation,
                            prop,
                            MessageId::NIL,
                            diagnostic_output.as_deref_mut(),
                        );
                        if result && specific_source != source_prop_type {
                            // If for whatever reason the expression type doesn't yield an error, make sure we still issue an error on the sourcePropType
                            self.check_type_related_to_ex(
                                source_prop_type,
                                target_prop_type,
                                relation,
                                prop,
                                MessageId::NIL,
                                diagnostic_output.as_deref_mut(),
                            );
                        }
                    }
                }
            }
        }
        reported_error
    }

    pub fn get_suggested_symbol_for_nonexistent_jsx_attribute(
        &mut self,
        name: &[u8],
        containing_type: TypeId,
    ) -> SymbolId {
        let a = self.ast;
        let properties = self.get_properties_of_type(containing_type);
        let mut jsx_specific = SymbolId::NIL;
        if name == b"for" {
            jsx_specific = properties
                .as_slice()
                .iter()
                .copied()
                .find(|&x| symbol_name(a, x) == b"htmlFor")
                .unwrap_or(SymbolId::NIL);
        } else if name == b"class" {
            jsx_specific = properties
                .as_slice()
                .iter()
                .copied()
                .find(|&x| symbol_name(a, x) == b"className")
                .unwrap_or(SymbolId::NIL);
        }
        if !jsx_specific.is_nil() {
            return jsx_specific;
        }
        self.get_spelling_suggestion_for_name(name, properties.as_slice(), SymbolFlags::VALUE)
    }

    pub fn get_jsx_fragment_type(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        // An opening fragment is required in order for `getJsxNamespace` to give the fragment factory
        let links = self.source_file_links.get(get_source_file_of_node(a, node));
        if !self.source_file_links[links].jsx_fragment_type.is_nil() {
            return self.source_file_links[links].jsx_fragment_type;
        }
        let jsx_fragment_factory_name = self.get_jsx_namespace(node);
        // #38720/60122, allow null as jsxFragmentFactory
        let should_resolve_factory_reference = (self.compiler_options.jsx == JsxEmit::REACT
            || !self.compiler_options.jsx_fragment_factory.is_empty())
            && jsx_fragment_factory_name != b"null";
        if !should_resolve_factory_reference {
            self.source_file_links[links].jsx_fragment_type = self.any_type;
            return self.source_file_links[links].jsx_fragment_type;
        }
        let mut jsx_factory_symbol = self.get_jsx_namespace_container_for_implicit_import(node);
        if jsx_factory_symbol.is_nil() {
            let should_module_ref_err = self.compiler_options.jsx != JsxEmit::PRESERVE
                && self.compiler_options.jsx != JsxEmit::REACT_NATIVE;
            let mut flags = SymbolFlags::VALUE;
            if !should_module_ref_err {
                flags = flags.without(SymbolFlags::ENUM);
            }
            jsx_factory_symbol = self.resolve_name(
                node,
                jsx_fragment_factory_name,
                flags,
                diagnostics::USING_JSX_FRAGMENTS_REQUIRES_FRAGMENT_FACTORY_0_TO_BE_IN_SCOPE_BUT_IT_COULD_NOT_BE_FOUND,
                true,
                false,
            );
        }
        if jsx_factory_symbol.is_nil() {
            self.source_file_links[links].jsx_fragment_type = self.error_type;
            return self.source_file_links[links].jsx_fragment_type;
        }
        if a.sym(jsx_factory_symbol).name == ReactNames::FRAGMENT {
            let fragment_type = self.get_type_of_symbol(jsx_factory_symbol);
            self.source_file_links[links].jsx_fragment_type = fragment_type;
            return fragment_type;
        }
        let mut resolved_alias = jsx_factory_symbol;
        if a.sym(jsx_factory_symbol)
            .flags
            .intersects(SymbolFlags::ALIAS)
        {
            resolved_alias = self.resolve_alias(jsx_factory_symbol);
        }

        let react_exports = self.get_exports_of_symbol(resolved_alias);
        let type_symbol = self.get_symbol(
            react_exports,
            ReactNames::FRAGMENT,
            SymbolFlags::BLOCK_SCOPED_VARIABLE,
        );
        if !type_symbol.is_nil() {
            let fragment_type = self.get_type_of_symbol(type_symbol);
            self.source_file_links[links].jsx_fragment_type = fragment_type;
        } else {
            self.source_file_links[links].jsx_fragment_type = self.error_type;
        }
        self.source_file_links[links].jsx_fragment_type
    }

    pub fn resolve_jsx_opening_like_element(
        &mut self,
        node: NodeId,
        candidates_out_array: Option<&mut Vec<SignatureId>>,
        check_mode: CheckMode,
    ) -> SignatureId {
        let a = self.ast;
        let is_jsx_open_fragment = is_jsx_opening_fragment(a, node);
        let expr_types;
        if !is_jsx_open_fragment {
            if is_jsx_intrinsic_tag_name(a, a.tag_name(node)) {
                let result = self.get_intrinsic_attributes_type_from_jsx_opening_like_element(node);
                let fake_signature = self.create_signature_for_jsx_intrinsic(node, result);
                let param_type =
                    self.get_effective_first_argument_for_jsx_signature(fake_signature, node);
                let attributes_type = self.check_expression_with_contextual_type(
                    a.attributes(node),
                    param_type,
                    InferenceContextId::NIL,
                    CheckMode::NORMAL,
                );
                self.check_type_assignable_to_and_optionally_elaborate(
                    attributes_type,
                    result,
                    a.tag_name(node),
                    a.attributes(node),
                    MessageId::NIL,
                    None,
                );
                let type_arguments = a.type_arguments(node);
                if type_arguments.len() != 0 {
                    self.check_source_elements(type_arguments);
                    let source_file = get_source_file_of_node(a, node);
                    let type_argument_list = a.type_argument_list(node);
                    let list_loc = a.list_loc(type_argument_list);
                    let loc = new_text_range(
                        skip_trivia(a.as_source_file(source_file).text(), list_loc.pos()),
                        list_loc.end(),
                    );
                    let diagnostic = self.diagnostic_store.new_diagnostic(
                        source_file,
                        loc,
                        diagnostics::EXPECTED_0_TYPE_ARGUMENTS_BUT_GOT_1,
                        &[Arg::Int(0), Arg::Int(type_arguments.len() as i64)],
                    );
                    self.add_diagnostic(diagnostic);
                }
                return fake_signature;
            }
            expr_types = self.check_expression(a.tag_name(node));
        } else {
            expr_types = self.get_jsx_fragment_type(node);
        }
        let apparent_type = self.get_apparent_type(expr_types);
        if self.is_error_type(apparent_type) {
            return self.resolve_error_call(node);
        }
        let signatures = self.get_uninstantiated_jsx_signatures_of_type(expr_types, node);
        if self.is_untyped_function_call(expr_types, apparent_type, signatures.len(), 0) {
            return self.resolve_untyped_call(node);
        }
        if signatures.len() == 0 {
            // We found no signatures at all, which is an error
            if is_jsx_open_fragment {
                let node_text = get_text_of_node(a, node);
                self.error(
                    node,
                    diagnostics::JSX_ELEMENT_TYPE_0_DOES_NOT_HAVE_ANY_CONSTRUCT_OR_CALL_SIGNATURES,
                    &[Arg::Str(&node_text)],
                );
            } else {
                let tag_name_text = get_text_of_node(a, a.tag_name(node));
                self.error(
                    a.tag_name(node),
                    diagnostics::JSX_ELEMENT_TYPE_0_DOES_NOT_HAVE_ANY_CONSTRUCT_OR_CALL_SIGNATURES,
                    &[Arg::Str(&tag_name_text)],
                );
            }
            return self.resolve_error_call(node);
        }
        self.resolve_call(
            node,
            signatures,
            candidates_out_array,
            check_mode,
            SignatureFlags::NONE,
            MessageId::NIL,
        )
    }

    // Check if the given signature can possibly be a signature called by the JSX opening-like element. @param node a JSX opening-like element we are trying to figure its call signature @param signature a candidate signature we are trying whether it is a call signature @param relation a relationship to check parameter and argument type
    pub fn check_applicable_signature_for_jsx_call_like_element(
        &mut self,
        node: NodeId,
        signature: SignatureId,
        relation: RelationKind,
        check_mode: CheckMode,
        report_errors: bool,
        mut diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        // Upstream writes this as a closure over the node, reportErrors and diagnosticOutput.
        fn check_tag_name_does_not_expect_too_many_arguments(
            c: &mut Checker<'_>,
            node: NodeId,
            report_errors: bool,
            diagnostic_output: Option<&mut Vec<DiagnosticId>>,
        ) -> bool {
            let a = c.ast;
            if !c
                .get_jsx_namespace_container_for_implicit_import(node)
                .is_nil()
            {
                return true; // factory is implicitly jsx/jsxdev - assume it fits the bill, since we don't strongly look for the jsx/jsxs/jsxDEV factory APIs anywhere else (at least not yet)
            }
            // We assume fragments have the correct arity since the node does not have attributes
            let mut tag_type = TypeId::NIL;
            if (is_jsx_opening_element(a, node) || is_jsx_self_closing_element(a, node))
                && !(is_jsx_intrinsic_tag_name(a, a.tag_name(node))
                    || is_jsx_namespaced_name(a, a.tag_name(node)))
            {
                tag_type = c.check_expression(a.tag_name(node));
            }
            if tag_type.is_nil() {
                return true;
            }
            let tag_call_signatures = c.get_signatures_of_type(tag_type, SignatureKind::CALL);
            if tag_call_signatures.len() == 0 {
                return true;
            }
            let factory = c.get_jsx_factory_entity(node);
            if factory.is_nil() {
                return true;
            }
            let factory_symbol =
                c.resolve_entity_name(factory, SymbolFlags::VALUE, true, false, node);
            if factory_symbol.is_nil() {
                return true;
            }

            let factory_type = c.get_type_of_symbol(factory_symbol);
            let call_signatures = c.get_signatures_of_type(factory_type, SignatureKind::CALL);
            if call_signatures.len() == 0 {
                return true;
            }
            let mut has_first_param_signatures = false;
            let mut max_param_count: isize = 0;
            // Check that _some_ first parameter expects a FC-like thing, and that some overload of the SFC expects an acceptable number of arguments
            for &sig in call_signatures.as_slice() {
                let firstparam = c.get_type_at_position(sig, 0);
                let signatures_of_param = c.get_signatures_of_type(firstparam, SignatureKind::CALL);
                if signatures_of_param.len() == 0 {
                    continue;
                }
                for &param_sig in signatures_of_param.as_slice() {
                    has_first_param_signatures = true;
                    if c.has_effective_rest_parameter(param_sig) {
                        return true; // some signature has a rest param, so function components can have an arbitrary number of arguments
                    }
                    let param_count = c.get_parameter_count(param_sig);
                    if param_count > max_param_count {
                        max_param_count = param_count;
                    }
                }
            }
            if !has_first_param_signatures {
                // Not a single signature had a first parameter which expected a signature - for back compat, and to guard against generic factories which won't have signatures directly, do not error
                return true;
            }
            let mut absolute_min_arg_count = isize::MAX;
            for &tag_sig in tag_call_signatures.as_slice() {
                let tag_required_arg_count = c.get_min_argument_count(tag_sig);
                if tag_required_arg_count < absolute_min_arg_count {
                    absolute_min_arg_count = tag_required_arg_count;
                }
            }
            if absolute_min_arg_count <= max_param_count {
                return true; // some signature accepts the number of arguments the function component provides
            }
            if report_errors {
                let tag_name = a.tag_name(node);
                // We will not report errors in this function for fragments, since we do not check them in this function
                let tag_name_text = entity_name_to_string(a, tag_name);
                let factory_text = entity_name_to_string(a, factory);
                let diag = c.new_diagnostic_for_node(
                    tag_name,
                    diagnostics::TAG_0_EXPECTS_AT_LEAST_1_ARGUMENTS_BUT_THE_JSX_FACTORY_2_PROVIDES_AT_MOST_3,
                    &[
                        Arg::Str(&tag_name_text),
                        Arg::Int(absolute_min_arg_count as i64),
                        Arg::Str(&factory_text),
                        Arg::Int(max_param_count as i64),
                    ],
                );
                let tag_name_symbol = c.get_symbol_at_location(tag_name, false);
                if !tag_name_symbol.is_nil() && !a.sym(tag_name_symbol).value_declaration.is_nil() {
                    let declared_name_text = entity_name_to_string(a, tag_name);
                    let related = c.new_diagnostic_for_node(
                        a.sym(tag_name_symbol).value_declaration,
                        diagnostics::X_0_IS_DECLARED_HERE,
                        &[Arg::Str(&declared_name_text)],
                    );
                    c.diagnostic_store.add_related_info(diag, related);
                }
                c.report_diagnostic(diag, diagnostic_output);
            }
            false
        }
        let a = self.ast;
        // Stateless function components can have maximum of three arguments: "props", "context", and "updater". However "context" and "updater" are implicit and can't be specify by users. Only the first parameter, props, can be specified by users through attributes property.
        let param_type = self.get_effective_first_argument_for_jsx_signature(signature, node);
        let attributes_type = if is_jsx_opening_fragment(a, node) {
            self.create_jsx_attributes_type_from_attributes_property(node, CheckMode::NORMAL)
        } else {
            self.check_expression_with_contextual_type(
                a.attributes(node),
                param_type,
                InferenceContextId::NIL,
                check_mode,
            )
        };
        let check_attributes_type = if check_mode.intersects(CheckMode::SKIP_CONTEXT_SENSITIVE) {
            self.get_regular_type_of_object_literal(attributes_type)
        } else {
            attributes_type
        };
        if !check_tag_name_does_not_expect_too_many_arguments(
            self,
            node,
            report_errors,
            diagnostic_output.as_deref_mut(),
        ) {
            return false;
        }
        let mut error_node = NodeId::NIL;
        if report_errors {
            if is_jsx_opening_fragment(a, node) {
                error_node = node;
            } else {
                error_node = a.tag_name(node);
            }
        }
        let mut attributes = NodeId::NIL;
        if !is_jsx_opening_fragment(a, node) {
            attributes = a.attributes(node);
        }
        self.check_type_related_to_and_optionally_elaborate(
            check_attributes_type,
            param_type,
            relation,
            error_node,
            attributes,
            MessageId::NIL,
            diagnostic_output,
        )
    }

    // Get attributes type of the JSX opening-like element. The result is from resolving "attributes" property of the opening-like element. @param openingLikeElement a JSX opening-like element @param filter a function to remove attributes that will not participate in checking whether attributes are assignable @return an anonymous type (similar to the one returned by checkObjectLiteral) in which its properties are attributes property. @remarks Because this function calls getSpreadType, it needs to use the same checks as checkObjectLiteral, which also calls getSpreadType.
    pub fn create_jsx_attributes_type_from_attributes_property(
        &mut self,
        opening_like_element: NodeId,
        check_mode: CheckMode,
    ) -> TypeId {
        // Upstream writes this as a closure over the attributes symbol, the attributes table and the object flags, which it changes.
        fn create_jsx_attributes_type(
            c: &mut Checker<'_>,
            attributes_symbol: SymbolId,
            attributes_table: SymbolTableId,
            object_flags: &mut ObjectFlags,
        ) -> TypeId {
            *object_flags |= ObjectFlags::FRESH_LITERAL;
            let result = c.new_anonymous_type(
                attributes_symbol,
                attributes_table,
                List::NIL,
                List::NIL,
                List::NIL,
            );
            c.types[result].object_flags |= *object_flags
                | ObjectFlags::OBJECT_LITERAL
                | ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL;
            result
        }
        // Upstream writes this as a closure without captures.
        fn parent_has_semantic_jsx_children(a: Ast<'_>, opening_like_element: NodeId) -> bool {
            // Handle children attribute
            let parent = a.parent(opening_like_element);
            if parent.is_nil() {
                return false;
            }
            let mut children: &[NodeId] = &[];

            if is_jsx_element(a, parent) {
                // We have to check that openingElement of the parent is the one we are visiting as this may not be true for selfClosingElement
                if a.as_jsx_element(parent).opening_element == opening_like_element {
                    children = a.nodes(a.children(parent)).as_slice();
                }
            } else if is_jsx_fragment(a, parent) {
                if a.as_jsx_fragment(parent).opening_fragment == opening_like_element {
                    children = a.nodes(a.children(parent)).as_slice();
                }
            }
            !get_semantic_jsx_children(a, children).is_empty()
        }
        let a = self.ast;
        let mut all_attributes_table = SymbolTableId::NIL;
        if self.strict_null_checks {
            all_attributes_table = a.new_table();
        }
        let mut attributes_table = a.new_table();
        let mut attributes_symbol = SymbolId::NIL;
        let mut attribute_parent = opening_like_element;
        let mut spread = self.empty_jsx_object_type;
        let mut has_spread_any_type = false;
        let mut type_to_intersect = TypeId::NIL;
        let mut explicitly_specify_children_attribute = false;
        let mut object_flags = ObjectFlags::JSX_ATTRIBUTES;
        let namespace = self.get_jsx_namespace_at(opening_like_element);
        let jsx_children_property_name = self.get_jsx_element_children_property_name(namespace);
        let is_jsx_open_fragment = is_jsx_opening_fragment(a, opening_like_element);
        if !is_jsx_open_fragment {
            let attributes = a.attributes(opening_like_element);
            attributes_symbol = a.symbol(attributes);
            attribute_parent = attributes;
            let contextual_type = self.get_contextual_type(attributes, ContextFlags::NONE);
            // Create anonymous type from given attributes symbol table. @param symbol a symbol of JsxAttributes containing attributes corresponding to attributesTable @param attributesTable a symbol table of attributes property
            for &attribute_decl in a.properties(attributes).as_slice() {
                let member = a.symbol(attribute_decl);
                if is_jsx_attribute(a, attribute_decl) {
                    let expr_type = self.check_jsx_attribute(attribute_decl, check_mode);
                    object_flags |=
                        self.types[expr_type].object_flags & ObjectFlags::PROPAGATING_FLAGS;
                    let member_symbol = a.sym(member);
                    let attribute_symbol = self.new_symbol(
                        SymbolFlags::PROPERTY | member_symbol.flags,
                        member_symbol.name,
                    );
                    a.update_symbol(attribute_symbol, |s| {
                        s.declarations = member_symbol.declarations;
                        s.parent = member_symbol.parent;
                        if !member_symbol.value_declaration.is_nil() {
                            s.value_declaration = member_symbol.value_declaration;
                        }
                    });
                    let links = self.value_symbol_links_get(attribute_symbol);
                    self.value_symbol_links[links].resolved_type = expr_type;
                    self.value_symbol_links[links].target = member;
                    let attribute_name = a.sym(attribute_symbol).name;
                    a.table_set(attributes_table, attribute_name, attribute_symbol);
                    if !all_attributes_table.is_nil() {
                        a.table_set(all_attributes_table, attribute_name, attribute_symbol);
                    }
                    if a.text(a.name(attribute_decl)) == jsx_children_property_name {
                        explicitly_specify_children_attribute = true;
                    }
                    if !contextual_type.is_nil()
                        && check_mode.intersects(CheckMode::INFERENTIAL)
                        && !check_mode.intersects(CheckMode::SKIP_CONTEXT_SENSITIVE)
                        && self.is_context_sensitive(attribute_decl)
                    {
                        let inference_context = self.get_inference_context(attributes);
                        self.assert(!inference_context.is_nil(), "inferenceContext != nil");
                        // In CheckMode.Inferential we should always have an inference context
                        let inference_node = a.expression(a.initializer(attribute_decl));
                        self.add_intra_expression_inference_site(
                            inference_context,
                            inference_node,
                            expr_type,
                        );
                    }
                } else {
                    self.assert(
                        a.kind(attribute_decl) == Kind::JsxSpreadAttribute,
                        "attributeDecl.Kind == ast.KindJsxSpreadAttribute",
                    );
                    if a.table_len(attributes_table) != 0 {
                        let attributes_type = create_jsx_attributes_type(
                            self,
                            attributes_symbol,
                            attributes_table,
                            &mut object_flags,
                        );
                        spread = self.get_spread_type(
                            spread,
                            attributes_type,
                            attributes_symbol,
                            object_flags,
                            false,
                        );
                        attributes_table = a.new_table();
                    }
                    let expr_type = self.check_expression_ex(
                        a.expression(attribute_decl),
                        check_mode & CheckMode::INFERENTIAL,
                    );
                    let expr_type = self.get_reduced_type(expr_type);
                    if is_type_any(self, expr_type) {
                        has_spread_any_type = true;
                    }
                    if self.is_valid_spread_type(expr_type) {
                        spread = self.get_spread_type(
                            spread,
                            expr_type,
                            attributes_symbol,
                            object_flags,
                            false,
                        );
                        if !all_attributes_table.is_nil() {
                            self.check_spread_prop_overrides(
                                expr_type,
                                all_attributes_table,
                                attribute_decl,
                            );
                        }
                    } else {
                        self.error(
                            a.expression(attribute_decl),
                            diagnostics::SPREAD_TYPES_MAY_ONLY_BE_CREATED_FROM_OBJECT_TYPES,
                            &[],
                        );
                        if !type_to_intersect.is_nil() {
                            type_to_intersect = self.get_intersection_type(List::from_slice(&[
                                type_to_intersect,
                                expr_type,
                            ]));
                        } else {
                            type_to_intersect = expr_type;
                        }
                    }
                }
            }
            if !has_spread_any_type {
                if a.table_len(attributes_table) != 0 {
                    let attributes_type = create_jsx_attributes_type(
                        self,
                        attributes_symbol,
                        attributes_table,
                        &mut object_flags,
                    );
                    spread = self.get_spread_type(
                        spread,
                        attributes_type,
                        attributes_symbol,
                        object_flags,
                        false,
                    );
                }
            }
        }
        if parent_has_semantic_jsx_children(a, opening_like_element) {
            let child_types = self.check_jsx_children(a.parent(opening_like_element), check_mode);
            if !has_spread_any_type
                && jsx_children_property_name != INTERNAL_SYMBOL_NAME_MISSING
                && !jsx_children_property_name.is_empty()
            {
                // Error if there is a attribute named "children" explicitly specified and children element. This is because children element will overwrite the value from attributes. Note: we will not warn "children" attribute overwritten if "children" attribute is specified in object spread.
                if explicitly_specify_children_attribute {
                    self.error(
                        attribute_parent,
                        diagnostics::X_0_ARE_SPECIFIED_TWICE_THE_ATTRIBUTE_NAMED_0_WILL_BE_OVERWRITTEN,
                        &[Arg::Str(jsx_children_property_name)],
                    );
                }
                let mut children_contextual_type = TypeId::NIL;
                if is_jsx_opening_element(a, opening_like_element) {
                    let contextual_type = self.get_apparent_type_of_contextual_type(
                        a.attributes(opening_like_element),
                        ContextFlags::NONE,
                    );
                    if !contextual_type.is_nil() {
                        children_contextual_type = self.get_type_of_property_of_contextual_type(
                            contextual_type,
                            jsx_children_property_name,
                        );
                    }
                }
                // If there are children in the body of JSX element, create dummy attribute "children" with the union of children types so that it will pass the attribute checking process
                let children_prop_symbol =
                    self.new_symbol(SymbolFlags::PROPERTY, jsx_children_property_name);
                let links = self.value_symbol_links_get(children_prop_symbol);
                let child_type_list = self.list_of(&child_types);
                let resolved_type = if child_types.len() == 1 {
                    child_type_list.at(0usize)
                } else if !children_contextual_type.is_nil()
                    && some_type(self, children_contextual_type, &mut |c, t| {
                        c.is_tuple_like_type(t)
                    })
                {
                    self.create_tuple_type(child_type_list)
                } else {
                    let union_type = self.get_union_type(child_type_list);
                    self.create_array_type(union_type)
                };
                self.value_symbol_links[links].resolved_type = resolved_type;
                // Fake up a property declaration for the children
                let mut factory = Factory::new(a);
                let children_name = factory.new_identifier(jsx_children_property_name);
                let value_declaration = factory.new_property_signature_declaration(
                    ModifierListId::NIL,
                    children_name,
                    NodeId::NIL,
                    NodeId::NIL,
                    NodeId::NIL,
                );
                a.update_symbol(children_prop_symbol, |s| {
                    s.value_declaration = value_declaration;
                });
                a.set_parent(value_declaration, attribute_parent);
                a.set_symbol(value_declaration, children_prop_symbol);
                let child_prop_map = a.new_table();
                a.table_set(
                    child_prop_map,
                    jsx_children_property_name,
                    children_prop_symbol,
                );
                let child_prop_type = self.new_anonymous_type(
                    attributes_symbol,
                    child_prop_map,
                    List::NIL,
                    List::NIL,
                    List::NIL,
                );
                let child_object_flags = object_flags
                    | self.get_propagating_flags_of_types(child_type_list, TypeFlags::NONE);
                spread = self.get_spread_type(
                    spread,
                    child_prop_type,
                    attributes_symbol,
                    child_object_flags,
                    false,
                );
            }
        }
        if has_spread_any_type {
            return self.any_type;
        }
        if !type_to_intersect.is_nil() {
            if spread != self.empty_jsx_object_type {
                return self.get_intersection_type(List::from_slice(&[type_to_intersect, spread]));
            }
            return type_to_intersect;
        }
        if spread == self.empty_jsx_object_type {
            return create_jsx_attributes_type(
                self,
                attributes_symbol,
                attributes_table,
                &mut object_flags,
            );
        }
        spread
    }

    pub fn check_jsx_attribute(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let initializer = self.ast.initializer(node);
        if !initializer.is_nil() {
            return self.check_expression_for_mutable_location(initializer, check_mode);
        }
        // <Elem attr /> is sugar for <Elem attr={true} />
        self.true_type
    }

    pub fn check_jsx_children(&mut self, node: NodeId, check_mode: CheckMode) -> Vec<TypeId> {
        let a = self.ast;
        let mut child_types: Vec<TypeId> = Vec::new();
        for &child in a.nodes(a.children(node)).as_slice() {
            // In React, JSX text that contains only whitespaces will be ignored so we don't want to type-check that because then type of children property will have constituent of string type.
            if is_jsx_text(a, child) {
                if !a.as_jsx_text(child).contains_only_trivia_white_spaces {
                    child_types.push(self.string_type);
                }
            } else if is_jsx_expression(a, child) && a.expression(child).is_nil() {
                // empty jsx expressions don't *really* count as present children
                continue;
            } else {
                child_types.push(self.check_expression_for_mutable_location(child, check_mode));
            }
        }
        child_types
    }

    pub fn get_uninstantiated_jsx_signatures_of_type(
        &mut self,
        element_type: TypeId,
        caller: NodeId,
    ) -> List<'a, SignatureId> {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[element_type].flags.intersects(TypeFlags::STRING) {
            return self.list_of(&[self.any_signature]);
        }
        if self.types[element_type]
            .flags
            .intersects(TypeFlags::STRING_LITERAL)
        {
            let intrinsic_type =
                self.get_intrinsic_attributes_type_from_string_literal_type(element_type, caller);
            if intrinsic_type.is_nil() {
                let literal_value = get_string_literal_value(self, element_type);
                let type_name = jsx_intrinsic_elements_type_name();
                self.error(
                    caller,
                    diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                    &[Arg::Str(literal_value), Arg::Str(&type_name)],
                );
                return List::NIL;
            }
            let fake_signature = self.create_signature_for_jsx_intrinsic(caller, intrinsic_type);
            return self.list_of(&[fake_signature]);
        }
        let apparent_elem_type = self.get_apparent_type(element_type);
        // Resolve the signatures, preferring constructor
        let mut signatures =
            self.get_signatures_of_type(apparent_elem_type, SignatureKind::CONSTRUCT);
        if signatures.len() == 0 {
            // No construct signatures, try call signatures
            signatures = self.get_signatures_of_type(apparent_elem_type, SignatureKind::CALL);
        }
        if signatures.len() == 0
            && self.types[apparent_elem_type]
                .flags
                .intersects(TypeFlags::UNION)
        {
            // If each member has some combination of new/call signatures; make a union signature list for those
            let types = self.type_types(apparent_elem_type);
            let mut signature_lists: Vec<List<'a, SignatureId>> =
                Vec::with_capacity(types.as_slice().len());
            for &t in types.as_slice() {
                signature_lists.push(self.get_uninstantiated_jsx_signatures_of_type(t, caller));
            }
            signatures = self.get_union_signatures(&signature_lists);
        }
        signatures
    }

    pub fn get_effective_first_argument_for_jsx_signature(
        &mut self,
        signature: SignatureId,
        node: NodeId,
    ) -> TypeId {
        if is_jsx_opening_fragment(self.ast, node)
            || self.get_jsx_reference_kind(node) != JsxReferenceKind::COMPONENT
        {
            return self.get_jsx_props_type_from_call_signature(signature, node);
        }
        self.get_jsx_props_type_from_class_type(signature, node)
    }

    pub fn get_jsx_props_type_from_call_signature(
        &mut self,
        sig: SignatureId,
        context: NodeId,
    ) -> TypeId {
        let mut props_type =
            self.get_type_of_first_parameter_of_signature_with_fallback(sig, self.unknown_type);
        let namespace = self.get_jsx_namespace_at(context);
        props_type =
            self.get_jsx_managed_attributes_from_located_attributes(context, namespace, props_type);
        let intrinsic_attribs = self.get_jsx_type(JsxNames::INTRINSIC_ATTRIBUTES, context);
        if !self.is_error_type(intrinsic_attribs) {
            props_type = self.intersect_types(intrinsic_attribs, props_type);
        }
        props_type
    }

    pub fn get_jsx_props_type_from_class_type(
        &mut self,
        sig: SignatureId,
        context: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let ns = self.get_jsx_namespace_at(context);
        let forced_lookup_location = self.get_jsx_element_properties_name(ns);
        let mut attributes_type;
        if forced_lookup_location == INTERNAL_SYMBOL_NAME_MISSING {
            attributes_type =
                self.get_type_of_first_parameter_of_signature_with_fallback(sig, self.unknown_type);
        } else if forced_lookup_location.is_empty() {
            attributes_type = self.get_return_type_of_signature(sig);
        } else {
            attributes_type =
                self.get_jsx_props_type_for_signature_from_member(sig, forced_lookup_location);
            if attributes_type.is_nil() && a.properties(a.attributes(context)).len() != 0 {
                // There is no property named 'props' on this instance type
                self.error(
                    context,
                    diagnostics::JSX_ELEMENT_CLASS_DOES_NOT_SUPPORT_ATTRIBUTES_BECAUSE_IT_DOES_NOT_HAVE_A_0_PROPERTY,
                    &[Arg::Str(forced_lookup_location)],
                );
            }
        }
        if attributes_type.is_nil() {
            return self.unknown_type;
        }
        attributes_type =
            self.get_jsx_managed_attributes_from_located_attributes(context, ns, attributes_type);
        if is_type_any(self, attributes_type) {
            // Props is of type 'any' or unknown
            return attributes_type;
        }
        // Normal case -- add in IntrinsicClassAttributes<T> and IntrinsicAttributes
        let mut apparent_attributes_type = attributes_type;
        let intrinsic_class_attribs =
            self.get_jsx_type(JsxNames::INTRINSIC_CLASS_ATTRIBUTES, context);
        if !self.is_error_type(intrinsic_class_attribs) {
            let type_params = self.get_local_type_parameters_of_class_or_interface_or_type_alias(
                self.types[intrinsic_class_attribs].symbol,
            );
            let host_class_type = self.get_return_type_of_signature(sig);
            let library_managed_attribute_type;
            if !type_params.is_nil() {
                // apply JSX.IntrinsicClassAttributes<hostClassType, ...>
                let min_type_argument_count = self.get_min_type_argument_count(type_params);
                let type_arguments = self.list_of(&[host_class_type]);
                let inferred_args = self.fill_missing_type_arguments(
                    type_arguments,
                    type_params,
                    min_type_argument_count,
                    is_in_js_file(a, context),
                );
                let mapper = new_type_mapper(self, type_params, inferred_args);
                library_managed_attribute_type =
                    self.instantiate_type(intrinsic_class_attribs, mapper);
            } else {
                library_managed_attribute_type = intrinsic_class_attribs;
            }
            apparent_attributes_type =
                self.intersect_types(library_managed_attribute_type, apparent_attributes_type);
        }
        let intrinsic_attribs = self.get_jsx_type(JsxNames::INTRINSIC_ATTRIBUTES, context);
        if !self.is_error_type(intrinsic_attribs) {
            apparent_attributes_type =
                self.intersect_types(intrinsic_attribs, apparent_attributes_type);
        }
        apparent_attributes_type
    }

    pub fn get_jsx_props_type_for_signature_from_member(
        &mut self,
        sig: SignatureId,
        forced_lookup_location: &[u8],
    ) -> TypeId {
        let composite = self.signatures[sig].composite;
        if !composite.is_nil() {
            // JSX Elements using the legacy `props`-field based lookup (eg, react class components) need to treat the `props` member as an input instead of an output position when resolving the signature. We need to go back to the input signatures of the composite signature, get the type of `props` on each return type individually, and then _intersect them_, rather than union them (as would normally occur for a union signature). It's an unfortunate quirk of looking in the output of the signature for the type we want to use for the input. The default behavior of `getTypeOfFirstParameterOfSignatureWithFallback` when no `props` member name is defined is much more sane.
            let signatures = self.composite_signatures[composite].signatures;
            let mut results: Vec<TypeId> = Vec::new();
            for &signature in signatures.as_slice() {
                let instance = self.get_return_type_of_signature(signature);
                if is_type_any(self, instance) {
                    return instance;
                }
                let prop_type = self.get_type_of_property_of_type(instance, forced_lookup_location);
                if prop_type.is_nil() {
                    return TypeId::NIL;
                }
                results.push(prop_type);
            }
            return self.get_intersection_type(List::from_slice(&results)); // Same result for both union and intersection signatures
        }
        let instance_type = self.get_return_type_of_signature(sig);
        if is_type_any(self, instance_type) {
            return instance_type;
        }
        self.get_type_of_property_of_type(instance_type, forced_lookup_location)
    }

    pub fn get_jsx_managed_attributes_from_located_attributes(
        &mut self,
        context: NodeId,
        ns: SymbolId,
        attributes_type: TypeId,
    ) -> TypeId {
        let managed_sym = self.get_jsx_library_managed_attributes(ns);
        if !managed_sym.is_nil() {
            let ctor_type = self.get_static_type_of_referenced_jsx_constructor(context);
            let type_arguments = self.list_of(&[ctor_type, attributes_type]);
            let result = self.instantiate_alias_or_interface_with_defaults(
                managed_sym,
                type_arguments,
                is_in_js_file(self.ast, context),
            );
            if !result.is_nil() {
                return result;
            }
        }
        attributes_type
    }

    pub fn instantiate_alias_or_interface_with_defaults(
        &mut self,
        managed_sym: SymbolId,
        type_arguments: List<'a, TypeId>,
        in_java_script: bool,
    ) -> TypeId {
        let declared_managed_type = self.get_declared_type_of_symbol(managed_sym);
        // fetches interface type, or initializes symbol links type parameters
        if self
            .ast
            .sym(managed_sym)
            .flags
            .intersects(SymbolFlags::TYPE_ALIAS)
        {
            let links = self.type_alias_links.get(managed_sym);
            let params = self.type_alias_links[links].type_parameters;
            if params.len() >= type_arguments.len() {
                let args = self.fill_missing_type_arguments(
                    type_arguments,
                    params,
                    type_arguments.len(),
                    in_java_script,
                );
                if args.len() == 0 {
                    return declared_managed_type;
                }
                return self.get_type_alias_instantiation(managed_sym, args, TypeAliasId::NIL);
            }
        }
        if self.types[declared_managed_type]
            .object_flags
            .intersects(ObjectFlags::CLASS_OR_INTERFACE)
        {
            let type_parameters = self
                .as_interface_type(declared_managed_type)
                .type_parameters();
            if type_parameters.len() >= type_arguments.len() {
                let args = self.fill_missing_type_arguments(
                    type_arguments,
                    type_parameters,
                    type_arguments.len(),
                    in_java_script,
                );
                return self.create_type_reference(declared_managed_type, args);
            }
        }
        TypeId::NIL
    }

    pub fn get_jsx_library_managed_attributes(&mut self, jsx_namespace: SymbolId) -> SymbolId {
        let a = self.ast;
        if !jsx_namespace.is_nil() {
            return self.get_symbol(
                a.sym(jsx_namespace).exports,
                JsxNames::LIBRARY_MANAGED_ATTRIBUTES,
                SymbolFlags::TYPE,
            );
        }
        SymbolId::NIL
    }

    pub fn get_jsx_element_type_symbol(&mut self, jsx_namespace: SymbolId) -> SymbolId {
        let a = self.ast;
        // JSX.ElementType [symbol]
        if !jsx_namespace.is_nil() {
            return self.get_symbol(
                a.sym(jsx_namespace).exports,
                JsxNames::ELEMENT_TYPE,
                SymbolFlags::TYPE,
            );
        }
        SymbolId::NIL
    }

    // e.g. "props" for React.d.ts, or InternalSymbolNameMissing if ElementAttributesProperty doesn't exist (which means all non-intrinsic elements' attributes type is 'any'), or "" if it has 0 properties (which means every non-intrinsic elements' attributes type is the element instance type)
    pub fn get_jsx_element_properties_name(&mut self, jsx_namespace: SymbolId) -> Text<'a> {
        self.get_name_from_jsx_element_attributes_container(
            JsxNames::ELEMENT_ATTRIBUTES_PROPERTY_NAME_CONTAINER,
            jsx_namespace,
        )
    }

    pub fn get_jsx_element_children_property_name(&mut self, jsx_namespace: SymbolId) -> Text<'a> {
        if self.compiler_options.jsx == JsxEmit::REACT_JSX
            || self.compiler_options.jsx == JsxEmit::REACT_JSX_DEV
        {
            // In these JsxEmit modes the children property is fixed to 'children'
            return b"children";
        }
        self.get_name_from_jsx_element_attributes_container(
            JsxNames::ELEMENT_CHILDREN_ATTRIBUTE_NAME_CONTAINER,
            jsx_namespace,
        )
    }

    // Look into JSX namespace and then look for container with matching name as nameOfAttribPropContainer. Get a single property from that container if existed. Report an error if there are more than one property. @param nameOfAttribPropContainer a string of value JsxNames.ElementAttributesPropertyNameContainer or JsxNames.ElementChildrenAttributeNameContainer if other string is given or the container doesn't exist, return undefined.
    pub fn get_name_from_jsx_element_attributes_container(
        &mut self,
        name_of_attrib_prop_container: &[u8],
        jsx_namespace: SymbolId,
    ) -> Text<'a> {
        let a = self.ast;
        // JSX.ElementAttributesProperty | JSX.ElementChildrenAttribute [symbol]
        if !jsx_namespace.is_nil() {
            let jsx_element_attrib_prop_interface_sym = self.get_symbol(
                a.sym(jsx_namespace).exports,
                name_of_attrib_prop_container,
                SymbolFlags::TYPE,
            );
            if !jsx_element_attrib_prop_interface_sym.is_nil() {
                let jsx_element_attrib_prop_interface_type =
                    self.get_declared_type_of_symbol(jsx_element_attrib_prop_interface_sym);
                let properties_of_jsx_element_attrib_prop_interface =
                    self.get_properties_of_type(jsx_element_attrib_prop_interface_type);
                // Element Attributes has zero properties, so the element attributes type will be the class instance type
                if properties_of_jsx_element_attrib_prop_interface.len() == 0 {
                    return b"";
                }
                if properties_of_jsx_element_attrib_prop_interface.len() == 1 {
                    return a
                        .sym(properties_of_jsx_element_attrib_prop_interface.at(0usize))
                        .name;
                }
                let declarations = a.sym(jsx_element_attrib_prop_interface_sym).declarations;
                if properties_of_jsx_element_attrib_prop_interface.len() > 1
                    && declarations.len() != 0
                {
                    // More than one property on ElementAttributesProperty is an error
                    self.error(
                        declarations.at(0usize),
                        diagnostics::THE_GLOBAL_TYPE_JSX_0_MAY_NOT_HAVE_MORE_THAN_ONE_PROPERTY,
                        &[Arg::Str(name_of_attrib_prop_container)],
                    );
                }
            }
        }
        INTERNAL_SYMBOL_NAME_MISSING
    }

    pub fn get_static_type_of_referenced_jsx_constructor(&mut self, context: NodeId) -> TypeId {
        let a = self.ast;
        if is_jsx_opening_fragment(a, context) {
            return self.get_jsx_fragment_type(context);
        }
        if is_jsx_intrinsic_tag_name(a, a.tag_name(context)) {
            let result = self.get_intrinsic_attributes_type_from_jsx_opening_like_element(context);
            let fake_signature = self.create_signature_for_jsx_intrinsic(context, result);
            return self.get_or_create_type_from_signature(fake_signature);
        }
        let tag_type = self.check_expression_cached(a.tag_name(context));
        if self.types[tag_type]
            .flags
            .intersects(TypeFlags::STRING_LITERAL)
        {
            let result =
                self.get_intrinsic_attributes_type_from_string_literal_type(tag_type, context);
            if result.is_nil() {
                return self.error_type;
            }
            let fake_signature = self.create_signature_for_jsx_intrinsic(context, result);
            return self.get_or_create_type_from_signature(fake_signature);
        }
        tag_type
    }

    pub fn get_intrinsic_attributes_type_from_string_literal_type(
        &mut self,
        t: TypeId,
        location: NodeId,
    ) -> TypeId {
        // If the elemType is a stringLiteral type, we can then provide a check to make sure that the string literal type is one of the Jsx intrinsic element type For example: var CustomTag: "h1" = "h1"; <CustomTag> Hello World </CustomTag>
        let intrinsic_elements_type = self.get_jsx_type(JsxNames::INTRINSIC_ELEMENTS, location);
        if !self.is_error_type(intrinsic_elements_type) {
            let string_literal_type_name = get_string_literal_value(self, t);
            let intrinsic_prop =
                self.get_property_of_type(intrinsic_elements_type, string_literal_type_name);
            if !intrinsic_prop.is_nil() {
                return self.get_type_of_symbol(intrinsic_prop);
            }
            let index_signature_type =
                self.get_index_type_of_type(intrinsic_elements_type, self.string_type);
            if !index_signature_type.is_nil() {
                return index_signature_type;
            }
            return TypeId::NIL;
        }
        // If we need to report an error, we already done so here. So just return any to prevent any more error downstream
        self.any_type
    }

    pub fn get_jsx_reference_kind(&mut self, node: NodeId) -> JsxReferenceKind {
        let a = self.ast;
        if is_jsx_intrinsic_tag_name(a, a.tag_name(node)) {
            return JsxReferenceKind::MIXED;
        }
        let tag_expression_type = self.check_expression(a.tag_name(node));
        let tag_type = self.get_apparent_type(tag_expression_type);
        if self
            .get_signatures_of_type(tag_type, SignatureKind::CONSTRUCT)
            .len()
            != 0
        {
            return JsxReferenceKind::COMPONENT;
        }
        if self
            .get_signatures_of_type(tag_type, SignatureKind::CALL)
            .len()
            != 0
        {
            return JsxReferenceKind::FUNCTION;
        }
        JsxReferenceKind::MIXED
    }

    pub fn create_signature_for_jsx_intrinsic(
        &mut self,
        node: NodeId,
        result: TypeId,
    ) -> SignatureId {
        let mut element_type = self.error_type;
        let namespace = self.get_jsx_namespace_at(node);
        if !namespace.is_nil() {
            let exports = self.get_exports_of_symbol(namespace);
            let type_symbol = self.get_symbol(exports, JsxNames::ELEMENT, SymbolFlags::TYPE);
            if !type_symbol.is_nil() {
                element_type = self.get_declared_type_of_symbol(type_symbol);
            }
        }
        let parameter_symbol = self.new_symbol(SymbolFlags::FUNCTION_SCOPED_VARIABLE, b"props");
        let links = self.value_symbol_links_get(parameter_symbol);
        self.value_symbol_links[links].resolved_type = result;
        let parameters = self.list_of(&[parameter_symbol]);
        self.new_signature(
            SignatureFlags::NONE,
            NodeId::NIL,
            List::NIL,
            SymbolId::NIL,
            parameters,
            element_type,
            TypePredicateId::NIL,
            1,
        )
    }

    // Get attributes type of the given intrinsic opening-like Jsx element by resolving the tag name. The function is intended to be called from a function which has checked that the opening element is an intrinsic element. @param node an intrinsic JSX opening-like element
    pub fn get_intrinsic_attributes_type_from_jsx_opening_like_element(
        &mut self,
        node: NodeId,
    ) -> TypeId {
        let a = self.ast;
        self.assert(
            is_jsx_intrinsic_tag_name(a, a.tag_name(node)),
            "isJsxIntrinsicTagName(node.TagName())",
        );
        let links = self.jsx_element_links.get(node);
        if !self.jsx_element_links[links]
            .resolved_jsx_element_attributes_type
            .is_nil()
        {
            return self.jsx_element_links[links].resolved_jsx_element_attributes_type;
        }
        let symbol = self.get_intrinsic_tag_symbol(node);
        if self.jsx_element_links[links]
            .jsx_flags
            .intersects(JsxFlags::INTRINSIC_NAMED_ELEMENT)
        {
            let mut attributes_type = self.get_type_of_symbol(symbol);
            if attributes_type.is_nil() {
                attributes_type = self.error_type;
            }
            self.jsx_element_links[links].resolved_jsx_element_attributes_type = attributes_type;
            return attributes_type;
        }
        if self.jsx_element_links[links]
            .jsx_flags
            .intersects(JsxFlags::INTRINSIC_INDEXED_ELEMENT)
        {
            let intrinsic_elements_type = self.get_jsx_type(JsxNames::INTRINSIC_ELEMENTS, node);
            let index_info = self.get_applicable_index_info_for_name(
                intrinsic_elements_type,
                a.text(a.tag_name(node)),
            );
            if !index_info.is_nil() {
                let value_type = self.index_infos[index_info].value_type;
                self.jsx_element_links[links].resolved_jsx_element_attributes_type = value_type;
                return value_type;
            }
        }
        self.jsx_element_links[links].resolved_jsx_element_attributes_type = self.error_type;
        self.error_type
    }

    // Looks up an intrinsic tag name and returns a symbol that either points to an intrinsic property (in which case nodeLinks.jsxFlags will be IntrinsicNamedElement) or an intrinsic string index signature (in which case nodeLinks.jsxFlags will be IntrinsicIndexedElement). May also return unknownSymbol if both of these lookups fail.
    pub fn get_intrinsic_tag_symbol(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        let links = self.symbol_node_links.get(node);
        if !self.symbol_node_links[links].resolved_symbol.is_nil() {
            return self.symbol_node_links[links].resolved_symbol;
        }
        let intrinsic_elements_type = self.get_jsx_type(JsxNames::INTRINSIC_ELEMENTS, node);
        if !self.is_error_type(intrinsic_elements_type) {
            // Property case
            let tag_name = a.tag_name(node);
            if !is_identifier(a, tag_name) && !is_jsx_namespaced_name(a, tag_name) {
                let _: () = self.fail("Invalid tag name");
                return self.unknown_symbol;
            }
            let prop_name = a.text(tag_name);
            let intrinsic_prop = self.get_property_of_type(intrinsic_elements_type, prop_name);
            if !intrinsic_prop.is_nil() {
                let jsx_links = self.jsx_element_links.get(node);
                self.jsx_element_links[jsx_links].jsx_flags |= JsxFlags::INTRINSIC_NAMED_ELEMENT;
                self.symbol_node_links[links].resolved_symbol = intrinsic_prop;
                return intrinsic_prop;
            }
            // Intrinsic string indexer case
            let prop_name_type = self.get_string_literal_type(prop_name);
            let index_symbol =
                self.get_applicable_index_symbol(intrinsic_elements_type, prop_name_type);
            if !index_symbol.is_nil() {
                let jsx_links = self.jsx_element_links.get(node);
                self.jsx_element_links[jsx_links].jsx_flags |= JsxFlags::INTRINSIC_INDEXED_ELEMENT;
                self.symbol_node_links[links].resolved_symbol = index_symbol;
                return index_symbol;
            }
            if !self
                .get_type_of_property_or_index_signature_of_type(intrinsic_elements_type, prop_name)
                .is_nil()
            {
                let jsx_links = self.jsx_element_links.get(node);
                self.jsx_element_links[jsx_links].jsx_flags |= JsxFlags::INTRINSIC_INDEXED_ELEMENT;
                let symbol = self.types[intrinsic_elements_type].symbol;
                self.symbol_node_links[links].resolved_symbol = symbol;
                return symbol;
            }
            // Wasn't found
            let type_name = jsx_intrinsic_elements_type_name();
            self.error(
                node,
                diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                &[Arg::Str(a.text(tag_name)), Arg::Str(&type_name)],
            );
            self.symbol_node_links[links].resolved_symbol = self.unknown_symbol;
            return self.unknown_symbol;
        }
        if self.no_implicit_any {
            self.error(
                node,
                diagnostics::JSX_ELEMENT_IMPLICITLY_HAS_TYPE_ANY_BECAUSE_NO_INTERFACE_JSX_0_EXISTS,
                &[Arg::Str(JsxNames::INTRINSIC_ELEMENTS)],
            );
        }
        self.symbol_node_links[links].resolved_symbol = self.unknown_symbol;
        self.unknown_symbol
    }

    pub fn get_jsx_stateless_element_type_at(&mut self, location: NodeId) -> TypeId {
        let jsx_element_type = self.get_jsx_element_type_at(location);
        if jsx_element_type.is_nil() {
            return TypeId::NIL;
        }
        self.get_union_type(List::from_slice(&[jsx_element_type, self.null_type]))
    }

    pub fn get_jsx_element_class_type_at(&mut self, location: NodeId) -> TypeId {
        let t = self.get_jsx_type(JsxNames::ELEMENT_CLASS, location);
        if self.is_error_type(t) {
            return TypeId::NIL;
        }
        t
    }

    pub fn get_jsx_element_type_at(&mut self, location: NodeId) -> TypeId {
        self.get_jsx_type(JsxNames::ELEMENT, location)
    }

    pub fn get_jsx_element_type_type_at(&mut self, location: NodeId) -> TypeId {
        let ns = self.get_jsx_namespace_at(location);
        if ns.is_nil() {
            return TypeId::NIL;
        }
        let sym = self.get_jsx_element_type_symbol(ns);
        if sym.is_nil() {
            return TypeId::NIL;
        }
        let t = self.instantiate_alias_or_interface_with_defaults(
            sym,
            List::NIL,
            is_in_js_file(self.ast, location),
        );
        if t.is_nil() || self.is_error_type(t) {
            return TypeId::NIL;
        }
        t
    }

    pub fn get_jsx_type(&mut self, name: &[u8], location: NodeId) -> TypeId {
        let namespace = self.get_jsx_namespace_at(location);
        if !namespace.is_nil() {
            let exports = self.get_exports_of_symbol(namespace);
            if !exports.is_nil() {
                let type_symbol = self.get_symbol(exports, name, SymbolFlags::TYPE);
                if !type_symbol.is_nil() {
                    return self.get_declared_type_of_symbol(type_symbol);
                }
            }
        }
        self.error_type
    }

    pub fn get_jsx_namespace_at(&mut self, location: NodeId) -> SymbolId {
        let mut links: Link<JsxElementLinks> = Link::default();
        if !location.is_nil() {
            links = self.jsx_element_links.get(location);
        }
        if !links.is_nil() {
            let jsx_namespace = self.jsx_element_links[links].jsx_namespace;
            if !jsx_namespace.is_nil() && jsx_namespace != self.unknown_symbol {
                return jsx_namespace;
            }
        }
        if links.is_nil() || self.jsx_element_links[links].jsx_namespace != self.unknown_symbol {
            let mut resolved_namespace =
                self.get_jsx_namespace_container_for_implicit_import(location);
            if resolved_namespace.is_nil() || resolved_namespace == self.unknown_symbol {
                let namespace_name = self.get_jsx_namespace(location);
                resolved_namespace = self.resolve_name(
                    location,
                    namespace_name,
                    SymbolFlags::NAMESPACE,
                    MessageId::NIL,
                    false,
                    false,
                );
            }
            if !resolved_namespace.is_nil() {
                let resolved = self.resolve_symbol(resolved_namespace);
                let exports = self.get_exports_of_symbol(resolved);
                let jsx_symbol = self.get_symbol(exports, JsxNames::JSX, SymbolFlags::NAMESPACE);
                let candidate = self.resolve_symbol(jsx_symbol);
                if !candidate.is_nil() && candidate != self.unknown_symbol {
                    if !links.is_nil() {
                        self.jsx_element_links[links].jsx_namespace = candidate;
                    }
                    return candidate;
                }
            }
            if !links.is_nil() {
                self.jsx_element_links[links].jsx_namespace = self.unknown_symbol;
            }
        }
        // JSX global fallback
        let global_symbol =
            self.get_global_symbol(JsxNames::JSX, SymbolFlags::NAMESPACE, MessageId::NIL);
        let s = self.resolve_symbol(global_symbol);
        if s == self.unknown_symbol {
            return SymbolId::NIL;
        }
        s
    }

    pub fn get_jsx_namespace(&mut self, location: NodeId) -> Text<'a> {
        let a = self.ast;
        let options = self.compiler_options;
        if !location.is_nil() {
            let file = get_source_file_of_node(a, location);
            if !file.is_nil() {
                let links = self.source_file_links.get(file);
                if is_jsx_opening_fragment(a, location) {
                    if !self.source_file_links[links]
                        .local_jsx_fragment_namespace
                        .is_empty()
                    {
                        return self.source_file_links[links].local_jsx_fragment_namespace;
                    }
                    let jsx_fragment_pragma = get_pragma_from_source_file(a, file, b"jsxfrag");
                    if let Some(jsx_fragment_pragma) = jsx_fragment_pragma {
                        let factory = self.parse_isolated_entity_name(pragma_factory_argument(
                            jsx_fragment_pragma,
                        ));
                        self.source_file_links[links].local_jsx_fragment_factory = factory;
                        if !factory.is_nil() {
                            let namespace = a.text(get_first_identifier(a, factory));
                            self.source_file_links[links].local_jsx_fragment_namespace = namespace;
                            return namespace;
                        }
                    }
                    let entity = self.get_jsx_fragment_factory_entity(location);
                    if !entity.is_nil() {
                        self.source_file_links[links].local_jsx_fragment_factory = entity;
                        let namespace = a.text(get_first_identifier(a, entity));
                        self.source_file_links[links].local_jsx_fragment_namespace = namespace;
                        return namespace;
                    }
                } else {
                    let local_jsx_namespace = self.get_local_jsx_namespace(file);
                    if !local_jsx_namespace.is_empty() {
                        self.source_file_links[links].local_jsx_namespace = local_jsx_namespace;
                        return local_jsx_namespace;
                    }
                }
            }
        }
        if self.jsx_namespace.is_empty() {
            self.jsx_namespace = b"React";
            if !options.jsx_factory.is_empty() {
                self.jsx_factory_entity = self.parse_isolated_entity_name(&options.jsx_factory);
                if !self.jsx_factory_entity.is_nil() {
                    self.jsx_namespace = a.text(get_first_identifier(a, self.jsx_factory_entity));
                }
            } else if !options.react_namespace.is_empty() {
                self.jsx_namespace = options.react_namespace.as_slice();
            }
        }
        if self.jsx_factory_entity.is_nil() {
            let mut factory = Factory::new(a);
            let namespace = factory.new_identifier(self.jsx_namespace);
            let create_element = factory.new_identifier(b"createElement");
            self.jsx_factory_entity = factory.new_qualified_name(namespace, create_element);
        }
        self.jsx_namespace
    }

    pub fn get_local_jsx_namespace(&mut self, file: NodeId) -> Text<'a> {
        let a = self.ast;
        let links = self.source_file_links.get(file);
        if !self.source_file_links[links].local_jsx_namespace.is_empty() {
            return self.source_file_links[links].local_jsx_namespace;
        }
        let jsx_pragma = get_pragma_from_source_file(a, file, b"jsx");
        if let Some(jsx_pragma) = jsx_pragma {
            let factory = self.parse_isolated_entity_name(pragma_factory_argument(jsx_pragma));
            self.source_file_links[links].local_jsx_factory = factory;
            if !factory.is_nil() {
                let namespace = a.text(get_first_identifier(a, factory));
                self.source_file_links[links].local_jsx_namespace = namespace;
                return namespace;
            }
        }
        b""
    }

    pub fn get_jsx_factory_entity(&mut self, location: NodeId) -> NodeId {
        if !location.is_nil() {
            self.get_jsx_namespace(location);
            let links = self
                .source_file_links
                .get(get_source_file_of_node(self.ast, location));
            let local_jsx_factory = self.source_file_links[links].local_jsx_factory;
            if !local_jsx_factory.is_nil() {
                return local_jsx_factory;
            }
        }
        self.jsx_factory_entity
    }

    pub fn get_jsx_fragment_factory_entity(&mut self, location: NodeId) -> NodeId {
        let a = self.ast;
        let options = self.compiler_options;
        if !location.is_nil() {
            let file = get_source_file_of_node(a, location);
            if !file.is_nil() {
                let links = self.source_file_links.get(file);
                if !self.source_file_links[links]
                    .local_jsx_fragment_factory
                    .is_nil()
                {
                    return self.source_file_links[links].local_jsx_fragment_factory;
                }
                let jsx_frag_pragma = get_pragma_from_source_file(a, file, b"jsxfrag");
                if let Some(jsx_frag_pragma) = jsx_frag_pragma {
                    let factory =
                        self.parse_isolated_entity_name(pragma_factory_argument(jsx_frag_pragma));
                    self.source_file_links[links].local_jsx_fragment_factory = factory;
                    return factory;
                }
            }
        }
        if !options.jsx_fragment_factory.is_empty() {
            return self.parse_isolated_entity_name(&options.jsx_fragment_factory);
        }
        NodeId::NIL
    }
}

// `pragma.Args["factory"].Value`: the empty text for a pragma without the argument.
fn pragma_factory_argument(pragma: &Pragma) -> &[u8] {
    pragma
        .arg(b"factory")
        .map_or(&b""[..], |argument| argument.value.as_slice())
}

// parser.go:282-289, ParseIsolatedEntityName with the part of parseEntityName that it runs: identifier names joined by dots, or nil when the text holds anything else or the scanner reports an error. The rule of parseRightSideOfDot for a name after a line break that another name follows on its line needs no code: more tokens follow, which is already no result.
pub fn parse_isolated_entity_name(a: Ast<'_>, text: &[u8]) -> NodeId {
    // finishNode: the range, the flag of a JavaScript parse and the parent of the immediate children.
    fn finish_node(a: Ast<'_>, node: NodeId, pos: i32, end: i32) {
        a.set_loc(node, new_text_range(pos, end));
        a.set_flags(node, a.flags(node) | NodeFlags::JAVA_SCRIPT_FILE);
        a.for_each_child(node, &mut |child| {
            a.set_parent(child, node);
            false
        });
    }
    let has_error = Cell::new(false);
    let mut scanner = new_scanner();
    scanner.set_text(text);
    scanner.set_on_error(Some(Box::new(
        |_: MessageId, _: i32, _: i32, _: &[Arg<'_>]| has_error.set(true),
    )));
    scanner.set_language_variant(LanguageVariant::JSX);
    let mut factory = Factory::new(a);
    scanner.scan();
    let pos = scanner.token_full_start();
    // parseIdentifierName: every token from Identifier on is a name, anything else is a parse error.
    if scanner.token() < Kind::Identifier {
        return NodeId::NIL;
    }
    let mut entity = factory.new_identifier(scanner.token_value());
    scanner.scan();
    finish_node(a, entity, pos, scanner.token_full_start());
    while scanner.token() == Kind::DotToken {
        scanner.scan();
        if scanner.token() == Kind::LessThanToken {
            // The entity is part of a JSDoc-style generic. We will use the gap between `typeName` and `typeArguments` to report it as a grammar error in the checker.
            break;
        }
        // parseRightSideOfDot: a private identifier is a parse error here, and so is a token that is no name.
        if scanner.token() == Kind::PrivateIdentifier || scanner.token() < Kind::Identifier {
            return NodeId::NIL;
        }
        let right_pos = scanner.token_full_start();
        let right = factory.new_identifier(scanner.token_value());
        scanner.scan();
        finish_node(a, right, right_pos, scanner.token_full_start());
        entity = factory.new_qualified_name(entity, right);
        finish_node(a, entity, pos, scanner.token_full_start());
    }
    if scanner.token() == Kind::EndOfFile && !has_error.get() {
        return entity;
    }
    NodeId::NIL
}

impl<'a> Checker<'a> {
    pub fn parse_isolated_entity_name(&mut self, name: &[u8]) -> NodeId {
        let result = parse_isolated_entity_name(self.ast, name);
        if !result.is_nil() {
            mark_as_synthetic(self.ast, result);
        }
        result
    }
}

pub fn mark_as_synthetic(a: Ast<'_>, node: NodeId) -> bool {
    // Go stacks grow: the walk ends here with an internal diagnostic when the thread has no stack left.
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        a.fault(FaultKind::StackLimit, "stack limit reached", 0, node.0);
        return false;
    }
    a.set_loc(node, new_text_range(-1, -1));
    a.for_each_child(node, &mut |child| mark_as_synthetic(a, child));
    false
}

impl<'a> Checker<'a> {
    pub fn get_jsx_namespace_container_for_implicit_import(
        &mut self,
        location: NodeId,
    ) -> SymbolId {
        // Upstream writes this as a closure that stores the tag in the links of the file.
        fn visit(a: Ast<'_>, node: NodeId, first_jsx_tag_in_file: &mut NodeId) -> bool {
            if is_jsx_element(a, node) || is_jsx_self_closing_element(a, node) {
                *first_jsx_tag_in_file = node;
                return true;
            }
            if is_jsx_fragment(a, node) {
                *first_jsx_tag_in_file = a.as_jsx_fragment(node).opening_fragment; // to match strada, fragments issue errors on the opening fragment instead of the whole tag
                return true;
            }
            // Go stacks grow: the walk ends here with an internal diagnostic when the thread has no stack left.
            if !bun_core::StackCheck::init().is_safe_to_recurse() {
                a.fault(FaultKind::StackLimit, "stack limit reached", 0, node.0);
                return false;
            }
            a.for_each_child(node, &mut |child| visit(a, child, first_jsx_tag_in_file))
        }
        let a = self.ast;
        let file = get_source_file_of_node(a, location);
        let links = self.jsx_element_links.get(file);
        let jsx_implicit_import_container =
            self.jsx_element_links[links].jsx_implicit_import_container;
        if !jsx_implicit_import_container.is_nil() {
            return if jsx_implicit_import_container == self.unknown_symbol {
                SymbolId::NIL
            } else {
                jsx_implicit_import_container
            };
        }
        let mut canonical_error_tag = self.jsx_element_links[links].first_jsx_tag_in_file;
        if canonical_error_tag.is_nil() {
            let mut first_jsx_tag_in_file = NodeId::NIL;
            a.for_each_child(file, &mut |child| {
                visit(a, child, &mut first_jsx_tag_in_file)
            });
            self.jsx_element_links[links].first_jsx_tag_in_file = first_jsx_tag_in_file;
            canonical_error_tag = first_jsx_tag_in_file;
        }
        let (module_reference, specifier) = self.get_jsx_runtime_import_specifier(file);
        if module_reference.is_empty() {
            return SymbolId::NIL;
        }
        let error_message = diagnostics::THIS_JSX_TAG_REQUIRES_THE_MODULE_PATH_0_TO_EXIST_BUT_NONE_COULD_BE_FOUND_MAKE_SURE_YOU_HAVE_TYPES_FOR_THE_APPROPRIATE_PACKAGE_INSTALLED;
        let module = self.resolve_external_module(
            if specifier.is_nil() {
                canonical_error_tag
            } else {
                specifier
            },
            module_reference,
            error_message,
            canonical_error_tag,
            false,
        );
        let mut result = SymbolId::NIL;
        if !module.is_nil() && module != self.unknown_symbol {
            let resolved = self.resolve_symbol(module);
            result = self.get_merged_symbol(resolved);
        }
        self.jsx_element_links[links].jsx_implicit_import_container = if result.is_nil() {
            self.unknown_symbol
        } else {
            result
        };
        result
    }

    pub fn get_jsx_runtime_import_specifier(&self, file: NodeId) -> (Text<'a>, NodeId) {
        self.program.get_jsx_runtime_import_specifier(file)
    }
}
