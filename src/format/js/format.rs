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
use super::siblings::{following_span_start, following_span_start_in};
use super::utils::suppressed::FormatSuppressedNode;
use super::utils::typecast::format_type_cast_comment_node;
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
            let rest = self.source_text().slice_range(span.end, next);
            bun_core::strings::index_of_any(rest, b"\n\r").is_some()
        }
    }

    /// Calls `write`. If there is no comment in `span`, with [`Formatter::is_quiet`] set.
    #[inline]
    fn in_scope(&mut self, span: Span, write: impl FnOnce(&mut Formatter<'a>)) {
        let outer = self.context().is_quiet;
        self.context_mut().is_quiet = outer || self.has_no_comments_in(span);
        write(self);
        self.context_mut().is_quiet = outer;
    }
}

/// The comments after the child of `parent` at `span`.
fn write_trailing_comments_in<'a>(span: Span, parent: impl FnOnce() -> AstNodes<'a>, f: &mut Formatter<'a>) {
    if f.comments().next_start() == u32::MAX {
        return;
    }
    let parent = parent();
    let enclosing = parent.span();
    if f.comments().next_start() < enclosing.end {
        let following = following_span_start_in(span, parent);
        format_trailing_comments(enclosing, span, following).fmt(f);
    }
}

/// The comments after `node`.
pub(crate) fn write_trailing_comments_of<'a>(node: AstNodes<'a>, f: &mut Formatter<'a>) {
    write_trailing_comments_in(node.span(), || node.parent(), f);
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
    if f.is_quiet() {
        return write(f);
    }
    let is_suppressed = f.comments().is_suppressed(span.start);
    format_leading_comments(span).fmt(f);
    if is_suppressed {
        FormatSuppressedNode(span).fmt(f);
    } else {
        f.in_scope(span, write);
    }
    write_trailing_comments_in(span, parent, f);
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
    FormatSuppressedNode(span).fmt(f);
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
        format_node(self.span, || self.parent, f, |f| write!(f, source_text(self.span)));
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
        let (expr, span) = (self.expr, self.expr.span());
        let node = match is_chain_expression {
            true => AstNodes::ChainExpression(expr),
            false => expr.as_chain_element(),
        };

        // ESTree's `Expression`, as opposed to the `ChainElement` in a `ChainExpression`.
        if !self.is_in_chain_expression && f.comments().has_trailing_suppression_comment(span.end) {
            format_leading_comments(span).fmt(f);
            FormatSuppressedNode(span).fmt(f);
            return write_trailing_comments_of(node, f);
        }

        // The comments of a JSX element are written with its parentheses.
        if matches!(node, AstNodes::JSXElement(_) | AstNodes::JSXFragment(_)) {
            if !format_type_cast_comment_node(&self, false, f) {
                self.write_in_parentheses(false, f);
            }
            return;
        }

        let is_suppressed = f.comments().is_suppressed(span.start);
        let is_object_or_array = matches!(node, AstNodes::ObjectExpression(_) | AstNodes::ArrayExpression(_));
        let can_be_type_cast = !matches!(
            node,
            AstNodes::SpreadElement(_)
                | AstNodes::Elision(_)
                | AstNodes::PrivateIdentifier(_)
                | AstNodes::ArrayAssignmentTarget(_)
                | AstNodes::ObjectAssignmentTarget(_)
                | AstNodes::AssignmentTargetRest(_)
                | AstNodes::AssignmentTargetWithDefault(_)
                | AstNodes::JSXText(_)
                | AstNodes::JSXEmptyExpression(_)
                | AstNodes::JSXSpreadChild(_)
        );
        if !is_suppressed && can_be_type_cast && format_type_cast_comment_node(&self, is_object_or_array, f) {
            return;
        }
        format_leading_comments(span).fmt(f);
        if is_suppressed {
            let needs_parentheses = match is_chain_expression {
                true => parentheses::expression::chain_expression_needs_parentheses(expr, f),
                false => parentheses::expression::needs_parentheses(expr, f),
            };
            write!(
                f,
                [needs_parentheses.then_some("("), FormatSuppressedNode(span), needs_parentheses.then_some(")")]
            );
        } else {
            f.in_scope(span, |f| self.write_in_parentheses(is_chain_expression, f));
        }
        write_trailing_comments_of(node, f);
    }
}

impl<'a> Format<'a> for FormatExpr<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let is_chain_expression = !self.is_in_chain_expression && is_chain_root(self.expr);
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
        FormatExpr::with_options(*self, ExprOptions::None).fmt(f);
    }
}

/// Step 5 for an expression.
pub(crate) fn write_expression<'a>(e: Expr<'a>, options: ExprOptions, f: &mut Formatter<'a>) {
    use print::{expressions, literals};
    match e.kind() {
        ExprKind::Missing => {}
        ExprKind::Ident(_) | ExprKind::PrivateIdentifier(_) => write!(f, source_text(e.span())),
        ExprKind::This => write!(f, "this"),
        ExprKind::Super => write!(f, "super"),
        ExprKind::Null => write!(f, "null"),
        ExprKind::True => write!(f, "true"),
        ExprKind::False => write!(f, "false"),
        ExprKind::Number(_) => literals::write_numeric_literal(e, f),
        ExprKind::String(_) if e.is_jsx_text() => print::jsx::write_jsx_text(e, f),
        ExprKind::String(_) => literals::write_string_literal(e, f),
        ExprKind::BigInt(_) => literals::write_big_int_literal(e, f),
        ExprKind::Regex(regex) => literals::write_reg_exp_literal(e, regex, f),
        ExprKind::Template(template) => print::template::write_template_literal(e, template, f),
        ExprKind::TaggedTemplate(call) => print::template::write_tagged_template_expression(e, call, f),
        ExprKind::Array(elements) => match super::ast_nodes::is_assignment_target(e) {
            true => expressions::write_array_assignment_target(e, elements, f),
            false => print::array_expression::write_array_expression(e, elements, f),
        },
        ExprKind::Object(props) => match super::ast_nodes::is_assignment_target(e) {
            true => expressions::write_object_assignment_target(e, props, f),
            false => expressions::write_object_expression(e, props, f),
        },
        ExprKind::Fn(func) if func.is_arrow() => {
            let options = match options {
                ExprOptions::Arrow(options) => options,
                _ => Default::default(),
            };
            print::arrow_function_expression::write_arrow_function_expression(e, func, options, f);
        }
        ExprKind::Fn(func) => {
            let options = match options {
                ExprOptions::Function(options) => options,
                _ => Default::default(),
            };
            print::function::write_function(func, options, f);
        }
        ExprKind::Class(class) => print::class::write_class(class, f),
        ExprKind::Dot { .. } | ExprKind::Index { .. } => print::member_expression::write_member_expression(e, f),
        ExprKind::Call(call) => print::call_like_expression::write_call_expression(e, call, f),
        ExprKind::New(call) => print::call_like_expression::write_new_expression(e, call, f),
        ExprKind::Unary {
            op: op @ (UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec),
            operand,
        } => expressions::write_update_expression(op, operand, f),
        ExprKind::Unary { op, operand } => expressions::write_unary_expression(e, op, operand, f),
        ExprKind::Binary {
            op: BinOp::Comma, ..
        } => print::sequence_expression::write_sequence_expression(e, f),
        ExprKind::Binary {
            op: BinOp::In,
            left,
            right,
        } if matches!(left.kind(), ExprKind::PrivateIdentifier(_)) => {
            write!(f, [left, space(), "in", space(), right]);
        }
        ExprKind::Binary { .. } => print::binary_like_expression::write_binary_like_expression(e, f),
        ExprKind::Assign { .. } => expressions::write_assignment_expression(e, f),
        ExprKind::Cond { .. } => expressions::write_conditional_expression(e, f),
        ExprKind::Spread(_) if e.jsx_container_span().is_some() => print::jsx::write_jsx_spread_child(e, f),
        ExprKind::Spread(argument) => write!(f, ["...", argument]),
        ExprKind::Await(argument) => expressions::write_await_expression(e, argument, f),
        ExprKind::Yield { value, star } => expressions::write_yield_expression(value, star, f),
        ExprKind::As { .. } | ExprKind::AsConst(_) if e.is_angle_bracket_assertion() => {
            expressions::write_ts_type_assertion(e, f);
        }
        ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. } => {
            print::as_or_satisfies_expression::write_as_or_satisfies_expression(e, f);
        }
        ExprKind::NonNull(expression) => write!(f, [expression, "!"]),
        ExprKind::Instantiation { expr, type_args } => {
            write!(f, [expr, print::type_parameters::type_arguments(type_args, Node::Expr(e))]);
        }
        ExprKind::Jsx(jsx) => print::jsx::write_jsx_element(e, jsx, f),
        ExprKind::ImportCall { args } => print::call_like_expression::write_import_expression(e, args, f),
        ExprKind::ImportMeta | ExprKind::NewTarget => expressions::write_meta_property(e, f),
    }
}

// ───────────────────────────── statements ─────────────────────────────

impl<'a> Format<'a> for Stmt<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (statement, span) = (*self, self.span());
        if f.is_quiet() {
            return write_statement(statement, f);
        }
        if f.has_no_comments_in(Span::new(0, span.end)) {
            f.in_scope(span, |f| write_statement(statement, f));
            // The comments between the last statement and the end of a block trail that statement.
            return write_trailing_comments_in(span, || statement.ast_parent(), f);
        }
        format_statement_with_comments(statement, f);
    }
}

#[cold]
fn format_statement_with_comments<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let node = statement.as_ast_nodes();
    let span = node.span();
    if f.comments().has_trailing_suppression_comment(span.end) {
        format_leading_comments(span).fmt(f);
        FormatSuppressedNode(span).fmt(f);
        return write_trailing_comments_of(node, f);
    }
    match node {
        // Decorators can be written before `export`, and comments before and after them.
        AstNodes::ExportNamedDeclaration(_) | AstNodes::ExportDefaultDeclaration(_) => {
            format_node_without_comments(span, || node.parent(), f, |f| write_statement(statement, f));
        }
        _ => format_declaration_with_comments(statement, f),
    }
}

/// `statement` without its `export`, with the comments around it.
fn format_declaration_with_comments<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let span = statement.span_without_export();
    let parent = || match statement.is_exported() {
        true => statement.as_ast_nodes(),
        false => statement.ast_parent(),
    };
    format_node(span, parent, f, |f| write_declaration(statement, f));
}

/// `ExportNamedDeclaration.declaration`, `ExportDefaultDeclaration.declaration`: the statement
/// without its `export`.
#[derive(Copy, Clone)]
pub(crate) struct FormatDeclaration<'a>(pub(crate) Stmt<'a>);

impl<'a> Format<'a> for FormatDeclaration<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match f.is_quiet() {
            true => write_declaration(self.0, f),
            false => format_declaration_with_comments(self.0, f),
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
        statement.kind(),
        StmtKind::ExportNamed(_) | StmtKind::ExportDefault(_) | StmtKind::ExportStar { .. }
    );
    match is_declaration && statement.is_exported() {
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
        StmtKind::Expr(_) if statement.directive().is_some() => print::program::write_directive(statement, f),
        StmtKind::Expr(expression) => statements::write_expression_statement(statement, expression, f),
        StmtKind::Var(declarations) => {
            print::variable_declaration::write_variable_declaration(statement, declarations, f);
        }
        StmtKind::Fn(func) => print::function::write_function(func, Default::default(), f),
        StmtKind::Class(class) => print::class::write_class(class, f),
        StmtKind::Interface(interface) => ts_declarations::write_ts_interface_declaration(statement, interface, f),
        StmtKind::TypeAlias(alias) => ts_declarations::write_ts_type_alias_declaration(statement, alias, f),
        StmtKind::Enum(declaration) => ts_declarations::write_ts_enum_declaration(statement, declaration, f),
        StmtKind::Module(module) => ts_declarations::write_ts_module_declaration(statement, module, f),
        StmtKind::Return(argument) => {
            print::return_or_throw_statement::write_return_statement(statement, argument, f);
        }
        StmtKind::If { test, yes, no } => statements::write_if_statement(statement, test, yes, no, f),
        StmtKind::For {
            init,
            test,
            update,
            body,
        } => statements::write_for_statement(statement, init, test, update, body, f),
        StmtKind::ForIn { left, expr, body } => statements::write_for_in_statement(statement, left, expr, body, f),
        StmtKind::ForOf {
            left,
            expr,
            body,
            is_await,
        } => statements::write_for_of_statement(statement, left, expr, body, is_await, f),
        StmtKind::While { test, body } => statements::write_while_statement(statement, test, body, f),
        StmtKind::DoWhile { body, test } => statements::write_do_while_statement(statement, body, test, f),
        StmtKind::Block(body) => print::block_statement::write_block_statement(statement, body, f),
        StmtKind::With { object, body } => statements::write_with_statement(statement, object, body, f),
        StmtKind::Switch { expr, cases } => print::switch_statement::write_switch_statement(statement, expr, cases, f),
        StmtKind::Try {
            block,
            param,
            handler,
            finalizer,
        } => print::try_statement::write_try_statement(statement, block, param, handler, finalizer, f),
        StmtKind::Throw(argument) => print::return_or_throw_statement::write_throw_statement(statement, argument, f),
        StmtKind::Break(_) => statements::write_break_statement(statement, f),
        StmtKind::Continue(_) => statements::write_continue_statement(statement, f),
        StmtKind::Labeled { body, .. } => statements::write_labeled_statement(statement, body, f),
        StmtKind::Import(import) => print::import_declaration::write_import_declaration(statement, import, f),
        StmtKind::ImportEquals(import) => ts_declarations::write_ts_import_equals_declaration(statement, import, f),
        StmtKind::ExportNamed(export) => print::export_declarations::write_export_named_declaration(statement, export, f),
        StmtKind::ExportStar { .. } => print::export_declarations::write_export_all_declaration(statement, f),
        StmtKind::ExportDefault(expression) => {
            print::export_declarations::write_export_default_expression(statement, expression, f);
        }
        StmtKind::ExportAssign(expression) => ts_declarations::write_ts_export_assignment(expression, f),
        StmtKind::ExportAsNamespace(_) => ts_declarations::write_ts_namespace_export_declaration(statement, f),
    }
}

// ───────────────────────────── types ─────────────────────────────

impl<'a> Format<'a> for TypeNode<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        match f.is_quiet() {
            true => write_type_in_parentheses(*self, f),
            false => format_type_with_comments(*self, f),
        }
    }
}

#[inline]
fn write_type_in_parentheses<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let needs_parentheses = parentheses::ts_type::needs_parentheses(ty, f);
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
    let is_suppressed = f.comments().is_suppressed(span.start);
    // The comments before a union are written with its first `|`.
    if !matches!(ty.kind(), TypeKind::Union(_)) {
        format_leading_comments(span).fmt(f);
    }
    if is_suppressed {
        FormatSuppressedNode(span).fmt(f);
    } else {
        f.in_scope(span, |f| write_type_in_parentheses(ty, f));
    }
    write_trailing_comments_in(span, || ty.ast_parent(), f);
}

/// Step 5 for a type.
pub(crate) fn write_type<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    use print::ts_types;
    match ty.kind() {
        TypeKind::Error => write!(f, FormatSuppressedNode(ty.span())),
        TypeKind::Heritage { expr, args } => {
            write!(f, [expr, print::type_parameters::type_arguments(args, Node::Type(ty))]);
        }
        TypeKind::Keyword(_) | TypeKind::BoolLit(_) => write!(f, source_text(ty.span())),
        TypeKind::Ref { name, args } => ts_types::write_ts_type_reference(ty, name, args, f),
        TypeKind::StringLit(_) | TypeKind::NumberLit(_) | TypeKind::BigIntLit { .. } => {
            ts_types::write_ts_literal_type(ty, f);
        }
        TypeKind::Template(_) => print::template::write_ts_template_literal_type(ty, f),
        TypeKind::Array(element) => write!(f, [element, "[]"]),
        TypeKind::Tuple(elements) => print::tuple_type::write_ts_tuple_type(ty, elements, f),
        TypeKind::Union(types) => print::union_type::write_ts_union_type(ty, types, f),
        TypeKind::Intersection(types) => print::intersection_type::write_ts_intersection_type(ty, types, f),
        TypeKind::Fn(func) => print::function_type::write_ts_function_type(ty, func, f),
        TypeKind::Object(members) => ts_types::write_ts_type_literal(ty, members, f),
        TypeKind::Cond { .. } => ts_types::write_ts_conditional_type(ty, f),
        TypeKind::Infer(param) => write!(f, ["infer", space(), param]),
        TypeKind::Mapped(mapped) => print::mapped_type::write_ts_mapped_type(ty, mapped, f),
        TypeKind::IndexedAccess { obj, index } => write!(f, [obj, "[", index, "]"]),
        TypeKind::Keyof(operand) => write!(f, ["keyof", space(), operand]),
        TypeKind::Readonly(operand) => write!(f, ["readonly", space(), operand]),
        TypeKind::UniqueSymbol => write!(f, ["unique", space(), "symbol"]),
        TypeKind::Typeof { expr, args } => ts_types::write_ts_type_query(ty, expr, args, f),
        TypeKind::Import { .. } => ts_types::write_ts_import_type(ty, f),
        TypeKind::Predicate { .. } => ts_types::write_ts_type_predicate(ty, f),
    }
}

/// `: T`, ESTree's `TSTypeAnnotation`.
#[derive(Copy, Clone)]
pub(crate) struct FormatTypeAnnotation<'a>(pub(crate) TypeNode<'a>);

impl<'a> Format<'a> for FormatTypeAnnotation<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let ty = self.0;
        if f.is_quiet() {
            return print::ts_types::write_ts_type_annotation(ty, f);
        }
        let node = AstNodes::TSTypeAnnotation(ty);
        format_node(node.span(), || node.parent(), f, |f| print::ts_types::write_ts_type_annotation(ty, f));
    }
}

impl Spanned for FormatTypeAnnotation<'_> {
    fn span(&self) -> Span {
        self.0.annotation_span()
    }
}

// ───────────────────────────── everything else ─────────────────────────────

macro_rules! format_with_comments {
    ($($handle:ident => $write:path,)*) => {
        $(impl<'a> Format<'a> for $handle<'a> {
            #[inline]
            fn fmt(&self, f: &mut Formatter<'a>) {
                let it = *self;
                format_node(it.span(), || it.as_ast_nodes().parent(), f, |f| $write(it, f));
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

macro_rules! format_with_comments_in {
    ($($handle:ident, $node:expr => $write:path,)*) => {
        $(impl<'a> Format<'a> for $handle<'a> {
            #[inline]
            fn fmt(&self, f: &mut Formatter<'a>) {
                let it = *self;
                format_node(it.span(), || $node(it).parent(), f, |f| $write(it, f));
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
        format_node(pat.span(), || pat.ast_parent(), f, |f| print::patterns::write_binding_pattern(pat, f));
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

/// Where the next sibling of `expr` starts, or 0.
pub(crate) fn following_span_start_of_expr(expr: Expr<'_>) -> u32 {
    following_span_start(expr.as_ast_nodes())
}
