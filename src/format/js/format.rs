//! [`Format`] for the handles of `bun_lint::ast`.
//!
//! `write!(f, [expr])` does what is the same for every node, and then calls the function in
//! `print/` that writes this kind of node:
//! 1. If a `// prettier-ignore` comment leads or trails the node, its source text is written.
//! 2. `/** @type {T} */ (e)` keeps its parentheses.
//! 3. The comments before the node.
//! 4. `(`, if the node needs parentheses where it is: `parentheses/`.
//! 5. The node.
//! 6. `)`
//! 7. The comments after the node.
//!
//! Most nodes have no comment anywhere near them. [`Formatter::is_quiet`] says so, and then only
//! 4 to 6 are done. It is set for the time that a node is written which has no comment in it and
//! none behind it on the same line.

use super::ast_nodes::{AsAstNodes, AstNodes, ChainElement, is_chain_root};
use super::parentheses;
use super::print;
use super::siblings::following_span_start_in;
use super::utils::suppressed::FormatSuppressedNode;
use super::utils::typecast::write_type_casts;
use crate::prelude::*;
use crate::write;

impl<'a> Formatter<'a> {
    /// No comment is left to print in what is being formatted, or behind it on the same line.
    #[inline]
    pub(crate) fn is_quiet(&self) -> bool {
        self.context().is_quiet
    }

    /// Whether there is no comment to print in `span`, or behind it on the same line.
    fn has_no_comments_in(&self, span: Span) -> bool {
        let next = self.comments().next_start();
        if next < span.end || self.comments().has_type_cast_comments() {
            return false;
        }
        next == u32::MAX || {
            let rest = self.source_text().text_for(&Span::after(span, next));
            matches!(rest.first(), Some(b'\n' | b'\r'))
                || bun_core::strings::index_of_any(rest, b"\n\r").is_some()
        }
    }

    /// [`Formatter::in_scope`] for a `span` that is known to have no comments in it.
    #[inline]
    fn in_scope_without_comments(&mut self, span: Span, write: impl FnOnce(&mut Formatter<'a>)) {
        if self.context().cursor.is_active() {
            return self.in_scope_with_cursor(span, write);
        }
        let outer = std::mem::replace(&mut self.context_mut().is_quiet, true);
        write(self);
        self.context_mut().is_quiet = outer;
    }

    /// Calls `write`. If there is no comment in `span`, with [`Formatter::is_quiet`] set.
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
        // What the region is in, and the nodes before and after it, are not quiet, so that this is called for them.
        self.context_mut().is_quiet =
            outer || (!cursor.overlaps(span) && self.has_no_comments_in(span));
        cursor.enter(span, self);
        write(self);
        cursor.exit(span, self);
        self.context_mut().is_quiet = outer;
    }

    /// Calls `write`, which writes the node at `span` and is not called [in a scope](Formatter::in_scope).
    #[inline]
    fn around_cursor(&mut self, span: Span, write: impl FnOnce(&mut Formatter<'a>)) {
        let cursor = self.context().cursor;
        if !cursor.is_active() {
            return write(self);
        }
        cursor.enter(span, self);
        write(self);
        cursor.exit(span, self);
    }
}

/// The span of `node`. For a statement that ends with a `;`, without it: see
/// [`Comments::without_semicolon`].
fn span_for_comments<'a>(node: AstNodes<'a>, f: &Formatter<'a>) -> Span {
    let span = node.span();
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
        | AstNodes::MethodDefinition(_) => f.comments().without_semicolon(span),
        // These end where their last body ends. An empty statement is its `;`.
        AstNodes::IfStatement(statement)
        | AstNodes::ForStatement(statement)
        | AstNodes::ForInStatement(statement)
        | AstNodes::ForOfStatement(statement)
        | AstNodes::WhileStatement(statement)
        | AstNodes::WithStatement(statement)
        | AstNodes::LabeledStatement(statement)
            if ends_before_semicolon(statement) =>
        {
            f.comments().without_semicolon(span)
        }
        // What is exported ends where the `export` around it ends.
        AstNodes::TSTypeAliasDeclaration(statement)
        | AstNodes::TSImportEqualsDeclaration(statement)
            if statement.is_exported() =>
        {
            f.comments().without_semicolon(span)
        }
        AstNodes::Function(func)
            if !func.has_body()
                && matches!(func.owner(), Node::Stmt(statement) if statement.is_exported()) =>
        {
            f.comments().without_semicolon(span)
        }
        _ => span,
    }
}

/// Whether Prettier's `locEnd` of `statement` is before the `;` at its end.
fn ends_before_semicolon(mut statement: Stmt<'_>) -> bool {
    loop {
        statement = match statement.kind() {
            StmtKind::If { yes, no, .. } => no.unwrap_or(yes),
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::With { body, .. }
            | StmtKind::Labeled { body, .. } => body,
            StmtKind::Expr(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::Return(_)
            | StmtKind::Throw(_)
            | StmtKind::DoWhile { .. }
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Debugger
            | StmtKind::Var(_) => return true,
            _ => return false,
        };
    }
}

/// The comments after the child of `parent` at `span`.
fn write_trailing_comments_in<'a>(
    span: Span,
    parent: impl FnOnce() -> AstNodes<'a>,
    f: &mut Formatter<'a>,
) {
    if f.comments().next_start() != u32::MAX {
        write_trailing_comments_of_child(span, parent(), f);
    }
}

fn write_trailing_comments_of_child<'a>(span: Span, parent: AstNodes<'a>, f: &mut Formatter<'a>) {
    let enclosing = span_for_comments(parent, f);
    if f.comments().next_start() < enclosing.end {
        let following = following_span_start_in(span, parent, f.options().flavor);
        format_trailing_comments(enclosing, span, following).fmt(f);
    }
}

/// Whether no comment trails a node that is followed by another one in the same list, because there
/// is none, or the next one starts its line: then it leads what follows. This takes no look at what
/// the node is in.
#[inline]
pub(crate) fn no_comment_trails_what_is_before_another(f: &Formatter<'_>) -> bool {
    f.comments()
        .unprinted_comments()
        .first()
        .is_none_or(|it| it.preceded_by_newline())
}

/// The comments after `node`.
pub(crate) fn write_trailing_comments_of<'a>(node: AstNodes<'a>, f: &mut Formatter<'a>) {
    if f.comments().next_start() != u32::MAX {
        write_trailing_comments_in(span_for_comments(node, f), || node.parent(), f);
    }
}

/// Writes a node that never needs parentheses, with the comments around it.
///
/// `span`: of the node. `parent`: what it is in, which is only asked for if there are comments.
#[inline]
pub(crate) fn format_node<'a>(
    span: Span,
    parent: impl FnOnce() -> AstNodes<'a>,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    format_node_in_list(span, false, parent, f, write);
}

/// [`format_node`]. `is_before_another`: another node follows it in the same list.
#[inline]
fn format_node_in_list<'a>(
    span: Span,
    is_before_another: bool,
    parent: impl FnOnce() -> AstNodes<'a>,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    if f.is_quiet() {
        return write(f);
    }
    let is_suppressed = f.comments().is_suppressed(span.start)
        || f.comments().has_trailing_suppression_comment(span.end);
    format_leading_comments(span).fmt(f);
    if is_suppressed {
        f.around_cursor(span, |f| FormatSuppressedNode(span).fmt(f));
    } else {
        f.in_scope(span, write);
    }
    if !(is_before_another && no_comment_trails_what_is_before_another(f)) {
        write_trailing_comments_in(span, parent, f);
    }
}

/// Writes a node whose comments are written by the code that writes the node itself, or its
/// parent. Only `prettier-ignore` is dealt with.
#[inline]
pub(crate) fn format_node_without_comments<'a>(
    span: Span,
    parent: impl FnOnce() -> AstNodes<'a>,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    if f.is_quiet() || !f.comments().is_suppressed(span.start) {
        return write(f);
    }
    format_leading_comments(span).fmt(f);
    f.around_cursor(span, |f| FormatSuppressedNode(span).fmt(f));
    write_trailing_comments_in(span, parent, f);
}

// ───────────────────────────── names ─────────────────────────────

/// A name that is not a node here and is one in ESTree, with the comments around it: the `b` of
/// `a.b`, the name of a function, a label.
#[derive(Copy, Clone)]
pub(crate) struct FormatIdentifier<'a> {
    span: Span,
    parent: AstNodes<'a>,
}

/// `ident` as it is written. `parent`: the node that it is a name in.
#[inline]
pub(crate) fn identifier<'a>(ident: Ident<'a>, parent: AstNodes<'a>) -> FormatIdentifier<'a> {
    FormatIdentifier {
        span: ident.span(),
        parent,
    }
}

impl<'a> Format<'a> for FormatIdentifier<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        format_node(
            self.span,
            || self.parent,
            f,
            |f| write!(f, source_text(self.span)),
        );
    }
}

impl Spanned for FormatIdentifier<'_> {
    fn span(&self) -> Span {
        self.span
    }
}

// ───────────────────────────── expressions ─────────────────────────────

/// How a function or an arrow function is written where it is. See `print/function.rs` and
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
    /// The `ChainExpression` has been dealt with.
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

    /// `ChainExpression.expression`: `expr` is the whole of an optional chain, and this is the
    /// member access or the call that it is.
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
            true => print::expressions::write_chain_expression(self.expr, f),
            false => write_expression(self.expr, self.options, f),
        }
        if needs_parentheses {
            ")".fmt(f);
        }
    }

    #[cold]
    fn fmt_with_comments(self, is_chain_expression: bool, f: &mut Formatter<'a>) {
        let node = match is_chain_expression {
            true => AstNodes::ChainExpression(self.expr),
            false => self.expr.as_chain_element(),
        };
        let write_target =
            |f: &mut Formatter<'a>| self.fmt_in_type_casts(node, is_chain_expression, f);
        if self.is_in_chain_expression || !write_type_casts(self.expr, node, f, &write_target) {
            write_target(f);
        }
    }

    /// The expression with its comments, in the parentheses of type casts if there are any.
    fn fmt_in_type_casts(
        self,
        node: AstNodes<'a>,
        is_chain_expression: bool,
        f: &mut Formatter<'a>,
    ) {
        let (expr, span) = (self.expr, self.expr.span());

        // ESTree's `Expression`, as opposed to the `ChainElement` in a `ChainExpression`.
        if !self.is_in_chain_expression
            && f.comments().has_trailing_suppression_comment(span.end)
            // The comment trails `a && b` of `a && b // prettier-ignore ⏎ && c`, which Prettier writes
            // without looking at its comments.
            && !matches!(node.parent(), AstNodes::LogicalExpression(it) | AstNodes::BinaryExpression(it) if it.span().end == span.end)
        {
            format_leading_comments(span).fmt(f);
            write_suppressed_expression(expr, is_chain_expression, f);
            return write_trailing_comments_of(node, f);
        }

        // The comments of a JSX element are written with its parentheses.
        if matches!(node, AstNodes::JSXElement(_) | AstNodes::JSXFragment(_)) {
            return f.around_cursor(span, |f| self.write_in_parentheses(false, f));
        }

        let is_suppressed = f.comments().is_suppressed(span.start);
        if print::function::write_called_function_with_comments(expr, self.options, f) {
            return;
        }
        // Prettier's `canAttachComment`: typescript-estree's `ChainExpression` has no comments. They are
        // those of what is in it, which is in its parentheses.
        if is_chain_expression
            && !is_suppressed
            && !f.file().is_javascript()
            && parentheses::expression::chain_expression_needs_parentheses(expr, f)
        {
            write!(f, ["(", format_leading_comments(span)]);
            f.in_scope(span, |f| {
                print::expressions::write_chain_expression(expr, f)
            });
            write_trailing_comments_of(node, f);
            return write!(f, ")");
        }
        // `a ? b : /** @type {T} */ (c).d ?? e`
        if !is_suppressed
            && cast_comment_goes_into_added_parentheses(f)
            && f.source_text().byte_at(span.start) == Some(b'(')
            && f.comments().is_cast_parenthesis(span.start)
            && let [others @ .., cast_comment] = f.comments().comments_before(span.start)
            && match is_chain_expression {
                true => parentheses::expression::chain_expression_needs_parentheses(expr, f),
                false => parentheses::expression::needs_parentheses(expr, f),
            }
        {
            let cast_comment = FormatLeadingComments::Comments(std::slice::from_ref(cast_comment));
            write!(
                f,
                [FormatLeadingComments::Comments(others), "(", cast_comment]
            );
            f.in_scope(span, |f| match is_chain_expression {
                true => print::expressions::write_chain_expression(expr, f),
                false => write_expression(expr, self.options, f),
            });
            write!(f, ")");
            return write_trailing_comments_of(node, f);
        }
        format_leading_comments(span).fmt(f);
        if is_suppressed {
            write_suppressed_expression(expr, is_chain_expression, f);
        } else {
            f.in_scope(span, |f| self.write_in_parentheses(is_chain_expression, f));
        }
        write_trailing_comments_of(node, f);
    }
}

/// A type cast comment is about the parentheses right behind it. Where these are at the start of
/// something that gets parentheses of its own, oxfmt writes the comment in them, so that it is still
/// about the same. Prettier writes it before them.
fn cast_comment_goes_into_added_parentheses(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `printIgnored` for an expression, in the parentheses that it needs.
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
    // A class expression with decorators is on lines of its own.
    let is_decorated_class =
        matches!(expr.kind(), ExprKind::Class(class) if class.decorators().next().is_some());
    f.around_cursor(span, |f| {
        write!(f, needs_parentheses.then_some("("));
        match is_decorated_class {
            true => write!(f, soft_block_indent(&FormatSuppressedNode(span))),
            false => write!(f, FormatSuppressedNode(span)),
        }
        write!(f, needs_parentheses.then_some(")"));
    });
}

impl<'a> Format<'a> for FormatExpr<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        if !f.context_mut().has_stack_left() {
            return;
        }
        let is_chain_expression = !self.is_in_chain_expression
            && matches!(
                self.expr.tag(),
                ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull
            )
            && is_chain_root(self.expr);
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

/// What [`FormatExpr`] does without options, with a short way for what nearly every expression is:
/// without comments, without parentheses and not the whole of an optional chain.
fn format_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    if !f.is_quiet() {
        return format_expression_in_general(e, f);
    }
    let tag = e.tag();
    // Nearly half of all expressions are names. The names that can need parentheses have 3 to 9
    // letters, and are longer only if they are written with escapes, or stand for an expression in a template.
    if tag == ExprTag::Ident {
        let span = e.span();
        let may_need_parentheses =
            span.len() >= 3 && (span.len() <= 9 || span.len() >= 35 || !f.is_plain_source(span));
        return match may_need_parentheses && parentheses::expression::needs_parentheses(e, f) {
            true => format_expression_in_general(e, f),
            false => write!(f, source_text(span)),
        };
    }
    if !f.context_mut().has_stack_left() {
        return;
    }
    let is_chain_expression = matches!(
        tag,
        ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull
    ) && is_chain_root(e);
    match is_chain_expression || parentheses::expression::needs_parentheses(e, f) {
        true => format_expression_in_general(e, f),
        false => write_expression_of(tag, e, ExprOptions::None, f),
    }
}

#[inline(never)]
fn format_expression_in_general<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    FormatExpr::with_options(e, ExprOptions::None).fmt(f);
}

/// Every `!` of `x!!`, which is one expression, with the comments between them.
pub(crate) struct FormatNonNullMarks<'a>(pub(crate) Expr<'a>);

impl<'a> Format<'a> for FormatNonNullMarks<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let mut inner = self.0.inner_non_null_spans().peekable();
        while inner.next().is_some() {
            let next_mark = inner
                .peek()
                .map_or_else(|| self.0.span().end, |next| next.end)
                .saturating_sub(1);
            write!(
                f,
                [
                    "!",
                    FormatTrailingComments::Comments(f.comments().comments_before(next_mark))
                ]
            );
        }
        write!(f, "!");
    }
}

/// Step 5 for an expression.
///
/// This only finds out where to go on. Each of the functions it goes on in has a frame of its own
/// size, and none is set up for what is written right here.
pub(crate) fn write_expression<'a>(e: Expr<'a>, options: ExprOptions, f: &mut Formatter<'a>) {
    write_expression_of(e.tag(), e, options, f);
}

/// `tag`: that of `e`.
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
    match super::ast_nodes::is_assignment_target(e) {
        true => print::expressions::write_object_assignment_target(e, props, f),
        false => print::expressions::write_object_expression(e, props, f),
    }
}

#[inline(never)]
fn write_array<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let ExprKind::Array(elements) = e.kind() else {
        return;
    };
    match super::ast_nodes::is_assignment_target(e) {
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
        false => print::expressions::write_unary_expression(e, op, operand, f),
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

/// The kinds that [`write_expression`] does not deal with.
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
        format_statement(*self, false, f);
    }
}

/// A statement that is followed by another one, which can be empty, in the same list.
#[derive(Copy, Clone)]
pub(crate) struct FormatStatementBeforeAnother<'a>(pub(crate) Stmt<'a>);

impl<'a> Format<'a> for FormatStatementBeforeAnother<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        format_statement(self.0, true, f);
    }
}

fn format_statement<'a>(statement: Stmt<'a>, is_before_another: bool, f: &mut Formatter<'a>) {
    if !f.context_mut().has_stack_left() {
        return;
    }
    if f.is_quiet() {
        return write_statement(statement, f);
    }
    let span = statement.span();
    if f.has_no_comments_in(Span::new(0, span.end)) {
        // `// prettier-ignore` on a line of its own after the last statement.
        if !is_before_another && f.comments().has_trailing_suppression_comment(span.end) {
            return format_statement_with_comments(statement, is_before_another, f);
        }
        f.in_scope_without_comments(span, |f| write_statement(statement, f));
        if is_before_another && no_comment_trails_what_is_before_another(f) {
            return;
        }
        // What the statement is in ends here, and the next comment is behind that.
        if f.source_text().next_non_whitespace_byte_is(span.end, b'}') {
            return;
        }
        // The comments between the last statement and the end of a block trail that statement.
        return write_trailing_comments_in(span, || statement.ast_parent(), f);
    }
    format_statement_with_comments(statement, is_before_another, f);
}

#[cold]
fn format_statement_with_comments<'a>(
    statement: Stmt<'a>,
    is_before_another: bool,
    f: &mut Formatter<'a>,
) {
    let node = statement.as_ast_nodes();
    let mut span = span_for_comments(node, f);
    // Prettier's `locStart`: the decorators of a class can be before its `export`.
    span.start = span.start.min(statement.span().start);
    // The `;` can be behind the comment: `a() // prettier-ignore ⏎ ;`
    if f.comments()
        .has_trailing_suppression_comment(node.span().end)
        || (span.end < node.span().end && f.comments().has_trailing_suppression_comment(span.end))
    {
        format_leading_comments(span).fmt(f);
        write_ignored_statement(statement, span, f);
        return write_trailing_comments_of(node, f);
    }
    match node {
        // Decorators can be written before `export`, and comments before and after them.
        AstNodes::ExportNamedDeclaration(_) | AstNodes::ExportDefaultDeclaration(_) => {
            if f.comments().is_suppressed(span.start) {
                format_leading_comments(span).fmt(f);
                write_ignored_statement(statement, span, f);
                return write_trailing_comments_in(span, || node.parent(), f);
            }
            format_node_without_comments(
                span,
                || node.parent(),
                f,
                |f| write_statement(statement, f),
            );
        }
        _ => format_declaration_with_comments(statement, is_before_another, f),
    }
}

/// `statement` without its `export`, with the comments around it. `is_before_another`: it has no
/// `export`, and another statement follows it in the same list.
fn format_declaration_with_comments<'a>(
    statement: Stmt<'a>,
    is_before_another: bool,
    f: &mut Formatter<'a>,
) {
    let is_exported = statement.is_exported();
    let span = match is_exported {
        true => f
            .comments()
            .without_semicolon(statement.span_without_export()),
        false => span_for_comments(statement.as_ast_nodes(), f),
    };
    let parent = || match is_exported {
        true => statement.as_ast_nodes(),
        false => statement.ast_parent(),
    };
    if f.comments().is_suppressed(span.start) {
        format_leading_comments(span).fmt(f);
        write_ignored_statement(statement, span, f);
        return write_trailing_comments_in(span, parent, f);
    }
    format_node_in_list(span, is_before_another, parent, f, |f| {
        let Some(hidden_from) = print::semicolon::start_of_comments_behind_semicolon(statement, f)
        else {
            return write_declaration(statement, f);
        };
        let previous = f.comments_mut().hide_comments_from(hidden_from);
        write_declaration(statement, f);
        f.comments_mut().restore_hidden_comments(previous);
        FormatTrailingComments::Comments(f.comments().comments_before(span.end)).fmt(f);
    });
}

/// Prettier's `printIgnored` for a statement. `span`: of the statement, without its `;`, which is
/// written as the options say.
fn write_ignored_statement<'a>(statement: Stmt<'a>, span: Span, f: &mut Formatter<'a>) {
    if terminator_of_what_is_ignored_follows_semi(f) {
        return write_ignored_statement_without_terminator(statement, span, f);
    }
    let has_semicolon = match statement.kind() {
        // `export var a` is an `ExportNamedDeclaration`.
        StmtKind::Var(_)
            if statement.is_exported() && span.start < statement.span_without_export().start =>
        {
            span.end < statement.span().end
        }
        StmtKind::Break(_) | StmtKind::Continue(_) | StmtKind::Debugger | StmtKind::Var(_) => true,
        _ => span.end < statement.span().end,
    };
    if f.options().semicolons.is_always() {
        return f.around_cursor(span, |f| {
            write!(
                f,
                [FormatSuppressedNode(span), has_semicolon.then_some(";")]
            )
        });
    }
    let needs_leading_semicolon = matches!(
        statement.kind(),
        StmtKind::Expr(expression) if print::statements::expression_statement_needs_semicolon(statement, expression, f)
    );
    f.around_cursor(span, |f| {
        write!(
            f,
            [
                needs_leading_semicolon.then_some(";"),
                FormatSuppressedNode(span)
            ]
        )
    });
}

/// For oxfmt the `;` at the end of a statement or a member of a class is not part of what a
/// `prettier-ignore` comment protects: it is written, or not, as for any other. Prettier only adds
/// one to a statement that has one, and writes members, type aliases and functions without a body
/// as they are.
pub(crate) fn terminator_of_what_is_ignored_follows_semi(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// See [`terminator_of_what_is_ignored_follows_semi`]. `span`: as for [`write_ignored_statement`].
fn write_ignored_statement_without_terminator<'a>(
    statement: Stmt<'a>,
    span: Span,
    f: &mut Formatter<'a>,
) {
    let content = match ends_with_terminator(statement) {
        true => f
            .comments()
            .without_semicolon(Span::new(span.start, statement.span().end)),
        false => span,
    };
    if f.options().semicolons.is_always() {
        let terminator = ends_with_terminator(statement).then_some(";");
        return f.around_cursor(content, |f| {
            write!(f, [FormatSuppressedNode(content), terminator])
        });
    }
    // The text can start with a parenthesis that would not be written.
    let needs_leading_semicolon = matches!(
        statement.kind(),
        StmtKind::Expr(expression) if f.source_text().byte_at(content.start) == Some(b'(')
            || print::statements::expression_statement_needs_semicolon(statement, expression, f)
    );
    f.around_cursor(content, |f| {
        write!(
            f,
            [
                needs_leading_semicolon.then_some(";"),
                FormatSuppressedNode(content)
            ]
        )
    });
}

/// Whether `statement` is written with a `;` at its end, if semicolons are.
fn ends_with_terminator(statement: Stmt<'_>) -> bool {
    // The `;` after the declaration in the head of a loop separates.
    let is_in_head = |body: Stmt<'_>| statement.span().end <= body.span().start;
    if let Node::Stmt(parent) = statement.parent()
        && let StmtKind::For { body, .. }
        | StmtKind::ForIn { body, .. }
        | StmtKind::ForOf { body, .. } = parent.kind()
        && is_in_head(body)
    {
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
        match f.is_quiet() {
            true => write_declaration(self.0, f),
            false => format_declaration_with_comments(self.0, false, f),
        }
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
    // No other kind of type ever needs parentheses. Flow's `renders T` writes its own.
    let needs_parentheses = matches!(
        tag,
        TypeTag::Fn
            | TypeTag::Infer
            | TypeTag::Union
            | TypeTag::Intersection
            | TypeTag::Cond
            | TypeTag::Keyof
            | TypeTag::Readonly
            | TypeTag::UniqueSymbol
            | TypeTag::Unique
            | TypeTag::Typeof
            | TypeTag::Import
    ) && !(tag == TypeTag::Unique && f.file().is_flow())
        && parentheses::ts_type::needs_parentheses(ty, f);
    if needs_parentheses {
        "(".fmt(f);
    }
    write_type(ty, f);
    if needs_parentheses {
        ")".fmt(f);
    }
}

#[cold]
fn format_type_with_comments<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let span = ty.span();
    // A union writes the comments before it with its first `|`, and deals with `prettier-ignore`.
    let is_union = matches!(ty.kind(), TypeKind::Union(_));
    let is_suppressed =
        match is_union && !print::union_type::prettier_ignore_before_union_is_about_all_of_it(f) {
            // On a line of its own it is about the first type only.
            true => f
                .comments()
                .comments_before_iter(span.start)
                .any(|comment| {
                    f.comments().is_suppression_comment(comment) && !comment.preceded_by_newline()
                }),
            false => f.comments().is_suppressed(span.start),
        };
    if !is_union || is_suppressed {
        format_leading_comments(span).fmt(f);
    } else if comments_stay_outside_of_parentheses_of_union(f)
        && parentheses::ts_type::needs_parentheses(ty, f)
    {
        // Those before a `(` of the source, and after them those that start their line.
        let leading = f.comments().comments_before(span.start);
        let is_before_parenthesis = |(index, comment): (usize, &Comment)| {
            let end = leading
                .get(index + 1)
                .map_or(span.start, |next| next.span.start);
            f.source_text()
                .contains_byte(Span::after(comment.span, end), b'(')
        };
        let mut count = leading
            .iter()
            .enumerate()
            .rposition(is_before_parenthesis)
            .map_or(0, |last| last + 1);
        count += leading[count..]
            .iter()
            .take_while(|comment| comment.preceded_by_newline())
            .count();
        FormatLeadingComments::Comments(&leading[..count]).fmt(f);
    }
    if is_suppressed {
        let needs_parentheses = parentheses::ts_type::needs_parentheses(ty, f);
        f.around_cursor(span, |f| {
            write!(
                f,
                [
                    needs_parentheses.then_some("("),
                    FormatSuppressedNode(span),
                    needs_parentheses.then_some(")")
                ]
            );
        });
    } else {
        f.in_scope(span, |f| write_type_in_parentheses(ty, f));
    }
    write_trailing_comments_in(span, || ty.ast_parent(), f);
}

/// `keyof /* comment */ (A | B)`: for oxfmt the comment stays on the side of the `(` that it is on.
/// Prettier writes the comments of a union in its parentheses.
fn comments_stay_outside_of_parentheses_of_union(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Step 5 for a type.
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
        TypeKind::UniqueSymbol => write!(f, ["unique", space(), "symbol"]),
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
        // These start with text, so that the space is written in any case.
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
    // Flow has no node that starts at the `=>`: the comments before it lead the type.
    if mark == Some("=>") && f.file().is_flow() {
        return write(f);
    }
    let node = AstNodes::TSTypeAnnotation(ty);
    if f.comments().has_comment_before(node.span().start)
        && !(comment_sticks_to_name_of_variable(f)
            && matches!(node.parent(), AstNodes::VariableDeclarator(_)))
    {
        write!(f, space());
    }
    format_node(node.span(), || node.parent(), f, write);
}

/// `const a /* comment */ : T = 1` is `const a/* comment */ : T = 1` for oxfmt.
fn comment_sticks_to_name_of_variable(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
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
                let it = *self;
                match f.is_quiet() {
                    true => $write(it, f),
                    false => format_node(it.span(), || it.as_ast_nodes().parent(), f, |f| $write(it, f)),
                }
            }
        })*
    };
}

format_with_comments! {
    Member => print::class::write_member,
    Prop => print::expressions::write_property,
    VarDecl => print::variable_declaration::write_variable_declarator,
    Param => print::parameters::write_formal_parameter,
}

/// A member that is followed by another one.
#[derive(Copy, Clone)]
pub(crate) struct FormatMemberBeforeAnother<'a>(pub(crate) Member<'a>);

impl<'a> Format<'a> for FormatMemberBeforeAnother<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let it = self.0;
        match f.is_quiet() {
            true => print::class::write_member(it, f),
            false => format_node_in_list(
                it.span(),
                true,
                || it.as_ast_nodes().parent(),
                f,
                |f| print::class::write_member(it, f),
            ),
        }
    }
}

macro_rules! format_with_comments_in {
    ($($handle:ident, $node:expr => $write:path,)*) => {
        $(impl<'a> Format<'a> for $handle<'a> {
            #[inline]
            fn fmt(&self, f: &mut Formatter<'a>) {
                let it = *self;
                match f.is_quiet() {
                    true => $write(it, f),
                    false => format_node(it.span(), || $node(it).parent(), f, |f| $write(it, f)),
                }
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
        match f.is_quiet() {
            true => print::patterns::write_binding_pattern(pat, f),
            false => format_node(
                pat.span(),
                || pat.ast_parent(),
                f,
                |f| print::patterns::write_binding_pattern(pat, f),
            ),
        }
    }
}

/// An element of an array pattern: `a`, `a = 1`, `...a`. A hole writes nothing.
impl<'a> Format<'a> for PatElem<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        print::patterns::write_array_pattern_element(*self, f);
    }
}

/// An element of a tuple type.
impl<'a> Format<'a> for TupleElem<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let element = *self;
        // One that is only a type is that type.
        if element.name().is_none() && !element.is_rest() && !element.is_optional() {
            return element.ty().fmt(f);
        }
        format_node(
            element.span(),
            || super::ast_nodes::node_as_ast_nodes(element.parent()),
            f,
            |f| print::tuple_type::write_ts_tuple_element(element, f),
        );
    }
}
