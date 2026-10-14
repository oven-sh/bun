//! The special cases of comment attachment, from Prettier's `handle-comments.js`.
//!
//! Each `handle_*` function has the name of the Prettier function it implements. Prettier runs its handlers one after the
//! other, and almost every handler starts by checking the type of the enclosing node. Here
//! [`Rules::handle_by_enclosing_node`] checks that type once and only calls the handlers that apply to it, in Prettier's order.
//!
//! Where Prettier scans the source text for a token such as `else` or `)`, this code compares offsets with the tokens that the
//! lexer recorded next to the comment.

use super::TextPosition::{EndOfLine, OwnLine, Remaining};
use super::surrounding_nodes::{
    AttachContext, SurroundingNodes, function_of, has_parameters, union_members,
};
use super::{Attachment, CommentContext, Marker, Owner};
use crate::js::ast_nodes::{AsAstNodes, AstNodes as N, ExpressionStatement};
use bun_lint::ast::{
    BinOp, Case, Expr, ExprKind, FnBody, Func, List, Member, Node, PatKind, PropKind, Stmt,
    StmtKind, StmtTag, TypeKind, TypeNode,
};
use bun_lint::span::Span;

/// Returns `None` if no special case applies. Sets `ignored_node` if the comment is a `prettier-ignore` comment that applies to
/// a node other than the one it gets attached to.
pub(super) fn handle_comment<'a>(
    cx: &AttachContext<'a, '_>,
    context: &CommentContext<'a>,
    ignored_node: &mut Option<Owner<'a>>,
) -> Option<Attachment<'a>> {
    let SurroundingNodes {
        enclosing_node,
        preceding_node,
        following_node,
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

/// `{ a() {} }`, `{ get a() {} }` or `{ set a(b) {} }`.
fn is_object_method(node: N<'_>) -> bool {
    matches!(node, N::ObjectProperty(prop)
        if matches!(prop.kind(), PropKind::Method | PropKind::Getter | PropKind::Setter))
}

impl<'a> Rules<'_, 'a, '_> {
    // ───────────────────────────── tokens around the comment ─────────────────────────────

    fn next_token_starts_with(&self, byte: u8) -> bool {
        let start = self.context.comment.next_token_start;
        self.cx.file.text().get(start as usize) == Some(&byte)
    }

    fn prev_token_ends_with(&self, byte: u8) -> bool {
        let end = self.context.comment.prev_token_end as usize;
        end > 0 && self.cx.file.text().get(end - 1) == Some(&byte)
    }

    /// Whether there is no token between the comment and `owner`, which comes after it.
    fn is_directly_before(&self, owner: Owner<'a>) -> bool {
        self.context.comment.next_token_start == self.cx.start_of(owner)
    }

    fn is_on_same_line_as_end_of(&self, owner: Owner<'a>) -> bool {
        // Prettier's `locEnd` of a statement does not include the `;`.
        let end = self.cx.file.without_semicolon(self.cx.span_of(owner)).end;
        let between = Span::new(end, self.context.comment.span.start);
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

    /// Whether `owner` is an `Identifier` in ESTree.
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

    /// Babel's `ClassPrivateMethod` and `ClassPrivateProperty`. Prettier's node type lists leave them out.
    fn is_private_member_of_babel(&self, member: Member<'a>) -> bool {
        self.cx.is_babel() && member.key().is_some_and(|key| key.is_private())
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

    /// The `key` of a class member or an object property.
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

    /// The `body` of an arrow function.
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

    /// The first statement of a block, or the first member of a class or interface body. Skips empty statements, and
    /// directives for Babel, which does not keep them in `body`.
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
        if let Some(placed) = node.and_then(|node| self.handle_comment_in_empty_parens(node)) {
            return Some(placed);
        }
        // `handleClosureTypeCastComments`
        if comment.looks_like_type_cast()
            && let Some(following_node) = self.following_node
        {
            if let (Some(N::ConditionalExpression(_)), Owner::Node(N::LogicalExpression(e))) =
                (node, following_node)
                && let ExprKind::Binary {
                    op: BinOp::Nullish,
                    left,
                    ..
                } = e.kind()
            {
                return Some(Attachment::leading(self.cx.owner_of_expr(left)));
            }
            return Some(Attachment::leading(following_node));
        }
        node.and_then(|node| self.handle_by_enclosing_node(node, ignored_node))
            .or_else(|| self.handle_comments_in_destructuring_pattern())
            .or_else(|| self.handle_union_type_leading_comments(ignored_node))
    }

    /// `f(/* comment */)` and `function f(/* comment */) {}`
    fn handle_comment_in_empty_parens(&self, node: N<'a>) -> Option<Attachment<'a>> {
        if !self.next_token_starts_with(b')') || !self.prev_token_ends_with(b'(') {
            return None;
        }
        if let N::CallExpression(e) | N::NewExpression(e) = node {
            let has_no_arguments = e.as_call_like().is_some_and(|call| call.args().is_empty());
            return has_no_arguments.then(|| Attachment::dangling(Owner::Node(node)));
        }
        let func = function_of(node).filter(|func| !has_parameters(*func))?;
        if self.is_real_function_like(node) {
            return Some(Attachment::dangling(Owner::Node(node)));
        }
        // With typescript-estree the parameters belong to the `FunctionExpression` inside the method.
        (matches!(node, N::MethodDefinition(_)) || is_object_method(node))
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
            N::ConditionalExpression(_) | N::TSConditionalType(_) => {
                self.handle_conditional_expression_comments(node)
            }

            // `handleMemberExpressionComments`
            N::StaticMemberExpression(_)
            | N::ComputedMemberExpression(_)
            | N::PrivateFieldExpression(_) => (text_position == OwnLine
                && self.is_identifier(self.following_node))
            .then(|| Attachment::leading(enclosing_node)),

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
                self.handle_class_comments(node)
            }

            N::Function(_)
            | N::ArrowFunctionExpression(_)
            | N::MethodDefinition(_)
            | N::TSMethodSignature(_)
            | N::TSCallSignatureDeclaration(_)
            | N::TSConstructSignatureDeclaration(_)
            | N::TSFunctionType(_)
            | N::TSConstructorType(_) => self.handle_function_comments(node),
            N::ObjectProperty(_) if is_object_method(node) => self.handle_function_comments(node),
            N::PropertyDefinition(_) | N::AccessorProperty(_) => {
                self.handle_method_name_comments(node)
            }

            N::ObjectProperty(_)
            | N::BindingProperty(_)
            | N::AssignmentTargetPropertyIdentifier(_)
            | N::AssignmentTargetPropertyProperty(_) => match text_position {
                // `handlePropertyComments`
                EndOfLine => Some(Attachment::leading(enclosing_node)),
                _ => self.handle_method_name_comments(node),
            },

            // `handleAssignmentPatternComments`
            N::AssignmentPattern(_) | N::AssignmentTargetWithDefault(_) => {
                (text_position == OwnLine).then(|| Attachment::leading(enclosing_node))
            }
            N::FormalParameter(param) if param.is_parameter_property() => {
                self.handle_method_name_comments(node)
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
                (self.context.comment.followed_by_newline())
                    .then(|| Attachment::trailing(specifier))
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

            N::CallExpression(e) | N::NewExpression(e) if text_position == EndOfLine => {
                self.handle_call_expression_comments(e)
            }
            N::UnaryExpression(e) if text_position == EndOfLine => {
                self.handle_last_binary_operator_operand(e)
            }
            N::TSAsExpression(e) | N::TSSatisfiesExpression(e) => {
                self.handle_binary_cast_expression_comment(e)
            }
            // `handleSequenceExpressionLeadingComment`
            N::SequenceExpression(_) => (self.preceding_node.is_none()
                && self.following_node.is_some())
            .then(|| Attachment::leading(enclosing_node)),

            N::TSUnionType(_) if text_position == OwnLine => {
                // `handleUnionTypeComments`
                if self.context.comment.is_ignore_comment() {
                    *ignored_node = self.following_node;
                }
                self.preceding_node.map(Attachment::trailing)
            }
            N::TSUnionType(_) | N::TSIntersectionType(_) if text_position == EndOfLine => {
                self.handle_last_union_element_in_expression()
            }
            N::TSArrayType(_) if text_position == EndOfLine && self.following_node.is_none() => {
                self.handle_last_union_element_in_expression()
            }
            N::TSMappedType(ty) => self.handle_mapped_type_comments(ty, ignored_node),
            N::TSPropertySignature(member) if text_position != OwnLine => {
                self.handle_property_signature_comments(member.ty().is_some())
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
                N::ConditionalExpression(e) => match e.kind() {
                    ExprKind::Cond { no, .. } => Some(self.cx.owner_of_expr(no)),
                    _ => None,
                },
                N::TSConditionalType(ty) => match ty.kind() {
                    TypeKind::Cond { no, .. } => Some(self.cx.owner_of_type(no)),
                    _ => None,
                },
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
    fn handle_class_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let cx = self.cx;
        let type_parameters = |owner: Node<'a>, is_empty: bool| {
            (!is_empty).then_some(Owner::Node(N::TSTypeParameterDeclaration(owner)))
        };
        let first_type =
            |types: List<'a, TypeNode<'a>>| types.first().map(|it| Owner::Node(it.as_ast_nodes()));
        let (last_decorator, id, type_parameters, super_class, clause, body) = match node {
            N::Class(class) => (
                class
                    .decorators()
                    .last()
                    .map(|e| Owner::Node(N::Decorator(e))),
                class.name().map(|it| Owner::Name(it.span().start)),
                type_parameters(Node::Class(class), class.type_params().is_empty()),
                class.extends().map(|e| cx.owner_of_expr(e)),
                (first_type(class.implements()), Marker::Implements),
                Owner::Node(N::ClassBody(class)),
            ),
            N::TSInterfaceDeclaration(statement) => {
                let interface = statement.as_interface()?;
                (
                    None,
                    Some(Owner::Name(interface.name().span().start)),
                    type_parameters(Node::Stmt(statement), interface.type_params().is_empty()),
                    None,
                    (first_type(interface.extends()), Marker::Extends),
                    Owner::Node(N::TSInterfaceBody(statement)),
                )
            }
            _ => return None,
        };
        if let Some(last) = last_decorator
            && !matches!(self.following_node, Some(Owner::Node(N::Decorator(_))))
        {
            return Some(Attachment::trailing(last));
        }
        if self.following_node == Some(body) {
            return Some(self.add_block_statement_first_comment(body));
        }
        let (preceding_node, following_node) = (self.preceding_node?, self.following_node?);
        let is_after_name = Some(preceding_node) == id || Some(preceding_node) == type_parameters;
        if Some(following_node) == super_class && is_after_name {
            return Some(Attachment::trailing(preceding_node));
        }
        let (first_of_clause, marker) = clause;
        if first_of_clause != Some(following_node) {
            return None;
        }
        if !is_after_name && Some(preceding_node) != super_class {
            return Some(Attachment::dangling_with_marker(Owner::Node(node), marker));
        }
        Some(Attachment::trailing(preceding_node))
    }

    fn handle_function_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
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
        if let Some(preceding_node) = self.preceding_node
            && matches!(
                preceding_node,
                Owner::Node(
                    N::FormalParameter(_) | N::FormalParameterRest(_) | N::TSThisParameter(_)
                )
            )
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
        // `obj = { fn /* comment */() {} }`. Babel does not need this.
        if let Some(preceding_node) = self.preceding_node
            && match node {
                N::ObjectProperty(_) => !self.cx.is_babel(),
                N::MethodDefinition(member) => member.func().is_some_and(|func| !func.has_body()),
                _ => false,
            }
            && self.is_identifier(Some(preceding_node))
            && self.key_of(node) == Some(preceding_node)
            && self.next_token_starts_with(b'(')
            && !self.prev_token_ends_with(b':')
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
        (self.context.comment.is_line() || text_position == OwnLine)
            .then(|| Attachment::trailing(decorator))
    }

    /// `(a) /* comment */ => b`
    fn handle_comment_after_arrow_params(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let N::ArrowFunctionExpression(func) = node else {
            return None;
        };
        (func.arrow_span()?.start == self.context.comment.next_token_start).then_some(
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
        // The `returnType` of a `TSAbstractMethodDefinition` is on its `value`, so Prettier does not see it here.
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
        (self.context.comment.span.start >= func.arrow_span()?.end)
            .then(|| self.add_block_or_not_comment(following_node))
    }

    /// `f( // comment` with the first argument on the next line.
    fn handle_call_expression_comments(&self, e: Expr<'a>) -> Option<Attachment<'a>> {
        let call = e.as_call_like()?;
        let first = call.args().first()?;
        let is_behind_paren = self.preceding_node == Some(self.cx.owner_of_expr(call.callee()))
            && self.prev_token_ends_with(b'(');
        is_behind_paren.then(|| Attachment::leading(self.cx.owner_of_expr(first)))
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
            && !has_newline(right_start, self.context.comment.span.start);
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
        let between = Span::new(comment.span.end, self.cx.start_of(owner));
        is_union(owner)
            && self.is_single_line_block_comment()
            && !comment.is_ignore_comment()
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
        // `type A = /* comment */ B`
        match matches!(node, N::TSTypeAliasDeclaration(_)) && self.prev_token_ends_with(b'=') {
            true => self.add_leading_comment_to_possible_union_type(following_node),
            false => None,
        }
    }

    /// The expression statement around `owner`, if everything between them is an assignment whose right side, or an arrow
    /// function whose body, is the previous link: `a = b = () => owner;`
    fn enclosing_assignment_chain_expression_statement(
        &self,
        owner: Owner<'a>,
    ) -> Option<Owner<'a>> {
        let Owner::Node(mut child) = owner else {
            return None;
        };
        loop {
            let mut parent = child.parent();
            while matches!(
                parent,
                N::ChainExpression(_)
                    | N::FunctionBody(_)
                    | N::ExpressionStatement(ExpressionStatement::ArrowBody(_))
            ) {
                parent = parent.parent();
            }
            match parent {
                N::AssignmentExpression(_)
                    if self.right_of_assignment(parent) == Some(Owner::Node(child)) => {}
                N::ArrowFunctionExpression(func)
                    if self.body_of_arrow(func) == Owner::Node(child) => {}
                N::ExpressionStatement(ExpressionStatement::Stmt(_)) => {
                    return Some(Owner::Node(parent));
                }
                _ => return None,
            }
            child = parent;
        }
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
        let continues_chain = match preceding_node {
            Owner::Node(N::AssignmentExpression(_)) => is_right,
            Owner::Node(N::ArrowFunctionExpression(_)) => is_body,
            _ => false,
        };
        if continues_chain
            && let Some(statement) =
                self.enclosing_assignment_chain_expression_statement(enclosing_node)
        {
            return Some(Attachment::trailing(statement));
        }
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

    /// `handleIgnoreComments`, `handleTSMappedTypeComments` and `handlePropertySignatureComments`, which all apply to mapped types.
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
            && comment.is_ignore_comment()
            && self.following_node == Some(Owner::Name(key_start))
        {
            *ignored_node = Some(enclosing_node);
            return Some(Attachment::dangling_with_marker(
                enclosing_node,
                Marker::InIgnoredNode,
            ));
        }
        // `{ /* comment */ [K in T]: V }`
        if comment.next_token_start < key_start {
            return Some(Attachment::dangling(enclosing_node));
        }
        match text_position {
            OwnLine => None,
            _ => self.handle_property_signature_comments(mapped.ty().is_some()),
        }
    }

    /// `{ a: /* comment */ B }` in a type.
    fn handle_property_signature_comments(&self, has_type: bool) -> Option<Attachment<'a>> {
        let following_node = self.following_node?;
        if self.context.text_position == EndOfLine
            && matches!(
                following_node,
                Owner::Node(N::TSUnionType(_) | N::TSIntersectionType(_))
            )
        {
            return Some(Attachment::leading(following_node));
        }
        match has_type && self.context.comment.is_block() && self.prev_token_ends_with(b':') {
            true => self.add_leading_comment_to_possible_union_type(following_node),
            false => None,
        }
    }

    /// `const { a } /* comment */ : T = b`. In ESTree the type annotation is a child of the pattern. Here it comes after the
    /// pattern, so only this half of Prettier's handler is needed.
    fn handle_comments_in_destructuring_pattern(&self) -> Option<Attachment<'a>> {
        let is_between = self.context.text_position != Remaining
            && matches!(
                self.preceding_node?,
                Owner::Node(N::ObjectPattern(_) | N::ArrayPattern(_))
            )
            && matches!(self.following_node?, Owner::Node(N::TSTypeAnnotation(_)));
        match is_between {
            true => self.following_node.map(Attachment::leading),
            false => None,
        }
    }

    /// Also the second half of `handleUnionTypeComments`, for a `prettier-ignore` comment before a union type.
    fn handle_union_type_leading_comments(
        &self,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        let union = self.following_node.filter(|it| is_union(*it))?;
        let text_position = self.context.text_position;
        if text_position == OwnLine && self.context.comment.is_ignore_comment() {
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
