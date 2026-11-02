//! [`Format`] impls for the `bun_lint::ast` handles.
//!
//! `write!(f, expr)` runs the steps that are common to every node, and calls the `print/` function for this kind of
//! node:
//! 1. If the node is ignored (`// prettier-ignore`), its source text is copied instead of steps 4 to 6.
//! 2. `/** @type {T} */ (e)` keeps its parentheses.
//! 3. The leading comments of the node.
//! 4. `(`, if the node needs parentheses in this position: `parentheses/`.
//! 5. The node.
//! 6. `)`
//! 7. The trailing comments of the node.
//!
//! Most nodes have no comment anywhere near them. While [`Formatter::is_quiet`] is true, only steps 4 to 6 run.

use super::ast_nodes::{AsAstNodes, AstNodes, ChainElement, inner_of_stmt};
use super::comments::OwnedComments;
use super::parentheses;
use super::print;
use super::print::program::ends_before_semicolon;
use super::utils::suppressed::FormatSuppressedNode;
use super::utils::typecast::write_type_casts;
use crate::prelude::*;
use crate::write;

impl<'a> Formatter<'a> {
    /// True while writing a node that has no comment inside its span, and no node inside it that owns a comment from
    /// elsewhere.
    #[inline]
    pub(crate) fn is_quiet(&self) -> bool {
        self.context().is_quiet
    }

    /// True if printing the node at `span` can skip all comment handling.
    fn has_no_comments_in(&self, span: Span) -> bool {
        !self.comments().has_comment_or_owner_in(span)
    }

    /// Calls `write`, with [`Formatter::is_quiet`] set if there's no comment in `span`.
    #[inline]
    fn in_scope(&mut self, span: Span, write: impl FnOnce(&mut Formatter<'a>)) {
        if self.context().cursor.is_active() {
            return self.in_scope_with_cursor(span, write);
        }
        let outer = self.context().is_quiet;
        self.context_mut().is_quiet = outer || self.has_no_comments_in(span);
        write(self);
        self.context_mut().is_quiet = outer;
    }

    #[cold]
    fn in_scope_with_cursor(&mut self, span: Span, write: impl FnOnce(&mut Formatter<'a>)) {
        let cursor = self.context().cursor;
        let outer = self.context().is_quiet;
        // The nodes that contain the cursor region, and the nodes right before and after it, aren't quiet, so this
        // still gets called for them.
        self.context_mut().is_quiet =
            outer || (!cursor.overlaps(span) && self.has_no_comments_in(span));
        cursor.enter(span, self);
        write(self);
        cursor.exit(span, self);
        self.context_mut().is_quiet = outer;
    }

    /// Calls `write`, which writes the node at `span`, for callers that don't go through [`Formatter::in_scope`].
    #[inline]
    pub(crate) fn track_cursor(&mut self, span: Span, write: impl FnOnce(&mut Formatter<'a>)) {
        let cursor = self.context().cursor;
        if !cursor.is_active() {
            return write(self);
        }
        cursor.enter(span, self);
        write(self);
        cursor.exit(span, self);
    }
}

/// Returns the span from Prettier's `locStart` to its `locEnd`. It includes the decorators before an `export` and
/// excludes the `;` of a JavaScript statement.
fn span_for_comments<'a>(node: AstNodes<'a>, f: &Formatter<'a>) -> Span {
    let span = node.span_with_decorators();
    match node {
        AstNodes::ExpressionStatement(_)
        | AstNodes::Directive(_)
        | AstNodes::ImportDeclaration(_)
        | AstNodes::ExportDefaultDeclaration(_)
        | AstNodes::ExportNamedDeclaration(_)
        | AstNodes::ExportAllDeclaration(_)
        | AstNodes::ReturnStatement(_)
        | AstNodes::ThrowStatement(_)
        | AstNodes::DoWhileStatement(_)
        | AstNodes::BreakStatement(_)
        | AstNodes::ContinueStatement(_)
        | AstNodes::DebuggerStatement(_)
        | AstNodes::VariableDeclaration(_)
        | AstNodes::PropertyDefinition(_)
        | AstNodes::AccessorProperty(_)
        | AstNodes::MethodDefinition(_) => f.file().without_semicolon(span),
        // These end where their last body ends. If that body is an empty statement, its `;` is the statement itself and
        // stays in the span.
        AstNodes::IfStatement(statement)
        | AstNodes::ForStatement(statement)
        | AstNodes::ForInStatement(statement)
        | AstNodes::ForOfStatement(statement)
        | AstNodes::WhileStatement(statement)
        | AstNodes::WithStatement(statement)
        | AstNodes::LabeledStatement(statement)
            if ends_before_semicolon(statement) =>
        {
            f.file().without_semicolon(span)
        }
        _ => span,
    }
}

pub(crate) fn write_trailing_comments_of<'a>(node: AstNodes<'a>, f: &mut Formatter<'a>) {
    FormatTrailingComments::Comments(f.comments().of_node(node).trailing).fmt(f);
}

/// Writes `node` with the comments it owns: Prettier's `printComments`. `write` writes the node itself. If the node is
/// ignored, its source text is copied instead.
#[inline]
pub(crate) fn format_node<'a>(
    node: AstNodes<'a>,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    match f.is_quiet() {
        true => write(f),
        false => format_node_with_comments(node, f, write),
    }
}

fn format_node_with_comments<'a>(
    node: AstNodes<'a>,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    let skip_trailing = f.context_mut().take_skip_trailing_comments();
    let owned = f.comments().of_node(node);
    if owned.is_ignored {
        return format_ignored_node(node, &owned, skip_trailing, f, |f| {
            write_ignored_node(node, f)
        });
    }
    FormatLeadingComments::Comments(owned.leading).fmt(f);
    f.in_scope(node.span_with_decorators(), write);
    if !skip_trailing {
        FormatTrailingComments::Comments(owned.trailing).fmt(f);
    }
}

/// Writes an ignored node with the comments it owns. `write_source_text` copies the node, and marks the comments in the
/// copied text as printed.
///
/// A comment that the node owns can be inside the node. It's copied with the node, so it isn't printed here:
///
/// ```js
/// a
/// // prettier-ignore
/// .b;
/// ```
///
/// A dangling comment can be outside the node: Prettier moves this one into the empty body, copies the body, and then
/// throws because the comment wasn't printed. Here it's printed before the body.
///
/// ```js
/// class A // prettier-ignore
/// {}
/// ```
#[cold]
fn format_ignored_node<'a>(
    node: AstNodes<'a>,
    owned: &OwnedComments<'a>,
    skip_trailing: bool,
    f: &mut Formatter<'a>,
    write_source_text: impl FnOnce(&mut Formatter<'a>),
) {
    let node_start = node.span_with_decorators().start;
    let count_before_node = (owned.leading.iter())
        .take_while(|comment| comment.span().start < node_start)
        .count();
    let (before_node, in_node) = owned.leading.split_at(count_before_node);
    FormatLeadingComments::Comments(before_node).fmt(f);
    let count_before_node = (owned.dangling.iter())
        .take_while(|comment| comment.span().start < node_start)
        .count();
    FormatLeadingComments::Comments(owned.dangling.slice(0, count_before_node)).fmt(f);
    write_source_text(f);
    // This only prints the ones that weren't copied.
    FormatTrailingComments::Comments(in_node).fmt(f);
    if !skip_trailing {
        FormatTrailingComments::Comments(owned.trailing).fmt(f);
    }
}

/// Writes a node whose own printer prints its leading and trailing comments (Prettier's `willPrintOwnComments`). This
/// only handles `prettier-ignore`.
#[inline]
pub(crate) fn format_node_without_comments<'a>(
    node: AstNodes<'a>,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    if f.is_quiet() || !f.comments().is_ignored(node) {
        return write(f);
    }
    let owned = f.comments().of_node(node);
    format_ignored_node(node, &owned, false, f, |f| write_ignored_node(node, f));
}

/// Writes a name or a key, which is a token here and a node for Prettier, with the comments it owns.
#[inline]
pub(crate) fn format_name<'a>(
    span: Span,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    format_name_or_copy(false, span, f, write);
}

/// The name at `span`, copied from the source, for a caller that writes the name's comments itself.
pub(crate) fn name_without_comments<'a>(span: Span) -> impl Format<'a> {
    format_with(move |f| f.track_cursor(span, |f| write!(f, source_text(span))))
}

/// [`format_name`] for a name that Prettier prints like any other node, so a `prettier-ignore` comment applies to it:
/// `import /* prettier-ignore */ *  as a from /* prettier-ignore */ 'b'`, `a./* prettier-ignore */ \u{62}`. Don't use
/// it for a property key.
pub(crate) fn format_ignorable_name<'a>(
    span: Span,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    format_name_or_copy(true, span, f, write);
}

#[inline(always)]
fn format_name_or_copy<'a>(
    can_be_ignored: bool,
    span: Span,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    if f.is_quiet() {
        return write(f);
    }
    let owned = f.comments().of_name(span.start);
    FormatLeadingComments::Comments(owned.leading).fmt(f);
    f.track_cursor(span, |f| match can_be_ignored && owned.is_ignored {
        true => FormatSuppressedNode(span).fmt(f),
        false => write(f),
    });
    FormatTrailingComments::Comments(owned.trailing).fmt(f);
}

/// Prettier's `printIgnored`: copies the source text of `node`, adding the parentheses and the `;` it needs in its
/// position. This is the only place that writes an ignored node.
pub(crate) fn write_ignored_node<'a>(node: AstNodes<'a>, f: &mut Formatter<'a>) {
    // `<T>`. The handle in these two is the node that has the type parameters or arguments.
    if matches!(
        node,
        AstNodes::TSTypeParameterDeclaration(_) | AstNodes::TSTypeParameterInstantiation(_)
    ) {
        let span = node.span();
        return f.track_cursor(span, |f| FormatSuppressedNode(span).fmt(f));
    }
    if let Some(expr) = node.as_expression() {
        return write_suppressed_expression(expr, false, f);
    }
    let statement = match (node, node.raw()) {
        (
            AstNodes::CatchClause(_)
            | AstNodes::TSInterfaceBody(_)
            | AstNodes::TSEnumBody(_)
            | AstNodes::TSModuleBlock(_),
            _,
        ) => None,
        (_, Node::Stmt(statement)) => Some(statement),
        (AstNodes::Function(func), _) => func.owner().as_stmt(),
        (AstNodes::Class(class), _) => class.owner().as_stmt(),
        _ => None,
    };
    if let Some(statement) = statement {
        return write_ignored_statement(statement, span_for_comments(node, f), f);
    }
    match (node, node.raw()) {
        (AstNodes::TSTypeAnnotation(_), _) => {}
        (_, Node::Type(ty)) => return write_suppressed_type(ty, f),
        _ => {}
    }
    let span = node.span();
    f.track_cursor(span, |f| FormatSuppressedNode(span).fmt(f));
}

// ───────────────────────────── names ─────────────────────────────

/// A name that's a node in ESTree but not here, with the comments around it: the `b` of `a.b`, the name of a function,
/// a label.
#[derive(Copy, Clone)]
pub(crate) struct FormatIdentifier {
    span: Span,
}

/// `ident`, copied from the source.
#[inline]
pub(crate) fn identifier(ident: Ident<'_>) -> FormatIdentifier {
    FormatIdentifier { span: ident.span() }
}

impl<'a> Format<'a> for FormatIdentifier {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        format_ignorable_name(self.span, f, |f| write!(f, source_text(self.span)));
    }
}

impl Spanned for FormatIdentifier {
    fn span(&self) -> Span {
        self.span
    }
}

// ───────────────────────────── expressions ─────────────────────────────

/// Options for writing a function or arrow function, which depend on its position. See `print/function.rs` and
/// `print/arrow_function_expression.rs`.
#[derive(Copy, Clone, Default)]
pub(crate) enum ExprOptions {
    #[default]
    None,
    Function(print::function::FormatFunctionOptions),
    Arrow(print::arrow_function_expression::FormatJsArrowFunctionExpressionOptions),
}

/// An expression, with options, or without the `ChainExpression` that ESTree has around it.
#[derive(Copy, Clone)]
pub(crate) struct FormatExpr<'a> {
    expr: Expr<'a>,
    options: ExprOptions,
    /// The `ChainExpression` has already been handled.
    is_in_chain_expression: bool,
}

impl<'a> FormatExpr<'a> {
    #[inline]
    pub(crate) fn with_options(expr: Expr<'a>, options: ExprOptions) -> Self {
        FormatExpr {
            expr,
            options,
            is_in_chain_expression: false,
        }
    }

    /// `ChainExpression.expression`: `expr` is a whole optional chain, and this formats it as the member access or call
    /// inside the `ChainExpression`.
    #[inline]
    pub(crate) fn in_chain_expression(expr: Expr<'a>) -> Self {
        FormatExpr {
            expr,
            options: ExprOptions::None,
            is_in_chain_expression: true,
        }
    }

    /// Steps 4 to 6.
    #[inline]
    fn write_in_parentheses(self, is_chain_expression: bool, f: &mut Formatter<'a>) {
        let needs_parentheses = match is_chain_expression {
            true => parentheses::expression::chain_expression_needs_parentheses(self.expr, f),
            false => parentheses::expression::needs_parentheses(self.expr, f),
        };
        if needs_parentheses {
            "(".fmt(f);
        }
        match is_chain_expression {
            true => {
                print::expressions::write_chain_expression(self.expr, f);
            }
            false => write_expression_after_stack_check(self.expr, self.options, f),
        }
        if needs_parentheses {
            ")".fmt(f);
        }
    }

    #[cold]
    fn fmt_with_comments(self, is_chain_expression: bool, f: &mut Formatter<'a>) {
        let write_target =
            |f: &mut Formatter<'a>| self.fmt_without_type_casts(is_chain_expression, f);
        if self.is_in_chain_expression || !write_type_casts(self.expr, f, &write_target) {
            write_target(f);
        }
    }

    /// Writes the expression with the comments it owns, inside any type cast parentheses.
    fn fmt_without_type_casts(self, is_chain_expression: bool, f: &mut Formatter<'a>) {
        let (expr, span) = (self.expr, self.expr.span());
        let node = expr.as_chain_element();
        // typescript-estree has a `ChainExpression` around an optional chain, which can't own comments. The comments
        // belong to the member access or the call in it, so they're printed inside its parentheses. Babel has no such
        // node, so there they're printed outside. oxfmt prints them outside too, because its `ChainExpression` prints
        // them: `(/* comment */ a?.b).c` is `/* comment */ (a?.b).c`.
        let has_chain_expression_node =
            !f.context().has_babel_tree() && !f.options().flavor.is_oxfmt();
        if match has_chain_expression_node {
            true => is_chain_expression,
            false => self.is_in_chain_expression,
        } {
            return self.write_in_parentheses(is_chain_expression, f);
        }
        // A JSX element prints its comments together with its parentheses. Prettier copies an ignored element without
        // them: `((<a   />) /* prettier-ignore */, b)`
        if matches!(node, AstNodes::JSXElement(_) | AstNodes::JSXFragment(_))
            && !(print::jsx::ignored_jsx_gets_no_parentheses(f) && f.comments().is_ignored(node))
        {
            return f.track_cursor(span, |f| self.write_in_parentheses(false, f));
        }
        if print::function::write_called_function_with_comments(expr, self.options, f) {
            return;
        }
        let skip_trailing = f.context_mut().take_skip_trailing_comments();
        let owned = f.comments().of_node(node);
        if owned.is_ignored {
            return format_ignored_node(node, &owned, skip_trailing, f, |f| {
                write_suppressed_expression(expr, is_chain_expression, f)
            });
        }
        if type_cast_comment_goes_into_added_parentheses(expr, owned.leading, f) {
            let (outside, inside) = owned.leading.split_at(owned.leading.len() - 1);
            FormatLeadingComments::Comments(outside).fmt(f);
            "(".fmt(f);
            FormatLeadingComments::Comments(inside).fmt(f);
            f.in_scope(span, |f| {
                write_expression_after_stack_check(expr, self.options, f);
            });
            ")".fmt(f);
        } else {
            FormatLeadingComments::Comments(owned.leading).fmt(f);
            f.in_scope(span, |f| self.write_in_parentheses(is_chain_expression, f));
        }
        if !skip_trailing {
            FormatTrailingComments::Comments(owned.trailing).fmt(f);
        }
    }
}

/// `(/** @type {T} */ () => {})();`: for oxfmt a comment that looks like a type cast stays directly before its `(`,
/// which here is the `(` of the parameters. Prettier prints it before the parentheses around the function.
fn type_cast_comment_goes_into_added_parentheses<'a>(
    expr: Expr<'a>,
    leading_comments: CommentList<'a>,
    f: &Formatter<'a>,
) -> bool {
    f.options().flavor.is_oxfmt()
        && leading_comments.last().is_some_and(|comment| {
            comment.looks_like_type_cast() && comment.next_token_start() == expr.span().start
        })
        && expr.arrow_function().is_some()
        && f.source_text().byte_at(expr.span().start) == Some(b'(')
        && parentheses::expression::needs_parentheses(expr, f)
}

/// `a as B // prettier-ignore ⏎ && c`: both tools print `(a as B)`, just as they do when formatting it.
///
/// `a as B // prettier-ignore ⏎ ? c : d`: oxfmt doesn't add parentheses around an operand of a conditional expression
/// that's ignored by a trailing comment.
fn adds_parentheses_to_ignored_expression<'a>(expr: Expr<'a>, f: &Formatter<'a>) -> bool {
    let comments = f.comments().of_node(expr.as_chain_element()).trailing;
    !(f.options().flavor.is_oxfmt()
        && matches!(expr.ast_parent(), AstNodes::ConditionalExpression(_))
        && (comments.iter()).any(|comment| f.comments().is_suppression_comment(comment)))
}

/// Prettier's `printIgnored` for an expression, with the parentheses it needs.
fn write_suppressed_expression<'a>(
    expr: Expr<'a>,
    is_chain_expression: bool,
    f: &mut Formatter<'a>,
) {
    let span = expr.span();
    let needs_parentheses = match is_chain_expression {
        true => parentheses::expression::chain_expression_needs_parentheses(expr, f),
        false => parentheses::expression::needs_parentheses(expr, f),
    };
    // `{`, `function` and `class` start a statement, and the source parentheses may wrap more than this expression:
    // `({} // .. ⏎ .a)`.
    let starts_statement = matches!(
        expr.kind(),
        ExprKind::Object(_) | ExprKind::Fn(_) | ExprKind::Class(_) | ExprKind::Ident(_)
    );
    let needs_parentheses = (needs_parentheses
        && (adds_parentheses_to_ignored_expression(expr, f)
            || expr.is_parenthesized()
            || starts_statement))
        || parentheses::expression::source_text_needs_its_parentheses(expr, f);
    // A class expression with decorators gets its own lines.
    let is_decorated_class =
        matches!(expr.kind(), ExprKind::Class(class) if class.decorators().next().is_some());
    f.track_cursor(span, |f| {
        write!(f, needs_parentheses.then_some("("));
        match is_decorated_class {
            true => write!(f, soft_block_indent(&FormatSuppressedNode(span))),
            false => write!(f, FormatSuppressedNode(span)),
        }
        write!(f, needs_parentheses.then_some(")"));
    });
}

impl<'a> FormatExpr<'a> {
    /// True if this is ESTree's `ChainExpression`.
    #[inline]
    fn is_chain_expression(&self) -> bool {
        !self.is_in_chain_expression
            && matches!(
                self.expr.tag(),
                ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull
            )
            && self.expr.is_chain_root()
    }
}

impl<'a> Format<'a> for FormatExpr<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        if !f.context_mut().has_stack_left() {
            return;
        }
        let is_chain_expression = self.is_chain_expression();
        match f.is_quiet() {
            true => self.write_in_parentheses(is_chain_expression, f),
            false => self.fmt_with_comments(is_chain_expression, f),
        }
    }
}

impl Spanned for FormatExpr<'_> {
    #[inline]
    fn span(&self) -> Span {
        self.expr.span()
    }
}

impl<'a> Format<'a> for Expr<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        format_expression(*self, f);
    }
}

/// Same as [`FormatExpr`] without options, with a fast path for the common case: no comments, no parentheses, and not a
/// whole optional chain.
fn format_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    if !f.is_quiet() {
        return format_expression_slow_path(e, f);
    }
    let tag = e.tag();
    // Nearly half of all expressions are names. The names that can need parentheses have 3 to 9 letters. They're only
    // longer if they're written with escapes or are placeholders for an expression in a template.
    if tag == ExprTag::Ident {
        let span = e.span();
        let may_need_parentheses =
            span.len() >= 3 && (span.len() <= 9 || span.len() >= 35 || !f.is_plain_source(span));
        return match may_need_parentheses && parentheses::expression::needs_parentheses(e, f) {
            true => format_expression_slow_path(e, f),
            false => write!(f, source_text(span)),
        };
    }
    if !f.context_mut().has_stack_left() {
        return;
    }
    let is_chain_expression = matches!(
        tag,
        ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull
    ) && e.is_chain_root();
    match is_chain_expression || parentheses::expression::needs_parentheses(e, f) {
        true => format_expression_slow_path(e, f),
        false => write_expression_of(tag, e, ExprOptions::None, f),
    }
}

#[inline(never)]
fn format_expression_slow_path<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    FormatExpr::with_options(e, ExprOptions::None).fmt(f);
}

/// Writes every `!` of `x!!`, which is one expression, along with the comments between them, which dangle from it.
pub(crate) struct FormatNonNullMarks<'a>(pub(crate) Expr<'a>);

impl<'a> Format<'a> for FormatNonNullMarks<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let mut inner = self.0.inner_non_null_spans().peekable();
        if inner.peek().is_some() {
            let mut comments = f.comments().of_node(self.0.as_chain_element()).dangling;
            while inner.next().is_some() {
                let next_end = inner
                    .peek()
                    .map_or_else(|| self.0.span().end, |next| next.end);
                let count = (comments.iter())
                    .take_while(|comment| comment.span().start < next_end)
                    .count();
                let (before_next_mark, rest) = comments.split_at(count);
                write!(f, ["!", FormatTrailingComments::Comments(before_next_mark)]);
                comments = rest;
            }
        }
        write!(f, "!");
    }
}

/// Step 5 for an expression.
///
/// This only dispatches. Each function it calls has its own stack frame, sized for that kind, and the kinds written
/// inline here need no frame at all.
///
/// It checks the stack because some callers get here without going through [`FormatExpr`] or [`format_expression`],
/// such as the guard of a Flow `match` case.
pub(crate) fn write_expression<'a>(e: Expr<'a>, options: ExprOptions, f: &mut Formatter<'a>) {
    if f.context_mut().has_stack_left() {
        write_expression_after_stack_check(e, options, f);
    }
}

fn write_expression_after_stack_check<'a>(
    e: Expr<'a>,
    options: ExprOptions,
    f: &mut Formatter<'a>,
) {
    write_expression_of(e.tag(), e, options, f);
}

/// `tag` is `e.tag()`.
#[inline(always)]
fn write_expression_of<'a>(tag: ExprTag, e: Expr<'a>, options: ExprOptions, f: &mut Formatter<'a>) {
    match tag {
        ExprTag::Missing => {}
        ExprTag::Ident | ExprTag::PrivateIdentifier => write!(f, source_text(e.span())),
        ExprTag::This => write!(f, "this"),
        ExprTag::Super => write!(f, "super"),
        ExprTag::Null => write!(f, "null"),
        ExprTag::True => write!(f, "true"),
        ExprTag::False => write!(f, "false"),
        ExprTag::Number => write_numeric_literal(e, f),
        ExprTag::String => write_string_literal(e, f),
        ExprTag::Dot | ExprTag::Index => write_member_expression(e, f),
        ExprTag::Call => write_call_expression(e, f),
        ExprTag::New => write_new_expression(e, f),
        ExprTag::Fn => write_function_expression(e, options, f),
        ExprTag::Object => write_object(e, f),
        ExprTag::Array => write_array(e, f),
        ExprTag::Unary => write_unary_expression(e, f),
        ExprTag::Binary => write_binary_expression(e, f),
        ExprTag::Assign => write_assignment_expression(e, f),
        ExprTag::Cond => write_conditional_expression(e, f),
        _ => write_less_common_expression(e, f),
    }
}

#[inline(never)]
fn write_numeric_literal<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    print::literals::write_numeric_literal(e, f);
}

#[inline(never)]
fn write_string_literal<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    match e.is_jsx_text() {
        true => print::jsx::write_jsx_text(e, f),
        false => print::literals::write_string_literal(e, f),
    }
}

#[inline(never)]
fn write_member_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    print::member_expression::write_member_expression(e, f);
}

#[inline(never)]
fn write_call_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    if let Some(call) = e.as_call() {
        print::call_like_expression::write_call_expression(e, call, f);
    }
}

#[inline(never)]
fn write_new_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    if let Some(call) = e.as_call_like()
        && !(f.file().is_flow() && print::flow::write_expression_with_braces(e, call, f))
    {
        print::call_like_expression::write_new_expression(e, call, f);
    }
}

#[inline(never)]
fn write_function_expression<'a>(e: Expr<'a>, options: ExprOptions, f: &mut Formatter<'a>) {
    let Some(func) = e.as_fn() else {
        return;
    };
    match (func.is_arrow(), options) {
        (true, ExprOptions::Arrow(options)) => {
            print::arrow_function_expression::write_arrow_function_expression(e, func, options, f);
        }
        (true, _) => print::arrow_function_expression::write_arrow_function_expression(
            e,
            func,
            Default::default(),
            f,
        ),
        (false, ExprOptions::Function(options)) => {
            print::function::write_function(func, options, f)
        }
        (false, _) => print::function::write_function(func, Default::default(), f),
    }
}

#[inline(never)]
fn write_object<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let ExprKind::Object(props) = e.kind() else {
        return;
    };
    match e.is_assignment_target() {
        true => print::expressions::write_object_assignment_target(e, props, f),
        false => print::expressions::write_object_expression(e, props, f),
    }
}

#[inline(never)]
fn write_array<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let ExprKind::Array(elements) = e.kind() else {
        return;
    };
    match e.is_assignment_target() {
        true => print::expressions::write_array_assignment_target(e, elements, f),
        false => print::array_expression::write_array_expression(e, elements, f),
    }
}

#[inline(never)]
fn write_unary_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let (Some(op), Some(operand)) = (e.unary_op(), e.operand()) else {
        return;
    };
    match op.is_update() {
        true => print::expressions::write_update_expression(op, operand, f),
        false => print::expressions::write_unary_expression(op, operand, f),
    }
}

#[inline(never)]
fn write_binary_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    match e.binary_op() {
        Some(BinOp::Comma) => print::sequence_expression::write_sequence_expression(e, f),
        _ => print::binary_like_expression::write_binary_like_expression(e, f),
    }
}

#[inline(never)]
fn write_assignment_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    print::expressions::write_assignment_expression(e, f);
}

#[inline(never)]
fn write_conditional_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    print::expressions::write_conditional_expression(e, f);
}

/// Handles the kinds that [`write_expression`] doesn't dispatch directly.
#[inline(never)]
fn write_less_common_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    use print::{expressions, literals};
    match e.kind() {
        ExprKind::BigInt(_) => literals::write_big_int_literal(e, f),
        ExprKind::Regex(regex) => literals::write_reg_exp_literal(e, regex, f),
        ExprKind::Template(template) => print::template::write_template_literal(e, template, f),
        ExprKind::TaggedTemplate(call) => {
            print::template::write_tagged_template_expression(e, call, f)
        }
        ExprKind::Class(class) => print::class::write_class(class, f),
        ExprKind::Spread(_) if e.jsx_container_span().is_some() => {
            print::jsx::write_jsx_spread_child(e, f)
        }
        ExprKind::Spread(argument) => write!(f, ["...", argument]),
        ExprKind::Await(argument) => expressions::write_await_expression(e, argument, f),
        ExprKind::Yield { value, star } => expressions::write_yield_expression(value, star, f),
        ExprKind::As { .. } | ExprKind::AsConst(_) if e.is_angle_bracket_assertion() => {
            match f.file().is_flow() {
                true => print::flow::write_type_cast_expression(e, f),
                false => expressions::write_ts_type_assertion(e, f),
            }
        }
        ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. } => {
            print::as_or_satisfies_expression::write_as_or_satisfies_expression(e, f);
        }
        ExprKind::NonNull(expression) => write!(f, [expression, FormatNonNullMarks(e)]),
        ExprKind::Instantiation { expr, type_args } => {
            write!(
                f,
                [
                    expr,
                    print::type_parameters::type_arguments(type_args, Node::Expr(e))
                ]
            );
        }
        ExprKind::Jsx(jsx) => print::jsx::write_jsx_element(e, jsx, f),
        ExprKind::ImportCall { args } => {
            print::call_like_expression::write_import_expression(e, args, f)
        }
        ExprKind::ImportMeta | ExprKind::NewTarget => expressions::write_meta_property(e, f),
        _ => {}
    }
}

// ───────────────────────────── statements ─────────────────────────────

impl<'a> Format<'a> for Stmt<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        format_statement(*self, f);
    }
}

fn format_statement<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    if !f.context_mut().has_stack_left() {
        return;
    }
    match f.is_quiet() {
        true => write_statement(statement, f),
        false => format_statement_with_comments(statement, f),
    }
}

#[inline(never)]
fn format_statement_with_comments<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    // The `AstNodes` of a function or class declaration is backed by the function or class, not by the statement.
    let is_backed_by_statement = !matches!(statement.tag(), StmtTag::Fn | StmtTag::Class);
    if is_backed_by_statement && !f.comments().is_owner(Node::Stmt(statement)) {
        f.context_mut().take_skip_trailing_comments();
        f.in_scope(statement.span(), |f| write_statement(statement, f));
    } else {
        format_node_with_comments(statement.as_ast_nodes(), f, |f| {
            write_statement(statement, f)
        });
    }
    if !f.context().comments_without_printer.is_empty() {
        write_comments_without_printer(statement.span(), f);
    }
}

/// Writes the comments inside `span` (a statement or a class member) that weren't printed in the first pass. See
/// [`crate::ir::run::format_with_marks`].
#[cold]
#[inline(never)]
fn write_comments_without_printer<'a>(span: Span, f: &mut Formatter<'a>) {
    let ids = std::mem::take(&mut f.context_mut().comments_without_printer);
    // The ids are in source order.
    let start_of = |id: u32| f.file().comment(id).span().start;
    let first = ids.partition_point(|&id| start_of(id) < span.start);
    let end = ids.partition_point(|&id| start_of(id) < span.end);
    for &id in ids.get(first..end).unwrap_or_default() {
        let comment = f.comments().all().slice(id as usize, id as usize + 1);
        FormatTrailingComments::Comments(comment).fmt(f);
    }
    f.context_mut().comments_without_printer = ids;
}

/// True if `statement` is in the head of a `for`, not its body.
pub(crate) fn is_in_head_of_for(statement: Stmt<'_>) -> bool {
    matches!(statement.parent(), Node::Stmt(parent) if matches!(
        parent.kind(),
        StmtKind::For { body, .. } | StmtKind::ForIn { body, .. } | StmtKind::ForOf { body, .. }
            if statement.span().end <= body.span().start
    ))
}

/// Prettier's `printIgnored` for a statement. `span` is the statement's span without its `;`, which is printed
/// according to the options.
fn write_ignored_statement<'a>(statement: Stmt<'a>, span: Span, f: &mut Formatter<'a>) {
    if ignored_node_terminator_follows_semi(f) {
        return write_ignored_statement_without_terminator(statement, span, f);
    }
    let has_semicolon = match statement.kind() {
        // `export var a` is an `ExportNamedDeclaration`.
        StmtKind::Var(_)
            if statement.is_exported() && span.start < statement.span_without_export().start =>
        {
            span.end < statement.span().end
        }
        // Prettier adds one in the head of a `for` too: `for (/* prettier-ignore */ const a; of b)`.
        StmtKind::Var(_) if is_in_head_of_for(statement) => false,
        StmtKind::Break(_) | StmtKind::Continue(_) | StmtKind::Debugger | StmtKind::Var(_) => true,
        _ => span.end < statement.span().end,
    };
    if f.options().semicolons.is_always() {
        return f.track_cursor(span, |f| {
            write!(
                f,
                [FormatSuppressedNode(span), has_semicolon.then_some(";")]
            )
        });
    }
    let needs_leading_semicolon =
        print::statements::ignored_statement_needs_semicolon(statement, span.start, f);
    f.track_cursor(span, |f| {
        write!(
            f,
            [
                needs_leading_semicolon.then_some(";"),
                FormatSuppressedNode(span)
            ]
        )
    });
}

/// For oxfmt the `;` at the end of a statement or class member isn't covered by a `prettier-ignore` comment. It's
/// printed or omitted as for any other statement. Prettier only adds one to a statement that has one, and copies
/// members, type aliases and functions without a body verbatim.
///
/// The exception is a declaration that's ignored after its `export`, which oxfmt copies along with its `;`. See
/// `is_ignored_with_its_semicolon` in `print/export_declarations.rs`.
pub(crate) fn ignored_node_terminator_follows_semi(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// See [`ignored_node_terminator_follows_semi`]. `span` is the same as for [`write_ignored_statement`].
fn write_ignored_statement_without_terminator<'a>(
    statement: Stmt<'a>,
    span: Span,
    f: &mut Formatter<'a>,
) {
    let content = match ends_with_terminator(statement) {
        true => f
            .file()
            .without_semicolon(Span::new(span.start, statement.span().end)),
        false => span,
    };
    if f.options().semicolons.is_always() {
        let terminator = ends_with_terminator(statement).then_some(";");
        return f.track_cursor(content, |f| {
            write!(f, [FormatSuppressedNode(content), terminator])
        });
    }
    // If a type cast comment comes first, the `;` was already printed before it: see
    // `semicolon_goes_before_ignored_statement_cast_comment`.
    let needs_leading_semicolon =
        print::statements::ignored_statement_needs_semicolon(statement, content.start, f)
            && !print::statements::follows_type_cast_comment(content.start, f);
    f.track_cursor(content, |f| {
        write!(
            f,
            [
                needs_leading_semicolon.then_some(";"),
                FormatSuppressedNode(content)
            ]
        )
    });
}

/// True if `statement` ends with a `;` when semicolons are enabled.
fn ends_with_terminator(statement: Stmt<'_>) -> bool {
    // The `;` after the declaration in the head of a loop is a separator.
    if is_in_head_of_for(statement) {
        return false;
    }
    let mut last = statement;
    loop {
        last = match last.kind() {
            StmtKind::If { yes, no, .. } => no.unwrap_or(yes),
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::With { body, .. }
            | StmtKind::Labeled { body, .. } => body,
            StmtKind::TypeAlias(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_) => return true,
            StmtKind::Fn(func) => return !func.has_body(),
            _ => return ends_before_semicolon(last),
        };
    }
}

/// `ExportNamedDeclaration.declaration`, `ExportDefaultDeclaration.declaration`: the statement
/// without its `export`.
#[derive(Copy, Clone)]
pub(crate) struct FormatDeclaration<'a>(pub(crate) Stmt<'a>);

impl<'a> Format<'a> for FormatDeclaration<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        format_node(inner_of_stmt(self.0), f, |f| write_declaration(self.0, f));
    }
}

impl Spanned for FormatDeclaration<'_> {
    fn span(&self) -> Span {
        self.0.span_without_export()
    }
}

/// Step 5 for a statement.
pub(crate) fn write_statement<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let is_declaration = !matches!(
        statement.tag(),
        StmtTag::ExportNamed | StmtTag::ExportDefault | StmtTag::ExportStar
    );
    match is_declaration && !statement.modifiers().is_empty() && statement.is_exported() {
        true => print::export_declarations::write_exported_declaration(statement, f),
        false => write_declaration(statement, f),
    }
}

/// Step 5 for a statement, without its `export`.
pub(crate) fn write_declaration<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    use print::{statements, ts_declarations};
    match statement.kind() {
        StmtKind::Empty => statements::write_empty_statement(statement, f),
        StmtKind::Debugger => write!(f, ["debugger", print::semicolon::OptionalSemicolon]),
        StmtKind::Expr(expression)
            if expression.tag() == ExprTag::String && statement.directive().is_some() =>
        {
            print::program::write_directive(statement, f);
        }
        StmtKind::Expr(expression) => {
            statements::write_expression_statement(statement, expression, f)
        }
        StmtKind::Var(declarations) => {
            print::variable_declaration::write_variable_declaration(statement, declarations, f);
        }
        StmtKind::Fn(func) => print::function::write_function(func, Default::default(), f),
        StmtKind::Class(class) => print::class::write_class(class, f),
        StmtKind::Interface(interface) => {
            ts_declarations::write_ts_interface_declaration(statement, interface, f)
        }
        StmtKind::TypeAlias(alias) => {
            ts_declarations::write_ts_type_alias_declaration(statement, alias, f)
        }
        StmtKind::Enum(declaration) => {
            ts_declarations::write_ts_enum_declaration(statement, declaration, f)
        }
        StmtKind::Module(module) => {
            ts_declarations::write_ts_module_declaration(statement, module, f)
        }
        StmtKind::Return(argument) => {
            print::return_or_throw_statement::write_return_statement(statement, argument, f);
        }
        StmtKind::If { test, yes, no } => {
            statements::write_if_statement(statement, test, yes, no, f)
        }
        StmtKind::For {
            init,
            test,
            update,
            body,
        } => statements::write_for_statement(statement, init, test, update, body, f),
        StmtKind::ForIn { left, expr, body } => {
            statements::write_for_in_statement(statement, left, expr, body, f)
        }
        StmtKind::ForOf {
            left,
            expr,
            body,
            is_await,
        } => statements::write_for_of_statement(statement, left, expr, body, is_await, f),
        StmtKind::While { test, body } => {
            statements::write_while_statement(statement, test, body, f)
        }
        StmtKind::DoWhile { body, test } => {
            statements::write_do_while_statement(statement, body, test, f)
        }
        StmtKind::Block(body) => print::block_statement::write_block_statement(statement, body, f),
        StmtKind::With { object, body } => {
            statements::write_with_statement(statement, object, body, f)
        }
        StmtKind::Switch { expr, cases } => {
            print::switch_statement::write_switch_statement(statement, expr, cases, f)
        }
        StmtKind::Try {
            block,
            param,
            handler,
            finalizer,
        } => print::try_statement::write_try_statement(
            statement, block, param, handler, finalizer, f,
        ),
        StmtKind::Throw(argument) => {
            print::return_or_throw_statement::write_throw_statement(statement, argument, f)
        }
        StmtKind::Break(_) => statements::write_break_statement(statement, f),
        StmtKind::Continue(_) => statements::write_continue_statement(statement, f),
        StmtKind::Labeled { body, .. } => statements::write_labeled_statement(statement, body, f),
        StmtKind::Import(import) => {
            print::import_declaration::write_import_declaration(statement, import, f)
        }
        StmtKind::ImportEquals(import) => {
            ts_declarations::write_ts_import_equals_declaration(statement, import, f)
        }
        StmtKind::ExportNamed(export) => {
            print::export_declarations::write_export_named_declaration(statement, export, f)
        }
        StmtKind::ExportStar { .. } => {
            print::export_declarations::write_export_all_declaration(statement, f)
        }
        StmtKind::ExportDefault(expression) => {
            print::export_declarations::write_export_default_expression(statement, expression, f);
        }
        StmtKind::ExportAssign(expression) => {
            ts_declarations::write_ts_export_assignment(expression, f)
        }
        StmtKind::ExportAsNamespace(_) => {
            ts_declarations::write_ts_namespace_export_declaration(statement, f)
        }
    }
}

// ───────────────────────────── types ─────────────────────────────

impl<'a> Format<'a> for TypeNode<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        if !f.context_mut().has_stack_left() {
            return;
        }
        match f.is_quiet() {
            true => write_type_in_parentheses(*self, f),
            false => format_type_with_comments(*self, f),
        }
    }
}

#[inline]
fn write_type_in_parentheses<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let tag = ty.tag();
    if matches!(tag, TypeTag::Keyword | TypeTag::BoolLit) {
        return write!(f, source_text(ty.span()));
    }
    // No other kind of type ever needs parentheses.
    let may_need_parentheses = match tag {
        TypeTag::Fn
        | TypeTag::Infer
        | TypeTag::Union
        | TypeTag::Intersection
        | TypeTag::Cond
        | TypeTag::Keyof
        | TypeTag::Readonly
        | TypeTag::UniqueSymbol
        | TypeTag::Typeof
        | TypeTag::Import => true,
        // Flow's `renders T` writes its own.
        TypeTag::Unique => !f.file().is_flow(),
        // In Flow, as the return type of an arrow function: `(): (A<{ b: () => void }>) => c`.
        TypeTag::Ref => f.file().is_flow(),
        _ => false,
    };
    let needs_parentheses = may_need_parentheses && parentheses::ts_type::needs_parentheses(ty, f);
    if needs_parentheses {
        "(".fmt(f);
    }
    write_type(ty, f);
    if needs_parentheses {
        ")".fmt(f);
    }
}

/// Prettier's `printIgnored` for a type, with the parentheses it needs.
fn write_suppressed_type<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let needs_parentheses = parentheses::ts_type::needs_parentheses(ty, f);
    f.track_cursor(ty.span(), |f| {
        write!(
            f,
            [
                needs_parentheses.then_some("("),
                FormatSuppressedNode(ty.span()),
                needs_parentheses.then_some(")")
            ]
        );
    });
}

#[cold]
fn format_type_with_comments<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let write = |f: &mut Formatter<'a>| write_type_in_parentheses(ty, f);
    match print::union_type::union_prints_own_comments(ty, f) {
        true => {
            format_node_without_comments(ty.as_ast_nodes(), f, |f| f.track_cursor(ty.span(), write))
        }
        false => format_node_with_comments(ty.as_ast_nodes(), f, write),
    }
}

pub(crate) fn write_type<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    use print::ts_types;
    match ty.kind() {
        TypeKind::Error | TypeKind::Unique(_)
            if f.file().is_flow() && print::flow::write_nullable_type_or_type_operator(ty, f) => {}
        TypeKind::Error => write!(f, FormatSuppressedNode(ty.span())),
        TypeKind::Heritage { expr, args } => {
            write!(
                f,
                [
                    expr,
                    print::type_parameters::type_arguments(args, Node::Type(ty))
                ]
            );
        }
        TypeKind::Keyword(_) | TypeKind::BoolLit(_) => write!(f, source_text(ty.span())),
        TypeKind::Ref { name, args } => ts_types::write_ts_type_reference(ty, name, args, f),
        TypeKind::StringLit(_) | TypeKind::NumberLit(_) | TypeKind::BigIntLit { .. } => {
            ts_types::write_ts_literal_type(ty, f);
        }
        TypeKind::Template(_) => print::template::write_ts_template_literal_type(ty, f),
        TypeKind::Array(element) if f.file().is_flow() => {
            print::flow::write_array_type(ty, element, f)
        }
        TypeKind::Array(element) => write!(f, [element, "[]"]),
        TypeKind::Tuple(elements) => print::tuple_type::write_ts_tuple_type(ty, elements, f),
        TypeKind::Union(types) => print::union_type::write_ts_union_type(ty, types, f),
        TypeKind::Intersection(types) => {
            print::intersection_type::write_ts_intersection_type(ty, types, f)
        }
        TypeKind::Fn(func) => print::function_type::write_ts_function_type(ty, func, f),
        TypeKind::Object(members) => ts_types::write_ts_type_literal(ty, members, f),
        TypeKind::Cond { .. } => ts_types::write_ts_conditional_type(ty, f),
        TypeKind::Infer(param) => write!(f, ["infer", space(), param]),
        TypeKind::Mapped(mapped) => print::mapped_type::write_ts_mapped_type(ty, mapped, f),
        TypeKind::IndexedAccess { obj, index } if f.file().is_flow() => {
            print::flow::write_indexed_access_type(ty, obj, index, f);
        }
        TypeKind::IndexedAccess { obj, index } => write!(f, [obj, "[", index, "]"]),
        TypeKind::Keyof(operand) => write!(f, ["keyof", space(), operand]),
        TypeKind::Readonly(operand) => write!(f, ["readonly", space(), operand]),
        // `unique /* comment */ symbol`
        TypeKind::UniqueSymbol => {
            let comments = f.comments().of_node(ty.as_ast_nodes()).dangling;
            write!(
                f,
                [
                    "unique",
                    space(),
                    FormatLeadingComments::Comments(comments),
                    "symbol"
                ]
            );
        }
        TypeKind::Unique(operand) => write!(f, ["unique", space(), operand]),
        TypeKind::Typeof { expr, args } => ts_types::write_ts_type_query(ty, expr, args, f),
        TypeKind::Import { .. } => ts_types::write_ts_import_type(ty, f),
        TypeKind::Predicate { .. } => ts_types::write_ts_type_predicate(ty, f),
    }
}

/// ESTree's `TSTypeAnnotation` around `ty`, which is written after `mark` and a space.
#[inline]
fn format_type_annotation<'a>(mark: Option<&'static str>, ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let write = |f: &mut Formatter<'a>| write!(f, [mark, mark.map(|_| space()), ty]);
    if f.is_quiet() {
        // These start with text, so the space is always printed.
        let starts_with_text = matches!(
            ty.tag(),
            TypeTag::Keyword
                | TypeTag::BoolLit
                | TypeTag::Ref
                | TypeTag::StringLit
                | TypeTag::NumberLit
                | TypeTag::Object
                | TypeTag::Tuple
        );
        return match (mark, starts_with_text) {
            (Some(":"), true) => write!(f, [": ", ty]),
            _ => write(f),
        };
    }
    if f.file().is_flow() && print::flow::is_directly_in_function_type(ty) {
        return write(f);
    }
    let node = AstNodes::TSTypeAnnotation(ty);
    if !f.comments().of_node(node).leading.is_empty()
        && !omits_space_before_type_annotation_comment(ty, f)
    {
        write!(f, space());
    }
    format_node(node, f, write);
}

/// `const a /* comment */ : T = 1` is `const a/* comment */ : T = 1` for oxfmt, and
/// `class A { b() /* comment */ : T {} }` has `b()/* comment */ : T {}`. This doesn't apply in
/// `function a(b /* comment */ : T) /* comment */ : T {}`, that is, after a parameter's name or pattern, or after the
/// parameters of a function declared with `function`.
fn omits_space_before_type_annotation_comment(ty: TypeNode<'_>, f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
        && match ty.parent() {
            // The `a` of `[a: string]: T` is a parameter in the tree.
            Node::Param(param) => {
                !matches!(param.as_ast_nodes(), AstNodes::FormalParameter(_))
                    || (param.func()).is_some_and(|func| func.kind() == FnKind::IndexSignature)
            }
            Node::Func(func) => !matches!(func.kind(), FnKind::Decl | FnKind::Expr),
            _ => true,
        }
}

macro_rules! type_annotations {
    ($($(#[$doc:meta])* $name:ident => $mark:expr,)*) => {
        $(
            $(#[$doc])*
            #[derive(Copy, Clone)]
            pub(crate) struct $name<'a>(pub(crate) TypeNode<'a>);

            impl<'a> Format<'a> for $name<'a> {
                fn fmt(&self, f: &mut Formatter<'a>) {
                    format_type_annotation($mark, self.0, f);
                }
            }

            impl Spanned for $name<'_> {
                fn span(&self) -> Span {
                    self.0.annotation_span()
                }
            }
        )*
    };
}

type_annotations! {
    /// `: T`
    FormatTypeAnnotation => Some(":"),
    /// `=> T`: the return type of a function type or a constructor type.
    FormatReturnTypeOfFunctionType => Some("=>"),
    /// The `T` of `a is T`.
    FormatTypeOfPredicate => None,
}

// ───────────────────────────── everything else ─────────────────────────────

macro_rules! format_with_comments {
    ($($handle:ident => $write:path,)*) => {
        $(impl<'a> Format<'a> for $handle<'a> {
            #[inline]
            fn fmt(&self, f: &mut Formatter<'a>) {
                let handle = *self;
                format_node(handle.as_ast_nodes(), f, |f| $write(handle, f));
            }
        })*
    };
}

impl<'a> Format<'a> for Member<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let member = *self;
        format_node(member.as_ast_nodes(), f, |f| {
            print::class::write_member(member, f)
        });
        if !f.context().comments_without_printer.is_empty() {
            write_comments_without_printer(member.span(), f);
        }
    }
}

format_with_comments! {
    Prop => print::expressions::write_property,
    VarDecl => print::variable_declaration::write_variable_declarator,
    Param => print::parameters::write_formal_parameter,
}

macro_rules! format_with_comments_in {
    ($($handle:ident, $node:expr => $write:path,)*) => {
        $(impl<'a> Format<'a> for $handle<'a> {
            #[inline]
            fn fmt(&self, f: &mut Formatter<'a>) {
                let handle = *self;
                format_node($node(handle), f, |f| $write(handle, f));
            }
        })*
    };
}

format_with_comments_in! {
    Case, AstNodes::SwitchCase => print::switch_statement::write_switch_case,
    EnumMember, AstNodes::TSEnumMember => print::ts_declarations::write_ts_enum_member,
    ImportSpec, AstNodes::ImportSpecifier => print::import_declaration::write_import_specifier,
    ExportSpec, AstNodes::ExportSpecifier => print::export_declarations::write_export_specifier,
    TypeParam, AstNodes::TSTypeParameter => print::type_parameters::write_ts_type_parameter,
    PatProp, AstNodes::BindingProperty => print::patterns::write_binding_property,
}

impl<'a> Format<'a> for Pat<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let pat = *self;
        format_node(pat.as_ast_nodes(), f, |f| {
            print::patterns::write_binding_pattern(pat, f)
        });
    }
}

/// An element of an array pattern: `a`, `a = 1`, `...a`. A hole writes nothing.
impl<'a> Format<'a> for PatElem<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        print::patterns::write_array_pattern_element(*self, f);
    }
}

impl<'a> Format<'a> for TupleElem<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let element = *self;
        // An element that's only a type is formatted as that type.
        if element.name().is_none() && !element.is_rest() && !element.is_optional() {
            return element.ty().fmt(f);
        }
        format_node(element.as_ast_nodes(), f, |f| {
            print::tuple_type::write_ts_tuple_element(element, f)
        });
    }
}
