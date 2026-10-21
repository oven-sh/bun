//! The special cases of comment attachment, from Prettier's `handle-comments.js`.
//!
//! Each `handle_*` function has the name of the Prettier function it implements. Prettier runs its handlers one after
//! the other, and almost every handler starts by checking the type of the enclosing node. Here
//! [`Rules::handle_by_enclosing_node`] checks that type once and only calls the handlers that apply to it, in
//! Prettier's order.
//!
//! Where Prettier scans the source text for a token such as `else` or `)`, this code compares offsets with the tokens
//! that the lexer recorded next to the comment.

use super::TextPosition::{EndOfLine, OwnLine, Remaining};
use super::flow::{self, FunctionType};
use super::surrounding_nodes::{
    AttachContext, SurroundingNodes, function_of, has_parameters, union_members,
};
use super::{Attachment, CommentContext, Marker, Owner};
use crate::js::ast_nodes::{AsAstNodes, AstNodes as N, ExpressionStatement};
use crate::js::comments::CommentExt;
use crate::js::print::flow::{
    as_declared_predicate, is_declared_class, is_flow_declare_export, is_flow_opaque_type,
    is_flow_record,
};
use bun_lint::ast::{
    Case, Expr, ExprKind, Flags, FnBody, Func, List, Member, Node, Param, PatKind, PropKind, Stmt,
    StmtKind, StmtTag, TypeKind, TypeNode,
};
use bun_lint::span::Span;

mod oxfmt;

/// Returns `None` if no special case applies. Sets `ignored_node` if the comment is a `prettier-ignore` comment that
/// applies to a node other than the one it gets attached to.
pub(super) fn handle_comment<'a>(
    cx: &AttachContext<'a, '_>,
    context: &CommentContext<'a>,
    ignored_node: &mut Option<Owner<'a>>,
) -> Option<Attachment<'a>> {
    let SurroundingNodes {
        enclosing_node,
        preceding_node,
        following_node,
        ..
    } = context.nodes;
    Rules {
        cx,
        context,
        enclosing_node,
        preceding_node,
        following_node,
    }
    .handle_comment(ignored_node)
}

struct Rules<'r, 'a, 'c> {
    cx: &'r AttachContext<'a, 'c>,
    context: &'r CommentContext<'a>,
    enclosing_node: Option<Owner<'a>>,
    preceding_node: Option<Owner<'a>>,
    following_node: Option<Owner<'a>>,
}

fn is_union(owner: Owner<'_>) -> bool {
    matches!(owner, Owner::Node(N::TSUnionType(_)))
}

fn is_conditional(owner: Option<Owner<'_>>) -> bool {
    matches!(
        owner,
        Some(Owner::Node(
            N::ConditionalExpression(_) | N::TSConditionalType(_)
        ))
    )
}

fn is_block(owner: Owner<'_>) -> bool {
    matches!(
        owner,
        Owner::Node(N::BlockStatement(_) | N::FunctionBody(_))
    )
}

/// One step of [`Rules::is_name_of_type_query_or_jsx_element`]. Returns the member access that `e` is the object of, or
/// else the answer.
fn member_access_or_is_name(e: Expr<'_>) -> Result<Expr<'_>, bool> {
    match e.parent() {
        Node::Expr(parent) if matches!(parent.kind(), ExprKind::Dot { .. }) => Ok(parent),
        Node::Expr(parent) => Err(matches!(parent.kind(), ExprKind::Jsx(jsx)
            if jsx.tag() == Some(e) || jsx.close_tag() == Some(e))),
        Node::Type(ty) => Err(matches!(ty.kind(), TypeKind::Typeof { .. })),
        _ => Err(false),
    }
}

/// Returns the statement after `statement` in its program, block or namespace, skipping empty statements.
fn statement_after(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    let statements = match statement.parent() {
        Node::File(file) => file.body(),
        Node::Func(func) => func.body_statements()?,
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Block(statements) => statements,
            StmtKind::Module(module) => module.innermost().body(),
            _ => return None,
        },
        _ => return None,
    };
    let mut next = statements.after(statement.span().start)?;
    while next.tag() == StmtTag::Empty {
        next = statements.after(next.span().start)?;
    }
    Some(next)
}

/// True for a function parameter other than `this`.
fn is_parameter(owner: Owner<'_>) -> bool {
    matches!(
        owner,
        Owner::Node(N::FormalParameter(_) | N::FormalParameterRest(_))
    )
}

/// `{ a() {} }`, `{ get a() {} }` or `{ set a(b) {} }`.
fn is_object_method(node: N<'_>) -> bool {
    matches!(node, N::ObjectProperty(prop)
        if matches!(prop.kind(), PropKind::Method | PropKind::Getter | PropKind::Setter))
}

impl<'a> Rules<'_, 'a, '_> {
    // ───────────────────────────── tokens around the comment ─────────────────────────────

    fn next_token_starts_with(&self, byte: u8) -> bool {
        self.cx.next_token_starts_with(self.context.comment, byte)
    }

    fn prev_token_ends_with(&self, byte: u8) -> bool {
        self.cx.prev_token_ends_with(self.context.comment, byte)
    }

    /// True if there's no token between the comment and `owner`, which comes after it.
    fn is_directly_before(&self, owner: Owner<'a>) -> bool {
        self.context.comment.next_token_start() == self.cx.start_of(owner)
    }

    fn is_on_same_line_as_end_of(&self, owner: Owner<'a>) -> bool {
        // Prettier's `locEnd` of a statement doesn't include the `;`.
        let owner = self.cx.file.without_semicolon(self.cx.span_of(owner));
        let between = owner.between(self.context.comment.span());
        !self.cx.source.has_newline_in_range(between)
    }

    fn is_single_line_block_comment(&self) -> bool {
        self.context.comment.is_block() && !self.context.comment.is_multiline_block()
    }

    // ───────────────────────────── node predicates ─────────────────────────────

    fn union_member_owners(&self, owner: Owner<'a>) -> impl DoubleEndedIterator<Item = Owner<'a>> {
        let types = match owner {
            Owner::Node(N::TSUnionType(ty) | N::TSIntersectionType(ty)) => union_members(ty),
            _ => None,
        };
        (types.into_iter().flatten()).map(|ty| self.cx.owner_of_type(ty))
    }

    /// True if `owner` is an `Identifier` in ESTree.
    fn is_identifier(&self, owner: Option<Owner<'a>>) -> bool {
        match owner {
            Some(Owner::Node(N::IdentifierReference(_) | N::BindingIdentifier(_))) => true,
            Some(Owner::Node(N::FormalParameter(param))) => {
                matches!(param.pat().kind(), PatKind::Ident(_))
                    && param.default().is_none()
                    && !param.is_parameter_property()
            }
            Some(Owner::Name(start)) => !matches!(
                self.cx.file.text().get(start as usize),
                Some(b'#' | b'"' | b'\'' | b'`' | b'0'..=b'9' | b'.')
            ),
            _ => false,
        }
    }

    /// Babel's `ClassPrivateMethod` and `ClassPrivateProperty`. Prettier's node type lists omit them. For oxfmt a
    /// private member is like any other.
    fn is_private_member_of_babel(&self, member: Member<'a>) -> bool {
        self.cx.is_babel()
            && !self.cx.options.flavor.is_oxfmt()
            && member.key().is_some_and(|key| key.is_private())
    }

    fn is_property_like(&self, node: N<'a>) -> bool {
        match node {
            N::PropertyDefinition(member)
            | N::MethodDefinition(member)
            | N::AccessorProperty(member) => !self.is_private_member_of_babel(member),
            N::FormalParameter(param) => param.is_parameter_property(),
            _ => false,
        }
    }

    fn is_function_like(&self, node: N<'a>) -> bool {
        match node {
            // Flow's `HookDeclaration` and `ComponentDeclaration` aren't in Prettier's list.
            N::Function(func)
                if self.cx.file.is_flow() && flow::is_hook_or_component_declaration(func) =>
            {
                false
            }
            N::Function(func) => func.has_body() || !matches!(func.owner(), Node::Stmt(_)),
            N::MethodDefinition(member) => !self.is_private_member_of_babel(member),
            N::ObjectProperty(_) => self.cx.is_babel() && is_object_method(node),
            _ => false,
        }
    }

    fn is_real_function_like(&self, node: N<'a>) -> bool {
        match node {
            N::ArrowFunctionExpression(_)
            | N::Function(_)
            | N::TSCallSignatureDeclaration(_)
            | N::TSConstructSignatureDeclaration(_)
            | N::TSMethodSignature(_)
            | N::TSConstructorType(_)
            | N::TSFunctionType(_) => true,
            N::MethodDefinition(member) => {
                self.cx.is_babel() && !self.is_private_member_of_babel(member)
            }
            N::ObjectProperty(_) => self.cx.is_babel() && is_object_method(node),
            _ => false,
        }
    }

    /// Returns the `key` of a class member or an object property.
    fn key_of(&self, node: N<'a>) -> Option<Owner<'a>> {
        let (key, computed) = match node {
            N::MethodDefinition(member)
            | N::PropertyDefinition(member)
            | N::AccessorProperty(member)
            | N::TSPropertySignature(member)
            | N::TSMethodSignature(member) => (member.key(), member.computed_key()),
            N::ObjectProperty(prop) => (prop.key(), prop.computed_key()),
            _ => return None,
        };
        match computed {
            Some(e) => Some(self.cx.owner_of_expr(e)),
            None => Some(Owner::Name(key?.span(self.cx.file).start)),
        }
    }

    fn body_of_arrow(&self, func: Func<'a>) -> Owner<'a> {
        match func.body() {
            FnBody::Expr(e) => self.cx.owner_of_expr(e),
            _ => Owner::Node(N::FunctionBody(func)),
        }
    }

    fn right_of_assignment(&self, node: N<'a>) -> Option<Owner<'a>> {
        match node {
            N::AssignmentExpression(e) => match e.kind() {
                ExprKind::Assign { value, .. } => Some(self.cx.owner_of_expr(value)),
                _ => None,
            },
            _ => None,
        }
    }

    // ───────────────────────────── blocks ─────────────────────────────

    /// Returns the first statement of a block, or the first member of a class or interface body. Skips empty
    /// statements, and directives for Babel, which doesn't keep them in `body`.
    fn first_child_of_block(&self, block: Owner<'a>) -> Option<Owner<'a>> {
        let first_statement = |statements: List<'a, Stmt<'a>>| {
            (statements.iter())
                .find(|it| {
                    it.tag() != StmtTag::Empty && !(self.cx.is_babel() && it.directive().is_some())
                })
                .map(|it| self.cx.owner_of_stmt(it))
        };
        let first_member = |members: List<'a, Member<'a>>| {
            members.first().map(|it| Owner::Node(it.as_ast_nodes()))
        };
        match block {
            Owner::Node(N::BlockStatement(statement)) => first_statement(statement.as_block()?),
            Owner::Node(N::FunctionBody(func)) => first_statement(func.body_statements()?),
            Owner::Node(N::ClassBody(class)) => first_member(class.members()),
            Owner::Node(N::TSInterfaceBody(statement)) => {
                first_member(statement.as_interface()?.members())
            }
            _ => None,
        }
    }

    fn add_block_statement_first_comment(&self, block: Owner<'a>) -> Attachment<'a> {
        match self.first_child_of_block(block) {
            Some(first) => Attachment::leading(first),
            None => Attachment::dangling(block),
        }
    }

    fn add_block_or_not_comment(&self, owner: Owner<'a>) -> Attachment<'a> {
        match is_block(owner) {
            true => self.add_block_statement_first_comment(owner),
            false => Attachment::leading(owner),
        }
    }

    // ───────────────────────────── handlers ─────────────────────────────

    fn handle_comment(&self, ignored_node: &mut Option<Owner<'a>>) -> Option<Attachment<'a>> {
        let comment = self.context.comment;
        // `handleOnlyComments`: a file with nothing but comments.
        if self.cx.file.body().is_empty() {
            let program = self.cx.program();
            return Some(match self.context.is_last_comment {
                true => Attachment::dangling(program),
                false => Attachment::leading(program),
            });
        }
        let node = match self.enclosing_node {
            Some(Owner::Node(node)) => Some(node),
            _ => None,
        };
        if let Some(attachment) = node
            .and_then(|node| self.handle_comment_in_empty_parens(node))
            .or_else(|| node.and_then(|node| self.handle_comment_before_semicolon_of_export(node)))
        {
            return Some(attachment);
        }
        if let Some(attachment) = self.handle_comment_between_non_null_marks(ignored_node) {
            return Some(attachment);
        }
        if self.cx.options.flavor.is_oxfmt()
            && let Some(attachment) = self.handle_comment_for_oxfmt(node, ignored_node)
        {
            return Some(attachment);
        }
        // `handleClosureTypeCastComments`, which is only in Prettier's list for comments at the end of a line.
        if comment.looks_like_type_cast()
            && self.context.text_position == EndOfLine
            && let Some(following_node) = self.following_node
        {
            return Some(Attachment::leading(following_node));
        }
        self.handle_comments_in_destructuring_pattern()
            .or_else(|| node.and_then(|node| self.handle_by_enclosing_node(node, ignored_node)))
            .or_else(|| self.handle_union_type_leading_comments(ignored_node))
    }

    /// True if `e` is the `a.b`, or the `a.b` in the `a.b.c`, of `typeof a.b.c` or `<a.b.c />`.
    fn is_name_of_type_query_or_jsx_element(&self, e: Expr<'a>) -> bool {
        (self.cx.is_name_of_type_query_or_jsx_element).find(e, member_access_or_is_name)
    }

    /// `a! /* comment */ !`: in ESTree the comment trails the `a!` inside `a!!`. Here `a!!` is one node, which prints
    /// the comment after the same `!` as in the source.
    fn handle_comment_between_non_null_marks(
        &self,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        let Owner::Node(N::TSNonNullExpression(e)) = self.preceding_node? else {
            return None;
        };
        if !e.span().contains(self.context.comment.span()) {
            return None;
        }
        if self.context.is_ignore_comment
            && !self.cx.options.flavor.is_oxfmt()
            && let ExprKind::NonNull(operand) = e.kind()
        {
            *ignored_node = Some(self.cx.owner_of_expr(operand));
        }
        Some(Attachment::dangling(Owner::Node(N::TSNonNullExpression(e))))
    }

    /// True if the comment is directly before the `;` that ends `statement`.
    fn is_before_semicolon_of(&self, statement: Stmt<'a>) -> bool {
        self.following_node.is_none()
            && self.next_token_starts_with(b';')
            && self.context.comment.next_token_start() + 1 == statement.span().end
    }

    /// `export type A = B /* comment */;`. Prettier's `locEnd` of an `export` is the end of its content, so the comment
    /// comes after the `export` and not inside the declaration. It's between the `export` and the next statement.
    fn handle_comment_before_semicolon_of_export(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let statement = match node {
            // Flow's `declare export default A /* comment */;` is a type alias in the tree. The comment trails the `A`.
            N::TSTypeAliasDeclaration(statement) if statement.is_default_export() => return None,
            N::TSTypeAliasDeclaration(statement)
            | N::TSImportEqualsDeclaration(statement)
            | N::TSModuleDeclaration(statement) => statement,
            N::TSInterfaceDeclaration(statement) if is_flow_opaque_type(statement) => statement,
            N::Function(func) => func.owner().as_stmt()?,
            _ => return None,
        };
        // Flow's `declare export function a(): B /* comment */;` is a `DeclareExportDeclaration`, which ends after its
        // `;`.
        if !statement.is_exported()
            || is_flow_declare_export(statement)
            || !self.is_before_semicolon_of(statement)
        {
            return None;
        }
        let following_statement = match self.context.text_position {
            OwnLine => statement_after(statement),
            _ => None,
        };
        Some(match following_statement {
            Some(following_statement) => {
                Attachment::leading(self.cx.owner_of_stmt(following_statement))
            }
            None => Attachment::trailing(self.cx.owner_of_stmt(statement)),
        })
    }

    /// `f(/* comment */)` and `function f(/* comment */) {}`
    fn handle_comment_in_empty_parens(&self, node: N<'a>) -> Option<Attachment<'a>> {
        if !self.next_token_starts_with(b')') || !self.prev_token_ends_with(b'(') {
            return None;
        }
        if let N::CallExpression(e) | N::NewExpression(e) = node {
            let has_no_arguments = e.as_call_like().is_some_and(|call| call.args().is_empty());
            if has_no_arguments
                && self.cx.options.flavor.is_oxfmt()
                && let Some(attachment) = self.handle_comment_in_empty_arguments_for_oxfmt(e)
            {
                return Some(attachment);
            }
            return has_no_arguments.then(|| Attachment::dangling(Owner::Node(node)));
        }
        let func = function_of(node).filter(|func| !has_parameters(*func))?;
        // Flow's `FunctionTypeAnnotation` isn't in Prettier's list, so the comment leads the next node:
        // `() => /* comment */ A`.
        if self.cx.file.is_flow()
            && flow::function_type(func) == Some(FunctionType::FunctionTypeAnnotation)
        {
            let return_type = self.cx.owner_of_type(func.return_type()?);
            return Some(Attachment::leading(return_type));
        }
        if self.is_real_function_like(node) {
            return Some(Attachment::dangling(Owner::Node(node)));
        }
        // With typescript-estree the parameters belong to the `FunctionExpression` inside the method.
        (!self.cx.is_babel() && (matches!(node, N::MethodDefinition(_)) || is_object_method(node)))
            .then(|| Attachment::dangling(Owner::Node(N::Function(func))))
    }

    fn handle_by_enclosing_node(
        &self,
        node: N<'a>,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        let text_position = self.context.text_position;
        let enclosing_node = Owner::Node(node);
        match node {
            N::BinaryExpression(e) if self.cx.file.is_flow() && flow::is_match_or_pattern(e) => {
                self.handle_match_or_pattern_comments(ignored_node)
            }
            // Prettier has no other rule for Flow's `match`, and none for `opaque type` and `record`.
            _ if self.cx.file.is_flow() && flow::is_part_of_match(node) => None,
            N::TSInterfaceDeclaration(statement) if is_flow_opaque_type(statement) => None,
            N::Class(class) if is_flow_record(class) => None,
            // Flow's `A</* comment */>`. For Prettier the enclosing node is the empty `TypeParameterInstantiation`.
            N::TSTypeReference(ty)
                if self.cx.file.is_flow()
                    && self.prev_token_ends_with(b'<')
                    && self.next_token_starts_with(b'>') =>
            {
                let type_arguments = N::TSTypeParameterInstantiation(Node::Type(ty));
                Some(Attachment::dangling(Owner::Node(type_arguments)))
            }

            N::ConditionalExpression(_) | N::TSConditionalType(_) => {
                self.handle_conditional_expression_comments(node)
            }

            // `</* comment */>a</ /* comment */>`. For Prettier the enclosing node is the `JSXOpeningFragment` or the
            // `JSXClosingFragment`, so a `prettier-ignore` comment applies to the tag and not to the fragment.
            N::JSXFragment(e) => {
                let ExprKind::Jsx(jsx) = e.kind() else {
                    return None;
                };
                let is_in_closing_tag = (jsx.closing_span())
                    .is_some_and(|tag| tag.contains(self.context.comment.span()));
                let marker = match is_in_closing_tag {
                    true => Marker::ClosingFragment,
                    false => Marker::None,
                };
                Some(Attachment {
                    is_unignored: true,
                    ..Attachment::dangling_with_marker(enclosing_node, marker)
                })
            }
            N::JSXSpreadAttribute(_) | N::JSXSpreadChild(_)
                if self.cx.options.flavor.is_oxfmt() =>
            {
                self.handle_ignore_comment_in_jsx_spread_for_oxfmt()
            }
            N::JSXOpeningElement(_) if self.cx.options.flavor.is_oxfmt() => {
                self.handle_comment_after_slash_of_jsx_tag_for_oxfmt(node)
            }

            N::StaticMemberExpression(_)
            | N::ComputedMemberExpression(_)
            | N::PrivateFieldExpression(_)
                if self.cx.options.flavor.is_oxfmt() =>
            {
                self.handle_member_expression_comments_for_oxfmt(node)
            }
            // The `a.b` of `typeof a.b` is a `TSQualifiedName` in ESTree, and the `a.b` of `<a.b />` is a
            // `JSXMemberExpression`.
            N::StaticMemberExpression(e) if self.is_name_of_type_query_or_jsx_element(e) => None,
            // `handleMemberExpressionComments`
            N::StaticMemberExpression(_)
            | N::ComputedMemberExpression(_)
            | N::PrivateFieldExpression(_) => (text_position == OwnLine
                && self.is_identifier(self.following_node))
            .then(|| Attachment::leading(enclosing_node)),
            // The `A.B` of `interface C extends A.B {}` is a member expression in ESTree. For oxfmt it's a name.
            N::TSInterfaceHeritage(_) | N::TSClassImplements(_)
                if !self.cx.options.flavor.is_oxfmt() =>
            {
                (text_position == OwnLine
                    && matches!(self.preceding_node, Some(Owner::Name(_)))
                    && matches!(self.following_node, Some(Owner::Name(_))))
                .then(|| Attachment::leading(enclosing_node))
            }

            N::IfStatement(statement) => self.handle_if_statement_comments(statement),
            N::WhileStatement(statement) | N::WithStatement(statement) => {
                self.handle_while_like_comments(statement)
            }
            N::ForStatement(statement)
            | N::ForInStatement(statement)
            | N::ForOfStatement(statement) => self.handle_for_x_statement_comments(statement),
            N::SwitchStatement(statement) => self.handle_switch_statement_comments(statement),
            N::SwitchCase(case) if text_position == EndOfLine => {
                self.handle_switch_default_case_comments(case)
            }
            N::TryStatement(_) | N::CatchClause(_) if text_position != Remaining => {
                self.handle_try_statement_comments(node)
            }
            // `handleLabeledStatementComments`
            N::LabeledStatement(_) if text_position != Remaining => {
                Some(Attachment::leading(enclosing_node))
            }

            N::Class(_) | N::TSInterfaceDeclaration(_) if text_position != Remaining => {
                self.handle_class_comments(node, ignored_node)
            }

            N::Function(_)
            | N::ArrowFunctionExpression(_)
            | N::MethodDefinition(_)
            | N::TSMethodSignature(_)
            | N::TSCallSignatureDeclaration(_)
            | N::TSConstructSignatureDeclaration(_)
            | N::TSFunctionType(_)
            | N::TSConstructorType(_) => self.handle_function_comments(node),
            // An `ImportAttribute`. In an import type it's a property of an object.
            N::ObjectProperty(prop)
                if prop.is_import_attribute() && matches!(prop.parent(), Node::Stmt(_)) =>
            {
                None
            }
            N::ObjectProperty(_) if is_object_method(node) => self.handle_function_comments(node),
            N::PropertyDefinition(_) | N::AccessorProperty(_) => {
                self.handle_method_name_comments(node)
            }

            N::ObjectProperty(_)
            | N::BindingProperty(_)
            | N::AssignmentTargetPropertyIdentifier(_)
            | N::AssignmentTargetPropertyProperty(_) => match text_position {
                // `handlePropertyComments`. For oxfmt the comment stays where it is: `{ [// comment⏎a]: b }`
                EndOfLine if !self.cx.options.flavor.is_oxfmt() => {
                    Some(Attachment::leading(enclosing_node))
                }
                _ => self.handle_method_name_comments(node),
            },

            // `handleAssignmentPatternComments`
            N::AssignmentPattern(_) | N::AssignmentTargetWithDefault(_) => {
                (text_position == OwnLine).then(|| Attachment::leading(enclosing_node))
            }
            N::FormalParameter(param) if param.is_parameter_property() => {
                self.handle_method_name_comments(node).or_else(|| {
                    self.handle_comment_in_parameter_property_with_default_for_oxfmt(param)
                })
            }
            N::FormalParameter(param) => (text_position == OwnLine && param.default().is_some())
                .then(|| Attachment::leading(enclosing_node)),

            // `handleModuleSpecifiersComments`
            N::ImportSpecifier(_) | N::ExportSpecifier(_) if text_position != Remaining => {
                Some(Attachment::leading(enclosing_node))
            }
            N::ImportDeclaration(_) | N::ExportNamedDeclaration(_)
                if text_position != Remaining =>
            {
                let specifier = self.preceding_node.filter(|it| {
                    matches!(
                        it,
                        Owner::Node(N::ImportSpecifier(_) | N::ExportSpecifier(_))
                    )
                })?;
                (self.context.comment.has_newline_after()).then(|| Attachment::trailing(specifier))
            }

            // Flow's `DeclareTypeAlias` isn't in Prettier's list.
            N::TSTypeAliasDeclaration(statement)
                if self.cx.file.is_flow() && statement.flags().contains(Flags::AMBIENT) =>
            {
                None
            }
            N::VariableDeclarator(_)
            | N::AssignmentExpression(_)
            | N::TSTypeAliasDeclaration(_)
                if text_position != OwnLine =>
            {
                self.handle_assignment_like_comments(node)
                    .or_else(|| self.handle_parenthesized_expression_trailing_comment(node))
            }
            N::ExpressionStatement(ExpressionStatement::Stmt(_)) | N::ReturnStatement(_)
                if text_position != OwnLine =>
            {
                self.handle_parenthesized_expression_trailing_comment(node)
            }

            N::CallExpression(e) | N::NewExpression(e) if self.cx.options.flavor.is_oxfmt() => {
                self.handle_call_expression_comments_for_oxfmt(e)
            }
            N::CallExpression(e) | N::NewExpression(e) if text_position == EndOfLine => {
                self.handle_call_expression_comments(e)
            }
            N::TaggedTemplateExpression(_) if self.cx.options.flavor.is_oxfmt() => {
                self.handle_tagged_template_comments_for_oxfmt()
            }
            N::ArrayExpression(e) if self.cx.options.flavor.is_oxfmt() => {
                self.handle_array_hole_comments_for_oxfmt(e)
            }
            // For oxfmt the comment trails `a && b`, like any other comment before a `)`.
            N::UnaryExpression(e)
                if text_position == EndOfLine && !self.cx.options.flavor.is_oxfmt() =>
            {
                self.handle_last_binary_operator_operand(e)
            }
            N::TSAsExpression(e) | N::TSSatisfiesExpression(e) => {
                let for_oxfmt = match self.cx.options.flavor.is_oxfmt() {
                    true => self.handle_comment_after_cast_operator_for_oxfmt(e),
                    false => None,
                };
                for_oxfmt.or_else(|| self.handle_binary_cast_expression_comment(e))
            }
            N::SequenceExpression(_) if self.cx.options.flavor.is_oxfmt() => {
                self.handle_sequence_expression_leading_comment_for_oxfmt(node)
            }
            N::LogicalExpression(e) | N::BinaryExpression(e)
                if text_position == EndOfLine && self.cx.options.flavor.is_oxfmt() =>
            {
                self.handle_comment_before_parenthesized_logical_expression_for_oxfmt(e)
                    .or_else(|| self.handle_comment_after_binary_operator_for_oxfmt(e))
            }

            N::TSUnionType(_) if text_position == OwnLine => {
                // `handleUnionTypeComments`
                if self.context.is_ignore_comment {
                    *ignored_node = self.following_node;
                }
                self.preceding_node.map(Attachment::trailing)
            }
            N::TSUnionType(_) | N::TSIntersectionType(_) if text_position == EndOfLine => {
                self.handle_last_union_element_in_expression()
            }
            N::TSUnionType(_) if self.cx.options.flavor.is_oxfmt() => {
                self.handle_ignore_comment_before_union_operator_for_oxfmt()
            }
            // `A[ /* a ⏎ b */ ]`. Prettier and oxfmt print `A /* a ⏎ b */[]`, which doesn't parse: a line break before
            // the `[` ends the type.
            N::TSArrayType(_)
                if self.context.comment.is_multiline_block()
                    && self.next_token_starts_with(b']') =>
            {
                Some(Attachment::trailing(enclosing_node))
            }
            N::TSArrayType(_) if text_position == EndOfLine && self.following_node.is_none() => {
                self.handle_last_union_element_in_expression()
            }
            // Flow's `ObjectTypeMappedTypeProperty` has no rule.
            N::TSMappedType(_) if self.cx.file.is_flow() => None,
            N::TSMappedType(ty) => self.handle_mapped_type_comments(ty, ignored_node),
            N::TSPropertySignature(_) => self.handle_property_signature_comments(),
            // `- /* prettier-ignore */ 1`. The `1` is a node in ESTree, and the comment ignores only that.
            N::TSLiteralType(_) => Some(Attachment {
                is_unignored: true,
                ..Attachment::dangling(enclosing_node)
            }),
            // `unique /* prettier-ignore */ symbol`, likewise.
            N::TSTypeOperator(ty) if matches!(ty.kind(), TypeKind::UniqueSymbol) => {
                Some(Attachment {
                    is_unignored: true,
                    ..Attachment::dangling(enclosing_node)
                })
            }
            N::TSImportType(ty) | N::TSTypeQuery(ty) => {
                self.handle_comment_after_attributes_of_import_type(ty)
            }
            _ => None,
        }
    }

    /// Also `handleNestedConditionalExpressionComments`.
    fn handle_conditional_expression_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let (text_position, enclosing_node) = (self.context.text_position, Owner::Node(node));
        let experimental_ternaries = self.cx.options.experimental_ternaries;
        if text_position == Remaining {
            return None;
        }
        if let Some(following_node) = self.following_node
            && !self
                .preceding_node
                .is_some_and(|it| self.is_on_same_line_as_end_of(it))
        {
            let alternate = match node {
                // With typescript-estree the `alternate` can be a `ChainExpression`, which is never the following node.
                N::ConditionalExpression(e) => match e.kind() {
                    ExprKind::Cond { no, .. } if self.cx.is_babel() || !no.is_chain_root() => {
                        Some(self.cx.owner_of_expr(no))
                    }
                    _ => None,
                },
                // A conditional type has a `falseType` instead of an `alternate`.
                _ => None,
            };
            let dangles = experimental_ternaries
                && alternate == Some(following_node)
                && !self.is_single_line_block_comment();
            return Some(match dangles {
                true => Attachment::dangling(enclosing_node),
                false => Attachment::leading(following_node),
            });
        }
        (text_position == OwnLine && experimental_ternaries && is_conditional(self.following_node))
            .then(|| Attachment::dangling(enclosing_node))
    }

    fn handle_if_statement_comments(&self, statement: Stmt<'a>) -> Option<Attachment<'a>> {
        let StmtKind::If { yes, no, .. } = statement.kind() else {
            return None;
        };
        let following_node = self.following_node?;
        if self.next_token_starts_with(b')') {
            return self.preceding_node.map(Attachment::trailing);
        }
        let consequent = self.cx.owner_of_stmt(yes);
        if following_node == consequent {
            return Some(Attachment::leading(following_node));
        }
        let preceding_node = self.preceding_node.filter(|it| *it == consequent)?;
        if Some(following_node) != no.map(|it| self.cx.owner_of_stmt(it)) {
            return None;
        }
        // `else /* comment */ b`
        if self.is_directly_before(following_node) {
            return Some(Attachment::leading(following_node));
        }
        let trails_consequent = !is_block(preceding_node)
            && !self.context.comment.is_multiline_block()
            && self.is_on_same_line_as_end_of(preceding_node);
        Some(match trails_consequent {
            true => Attachment::trailing(preceding_node),
            false => Attachment::dangling(Owner::Node(N::IfStatement(statement))),
        })
    }

    fn handle_while_like_comments(&self, statement: Stmt<'a>) -> Option<Attachment<'a>> {
        let (StmtKind::While { body, .. } | StmtKind::With { body, .. }) = statement.kind() else {
            return None;
        };
        let following_node = self.following_node?;
        if self.next_token_starts_with(b')') {
            return self.preceding_node.map(Attachment::trailing);
        }
        (following_node == self.cx.owner_of_stmt(body)).then(|| Attachment::leading(following_node))
    }

    /// `for (;;) /* comment */ a;`
    fn handle_for_x_statement_comments(&self, statement: Stmt<'a>) -> Option<Attachment<'a>> {
        let (StmtKind::For { body, .. }
        | StmtKind::ForIn { body, .. }
        | StmtKind::ForOf { body, .. }) = statement.kind()
        else {
            return None;
        };
        let body = self
            .following_node
            .filter(|it| *it == self.cx.owner_of_stmt(body))?;
        self.is_directly_before(body)
            .then(|| Attachment::leading(body))
    }

    /// `switch (a) { /* comment */ }`
    fn handle_switch_statement_comments(&self, statement: Stmt<'a>) -> Option<Attachment<'a>> {
        let StmtKind::Switch { expr, cases } = statement.kind() else {
            return None;
        };
        let is_in_empty_braces = cases.is_empty()
            && self.following_node.is_none()
            && self.preceding_node == Some(self.cx.owner_of_expr(expr))
            && self.next_token_starts_with(b'}');
        is_in_empty_braces.then(|| Attachment::dangling(Owner::Node(N::SwitchStatement(statement))))
    }

    /// `default: // comment`
    fn handle_switch_default_case_comments(&self, case: Case<'a>) -> Option<Attachment<'a>> {
        let following_node = self.following_node?;
        let first = case.body().first().map(|it| self.cx.owner_of_stmt(it));
        if case.test().is_some() || first != Some(following_node) {
            return None;
        }
        Some(
            match is_block(following_node) && self.context.comment.is_line() {
                true => self.add_block_statement_first_comment(following_node),
                false => Attachment::dangling(Owner::Node(N::SwitchCase(case))),
            },
        )
    }

    fn handle_try_statement_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let following_node = self.following_node?;
        if let (N::CatchClause(_), Some(preceding_node)) = (node, self.preceding_node) {
            return Some(Attachment::trailing(preceding_node));
        }
        match following_node {
            _ if is_block(following_node) => {
                Some(self.add_block_statement_first_comment(following_node))
            }
            Owner::Node(N::CatchClause(statement)) => match statement.kind() {
                StmtKind::Try {
                    handler: Some(handler),
                    ..
                } => Some(self.add_block_or_not_comment(self.cx.owner_of_stmt(handler))),
                _ => None,
            },
            _ => None,
        }
    }

    /// Comments between the parts of the head of a class or an interface.
    fn handle_class_comments(
        &self,
        node: N<'a>,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        let cx = self.cx;
        let type_parameters = |owner: Node<'a>, is_empty: bool| {
            (!is_empty).then_some(Owner::Node(N::TSTypeParameterDeclaration(owner)))
        };
        let first_type =
            |types: List<'a, TypeNode<'a>>| types.first().map(|it| Owner::Node(it.as_ast_nodes()));
        let no_clause = (None, Marker::None);
        let (last_decorator, id, type_parameters, super_class, clauses, body) = match node {
            // Flow's `DeclareClass` has no `superClass`: `extends` is a list like `implements` and `mixins`.
            N::Class(class) if is_declared_class(class) => (
                None,
                class.name().map(|it| Owner::Name(it.span().start)),
                type_parameters(Node::Class(class), class.type_params().is_empty()),
                None,
                [
                    (first_type(class.implements()), Marker::Implements),
                    (
                        class.extends().map(|e| cx.owner_of_expr(e)),
                        Marker::Extends,
                    ),
                    (first_type(class.flow_mixins()), Marker::Mixins),
                ],
                Owner::Node(N::ClassBody(class)),
            ),
            N::Class(class) => (
                (class.modifiers().iter().rev())
                    .find_map(|it| it.decorator())
                    .map(|e| Owner::Node(N::Decorator(e))),
                class.name().map(|it| Owner::Name(it.span().start)),
                type_parameters(Node::Class(class), class.type_params().is_empty()),
                // `extends a?.b`: with typescript-estree the `superClass` is a `ChainExpression`, which is never next
                // to a comment.
                (class.extends())
                    .filter(|e| cx.is_babel() || !e.is_chain_root())
                    .map(|e| cx.owner_of_expr(e)),
                [
                    (first_type(class.implements()), Marker::Implements),
                    no_clause,
                    no_clause,
                ],
                Owner::Node(N::ClassBody(class)),
            ),
            N::TSInterfaceDeclaration(statement) => {
                let interface = statement.as_interface()?;
                (
                    None,
                    Some(Owner::Name(interface.name().span().start)),
                    type_parameters(Node::Stmt(statement), interface.type_params().is_empty()),
                    None,
                    [
                        (first_type(interface.extends()), Marker::Extends),
                        no_clause,
                        no_clause,
                    ],
                    Owner::Node(N::TSInterfaceBody(statement)),
                )
            }
            _ => return None,
        };
        if let Some(last) = last_decorator
            && !matches!(self.following_node, Some(Owner::Node(N::Decorator(_))))
        {
            // For oxfmt only a comment directly after the decorators trails them.
            let trails_decorator = !self.cx.options.flavor.is_oxfmt()
                || self.context.comment.prev_token_end() == self.cx.span_of(last).end;
            if trails_decorator {
                return Some(Attachment::trailing(last));
            }
        }
        if self.following_node == Some(body) {
            if !self.cx.options.flavor.is_oxfmt() {
                return Some(self.add_block_statement_first_comment(body));
            }
            // `class A extends (B // comment⏎) {}`: see `handle_comment_before_body_for_oxfmt`. A `prettier-ignore`
            // comment there ignores `B`.
            if self.context.is_ignore_comment && self.preceding_node == super_class {
                *ignored_node = super_class;
            }
            return Some(Attachment::leading(body));
        }
        let following_node = self.following_node?;
        let name =
            (self.preceding_node).filter(|it| Some(*it) == id || Some(*it) == type_parameters);
        if Some(following_node) == super_class {
            return name.map(Attachment::trailing);
        }
        let (_, marker) = (clauses.into_iter())
            .find(|(first_of_clause, _)| *first_of_clause == Some(following_node))?;
        // `class // comment⏎implements A {}` has nothing before the comment.
        match name.or_else(|| self.preceding_node.filter(|it| Some(*it) == super_class)) {
            Some(preceding_node) => Some(Attachment::trailing(preceding_node)),
            None => Some(Attachment::dangling_with_marker(Owner::Node(node), marker)),
        }
    }

    /// Flow: `| a⏎// comment⏎| b` in a pattern of a `match`.
    fn handle_match_or_pattern_comments(
        &self,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        if self.context.text_position != OwnLine {
            return None;
        }
        if self.context.is_ignore_comment {
            *ignored_node = self.following_node;
        }
        self.preceding_node.map(Attachment::trailing)
    }

    /// Flow: a comment before the `(` of a function type that comes directly after a name or a modifier. After type
    /// parameters it's between two nodes like any other comment: `f<T> /* comment */(): void`
    ///
    /// - `declare function f /* comment */ (): void` and `{ static /* comment */ (): void }`: the comment leads the
    ///   function type, which starts at the `(`. Prettier prints `f/* comment */ (): void`.
    /// - `{ m /* comment */ (): void }`: the function type starts at the `m`, so the comment leads the next node in it.
    ///   Prettier prints `m(): /* comment */ void`.
    /// - `{ get a /* comment */ (): void }`: the comment trails the `a`.
    fn handle_comment_before_parenthesis_of_function_type(
        &self,
        node: N<'a>,
    ) -> Option<Attachment<'a>> {
        let func = function_of(node)?;
        if func.open_paren() != Some(self.context.comment.next_token_start())
            || !func.type_params().is_empty()
            || flow::function_type(func) == Some(FunctionType::ComponentTypeAnnotation)
        {
            return None;
        }
        match node {
            N::Function(_) | N::TSCallSignatureDeclaration(_) => Some(Attachment {
                is_unignored: true,
                ..Attachment::leading(Owner::Node(N::FormalParameters(func)))
            }),
            N::TSMethodSignature(member)
                if matches!(
                    member.kind(),
                    bun_lint::ast::MemberKind::Getter | bun_lint::ast::MemberKind::Setter
                ) =>
            {
                self.preceding_node.map(Attachment::trailing)
            }
            N::TSMethodSignature(_) => {
                Some(Attachment::leading(match func.params_with_this().next() {
                    Some(first) => Owner::Node(first.as_ast_nodes()),
                    None => self.cx.owner_of_type(func.return_type()?),
                }))
            }
            _ => None,
        }
    }

    /// Flow: `declare function f(a: A): boolean %checks(a) /* comment */;`. The comment trails the `DeclaredPredicate`,
    /// which is part of the return type in the tree.
    fn handle_comment_after_declared_predicate(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let N::Function(func) = node else {
            return None;
        };
        let return_type = func.return_type()?;
        (as_declared_predicate(return_type).is_some()
            && self.preceding_node == Some(self.cx.owner_of_type(return_type))
            && self.following_node.is_none())
        .then(|| Attachment {
            is_unignored: true,
            ..Attachment::dangling(Owner::Node(node))
        })
    }

    fn handle_function_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        // The other rules don't apply to Flow's function types.
        if self.cx.file.is_flow()
            && function_of(node).is_some_and(|it| flow::function_type(it).is_some())
        {
            return self
                .handle_comment_before_parenthesis_of_function_type(node)
                .or_else(|| self.handle_comment_after_declared_predicate(node))
                .or_else(|| match self.context.text_position {
                    OwnLine | EndOfLine => self.handle_last_function_parameter_comments(node),
                    Remaining => None,
                });
        }
        match self.context.text_position {
            OwnLine => self
                .handle_last_function_parameter_comments(node)
                .or_else(|| self.handle_method_name_comments(node)),
            EndOfLine => self
                .handle_last_function_parameter_comments(node)
                .or_else(|| self.handle_arrow_expression_comments(node))
                .or_else(|| self.handle_parenthesized_expression_trailing_comment(node)),
            Remaining => self
                .handle_method_name_comments(node)
                .or_else(|| self.handle_comment_after_arrow_params(node))
                .or_else(|| self.handle_function_name_comments(node))
                .or_else(|| self.handle_ts_function_trailing_comments(node))
                .or_else(|| self.handle_parenthesized_expression_trailing_comment(node)),
        }
    }

    /// `function f(a /* comment */) {}`
    fn handle_last_function_parameter_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let has_no_body = || {
            matches!(node, N::MethodDefinition(member)
            if member.func().is_some_and(|func| !func.has_body()))
        };
        let is_parameter = |owner: Owner<'a>| {
            is_parameter(owner) || matches!(owner, Owner::Node(N::TSThisParameter(_)))
        };
        // `type A = (a: B) // comment⏎ => C`. In `declare component` the comment has to be before the `)`. A hook type
        // has no rule.
        if self.cx.file.is_flow()
            && let Some(function_type) = function_of(node).and_then(flow::function_type)
        {
            let preceding_node = self.preceding_node.filter(|it| is_parameter(*it))?;
            return match function_type {
                FunctionType::ComponentTypeAnnotation if matches!(node, N::Function(_)) => {
                    self.next_token_starts_with(b')')
                }
                FunctionType::FunctionTypeAnnotation | FunctionType::ComponentTypeAnnotation => {
                    !self.following_node.is_some_and(is_parameter)
                }
                FunctionType::HookTypeAnnotation => false,
            }
            .then(|| Attachment::trailing(preceding_node));
        }
        if let Some(preceding_node) = self.preceding_node
            && is_parameter(preceding_node)
            && (self.is_real_function_like(node) || has_no_body())
            && self.next_token_starts_with(b')')
        {
            return Some(Attachment::trailing(preceding_node));
        }
        // `function f() // comment` with the `{` on the next line.
        let body = self
            .following_node
            .filter(|it| matches!(it, Owner::Node(N::FunctionBody(_))))?;
        let goes_into_body = !self.context.comment.is_block()
            && self.is_function_like(node)
            && self.is_directly_before(body);
        goes_into_body.then(|| self.add_block_statement_first_comment(body))
    }

    fn handle_method_name_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let text_position = self.context.text_position;
        if text_position == EndOfLine {
            return None;
        }
        // `obj = { fn /* comment */() {} }`. Babel doesn't need this.
        if let Some(preceding_node) = self.preceding_node
            && match node {
                // Not in `{ key: (/* comment */ (value)) }`.
                N::ObjectProperty(_) => !self.cx.is_babel() && is_object_method(node),
                // `TSAbstractMethodDefinition`
                N::MethodDefinition(member) => member.flags().contains(Flags::ABSTRACT),
                _ => false,
            }
            && self.is_identifier(Some(preceding_node))
            && self.key_of(node) == Some(preceding_node)
            && self.next_token_starts_with(b'(')
        {
            return Some(Attachment::trailing(preceding_node));
        }
        if !self.is_property_like(node) {
            return None;
        }
        if self.following_node.is_none() && text_position == Remaining {
            return match self.next_token_starts_with(b'(') {
                true => self.preceding_node.map(Attachment::trailing),
                false => Some(Attachment::trailing(Owner::Node(node))),
            };
        }
        let decorator = self
            .preceding_node
            .filter(|it| matches!(it, Owner::Node(N::Decorator(_))))?;
        // `@a⏎/* comment */ @b() c;` stays as it is for oxfmt: the comment leads `@b()`.
        if self.cx.options.flavor.is_oxfmt()
            && !self.context.comment.has_newline_after()
            && matches!(self.following_node, Some(Owner::Node(N::Decorator(_))))
        {
            return None;
        }
        (self.context.comment.is_line() || text_position == OwnLine)
            .then(|| Attachment::trailing(decorator))
    }

    /// `(a) /* comment */ => b`
    fn handle_comment_after_arrow_params(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let N::ArrowFunctionExpression(func) = node else {
            return None;
        };
        (func.arrow_span()?.start == self.context.comment.next_token_start()).then_some(
            Attachment::dangling_with_marker(Owner::Node(node), Marker::CommentBeforeArrow),
        )
    }

    /// `function f /* comment */() {}`
    fn handle_function_name_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let preceding_node = self.preceding_node?;
        (self.next_token_starts_with(b'(') && self.is_function_like(node))
            .then(|| Attachment::trailing(preceding_node))
    }

    /// `declare function f() /* comment */;`
    fn handle_ts_function_trailing_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        if self.following_node.is_some() {
            return None;
        }
        let func = match node {
            N::TSMethodSignature(member) => member.func()?,
            N::MethodDefinition(member) => member.func().filter(|func| !func.has_body())?,
            N::Function(func) if !func.has_body() && matches!(func.owner(), Node::Stmt(_)) => func,
            _ => return None,
        };
        // The `returnType` of a `TSAbstractMethodDefinition` is on its `value`, so Prettier doesn't see it here.
        let return_type = (func.return_type())
            .filter(|_| !matches!(node, N::MethodDefinition(_)))
            .map(|ty| Owner::Node(N::TSTypeAnnotation(ty)));
        let is_after_head = (self.preceding_node.is_none() || self.preceding_node != return_type)
            && self.next_token_starts_with(b';');
        is_after_head.then(|| Attachment::trailing(Owner::Node(node)))
    }

    /// `(a) => // comment` with the body on the next line.
    fn handle_arrow_expression_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let N::ArrowFunctionExpression(func) = node else {
            return None;
        };
        let following_node = self
            .following_node
            .filter(|_| self.preceding_node.is_some())?;
        (self.context.comment.span().start >= func.arrow_span()?.end)
            .then(|| self.add_block_or_not_comment(following_node))
    }

    /// `f( // comment` with the first argument on the next line.
    fn handle_call_expression_comments(&self, e: Expr<'a>) -> Option<Attachment<'a>> {
        let call = e.as_call_like()?;
        let first = call.args().first()?;
        let is_after_paren = self.preceding_node == Some(self.cx.owner_of_expr(call.callee()))
            && self.prev_token_ends_with(b'(');
        is_after_paren.then(|| Attachment::leading(self.cx.owner_of_expr(first)))
    }

    /// `!(a && // comment 1` / `b // comment 2` / `)`: comment 2 belongs to `b`, not to `a && b`.
    fn handle_last_binary_operator_operand(&self, unary: Expr<'a>) -> Option<Attachment<'a>> {
        let Owner::Node(N::LogicalExpression(e) | N::BinaryExpression(e)) = self.preceding_node?
        else {
            return None;
        };
        let (ExprKind::Binary { right, .. }, ExprKind::Unary { operand, .. }) =
            (e.kind(), unary.kind())
        else {
            return None;
        };
        if self.following_node.is_some() || self.context.comment.is_multiline_block() {
            return None;
        }
        let right = self.cx.owner_of_expr(right);
        let right_start = self.cx.start_of(right);
        let argument_start = self.cx.start_of(self.cx.owner_of_expr(operand));
        let has_newline = |from, to| self.cx.source.has_newline_in_range(Span::new(from, to));
        let is_on_line_of_right = has_newline(argument_start, right_start)
            && !has_newline(right_start, self.context.comment.span().start);
        is_on_line_of_right.then(|| Attachment::trailing(right))
    }

    /// A multi-line block comment between the expression and `as` or `satisfies`.
    fn handle_binary_cast_expression_comment(&self, e: Expr<'a>) -> Option<Attachment<'a>> {
        let (ExprKind::As { expr, .. }
        | ExprKind::Satisfies { expr, .. }
        | ExprKind::AsConst(expr)) = e.kind()
        else {
            return None;
        };
        if self.preceding_node != Some(self.cx.owner_of_expr(expr))
            || !self.context.comment.is_multiline_block()
        {
            return None;
        }
        Some(match self.following_node {
            Some(following_node) => Attachment::leading(following_node),
            None => Attachment::trailing(self.enclosing_node?),
        })
    }

    fn should_attach_to_union_type_first_element(&self, owner: Owner<'a>) -> bool {
        let comment = self.context.comment;
        let between = Span::after(comment.span(), self.cx.start_of(owner));
        is_union(owner)
            && self.is_single_line_block_comment()
            && !self.context.is_ignore_comment
            && self.is_directly_before(owner)
            && !self.cx.source.has_newline_in_range(between)
    }

    fn add_leading_comment_to_possible_union_type(
        &self,
        owner: Owner<'a>,
    ) -> Option<Attachment<'a>> {
        match self.should_attach_to_union_type_first_element(owner) {
            true => self
                .union_member_owners(owner)
                .next()
                .map(Attachment::leading),
            false => Some(Attachment::leading(owner)),
        }
    }

    /// `a = // comment` with the right side on the next line.
    fn handle_assignment_like_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let following_node = self.following_node?;
        let is_complex = matches!(
            following_node,
            Owner::Node(
                N::ObjectExpression(_)
                    | N::ArrayExpression(_)
                    | N::TemplateLiteral(_)
                    | N::TaggedTemplateExpression(_)
                    | N::TSTypeLiteral(_)
            )
        );
        if self.context.text_position == EndOfLine
            && (is_complex || self.context.comment.is_block())
        {
            return self.add_leading_comment_to_possible_union_type(following_node);
        }
        match self.is_after_operator_of_type_alias(node) {
            true => self.add_leading_comment_to_possible_union_type(following_node),
            false => None,
        }
    }

    /// `type A = /* comment */ B`, `type A = (/* comment */ B)`. Prettier looks for the first `=` after the name, so
    /// the `=` of a default counts: `type A<T = B> /* comment */ = C`.
    fn is_after_operator_of_type_alias(&self, node: N<'a>) -> bool {
        let N::TSTypeAliasDeclaration(statement) = node else {
            return false;
        };
        let StmtKind::TypeAlias(alias) = statement.kind() else {
            return false;
        };
        let type_params = alias.type_params();
        let has_default = type_params.iter().any(|param| param.default().is_some());
        let left_side_end = match type_params.angle_brackets_span() {
            Some(angle_brackets) if !has_default => angle_brackets.end,
            _ => alias.name().span().end,
        };
        self.context.comment.prev_token_end() > left_side_end
    }

    /// `a = (b /* comment */);`
    fn handle_parenthesized_expression_trailing_comment(
        &self,
        node: N<'a>,
    ) -> Option<Attachment<'a>> {
        if self.following_node.is_some() {
            return None;
        }
        let (enclosing_node, preceding_node) = (Owner::Node(node), self.preceding_node?);
        if matches!(node, N::ExpressionStatement(_)) {
            return Some(Attachment::trailing(enclosing_node));
        }
        let is_right = self.right_of_assignment(node) == Some(preceding_node);
        let is_body = matches!(node, N::ArrowFunctionExpression(func) if self.body_of_arrow(func) == preceding_node);
        let is_whole_right_side = is_right
            || is_body
            || match node {
                N::VariableDeclarator(declaration) => {
                    declaration.init().map(|e| self.cx.owner_of_expr(e)) == Some(preceding_node)
                }
                N::ReturnStatement(_) => true,
                _ => false,
            };
        if !is_whole_right_side {
            return None;
        }
        match preceding_node {
            Owner::Node(N::SequenceExpression(e)) => match e.kind() {
                ExprKind::Binary { right, .. } => {
                    Some(Attachment::trailing(self.cx.owner_of_expr(right)))
                }
                _ => None,
            },
            Owner::Node(assignment @ N::AssignmentExpression(_)) => self
                .right_of_assignment(assignment)
                .map(Attachment::trailing),
            _ => None,
        }
    }

    /// `(A | B // comment` / `)[]`
    fn handle_last_union_element_in_expression(&self) -> Option<Attachment<'a>> {
        let union = self.preceding_node.filter(|it| is_union(*it))?;
        self.union_member_owners(union)
            .next_back()
            .map(Attachment::trailing)
    }

    /// `import("a", { with: { b: "c" } /* comment */ }).D`. In ESTree the comment is in the outer object, which isn't a
    /// node here, so `D` doesn't follow it.
    fn handle_comment_after_attributes_of_import_type(
        &self,
        ty: TypeNode<'a>,
    ) -> Option<Attachment<'a>> {
        let attributes = self.cx.owner_of_expr(ty.import_attributes()?.object());
        let is_in_outer_object =
            self.next_token_starts_with(b'}') || self.next_token_starts_with(b',');
        (self.preceding_node == Some(attributes) && is_in_outer_object)
            .then(|| Attachment::trailing(attributes))
    }

    /// `handleIgnoreComments` and `handleTSMappedTypeComments`.
    fn handle_mapped_type_comments(
        &self,
        ty: TypeNode<'a>,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        let TypeKind::Mapped(mapped) = ty.kind() else {
            return None;
        };
        let (comment, text_position) = (self.context.comment, self.context.text_position);
        let enclosing_node = Owner::Node(N::TSMappedType(ty));
        let key_start = mapped.param().name().span().start;
        if text_position != EndOfLine
            && self.context.is_ignore_comment
            && self.following_node == Some(Owner::Name(key_start))
        {
            *ignored_node = Some(enclosing_node);
            return Some(Attachment::dangling_with_marker(
                enclosing_node,
                Marker::InIgnoredNode,
            ));
        }
        // `{ /* comment */ [K in T]: V }`. Prettier requires something between the comment and the `[`:
        // `{ /* comment */[K in T]: V }` is `{ [/* comment */ K in T]: V }`. oxfmt doesn't.
        let touches_bracket = comment.span().end == comment.next_token_start()
            && self.next_token_starts_with(b'[')
            && !self.cx.options.flavor.is_oxfmt();
        (comment.next_token_start() < key_start && !touches_bracket)
            .then(|| Attachment::dangling(enclosing_node))
    }

    /// `{ a: // comment ⏎ | B | C }` in a type.
    fn handle_property_signature_comments(&self) -> Option<Attachment<'a>> {
        let following_node = self.following_node.filter(|it| {
            matches!(
                it,
                Owner::Node(N::TSUnionType(_) | N::TSIntersectionType(_))
            )
        })?;
        (self.context.text_position == EndOfLine).then(|| Attachment::leading(following_node))
    }

    /// `const { a } // comment⏎: T = b`. In ESTree the type annotation is a child of the pattern, so the pattern is the
    /// enclosing node, and the preceding node is its last property or element. The type annotation of `...[a]: T` is a
    /// child of the `RestElement`.
    fn handle_comments_in_destructuring_pattern(&self) -> Option<Attachment<'a>> {
        let (
            Owner::Node(N::ObjectPattern(pattern) | N::ArrayPattern(pattern)),
            Owner::Node(N::TSTypeAnnotation(_)),
        ) = (self.preceding_node?, self.following_node?)
        else {
            return None;
        };
        if self.context.text_position == Remaining
            || matches!(pattern.parent(), Node::Param(param) if param.is_rest())
        {
            return None;
        }
        // The rule is for a `TSTypeAnnotation`. Flow has a `TypeAnnotation`, so a comment on its own line leads it.
        if self.cx.file.is_flow() && self.context.text_position == OwnLine {
            return self.following_node.map(Attachment::leading);
        }
        let last_child = match pattern.kind() {
            PatKind::Object(properties) => properties.last().map(N::BindingProperty),
            PatKind::Array(elements) => {
                let last = elements.iter().rev().find(|it| it.pat().is_some());
                last.and_then(|element| match (element.default(), element.is_rest()) {
                    (Some(_), _) => Some(N::AssignmentPattern(Node::PatElem(element))),
                    (None, true) => Some(N::BindingRestElement(Node::PatElem(element))),
                    (None, false) => element.pat().map(|it| it.as_ast_nodes()),
                })
            }
            _ => None,
        };
        Some(match last_child {
            Some(last_child) => Attachment::trailing(Owner::Node(last_child)),
            None => Attachment::dangling(self.preceding_node?),
        })
    }

    /// Also the second half of `handleUnionTypeComments`, for a `prettier-ignore` comment before a union type.
    fn handle_union_type_leading_comments(
        &self,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        let union = self.following_node.filter(|it| is_union(*it))?;
        let text_position = self.context.text_position;
        if text_position == OwnLine && self.context.is_ignore_comment {
            *ignored_node = self.union_member_owners(union).next();
        }
        match text_position != EndOfLine && self.should_attach_to_union_type_first_element(union) {
            true => self
                .union_member_owners(union)
                .next()
                .map(Attachment::leading),
            false => None,
        }
    }
}
