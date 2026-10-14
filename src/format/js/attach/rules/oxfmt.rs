//! The rules of the oxfmt flavor: where oxfmt 0.72 prints a comment somewhere else than Prettier 3.9.9 does, the comment has
//! another owner. Each rule says what oxfmt prints. A rule is deleted when oxfmt catches up with Prettier.
//!
//! [`Rules::handle_comment_for_oxfmt`] goes before Prettier's rules. `handle_by_enclosing_node` calls the other rules, in the
//! place of Prettier's rule for the same node.

use super::*;
use crate::js::comments::Comment;
use crate::js::fields::ExprFields;
use crate::js::format::is_in_head_of_for;
use crate::js::utils::call_expression::comments_stay_after_callee_for_oxfmt;
use crate::js::utils::conditional::is_jsx_conditional_chain;
use crate::js::utils::expression::ExpressionLeftSide;
use crate::js::utils::operators::BinOpExt;
use bun_lint::ast::{BinOp, assign_op_text};
use std::ops::Range;

/// Whether another part of the expression that `e` is in comes after `e`: the `b` of `e.b`, `e + b`, `a(e, b)` or `a(!e, b)`.
fn is_followed_by_operand(mut e: Expr<'_>) -> bool {
    while let Node::Expr(parent) = e.parent() {
        let is_last_operand = match parent.kind() {
            ExprKind::Index { index, .. } => index == e,
            ExprKind::Call(call) | ExprKind::New(call) => match call.args().last() {
                Some(last) => last == e,
                None => call.type_args().is_empty(),
            },
            ExprKind::Binary { right, .. } => right == e,
            ExprKind::Assign { value, .. } => value == e,
            ExprKind::Cond { no, .. } => no == e,
            ExprKind::Array(elements) => elements.last() == Some(e),
            ExprKind::NonNull(_)
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Unary { .. } => true,
            ExprKind::As { .. } => parent.is_angle_bracket_assertion(),
            ExprKind::Dot { .. } | ExprKind::TaggedTemplate(_) | ExprKind::Satisfies { .. } => {
                false
            }
            _ => return false,
        };
        if !is_last_operand {
            return true;
        }
        e = parent;
    }
    false
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
    /// The rules that do not depend on the kind of the enclosing node, which is `node`.
    pub(super) fn handle_comment_for_oxfmt(
        &self,
        node: Option<N<'a>>,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        self.handle_comment_before_body_for_oxfmt()
            .or_else(|| self.handle_comment_after_empty_statement_for_oxfmt())
            .or_else(|| self.handle_statement_comments_for_oxfmt(node?))
            .or_else(|| {
                self.handle_comment_around_assignment_operator_for_oxfmt(node?, ignored_node)
            })
            .or_else(|| self.handle_comment_after_alternate_for_oxfmt(ignored_node))
            .or_else(|| self.handle_comment_in_dropped_parentheses_for_oxfmt())
            .or_else(|| self.handle_comment_before_type_annotation_of_variable_for_oxfmt())
            .or_else(|| self.handle_comment_before_semicolon_of_return_for_oxfmt())
            .or_else(|| self.handle_comment_after_parenthesis_of_parameters_for_oxfmt())
            .or_else(|| self.handle_comment_before_parenthesis_of_parameters_for_oxfmt())
            .or_else(|| self.handle_comment_after_last_parameter_for_oxfmt())
            .or_else(|| self.handle_comment_before_type_annotation_of_pattern_for_oxfmt())
            .or_else(|| self.handle_comment_before_semicolon_of_class_member_for_oxfmt())
            .or_else(|| self.handle_comment_after_keyword_of_decorated_class_for_oxfmt())
            .or_else(|| self.handle_comment_before_return_type_for_oxfmt())
            .or_else(|| self.handle_comment_after_parameters_of_signature_for_oxfmt())
            .or_else(|| self.handle_comment_after_parenthesis_of_union_for_oxfmt())
            .or_else(|| self.handle_comment_before_type_parameters_of_interface_for_oxfmt())
            .or_else(|| self.handle_comment_in_brackets_of_array_type_for_oxfmt())
            .or_else(|| self.handle_comment_after_type_of_type_alias_for_oxfmt())
            .or_else(|| self.handle_closure_type_cast_comments_for_oxfmt())
    }

    /// oxfmt leaves a comment between a head and the `{` of its body where it is. Prettier moves most of them into the body.
    ///
    /// ```ts
    /// interface A // comment
    /// {}
    /// ```
    pub(super) fn handle_comment_before_body_for_oxfmt(&self) -> Option<Attachment<'a>> {
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

    /// Bundlers write a comment after an empty statement that starts its line. The empty statement is not printed, so the comment
    /// starts the line, and for oxfmt it leads `b`. For Prettier it trails `a`.
    ///
    /// ```js
    /// a;
    /// ;// comment
    /// b;
    /// ```
    fn handle_comment_after_empty_statement_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let (preceding_node, following_node) = (self.preceding_node?, self.following_node?);
        let comment = self.context.comment;
        if comment.has_newline_before() || !self.prev_token_ends_with(b';') {
            return None;
        }
        let empty_statements = Span::new(self.cx.span_of(preceding_node).end, comment.span().start);
        let text = self
            .cx
            .file
            .text()
            .get(empty_statements.start as usize..empty_statements.end as usize)?;
        let starts_line = (text.iter().rev())
            .find(|byte| !matches!(byte, b' ' | b'\t' | b';'))
            .is_some_and(|byte| matches!(byte, b'\n' | b'\r'));
        starts_line.then(|| Attachment::leading(following_node))
    }

    /// oxfmt leaves a comment between two parts of a statement where it is.
    fn handle_statement_comments_for_oxfmt(&self, node: N<'a>) -> Option<Attachment<'a>> {
        match node {
            N::TryStatement(_) => self.handle_try_statement_comments_for_oxfmt(node),
            N::DoWhileStatement(_) => self.handle_do_while_statement_comments_for_oxfmt(node),
            N::ForStatement(_) => self.handle_for_statement_head_comments_for_oxfmt(node),
            N::LabeledStatement(_) => self.handle_labeled_statement_comments_for_oxfmt(),
            N::SwitchCase(case) => self.handle_switch_case_comments_for_oxfmt(case),
            N::ExportNamedDeclaration(_) | N::ExportDefaultDeclaration(_) => {
                self.handle_comment_before_decorators_of_exported_class_for_oxfmt()
            }
            _ => None,
        }
    }

    /// For oxfmt the comment leads the first decorator, so a `prettier-ignore` comment applies to that. For Prettier it leads the
    /// class.
    ///
    /// ```js
    /// export
    /// // prettier-ignore
    /// @a({  b  })
    /// class C {}
    /// ```
    fn handle_comment_before_decorators_of_exported_class_for_oxfmt(
        &self,
    ) -> Option<Attachment<'a>> {
        let Owner::Node(N::Class(class)) = self.following_node? else {
            return None;
        };
        let decorator = Owner::Node(N::Decorator(class.decorators().next()?));
        self.is_directly_before(decorator)
            .then(|| Attachment::leading(decorator))
    }

    /// A comment before `catch` or `finally`. Prettier moves it into the next block if it starts or ends its line.
    ///
    /// ```js
    /// try {
    /// } // comment 1
    /// // comment 2
    /// finally {
    /// }
    /// ```
    ///
    /// Comment 1 ends the line of the block, so it trails the block. If it is a `prettier-ignore` comment, it applies to the
    /// block. Any other comment leads the `catch` clause, or dangles from the statement before `finally`, where a
    /// `prettier-ignore` comment applies to nothing.
    fn handle_try_statement_comments_for_oxfmt(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let (preceding_node, following_node) = (self.preceding_node?, self.following_node?);
        Some(match (self.context.text_position, following_node) {
            (EndOfLine, _) => Attachment::trailing(preceding_node),
            (_, Owner::Node(N::CatchClause(_))) => Attachment::leading(following_node),
            (OwnLine, _) => Attachment::dangling(Owner::Node(node)),
            (Remaining, _) => Attachment::trailing(preceding_node),
        })
    }

    /// A comment before the `while` of a `do` statement. For Prettier it leads `a` if it starts its line.
    ///
    /// ```js
    /// do {}
    /// // comment
    /// while (a);
    /// ```
    ///
    /// It dangles from the statement if it starts its line, so that a `prettier-ignore` comment applies to nothing. Otherwise it
    /// trails the body.
    ///
    /// After the `while`, a comment that ends its line leads `a` if the body is a block: `do {} while // comment⏎(a);` is
    /// `do {} while (⏎// comment⏎a⏎);`.
    fn handle_do_while_statement_comments_for_oxfmt(&self, node: N<'a>) -> Option<Attachment<'a>> {
        let (body, test) = (self.preceding_node?, self.following_node?);
        if self.context.comment.prev_token_end() != self.cx.span_of(body).end {
            return is_block(body).then(|| Attachment::leading(test));
        }
        Some(match self.context.text_position {
            OwnLine => Attachment::dangling(Owner::Node(node)),
            _ => Attachment::trailing(body),
        })
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
    fn handle_comment_after_parenthesis_of_parameters_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let parameter = self.following_node.filter(|it| {
            matches!(
                it,
                Owner::Node(N::FormalParameter(_) | N::FormalParameterRest(_))
            )
        })?;
        self.prev_token_ends_with(b'(')
            .then(|| Attachment::leading(parameter))
    }

    /// `class A { b ⏎// comment⏎ (c) {} }`. oxfmt prints `b (⏎  // comment⏎    c,⏎  ) {}`: a comment before the `(` that does not end
    /// its line belongs to the parameters, which print it like a trailing comment. For Prettier it trails the name or leads `c`.
    fn handle_comment_before_parenthesis_of_parameters_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Owner::Node(enclosing_node) = self.enclosing_node? else {
            return None;
        };
        let func = function_of(enclosing_node)
            .filter(|func| matches!(func.as_ast_nodes(), N::Function(_)))?;
        let (open_paren, next_token_start) =
            (func.open_paren()?, self.context.comment.next_token_start());
        let is_before_parenthesis = match self.context.text_position {
            // `[b⏎// comment⏎]() {}`, `b⏎// comment⏎?(): void`
            OwnLine if self.next_token_starts_with(b']') || self.next_token_starts_with(b'?') => {
                next_token_start + 1 == open_paren
            }
            OwnLine | Remaining => next_token_start == open_paren,
            EndOfLine => false,
        };
        is_before_parenthesis.then(|| Attachment::leading(Owner::Node(N::FormalParameters(func))))
    }

    /// `class A { b = 1 /* comment */⏎; }`. oxfmt prints `b = 1; /* comment */`: a comment before the `;` of a class member trails the
    /// member. For Prettier it trails `1`. Not in an index signature.
    fn handle_comment_before_semicolon_of_class_member_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let member = self.enclosing_node.filter(|it| {
            matches!(
                it,
                Owner::Node(
                    N::PropertyDefinition(_) | N::AccessorProperty(_) | N::MethodDefinition(_)
                )
            )
        })?;
        let is_before_semicolon = self.next_token_starts_with(b';')
            && self.context.comment.next_token_start() + 1 == self.cx.span_of(member).end;
        is_before_semicolon.then(|| Attachment::trailing(member))
    }

    /// `({ a } // comment⏎: B) => {}`. oxfmt prints `({⏎  a,⏎}: B) => {} // comment`: the pattern and its type annotation are
    /// siblings. For Prettier the comment is inside the pattern and trails `a`.
    fn handle_comment_before_type_annotation_of_pattern_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let (
            pattern @ Owner::Node(
                N::ObjectPattern(_) | N::ArrayPattern(_) | N::BindingIdentifier(_),
            ),
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

    /// `constructor(private a ⏎// comment⏎ = 1) {}`. oxfmt prints `// comment⏎private a = 1`. For Prettier the comment leads the
    /// `AssignmentPattern` `a = 1`.
    pub(super) fn handle_comment_in_parameter_property_with_default_for_oxfmt(
        &self,
        param: Param<'a>,
    ) -> Option<Attachment<'a>> {
        let is_in_assignment_pattern = self.cx.options.flavor.is_oxfmt()
            && self.context.text_position == OwnLine
            && param.default().is_some()
            && param.pat().span().end <= self.context.comment.span().start;
        is_in_assignment_pattern
            .then(|| Attachment::leading(Owner::Node(N::FormalParameter(param))))
    }

    /// `class A { b(c /* comment */); }` stays as it is for oxfmt: the comment trails `c`. For Prettier it trails the method.
    fn handle_comment_after_last_parameter_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let parameter = self.preceding_node.filter(|it| {
            matches!(
                it,
                Owner::Node(N::FormalParameter(_) | N::FormalParameterRest(_))
            )
        })?;
        self.next_token_starts_with(b')')
            .then(|| Attachment::trailing(parameter))
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
    fn handle_comment_after_parameters_of_signature_for_oxfmt(&self) -> Option<Attachment<'a>> {
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
    /// stays after it, so it leads the first member. For Prettier it leads the union unless the member is on its line.
    fn handle_comment_after_parenthesis_of_union_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let union = self.following_node.filter(|it| is_union(*it))?;
        let is_after_parenthesis = self.prev_token_ends_with(b'(')
            && !matches!(
                self.enclosing_node,
                Some(Owner::Node(N::TSUnionType(_) | N::TSIntersectionType(_)))
            )
            && self.is_directly_before(union)
            && !self.context.comment.has_newline_before()
            && !self.context.is_ignore_comment;
        match is_after_parenthesis {
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

    /// `type A = B /* comment */;`. oxfmt prints `type A = B; /* comment */`, as after any other statement: the comment trails the
    /// type alias. For Prettier it trails `B`.
    fn handle_comment_after_type_of_type_alias_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Some(Owner::Node(N::TSTypeAliasDeclaration(statement))) = self.enclosing_node else {
            return None;
        };
        (self.preceding_node.is_some() && self.following_node.is_none())
            .then(|| Attachment::trailing(self.cx.owner_of_stmt(statement)))
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
        (self.following_node == Some(type_parameters) && self.context.text_position != EndOfLine)
            .then(|| Attachment::leading(Owner::Node(N::TSTypeParameter(first))))
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
        let id = comment.id();
        first.unwrap_or(id)..last.unwrap_or(id) + 1
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
    /// - 2 and 3 are after the operator, on its line, and the last of them is a line comment. They are dangling comments of
    ///   `node`, and the printer writes them right after the operator. If one is a `prettier-ignore` comment, it applies to the
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
        let is_after_operator = self.prev_token_ends_with(b'=') || self.prev_token_ends_with(b':');
        // `type A = ( /* comment */ B | C);`, `a = ( /* comment */ b, c);`
        if self.prev_token_ends_with(b'(') {
            let is_type = matches!(
                node,
                N::TSTypeAliasDeclaration(_) | N::TSPropertySignature(_)
            );
            return (!is_type).then(|| Attachment::leading(right_side));
        }
        let ids_before_operator = match is_after_operator {
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
        if !is_after_operator || end_of_trailing_comments < ids_before_operator.end {
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
    /// the `;`, and oxfmt moves every comment before a `;` to after it. Prettier writes `a = b /* comment */;`
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
        if !self.context.comment.looks_like_type_cast() {
            return None;
        }
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

    /// `a as // comment⏎T`: for oxfmt a comment after `as` or `satisfies` leads the type. For Prettier this one trails `a`.
    pub(super) fn handle_comment_after_cast_operator_for_oxfmt(
        &self,
        e: Expr<'a>,
    ) -> Option<Attachment<'a>> {
        let (ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. }) = e.kind() else {
            return None;
        };
        let is_after_operator = self.context.comment.prev_token_end() > expr.outer_span().end;
        (is_after_operator && !e.is_angle_bracket_assertion())
            .then(|| self.following_node.map(Attachment::leading))?
    }

    /// `((/* comment */ a), b);` is `/* comment */ (a, b);` for oxfmt: the comment leads the sequence, so it is written before
    /// the parentheses that the sequence gets. For Prettier it leads `a`: `(/* comment */ a, b);`
    ///
    /// Not after `return` and `throw`: `return ((/* comment */ a), b);` is `return (/* comment */ a, b);`
    ///
    /// A `prettier-ignore` comment there ignores nothing.
    pub(super) fn handle_sequence_expression_leading_comment_for_oxfmt(
        &self,
        sequence: N<'a>,
    ) -> Option<Attachment<'a>> {
        (self.preceding_node.is_none()
            && self.following_node.is_some()
            && !matches!(
                sequence.parent(),
                N::ReturnStatement(_) | N::ThrowStatement(_)
            ))
        .then(|| Attachment {
            is_unignored: true,
            ..Attachment::leading(Owner::Node(sequence))
        })
    }

    /// `if (a) return // comment⏎;`: the `;` ends both statements. For Prettier the comment trails the `if` statement. For oxfmt it
    /// trails the `return` or `throw` statement, which writes it as text that has to fit on the line:
    ///
    /// ```js
    /// if (a)
    ///   return; // a comment that does not fit after `if (a) return;`
    /// ```
    fn handle_comment_before_semicolon_of_return_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let (comment, preceding_node) = (self.context.comment, self.preceding_node?);
        let Owner::Node(node) = preceding_node else {
            return None;
        };
        let Node::Stmt(mut statement) = node.raw() else {
            return None;
        };
        if comment.has_newline_before()
            || self.context.is_ignore_comment
            || self.cx.span_of(preceding_node).end < comment.span().end
        {
            return None;
        }
        loop {
            statement = match statement.kind() {
                StmtKind::If { yes, no, .. } => no.unwrap_or(yes),
                StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::With { body, .. }
                | StmtKind::Labeled { body, .. } => body,
                StmtKind::Return(_) | StmtKind::Throw(_) => {
                    return Some(Attachment::trailing(Owner::Node(statement.as_ast_nodes())));
                }
                _ => return None,
            };
        }
    }

    /// `x = a ? b : (c // comment⏎);` is `x = a ? b : c; // comment` for oxfmt: the comment trails the whole conditional expression, so
    /// it does not break it. For Prettier it trails `c`. A `prettier-ignore` comment on the line of `c` still applies to `c`.
    fn handle_comment_after_alternate_for_oxfmt(
        &self,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        let Some(Owner::Node(N::ConditionalExpression(conditional))) = self.enclosing_node else {
            return None;
        };
        let is_alternate_of = |e: Expr<'a>, conditional: Expr<'a>| matches!(conditional.kind(), ExprKind::Cond { no, .. } if no == e);
        let alternate = self.preceding_node.filter(|it| {
            matches!(conditional.kind(), ExprKind::Cond { no, .. } if *it == self.cx.owner_of_expr(no))
        })?;
        if self.following_node.is_some() {
            return None;
        }
        // `a ? <b /> : c ? d : (e // comment⏎)`: next to JSX the parentheses are written.
        let mut outermost = conditional;
        while let Node::Expr(parent) = outermost.parent()
            && is_alternate_of(outermost, parent)
        {
            outermost = parent;
        }
        if is_jsx_conditional_chain(outermost) {
            return None;
        }
        if self.context.is_ignore_comment && !self.context.comment.has_newline_before() {
            *ignored_node = Some(alternate);
        }
        Some(Attachment::trailing(Owner::Node(N::ConditionalExpression(
            conditional,
        ))))
    }

    /// oxfmt keeps the two comments in their order: both lead `b`. For Prettier the second one trails `a`, so it is written first.
    ///
    /// ```js
    /// a
    ///   // comment 1
    ///   + // comment 2
    ///   b;
    /// ```
    pub(super) fn handle_comment_after_binary_operator_for_oxfmt(
        &self,
        e: Expr<'a>,
    ) -> Option<Attachment<'a>> {
        let ExprKind::Binary { op, left, .. } = e.kind() else {
            return None;
        };
        let (comment, right) = (self.context.comment, self.following_node?);
        let first_after_operator = self.ids_of_comments_between_same_tokens(comment).start;
        let last_before_operator = self.cx.file.comment(first_after_operator.checked_sub(1)?);
        let operator_end = last_before_operator.next_token_start() + op.as_str().len() as u32;
        (left.outer_span().end <= last_before_operator.span().start
            && operator_end == comment.prev_token_end()
            && self
                .ids_of_comments_between_same_tokens(last_before_operator)
                .any(|id| self.cx.file.comment(id).has_newline_before()))
        .then(|| Attachment::leading(right))
    }

    /// For oxfmt a comment between a variable and its type leads the type if the variable has a value. Without a value, one that
    /// ends its line trails the variable. For Prettier it always leads the type.
    ///
    /// ```ts
    /// const a// comment 1
    /// : T = 1;
    /// let b: T; // comment 2, which was after `b`
    /// ```
    fn handle_comment_before_type_annotation_of_variable_for_oxfmt(
        &self,
    ) -> Option<Attachment<'a>> {
        let Some(Owner::Node(N::VariableDeclarator(declarator))) = self.enclosing_node else {
            return None;
        };
        let type_annotation =
            (self.following_node).filter(|it| matches!(it, Owner::Node(N::TSTypeAnnotation(_))))?;
        match (declarator.init(), self.context.text_position) {
            (Some(_), _) => Some(Attachment::leading(type_annotation)),
            (None, EndOfLine) => self.preceding_node.map(Attachment::trailing),
            (None, _) => None,
        }
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
    pub(super) fn handle_comment_before_parenthesized_logical_expression_for_oxfmt(
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

    /// `@a export // comment⏎class B {}` and `@a class // comment⏎B {}` stay as they are for oxfmt: the comment leads the class or
    /// its name. For Prettier it trails `@a`.
    fn handle_comment_after_keyword_of_decorated_class_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Owner::Node(node @ N::Class(class)) = self.enclosing_node? else {
            return None;
        };
        let last_decorator = N::Decorator(class.decorators().last()?).span();
        let (comment, keyword) = (self.context.comment, class.keyword_span());
        if comment.prev_token_end() == keyword.end {
            return self.following_node.map(Attachment::leading);
        }
        let is_after_export = last_decorator.end < comment.prev_token_end()
            && comment.span().end <= keyword.start
            && matches!(
                node.parent(),
                N::ExportNamedDeclaration(_) | N::ExportDefaultDeclaration(_)
            );
        is_after_export.then(|| Attachment::leading(Owner::Node(node)))
    }

    /// oxfmt leaves a comment between a callee and the `(`, the `?.` or the `<` after it where it is. Prettier moves most of them
    /// to the first argument.
    ///
    /// ```js
    /// a // comment
    /// (b);
    /// ```
    ///
    /// After some callees, such as `new A` without type arguments and `a[b]`, the comment is attached by its position in the
    /// line, on both sides of the `(`: `new A( // comment⏎b)` is `new A(b); // comment`.
    pub(super) fn handle_call_expression_comments_for_oxfmt(
        &self,
        e: Expr<'a>,
    ) -> Option<Attachment<'a>> {
        if matches!(e.kind(), ExprKind::Call(_))
            && let Some(attachment) = self.handle_comment_before_link_in_parentheses_for_oxfmt()
        {
            return Some(attachment);
        }
        let call = e.as_call_like()?;
        let callee = call.callee();
        let stays_after_callee = comments_stay_after_callee_for_oxfmt(callee);
        if stays_after_callee && self.context.comment.prev_token_end() == callee.outer_span().end {
            return Some(Attachment::trailing(self.cx.owner_of_expr(callee)));
        }
        // `a?. /* comment */ ()`
        if call.is_optional() && self.prev_token_ends_with(b'.') {
            match self.following_node {
                None => return Some(Attachment::dangling(self.cx.owner_of_expr(e))),
                Some(following_node) if stays_after_callee => {
                    return Some(Attachment::leading(following_node));
                }
                Some(_) => {}
            }
        }
        (stays_after_callee && self.context.text_position == EndOfLine)
            .then(|| self.handle_call_expression_comments(e))?
    }

    /// oxfmt moves a comment out of the empty parentheses of a call if something follows the call, unless the comments after
    /// the callee stay where they are (see [`Rules::handle_call_expression_comments_for_oxfmt`]).
    ///
    /// ```js
    /// new A /* comment */().b; // from `new A(/* comment */).b`
    /// a<T> /* comment */() + c; // from `a<T>(/* comment */) + c`
    /// ```
    pub(super) fn handle_comment_in_empty_arguments_for_oxfmt(
        &self,
        e: Expr<'a>,
    ) -> Option<Attachment<'a>> {
        let call = e.as_call_like()?;
        let before_parenthesis = match call.type_args().is_empty() {
            false => Owner::Node(N::TSTypeParameterInstantiation(Node::Expr(e))),
            true if comments_stay_after_callee_for_oxfmt(call.callee()) => return None,
            true => self.cx.owner_of_expr(call.callee()),
        };
        is_followed_by_operand(e).then(|| Attachment::trailing(before_parenthesis))
    }

    /// `(/* comment */ a.b)(c).d()` is `/* comment */ a.b(c).d()` for oxfmt: the comment leads `a`, the first thing that is printed
    /// after it. For Prettier it leads `a.b`, so it is printed before the `.b`.
    fn handle_comment_before_link_in_parentheses_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Owner::Node(following_node) = self
            .following_node
            .filter(|_| self.preceding_node.is_none())?
        else {
            return None;
        };
        let mut first = following_node.as_expression()?;
        // An optional chain keeps its parentheses, and so does a type cast.
        while !first.is_chain_root()
            && !matches!(self.cx.owner_of_expr(first), Owner::CastParens(..))
        {
            first = match first.kind() {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                ExprKind::NonNull(operand) => operand,
                ExprKind::Call(call) => call.callee(),
                _ => break,
            };
        }
        Some(Attachment::leading(self.cx.owner_of_expr(first)))
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
    pub(super) fn handle_member_expression_comments_for_oxfmt(
        &self,
        node: N<'a>,
    ) -> Option<Attachment<'a>> {
        if let Some(attachment) = self.handle_comment_before_link_in_parentheses_for_oxfmt() {
            return Some(attachment);
        }
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
    pub(super) fn handle_tagged_template_comments_for_oxfmt(&self) -> Option<Attachment<'a>> {
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
    pub(super) fn handle_array_hole_comments_for_oxfmt(
        &self,
        array: Expr<'a>,
    ) -> Option<Attachment<'a>> {
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

    /// `<a {/* prettier-ignore */ ...b   .c} />`. oxfmt prints `<a {/* prettier-ignore */ ...b.c} />`: a comment before the dots
    /// ignores nothing. Prettier copies the `b   .c`.
    pub(super) fn handle_ignore_comment_in_jsx_spread_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let argument = self.following_node?;
        self.context.is_ignore_comment.then(|| Attachment {
            is_unignored: true,
            ..Attachment::leading(argument)
        })
    }

    /// `A<B,C> /* prettier-ignore */ | D`. oxfmt prints `A<B, C> /* prettier-ignore */ | D`: a comment after a member of a union
    /// ignores that member only if it ends the line.
    pub(super) fn handle_ignore_comment_before_union_operator_for_oxfmt(
        &self,
    ) -> Option<Attachment<'a>> {
        let preceding_node = self.preceding_node?;
        (self.context.is_ignore_comment && self.next_token_starts_with(b'|')).then(|| Attachment {
            is_unignored: true,
            ..Attachment::trailing(preceding_node)
        })
    }
}
