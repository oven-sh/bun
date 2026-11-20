//! The oxfmt flavor's rules. Where oxfmt 0.72 prints a comment in a different place than Prettier 3.9.9, the comment
//! gets a different owner. Each rule documents what oxfmt prints. Delete a rule once oxfmt catches up with Prettier.
//!
//! [`Rules::handle_comment_for_oxfmt`] runs before Prettier's rules. `handle_by_enclosing_node` calls the other rules
//! in place of Prettier's rule for the same node.

use super::*;
use crate::js::attach::surrounding_nodes::CommentsBetweenTokens;
use crate::js::comments::Comment;
use crate::js::fields::ExprFields;
use crate::js::format::is_in_head_of_for;
use crate::js::utils::call_expression::comments_stay_after_callee_for_oxfmt;
use crate::js::utils::conditional::is_jsx_conditional_chain;
use crate::js::utils::expression::ExpressionLeftSide;
use crate::js::utils::operators::BinOpExt;
use bun_lint::ast::{BinOp, ExprTag, FnKind, assign_op_text};

/// One step of [`Rules::has_following_node`]. Returns `node`'s parent if whatever follows the parent also follows
/// `node`, or else the answer.
fn parent_with_same_following_node(node: Node<'_>) -> Result<Node<'_>, bool> {
    let parent = node.parent();
    let is_in_list = match (parent, node) {
        (Node::Expr(parent), _) if matches!(parent.kind(), ExprKind::Dot { .. }) => {
            return Err(true);
        }
        // Not the name in the closing tag.
        (Node::Expr(parent), Node::Expr(child)) if let ExprKind::Jsx(jsx) = parent.kind() => {
            return Err(jsx.children().last() != Some(child));
        }
        (Node::Func(func), Node::Type(_)) if func.has_body() => return Err(true),
        (Node::Func(func), Node::Param(this)) if func.this_param() == Some(this) => {
            return Err(false);
        }
        (Node::Type(parent), _) => matches!(
            parent.kind(),
            TypeKind::Union(_)
                | TypeKind::Intersection(_)
                | TypeKind::Template(_)
                | TypeKind::Tuple(_)
                | TypeKind::Object(_)
                | TypeKind::Ref { .. }
                | TypeKind::Heritage { .. }
                | TypeKind::Typeof { .. }
                | TypeKind::Import { .. }
        ),
        (Node::Expr(parent), _) => matches!(
            parent.kind(),
            ExprKind::Call(_)
                | ExprKind::New(_)
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Instantiation { .. }
                | ExprKind::Array(_)
                | ExprKind::Object(_)
                | ExprKind::Template(_)
                | ExprKind::Jsx(_)
        ),
        (Node::Stmt(parent), Node::VarDecl(_)) => parent.tag() == StmtTag::Var,
        (Node::Func(_) | Node::Stmt(_), Node::Type(_) | Node::Expr(_) | Node::Func(_)) => false,
        (Node::Func(_) | Node::Stmt(_) | Node::Class(_) | Node::Case(_) | Node::File(_), _) => true,
        _ => false,
    };
    let mut is_followed = false;
    // For a long list this only visits the last element.
    parent.for_each_child_near(u32::MAX, |child| {
        is_followed |= child.span().start >= node.span().end
            && (!is_in_list || std::mem::discriminant(&child) == std::mem::discriminant(&node));
    });
    let inherits_following_node_of_parent = !is_in_list
        && match parent {
            Node::Stmt(_) => matches!(node, Node::Func(_)),
            Node::File(_) | Node::Pat(_) | Node::PatProp(_) | Node::PatElem(_) => false,
            _ => true,
        };
    match is_followed || !inherits_following_node_of_parent {
        true => Err(is_followed),
        false => Ok(parent),
    }
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

/// True if the parentheses at the end of `e` are printed, so the comment before the `)` stays inside them. That's the
/// case for a sequence or an assignment that's a variable's value, an arrow function's body or the right side of an
/// assignment. `gets_parentheses` means `e` is in such a position.
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

/// True if the only statement after `case` is a block, not counting empty statements.
fn is_only_block_of(case: Case<'_>) -> bool {
    let mut statements = (case.body().iter()).filter(|it| it.tag() != StmtTag::Empty);
    statements
        .next()
        .is_some_and(|it| it.tag() == StmtTag::Block)
        && statements.next().is_none()
}

impl<'a> Rules<'_, 'a, '_> {
    /// The rules that don't depend on the kind of the enclosing node, `node`.
    pub(super) fn handle_comment_for_oxfmt(
        &self,
        node: Option<N<'a>>,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        self.handle_closure_type_cast_comments_for_oxfmt()
            .or_else(|| self.handle_comment_before_type_annotation_of_member_for_oxfmt())
            .or_else(|| self.handle_comment_in_array_pattern_of_holes_for_oxfmt(ignored_node))
            .or_else(|| self.handle_comment_before_body_for_oxfmt())
            .or_else(|| self.handle_comment_in_parentheses_of_super_class_for_oxfmt())
            .or_else(|| self.handle_comment_before_implements_for_oxfmt())
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
            .or_else(|| self.handle_ignore_comment_before_type_parameters_for_oxfmt(ignored_node))
            .or_else(|| self.handle_comment_before_parenthesis_of_signature_for_oxfmt())
            .or_else(|| self.handle_comment_before_type_annotation_in_index_signature_for_oxfmt())
            .or_else(|| self.handle_comment_after_last_parameter_for_oxfmt())
            .or_else(|| self.handle_comment_before_type_annotation_of_pattern_for_oxfmt())
            .or_else(|| self.handle_comment_before_semicolon_of_class_member_for_oxfmt())
            .or_else(|| self.handle_comment_after_keyword_of_decorated_class_for_oxfmt())
            .or_else(|| self.handle_comment_after_modifier_for_oxfmt())
            .or_else(|| self.handle_comment_before_return_type_for_oxfmt())
            .or_else(|| self.handle_comment_after_parameters_of_signature_for_oxfmt())
            .or_else(|| self.handle_comment_after_parenthesis_of_union_for_oxfmt())
            .or_else(|| self.handle_comment_before_parenthesis_of_union_for_oxfmt())
            .or_else(|| self.handle_comment_before_type_parameters_of_interface_for_oxfmt())
            .or_else(|| self.handle_comment_in_brackets_of_array_type_for_oxfmt())
            .or_else(|| self.handle_comment_before_type_parameters_of_type_alias_for_oxfmt())
            .or_else(|| self.handle_comment_after_bracket_of_mapped_type_for_oxfmt())
            .or_else(|| self.handle_comment_after_type_of_type_alias_for_oxfmt())
    }

    /// `const [ /* comment */ , ] = a;`. oxfmt prints `const [,] /* comment */ = a;`: a hole isn't a node, so nothing
    /// in the pattern can own the comment, and it counts as a comment after the pattern. For Prettier it dangles from
    /// the pattern.
    fn handle_comment_in_array_pattern_of_holes_for_oxfmt(
        &self,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        let Owner::Node(pattern @ N::ArrayPattern(pat)) = self.enclosing_node? else {
            return None;
        };
        let has_only_holes = self.preceding_node.is_none()
            && self.following_node.is_none()
            && matches!(pat.kind(), PatKind::Array(elements) if !elements.is_empty());
        if !has_only_holes {
            return None;
        }
        let parent = pattern.parent();
        let after_pattern = Rules {
            enclosing_node: Some(Owner::Node(parent)),
            preceding_node: self.enclosing_node,
            following_node: (self.right_side_and_operator_len(parent)).map(|it| it.0),
            ..*self
        };
        // `const [ /** @type {T} */ , ] = a;` is `const [,] = /** @type {T} */ a;`
        let attachment = (after_pattern.following_node)
            .filter(|_| self.context.comment.looks_like_type_cast())
            .map(Attachment::leading)
            .or_else(|| {
                after_pattern
                    .handle_comment_around_assignment_operator_for_oxfmt(parent, ignored_node)
            })
            .unwrap_or_else(|| Attachment::trailing(Owner::Node(pattern)));
        Some(Attachment {
            is_unignored: true,
            ..attachment
        })
    }

    /// oxfmt leaves a comment between a head and the `{` of its body where it is. Prettier moves most of them into the
    /// body.
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
                // `case a: // comment⏎{}`: a block that's the only statement of a `case` counts as its body.
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

    /// `class A extends (b, c /* comment */) {}`. oxfmt prints `class A extends (b, c) /* comment */ {}`, like a
    /// comment after the `)`: it leads the body. For Prettier it trails the super class. A `prettier-ignore` comment
    /// applies to the super class.
    fn handle_comment_in_parentheses_of_super_class_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let (Owner::Node(N::Class(class)), body @ Owner::Node(N::ClassBody(_))) =
            (self.enclosing_node?, self.following_node?)
        else {
            return None;
        };
        let is_after_super_class = self.preceding_node
            == class.extends().map(|it| self.cx.owner_of_expr(it))
            && self.next_token_starts_with(b')')
            && !self.context.is_ignore_comment;
        is_after_super_class.then(|| Attachment::leading(body))
    }

    /// oxfmt prints a comment on its own line after the super class before `implements`, with the empty line after it.
    /// For Prettier it trails `B`, with the empty line before it.
    ///
    /// ```ts
    /// class A
    ///   extends B
    ///   // comment
    ///
    ///   implements C {}
    /// ```
    ///
    /// `class /* comment */ implements A {}` stays as it is. Prettier prints `class implements /* comment */ A {}`.
    fn handle_comment_before_implements_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Owner::Node(node @ N::Class(class)) = self.enclosing_node? else {
            return None;
        };
        let first = Owner::Node(class.implements().first()?.as_ast_nodes());
        let is_after_class_keyword =
            self.context.comment.prev_token_end() == class.keyword_span().end;
        let is_before_implements = self.following_node == Some(first)
            && (is_after_class_keyword
                || (self.context.text_position == OwnLine && class.extends().is_some()));
        is_before_implements.then(|| Attachment {
            is_unignored: true,
            ..Attachment::dangling_with_marker(Owner::Node(node), Marker::Implements)
        })
    }

    /// Bundlers write a comment after an empty statement that starts its line. The empty statement isn't printed, so
    /// the comment starts the line, and for oxfmt it leads `b`. For Prettier it trails `a`.
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
        let empty_statements = self.cx.span_of(preceding_node).between(comment.span());
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
            N::ForInStatement(statement) | N::ForOfStatement(statement) => {
                self.handle_for_x_statement_head_comments_for_oxfmt(statement)
            }
            N::LabeledStatement(_) => self.handle_labeled_statement_comments_for_oxfmt(),
            N::SwitchCase(case) => self.handle_switch_case_comments_for_oxfmt(case),
            N::ExportDefaultDeclaration(_) => {
                self.handle_comment_before_decorators_of_exported_class_for_oxfmt()
            }
            N::ExportNamedDeclaration(statement) => self
                .handle_comment_before_decorators_of_exported_class_for_oxfmt()
                .or_else(|| self.handle_comment_before_module_source_for_oxfmt(statement)),
            N::ImportDeclaration(statement) => {
                self.handle_comment_before_module_source_for_oxfmt(statement)
            }
            N::ExportAllDeclaration(statement) => {
                self.handle_comment_before_star_of_export_for_oxfmt(statement)
            }

            N::ImportSpecifier(_) | N::ExportSpecifier(_) => {
                self.handle_module_specifiers_comments_for_oxfmt(node)
            }
            N::TSTypeAliasDeclaration(statement)
            | N::TSImportEqualsDeclaration(statement)
            | N::TSExportAssignment(statement)
            | N::TSNamespaceExportDeclaration(statement)
            | N::TSModuleDeclaration(statement) => {
                self.handle_comment_before_semicolon_of_declaration_for_oxfmt(statement)
            }
            N::Function(func) => self
                .handle_comment_before_semicolon_of_declaration_for_oxfmt(func.owner().as_stmt()?),
            _ => None,
        }
    }

    /// oxfmt prints the `;` before the comment. A comment on its own line leads `b` then, as it does after any other
    /// statement. For Prettier it trails the `1`.
    ///
    /// ```ts
    /// type A = 1
    /// // comment
    /// ;
    /// b;
    /// ```
    fn handle_comment_before_semicolon_of_declaration_for_oxfmt(
        &self,
        statement: Stmt<'a>,
    ) -> Option<Attachment<'a>> {
        if self.context.text_position != OwnLine || !self.is_before_semicolon_of(statement) {
            return None;
        }
        let following_statement = statement_after(statement)?;
        Some(Attachment::leading(
            self.cx.owner_of_stmt(following_statement),
        ))
    }

    /// `export /* comment */ * as a from "b";` is `export * as /* comment */ a from "b";` for oxfmt. For Prettier, in
    /// JavaScript, the comment leads the `* as a`.
    fn handle_comment_before_star_of_export_for_oxfmt(
        &self,
        statement: Stmt<'a>,
    ) -> Option<Attachment<'a>> {
        let StmtKind::ExportStar {
            alias: Some(name), ..
        } = statement.kind()
        else {
            return None;
        };
        let star = Owner::Name(statement.export_star_offset()?);
        (self.following_node == Some(star))
            .then(|| Attachment::leading(Owner::Name(name.span().start)))
    }

    /// For oxfmt a comment after `from`, or between the `}` and `from`, leads the source. For Prettier these trail `a`.
    ///
    /// ```js
    /// import { a } from // comment
    /// "b";
    /// import { a } from /* comment */ "b"; // from `import { a } /* comment */ from "b"`
    /// ```
    ///
    /// A comment between a name and `from` trails the name, even if it's on its own line, where it leads the source for
    /// Prettier: `import a⏎// comment⏎from "b"` is `import a from "b";⏎// comment`.
    ///
    /// This doesn't apply to `export * as a from // comment⏎"b";`, which both print as
    /// `export * as a from "b"; // comment`.
    fn handle_comment_before_module_source_for_oxfmt(
        &self,
        statement: Stmt<'a>,
    ) -> Option<Attachment<'a>> {
        let source = Owner::Name(statement.module_specifier_span()?.start);
        if self.following_node != Some(source) {
            return None;
        }
        if self.is_directly_before(source) {
            return Some(Attachment::leading(source));
        }
        // Between the last specifier and the source there is a `}`, a `from`, or both.
        if !self.next_token_starts_with(b'f') {
            return None;
        }
        match self.prev_token_ends_with(b'}') {
            true => Some(Attachment::leading(source)),
            false => self.preceding_node.map(Attachment::trailing),
        }
    }

    /// Like Prettier's `handleModuleSpecifiersComments`, but a `prettier-ignore` comment in a specifier applies to
    /// nothing: `import { a⏎// prettier-ignore⏎as   b } from "c"` is
    ///
    /// ```js
    /// import {
    ///   // prettier-ignore
    ///   a as b,
    /// } from "c";
    /// ```
    fn handle_module_specifiers_comments_for_oxfmt(
        &self,
        specifier: N<'a>,
    ) -> Option<Attachment<'a>> {
        (self.context.text_position != Remaining).then(|| Attachment {
            is_unignored: true,
            ..Attachment::leading(Owner::Node(specifier))
        })
    }

    /// For oxfmt the comment leads the first decorator, so a `prettier-ignore` comment applies to that. For Prettier it
    /// leads the class.
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
        // Also before the `default` of `export default @a class B {}`.
        (self.context.comment.span().end <= self.cx.start_of(decorator))
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
    /// Comment 1 ends the line of the block, so it trails the block. If it's a `prettier-ignore` comment, it applies to
    /// the block. Any other comment leads the `catch` clause, or dangles from the statement before `finally`, where a
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
    /// It dangles from the statement if it starts its line, so that a `prettier-ignore` comment applies to nothing.
    /// Otherwise it trails the body.
    ///
    /// After the `while`, a comment that ends its line leads `a` if the body is a block: `do {} while // comment⏎(a);`
    /// is `do {} while (⏎// comment⏎a⏎);`.
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

    /// A comment before a `;` or the `)` of the head of a `for`. Prettier attaches it to the next or the previous
    /// expression, or to the body.
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
    ///
    /// `for /* prettier-ignore */ (;;) {  }` is `for (;;) /* prettier-ignore */ {}`: the comment leads the body as for
    /// Prettier, but applies to nothing.
    fn handle_for_statement_head_comments_for_oxfmt(&self, node: N<'a>) -> Option<Attachment<'a>> {
        if let N::ForStatement(statement) = node
            && let StmtKind::For { body, .. } = statement.kind()
            && self.following_node == Some(self.cx.owner_of_stmt(body))
            && self.next_token_starts_with(b'(')
            // Not the `(` of `for (;;) /* prettier-ignore */ (a).b();`
            && !self.prev_token_ends_with(b')')
        {
            return Some(Attachment {
                is_unignored: true,
                ..Attachment::leading(self.cx.owner_of_stmt(body))
            });
        }

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

    /// A comment on its own line in the head of a `for (a of b)` or a `for (a in b)`. oxfmt moves it before the
    /// statement if it is before `b`, and leaves it where it is before the `)`. For Prettier the first leads `b`, and
    /// the second leads the body.
    ///
    /// ```js
    /// for (a
    /// // comment 1
    /// of b
    /// // comment 2
    /// );
    /// ```
    ///
    /// is
    ///
    /// ```js
    /// // comment 1
    /// for (a of b
    /// // comment 2
    /// );
    /// ```
    fn handle_for_x_statement_head_comments_for_oxfmt(
        &self,
        statement: Stmt<'a>,
    ) -> Option<Attachment<'a>> {
        let (StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. }) = statement.kind() else {
            return None;
        };
        let right = Some(self.cx.owner_of_expr(expr));
        if self.preceding_node == right && self.next_token_starts_with(b')') {
            return right.map(Attachment::trailing);
        }
        // Not after a comment that ends the line of `a`.
        let first_id = (self.cx.comments_between_same_tokens(self.context.comment)).first_id;
        (self.context.text_position == OwnLine
            && self.cx.file.comment(first_id).has_newline_before()
            && self.preceding_node.is_some()
            && self.following_node == right)
            .then(|| Attachment::leading(self.cx.owner_of_stmt(statement)))
    }

    /// Prettier moves a comment after the label that starts or ends its line before the label.
    ///
    /// ```js
    /// a: // comment
    /// b;
    /// ```
    ///
    /// `a // comment⏎: b;` is `a: // comment⏎b;`. A `prettier-ignore` comment after the `:` applies to nothing.
    fn handle_labeled_statement_comments_for_oxfmt(&self) -> Option<Attachment<'a>> {
        match self.following_node {
            Some(body) if self.is_directly_before(body) => Some(Attachment {
                is_unignored: true,
                ..Attachment::leading(body)
            }),
            _ => self.preceding_node.map(Attachment::trailing),
        }
    }

    /// A comment before the `:` of a `case` or a `default` whose only statement is a block. For Prettier it leads the
    /// block if it starts its line, and moves into the block after `default`.
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
    /// `default // comment⏎: {}` is also printed like the second one. A `prettier-ignore` comment there applies to
    /// nothing.
    fn handle_switch_case_comments_for_oxfmt(&self, case: Case<'a>) -> Option<Attachment<'a>> {
        let block = self.following_node.filter(|_| is_only_block_of(case))?;
        if !self.next_token_starts_with(b':') {
            return None;
        }
        match self.preceding_node {
            Some(test) => Some(Attachment::trailing(test)),
            None => Some(Attachment {
                is_unignored: true,
                ..Attachment::leading(block)
            }),
        }
    }

    /// `function a( // comment ⏎ b) {}`. oxfmt prints `function a(⏎  // comment⏎  b,⏎) {}`: the comment leads the first
    /// parameter. For Prettier it trails the name.
    fn handle_comment_after_parenthesis_of_parameters_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let parameter = self.following_node.filter(|it| is_parameter(*it))?;
        self.prev_token_ends_with(b'(')
            .then(|| Attachment::leading(parameter))
    }

    /// `class A { b ⏎// comment⏎ (c) {} }`. oxfmt prints `b (⏎  // comment⏎    c,⏎  ) {}`: a comment before the `(`
    /// that doesn't end its line belongs to the parameters, which print it like a trailing comment. For Prettier it
    /// trails the name or leads `c`.
    fn handle_comment_before_parenthesis_of_parameters_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Owner::Node(enclosing_node) = self.enclosing_node? else {
            return None;
        };
        let func = function_of(enclosing_node).filter(|func| {
            matches!(
                func.as_ast_nodes(),
                N::Function(_) | N::ArrowFunctionExpression(_)
            )
        })?;
        // The `(`, or the `a` of `async /* comment */ a => {}`.
        let parameters_start = N::FormalParameters(func).span().start;
        let next_token_start = self.context.comment.next_token_start();
        // See `handle_closure_type_cast_comments_for_oxfmt`.
        let is_never_trailing =
            self.context.text_position == OwnLine || self.context.comment.looks_like_type_cast();
        let has_only_tokens_before_parameters = next_token_start <= parameters_start
            && (self.following_node).is_none_or(|it| parameters_start <= self.cx.start_of(it));
        let is_before_parameters = match self.context.text_position {
            // `async /* comment */ function* () {}` is `async function* /* comment */() {}`
            Remaining if self.preceding_node.is_none() => has_only_tokens_before_parameters,
            _ if self.context.is_ignore_comment && self.preceding_node.is_none() => {
                has_only_tokens_before_parameters
            }
            // `[b⏎// comment⏎]() {}`, `b⏎// comment⏎?(): void`, `[b⏎// comment⏎]?(): void`
            OwnLine | Remaining
                if is_never_trailing
                    && (self.next_token_starts_with(b']') || self.next_token_starts_with(b'?')) =>
            {
                has_only_tokens_before_parameters
            }
            OwnLine | Remaining => next_token_start == parameters_start,
            // `function // comment⏎() {}` is `function () {} // comment`. After a name it trails the name.
            EndOfLine => self.preceding_node.is_none() && next_token_start == parameters_start,
        };
        is_before_parameters.then(|| Attachment::leading(Owner::Node(N::FormalParameters(func))))
    }

    /// `class A { b /* prettier-ignore */ < C >( d ) {} }`. oxfmt prints `b/* prettier-ignore */ < C >(d) {}`: the
    /// comment applies to the type parameters. For Prettier it applies to the function that starts there, up to the
    /// `}`.
    fn handle_ignore_comment_before_type_parameters_for_oxfmt(
        &self,
        ignored_node: &mut Option<Owner<'a>>,
    ) -> Option<Attachment<'a>> {
        let function @ Owner::Node(N::Function(func)) = self.following_node? else {
            return None;
        };
        let starts_with_type_parameters = self.context.text_position != EndOfLine
            && !func.type_params().is_empty()
            && matches!(
                self.enclosing_node,
                Some(Owner::Node(N::MethodDefinition(_) | N::ObjectProperty(_)))
            )
            && self.is_directly_before(function);
        if !self.context.is_ignore_comment || !starts_with_type_parameters {
            return None;
        }
        *ignored_node = Some(Owner::Node(N::TSTypeParameterDeclaration(Node::Func(func))));
        Some(Attachment::leading(function))
    }

    /// `class A { b = 1 /* comment */⏎; }`. oxfmt prints `b = 1; /* comment */`: a comment before the `;` of a class
    /// member trails the member. For Prettier it trails `1`. This doesn't apply in an index signature.
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

    /// `({ a } // comment⏎: B) => {}`. oxfmt prints `({⏎  a,⏎}: B) => {} // comment`: the pattern and its type
    /// annotation are siblings. For Prettier the comment is inside the pattern and trails `a`.
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
        // `function a(this // comment⏎: B) {}` is `this// comment⏎: B`
        if matches!(
            self.enclosing_node,
            Some(Owner::Node(N::TSThisParameter(_)))
        ) {
            return Some(Attachment::leading(type_annotation));
        }
        match self.context.text_position {
            OwnLine => Some(Attachment::leading(type_annotation)),
            EndOfLine => Some(Attachment::trailing(pattern)),
            Remaining => None,
        }
    }

    /// `constructor(private a ⏎// comment⏎ = 1) {}`. oxfmt prints `// comment⏎private a = 1`. For Prettier the comment
    /// leads the `AssignmentPattern` `a = 1`.
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

    /// `class A { b(c /* comment */); }` stays as it is for oxfmt: the comment trails `c`. For Prettier it trails the
    /// method. Same before the `,` of `b(c /* comment */,): D;`, where it leads the return type for Prettier.
    fn handle_comment_after_last_parameter_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let parameter = self.preceding_node.filter(|it| is_parameter(*it))?;
        let is_last = self.next_token_starts_with(b')')
            || (self.next_token_starts_with(b',')
                && !self.following_node.is_some_and(is_parameter));
        is_last.then(|| Attachment::trailing(parameter))
    }

    /// `function a(b) // comment ⏎ : C {}` stays as it is for oxfmt: the comment leads the return type. For Prettier it
    /// trails `b`.
    fn handle_comment_before_return_type_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let return_type = self
            .following_node
            .filter(|it| matches!(it, Owner::Node(N::TSTypeAnnotation(_))))?;
        self.prev_token_ends_with(b')')
            .then(|| Attachment::leading(return_type))
    }

    /// `interface A { b? /* comment */ : C }`. oxfmt prints `b?/* comment */ : C`: the comment leads the type
    /// annotation. So does a comment on its own line before the `?`, or before the `]` of `[b]: C`. For Prettier it
    /// trails `b`, and for oxfmt too if it ends the line of `b`, or a comment after it does: `b /* 1 */ // 2⏎: C` is
    /// `b /* 1 */: C; // 2`.
    fn handle_comment_before_type_annotation_of_member_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Owner::Node(
            N::PropertyDefinition(member)
            | N::AccessorProperty(member)
            | N::TSPropertySignature(member),
        ) = self.enclosing_node?
        else {
            return None;
        };
        // oxfmt doesn't support Flow, and the printer for a Flow object type member doesn't write a type annotation's
        // comments.
        if self.cx.file.is_flow() {
            return None;
        }
        let ty = member.ty()?;
        let type_annotation = Owner::Node(N::TSTypeAnnotation(ty));
        let comment = self.context.comment;
        // For Prettier the type annotation of a signature has no comments, so there the type is the following node.
        let is_between_key_and_colon = [type_annotation, self.cx.owner_of_type(ty)]
            .contains(&self.following_node?)
            && comment.span().end <= self.cx.start_of(type_annotation);
        if !is_between_key_and_colon
            || !(self.is_directly_before(type_annotation) || self.context.text_position == OwnLine)
        {
            return None;
        }
        let last_on_line =
            (self.cx.comments_between_same_tokens(comment)).first_that_ends_line_of_prev_token;
        match last_on_line.is_some_and(|last| comment.id() <= last) {
            true => self.preceding_node.map(Attachment::trailing),
            false => Some(Attachment::leading(type_annotation)),
        }
    }

    /// `interface A { b(c) /* comment */ ⏎; }`. oxfmt prints `b(c) /* comment */;`: the comment trails the signature.
    /// For Prettier it trails `c`.
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

    /// `type A = (⏎/* 1 */⏎/* 2 */ /* 3 */ B | C)[];`. oxfmt prints `type A = /* 1 */⏎/* 2 */ (/* 3 */ B | C)[];`: the
    /// comments that start their line move before the `(`, so they lead the union. The first one that doesn't, and
    /// those after it, stay after the `(`: they lead the first member. For Prettier they lead the union unless the
    /// member is on their line.
    fn handle_comment_after_parenthesis_of_union_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let union = self.following_node.filter(|it| is_union(*it))?;
        let comment = self.context.comment;
        let stays_after_parenthesis = (self
            .cx
            .comments_between_same_tokens(comment)
            .first_without_line_break_before)
            .is_some_and(|id| id <= comment.id());
        let is_after_parenthesis = self.prev_token_ends_with(b'(')
            && !matches!(
                self.enclosing_node,
                Some(Owner::Node(
                    N::TSUnionType(_) | N::TSIntersectionType(_) | N::TSTypeAliasDeclaration(_)
                ))
            )
            && self.is_directly_before(union)
            && !self.context.is_ignore_comment;
        match (is_after_parenthesis, stays_after_parenthesis) {
            (true, true) => (self.union_member_owners(union).next()).map(Attachment::leading),
            (true, false) => Some(Attachment::leading(union)),
            (false, _) => None,
        }
    }

    /// `type A = (B | C /* 1 */ // 2 ⏎)[];`. oxfmt prints `| C /* 1 */ // 2`: both trail `C`. For Prettier 1 trails the
    /// union.
    fn handle_comment_before_parenthesis_of_union_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let union = self.preceding_node.filter(|it| is_union(*it))?;
        let are_parentheses_kept = matches!(
            self.enclosing_node,
            Some(Owner::Node(
                N::TSArrayType(_) | N::TSIndexedAccessType(_) | N::TSTypeOperator(_)
            ))
        );
        if self.following_node.is_some()
            || !self.next_token_starts_with(b')')
            || !are_parentheses_kept
        {
            return None;
        }
        let comment = self.context.comment;
        let last_on_line =
            (self.cx.comments_between_same_tokens(comment)).first_that_ends_line_of_prev_token?;
        match comment.id() <= last_on_line {
            true => (self.union_member_owners(union).next_back()).map(Attachment::trailing),
            false => None,
        }
    }

    /// `type A = B[ /* comment */ ];`. oxfmt prints `type A = B[] /* comment */;`. For Prettier the comment trails `B`,
    /// and for oxfmt too if a node follows the array type: `let a: B /* comment */[] | null`.
    fn handle_comment_in_brackets_of_array_type_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Some(array_type @ Owner::Node(N::TSArrayType(ty))) = self.enclosing_node else {
            return None;
        };
        (self.prev_token_ends_with(b'[')
            && self.next_token_starts_with(b']')
            && !self.has_following_node(Node::Type(ty)))
        .then(|| Attachment::trailing(array_type))
    }

    /// True if oxfmt has a node that follows `node`. Normally that's the parent's next child. Nothing follows the last
    /// element of a list, no matter what comes after the list. Any other last child is followed by whatever follows its
    /// parent, unless the parent is a statement or a pattern.
    ///
    /// ```ts
    /// let a: [B, C], d;
    /// ```
    ///
    /// `C` follows `B`, nothing follows `C`, and `d` follows `[B, C]`.
    fn has_following_node(&self, node: Node<'a>) -> bool {
        (self.cx.has_following_node).find(node, parent_with_same_following_node)
    }

    /// `let a: abstract /* comment */ new () => void`, `interface A { [b] /* comment */ (): void }`. oxfmt prints
    /// `abstract new /* comment */() => void` and `[b] /* comment */(): void`: a comment before the `(` of a signature
    /// or of a function type belongs to the parameters, which print it like a trailing comment. For Prettier it leads
    /// the return type or trails `b`.
    fn handle_comment_before_parenthesis_of_signature_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Owner::Node(
            enclosing_node @ (N::TSMethodSignature(_)
            | N::TSCallSignatureDeclaration(_)
            | N::TSConstructSignatureDeclaration(_)
            | N::TSFunctionType(_)
            | N::TSConstructorType(_)),
        ) = self.enclosing_node?
        else {
            return None;
        };
        let func = function_of(enclosing_node)?;
        let (open_paren, next_token_start) =
            (func.open_paren()?, self.context.comment.next_token_start());
        let is_before_parenthesis = match enclosing_node {
            N::TSConstructorType(_) if func.type_params().is_empty() => {
                next_token_start <= open_paren
            }
            _ => next_token_start == open_paren && self.context.text_position != EndOfLine,
        };
        is_before_parenthesis.then(|| Attachment::leading(Owner::Node(N::FormalParameters(func))))
    }

    /// `type A = { [key // comment⏎: string]: number }`. oxfmt prints `key// comment⏎: string`: every comment before
    /// the `:` leads the type annotation.
    fn handle_comment_before_type_annotation_in_index_signature_for_oxfmt(
        &self,
    ) -> Option<Attachment<'a>> {
        let type_annotation @ Owner::Node(N::TSTypeAnnotation(ty)) = self.following_node? else {
            return None;
        };
        matches!(ty.parent(), Node::Param(param)
            if param.func().is_some_and(|func| func.kind() == FnKind::IndexSignature))
        .then(|| Attachment::leading(type_annotation))
    }

    /// `type A /* comment */⏎<B> = C;`. oxfmt prints `type A /* comment */<B> = C;`: a comment that ends the line of
    /// the name trails it. For Prettier a block comment leads the type parameters.
    fn handle_comment_before_type_parameters_of_type_alias_for_oxfmt(
        &self,
    ) -> Option<Attachment<'a>> {
        let is_before_type_parameters = matches!(
            (self.enclosing_node?, self.following_node?),
            (
                Owner::Node(N::TSTypeAliasDeclaration(_)),
                Owner::Node(N::TSTypeParameterDeclaration(_))
            )
        );
        (is_before_type_parameters && self.context.text_position == EndOfLine)
            .then(|| self.preceding_node.map(Attachment::trailing))?
    }

    /// `type A = { [K in B] /* comment */ };`. oxfmt prints `type A = { [K in B] } /* comment */;`. For Prettier the
    /// comment trails `B`.
    fn handle_comment_after_bracket_of_mapped_type_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let mapped_type = self.enclosing_node.filter(|it| {
            matches!(it, Owner::Node(N::TSMappedType(ty))
                if matches!(ty.kind(), TypeKind::Mapped(mapped) if mapped.ty().is_none()))
        })?;
        (self.following_node.is_none() && self.prev_token_ends_with(b']'))
            .then(|| Attachment::trailing(mapped_type))
    }

    /// `type A = B /* comment */;`. oxfmt prints `type A = B; /* comment */`, as after any other statement: the comment
    /// trails the type alias. For Prettier it trails `B`.
    fn handle_comment_after_type_of_type_alias_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Some(Owner::Node(N::TSTypeAliasDeclaration(statement))) = self.enclosing_node else {
            return None;
        };
        (self.preceding_node.is_some() && self.following_node.is_none())
            .then(|| Attachment::trailing(self.cx.owner_of_stmt(statement)))
    }

    /// `interface A /* comment */ <B> {}`. oxfmt prints `interface A</* comment */ B> {}`: the comment leads the first
    /// type parameter.
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

    /// Returns the right side of a declarator, an assignment, a property or a type alias, and the length of the `=`,
    /// `+=` or `:` before it.
    fn right_side_and_operator_len(&self, node: N<'a>) -> Option<(Owner<'a>, u32)> {
        let right_side = match node {
            N::AssignmentExpression(e) => {
                let operator = assign_op_text(e.assign_op()?);
                return Some((self.right_of_assignment(node)?, operator.len() as u32));
            }
            N::VariableDeclarator(declarator) => self.cx.owner_of_expr(declarator.init()?),
            // `with { type: /* 1 */ // 2⏎"json" }` is `with { type /* 1 */: "json", // 2 }`, as for Prettier.
            N::ObjectProperty(prop) if prop.is_import_attribute() => return None,
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

    /// oxfmt keeps a comment between the two sides of a declarator, an assignment, a property or a type alias on the
    /// same side of the operator. Prettier attaches it to one of the sides without looking at the operator.
    ///
    /// ```js
    /// const a /* 1 */ = /* 2 */ // 3
    ///   // 4
    ///   b;
    /// ```
    ///
    /// - 1 is before the operator, on the line of the left side. It trails the left side.
    /// - 2 and 3 are after the operator, on its line, and the last of them is a line comment. They're dangling comments
    ///   of `node`, and the printer writes them right after the operator. If one is a `prettier-ignore` comment, it
    ///   applies to the right side.
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
        let comments = self.cx.comments_between_same_tokens(comment);
        let is_after_operator = self.prev_token_ends_with(b'=') || self.prev_token_ends_with(b':');
        // `type A = ( /* comment */ B | C);`, `a = ( /* comment */ b, c);`
        if self.prev_token_ends_with(b'(') {
            let is_type = matches!(
                node,
                N::TSTypeAliasDeclaration(_) | N::TSPropertySignature(_)
            );
            return (!is_type).then(|| Attachment::leading(right_side));
        }
        let before_operator = match is_after_operator {
            false => comments,
            true => {
                let operator_start = comment.prev_token_end() - operator_len;
                match (comments.first_id.checked_sub(1)).map(|id| self.cx.file.comment(id)) {
                    Some(previous) if previous.next_token_start() == operator_start => {
                        self.cx.comments_between_same_tokens(previous)
                    }
                    _ => CommentsBetweenTokens {
                        first_id: comments.first_id,
                        end_id: comments.first_id,
                        ..CommentsBetweenTokens::default()
                    },
                }
            }
        };
        // `(a) // comment 1⏎// comment 2⏎= b`: oxfmt doesn't see a comment at the end of `a`'s line, because of the
        // `)`.
        let is_after_parenthesis = |comment: &Comment<'a>| {
            matches!(left_side, Owner::Node(it)
            if it.as_expression().is_some_and(|e| {
                e.is_parenthesized() && comment.prev_token_end() > e.span().end
            }))
        };
        let end_of_trailing_comments = match (before_operator.first_that_ends_line_of_prev_token)
            .map(|id| self.cx.file.comment(id))
            .filter(|comment| !is_after_parenthesis(comment))
        {
            Some(last) if last.is_multiline_block() => before_operator.first_id,
            Some(last) => last.id() + 1,
            None if before_operator.has_line_break_before_one => before_operator.first_id,
            None => before_operator.end_id,
        };
        if comment.id() < end_of_trailing_comments {
            return Some(Attachment::trailing(left_side));
        }
        if !is_after_operator || end_of_trailing_comments < before_operator.end_id {
            return Some(Attachment::leading(right_side));
        }
        match (comments.first_that_ends_line_of_prev_token).map(|id| self.cx.file.comment(id)) {
            Some(last) if last.is_line() && comment.id() <= last.id() => {
                if self.context.is_ignore_comment {
                    *ignored_node = Some(right_side);
                }
                Some(Attachment::dangling(Owner::Node(node)))
            }
            _ => Some(Attachment::leading(right_side)),
        }
    }

    /// `a = (b /* comment */);` is `a = b; /* comment */` for oxfmt. The parentheses aren't printed, so the comment
    /// ends up before the `;`, and oxfmt moves every comment before a `;` to after it. Prettier prints
    /// `a = b /* comment */;`
    ///
    /// Same at the end of a chain of assignments and arrow functions, in a declaration, a class property, after
    /// `return` and after `export default`: `a = b = () => (c /* comment */);`
    fn handle_comment_in_dropped_parentheses_for_oxfmt(&self) -> Option<Attachment<'a>> {
        if self.following_node.is_some() || self.context.is_ignore_comment {
            return None;
        }
        let Owner::Node(preceding_node) = self.preceding_node? else {
            return None;
        };
        let mut child = preceding_node;
        // The node that ends with the `;`, and whether a sequence or assignment there is printed in parentheses.
        let (terminated_node, gets_parentheses) = loop {
            let e = child.as_expression()?;
            // Type cast parentheses are kept.
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
                // The parentheses around the whole argument are kept.
                N::ReturnStatement(_) if child != preceding_node => break (parent, None),
                N::PropertyDefinition(_) | N::AccessorProperty(_) => break (parent, None),
                _ => return None,
            }
            child = parent;
        };
        let whole_expression = child.as_expression()?;
        if gets_parentheses.is_some_and(|it| keeps_comment_in_parentheses(whole_expression, it)) {
            return None;
        }
        Some(Attachment::trailing(Owner::Node(terminated_node)))
    }

    /// For oxfmt a comment that looks like a type cast is never a trailing comment: `var a /** @type {T} */, b;` is
    /// `var a, /** @type {T} */ b;`. For Prettier only one at the end of its line leads what follows it.
    ///
    /// This doesn't apply where oxfmt has dedicated code for the comments between two nodes. See
    /// [`Self::has_ordinary_trailing_comments_for_oxfmt`].
    ///
    /// `a ? b : /** @type {T} */ (c).d ?? e` is `a ? b : (/** @type {T} */ (c).d ?? e)` for oxfmt: a type cast comment
    /// stays directly before its parentheses. For Prettier it leads `(c).d ?? e`, so it's printed before the
    /// parentheses added around that expression: `a ? b : /** @type {T} */ ((c).d ?? e)`
    fn handle_closure_type_cast_comments_for_oxfmt(&self) -> Option<Attachment<'a>> {
        if !self.context.comment.looks_like_type_cast() {
            return None;
        }
        let following_node = self.following_node?;
        let open_paren = self.context.comment.next_token_start();
        let cast_parentheses = match following_node {
            Owner::Node(node) if self.cx.is_cast_paren(open_paren) => node.as_expression(),
            _ => None,
        }
        .and_then(|e| {
            ExpressionLeftSide::from(e)
                .iter()
                .map(|left_side| left_side.expr)
                .find(|e| e.parens().any(|paren| paren.start == open_paren))
        })
        .map(|e| Owner::CastParens(e, open_paren));
        let is_specifier = |owner: Owner<'a>| {
            matches!(
                owner,
                Owner::Node(N::ImportSpecifier(_) | N::ExportSpecifier(_))
            )
        };
        match cast_parentheses {
            Some(cast_parentheses) => Some(Attachment::leading(cast_parentheses)),
            // `import { a, /** @type {T} */ } from "b"`: no node follows the last specifier.
            None if self.next_token_starts_with(b'}')
                && self.preceding_node.is_some_and(is_specifier) =>
            {
                self.preceding_node.map(Attachment::trailing)
            }
            // A comment directly before the following node leads it anyway, together with the comments before it.
            None => (!self.is_directly_before(following_node)
                && self.has_ordinary_trailing_comments_for_oxfmt())
            .then(|| Attachment::leading(following_node)),
        }
    }

    /// True if oxfmt prints the comments between the preceding and following nodes as trailing comments of the first
    /// and leading comments of the second, as it does between list elements. Between the sides of `a = b` or the
    /// operands of `a ? b : c`, it has dedicated code to place them.
    fn has_ordinary_trailing_comments_for_oxfmt(&self) -> bool {
        if self.preceding_node.is_none() {
            return false;
        }
        if self.next_token_starts_with(b',') {
            // `function f(a /* comment */,): void {}`
            return !matches!(
                self.following_node,
                Some(Owner::Node(N::TSTypeAnnotation(_) | N::FunctionBody(_)))
            );
        }
        let is_statement = |owner: Option<Owner<'a>>| matches!(owner, Some(Owner::Node(node)) if matches!(node.raw(), Node::Stmt(_)));
        let is_decorator =
            |owner: Option<Owner<'a>>| matches!(owner, Some(Owner::Node(N::Decorator(_))));
        let Some(Owner::Node(enclosing_node)) = self.enclosing_node else {
            return self.enclosing_node.is_none()
                && is_statement(self.preceding_node)
                && is_statement(self.following_node);
        };
        match enclosing_node {
            N::Program(_)
            | N::BlockStatement(_)
            | N::FunctionBody(_)
            | N::StaticBlock(_)
            | N::TSModuleBlock(_) => {
                is_statement(self.preceding_node) && is_statement(self.following_node)
            }
            N::SwitchCase(_) => {
                is_statement(self.following_node)
                    && !matches!(self.following_node, Some(Owner::Node(N::BlockStatement(_))))
            }
            // `a[b] /* comment */ [c]`
            N::ComputedMemberExpression(_) => self.prev_token_ends_with(b']'),
            N::SequenceExpression(_)
            | N::BinaryExpression(_)
            | N::LogicalExpression(_)
            | N::PrivateInExpression(_)
            | N::StaticMemberExpression(_)
            | N::PrivateFieldExpression(_)
            | N::TSTypeAssertion(_)
            | N::AssignmentPattern(_)
            | N::AssignmentTargetWithDefault(_)
            | N::SwitchStatement(_)
            | N::ImportSpecifier(_)
            | N::ExportSpecifier(_)
            | N::TSEnumMember(_)
            | N::TSTypeParameter(_)
            | N::TSNamedTupleMember(_)
            | N::TSOptionalType(_)
            | N::TSIntersectionType(_)
            | N::TSIndexedAccessType(_)
            | N::TSTypeOperator(_)
            | N::TSTypePredicate(_)
            | N::TSTypeReference(_)
            | N::TSTypeQuery(_)
            | N::TSTemplateLiteralType(_)
            | N::TSInterfaceHeritage(_)
            | N::TSClassImplements(_)
            | N::TSInterfaceBody(_)
            | N::TSTypeLiteral(_)
            | N::JSXAttribute(_) => true,
            // Also `import("a", { with /* comment */ : { .. } })`
            N::TSImportType(_) => {
                self.next_token_starts_with(b')')
                    || self.next_token_starts_with(b'.')
                    || self.next_token_starts_with(b':')
            }
            // `a?.[b] /* comment */ ?.(c)`
            N::CallExpression(e) => {
                self.next_token_starts_with(b'?')
                    && matches!(self.following_node, Some(Owner::Node(node)) if node.as_expression().is_some())
                    && (e.as_call_like())
                        .is_some_and(|call| !self.comments_stay_after_callee(call.callee()))
            }
            N::ExportAllDeclaration(_) => matches!(self.following_node, Some(Owner::Name(_))),
            N::ObjectProperty(prop) | N::AssignmentTargetPropertyProperty(prop) => {
                prop.func().is_none()
            }
            N::BindingProperty(_) => true,
            N::PropertyDefinition(_) | N::AccessorProperty(_) => {
                self.next_token_starts_with(b'=') || self.next_token_starts_with(b']')
            }
            N::FormalParameter(_) => !is_decorator(self.preceding_node),
            N::TSMappedType(_) => !self.next_token_starts_with(b'}'),
            N::TSConditionalType(ty) => {
                matches!(ty.kind(), TypeKind::Cond { extends, .. } if self.following_node == Some(self.cx.owner_of_type(extends)))
            }
            N::ForInStatement(_) | N::ForOfStatement(_) => is_statement(self.preceding_node),
            // `class A /* comment */ extends B {}`
            N::Class(_) => {
                !is_decorator(self.preceding_node)
                    && matches!(self.following_node, Some(Owner::Node(node)) if node.as_expression().is_some())
            }
            N::TSInterfaceDeclaration(_) => {
                matches!(
                    self.following_node,
                    Some(Owner::Node(N::TSInterfaceHeritage(_)))
                )
            }
            N::ImportDeclaration(_) | N::ExportNamedDeclaration(_) => {
                self.prev_token_ends_with(b'}') || self.prev_token_ends_with(b',')
            }
            N::TSModuleDeclaration(_) | N::TSImportEqualsDeclaration(_) => {
                self.next_token_starts_with(b'.') || self.next_token_starts_with(b'=')
            }
            _ => false,
        }
    }

    /// `a as // comment⏎T`: for oxfmt a comment after `as` or `satisfies` leads the type. For Prettier this one trails
    /// `a`.
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

    /// `((/* comment */ a), b);` is `/* comment */ (a, b);` for oxfmt: the comment leads the sequence, so it's printed
    /// before the parentheses added around the sequence. For Prettier it leads `a`: `(/* comment */ a, b);`
    ///
    /// This doesn't apply after `return` and `throw`: `return ((/* comment */ a), b);` is
    /// `return (/* comment */ a, b);`
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

    /// `if (a) return // comment⏎;`: the `;` ends both statements. For Prettier the comment trails the `if` statement.
    /// For oxfmt it trails the `return` or `throw` statement, which prints it as text that has to fit on the line:
    ///
    /// ```js
    /// if (a)
    ///   return; // a comment that doesn't fit after `if (a) return;`
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

    /// `x = a ? b : (c // comment⏎);` is `x = a ? b : c; // comment` for oxfmt: the comment trails the whole
    /// conditional expression, so it doesn't force it to break. For Prettier it trails `c`. A `prettier-ignore` comment
    /// on the line of `c` still applies to `c`.
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
        // `a ? <b /> : c ? d : (e // comment⏎)`: next to JSX the parentheses are kept.
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

    /// oxfmt keeps the two comments in their order: both lead `b`. For Prettier the second one trails `a`, so it's
    /// printed first.
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
        let first_after_operator = self.cx.comments_between_same_tokens(comment).first_id;
        let last_before_operator = self.cx.file.comment(first_after_operator.checked_sub(1)?);
        let operator_end = last_before_operator.next_token_start() + op.as_str().len() as u32;
        (left.outer_span().end <= last_before_operator.span().start
            && operator_end == comment.prev_token_end()
            && (self.cx.comments_between_same_tokens(last_before_operator))
                .has_line_break_before_one)
            .then(|| Attachment::leading(right))
    }

    /// For oxfmt a comment between a variable and its type leads the type if the variable has a value. Without a value,
    /// a comment that ends its line trails the variable. For Prettier it always leads the type.
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

    /// oxfmt moves the comment to its own line before `c`. For Prettier it trails `a || b` and stays where it is.
    ///
    /// ```js
    /// a ||
    ///   b || // comment
    ///   (c || d);
    /// ```
    ///
    /// This only applies if both sides use the same operator as the whole expression.
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

    /// `@a export // comment⏎class B {}` and `@a class // comment⏎B {}` stay as they are for oxfmt: the comment leads
    /// the class or its name. For Prettier it trails `@a`.
    fn handle_comment_after_keyword_of_decorated_class_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Owner::Node(node @ N::Class(class)) = self.enclosing_node? else {
            return None;
        };
        let last_decorator = (class.modifiers().iter().rev()).find_map(|it| it.decorator())?;
        let last_decorator = N::Decorator(last_decorator).span();
        let (comment, keyword) = (self.context.comment, class.keyword_span());
        if comment.prev_token_end() == keyword.end {
            return self.following_node.map(Attachment::leading);
        }
        if comment.prev_token_end() <= last_decorator.end || keyword.start < comment.span().end {
            return None;
        }
        let parent = node.parent();
        let is_after_export = last_decorator.end <= parent.span().start
            && matches!(
                parent,
                N::ExportNamedDeclaration(_) | N::ExportDefaultDeclaration(_)
            );
        is_after_export.then(|| Attachment::leading(Owner::Node(node)))
    }

    /// `@a private /* comment */ readonly b;`. oxfmt prints `@a private readonly /* comment */ b;`: the comment leads
    /// the name. For Prettier a keyword is in the way, so it trails `@a`.
    fn handle_comment_after_modifier_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let decorator = self
            .preceding_node
            .filter(|it| matches!(it, Owner::Node(N::Decorator(_))))?;
        let following_node = self
            .following_node
            .filter(|it| !matches!(it, Owner::Node(N::Decorator(_))))?;
        let comment = self.context.comment;
        if comment.prev_token_end() != self.cx.span_of(decorator).end {
            return Some(Attachment::leading(following_node));
        }
        // `@a /*⏎ comment⏎ */ b;` is `@a /*⏎ comment⏎ */⏎b;`: the comment trails `@a`, and its line breaks break the
        // line after the decorators. For Prettier it leads `b`. A comment on its own line trails `@a` too, no matter
        // what `@a` decorates. For Prettier, one before a parameter leads the parameter.
        let is_trailing = match self.context.text_position {
            OwnLine => true,
            EndOfLine => false,
            Remaining => comment.is_multiline_block(),
        };
        is_trailing.then(|| Attachment::trailing(decorator))
    }

    /// oxfmt leaves a comment between a callee and the `(`, the `?.` or the `<` after it where it is. Prettier moves
    /// most of them to the first argument.
    ///
    /// ```js
    /// a // comment
    /// (b);
    /// ```
    ///
    /// After some callees, such as `new A` without type arguments and `a[b]`, the comment is attached by its position
    /// in the line, on both sides of the `(`: `new A( // comment⏎b)` is `new A(b); // comment`.
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
        let stays_after_callee = self.comments_stay_after_callee(callee);
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

    /// oxfmt moves a comment out of the empty parentheses of a call if something follows the call, unless the comments
    /// after the callee stay where they are (see [`Rules::handle_call_expression_comments_for_oxfmt`]).
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
            true if self.comments_stay_after_callee(call.callee()) => return None,
            true => self.cx.owner_of_expr(call.callee()),
        };
        self.has_following_node(Node::Expr(e))
            .then(|| Attachment::trailing(before_parenthesis))
    }

    fn comments_stay_after_callee(&self, callee: Expr<'a>) -> bool {
        comments_stay_after_callee_for_oxfmt(callee, |call| self.is_link_of_member_chain(call))
    }

    /// True if `e` is printed as a link of a member chain, meaning it's the `a()` of `a().b()`, `a().b.c()` or
    /// `a()().b()`.
    fn is_link_of_member_chain(&self, e: Expr<'a>) -> bool {
        (self.cx.is_link_of_member_chain).find(e, |e| {
            let Node::Expr(parent) = e.parent() else {
                return Err(false);
            };
            match parent.kind() {
                ExprKind::Dot { .. } | ExprKind::NonNull(_) => Ok(parent),
                ExprKind::Index { obj, .. } if obj == e => Ok(parent),
                ExprKind::Call(call) if call.callee() == e => {
                    match matches!(e.tag(), ExprTag::Dot | ExprTag::Index) {
                        true => Err(true),
                        false => Ok(parent),
                    }
                }
                _ => Err(false),
            }
        })
    }

    /// `(/* comment */ a.b)(c).d()` is `/* comment */ a.b(c).d()` for oxfmt: the comment leads `a`, the first thing
    /// that's printed after it. For Prettier it leads `a.b`, so it's printed before the `.b`.
    fn handle_comment_before_link_in_parentheses_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let Owner::Node(following_node) = self
            .following_node
            .filter(|_| self.preceding_node.is_none())?
        else {
            return None;
        };
        let chain = following_node.as_expression()?;
        if let Some((last_chain, start)) = self.cx.last_start_of_chain.get()
            && last_chain == chain
        {
            return Some(Attachment::leading(start));
        }
        let mut first = chain;
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
        let start = self.cx.owner_of_expr(first);
        self.cx.last_start_of_chain.set(Some((chain, start)));
        Some(Attachment::leading(start))
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
    ///
    /// oxfmt takes the comments before the first `[` in the text of the member access. So with a `[` in the object,
    /// comment 2 does lead `c`: `a[b]⏎// comment 2⏎[c]` is `a[b][⏎  // comment 2⏎  c⏎]`.
    pub(super) fn handle_member_expression_comments_for_oxfmt(
        &self,
        node: N<'a>,
    ) -> Option<Attachment<'a>> {
        if let Some(attachment) = self.handle_comment_before_link_in_parentheses_for_oxfmt() {
            return Some(attachment);
        }
        let N::ComputedMemberExpression(e) = node else {
            return None;
        };
        let prev_token_end = self.context.comment.prev_token_end();
        let is_before_bracket = prev_token_end <= e.object()?.outer_span().end
            || (e.is_optional() && self.prev_token_ends_with(b'.'));
        let before_comment = Span::new(e.span().start, prev_token_end);
        // A comment that looks like a type cast never trails the object.
        ((self.context.text_position == OwnLine || self.context.comment.looks_like_type_cast())
            && is_before_bracket
            && self.preceding_node.is_some()
            && !self.cx.has_bracket_in(before_comment))
        .then(|| Attachment::dangling(Owner::Node(node)))
    }

    /// For oxfmt every comment between a tag and its template leads the template. For Prettier one that ends its line
    /// trails the tag.
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

    /// For oxfmt a hole in an array is a node that prints no comments. A comment after a hole, or directly before its
    /// comma, is attached to the next element, or stays at the end of the array. For Prettier it can trail the element
    /// before the hole.
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
        // The elements between the preceding node and the token after the comment. An array can be long, and each of
        // its elements can have a comment.
        let first = match preceding_end.checked_sub(1) {
            Some(last_byte) => elements.after(last_byte),
            None => elements.first(),
        };
        let is_next_to_hole = std::iter::successors(first, |it| elements.after(it.span().start))
            .take_while(|it| it.span().start <= comment.next_token_start())
            .filter(|it| it.is_missing())
            .any(|hole| {
                let comma = hole.span().start;
                comma < comment.span().start
                    || (comma == comment.next_token_start()
                        && self.context.text_position != EndOfLine)
            });
        is_next_to_hole.then(|| match self.following_node {
            Some(following_node) => Attachment::leading(following_node),
            None => Attachment::dangling(Owner::Node(N::ArrayExpression(array))),
        })
    }

    /// `<a {/* prettier-ignore */ ...b   .c} />`. oxfmt prints `<a {/* prettier-ignore */ ...b.c} />`: a comment before
    /// the dots ignores nothing. Prettier copies the `b   .c`.
    pub(super) fn handle_ignore_comment_in_jsx_spread_for_oxfmt(&self) -> Option<Attachment<'a>> {
        let argument = self.following_node?;
        self.context.is_ignore_comment.then(|| Attachment {
            is_unignored: true,
            ..Attachment::leading(argument)
        })
    }

    /// A comment between the `/` and the `>` of a tag with attributes. oxfmt doesn't indent it like the attributes. For
    /// Prettier it trails the last attribute. `<a b="c" /⏎// comment⏎>` is printed as
    ///
    /// ```jsx
    /// <a
    ///   b="c"
    /// // comment
    /// />
    /// ```
    pub(super) fn handle_comment_after_slash_of_jsx_tag_for_oxfmt(
        &self,
        opening_element: N<'a>,
    ) -> Option<Attachment<'a>> {
        let is_after_attribute = matches!(
            self.preceding_node,
            Some(Owner::Node(N::JSXAttribute(_) | N::JSXSpreadAttribute(_)))
        );
        (is_after_attribute && self.prev_token_ends_with(b'/')).then(|| Attachment {
            is_unignored: true,
            ..Attachment::dangling(Owner::Node(opening_element))
        })
    }

    /// `A<B,C> /* prettier-ignore */ | D`. oxfmt prints `A<B, C> /* prettier-ignore */ | D`: a comment after a member
    /// of a union ignores that member only if it ends the line.
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
