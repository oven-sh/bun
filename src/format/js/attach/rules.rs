//! The special cases of comment attachment, from Prettier's `handle-comments.js`.
//!
//! Each `handle_*` function has the name of the Prettier function it implements. Prettier runs its handlers one after the
//! other, and almost every handler starts by checking the type of the enclosing node. Here
//! [`Rules::handle_by_enclosing_node`] checks that type once and only calls the handlers that apply to it, in Prettier's order.
//!
//! Where Prettier scans the source text for a token such as `else` or `)`, this code compares offsets with the tokens that the
//! lexer recorded next to the comment.

use super::TextPosition::{EndOfLine, OwnLine, Remaining};
use super::flow::{self, FunctionType};
use super::surrounding_nodes::{
    AttachContext, SurroundingNodes, function_of, has_parameters, union_members,
};
use super::{Attachment, CommentContext, Marker, Owner};
use crate::js::ast_nodes::{AsAstNodes, AstNodes as N, ExpressionStatement};
use crate::js::comments::{Comment, CommentExt};
use crate::js::fields::ExprFields;
use crate::js::format::is_in_head_of_for;
use crate::js::print::flow::{is_declared_class, is_flow_opaque_type};
use crate::js::utils::expression::ExpressionLeftSide;
use bun_lint::ast::{
    BinOp, Case, Expr, ExprKind, Flags, FnBody, FnKind, Func, List, Member, Node, PatKind,
    PropKind, Stmt, StmtKind, StmtTag, TypeKind, TypeNode, assign_op_text,
};
use bun_lint::span::Span;
use std::ops::Range;

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

/// Whether `e` is the `a.b`, or the `a.b` in the `a.b.c`, of `typeof a.b.c`.
fn is_name_of_type_query(mut e: Expr<'_>) -> bool {
    loop {
        match e.parent() {
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Dot { .. }) => e = parent,
            Node::Type(ty) => return matches!(ty.kind(), TypeKind::Typeof { .. }),
            _ => return false,
        }
    }
}

/// `{ a() {} }`, `{ get a() {} }` or `{ set a(b) {} }`.
fn is_object_method(node: N<'_>) -> bool {
    matches!(node, N::ObjectProperty(prop)
        if matches!(prop.kind(), PropKind::Method | PropKind::Getter | PropKind::Setter))
}

/// `() => (a = b)`, `() => (a, b)`, `() => (<a />)`
fn keeps_parentheses_as_arrow_body(body: Expr<'_>) -> bool {
    matches!(
        body.kind(),
        ExprKind::Assign { .. }
            | ExprKind::Jsx(_)
            | ExprKind::Binary {
                op: BinOp::Comma,
                ..
            }
    )
}

/// Whether the parentheses at the end of `e` are written, so that the comment before the `)` stays in them: those of a sequence
/// or an assignment that is the value of a variable, the body of an arrow function or the right side of an assignment.
/// `gets_parentheses`: `e` is in such a place.
fn keeps_comment_in_parentheses(mut e: Expr<'_>, mut gets_parentheses: bool) -> bool {
    let is_sequence = |e: Expr<'_>| e.binary_op() == Some(BinOp::Comma);
    loop {
        match e.kind() {
            _ if is_sequence(e) => return gets_parentheses,
            ExprKind::Assign { value, .. } if gets_parentheses || is_sequence(value) => {
                return true;
            }
            ExprKind::Assign { value, .. } => e = value,
            _ => match e.arrow_function().map(|arrow| arrow.body()) {
                Some(FnBody::Expr(body)) => (e, gets_parentheses) = (body, true),
                _ => return false,
            },
        }
    }
}

/// Whether the only statement after `case` is a block. Empty statements do not count.
fn is_only_block_of(case: Case<'_>) -> bool {
    let mut statements = (case.body().iter()).filter(|it| it.tag() != StmtTag::Empty);
    statements
        .next()
        .is_some_and(|it| it.tag() == StmtTag::Block)
        && statements.next().is_none()
}

impl<'a> Rules<'_, 'a, '_> {
    // ───────────────────────────── tokens around the comment ─────────────────────────────

    fn next_token_starts_with(&self, byte: u8) -> bool {
        let start = self.context.comment.next_token_start();
        self.cx.file.text().get(start as usize) == Some(&byte)
    }

    fn prev_token_ends_with(&self, byte: u8) -> bool {
        let end = self.context.comment.prev_token_end() as usize;
        end > 0 && self.cx.file.text().get(end - 1) == Some(&byte)
    }

    /// Whether there is no token between the comment and `owner`, which comes after it.
    fn is_directly_before(&self, owner: Owner<'a>) -> bool {
        self.context.comment.next_token_start() == self.cx.start_of(owner)
    }

    fn is_on_same_line_as_end_of(&self, owner: Owner<'a>) -> bool {
        // Prettier's `locEnd` of a statement does not include the `;`.
        let end = self.cx.file.without_semicolon(self.cx.span_of(owner)).end;
        let between = Span::new(end, self.context.comment.span().start);
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
        if let Some(placed) =
            node.and_then(|node| self.handle_comment_before_semicolon_of_export(node))
        {
            return Some(placed);
        }
        if self.cx.options.flavor.is_oxfmt()
            && let Some(attachment) = self
                .handle_comment_before_body_for_oxfmt()
                .or_else(|| node.and_then(|node| self.handle_statement_comments_for_oxfmt(node)))
        {
            return Some(attachment);
        }
        if self.cx.options.flavor.is_oxfmt()
            && let Some(attachment) = node
                .and_then(|node| {
                    self.handle_comment_around_assignment_operator_for_oxfmt(node, ignored_node)
                })
                .or_else(|| self.handle_comment_in_dropped_parentheses_for_oxfmt())
        {
            return Some(attachment);
        }
        if self.cx.options.flavor.is_oxfmt()
            && let Some(attachment) = self
                .handle_comment_behind_parenthesis_of_parameters_for_oxfmt()
                .or_else(|| self.handle_comment_before_parenthesis_of_parameters_for_oxfmt())
                .or_else(|| self.handle_comment_before_type_annotation_of_pattern_for_oxfmt())
                .or_else(|| self.handle_comment_before_return_type_for_oxfmt())
                .or_else(|| self.handle_comment_behind_parameters_of_signature_for_oxfmt())
                .or_else(|| self.handle_comment_behind_parenthesis_of_union_for_oxfmt())
                .or_else(|| self.handle_comment_before_type_parameters_of_interface_for_oxfmt())
                .or_else(|| self.handle_comment_in_brackets_of_array_type_for_oxfmt())
        {
            return Some(attachment);
        }
        // `handleClosureTypeCastComments`. Between two nodes on one line it is left to `break_ties`, which makes it a leading
        // comment too, together with the comments before it: `f(a, /* comment */ /** @type {T} */ (b))`.
        let is_tie = self.context.text_position == Remaining && self.preceding_node.is_some();
        if comment.looks_like_type_cast()
            && !is_tie
            && let Some(following_node) = self.following_node
        {
            if self.cx.options.flavor.is_oxfmt()
                && let Some(attachment) = self.handle_closure_type_cast_comments_for_oxfmt()
            {
                return Some(attachment);
            }
            return Some(Attachment::leading(following_node));
        }
        self.handle_comments_in_destructuring_pattern()
            .or_else(|| node.and_then(|node| self.handle_by_enclosing_node(node, ignored_node)))
            .or_else(|| self.handle_union_type_leading_comments(ignored_node))
    }

    /// oxfmt leaves a comment between a head and the `{` of its body where it is. Prettier moves most of them into the body.
    ///
    /// ```ts
    /// interface A // comment
    /// {}
    /// ```
    fn handle_comment_before_body_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let body = self.following_node?;
        let is_body = match body {
            Owner::Node(
                N::ClassBody(_)
                | N::FunctionBody(_)
                | N::TSInterfaceBody(_)
                | N::TSEnumBody(_)
                | N::TSModuleBlock(_),
            ) => true,
            Owner::Node(N::BlockStatement(_)) => match self.enclosing_node {
                None
                | Some(Owner::Node(
                    N::Program(_)
                    | N::BlockStatement(_)
                    | N::FunctionBody(_)
                    | N::StaticBlock(_)
                    | N::TSModuleBlock(_),
                )) => false,
                // `case a: // comment⏎{}`: a block that is the only statement of a `case` counts as its body.
                Some(Owner::Node(N::SwitchCase(case))) => is_only_block_of(case),
                _ => true,
            },
            _ => false,
        };
        // A `prettier-ignore` comment there ignores only the body of a function.
        (is_body && self.is_directly_before(body)).then(|| Attachment {
            is_unignored: !matches!(body, Owner::Node(N::FunctionBody(_))),
            ..Attachment::leading(body)
        })
    }

    /// oxfmt leaves a comment between two parts of a statement where it is.
    fn handle_statement_comments_for_oxfmt(&self, node: N<'a>) -> Option<Attachment<'a>> {
        match node {
            N::TryStatement(_) => self.handle_try_statement_comments_for_oxfmt(),
            N::DoWhileStatement(_) => self.handle_do_while_statement_comments_for_oxfmt(),
            N::ForStatement(_) => self.handle_for_statement_head_comments_for_oxfmt(node),
            N::LabeledStatement(_) => self.handle_labeled_statement_comments_for_oxfmt(),
            N::SwitchCase(case) => self.handle_switch_case_comments_for_oxfmt(case),
            _ => None,
        }
    }

    /// A comment before `catch` or `finally`. Prettier moves it into the next block if it starts or ends its line.
    ///
    /// ```js
    /// try {
    /// } // comment
    /// finally {
    /// }
    /// ```
    fn handle_try_statement_comments_for_oxfmt(&self) -> Option<Attachment<'a>> {
        self.following_node?;
        self.preceding_node.map(Attachment::trailing)
    }

    /// A comment before the `while` of a `do` statement. For Prettier it leads `a` if it starts its line.
    ///
    /// ```js
    /// do {}
    /// // comment
    /// while (a);
    /// ```
    ///
    /// After the `while`, a comment that ends its line leads `a` if the body is a block: `do {} while // comment⏎(a);` is
    /// `do {} while (⏎// comment⏎a⏎);`.
    fn handle_do_while_statement_comments_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let (body, test) = (self.preceding_node?, self.following_node?);
        if self.context.comment.prev_token_end() == self.cx.span_of(body).end {
            return Some(Attachment::trailing(body));
        }
        is_block(body).then(|| Attachment::leading(test))
    }

    /// A comment before a `;` or the `)` of the head of a `for`. Prettier attaches it to the next or the previous expression,
    /// or to the body.
    ///
    /// ```js
    /// for (a; /* comment */; /* comment */) {}
    /// for (
    ///   a
    ///   // comment
    ///   ;
    ///   b;
    /// ) {}
    /// ```
    fn handle_for_statement_head_comments_for_oxfmt(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let is_before_body = self.prev_token_ends_with(b')')
            && (self.following_node).is_some_and(|body| self.is_directly_before(body));
        if is_before_body
            || !(self.next_token_starts_with(b';') || self.next_token_starts_with(b')'))
        {
            return None;
        }
        match self.prev_token_ends_with(b'(') || self.prev_token_ends_with(b';') {
            true => Some(Attachment::dangling(Owner::Node(node))),
            false => self.preceding_node.map(Attachment::trailing),
        }
    }

    /// Prettier moves a comment after the label that starts or ends its line before the label.
    ///
    /// ```js
    /// a: // comment
    /// b;
    /// ```
    ///
    /// `a // comment⏎: b;` is `a: // comment⏎b;`.
    fn handle_labeled_statement_comments_for_oxfmt(&self) -> Option<Attachment<'a>> {
        match self.following_node {
            Some(body) if self.is_directly_before(body) => Some(Attachment::leading(body)),
            _ => self.preceding_node.map(Attachment::trailing),
        }
    }

    /// A comment before the `:` of a `case` or a `default` whose only statement is a block. For Prettier it leads the block if
    /// it starts its line, and goes into the block after `default`.
    ///
    /// ```js
    /// case a
    /// // comment
    /// : {
    /// }
    /// default: // comment
    /// {
    /// }
    /// ```
    ///
    /// The second is also what `default // comment⏎: {}` is printed as.
    fn handle_switch_case_comments_for_oxfmt(&self, case: Case<'a>) -> Option<Attachment<'a>> {
        let block = self.following_node.filter(|_| is_only_block_of(case))?;
        if !self.next_token_starts_with(b':') {
            return None;
        }
        match self.preceding_node {
            Some(test) => Some(Attachment::trailing(test)),
            None => Some(Attachment::leading(block)),
        }
    }

    /// `function a( // comment ⏎ b) {}`. oxfmt prints `function a(⏎  // comment⏎  b,⏎) {}`: the comment leads the first parameter.
    /// For Prettier it trails the name.
    fn handle_comment_behind_parenthesis_of_parameters_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let parameter = self.following_node.filter(|it| {
            matches!(
                it,
                Owner::Node(N::FormalParameter(_) | N::FormalParameterRest(_))
            )
        })?;
        self.prev_token_ends_with(b'(')
            .then(|| Attachment::leading(parameter))
    }

    /// `class A { b ⏎// comment⏎ (c) {} }`. oxfmt prints `b (⏎  // comment⏎    c,⏎  ) {}`: in a method, and in a function without a
    /// body, a comment before the `(` belongs to the parameters, which print it like a trailing comment. For Prettier it trails
    /// the name or leads `c`.
    fn handle_comment_before_parenthesis_of_parameters_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Owner::Node(enclosing_node) = self.enclosing_node? else {
            return None;
        };
        let func = function_of(enclosing_node).filter(|func| {
            matches!(func.as_ast_nodes(), N::Function(_))
                && (!func.has_body() || !matches!(func.kind(), FnKind::Decl | FnKind::Expr))
        })?;
        (func.open_paren()? == self.context.comment.next_token_start())
            .then(|| Attachment::leading(Owner::Node(N::FormalParameters(func))))
    }

    /// `({ a } // comment⏎: B) => {}`. oxfmt prints `({⏎  a,⏎}: B) => {} // comment`: the pattern and its type annotation are
    /// siblings. For Prettier the comment is inside the pattern and trails `a`.
    fn handle_comment_before_type_annotation_of_pattern_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let (
            pattern @ Owner::Node(N::ObjectPattern(_) | N::ArrayPattern(_)),
            type_annotation @ Owner::Node(N::TSTypeAnnotation(_)),
        ) = (self.preceding_node?, self.following_node?)
        else {
            return None;
        };
        match self.context.text_position {
            OwnLine => Some(Attachment::leading(type_annotation)),
            EndOfLine => Some(Attachment::trailing(pattern)),
            Remaining => None,
        }
    }

    /// `function a(b) // comment ⏎ : C {}` stays as it is for oxfmt: the comment leads the return type. For Prettier it trails `b`.
    fn handle_comment_before_return_type_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let return_type = self
            .following_node
            .filter(|it| matches!(it, Owner::Node(N::TSTypeAnnotation(_))))?;
        self.prev_token_ends_with(b')')
            .then(|| Attachment::leading(return_type))
    }

    /// `interface A { b(c) /* comment */ ⏎; }`. oxfmt prints `b(c) /* comment */;`: the comment trails the signature. For Prettier it
    /// trails `c`.
    fn handle_comment_behind_parameters_of_signature_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let signature = self.enclosing_node.filter(|it| {
            matches!(
                it,
                Owner::Node(
                    N::TSMethodSignature(_)
                        | N::TSCallSignatureDeclaration(_)
                        | N::TSConstructSignatureDeclaration(_)
                )
            )
        })?;
        (self.following_node.is_none() && self.prev_token_ends_with(b')'))
            .then(|| Attachment::trailing(signature))
    }

    /// `type A = ( /* comment */ ⏎ B | C)[];`. oxfmt prints `type A = (/* comment */ B | C)[];`: a comment on the line of the `(`
    /// stays behind it, so it leads the first member. For Prettier it leads the union unless the member is on its line.
    fn handle_comment_behind_parenthesis_of_union_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let union = self.following_node.filter(|it| is_union(*it))?;
        let is_behind_parenthesis = self.prev_token_ends_with(b'(')
            && !self.enclosing_node.is_some_and(is_union)
            && self.is_directly_before(union)
            && !self.context.comment.has_newline_before()
            && !self.context.is_ignore_comment;
        match is_behind_parenthesis {
            true => (self.union_member_owners(union).next()).map(Attachment::leading),
            false => None,
        }
    }

    /// `type A = B[ /* comment */ ];`. oxfmt prints `type A = B[] /* comment */;`. For Prettier the comment trails `B`.
    fn handle_comment_in_brackets_of_array_type_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let array_type = self
            .enclosing_node
            .filter(|it| matches!(it, Owner::Node(N::TSArrayType(_))))?;
        (self.prev_token_ends_with(b'[') && self.next_token_starts_with(b']'))
            .then(|| Attachment::trailing(array_type))
    }

    /// `interface A /* comment */ <B> {}`. oxfmt prints `interface A</* comment */ B> {}`: the comment leads the first type parameter.
    fn handle_comment_before_type_parameters_of_interface_for_oxfmt(
        &self,
    ) -> Option<Attachment<'a>> {
        let Some(Owner::Node(N::TSInterfaceDeclaration(statement))) = self.enclosing_node else {
            return None;
        };
        let type_parameters = Owner::Node(N::TSTypeParameterDeclaration(Node::Stmt(statement)));
        let first = statement.as_interface()?.type_params().first()?;
        (self.following_node == Some(type_parameters))
            .then(|| Attachment::leading(Owner::Node(N::TSTypeParameter(first))))
    }

    /// `export type A = B /* comment */;`. Prettier's `locEnd` of an `export` is the end of its content, so the comment comes after
    /// the `export` and not inside the declaration.
    fn handle_comment_before_semicolon_of_export(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let statement = match node {
            // Flow's `declare export default A /* comment */;` is a type alias in the tree. The comment trails the `A`.
            N::TSTypeAliasDeclaration(statement) if statement.is_default_export() => return None,
            N::TSTypeAliasDeclaration(statement)
            | N::TSImportEqualsDeclaration(statement)
            | N::TSModuleDeclaration(statement) => statement,
            N::Function(func) => func.owner().as_stmt()?,
            _ => return None,
        };
        let is_before_semicolon = self.following_node.is_none()
            && self.next_token_starts_with(b';')
            && self.context.comment.next_token_start() + 1 == statement.span().end;
        (statement.is_exported() && is_before_semicolon)
            .then(|| Attachment::trailing(self.cx.owner_of_stmt(statement)))
    }

    /// The right side of a declarator, an assignment, a property or a type alias, and the length of the `=`, `+=` or `:`
    /// before it.
    fn right_side_and_operator_len(&self, node: N<'a>) -> Option<(Owner<'a>, u32)> {
        let right_side = match node {
            N::AssignmentExpression(e) => {
                let operator = assign_op_text(e.assign_op()?);
                return Some((self.right_of_assignment(node)?, operator.len() as u32));
            }
            N::VariableDeclarator(declarator) => self.cx.owner_of_expr(declarator.init()?),
            N::ObjectProperty(prop) | N::AssignmentTargetPropertyProperty(prop) => {
                match prop.kind() {
                    PropKind::Init => self.cx.owner_of_expr(prop.value()?),
                    _ => return None,
                }
            }
            N::BindingProperty(prop) if prop.is_shorthand() || prop.is_rest() => return None,
            N::BindingProperty(prop) => Owner::Node(match prop.default() {
                Some(_) => N::AssignmentPattern(Node::PatProp(prop)),
                None => prop.value().as_ast_nodes(),
            }),
            N::PropertyDefinition(member) | N::AccessorProperty(member) => {
                self.cx.owner_of_expr(member.init()?)
            }
            N::TSPropertySignature(member) => self.cx.owner_of_type(member.ty()?),
            N::TSTypeAliasDeclaration(statement) => match statement.kind() {
                StmtKind::TypeAlias(alias) => self.cx.owner_of_type(alias.ty()),
                _ => return None,
            },
            _ => return None,
        };
        Some((right_side, 1))
    }

    /// The ids of the comments between the same two tokens as `comment`.
    fn ids_of_comments_between_same_tokens(&self, comment: Comment<'a>) -> Range<u32> {
        let is_between_same_tokens =
            |id: &u32| self.cx.file.comment(*id).next_token_start() == comment.next_token_start();
        let count = self.cx.file.comments_by_id().len() as u32;
        let first = (0..comment.id())
            .rev()
            .take_while(is_between_same_tokens)
            .last();
        let last = (comment.id() + 1..count)
            .take_while(is_between_same_tokens)
            .last();
        first.unwrap_or(comment.id())..last.unwrap_or(comment.id()) + 1
    }

    /// The first of the comments `ids` that is the last thing on its line, if it is on the line of the token before them.
    fn first_comment_that_ends_line_of_prev_token(&self, ids: Range<u32>) -> Option<Comment<'a>> {
        ids.map(|id| self.cx.file.comment(id))
            .take_while(|comment| !comment.has_newline_before())
            .find(|comment| comment.is_line() || comment.has_newline_after())
    }

    /// oxfmt leaves a comment between the two sides of a declarator, an assignment, a property or a type alias on the side of the
    /// operator that it is on. Prettier attaches it to one of the sides without looking at the operator.
    ///
    /// ```js
    /// const a /* 1 */ = /* 2 */ // 3
    ///   // 4
    ///   b;
    /// ```
    ///
    /// - 1 is before the operator, on the line of the left side. It trails the left side.
    /// - 2 and 3 are behind the operator, on its line, and the last of them is a line comment. They are dangling comments of
    ///   `node`, and the printer writes them right behind the operator. If one is a `prettier-ignore` comment, it applies to the
    ///   right side.
    /// - Every other comment leads the right side, and so does every comment after it.
    fn handle_comment_around_assignment_operator_for_oxfmt(
        &self,
        node: N<'a>,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        let (left_side, following_node) = (self.preceding_node?, self.following_node?);
        let (right_side, operator_len) = self.right_side_and_operator_len(node)?;
        if following_node != right_side {
            return None;
        }
        let comment = self.context.comment;
        let ids = self.ids_of_comments_between_same_tokens(comment);
        let is_behind_operator = self.prev_token_ends_with(b'=') || self.prev_token_ends_with(b':');
        // `type A = ( /* comment */ B | C);`, `a = ( /* comment */ b, c);`
        if self.prev_token_ends_with(b'(') {
            let is_type = matches!(
                node,
                N::TSTypeAliasDeclaration(_) | N::TSPropertySignature(_)
            );
            return (!is_type).then(|| Attachment::leading(right_side));
        }
        let ids_before_operator = match is_behind_operator {
            false => ids.clone(),
            true => {
                let operator_start = comment.prev_token_end() - operator_len;
                match ids.start.checked_sub(1).map(|id| self.cx.file.comment(id)) {
                    Some(previous) if previous.next_token_start() == operator_start => {
                        self.ids_of_comments_between_same_tokens(previous)
                    }
                    _ => ids.start..ids.start,
                }
            }
        };
        let starts_line = |id: u32| self.cx.file.comment(id).has_newline_before();
        let end_of_trailing_comments =
            match self.first_comment_that_ends_line_of_prev_token(ids_before_operator.clone()) {
                Some(last) if last.is_multiline_block() => ids_before_operator.start,
                Some(last) => last.id() + 1,
                None if ids_before_operator.clone().any(starts_line) => ids_before_operator.start,
                None => ids_before_operator.end,
            };
        if comment.id() < end_of_trailing_comments {
            return Some(Attachment::trailing(left_side));
        }
        if !is_behind_operator || end_of_trailing_comments < ids_before_operator.end {
            return Some(Attachment::leading(right_side));
        }
        match self.first_comment_that_ends_line_of_prev_token(ids) {
            Some(last) if last.is_line() && comment.id() <= last.id() => {
                if self.context.is_ignore_comment {
                    *ignored_node = Some(right_side);
                }
                Some(Attachment::dangling(Owner::Node(node)))
            }
            _ => Some(Attachment::leading(right_side)),
        }
    }

    /// `a = (b /* comment */);` is `a = b; /* comment */` for oxfmt. The parentheses are not written, so the comment ends up before
    /// the `;`, and oxfmt moves every comment before a `;` behind it. Prettier writes `a = b /* comment */;`
    ///
    /// The same at the end of a chain of assignments and arrow functions, in a declaration, a class property, after `return` and
    /// after `export default`: `a = b = () => (c /* comment */);`
    fn handle_comment_in_dropped_parentheses_for_oxfmt(&self) -> Option<Attachment<'a>> {
        if self.following_node.is_some() || self.context.is_ignore_comment {
            return None;
        }
        let Owner::Node(preceding_node) = self.preceding_node? else {
            return None;
        };
        let mut child = preceding_node;
        // What ends with the `;`, and whether a sequence or an assignment is written in parentheses there.
        let (terminated_node, gets_parentheses) = loop {
            let e = child.as_expression()?;
            // Type cast parentheses are written.
            if self.cx.owner_of_expr(e) != Owner::Node(child) {
                return None;
            }
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
                    if self.body_of_arrow(func) == Owner::Node(child)
                        && !keeps_parentheses_as_arrow_body(e) => {}
                N::ExpressionStatement(_) | N::ExportDefaultDeclaration(_) => {
                    break (parent, Some(false));
                }
                N::VariableDeclarator(declarator) => match declarator.parent() {
                    Node::Stmt(statement)
                        if !is_in_head_of_for(statement)
                            && matches!(statement.kind(), StmtKind::Var(all) if all.last() == Some(declarator)) =>
                    {
                        break (statement.as_ast_nodes(), Some(true));
                    }
                    _ => return None,
                },
                // The parentheses around the whole argument are written.
                N::ReturnStatement(_) if child != preceding_node => break (parent, None),
                N::PropertyDefinition(_) | N::AccessorProperty(_) => break (parent, None),
                _ => return None,
            }
            child = parent;
        };
        let whole = child.as_expression()?;
        if gets_parentheses.is_some_and(|it| keeps_comment_in_parentheses(whole, it)) {
            return None;
        }
        Some(Attachment::trailing(Owner::Node(terminated_node)))
    }

    /// `a ? b : /** @type {T} */ (c).d ?? e` is `a ? b : (/** @type {T} */ (c).d ?? e)` for oxfmt: a type cast comment stays directly
    /// before its parentheses. For Prettier it leads `(c).d ?? e`, so it is written before the parentheses that this gets:
    /// `a ? b : /** @type {T} */ ((c).d ?? e)`
    fn handle_closure_type_cast_comments_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let open_paren = self.context.comment.next_token_start();
        let Owner::Node(following_node) = self.following_node? else {
            return None;
        };
        if !self.cx.is_cast_paren(open_paren) {
            return None;
        }
        ExpressionLeftSide::from(following_node.as_expression()?)
            .iter()
            .map(|left_side| left_side.expr)
            .find(|e| e.parens().any(|paren| paren.start == open_paren))
            .map(|e| Attachment::leading(Owner::CastParens(e, open_paren)))
    }

    /// `a as // comment⏎T`: for oxfmt a comment behind `as` or `satisfies` leads the type. For Prettier this one trails `a`.
    fn handle_comment_behind_cast_operator_for_oxfmt(&self, e: Expr<'a>) -> Option<Attachment<'a>> {
        let (ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. }) = e.kind() else {
            return None;
        };
        let is_behind_operator = self.context.comment.prev_token_end() > expr.outer_span().end;
        (is_behind_operator && !e.is_angle_bracket_assertion())
            .then(|| self.following_node.map(Attachment::leading))?
    }

    /// `((/* comment */ a), b);` is `/* comment */ (a, b);` for oxfmt: the comment leads the sequence, so it is written before
    /// the parentheses that the sequence gets. For Prettier it leads `a`: `(/* comment */ a, b);`
    ///
    /// Not after `return` and `throw`: `return ((/* comment */ a), b);` is `return (/* comment */ a, b);`
    fn handle_sequence_expression_leading_comment_for_oxfmt(
        &self,
        sequence: N<'a>,
    ) -> Option<Attachment<'a>> {
        (self.preceding_node.is_none()
            && self.following_node.is_some()
            && !matches!(
                sequence.parent(),
                N::ReturnStatement(_) | N::ThrowStatement(_)
            ))
        .then(|| Attachment::leading(Owner::Node(sequence)))
    }

    /// oxfmt moves the comment to a line of its own before `c`. For Prettier it trails `a || b` and stays where it is.
    ///
    /// ```js
    /// a ||
    ///   b || // comment
    ///   (c || d);
    /// ```
    ///
    /// Only if both sides have the operator of the whole expression.
    fn handle_comment_before_parenthesized_logical_expression_for_oxfmt(
        &self,
        e: Expr<'a>,
    ) -> Option<Attachment<'a>> {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return None;
        };
        let has_same_operator = |side: Expr<'a>, owner: Option<Owner<'a>>| {
            side.binary_op() == Some(op) && owner == Some(Owner::Node(N::LogicalExpression(side)))
        };
        (has_same_operator(left, self.preceding_node)
            && has_same_operator(right, self.following_node))
        .then(|| Attachment::leading(Owner::Node(N::LogicalExpression(right))))
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
        // Flow's `FunctionTypeAnnotation` is not in Prettier's list, so the comment leads the next node: `() => /* comment */ A`.
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
            // Prettier has no rule for Flow's `match` and its cases, and none for `opaque type`.
            _ if self.cx.file.is_flow() && flow::is_match_or_match_case(node) => None,
            N::TSInterfaceDeclaration(statement) if is_flow_opaque_type(statement) => None,
            N::BinaryExpression(e) if self.cx.file.is_flow() && flow::is_match_or_pattern(e) => {
                self.handle_match_or_pattern_comments(ignored_node)
            }
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

            N::StaticMemberExpression(_)
            | N::ComputedMemberExpression(_)
            | N::PrivateFieldExpression(_)
                if self.cx.options.flavor.is_oxfmt() =>
            {
                self.handle_member_expression_comments_for_oxfmt(node)
            }
            // The `a.b` of `typeof a.b` is a `TSQualifiedName` in ESTree.
            N::StaticMemberExpression(e) if is_name_of_type_query(e) => None,
            // `handleMemberExpressionComments`
            N::StaticMemberExpression(_)
            | N::ComputedMemberExpression(_)
            | N::PrivateFieldExpression(_) => (text_position == OwnLine
                && self.is_identifier(self.following_node))
            .then(|| Attachment::leading(enclosing_node)),
            // The `A.B` of `interface C extends A.B {}` is a member expression in ESTree. For oxfmt it is a name.
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
            // An `ImportAttribute`
            N::ObjectProperty(prop) if prop.is_import_attribute() => None,
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
            // `constructor(private a ⏎// comment⏎ = 1) {}`: the enclosing node is the `AssignmentPattern` in the
            // `TSParameterProperty`. It starts where the pattern starts.
            N::FormalParameter(param)
                if param.is_parameter_property()
                    && param.default().is_some()
                    && param.pat().span().end <= self.context.comment.span().start =>
            {
                (text_position == OwnLine)
                    .then(|| Attachment::leading(Owner::Node(param.pat().as_ast_nodes())))
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
                (self.context.comment.has_newline_after()).then(|| Attachment::trailing(specifier))
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
                    true => self.handle_comment_behind_cast_operator_for_oxfmt(e),
                    false => None,
                };
                for_oxfmt.or_else(|| self.handle_binary_cast_expression_comment(e))
            }
            N::SequenceExpression(_) if self.cx.options.flavor.is_oxfmt() => {
                self.handle_sequence_expression_leading_comment_for_oxfmt(node)
            }
            N::LogicalExpression(e)
                if text_position == EndOfLine && self.cx.options.flavor.is_oxfmt() =>
            {
                self.handle_comment_before_parenthesized_logical_expression_for_oxfmt(e)
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
            N::TSArrayType(_) if text_position == EndOfLine && self.following_node.is_none() => {
                self.handle_last_union_element_in_expression()
            }
            N::TSMappedType(ty) => self.handle_mapped_type_comments(ty, ignored_node),
            // Flow's `A</* comment */>`. The empty `TypeParameterInstantiation` has no child to climb up from.
            N::TSTypeReference(ty)
                if self.cx.file.is_flow()
                    && self.prev_token_ends_with(b'<')
                    && self.next_token_starts_with(b'>') =>
            {
                let type_arguments = N::TSTypeParameterInstantiation(Node::Type(ty));
                Some(Attachment::dangling(Owner::Node(type_arguments)))
            }
            N::TSPropertySignature(_) => self.handle_property_signature_comments(),
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
    fn handle_class_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
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
                class
                    .decorators()
                    .last()
                    .map(|e| Owner::Node(N::Decorator(e))),
                class.name().map(|it| Owner::Name(it.span().start)),
                type_parameters(Node::Class(class), class.type_params().is_empty()),
                class.extends().map(|e| cx.owner_of_expr(e)),
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
            // For oxfmt only a comment directly behind the decorators trails them.
            let trails_decorator = !self.cx.options.flavor.is_oxfmt()
                || self.context.comment.prev_token_end() == self.cx.span_of(last).end;
            if trails_decorator {
                return Some(Attachment::trailing(last));
            }
            if let Some(attachment) =
                self.handle_comment_behind_keyword_of_decorated_class_for_oxfmt(node)
            {
                return Some(attachment);
            }
        }
        if self.following_node == Some(body) {
            return Some(self.add_block_statement_first_comment(body));
        }
        let (preceding_node, following_node) = (self.preceding_node?, self.following_node?);
        let is_after_name = Some(preceding_node) == id || Some(preceding_node) == type_parameters;
        if Some(following_node) == super_class && is_after_name {
            return Some(Attachment::trailing(preceding_node));
        }
        let (_, marker) = (clauses.into_iter())
            .find(|(first_of_clause, _)| *first_of_clause == Some(following_node))?;
        if !is_after_name && Some(preceding_node) != super_class {
            return Some(Attachment::dangling_with_marker(Owner::Node(node), marker));
        }
        Some(Attachment::trailing(preceding_node))
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

    /// `@a export // comment⏎class B {}` and `@a class // comment⏎B {}` stay as they are for oxfmt: the comment leads the class or
    /// its name. For Prettier it trails `@a`.
    fn handle_comment_behind_keyword_of_decorated_class_for_oxfmt(
        &self,
        node: N<'a>,
    ) -> Option<Attachment<'a>> {
        let N::Class(class) = node else {
            return None;
        };
        let (comment, keyword) = (self.context.comment, class.keyword_span());
        if comment.span().end <= keyword.start {
            return Some(Attachment::leading(Owner::Node(node)));
        }
        match comment.prev_token_end() == keyword.end {
            true => self.following_node.map(Attachment::leading),
            false => None,
        }
    }

    fn handle_function_comments(&self, node: N<'a>) -> Option<Attachment<'a>> {
        // The other rules are not for the function types of Flow.
        if self.cx.file.is_flow()
            && function_of(node).is_some_and(|it| flow::function_type(it).is_some())
        {
            return match self.context.text_position {
                OwnLine | EndOfLine => self.handle_last_function_parameter_comments(node),
                Remaining => None,
            };
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
            matches!(
                owner,
                Owner::Node(
                    N::FormalParameter(_) | N::FormalParameterRest(_) | N::TSThisParameter(_)
                )
            )
        };
        // `type A = (a: B) // comment⏎ => C`. Prettier has this rule for a `FunctionTypeAnnotation`, a `ComponentTypeAnnotation`
        // and a `DeclareComponent`, and none for a `HookTypeAnnotation`.
        if self.cx.file.is_flow()
            && let Some(function_type) = function_of(node).and_then(flow::function_type)
        {
            let preceding_node = self.preceding_node.filter(|it| is_parameter(*it))?;
            return (function_type != FunctionType::HookTypeAnnotation
                && !self.following_node.is_some_and(is_parameter))
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
        // `obj = { fn /* comment */() {} }`. Babel does not need this.
        if let Some(preceding_node) = self.preceding_node
            && match node {
                N::ObjectProperty(_) => !self.cx.is_babel(),
                // `TSAbstractMethodDefinition`
                N::MethodDefinition(member) => member.flags().contains(Flags::ABSTRACT),
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
        (self.context.comment.span().start >= func.arrow_span()?.end)
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

    /// oxfmt leaves a comment between a callee and the `(`, the `?.` or the `<` after it where it is. Prettier moves most of them
    /// to the first argument.
    ///
    /// ```js
    /// a // comment
    /// (b);
    /// ```
    ///
    /// After `new A` without type arguments and after `a[b]`, the comment is attached by its position in the line, on both
    /// sides of the `(`: `new A( // comment⏎b)` is `new A(b); // comment`.
    fn handle_call_expression_comments_for_oxfmt(&self, e: Expr<'a>) -> Option<Attachment<'a>> {
        let call = e.as_call_like()?;
        let callee = call.callee();
        let is_new_without_type_arguments =
            matches!(e.kind(), ExprKind::New(_)) && call.type_args().is_empty();
        if is_new_without_type_arguments || matches!(callee.kind(), ExprKind::Index { .. }) {
            return None;
        }
        if self.context.comment.prev_token_end() == callee.outer_span().end {
            return Some(Attachment::trailing(self.cx.owner_of_expr(callee)));
        }
        // `a?. /* comment */ ()`
        if call.is_optional() && self.prev_token_ends_with(b'.') {
            return Some(match self.following_node {
                Some(following_node) => Attachment::leading(following_node),
                None => Attachment::dangling(self.cx.owner_of_expr(e)),
            });
        }
        (self.context.text_position == EndOfLine)
            .then(|| self.handle_call_expression_comments(e))?
    }

    /// oxfmt leaves a comment on its own line in a member access where it is. Prettier moves it before the object.
    ///
    /// ```js
    /// a
    ///   // comment 1
    ///   .b
    /// // comment 2
    /// [c];
    /// ```
    ///
    /// Comment 1 leads the name `b`, as it does by its position. Comment 2 would lead `c`, inside the brackets.
    fn handle_member_expression_comments_for_oxfmt(&self, node: N<'a>) -> Option<Attachment<'a>> {
        (matches!(node, N::ComputedMemberExpression(_))
            && self.context.text_position == OwnLine
            && self.preceding_node.is_some()
            && self.following_node.is_some()
            && !self.prev_token_ends_with(b'['))
        .then(|| Attachment::dangling(Owner::Node(node)))
    }

    /// For oxfmt every comment between a tag and its template leads the template. For Prettier one that ends its line trails
    /// the tag.
    ///
    /// ```js
    /// a /* comment */
    /// `b`;
    /// ```
    fn handle_tagged_template_comments_for_oxfmt(&self) -> Option<Attachment<'a>> {
        (self.following_node)
            .filter(|it| matches!(it, Owner::Node(N::TemplateLiteral(_))))
            .map(Attachment::leading)
    }

    /// For oxfmt a hole in an array is a node that prints no comments. A comment after a hole, or directly before its comma, goes
    /// to the next element, or stays at the end of the array. For Prettier it can trail the element before the hole.
    ///
    /// ```js
    /// [a, , /* comment */];
    /// [a, , /* comment */ b];
    /// ```
    fn handle_array_hole_comments_for_oxfmt(&self, array: Expr<'a>) -> Option<Attachment<'a>> {
        let ExprKind::Array(elements) = array.kind() else {
            return None;
        };
        let comment = self.context.comment;
        let preceding_end = (self.preceding_node).map_or(0, |it| self.cx.span_of(it).end);
        let is_beside_hole = (elements.iter().filter(|it| it.is_missing())).any(|hole| {
            let comma = hole.span().start;
            comma >= preceding_end
                && (comma < comment.span().start
                    || (comma == comment.next_token_start()
                        && self.context.text_position != EndOfLine))
        });
        is_beside_hole.then(|| match self.following_node {
            Some(following_node) => Attachment::leading(following_node),
            None => Attachment::dangling(Owner::Node(N::ArrayExpression(array))),
        })
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
        let between = Span::new(comment.span().end, self.cx.start_of(owner));
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
        match self.is_behind_operator_of_type_alias(node) {
            true => self.add_leading_comment_to_possible_union_type(following_node),
            false => None,
        }
    }

    /// `type A = /* comment */ B`, `type A = (/* comment */ B)`. Prettier looks for the first `=` after the name, so the `=` of a
    /// default counts: `type A<T = B> /* comment */ = C`.
    fn is_behind_operator_of_type_alias(&self, node: N<'a>) -> bool {
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

    /// `A<B,C> /* prettier-ignore */ | D`. oxfmt prints `A<B, C> /* prettier-ignore */ | D`: a comment behind a member of a union
    /// ignores that member only if it ends the line.
    fn handle_ignore_comment_before_union_operator_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let preceding_node = self.preceding_node?;
        (self.context.is_ignore_comment && self.next_token_starts_with(b'|')).then(|| Attachment {
            is_unignored: true,
            ..Attachment::trailing(preceding_node)
        })
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
            && self.context.is_ignore_comment
            && self.following_node == Some(Owner::Name(key_start))
        {
            *ignored_node = Some(enclosing_node);
            return Some(Attachment::dangling_with_marker(
                enclosing_node,
                Marker::InIgnoredNode,
            ));
        }
        // `{ /* comment */ [K in T]: V }`
        if comment.next_token_start() < key_start {
            return Some(Attachment::dangling(enclosing_node));
        }
        self.handle_property_signature_comments()
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

    /// `const { a } // comment⏎: T = b`. In ESTree the type annotation is a child of the pattern, so the pattern is the enclosing
    /// node, and the preceding node is its last property or element.
    fn handle_comments_in_destructuring_pattern(&self) -> Option<Attachment<'a>> {
        let (
            Owner::Node(N::ObjectPattern(pattern) | N::ArrayPattern(pattern)),
            Owner::Node(N::TSTypeAnnotation(_)),
        ) = (self.preceding_node?, self.following_node?)
        else {
            return None;
        };
        if self.context.text_position == Remaining {
            return None;
        }
        let last_child = match pattern.kind() {
            PatKind::Object(properties) => properties.last().map(N::BindingProperty),
            PatKind::Array(elements) => {
                let last = elements.iter().filter(|it| it.pat().is_some()).last();
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
