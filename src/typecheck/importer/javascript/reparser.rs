// Port of internal/parser/reparser.go as a pass over the tree of a producer, with the parts of parser.go and jsdoc.go that call it: the hosts are visited in the order in which upstream's parser finishes them.
use super::ParseDiagnostic;
use super::tree::{
    ChildMember, bool_member, children, deep_clone_reparse, deep_clone_reparse_modifiers,
    expression, full_signature, get_assignment_declaration_kind,
    get_right_most_assigned_expression, has_same_property_access_name, initializer,
    is_this_identifier, kind_member, list_member, members_in_source_order, modifier_nodes,
    modifiers, name, node_member, node_position_is_less, parameter_list, replace_list_nodes,
    set_list_member, set_node_member, slices::sort_func, stack_limit, tag_name, text,
    type_expression, type_node, type_parameter_list, unhandled,
};
use crate::ast::{
    FileBuilder, JSDeclarationKind, Kind, ModifierListId, NodeFactory, NodeFlags, NodeId,
    NodeListId, NodeSink, TokenFlags, is_function_like_kind,
};
use crate::core::{TextRange, new_text_range};
use crate::diagnostics::{self, MessageId};
use crate::scanner::{is_identifier_part, is_identifier_start, is_valid_identifier};
use crate::stringutil::util::utf8;

// The parsing contexts of the lists that parseList reads: parseListIndex gives each of them the nodes that the tags of its elements made.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ParsingContext {
    SourceElements,
    BlockStatements,
    SwitchClauses,
    SwitchClauseStatements,
    TypeMembers,
    ClassMembers,
    HeritageClauses,
    JsxAttributes,
}

// The parsing context of a list member that parseList reads, None for a member that another function reads.
fn parsing_context_of(owner: Kind, member: &str) -> Option<ParsingContext> {
    match (owner, member) {
        (Kind::SourceFile, "Statements") => Some(ParsingContext::SourceElements),
        (Kind::Block | Kind::ModuleBlock, "Statements") => Some(ParsingContext::BlockStatements),
        (Kind::CaseBlock, "Clauses") => Some(ParsingContext::SwitchClauses),
        (Kind::CaseClause | Kind::DefaultClause, "Statements") => {
            Some(ParsingContext::SwitchClauseStatements)
        }
        (Kind::ClassDeclaration | Kind::ClassExpression, "Members") => {
            Some(ParsingContext::ClassMembers)
        }
        (
            Kind::ClassDeclaration | Kind::ClassExpression | Kind::InterfaceDeclaration,
            "HeritageClauses",
        ) => Some(ParsingContext::HeritageClauses),
        (Kind::InterfaceDeclaration | Kind::TypeLiteral | Kind::MappedType, "Members") => {
            Some(ParsingContext::TypeMembers)
        }
        (Kind::JsxAttributes, "Properties") => Some(ParsingContext::JsxAttributes),
        _ => None,
    }
}

// What parseListIndex keeps while it reads one list.
struct ListFrame {
    owner: NodeId,
    member: &'static str,
    list: NodeListId,
    kind: ParsingContext,
    nodes: Vec<NodeId>,
    // True when a reparsed node is among the nodes.
    changed: bool,
    outer_reparse_list: Vec<NodeId>,
}

enum Step {
    Enter(NodeId),
    Leave(NodeId),
    ListStart(NodeId, ChildMember, ParsingContext),
    ElementEnd(NodeId),
    ListEnd,
}

// What the reparse of a file leaves beside the tree.
pub struct Reparsed {
    // SourceFile.ReparsedClones: the copies of JSDoc nodes that the tree holds, sorted by their ranges.
    pub reparsed_clones: Vec<NodeId>,
    // The diagnostics of checkNonIdentifierName, in the order of the hosts.
    pub diagnostics: Vec<ParseDiagnostic>,
}

pub(crate) struct Reparser<'b> {
    b: &'b mut FileBuilder,
    // Parser.contextFlags when the host was finished.
    context_flags: NodeFlags,
    // Parser.reparseList
    reparse_list: Vec<NodeId>,
    // Parser.reparsedClones
    reparsed_clones: Vec<NodeId>,
    // Parser.hasParseError, as far as the reparser sets it.
    has_parse_error: bool,
    // The number of object literals around the host: not zero where parsingContexts has PCObjectLiteralMembers.
    in_object_literal: u32,
    diagnostics: Vec<ParseDiagnostic>,
    // The list of JSDoc nodes of a node of the builder, by the index of the node.
    jsdoc_of: Vec<NodeListId>,
    stack_check: bun_core::StackCheck,
}

impl Reparser<'_> {
    fn finish_reparsed_node(&mut self, node: NodeId, location_node: NodeId) {
        self.b
            .set_flags(node, self.context_flags | NodeFlags::REPARSED);
        let loc = self.b.loc(location_node);
        self.b.set_loc(node, loc);
        self.override_parent_in_immediate_children(node);
    }

    fn finish_mutated_node(&mut self, node: NodeId) {
        self.override_parent_in_immediate_children(node);
    }

    // Deep-clone the given node and add the clone to the reparsed clone list. The list is used by ast.GetReparsedNodeForNode to locate reparsed clones of JSDoc nodes. Since the binder attaches symbols to reparsed nodes and not to JSDoc nodes, we need the mapping when obtaining symbols and types from JSDoc nodes.
    fn add_deep_clone_reparse(&mut self, node: NodeId) -> NodeId {
        let clone = deep_clone_reparse(self.b, node);
        if !clone.is_nil() {
            self.reparsed_clones.push(clone);
        }
        clone
    }

    fn add_transformed_reparse(&mut self, new_node: NodeId, old: NodeId) -> NodeId {
        self.finish_reparsed_node(new_node, old);
        let flags = self.b.flags(new_node) | NodeFlags::REPARSER_TRANSFORMED_LITERAL;
        self.b.set_flags(new_node, flags);
        self.reparsed_clones.push(new_node);
        new_node
    }

    fn check_non_identifier_name(&mut self, name: NodeId) -> NodeId {
        if self.b.kind(name) == Kind::Identifier && !is_valid_identifier(text(self.b, name)) {
            let mut err_loc = self.b.loc(name);
            // missing name, emit error on the character before the missing name node
            if err_loc.len() == 0 {
                err_loc = new_text_range(err_loc.pos() - 1, err_loc.pos());
            }
            self.parse_error_at_range(err_loc, diagnostics::IDENTIFIER_EXPECTED);
        }
        name
    }

    // Hosted tags find a host and add their children to the correct location under the host. Unhosted tags add synthetic nodes to the reparse list.
    fn reparse_tags(&mut self, parent: NodeId, js_doc: &[NodeId]) {
        for (index, j) in js_doc.iter().copied().enumerate() {
            let is_last = index + 1 == js_doc.len();
            let tags = list_member(self.b, j, b"Tags");
            if tags.is_nil() {
                continue;
            }
            let tags = self.b.list_nodes(tags).to_vec();
            for tag in tags {
                self.reparse_unhosted(tag, parent, j);
                if is_last {
                    self.reparse_hosted(tag, parent, j);
                }
            }
        }
    }

    fn reparse_unhosted(&mut self, tag: NodeId, parent: NodeId, js_doc: NodeId) {
        match self.b.kind(tag) {
            Kind::JSDocTypedefTag => {
                let type_expression = type_expression(self.b, tag);
                if type_expression.is_nil() {
                    return;
                }
                let full_name = name(self.b, tag);
                let is_namespace =
                    !full_name.is_nil() && self.b.kind(full_name) == Kind::ModuleDeclaration;
                let mut modifiers = ModifierListId::NIL;
                if is_namespace {
                    modifiers = self.create_export_modifier(tag);
                }
                let clones = self.reparsed_clones.len();
                let innermost = self.get_innermost_name_of_jsdoc_namespace(full_name);
                let innermost = self.check_non_identifier_name(innermost);
                let alias_name = self.add_deep_clone_reparse(innermost);
                let type_alias = self.b.new_js_type_alias_declaration(
                    modifiers,
                    alias_name,
                    NodeListId::NIL,
                    NodeId::NIL,
                );
                let type_parameters =
                    self.gather_type_parameters(js_doc, true /*typedefOrCallback*/);
                set_list_member(self.b, type_alias, b"TypeParameters", type_parameters);
                let t = match self.b.kind(type_expression) {
                    Kind::JSDocTypeExpression => {
                        let inner = type_node(self.b, type_expression);
                        self.add_deep_clone_reparse(inner)
                    }
                    Kind::JSDocTypeLiteral => self.reparse_jsdoc_type_literal(type_expression),
                    _ => {
                        unhandled(
                            self.b,
                            "typedef tag type expression should be a name reference or a type expression",
                            type_expression,
                        );
                        // The copies made for the declaration are held by nothing: a node that the tree does not hold has no id in a file.
                        self.reparsed_clones.truncate(clones);
                        return;
                    }
                };
                set_node_member(self.b, type_alias, b"Type", t);
                self.finish_reparsed_node(type_alias, tag);
                self.b.attach_jsdoc(type_alias, &[js_doc]);
                let result =
                    self.wrap_in_jsdoc_namespace(full_name, type_alias, false /*nested*/);
                self.reparse_list.push(result);
            }
            Kind::JSDocCallbackTag => {
                let type_expression = type_expression(self.b, tag);
                if type_expression.is_nil() {
                    return;
                }
                let full_name = name(self.b, tag);
                let is_namespace =
                    !full_name.is_nil() && self.b.kind(full_name) == Kind::ModuleDeclaration;
                let mut modifiers = ModifierListId::NIL;
                if is_namespace {
                    modifiers = self.create_export_modifier(tag);
                }
                let function_type = self.reparse_jsdoc_signature(
                    type_expression,
                    tag,
                    js_doc,
                    tag,
                    ModifierListId::NIL,
                );
                let innermost = self.get_innermost_name_of_jsdoc_namespace(full_name);
                let alias_name = self.add_deep_clone_reparse(innermost);
                let type_alias = self.b.new_js_type_alias_declaration(
                    modifiers,
                    alias_name,
                    NodeListId::NIL,
                    function_type,
                );
                let type_parameters =
                    self.gather_type_parameters(js_doc, true /*typedefOrCallback*/);
                set_list_member(self.b, type_alias, b"TypeParameters", type_parameters);
                self.finish_reparsed_node(type_alias, tag);
                self.b.attach_jsdoc(type_alias, &[js_doc]);
                let result =
                    self.wrap_in_jsdoc_namespace(full_name, type_alias, false /*nested*/);
                self.reparse_list.push(result);
            }
            Kind::JSDocImportTag => {
                let import_clause = node_member(self.b, tag, b"ImportClause");
                if import_clause.is_nil() {
                    return;
                }
                let import_clause = self.add_deep_clone_reparse(import_clause);
                self.b.set_member(
                    import_clause,
                    b"PhaseModifier",
                    crate::ast::MemberValue::Kind(Kind::TypeKeyword),
                );
                let tag_modifiers = modifiers(self.b, tag);
                let cloned_modifiers = deep_clone_reparse_modifiers(self.b, tag_modifiers);
                let module_specifier = node_member(self.b, tag, b"ModuleSpecifier");
                let module_specifier = self.add_deep_clone_reparse(module_specifier);
                let attributes = node_member(self.b, tag, b"Attributes");
                let attributes = self.add_deep_clone_reparse(attributes);
                let import_declaration = self.b.new_js_import_declaration(
                    cloned_modifiers,
                    import_clause,
                    module_specifier,
                    attributes,
                );
                self.finish_reparsed_node(import_declaration, tag);
                self.reparse_list.push(import_declaration);
            }
            Kind::JSDocOverloadTag => {
                // Create overload signatures only for function, method, and constructor declarations outside object literals
                if matches!(
                    self.b.kind(parent),
                    Kind::FunctionDeclaration | Kind::MethodDeclaration | Kind::Constructor
                ) && self.in_object_literal == 0
                {
                    let js_signature = type_expression(self.b, tag);
                    let parent_modifiers = modifiers(self.b, parent);
                    let signature = self.reparse_jsdoc_signature(
                        js_signature,
                        parent,
                        js_doc,
                        tag,
                        parent_modifiers,
                    );
                    if !signature.is_nil() {
                        self.reparse_list.push(signature);
                    }
                }
            }
            _ => {}
        }
    }

    fn reparse_jsdoc_signature(
        &mut self,
        js_signature: NodeId,
        fun: NodeId,
        js_doc: NodeId,
        tag: NodeId,
        modifiers: ModifierListId,
    ) -> NodeId {
        let cloned_modifiers = deep_clone_reparse_modifiers(self.b, modifiers);
        let signature = match self.b.kind(fun) {
            Kind::FunctionDeclaration => {
                let fun_name = name(self.b, fun);
                let fun_name = self.check_non_identifier_name(fun_name);
                let fun_name = deep_clone_reparse(self.b, fun_name);
                self.b.new_function_declaration(
                    cloned_modifiers,
                    NodeId::NIL,
                    fun_name,
                    NodeListId::NIL,
                    NodeListId::NIL,
                    NodeId::NIL,
                    NodeId::NIL,
                    NodeId::NIL,
                )
            }
            Kind::MethodDeclaration => {
                let fun_name = name(self.b, fun);
                let fun_name = self.check_non_identifier_name(fun_name);
                let fun_name = deep_clone_reparse(self.b, fun_name);
                self.b.new_method_declaration(
                    cloned_modifiers,
                    NodeId::NIL,
                    fun_name,
                    NodeId::NIL,
                    NodeListId::NIL,
                    NodeListId::NIL,
                    NodeId::NIL,
                    NodeId::NIL,
                    NodeId::NIL,
                )
            }
            Kind::Constructor => self.b.new_constructor_declaration(
                cloned_modifiers,
                NodeListId::NIL,
                NodeListId::NIL,
                NodeId::NIL,
                NodeId::NIL,
                NodeId::NIL,
            ),
            Kind::JSDocCallbackTag => {
                let any = self.b.new_keyword_type_node(Kind::AnyKeyword);
                self.b
                    .new_function_type_node(NodeListId::NIL, NodeListId::NIL, any)
            }
            _ => {
                unhandled(self.b, "Unexpected kind", fun);
                return NodeId::NIL;
            }
        };

        if self.b.kind(tag) != Kind::JSDocCallbackTag {
            let type_parameters =
                self.gather_type_parameters(js_doc, false /*typedefOrCallback*/);
            set_list_member(self.b, signature, b"TypeParameters", type_parameters);
        }
        let mut parameters: Vec<NodeId> = Vec::new();
        let js_parameters = parameter_list(self.b, js_signature);
        let js_parameter_nodes = self.b.list_nodes(js_parameters).to_vec();
        for (pi, param) in js_parameter_nodes.iter().copied().enumerate() {
            let mut parameter = NodeId::NIL;
            let param_kind = self.b.kind(param);
            if param_kind == Kind::JSDocThisTag {
                let this_ident = self.b.new_identifier(b"this");
                let loc = self.b.loc(param);
                self.b.set_loc(this_ident, loc);
                self.b
                    .set_flags(this_ident, self.context_flags | NodeFlags::REPARSED);
                parameter = self.b.new_parameter_declaration(
                    ModifierListId::NIL,
                    NodeId::NIL,
                    this_ident,
                    NodeId::NIL,
                    NodeId::NIL,
                    NodeId::NIL,
                );
                let this_type_expression = type_expression(self.b, param);
                if !this_type_expression.is_nil() {
                    let this_type = type_node(self.b, this_type_expression);
                    let this_type = self.add_deep_clone_reparse(this_type);
                    set_node_member(self.b, parameter, b"Type", this_type);
                }
            } else if param_kind == Kind::JSDocParameterTag || param_kind == Kind::JSDocPropertyTag
            {
                // Skip sub-property parameters (e.g., @param x.y) - these have QualifiedNames and describe properties of a parent parameter, not standalone parameters.
                if self.b.kind(name(self.b, param)) == Kind::QualifiedName {
                    continue;
                }
                let mut dot_dot_dot_token = NodeId::NIL;
                let mut param_type = NodeId::NIL;

                let param_type_expression = type_expression(self.b, param);
                if !param_type_expression.is_nil() {
                    let declared = type_node(self.b, param_type_expression);
                    if self.b.kind(declared) == Kind::JSDocVariadicType {
                        dot_dot_dot_token = self.b.new_token(Kind::DotDotDotToken);
                        let loc = self.b.loc(param);
                        self.b.set_loc(dot_dot_dot_token, loc);
                        self.b
                            .set_flags(dot_dot_dot_token, self.context_flags | NodeFlags::REPARSED);

                        let variadic = type_node(self.b, declared);
                        param_type = self.reparse_jsdoc_type_literal(variadic);
                    } else {
                        param_type = self.reparse_jsdoc_type_literal(declared);
                    }
                }
                let mut param_name = name(self.b, param);
                if self.b.kind(param_name) == Kind::Identifier
                    && !is_valid_identifier(text(self.b, param_name))
                {
                    // drop invalid chars for _, if empty, write _0, etc., so we have a valid param name to emit later
                    let mut result: Vec<u8> = Vec::new();
                    for (i, ch) in utf8::range(text(self.b, param_name)) {
                        if i == 0 {
                            if !is_identifier_start(ch) {
                                result.push(b'_');
                            } else {
                                utf8::append_rune(&mut result, ch);
                            }
                            continue;
                        } else if !is_identifier_part(ch) {
                            result.push(b'_');
                        } else {
                            utf8::append_rune(&mut result, ch);
                        }
                    }
                    if result.is_empty() {
                        result.push(b'_');
                        result.extend_from_slice(pi.to_string().as_bytes());
                    }
                    let transformed = self.b.new_identifier(&result);
                    param_name = self.add_transformed_reparse(transformed, param_name);
                } else {
                    param_name = self.add_deep_clone_reparse(param_name);
                }
                let question_token = self.make_question_if_optional(param);
                parameter = self.b.new_parameter_declaration(
                    ModifierListId::NIL,
                    dot_dot_dot_token,
                    param_name,
                    question_token,
                    param_type,
                    NodeId::NIL,
                );
            }
            // Upstream finishes a nil parameter here, which is a nil dereference: a signature holds this tags and parameter tags only.
            if parameter.is_nil() {
                unhandled(self.b, "reparseJSDocSignature: nil parameter", param);
                continue;
            }
            self.finish_reparsed_node(parameter, param);
            parameters.push(parameter);
            self.reparse_jsdoc_comment(parameter, param);
        }
        let parameters_loc = self.b.list_loc(js_parameters);
        let parameters = self.new_node_list(parameters_loc, &parameters);
        set_list_member(self.b, signature, b"Parameters", parameters);

        let return_tag = type_node(self.b, js_signature);
        if !return_tag.is_nil() {
            let return_type_expression = type_expression(self.b, return_tag);
            if !return_type_expression.is_nil() {
                let return_type = type_node(self.b, return_type_expression);
                let return_type = self.add_deep_clone_reparse(return_type);
                set_node_member(self.b, signature, b"Type", return_type);
            }
        }
        let mut loc = js_signature;
        if self.b.kind(tag) == Kind::JSDocOverloadTag {
            loc = tag_name(self.b, tag);
        }
        self.finish_reparsed_node(signature, loc);
        signature
    }

    fn reparse_jsdoc_type_literal(&mut self, t: NodeId) -> NodeId {
        if t.is_nil() {
            return NodeId::NIL;
        }
        if self.b.kind(t) == Kind::JSDocTypeLiteral {
            if !self.stack_check.is_safe_to_recurse() {
                stack_limit(self.b, t);
                return NodeId::NIL;
            }
            let is_array_type = bool_member(self.b, t, b"IsArrayType");
            let mut properties: Vec<NodeId> = Vec::new();
            let property_tags = list_member(self.b, t, b"JSDocPropertyTags");
            let property_tags = self.b.list_nodes(property_tags).to_vec();
            for prop in property_tags {
                let prop_kind = self.b.kind(prop);
                if prop_kind != Kind::JSDocPropertyTag && prop_kind != Kind::JSDocParameterTag {
                    continue;
                }
                let mut prop_name = name(self.b, prop);
                if self.b.kind(prop_name) == Kind::QualifiedName {
                    prop_name = node_member(self.b, prop_name, b"Right");
                }
                if self.b.kind(prop_name) == Kind::Identifier
                    && !is_valid_identifier(text(self.b, prop_name))
                {
                    let literal_text = text(self.b, prop_name).to_vec();
                    let literal = self.b.new_string_literal(&literal_text, TokenFlags::NONE);
                    prop_name = self.add_transformed_reparse(literal, prop_name);
                } else {
                    prop_name = self.add_deep_clone_reparse(prop_name);
                }
                let question_token = self.make_question_if_optional(prop);
                let property = self.b.new_property_signature_declaration(
                    ModifierListId::NIL,
                    prop_name,
                    question_token,
                    NodeId::NIL,
                    NodeId::NIL,
                );
                let prop_type_expression = type_expression(self.b, prop);
                if !prop_type_expression.is_nil() {
                    let prop_type = type_node(self.b, prop_type_expression);
                    let prop_type = self.reparse_jsdoc_type_literal(prop_type);
                    set_node_member(self.b, property, b"Type", prop_type);
                }
                self.finish_reparsed_node(property, prop);
                properties.push(property);
                self.reparse_jsdoc_comment(property, prop);
            }
            let literal_loc = self.b.loc(t);
            let members = self.new_node_list(literal_loc, &properties);
            let mut literal = self.b.new_type_literal_node(members);
            if is_array_type {
                self.finish_reparsed_node(literal, t);
                literal = self.b.new_array_type_node(literal);
            }
            self.finish_reparsed_node(literal, t);
            return literal;
        }
        self.add_deep_clone_reparse(t)
    }

    fn reparse_jsdoc_comment(&mut self, node: NodeId, tag: NodeId) {
        let comment = list_member(self.b, tag, b"Comment");
        if !comment.is_nil() {
            let mut nodes = self.b.list_nodes(comment).to_vec();
            for part in &mut nodes {
                *part = deep_clone_reparse(self.b, *part);
            }
            let comment_loc = self.b.list_loc(comment);
            let new_comment = self.new_node_list(comment_loc, &nodes);
            let prop_jsdoc = self.b.new_jsdoc(new_comment, NodeListId::NIL);
            self.finish_reparsed_node(prop_jsdoc, tag);
            self.b.set_parent(prop_jsdoc, node);
            self.b.attach_jsdoc(node, &[prop_jsdoc]);
        }
    }

    fn gather_type_parameters(&mut self, j: NodeId, typedef_or_callback: bool) -> NodeListId {
        let clones = self.reparsed_clones.len();
        let mut type_parameters: Vec<NodeId> = Vec::new();
        let mut pos = -1;
        let mut end_pos = -1;
        let mut first_template = true;
        let tags = list_member(self.b, j, b"Tags");
        let tags = self.b.list_nodes(tags).to_vec();
        for tag in tags {
            let tag_kind = self.b.kind(tag);
            // When a JSDoc comment contains an `@typedef` or `@callback` tag, `@template` type parameter declarations apply to the type being defined.
            if !typedef_or_callback
                && (tag_kind == Kind::JSDocTypedefTag || tag_kind == Kind::JSDocCallbackTag)
            {
                // Upstream leaves the copies that it made so far in the reparsed clones: nothing holds them, and a node that the tree does not hold has no id in a file.
                self.reparsed_clones.truncate(clones);
                return NodeListId::NIL;
            }
            if tag_kind != Kind::JSDocTemplateTag {
                continue;
            }
            if first_template {
                pos = self.b.loc(tag).pos();
                first_template = false;
            }
            end_pos = self.b.loc(tag).end();
            let constraint = node_member(self.b, tag, b"Constraint");
            let mut first_type_parameter = true;
            let tag_type_parameters = type_parameter_list(self.b, tag);
            let tag_type_parameters = self.b.list_nodes(tag_type_parameters).to_vec();
            for tp in tag_type_parameters {
                let reparse;
                if !constraint.is_nil() && first_type_parameter {
                    let tp_modifiers = modifiers(self.b, tp);
                    let tp_modifiers = deep_clone_reparse_modifiers(self.b, tp_modifiers);
                    let tp_name = name(self.b, tp);
                    let tp_name = self.check_non_identifier_name(tp_name);
                    let tp_name = self.add_deep_clone_reparse(tp_name);
                    let constraint_type = type_node(self.b, constraint);
                    let constraint_type = self.add_deep_clone_reparse(constraint_type);
                    let default_type = node_member(self.b, tp, b"DefaultType");
                    let default_type = self.add_deep_clone_reparse(default_type);
                    reparse = self.b.new_type_parameter_declaration(
                        tp_modifiers,
                        tp_name,
                        constraint_type,
                        NodeId::NIL, // expression
                        default_type,
                    );
                    self.finish_reparsed_node(reparse, tp);
                } else {
                    reparse = self.add_deep_clone_reparse(tp);
                }
                type_parameters.push(reparse);
                first_type_parameter = false;
            }
        }
        if type_parameters.is_empty() {
            NodeListId::NIL
        } else {
            self.new_node_list(new_text_range(pos, end_pos), &type_parameters)
        }
    }

    fn reparse_hosted(&mut self, tag: NodeId, parent: NodeId, js_doc: NodeId) {
        let mut parent = parent;
        let tag_kind = self.b.kind(tag);
        match tag_kind {
            Kind::JSDocTypeTag => {
                let tag_type_expression = type_expression(self.b, tag);
                match self.b.kind(parent) {
                    Kind::VariableStatement => {
                        let declaration_list = node_member(self.b, parent, b"DeclarationList");
                        if !declaration_list.is_nil() {
                            let declarations =
                                list_member(self.b, declaration_list, b"Declarations");
                            let declarations = self.b.list_nodes(declarations).to_vec();
                            for declaration in declarations {
                                if type_node(self.b, declaration).is_nil()
                                    && !tag_type_expression.is_nil()
                                {
                                    let t = type_node(self.b, tag_type_expression);
                                    let t = self.add_deep_clone_reparse(t);
                                    self.b.set_type_node(declaration, t);
                                    self.finish_mutated_node(declaration);
                                    return;
                                }
                            }
                        }
                    }
                    Kind::VariableDeclaration
                    | Kind::ExportAssignment
                    | Kind::PropertyDeclaration
                    | Kind::PropertyAssignment
                    | Kind::ShorthandPropertyAssignment
                    | Kind::GetAccessor => {
                        if type_node(self.b, parent).is_nil() && !tag_type_expression.is_nil() {
                            let t = type_node(self.b, tag_type_expression);
                            let t = self.add_deep_clone_reparse(t);
                            self.b.set_type_node(parent, t);
                            self.finish_mutated_node(parent);
                            return;
                        }
                    }
                    Kind::Parameter => {
                        if type_node(self.b, parent).is_nil() && !tag_type_expression.is_nil() {
                            let t = type_node(self.b, tag_type_expression);
                            let t = self.reparse_jsdoc_type_literal(t);
                            self.b.set_type_node(parent, t);
                            self.finish_mutated_node(parent);
                            return;
                        }
                    }
                    Kind::ExpressionStatement => {
                        let bin = expression(self.b, parent);
                        if self.b.kind(bin) == Kind::BinaryExpression {
                            let kind = get_assignment_declaration_kind(self.b, bin);
                            if kind != JSDeclarationKind::NONE && !tag_type_expression.is_nil() {
                                let t = type_node(self.b, tag_type_expression);
                                let t = self.add_deep_clone_reparse(t);
                                self.b.set_type_node(bin, t);
                                self.finish_mutated_node(bin);
                                return;
                            }
                        }
                    }
                    Kind::ReturnStatement | Kind::ParenthesizedExpression => {
                        let parent_expression = expression(self.b, parent);
                        if !parent_expression.is_nil() && !tag_type_expression.is_nil() {
                            let t = type_node(self.b, tag_type_expression);
                            let t = self.add_deep_clone_reparse(t);
                            let cast =
                                self.make_new_cast(t, parent_expression, true /*isAssertion*/);
                            self.b.set_expression(parent, cast);
                            self.finish_mutated_node(parent);
                            return;
                        }
                    }
                    _ => {}
                }
                let fun = get_function_like_host(self.b, parent);
                if !fun.is_nil() {
                    let no_typed_params = self
                        .b
                        .list_nodes(parameter_list(self.b, fun))
                        .iter()
                        .all(|param| type_node(self.b, *param).is_nil());
                    if type_parameter_list(self.b, fun).is_nil()
                        && type_node(self.b, fun).is_nil()
                        && no_typed_params
                        && !tag_type_expression.is_nil()
                    {
                        let t = type_node(self.b, tag_type_expression);
                        let t = self.add_deep_clone_reparse(t);
                        set_node_member(self.b, fun, b"FullSignature", t);
                        self.finish_mutated_node(fun);
                    }
                }
            }
            Kind::JSDocSatisfiesTag => {
                let tag_type_expression = type_expression(self.b, tag);
                match self.b.kind(parent) {
                    Kind::VariableStatement => {
                        let declaration_list = node_member(self.b, parent, b"DeclarationList");
                        if !declaration_list.is_nil() {
                            let declarations =
                                list_member(self.b, declaration_list, b"Declarations");
                            let declarations = self.b.list_nodes(declarations).to_vec();
                            for declaration in declarations {
                                let declaration_initializer = initializer(self.b, declaration);
                                if !declaration_initializer.is_nil()
                                    && !tag_type_expression.is_nil()
                                {
                                    let t = type_node(self.b, tag_type_expression);
                                    let t = self.add_deep_clone_reparse(t);
                                    let cast = self.make_new_cast(
                                        t,
                                        declaration_initializer,
                                        false, /*isAssertion*/
                                    );
                                    self.b.set_initializer(declaration, cast);
                                    self.finish_mutated_node(declaration);
                                    break;
                                }
                            }
                        }
                    }
                    Kind::VariableDeclaration
                    | Kind::PropertyDeclaration
                    | Kind::PropertyAssignment => {
                        let parent_initializer = initializer(self.b, parent);
                        if !parent_initializer.is_nil() && !tag_type_expression.is_nil() {
                            let t = type_node(self.b, tag_type_expression);
                            let t = self.add_deep_clone_reparse(t);
                            let cast = self.make_new_cast(
                                t,
                                parent_initializer,
                                false, /*isAssertion*/
                            );
                            self.b.set_initializer(parent, cast);
                            self.finish_mutated_node(parent);
                        }
                    }
                    Kind::ShorthandPropertyAssignment => {
                        let object_assignment_initializer =
                            node_member(self.b, parent, b"ObjectAssignmentInitializer");
                        if !object_assignment_initializer.is_nil() && !tag_type_expression.is_nil()
                        {
                            let t = type_node(self.b, tag_type_expression);
                            let t = self.add_deep_clone_reparse(t);
                            let cast = self.make_new_cast(
                                t,
                                object_assignment_initializer,
                                false, /*isAssertion*/
                            );
                            set_node_member(self.b, parent, b"ObjectAssignmentInitializer", cast);
                            self.finish_mutated_node(parent);
                        }
                    }
                    Kind::ReturnStatement
                    | Kind::ParenthesizedExpression
                    | Kind::ExportAssignment => {
                        let parent_expression = expression(self.b, parent);
                        if !parent_expression.is_nil() && !tag_type_expression.is_nil() {
                            let t = type_node(self.b, tag_type_expression);
                            let t = self.add_deep_clone_reparse(t);
                            let cast = self.make_new_cast(
                                t,
                                parent_expression,
                                false, /*isAssertion*/
                            );
                            self.b.set_expression(parent, cast);
                            self.finish_mutated_node(parent);
                        }
                    }
                    Kind::ExpressionStatement => {
                        let bin = expression(self.b, parent);
                        if self.b.kind(bin) == Kind::BinaryExpression {
                            let kind = get_assignment_declaration_kind(self.b, bin);
                            if kind != JSDeclarationKind::NONE && !tag_type_expression.is_nil() {
                                let t = type_node(self.b, tag_type_expression);
                                let t = self.add_deep_clone_reparse(t);
                                let right = node_member(self.b, bin, b"Right");
                                let cast = self.make_new_cast(t, right, false /*isAssertion*/);
                                set_node_member(self.b, bin, b"Right", cast);
                                self.finish_mutated_node(bin);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Kind::JSDocTemplateTag => {
                let fun = get_function_like_host(self.b, parent);
                if !fun.is_nil() {
                    if type_parameter_list(self.b, fun).is_nil()
                        && full_signature(self.b, fun).is_nil()
                    {
                        let type_parameters =
                            self.gather_type_parameters(js_doc, false /*typedefOrCallback*/);
                        set_list_member(self.b, fun, b"TypeParameters", type_parameters);
                        self.finish_mutated_node(fun);
                    }
                } else if matches!(
                    self.b.kind(parent),
                    Kind::ClassDeclaration | Kind::ClassExpression
                ) && type_parameter_list(self.b, parent).is_nil()
                {
                    let type_parameters =
                        self.gather_type_parameters(js_doc, false /*typedefOrCallback*/);
                    set_list_member(self.b, parent, b"TypeParameters", type_parameters);
                    self.finish_mutated_node(parent);
                }
            }
            Kind::JSDocParameterTag => {
                let fun = get_function_like_host(self.b, parent);
                if !fun.is_nil() && full_signature(self.b, fun).is_nil() {
                    let param = find_matching_parameter(self.b, fun, tag, js_doc);
                    if !param.is_nil() {
                        let tag_type_expression = type_expression(self.b, tag);
                        if type_node(self.b, param).is_nil() && !tag_type_expression.is_nil() {
                            let t = type_node(self.b, tag_type_expression);
                            let t = self.reparse_jsdoc_type_literal(t);
                            set_node_member(self.b, param, b"Type", t);
                        }
                        if node_member(self.b, param, b"QuestionToken").is_nil() {
                            let question = self.make_question_if_optional(tag);
                            if !question.is_nil() {
                                set_node_member(self.b, param, b"QuestionToken", question);
                            }
                        }
                        self.finish_mutated_node(param);
                    }
                }
            }
            Kind::JSDocThisTag => {
                let fun = get_function_like_host(self.b, parent);
                if !fun.is_nil() {
                    let fun_parameters = parameter_list(self.b, fun);
                    let params = self.b.list_nodes(fun_parameters).to_vec();
                    let first_name = params
                        .first()
                        .map_or(NodeId::NIL, |first| name(self.b, *first));
                    if params.is_empty()
                        || (self.b.kind(first_name) != Kind::ThisKeyword
                            && !is_this_identifier(self.b, first_name))
                    {
                        let this_name = self.b.new_identifier(b"this");
                        let this_param = self.b.new_parameter_declaration(
                            ModifierListId::NIL, // modifiers
                            NodeId::NIL,
                            this_name,
                            NodeId::NIL, // questionToken
                            NodeId::NIL, // type
                            NodeId::NIL, // initializer
                        );
                        let tag_type_expression = type_expression(self.b, tag);
                        if !tag_type_expression.is_nil() {
                            let t = type_node(self.b, tag_type_expression);
                            let t = self.add_deep_clone_reparse(t);
                            set_node_member(self.b, this_param, b"Type", t);
                        }
                        let location = tag_name(self.b, tag);
                        self.finish_reparsed_node(this_param, location);

                        let mut new_params = Vec::with_capacity(params.len() + 1);
                        new_params.push(this_param);
                        new_params.extend_from_slice(&params);

                        let parameters_loc = self.b.list_loc(fun_parameters);
                        let new_params = self.new_node_list(parameters_loc, &new_params);
                        set_list_member(self.b, fun, b"Parameters", new_params);
                        self.finish_mutated_node(fun);
                    }
                }
            }
            Kind::JSDocReturnTag => {
                let fun = get_function_like_host(self.b, parent);
                if !fun.is_nil() && full_signature(self.b, fun).is_nil() {
                    let tag_type_expression = type_expression(self.b, tag);
                    if type_node(self.b, fun).is_nil() && !tag_type_expression.is_nil() {
                        let t = type_node(self.b, tag_type_expression);
                        let t = self.add_deep_clone_reparse(t);
                        set_node_member(self.b, fun, b"Type", t);
                        self.finish_mutated_node(fun);
                    }
                }
            }
            Kind::JSDocReadonlyTag
            | Kind::JSDocPrivateTag
            | Kind::JSDocPublicTag
            | Kind::JSDocProtectedTag
            | Kind::JSDocOverrideTag => {
                if self.b.kind(parent) == Kind::ExpressionStatement {
                    parent = expression(self.b, parent);
                }
                let parent_kind = self.b.kind(parent);
                // In object literals these aren't class-like members, so JSDoc modifiers like @override or @readonly aren't real modifiers there; reparsing them produces spurious grammar errors (#4437).
                if matches!(
                    parent_kind,
                    Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor
                ) && self.in_object_literal != 0
                {
                    return;
                }
                if matches!(
                    parent_kind,
                    Kind::MethodDeclaration
                        | Kind::GetAccessor
                        | Kind::SetAccessor
                        | Kind::PropertyDeclaration
                        | Kind::Constructor
                        | Kind::BinaryExpression
                ) {
                    let keyword = match tag_kind {
                        Kind::JSDocReadonlyTag => Kind::ReadonlyKeyword,
                        Kind::JSDocPrivateTag => Kind::PrivateKeyword,
                        Kind::JSDocPublicTag => Kind::PublicKeyword,
                        Kind::JSDocProtectedTag => Kind::ProtectedKeyword,
                        _ => Kind::OverrideKeyword,
                    };
                    let modifier = self.b.new_modifier(keyword);
                    let tag_loc = self.b.loc(tag);
                    self.b.set_loc(modifier, tag_loc);
                    self.b
                        .set_flags(modifier, self.context_flags | NodeFlags::REPARSED);
                    let parent_modifiers = modifiers(self.b, parent);
                    let mut nodes: Vec<NodeId> = Vec::new();
                    let loc = if parent_modifiers.is_nil() {
                        nodes.push(modifier);
                        tag_loc
                    } else {
                        nodes.extend_from_slice(modifier_nodes(self.b, parent));
                        nodes.push(modifier);
                        self.b.list_loc(parent_modifiers.as_node_list())
                    };
                    let new_modifiers = self.new_modifier_list(loc, &nodes);
                    self.b.set_modifiers(parent, new_modifiers);
                    self.finish_mutated_node(parent);
                }
            }
            Kind::JSDocImplementsTag => {
                if get_class_like_data(self.b, parent) {
                    let class_name = node_member(self.b, tag, b"ClassName");
                    // Upstream reads the range of a nil class name here, which is a nil dereference.
                    if class_name.is_nil() {
                        return;
                    }
                    let heritage_clauses = list_member(self.b, parent, b"HeritageClauses");
                    if !heritage_clauses.is_nil() {
                        let implements_clause = self
                            .b
                            .list_nodes(heritage_clauses)
                            .iter()
                            .copied()
                            .find(|node| {
                                kind_member(self.b, *node, b"Token") == Kind::ImplementsKeyword
                            });
                        if let Some(implements_clause) = implements_clause {
                            let types = list_member(self.b, implements_clause, b"Types");
                            let mut nodes = self.b.list_nodes(types).to_vec();
                            nodes.push(self.add_deep_clone_reparse(class_name));
                            replace_list_nodes(self.b, implements_clause, b"Types", types, &nodes);
                            self.finish_mutated_node(implements_clause);
                            return;
                        }
                    }
                    let class_name_loc = self.b.loc(class_name);
                    let class_name_clone = self.add_deep_clone_reparse(class_name);
                    let types_list = self.new_node_list(class_name_loc, &[class_name_clone]);

                    let heritage_clause = self
                        .b
                        .new_heritage_clause(Kind::ImplementsKeyword, types_list);
                    self.finish_reparsed_node(heritage_clause, class_name);

                    if heritage_clauses.is_nil() {
                        let new_clauses = self.new_node_list(class_name_loc, &[heritage_clause]);
                        set_list_member(self.b, parent, b"HeritageClauses", new_clauses);
                    } else {
                        let mut nodes = self.b.list_nodes(heritage_clauses).to_vec();
                        nodes.push(heritage_clause);
                        replace_list_nodes(
                            self.b,
                            parent,
                            b"HeritageClauses",
                            heritage_clauses,
                            &nodes,
                        );
                    }
                    self.finish_mutated_node(parent);
                }
            }
            Kind::JSDocAugmentsTag => {
                let heritage_clauses = list_member(self.b, parent, b"HeritageClauses");
                if get_class_like_data(self.b, parent) && !heritage_clauses.is_nil() {
                    let extends_clause = self
                        .b
                        .list_nodes(heritage_clauses)
                        .iter()
                        .copied()
                        .find(|node| kind_member(self.b, *node, b"Token") == Kind::ExtendsKeyword);
                    let Some(extends_clause) = extends_clause else {
                        return;
                    };
                    let types = self
                        .b
                        .list_nodes(list_member(self.b, extends_clause, b"Types"));
                    let &[target] = types else {
                        return;
                    };
                    let source = node_member(self.b, tag, b"ClassName");
                    // A target or a source of another kind is a failed type assertion upstream.
                    if self.b.kind(target) != Kind::ExpressionWithTypeArguments
                        || self.b.kind(source) != Kind::ExpressionWithTypeArguments
                    {
                        return;
                    }
                    if has_same_property_access_name(
                        self.b,
                        expression(self.b, target),
                        expression(self.b, source),
                    ) {
                        let source_type_arguments = list_member(self.b, source, b"TypeArguments");
                        if list_member(self.b, target, b"TypeArguments").is_nil()
                            && !source_type_arguments.is_nil()
                        {
                            let mut new_arguments =
                                self.b.list_nodes(source_type_arguments).to_vec();
                            for arg in &mut new_arguments {
                                *arg = self.add_deep_clone_reparse(*arg);
                            }
                            let arguments_loc = self.b.list_loc(source_type_arguments);
                            let new_arguments = self.new_node_list(arguments_loc, &new_arguments);
                            set_list_member(self.b, target, b"TypeArguments", new_arguments);
                            self.finish_mutated_node(target);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn make_question_if_optional(&mut self, parameter: NodeId) -> NodeId {
        let mut question_token = NodeId::NIL;
        let parameter_type_expression = type_expression(self.b, parameter);
        if bool_member(self.b, parameter, b"IsBracketed")
            || (!parameter_type_expression.is_nil()
                && self.b.kind(type_node(self.b, parameter_type_expression))
                    == Kind::JSDocOptionalType)
        {
            question_token = self.b.new_token(Kind::QuestionToken);
            let loc = self.b.loc(parameter);
            self.b.set_loc(question_token, loc);
            self.b
                .set_flags(question_token, self.context_flags | NodeFlags::REPARSED);
        }
        question_token
    }

    fn make_new_cast(&mut self, t: NodeId, e: NodeId, is_assertion: bool) -> NodeId {
        let assert = if is_assertion {
            self.b.new_as_expression(e, t)
        } else {
            self.b.new_satisfies_expression(e, t)
        };
        let loc = self.b.loc(e);
        self.finish_node_with_end(assert, loc.pos(), loc.end());
        assert
    }

    fn create_export_modifier(&mut self, location_node: NodeId) -> ModifierListId {
        let export_modifier = self.b.new_modifier(Kind::ExportKeyword);
        let loc = self.b.loc(location_node);
        self.b.set_loc(export_modifier, loc);
        self.b
            .set_flags(export_modifier, self.context_flags | NodeFlags::REPARSED);
        self.new_modifier_list(loc, &[export_modifier])
    }

    // getInnermostNameOfJSDocNamespace returns the innermost identifier from a JSDoc namespace chain (ModuleDeclaration). For a simple identifier, it returns the identifier itself. For "A.B.C", it returns the identifier "C".
    fn get_innermost_name_of_jsdoc_namespace(&self, full_name: NodeId) -> NodeId {
        let mut full_name = full_name;
        if full_name.is_nil() {
            return NodeId::NIL;
        }
        while self.b.kind(full_name) == Kind::ModuleDeclaration {
            let body = node_member(self.b, full_name, b"Body");
            if body.is_nil() {
                return name(self.b, full_name);
            }
            full_name = body;
        }
        full_name
    }

    // wrapInJSDocNamespace wraps a statement (typically a type alias) in namespace declarations corresponding to a JSDoc dotted name. For example, given name "A.B.C" and a type alias for C, this produces `namespace A { namespace B { type C = ... } }`. If the name is a simple identifier (not a ModuleDeclaration), it returns the statement as-is.
    fn wrap_in_jsdoc_namespace(
        &mut self,
        full_name: NodeId,
        statement: NodeId,
        nested: bool,
    ) -> NodeId {
        if full_name.is_nil() || self.b.kind(full_name) != Kind::ModuleDeclaration {
            return statement;
        }
        if !self.stack_check.is_safe_to_recurse() {
            stack_limit(self.b, full_name);
            return statement;
        }
        // Recursively wrap from outermost to innermost. Inner namespaces always get an export modifier so members are accessible via dotted access from outside. The outermost namespace is treated as exported only in module files via IsImplicitlyExportedJSDocDeclaration (in the binder), so it does not get an explicit export modifier here.
        let body = node_member(self.b, full_name, b"Body");
        let wrapped = self.wrap_in_jsdoc_namespace(body, statement, true /*nested*/);
        let full_name_loc = self.b.loc(full_name);
        let statements = self.new_node_list(full_name_loc, &[wrapped]);
        let block = self.b.new_module_block(statements);
        self.finish_reparsed_node(block, full_name);
        let mut modifiers = ModifierListId::NIL;
        if nested {
            modifiers = self.create_export_modifier(full_name);
        }
        let namespace_name = name(self.b, full_name);
        let namespace_name = self.add_deep_clone_reparse(namespace_name);
        let result =
            self.b
                .new_module_declaration(modifiers, Kind::NamespaceKeyword, namespace_name, block);
        self.finish_reparsed_node(result, full_name);
        self.reparsed_clones.push(result);
        result
    }

    // Parser.parseErrorAtRange
    fn parse_error_at_range(&mut self, loc: TextRange, message: MessageId) {
        // Don't report another error if it would just be at the same location as the last error
        if self
            .diagnostics
            .last()
            .is_none_or(|last| last.loc.pos() != loc.pos())
        {
            self.diagnostics.push(ParseDiagnostic {
                message,
                loc,
                args: Vec::new(),
                related_information: Vec::new(),
            });
        }
        self.has_parse_error = true;
    }

    // Parser.newNodeList
    fn new_node_list(&mut self, loc: TextRange, nodes: &[NodeId]) -> NodeListId {
        let list = self.b.new_node_list(nodes);
        self.b.set_list_loc(list, loc);
        list
    }

    // Parser.newModifierList
    fn new_modifier_list(&mut self, loc: TextRange, nodes: &[NodeId]) -> ModifierListId {
        let list = self.b.new_modifier_list(nodes);
        self.b.set_list_loc(list.as_node_list(), loc);
        list
    }

    // Parser.finishNodeWithEnd
    fn finish_node_with_end(&mut self, node: NodeId, pos: i32, end: i32) {
        self.b.set_loc(node, new_text_range(pos, end));
        let mut flags = self.b.flags(node) | self.context_flags;
        if self.has_parse_error {
            flags |= NodeFlags::THIS_NODE_HAS_ERROR;
            self.has_parse_error = false;
        }
        self.b.set_flags(node, flags);
        self.override_parent_in_immediate_children(node);
    }

    // Parser.overrideParentInImmediateChildren
    fn override_parent_in_immediate_children(&mut self, node: NodeId) {
        let mut held: Vec<NodeId> = Vec::new();
        children(self.b, node, &mut held);
        for child in held {
            self.b.set_parent(child, node);
        }
    }

    // What finishNode does to the next node that the parser finishes after an error of the reparser.
    fn finish(&mut self, node: NodeId) {
        if self.has_parse_error {
            let flags = self.b.flags(node) | NodeFlags::THIS_NODE_HAS_ERROR;
            self.b.set_flags(node, flags);
            self.has_parse_error = false;
        }
    }

    // The end of Parser.withJSDoc for a JavaScript file: the comments of the host have the host as their parent, and their tags are reparsed.
    fn with_jsdoc(&mut self, node: NodeId) {
        let Some(list) = self.jsdoc_of.get(node.0 as usize).copied() else {
            return;
        };
        let js_doc = self.b.list_nodes(list).to_vec();
        if js_doc.is_empty() {
            return;
        }
        for parsed in &js_doc {
            self.b.set_parent(*parsed, node);
        }
        self.context_flags = self.b.flags(node) & NodeFlags::CONTEXT_FLAGS;
        self.reparse_tags(node, &js_doc);
    }

    // The walk of the file in the order in which the parser finishes the nodes, with what parseListIndex and parseSourceFileWorker do with the reparse list.
    fn reparse_file(&mut self, source_file: NodeId) {
        let mut frames: Vec<ListFrame> = Vec::new();
        let mut members: Vec<ChildMember> = Vec::new();
        let mut steps = vec![Step::Enter(source_file)];
        while let Some(step) = steps.pop() {
            match step {
                Step::Enter(node) => {
                    let kind = self.b.kind(node);
                    if kind == Kind::ObjectLiteralExpression {
                        self.in_object_literal += 1;
                    }
                    steps.push(Step::Leave(node));
                    members.clear();
                    members_in_source_order(self.b, node, &mut members);
                    for member in members.iter().rev() {
                        // The end of file token is finished after the statements, with the source file.
                        if kind == Kind::SourceFile && member.name == "EndOfFileToken" {
                            continue;
                        }
                        if !member.is_list {
                            steps.push(Step::Enter(NodeId(member.word)));
                            continue;
                        }
                        let items = self.b.list_nodes(NodeListId(member.word));
                        match parsing_context_of(kind, member.name) {
                            Some(context) => {
                                steps.push(Step::ListEnd);
                                for item in items.iter().rev() {
                                    steps.push(Step::ElementEnd(*item));
                                    steps.push(Step::Enter(*item));
                                }
                                steps.push(Step::ListStart(node, *member, context));
                            }
                            None => {
                                steps.extend(items.iter().rev().map(|item| Step::Enter(*item)));
                            }
                        }
                    }
                }
                Step::ListStart(owner, member, kind) => {
                    frames.push(ListFrame {
                        owner,
                        member: member.name,
                        list: NodeListId(member.word),
                        kind,
                        nodes: Vec::new(),
                        changed: false,
                        outer_reparse_list: std::mem::take(&mut self.reparse_list),
                    });
                }
                Step::ElementEnd(element) => {
                    let Some(frame) = frames.last_mut() else {
                        continue;
                    };
                    for e in std::mem::take(&mut self.reparse_list) {
                        // Propagate @typedef type alias declarations outwards to a context that permits them.
                        let e_kind = self.b.kind(e);
                        if (e_kind == Kind::JSTypeAliasDeclaration
                            || e_kind == Kind::JSImportDeclaration)
                            && frame.kind != ParsingContext::SourceElements
                            && frame.kind != ParsingContext::BlockStatements
                        {
                            frame.outer_reparse_list.push(e);
                        } else {
                            frame.nodes.push(e);
                            frame.changed = true;
                        }
                    }
                    frame.nodes.push(element);
                }
                Step::ListEnd => {
                    let Some(frame) = frames.pop() else {
                        continue;
                    };
                    if frame.changed {
                        replace_list_nodes(
                            self.b,
                            frame.owner,
                            frame.member.as_bytes(),
                            frame.list,
                            &frame.nodes,
                        );
                    }
                    self.reparse_list = frame.outer_reparse_list;
                }
                Step::Leave(node) => {
                    let kind = self.b.kind(node);
                    if kind == Kind::ObjectLiteralExpression {
                        self.in_object_literal = self.in_object_literal.saturating_sub(1);
                    }
                    if kind != Kind::SourceFile {
                        self.finish(node);
                        self.with_jsdoc(node);
                        continue;
                    }
                    let eof = node_member(self.b, node, b"EndOfFileToken");
                    self.finish(eof);
                    self.with_jsdoc(eof);
                    if !self.reparse_list.is_empty() {
                        let statements = list_member(self.b, node, b"Statements");
                        let mut nodes = self.b.list_nodes(statements).to_vec();
                        nodes.append(&mut self.reparse_list);
                        replace_list_nodes(self.b, node, b"Statements", statements, &nodes);
                    }
                    self.finish(node);
                }
            }
        }
    }
}

fn find_matching_parameter(
    b: &FileBuilder,
    fun: NodeId,
    parameter_tag: NodeId,
    js_doc: NodeId,
) -> NodeId {
    let mut tag_index: isize = -1;
    let mut param_count: isize = -1;
    for tag in b.list_nodes(list_member(b, js_doc, b"Tags")) {
        if b.kind(*tag) == Kind::JSDocParameterTag {
            param_count += 1;
            if *tag == parameter_tag {
                tag_index = param_count;
                break;
            }
        }
    }
    let tag_name = name(b, parameter_tag);
    for (parameter_index, parameter) in b.list_nodes(parameter_list(b, fun)).iter().enumerate() {
        let parameter_name = name(b, *parameter);
        if b.kind(parameter_name) == Kind::Identifier {
            if b.kind(tag_name) == Kind::Identifier
                && (text(b, parameter_name) == text(b, tag_name)
                    || (parameter_index as isize == tag_index && text(b, tag_name).is_empty()))
            {
                return *parameter;
            }
        } else if parameter_index as isize == tag_index {
            return *parameter;
        }
    }
    NodeId::NIL
}

fn skip_satisfies_expressions(b: &FileBuilder, node: NodeId) -> NodeId {
    let mut node = node;
    while !node.is_nil() && b.kind(node) == Kind::SatisfiesExpression {
        node = expression(b, node);
    }
    node
}

fn get_function_like_host(b: &FileBuilder, host: NodeId) -> NodeId {
    let mut fun = host;
    match b.kind(host) {
        Kind::VariableStatement => {
            let declaration_list = node_member(b, host, b"DeclarationList");
            let nodes = b.list_nodes(list_member(b, declaration_list, b"Declarations"));
            if let Some(first) = nodes.first() {
                fun = initializer(b, *first);
            }
        }
        Kind::PropertyAssignment | Kind::PropertyDeclaration => fun = initializer(b, host),
        Kind::ExportAssignment | Kind::ReturnStatement => fun = expression(b, host),
        Kind::ExpressionStatement => {
            fun = get_right_most_assigned_expression(b, expression(b, host));
        }
        _ => {}
    }
    fun = skip_satisfies_expressions(b, fun);
    if !fun.is_nil() && is_function_like_kind(b.kind(fun)) {
        return fun;
    }
    NodeId::NIL
}

// getClassLikeData: whether the node has the data of a class, which the callers then read from the node.
fn get_class_like_data(b: &FileBuilder, parent: NodeId) -> bool {
    matches!(
        b.kind(parent),
        Kind::ClassDeclaration | Kind::ClassExpression
    )
}

// Reparses the tags of every JSDoc comment of a JavaScript file as upstream's parser does while it parses: the file has its comments attached and no reparsed node yet.
pub fn reparse_source_file(b: &mut FileBuilder, source_file: NodeId) -> Reparsed {
    let mut jsdoc_of = vec![NodeListId::NIL; b.node_count() as usize + 1];
    for (host, list) in b.jsdoc_attachments() {
        if let Some(slot) = jsdoc_of.get_mut(host.0 as usize) {
            *slot = *list;
        }
    }
    let mut reparser = Reparser {
        b,
        context_flags: NodeFlags::NONE,
        reparse_list: Vec::new(),
        reparsed_clones: Vec::new(),
        has_parse_error: false,
        in_object_literal: 0,
        diagnostics: Vec::new(),
        jsdoc_of,
        stack_check: bun_core::StackCheck::init(),
    };
    reparser.reparse_file(source_file);
    let Reparser {
        b,
        mut reparsed_clones,
        diagnostics,
        ..
    } = reparser;
    // finishSourceFile: slices.SortFunc(p.reparsedClones, ast.CompareNodePositions)
    sort_func(&mut reparsed_clones, &mut |n1, n2| {
        node_position_is_less(b, n1, n2)
    });
    Reparsed {
        reparsed_clones,
        diagnostics,
    }
}
