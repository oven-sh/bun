// Port of the hand-written methods of Node of internal/ast/ast.go: the children, the fields of the binder, the accessors that switch on the kind.
use crate::ast::ast_generated::{Def, FUNCTION_LIKE_BASE_SLOTS, MODIFIERS_SLOT, NAME_SLOT};
use crate::ast::ids::{FlowNodeId, ModifierListId, NodeId, NodeListId, SymbolId, SymbolTableId};
use crate::ast::kind_generated::Kind;
use crate::ast::layout::{
    LATE_END_FLOW_NODE, LATE_FALLTHROUGH_FLOW_NODE, LATE_FLOW_NODE, LATE_LOCAL_SYMBOL, LATE_LOCALS,
    LATE_NEXT_CONTAINER, LATE_RETURN_FLOW_NODE, LATE_SYMBOL,
};
use crate::ast::modifierflags::ModifierFlags;
use crate::ast::reader::{Ast, NO_SLOT, NodeData};
use crate::core::List;
use crate::internal::FaultKind;

// The children of a node in the order of ForEachChild. It holds no borrow of a store.
pub struct Children<'a> {
    a: Ast<'a>,
    data: Option<NodeData<'a>>,
    layout: &'static [u8],
    def: Def,
    next_slot: usize,
    list: &'a [NodeId],
    next_item: usize,
}

impl Iterator for Children<'_> {
    type Item = NodeId;

    fn next(&mut self) -> Option<NodeId> {
        loop {
            if let Some(&node) = self.list.get(self.next_item) {
                self.next_item += 1;
                return Some(node);
            }
            let slot = usize::from(*self.layout.get(self.next_slot)?);
            self.next_slot += 1;
            let value = self.data.as_ref().map_or(0, |data| data.word(slot));
            // visit, visitNodeList and visitModifiers skip a nil member.
            if value == 0 {
                continue;
            }
            let is_list = self
                .def
                .info()
                .slots
                .get(slot)
                .is_some_and(|info| info.ty.is_list());
            if is_list {
                self.list = self.a.nodes(NodeListId(value)).as_slice();
                self.next_item = 0;
            } else {
                return Some(NodeId(value));
            }
        }
    }
}

impl<'a> Ast<'a> {
    // Node.IterChildren: the children of the nil node are none.
    pub fn iter_children(self, node: NodeId) -> Children<'a> {
        let (def, data) = match self.data_any(node) {
            Some((def, data)) => (def, Some(data)),
            None => (Def::None, None),
        };
        let info = def.info();
        // forEachChild_JSDocParameterOrPropertyTag: the name comes before the type when IsNameFirst is set.
        let name_first = !info.children_alt.is_empty()
            && info
                .slot_index(b"IsNameFirst")
                .is_some_and(|index| data.as_ref().is_some_and(|data| data.bool(index)));
        Children {
            a: self,
            data,
            layout: if name_first {
                info.children_alt
            } else {
                info.children
            },
            def,
            next_slot: 0,
            list: &[],
            next_item: 0,
        }
    }

    // Node.ForEachChild: stops at the first child for which the visitor returns true.
    pub fn for_each_child(self, node: NodeId, v: &mut dyn FnMut(NodeId) -> bool) -> bool {
        for child in self.iter_children(node) {
            if v(child) {
                return true;
            }
        }
        false
    }

    // Node.Name
    pub fn name(self, node: NodeId) -> NodeId {
        NodeId(self.slot_by_table(node, &NAME_SLOT))
    }

    // Node.Modifiers
    pub fn modifiers(self, node: NodeId) -> ModifierListId {
        ModifierListId(self.slot_by_table(node, &MODIFIERS_SLOT))
    }

    // `n.FlowNodeData() != nil`
    pub fn has_flow_node_data(self, node: NodeId) -> bool {
        self.has_late(node, LATE_FLOW_NODE)
    }

    // `n.DeclarationData() != nil`
    pub fn has_declaration_data(self, node: NodeId) -> bool {
        self.has_late(node, LATE_SYMBOL)
    }

    // `n.ExportableData() != nil`
    pub fn has_exportable_data(self, node: NodeId) -> bool {
        self.has_late(node, LATE_LOCAL_SYMBOL)
    }

    // `n.LocalsContainerData() != nil`
    pub fn has_locals_container_data(self, node: NodeId) -> bool {
        self.has_late(node, LATE_LOCALS)
    }

    // Node.ParameterList: the nil list for a node without FunctionLikeData.
    pub fn parameter_list(self, node: NodeId) -> NodeListId {
        match self.function_like_data(node) {
            Some(func_like) => func_like.parameters,
            None => NodeListId::NIL,
        }
    }

    // Node.Parameters
    pub fn parameters(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.parameter_list(node))
    }

    // Node.KindString
    pub fn kind_string(self, node: NodeId) -> &'static str {
        self.kind(node).string()
    }

    // Node.KindValue
    pub fn kind_value(self, node: NodeId) -> i16 {
        self.kind(node) as i16
    }

    // Node.Decorators
    pub fn decorators(self, node: NodeId) -> Vec<NodeId> {
        let modifiers = self.modifiers(node);
        if modifiers.is_nil() {
            return Vec::new();
        }
        self.nodes(modifiers.as_node_list())
            .iter()
            .filter(|modifier| self.kind(*modifier) == Kind::Decorator)
            .collect()
    }

    // MutableNode.SetModifiers: a node without modifiers ignores the call, as NodeDefault does.
    pub fn set_modifiers(self, node: NodeId, modifiers: ModifierListId) {
        let def = self.def(node);
        if let Some(slot) = mutable_slot(def, self.kind(node), MutableMember::Modifiers) {
            self.set_slot(node, def, slot, modifiers.0);
        }
    }

    // Node.Symbol
    pub fn symbol(self, node: NodeId) -> SymbolId {
        SymbolId(self.late_value(node, LATE_SYMBOL))
    }

    // `node.DeclarationData().Symbol = symbol`
    pub fn set_symbol(self, node: NodeId, symbol: SymbolId) {
        self.set_late(node, LATE_SYMBOL, symbol.0, "DeclarationData().Symbol");
    }

    // Node.LocalSymbol
    pub fn local_symbol(self, node: NodeId) -> SymbolId {
        SymbolId(self.late_value(node, LATE_LOCAL_SYMBOL))
    }

    // `node.ExportableData().LocalSymbol = symbol`
    pub fn set_local_symbol(self, node: NodeId, symbol: SymbolId) {
        self.set_late(
            node,
            LATE_LOCAL_SYMBOL,
            symbol.0,
            "ExportableData().LocalSymbol",
        );
    }

    // Node.Locals
    pub fn locals(self, node: NodeId) -> SymbolTableId {
        SymbolTableId(self.late_value(node, LATE_LOCALS))
    }

    // `node.LocalsContainerData().Locals = locals`
    pub fn set_locals(self, node: NodeId, locals: SymbolTableId) {
        self.set_late(node, LATE_LOCALS, locals.0, "LocalsContainerData().Locals");
    }

    // `node.LocalsContainerData().NextContainer`
    pub fn next_container(self, node: NodeId) -> NodeId {
        NodeId(self.late_value(node, LATE_NEXT_CONTAINER))
    }

    // `node.LocalsContainerData().NextContainer = next`
    pub fn set_next_container(self, node: NodeId, next: NodeId) {
        let who = "LocalsContainerData().NextContainer";
        self.set_late(node, LATE_NEXT_CONTAINER, next.0, who);
    }

    // `node.FlowNodeData().FlowNode`
    pub fn flow_node(self, node: NodeId) -> FlowNodeId {
        FlowNodeId(self.late_value(node, LATE_FLOW_NODE))
    }

    // `node.FlowNodeData().FlowNode = flow`
    pub fn set_flow_node(self, node: NodeId, flow: FlowNodeId) {
        self.set_late(node, LATE_FLOW_NODE, flow.0, "FlowNodeData().FlowNode");
    }

    // `node.BodyData().EndFlowNode`
    pub fn end_flow_node(self, node: NodeId) -> FlowNodeId {
        FlowNodeId(self.late_value(node, LATE_END_FLOW_NODE))
    }

    // `node.BodyData().EndFlowNode = flow`
    pub fn set_end_flow_node(self, node: NodeId, flow: FlowNodeId) {
        self.set_late(node, LATE_END_FLOW_NODE, flow.0, "BodyData().EndFlowNode");
    }

    // ReturnFlowNode of a function declaration, function expression, constructor or class static block.
    pub fn return_flow_node(self, node: NodeId) -> FlowNodeId {
        FlowNodeId(self.late_value(node, LATE_RETURN_FLOW_NODE))
    }

    pub fn set_return_flow_node(self, node: NodeId, flow: FlowNodeId) {
        self.set_late(node, LATE_RETURN_FLOW_NODE, flow.0, "ReturnFlowNode");
    }

    // `node.AsCaseOrDefaultClause().FallthroughFlowNode`
    pub fn fallthrough_flow_node(self, node: NodeId) -> FlowNodeId {
        FlowNodeId(self.late_value(node, LATE_FALLTHROUGH_FLOW_NODE))
    }

    pub fn set_fallthrough_flow_node(self, node: NodeId, flow: FlowNodeId) {
        let who = "FallthroughFlowNode";
        self.set_late(node, LATE_FALLTHROUGH_FLOW_NODE, flow.0, who);
    }

    // Node.Body
    pub fn body(self, node: NodeId) -> NodeId {
        match self.body_data(node) {
            Some(data) => data.body,
            None => NodeId::NIL,
        }
    }

    // The text of a JsxNamespacedName: upstream joins the two names with a colon at every call.
    fn jsx_namespaced_name_text(self, node: NodeId) -> &'a [u8] {
        let n = self.as_jsx_namespaced_name(node);
        let text = [self.text(n.namespace), b":".as_slice(), self.text(n.name)].concat();
        self.open.arena.alloc_slice_copy(&text)
    }

    // Node.Text
    pub fn text(self, node: NodeId) -> &'a [u8] {
        match self.kind(node) {
            Kind::Identifier => self.as_identifier(node).text,
            Kind::PrivateIdentifier => self.as_private_identifier(node).text,
            Kind::StringLiteral => self.as_string_literal(node).text,
            Kind::NumericLiteral => self.as_numeric_literal(node).text,
            Kind::BigIntLiteral => self.as_big_int_literal(node).text,
            Kind::MetaProperty => self.text(self.name(node)),
            Kind::NoSubstitutionTemplateLiteral => {
                self.as_no_substitution_template_literal(node).text
            }
            Kind::TemplateHead => self.as_template_head(node).text,
            Kind::TemplateMiddle => self.as_template_middle(node).text,
            Kind::TemplateTail => self.as_template_tail(node).text,
            Kind::JsxNamespacedName => self.jsx_namespaced_name_text(node),
            Kind::RegularExpressionLiteral => self.as_regular_expression_literal(node).text,
            Kind::JSDocText => self.as_jsdoc_text(node).text,
            Kind::JSDocLink => self.as_jsdoc_link(node).text,
            Kind::JSDocLinkCode => self.as_jsdoc_link_code(node).text,
            Kind::JSDocLinkPlain => self.as_jsdoc_link_plain(node).text,
            _ => self.unhandled("Unhandled case in Node.Text", node),
        }
    }

    // Node.Expression
    pub fn expression(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::PropertyAccessExpression => self.as_property_access_expression(node).expression,
            Kind::ElementAccessExpression => self.as_element_access_expression(node).expression,
            Kind::ParenthesizedExpression => self.as_parenthesized_expression(node).expression,
            Kind::CallExpression => self.as_call_expression(node).expression,
            Kind::NewExpression => self.as_new_expression(node).expression,
            Kind::ExpressionWithTypeArguments => {
                self.as_expression_with_type_arguments(node).expression
            }
            Kind::ComputedPropertyName => self.as_computed_property_name(node).expression,
            Kind::NonNullExpression => self.as_non_null_expression(node).expression,
            Kind::TypeAssertionExpression => self.as_type_assertion(node).expression,
            Kind::AsExpression => self.as_as_expression(node).expression,
            Kind::SatisfiesExpression => self.as_satisfies_expression(node).expression,
            Kind::TypeOfExpression => self.as_type_of_expression(node).expression,
            Kind::SpreadAssignment => self.as_spread_assignment(node).expression,
            Kind::SpreadElement => self.as_spread_element(node).expression,
            Kind::TemplateSpan => self.as_template_span(node).expression,
            Kind::DeleteExpression => self.as_delete_expression(node).expression,
            Kind::VoidExpression => self.as_void_expression(node).expression,
            Kind::AwaitExpression => self.as_await_expression(node).expression,
            Kind::YieldExpression => self.as_yield_expression(node).expression,
            Kind::PartiallyEmittedExpression => {
                self.as_partially_emitted_expression(node).expression
            }
            Kind::IfStatement => self.as_if_statement(node).expression,
            Kind::DoStatement => self.as_do_statement(node).expression,
            Kind::WhileStatement => self.as_while_statement(node).expression,
            Kind::WithStatement => self.as_with_statement(node).expression,
            Kind::ForInStatement | Kind::ForOfStatement => {
                self.as_for_in_or_of_statement(node).expression
            }
            Kind::SwitchStatement => self.as_switch_statement(node).expression,
            Kind::CaseClause => self.as_case_or_default_clause(node).expression,
            Kind::ExpressionStatement => self.as_expression_statement(node).expression,
            Kind::ReturnStatement => self.as_return_statement(node).expression,
            Kind::ThrowStatement => self.as_throw_statement(node).expression,
            Kind::ExternalModuleReference => self.as_external_module_reference(node).expression,
            Kind::ExportAssignment => self.as_export_assignment(node).expression,
            Kind::Decorator => self.as_decorator(node).expression,
            Kind::JsxExpression => self.as_jsx_expression(node).expression,
            Kind::JsxSpreadAttribute => self.as_jsx_spread_attribute(node).expression,
            _ => self.unhandled("Unhandled case in Node.Expression", node),
        }
    }

    // Node.RawText
    pub fn raw_text(self, node: NodeId) -> &'a [u8] {
        match self.kind(node) {
            Kind::TemplateHead => self.as_template_head(node).raw_text,
            Kind::TemplateMiddle => self.as_template_middle(node).raw_text,
            Kind::TemplateTail => self.as_template_tail(node).raw_text,
            _ => self.unhandled("Unhandled case in Node.RawText", node),
        }
    }

    // Node.ArgumentList
    pub fn argument_list(self, node: NodeId) -> NodeListId {
        match self.kind(node) {
            Kind::CallExpression => self.as_call_expression(node).arguments,
            Kind::NewExpression => self.as_new_expression(node).arguments,
            _ => self.unhandled("Unhandled case in Node.Arguments", node),
        }
    }

    // Node.Arguments
    pub fn arguments(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.argument_list(node))
    }

    // Node.TypeArgumentList
    pub fn type_argument_list(self, node: NodeId) -> NodeListId {
        match self.kind(node) {
            Kind::CallExpression => self.as_call_expression(node).type_arguments,
            Kind::NewExpression => self.as_new_expression(node).type_arguments,
            Kind::TaggedTemplateExpression => {
                self.as_tagged_template_expression(node).type_arguments
            }
            Kind::TypeReference => self.as_type_reference_node(node).type_arguments,
            Kind::ExpressionWithTypeArguments => {
                self.as_expression_with_type_arguments(node).type_arguments
            }
            Kind::ImportType => self.as_import_type_node(node).type_arguments,
            Kind::TypeQuery => self.as_type_query_node(node).type_arguments,
            Kind::JsxOpeningElement => self.as_jsx_opening_element(node).type_arguments,
            Kind::JsxSelfClosingElement => self.as_jsx_self_closing_element(node).type_arguments,
            _ => self.unhandled("Unhandled case in Node.TypeArguments", node),
        }
    }

    // Node.TypeArguments
    pub fn type_arguments(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.type_argument_list(node))
    }

    // Node.TypeParameterList
    pub fn type_parameter_list(self, node: NodeId) -> NodeListId {
        match self.kind(node) {
            Kind::ClassDeclaration => self.as_class_declaration(node).type_parameters,
            Kind::ClassExpression => self.as_class_expression(node).type_parameters,
            Kind::InterfaceDeclaration => self.as_interface_declaration(node).type_parameters,
            Kind::TypeAliasDeclaration | Kind::JSTypeAliasDeclaration => {
                self.as_type_alias_declaration(node).type_parameters
            }
            Kind::JSDocTemplateTag => self.as_jsdoc_template_tag(node).type_parameters,
            _ => match self.function_like_data(node) {
                Some(func_like) => func_like.type_parameters,
                None => self.unhandled("Unhandled case in Node.TypeParameterList", node),
            },
        }
    }

    // Node.TypeParameters
    pub fn type_parameters(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.type_parameter_list(node))
    }

    // Node.MemberList
    pub fn member_list(self, node: NodeId) -> NodeListId {
        match self.kind(node) {
            Kind::ClassDeclaration => self.as_class_declaration(node).members,
            Kind::ClassExpression => self.as_class_expression(node).members,
            Kind::InterfaceDeclaration => self.as_interface_declaration(node).members,
            Kind::EnumDeclaration => self.as_enum_declaration(node).members,
            Kind::TypeLiteral => self.as_type_literal_node(node).members,
            Kind::MappedType => self.as_mapped_type_node(node).members,
            _ => self.unhandled("Unhandled case in Node.MemberList", node),
        }
    }

    // Node.Members
    pub fn members(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.member_list(node))
    }

    // Node.StatementList
    pub fn statement_list(self, node: NodeId) -> NodeListId {
        match self.kind(node) {
            Kind::SourceFile => self.as_source_file(node).statements,
            Kind::Block => self.as_block(node).statements,
            Kind::ModuleBlock => self.as_module_block(node).statements,
            Kind::CaseClause | Kind::DefaultClause => {
                self.as_case_or_default_clause(node).statements
            }
            _ => self.unhandled("Unhandled case in Node.StatementList", node),
        }
    }

    // Node.Statements
    pub fn statements(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.statement_list(node))
    }

    // Node.CanHaveStatements
    pub fn can_have_statements(self, node: NodeId) -> bool {
        matches!(
            self.kind(node),
            Kind::SourceFile
                | Kind::Block
                | Kind::ModuleBlock
                | Kind::CaseClause
                | Kind::DefaultClause
        )
    }

    // Node.Type
    pub fn type_node(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::VariableDeclaration => self.as_variable_declaration(node).type_node,
            Kind::Parameter => self.as_parameter_declaration(node).type_node,
            Kind::PropertySignature => self.as_property_signature_declaration(node).type_node,
            Kind::PropertyDeclaration => self.as_property_declaration(node).type_node,
            Kind::PropertyAssignment => self.as_property_assignment(node).type_node,
            Kind::ShorthandPropertyAssignment => {
                self.as_shorthand_property_assignment(node).type_node
            }
            Kind::TypePredicate => self.as_type_predicate_node(node).type_node,
            Kind::ParenthesizedType => self.as_parenthesized_type_node(node).type_node,
            Kind::TypeOperator => self.as_type_operator_node(node).type_node,
            Kind::MappedType => self.as_mapped_type_node(node).type_node,
            Kind::TypeAssertionExpression => self.as_type_assertion(node).type_node,
            Kind::AsExpression => self.as_as_expression(node).type_node,
            Kind::SatisfiesExpression => self.as_satisfies_expression(node).type_node,
            Kind::TypeAliasDeclaration | Kind::JSTypeAliasDeclaration => {
                self.as_type_alias_declaration(node).type_node
            }
            Kind::NamedTupleMember => self.as_named_tuple_member(node).type_node,
            Kind::OptionalType => self.as_optional_type_node(node).type_node,
            Kind::RestType => self.as_rest_type_node(node).type_node,
            Kind::TemplateLiteralTypeSpan => self.as_template_literal_type_span(node).type_node,
            Kind::JSDocTypeExpression => self.as_jsdoc_type_expression(node).type_node,
            Kind::JSDocParameterTag | Kind::JSDocPropertyTag => {
                self.as_jsdoc_parameter_or_property_tag(node)
                    .type_expression
            }
            Kind::JSDocNullableType => self.as_jsdoc_nullable_type(node).type_node,
            Kind::JSDocNonNullableType => self.as_jsdoc_non_nullable_type(node).type_node,
            Kind::JSDocOptionalType => self.as_jsdoc_optional_type(node).type_node,
            Kind::ExportAssignment => self.as_export_assignment(node).type_node,
            Kind::BinaryExpression => self.as_binary_expression(node).type_node,
            _ => match self.function_like_data(node) {
                Some(func_like) => func_like.type_node,
                None => NodeId::NIL,
            },
        }
    }

    // Node.Initializer
    pub fn initializer(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::VariableDeclaration => self.as_variable_declaration(node).initializer,
            Kind::Parameter => self.as_parameter_declaration(node).initializer,
            Kind::BindingElement => self.as_binding_element(node).initializer,
            Kind::PropertyDeclaration => self.as_property_declaration(node).initializer,
            Kind::PropertySignature => self.as_property_signature_declaration(node).initializer,
            Kind::PropertyAssignment => self.as_property_assignment(node).initializer,
            Kind::EnumMember => self.as_enum_member(node).initializer,
            Kind::ForStatement => self.as_for_statement(node).initializer,
            Kind::ForInStatement | Kind::ForOfStatement => {
                self.as_for_in_or_of_statement(node).initializer
            }
            Kind::JsxAttribute => self.as_jsx_attribute(node).initializer,
            _ => self.unhandled("Unhandled case in Node.Initializer", node),
        }
    }

    // Node.TagName
    pub fn tag_name(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::JsxOpeningElement => self.as_jsx_opening_element(node).tag_name,
            Kind::JsxClosingElement => self.as_jsx_closing_element(node).tag_name,
            Kind::JsxSelfClosingElement => self.as_jsx_self_closing_element(node).tag_name,
            Kind::JSDocUnknownTag => self.as_jsdoc_unknown_tag(node).tag_name,
            Kind::JSDocAugmentsTag => self.as_jsdoc_augments_tag(node).tag_name,
            Kind::JSDocImplementsTag => self.as_jsdoc_implements_tag(node).tag_name,
            Kind::JSDocDeprecatedTag => self.as_jsdoc_deprecated_tag(node).tag_name,
            Kind::JSDocPublicTag => self.as_jsdoc_public_tag(node).tag_name,
            Kind::JSDocPrivateTag => self.as_jsdoc_private_tag(node).tag_name,
            Kind::JSDocProtectedTag => self.as_jsdoc_protected_tag(node).tag_name,
            Kind::JSDocReadonlyTag => self.as_jsdoc_readonly_tag(node).tag_name,
            Kind::JSDocOverrideTag => self.as_jsdoc_override_tag(node).tag_name,
            Kind::JSDocCallbackTag => self.as_jsdoc_callback_tag(node).tag_name,
            Kind::JSDocOverloadTag => self.as_jsdoc_overload_tag(node).tag_name,
            Kind::JSDocParameterTag | Kind::JSDocPropertyTag => {
                self.as_jsdoc_parameter_or_property_tag(node).tag_name
            }
            Kind::JSDocReturnTag => self.as_jsdoc_return_tag(node).tag_name,
            Kind::JSDocThisTag => self.as_jsdoc_this_tag(node).tag_name,
            Kind::JSDocTypeTag => self.as_jsdoc_type_tag(node).tag_name,
            Kind::JSDocTemplateTag => self.as_jsdoc_template_tag(node).tag_name,
            Kind::JSDocTypedefTag => self.as_jsdoc_typedef_tag(node).tag_name,
            Kind::JSDocSeeTag => self.as_jsdoc_see_tag(node).tag_name,
            Kind::JSDocSatisfiesTag => self.as_jsdoc_satisfies_tag(node).tag_name,
            Kind::JSDocThrowsTag => self.as_jsdoc_throws_tag(node).tag_name,
            Kind::JSDocImportTag => self.as_jsdoc_import_tag(node).tag_name,
            _ => self.unhandled("Unhandled case in Node.TagName", node),
        }
    }

    // Node.PropertyName
    pub fn property_name(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::ImportSpecifier => self.as_import_specifier(node).property_name,
            Kind::ExportSpecifier => self.as_export_specifier(node).property_name,
            Kind::BindingElement => self.as_binding_element(node).property_name,
            _ => NodeId::NIL,
        }
    }

    // Node.IsTypeOnly
    pub fn is_type_only(self, node: NodeId) -> bool {
        match self.kind(node) {
            Kind::ImportEqualsDeclaration => self.as_import_equals_declaration(node).is_type_only,
            Kind::ImportSpecifier => self.as_import_specifier(node).is_type_only,
            Kind::ImportClause => self.as_import_clause(node).phase_modifier == Kind::TypeKeyword,
            Kind::ExportDeclaration => self.as_export_declaration(node).is_type_only,
            Kind::ExportSpecifier => self.as_export_specifier(node).is_type_only,
            _ => false,
        }
    }

    // Node.CommentList
    pub fn comment_list(self, node: NodeId) -> NodeListId {
        match self.kind(node) {
            Kind::JSDoc => self.as_jsdoc(node).comment,
            Kind::JSDocUnknownTag => self.as_jsdoc_unknown_tag(node).comment,
            Kind::JSDocAugmentsTag => self.as_jsdoc_augments_tag(node).comment,
            Kind::JSDocImplementsTag => self.as_jsdoc_implements_tag(node).comment,
            Kind::JSDocDeprecatedTag => self.as_jsdoc_deprecated_tag(node).comment,
            Kind::JSDocPublicTag => self.as_jsdoc_public_tag(node).comment,
            Kind::JSDocPrivateTag => self.as_jsdoc_private_tag(node).comment,
            Kind::JSDocProtectedTag => self.as_jsdoc_protected_tag(node).comment,
            Kind::JSDocReadonlyTag => self.as_jsdoc_readonly_tag(node).comment,
            Kind::JSDocOverrideTag => self.as_jsdoc_override_tag(node).comment,
            Kind::JSDocCallbackTag => self.as_jsdoc_callback_tag(node).comment,
            Kind::JSDocOverloadTag => self.as_jsdoc_overload_tag(node).comment,
            Kind::JSDocParameterTag | Kind::JSDocPropertyTag => {
                self.as_jsdoc_parameter_or_property_tag(node).comment
            }
            Kind::JSDocReturnTag => self.as_jsdoc_return_tag(node).comment,
            Kind::JSDocThisTag => self.as_jsdoc_this_tag(node).comment,
            Kind::JSDocTypeTag => self.as_jsdoc_type_tag(node).comment,
            Kind::JSDocTemplateTag => self.as_jsdoc_template_tag(node).comment,
            Kind::JSDocTypedefTag => self.as_jsdoc_typedef_tag(node).comment,
            Kind::JSDocSeeTag => self.as_jsdoc_see_tag(node).comment,
            Kind::JSDocSatisfiesTag => self.as_jsdoc_satisfies_tag(node).comment,
            Kind::JSDocThrowsTag => self.as_jsdoc_throws_tag(node).comment,
            Kind::JSDocImportTag => self.as_jsdoc_import_tag(node).comment,
            _ => self.unhandled("Unhandled case in Node.CommentList", node),
        }
    }

    // Node.Comments
    pub fn comments(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.comment_list(node))
    }

    // Node.Label
    pub fn label(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::LabeledStatement => self.as_labeled_statement(node).label,
            Kind::BreakStatement => self.as_break_statement(node).label,
            Kind::ContinueStatement => self.as_continue_statement(node).label,
            _ => self.unhandled("Unhandled case in Node.Label", node),
        }
    }

    // Node.Attributes
    pub fn attributes(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::JsxOpeningElement => self.as_jsx_opening_element(node).attributes,
            Kind::JsxSelfClosingElement => self.as_jsx_self_closing_element(node).attributes,
            _ => self.unhandled("Unhandled case in Node.Attributes", node),
        }
    }

    // Node.Children
    pub fn children(self, node: NodeId) -> NodeListId {
        match self.kind(node) {
            Kind::JsxElement => self.as_jsx_element(node).children,
            Kind::JsxFragment => self.as_jsx_fragment(node).children,
            _ => self.unhandled("Unhandled case in Node.Children", node),
        }
    }

    // Node.ModuleSpecifier
    pub fn module_specifier(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::ImportDeclaration | Kind::JSImportDeclaration => {
                self.as_import_declaration(node).module_specifier
            }
            Kind::ExportDeclaration => self.as_export_declaration(node).module_specifier,
            Kind::JSDocImportTag => self.as_jsdoc_import_tag(node).module_specifier,
            _ => self.unhandled("Unhandled case in Node.ModuleSpecifier", node),
        }
    }

    // Node.ImportClause
    pub fn import_clause(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::ImportDeclaration | Kind::JSImportDeclaration => {
                self.as_import_declaration(node).import_clause
            }
            Kind::JSDocImportTag => self.as_jsdoc_import_tag(node).import_clause,
            _ => self.unhandled("Unhandled case in Node.ImportClause", node),
        }
    }

    // Node.Statement
    pub fn statement(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::DoStatement => self.as_do_statement(node).statement,
            Kind::WhileStatement => self.as_while_statement(node).statement,
            Kind::ForStatement => self.as_for_statement(node).statement,
            Kind::ForInStatement | Kind::ForOfStatement => {
                self.as_for_in_or_of_statement(node).statement
            }
            Kind::WithStatement => self.as_with_statement(node).statement,
            Kind::LabeledStatement => self.as_labeled_statement(node).statement,
            _ => self.unhandled("Unhandled case in Node.Statement", node),
        }
    }

    // Node.PropertyList
    pub fn property_list(self, node: NodeId) -> NodeListId {
        match self.kind(node) {
            Kind::ObjectLiteralExpression => self.as_object_literal_expression(node).properties,
            Kind::JsxAttributes => self.as_jsx_attributes(node).properties,
            _ => self.unhandled("Unhandled case in Node.PropertyList", node),
        }
    }

    // Node.Properties
    pub fn properties(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.property_list(node))
    }

    // Node.ElementList
    pub fn element_list(self, node: NodeId) -> NodeListId {
        match self.kind(node) {
            Kind::NamedImports => self.as_named_imports(node).elements,
            Kind::NamedExports => self.as_named_exports(node).elements,
            Kind::ObjectBindingPattern | Kind::ArrayBindingPattern => {
                self.as_binding_pattern(node).elements
            }
            Kind::ArrayLiteralExpression => self.as_array_literal_expression(node).elements,
            Kind::TupleType => self.as_tuple_type_node(node).elements,
            _ => self.unhandled("Unhandled case in Node.ElementList", node),
        }
    }

    // Node.Elements
    pub fn elements(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.element_list(node))
    }

    // Node.PostfixToken
    pub fn postfix_token(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::MethodDeclaration => self.as_method_declaration(node).postfix_token,
            Kind::ShorthandPropertyAssignment => {
                self.as_shorthand_property_assignment(node).postfix_token
            }
            Kind::MethodSignature => self.as_method_signature_declaration(node).postfix_token,
            Kind::PropertySignature => self.as_property_signature_declaration(node).postfix_token,
            Kind::PropertyAssignment => self.as_property_assignment(node).postfix_token,
            Kind::PropertyDeclaration => self.as_property_declaration(node).postfix_token,
            Kind::EnumMember => self.as_enum_member(node).postfix_token,
            Kind::GetAccessor => self.as_get_accessor_declaration(node).postfix_token,
            Kind::SetAccessor => self.as_set_accessor_declaration(node).postfix_token,
            _ => NodeId::NIL,
        }
    }

    // Node.QuestionToken
    pub fn question_token(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::Parameter => self.as_parameter_declaration(node).question_token,
            Kind::ConditionalExpression => self.as_conditional_expression(node).question_token,
            Kind::MappedType => self.as_mapped_type_node(node).question_token,
            Kind::NamedTupleMember => self.as_named_tuple_member(node).question_token,
            _ => {
                let postfix = self.postfix_token(node);
                if !postfix.is_nil() && self.kind(postfix) == Kind::QuestionToken {
                    return postfix;
                }
                NodeId::NIL
            }
        }
    }

    // Node.QuestionDotToken
    pub fn question_dot_token(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::ElementAccessExpression => {
                self.as_element_access_expression(node).question_dot_token
            }
            Kind::PropertyAccessExpression => {
                self.as_property_access_expression(node).question_dot_token
            }
            Kind::CallExpression => self.as_call_expression(node).question_dot_token,
            Kind::TaggedTemplateExpression => {
                self.as_tagged_template_expression(node).question_dot_token
            }
            _ => self.unhandled("Unhandled case in Node.QuestionDotToken", node),
        }
    }

    // Node.TypeExpression
    pub fn type_expression(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::JSDocParameterTag | Kind::JSDocPropertyTag => {
                self.as_jsdoc_parameter_or_property_tag(node)
                    .type_expression
            }
            Kind::JSDocReturnTag => self.as_jsdoc_return_tag(node).type_expression,
            Kind::JSDocTypeTag => self.as_jsdoc_type_tag(node).type_expression,
            Kind::JSDocTypedefTag => self.as_jsdoc_typedef_tag(node).type_expression,
            Kind::JSDocCallbackTag => self.as_jsdoc_callback_tag(node).type_expression,
            Kind::JSDocSatisfiesTag => self.as_jsdoc_satisfies_tag(node).type_expression,
            Kind::JSDocThrowsTag => self.as_jsdoc_throws_tag(node).type_expression,
            _ => self.unhandled("Unhandled case in Node.TypeExpression", node),
        }
    }

    // Node.ClassName
    pub fn class_name(self, node: NodeId) -> NodeId {
        match self.kind(node) {
            Kind::JSDocAugmentsTag => self.as_jsdoc_augments_tag(node).class_name,
            Kind::JSDocImplementsTag => self.as_jsdoc_implements_tag(node).class_name,
            _ => self.unhandled("Unhandled case in Node.ClassName", node),
        }
    }

    // MutableNode.SetExpression
    pub fn set_expression(self, node: NodeId, expr: NodeId) {
        let def = self.def(node);
        match mutable_slot(def, self.kind(node), MutableMember::Expression) {
            Some(slot) => self.set_slot(node, def, slot, expr.0),
            None => self.unhandled("Unhandled case in mutableNode.SetExpression", node),
        }
    }

    // MutableNode.SetType
    pub fn set_type_node(self, node: NodeId, t: NodeId) {
        let def = self.def(node);
        match mutable_slot(def, self.kind(node), MutableMember::Type) {
            Some(slot) => self.set_slot(node, def, slot, t.0),
            None => self.unhandled("Unhandled case in mutableNode.SetType", node),
        }
    }

    // MutableNode.SetInitializer
    pub fn set_initializer(self, node: NodeId, initializer: NodeId) {
        let def = self.def(node);
        match mutable_slot(def, self.kind(node), MutableMember::Initializer) {
            Some(slot) => self.set_slot(node, def, slot, initializer.0),
            None => self.unhandled("Unhandled case in mutableNode.SetInitializer", node),
        }
    }

    // Node.ModifierFlags
    pub fn modifier_flags(self, node: NodeId) -> ModifierFlags {
        let modifiers = self.modifiers(node);
        if !modifiers.is_nil() {
            return self.modifier_list_flags(modifiers);
        }
        ModifierFlags::NONE
    }

    // Node.ModifierNodes
    pub fn modifier_nodes(self, node: NodeId) -> List<'a, NodeId> {
        self.nodes(self.modifiers(node).as_node_list())
    }

    // Node.PropertyNameOrName
    pub fn property_name_or_name(self, node: NodeId) -> NodeId {
        let mut name = self.property_name(node);
        if name.is_nil() {
            name = self.name(node);
        }
        name
    }

    // Determines if `node` contains `descendant` by walking up the `Parent` pointers from `descendant`.
    pub fn contains(self, node: NodeId, descendant: NodeId) -> bool {
        let mut descendant = descendant;
        while !descendant.is_nil() {
            if descendant == node {
                return true;
            }
            let parent = self.parent(descendant);
            if parent.is_nil() && self.kind(descendant) != Kind::SourceFile {
                self.fault(
                    FaultKind::Panic,
                    "descendant is not parented",
                    0,
                    descendant.0,
                );
                return false;
            }
            descendant = parent;
        }
        false
    }
}

// The members that the setters of MutableNode write.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum MutableMember {
    Expression,
    Type,
    Initializer,
    Modifiers,
}

// The slot that a setter of MutableNode writes in a node of `def` and `kind`: None for a kind outside the switch of the setter.
pub(crate) fn mutable_slot(def: Def, kind: Kind, member: MutableMember) -> Option<u8> {
    let named = |name: &[u8]| def.info().slot_index(name).map(|index| index as u8);
    let by_table = |table: &[u8]| {
        table
            .get(def as usize)
            .copied()
            .filter(|slot| *slot != NO_SLOT)
    };
    match member {
        MutableMember::Expression => match kind {
            Kind::PropertyAccessExpression
            | Kind::ElementAccessExpression
            | Kind::ParenthesizedExpression
            | Kind::CallExpression
            | Kind::NewExpression
            | Kind::ExpressionWithTypeArguments
            | Kind::ComputedPropertyName
            | Kind::NonNullExpression
            | Kind::TypeAssertionExpression
            | Kind::AsExpression
            | Kind::SatisfiesExpression
            | Kind::TypeOfExpression
            | Kind::SpreadAssignment
            | Kind::SpreadElement
            | Kind::TemplateSpan
            | Kind::DeleteExpression
            | Kind::VoidExpression
            | Kind::AwaitExpression
            | Kind::YieldExpression
            | Kind::PartiallyEmittedExpression
            | Kind::IfStatement
            | Kind::DoStatement
            | Kind::WhileStatement
            | Kind::WithStatement
            | Kind::ForInStatement
            | Kind::ForOfStatement
            | Kind::SwitchStatement
            | Kind::CaseClause
            | Kind::ExpressionStatement
            | Kind::ReturnStatement
            | Kind::ThrowStatement
            | Kind::ExternalModuleReference
            | Kind::ExportAssignment
            | Kind::Decorator
            | Kind::JsxExpression
            | Kind::JsxSpreadAttribute => named(b"Expression"),
            _ => None,
        },
        MutableMember::Type => match kind {
            Kind::VariableDeclaration
            | Kind::Parameter
            | Kind::PropertySignature
            | Kind::PropertyDeclaration
            | Kind::PropertyAssignment
            | Kind::ShorthandPropertyAssignment
            | Kind::TypePredicate
            | Kind::ParenthesizedType
            | Kind::TypeOperator
            | Kind::MappedType
            | Kind::TypeAssertionExpression
            | Kind::AsExpression
            | Kind::SatisfiesExpression
            | Kind::TypeAliasDeclaration
            | Kind::JSTypeAliasDeclaration
            | Kind::NamedTupleMember
            | Kind::OptionalType
            | Kind::RestType
            | Kind::TemplateLiteralTypeSpan
            | Kind::JSDocTypeExpression
            | Kind::JSDocNullableType
            | Kind::JSDocNonNullableType
            | Kind::JSDocOptionalType
            | Kind::ExportAssignment
            | Kind::BinaryExpression => named(b"Type"),
            Kind::JSDocParameterTag | Kind::JSDocPropertyTag => named(b"TypeExpression"),
            // A node that has FunctionLikeData.
            _ => FUNCTION_LIKE_BASE_SLOTS
                .get(def as usize)
                .map(|row| row[2])
                .filter(|slot| *slot != NO_SLOT),
        },
        MutableMember::Initializer => match kind {
            Kind::VariableDeclaration
            | Kind::Parameter
            | Kind::BindingElement
            | Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::PropertyAssignment
            | Kind::EnumMember
            | Kind::ForStatement
            | Kind::ForInStatement
            | Kind::ForOfStatement
            | Kind::JsxAttribute => named(b"Initializer"),
            _ => None,
        },
        MutableMember::Modifiers => by_table(&MODIFIERS_SLOT),
    }
}
