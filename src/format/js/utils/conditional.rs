//! `a ? b : c` and `A extends B ? C : D`. Prettier's `printTernary`.

use super::expression::ExpressionLeftSide;
use super::typecast::{is_cast_target, is_cast_target_that_hides_its_kind};
use crate::js::format::format_node;
use crate::js::parentheses::expression::expression_needs_parentheses;
use crate::js::print::binary_like_expression::is_angular_pipe;
use crate::prelude::*;
use crate::write;
use smallvec::SmallVec;

#[derive(Copy, Clone)]
pub(crate) enum ConditionalLike<'a> {
    ConditionalExpression(Expr<'a>),
    TSConditionalType(TypeNode<'a>),
}

/// An operand of either kind of conditional.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Operand<'a> {
    Expr(Expr<'a>),
    Type(TypeNode<'a>),
}

impl Spanned for Operand<'_> {
    fn span(&self) -> Span {
        match self {
            Operand::Expr(e) => e.span(),
            Operand::Type(ty) => ty.span(),
        }
    }
}

impl<'a> Format<'a> for Operand<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self {
            Operand::Expr(e) => e.fmt(f),
            Operand::Type(ty) => ty.fmt(f),
        }
    }
}

impl Operand<'_> {
    pub(super) fn is_conditional(self) -> bool {
        match self {
            Operand::Expr(e) => matches!(e.kind(), ExprKind::Cond { .. }),
            Operand::Type(ty) => matches!(ty.kind(), TypeKind::Cond { .. }),
        }
    }
}

impl<'a> ConditionalLike<'a> {
    fn parent(&self) -> AstNodes<'a> {
        match self {
            ConditionalLike::ConditionalExpression(e) => e.ast_parent(),
            ConditionalLike::TSConditionalType(ty) => ty.ast_parent(),
        }
    }

    /// The operands after the `?` and after the `:`.
    fn consequent_and_alternate(&self) -> Option<(Operand<'a>, Operand<'a>)> {
        match self {
            ConditionalLike::ConditionalExpression(e) => match e.kind() {
                ExprKind::Cond { yes, no, .. } => Some((Operand::Expr(yes), Operand::Expr(no))),
                _ => None,
            },
            ConditionalLike::TSConditionalType(ty) => match ty.kind() {
                TypeKind::Cond { yes, no, .. } => Some((Operand::Type(yes), Operand::Type(no))),
                _ => None,
            },
        }
    }
}

/// Prettier's `shouldExtraIndentForConditionalExpression`: true if `conditional` is the head of a chain of member
/// accesses and calls, and that chain is the whole value that's returned, assigned, etc.:
///
/// ```javascript
/// return (
///   a
///     ? b
///     : c
/// ).member;
/// ```
pub(super) fn should_extra_indent<'a>(conditional: Expr<'a>) -> bool {
    let mut expression = conditional;
    let mut parent = conditional.ast_parent();
    loop {
        let is = |head: Option<Expr<'a>>| head == Some(expression);
        match parent {
            AstNodes::ChainExpression(_) => {}
            AstNodes::StaticMemberExpression(e)
            | AstNodes::PrivateFieldExpression(e)
            | AstNodes::ComputedMemberExpression(e)
                if is(e.object()) =>
            {
                expression = e;
            }
            AstNodes::CallExpression(e) if is(e.callee()) => expression = e,
            AstNodes::TSNonNullExpression(e) => expression = e,
            // The chain ends here.
            AstNodes::NewExpression(e) if is(e.callee()) => {
                expression = e;
                parent = parent.parent();
                break;
            }
            AstNodes::TSAsExpression(e) | AstNodes::TSSatisfiesExpression(e) => {
                expression = e;
                parent = parent.parent();
                break;
            }
            _ => break,
        }
        parent = parent.parent();
    }
    if expression == conditional {
        return false;
    }

    match parent {
        AstNodes::VariableDeclarator(declarator) => declarator.init() == Some(expression),
        AstNodes::ReturnStatement(_) | AstNodes::ThrowStatement(_) => true,
        AstNodes::UnaryExpression(e)
        | AstNodes::YieldExpression(e)
        | AstNodes::AwaitExpression(e) => e.argument() == Some(expression),
        AstNodes::AssignmentExpression(assignment) => assignment.right() == Some(expression),
        _ => false,
    }
}

/// Where a conditional sits inside another one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConditionalLayout {
    /// It isn't inside another conditional.
    Root {
        /// One of its operands, or of the conditionals inside it, is a JSX element.
        jsx_chain: bool,
    },
    /// ```javascript
    /// (
    ///   a
    ///     ? b
    ///     : c
    /// )
    ///   ? d
    ///   : e;
    /// ```
    NestedTest {
        /// The same as for `Root`.
        jsx_chain: bool,
    },
    /// ```javascript
    /// a
    ///   ? b
    ///     ? c
    ///     : d
    ///   : e;
    /// ```
    NestedConsequent,
    /// The condition is aligned with what's after the parent's `:`.
    ///
    /// ```javascript
    /// a
    ///   ? b
    ///   : c +
    ///       d
    ///     ? e
    ///     : f;
    /// ```
    NestedAlternate,
}

impl ConditionalLayout {
    fn is_root(self) -> bool {
        matches!(self, Self::Root { .. })
    }

    fn is_nested_test(self) -> bool {
        matches!(self, Self::NestedTest { .. })
    }

    fn is_nested_alternate(self) -> bool {
        matches!(self, Self::NestedAlternate)
    }

    fn is_jsx_chain(self) -> bool {
        matches!(
            self,
            Self::Root { jsx_chain: true } | Self::NestedTest { jsx_chain: true }
        )
    }
}

pub(crate) fn is_jsx_conditional_chain(e: Expr<'_>) -> bool {
    let mut pending = smallvec::SmallVec::<[Expr<'_>; 8]>::new();
    pending.push(e);
    while let Some(e) = pending.pop() {
        let ExprKind::Cond { test, yes, no } = e.kind() else {
            continue;
        };
        for operand in [test, yes, no] {
            match operand.tag() {
                ExprTag::Jsx => return true,
                ExprTag::Cond => pending.push(operand),
                _ => {}
            }
        }
    }
    false
}

impl<'a> FormatConditionalLike<'a> {
    fn layout(&self, f: &Formatter<'a>) -> ConditionalLayout {
        match (self.conditional, self.conditional.parent()) {
            // In Prettier a type cast's parentheses are a node, and that node is then the parent.
            (
                ConditionalLike::ConditionalExpression(e),
                AstNodes::ConditionalExpression(parent),
            ) if !is_cast_target_that_hides_its_kind(e, f) => match parent.kind() {
                ExprKind::Cond { test, .. } if test == e => ConditionalLayout::NestedTest {
                    jsx_chain: is_jsx_conditional_chain(e),
                },
                ExprKind::Cond { yes, .. } if yes == e => ConditionalLayout::NestedConsequent,
                _ => ConditionalLayout::NestedAlternate,
            },
            (ConditionalLike::TSConditionalType(ty), AstNodes::TSConditionalType(parent)) => {
                match parent.kind() {
                    TypeKind::Cond { check, extends, .. } if check == ty || extends == ty => {
                        ConditionalLayout::NestedTest { jsx_chain: false }
                    }
                    TypeKind::Cond { yes, .. } if yes == ty => ConditionalLayout::NestedConsequent,
                    _ => ConditionalLayout::NestedAlternate,
                }
            }
            (ConditionalLike::ConditionalExpression(e), _) => ConditionalLayout::Root {
                jsx_chain: is_jsx_conditional_chain(e),
            },
            _ => ConditionalLayout::Root { jsx_chain: false },
        }
    }

    fn is_parent_static_member_expression(
        &self,
        layout: ConditionalLayout,
        f: &Formatter<'a>,
    ) -> bool {
        layout.is_root()
            && matches!(self.conditional, ConditionalLike::ConditionalExpression(_))
            && match self.conditional.parent() {
                AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
                // It's the left side.
                AstNodes::BinaryExpression(binary) => binary
                    .binary_op()
                    .is_some_and(|operator| is_angular_pipe(operator, f)),
                _ => false,
            }
    }

    fn format_test(&self, f: &mut Formatter<'a>, layout: ConditionalLayout) {
        let format_inner = format_with(|f| match self.conditional {
            ConditionalLike::ConditionalExpression(conditional) => {
                write!(f, conditional.test());
            }
            ConditionalLike::TSConditionalType(conditional) => {
                if let TypeKind::Cond { check, extends, .. } = conditional.kind() {
                    write!(f, [check, space(), "extends", space(), extends]);
                }
            }
        });
        match layout.is_nested_alternate() {
            true => write!(f, align(2, &format_inner)),
            false => write!(f, format_inner),
        }
    }

    fn format_consequent_and_alternate(&self, f: &mut Formatter<'a>) {
        let Some((consequent, alternate)) = self.conditional.consequent_and_alternate() else {
            return;
        };
        let is_space = f.options().indent_style.is_space();
        let format_branch = |branch: Operand<'a>| {
            format_with(move |f: &mut Formatter<'a>| match is_space {
                true => write!(f, align(2, &branch)),
                false => write!(f, indent(&branch)),
            })
        };
        // `a ? (b ? c : d) : e`
        let is_nested_consequent = consequent.is_conditional();
        ReturnTypeReading::note(self.conditional, OperandParentheses::AroundConditional, f);
        write!(
            f,
            [
                soft_line_break_or_space(),
                "?",
                space(),
                is_nested_consequent.then_some(if_group_fits_on_line(&"(")),
                format_branch(consequent),
                is_nested_consequent.then_some(if_group_fits_on_line(&")")),
                soft_line_break_or_space(),
                ":",
                space(),
                format_branch(alternate)
            ]
        );
    }
}

impl<'a> Format<'a> for ConditionalLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.options().experimental_ternaries {
            return super::experimental_ternary::write_ternary(*self, f);
        }
        FormatConditionalLike {
            conditional: *self,
            jsx_chain: false,
        }
        .fmt(f);
    }
}

struct FormatConditionalLike<'a> {
    conditional: ConditionalLike<'a>,
    /// It's inside a conditional that's a JSX chain.
    jsx_chain: bool,
}

impl<'a> Format<'a> for FormatConditionalLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let layout = self.layout(f);
        let should_extra_indent = layout.is_root()
            && matches!(self.conditional, ConditionalLike::ConditionalExpression(e) if should_extra_indent(e));
        let is_jsx_chain = self.jsx_chain || layout.is_jsx_chain();

        let format_inner = format_with(|f| {
            self.format_test(f, layout);

            let tail = format_with(|f| self.format_consequent_and_alternate(f));
            if is_jsx_chain
                && let ConditionalLike::ConditionalExpression(conditional) = self.conditional
                && let ExprKind::Cond { yes, no, .. } = conditional.kind()
            {
                ReturnTypeReading::note(self.conditional, OperandParentheses::AroundEach, f);
                write!(
                    f,
                    [
                        space(),
                        "?",
                        space(),
                        FormatJsxChainExpression {
                            expression: yes,
                            is_alternate: false
                        },
                        space(),
                        ":",
                        space(),
                        FormatJsxChainExpression {
                            expression: no,
                            is_alternate: true
                        }
                    ]
                );
            } else {
                match layout {
                    ConditionalLayout::Root { .. } | ConditionalLayout::NestedTest { .. } => {
                        write!(f, indent(&tail))
                    }
                    // The `dedent` undoes the parent's `align`, which with tabs would become an extra indentation
                    // level.
                    ConditionalLayout::NestedConsequent => write!(f, dedent(&indent(&tail))),
                    ConditionalLayout::NestedAlternate => write!(f, tail),
                }
            }

            // ```text
            // (a
            //   ? b
            //   : c
            // ).d
            // ```
            if !should_extra_indent
                && !is_jsx_chain
                && self.is_parent_static_member_expression(layout, f)
            {
                write!(f, soft_line_break());
            }
        });

        let grouped = format_with(|f| match layout.is_root() || layout.is_nested_test() {
            true => write!(f, group(&format_inner)),
            false => write!(f, format_inner),
        });

        match layout.is_nested_test() || should_extra_indent {
            true => write!(f, group(&soft_block_indent(&grouped))),
            false => write!(f, grouped),
        }
    }
}

/// An operand of a conditional that has a JSX element in it. If the conditional breaks, the operand is wrapped in
/// parentheses, unless it's `null`, `undefined` or a conditional after the `:`.
///
/// ```javascript
/// a ? (
///   <b>
///     <c />
///   </b>
/// ) : (
///   <d>
///     <e />
///   </d>
/// );
/// ```
struct FormatJsxChainExpression<'a> {
    expression: Expr<'a>,
    /// It's the operand after the `:`.
    is_alternate: bool,
}

impl<'a> Format<'a> for FormatJsxChainExpression<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        // A conditional expression in here isn't printed through `Expr`, so the stack check has to happen here.
        if !f.context_mut().has_stack_left() {
            return;
        }
        let expression = self.expression;
        let is_conditional = matches!(expression.kind(), ExprKind::Cond { .. })
            && !is_cast_target_that_hides_its_kind(expression, f);
        let no_wrap = is_nil(expression) || (is_conditional && self.is_alternate);

        let format_expression = format_with(|f| match is_conditional {
            true => format_node(expression.as_ast_nodes(), f, |f| {
                FormatConditionalLike {
                    conditional: ConditionalLike::ConditionalExpression(expression),
                    jsx_chain: true,
                }
                .fmt(f);
            }),
            false => expression.fmt(f),
        });

        if no_wrap {
            write!(f, format_expression);
        } else {
            write!(
                f,
                [
                    if_group_breaks(&"("),
                    soft_block_indent(&format_expression),
                    if_group_breaks(&")")
                ]
            );
        }
    }
}

/// `null` and `undefined` get no parentheses in a conditional that has a JSX element in it.
fn is_nil(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Ident(name) => name.bytes() == b"undefined",
        ExprKind::Null => true,
        _ => false,
    }
}

/// The parentheses that a conditional expression puts around its operands by itself.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum OperandParentheses {
    /// Around a conditional after the `?`, if all of it fits on the line.
    AroundConditional,
    /// Around each operand, if not all of it fits on the line: in a conditional that has a JSX element in it.
    AroundEach,
    /// With `--experimental-ternaries`.
    None,
}

/// In TypeScript, `( .. )` right before the `:` of a conditional can be the parameters of an arrow function, and what
/// follows the `:` its return type: `a ? b => ({}) : c => (d): T => e` is `a ? b => (({}): c => (d)) : T => e`, and
/// `a ? () => ({}) : c => c` is a syntax error. Other readers of TypeScript refuse `a ? b => ({}) : c => c` too.
/// Prettier and oxfmt print `c =>` for `(c) =>` there with `arrowParens: "avoid"`. So between such a `(` and where that
/// type can end, an arrow function keeps the parentheses around a parameter that is only a name.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct ReturnTypeReading {
    /// Where the first `(` is that the operand before the `:` can end with in any layout.
    from: u32,
    /// See `end_of_return_type`.
    until: u32,
}

impl ReturnTypeReading {
    /// Looks for the one of `conditional`, whose operands are written next.
    pub(super) fn note<'a>(
        conditional: ConditionalLike<'a>,
        parentheses: OperandParentheses,
        f: &mut Formatter<'a>,
    ) {
        let ConditionalLike::ConditionalExpression(conditional) = conditional else {
            return;
        };
        if !removes_parentheses_that_typescript_reads(f) {
            return;
        }
        let ExprKind::Cond { yes, no, .. } = conditional.kind() else {
            return;
        };
        let Some(from) = tried_parameters(yes, parentheses, f) else {
            return;
        };
        if parentheses != OperandParentheses::AroundEach && gives_up_after_colon(no, f) {
            return;
        }
        let until = end_of_return_type(conditional, no);
        let reading = ReturnTypeReading { from, until };
        let readings = &mut f.context_mut().return_type_readings;
        // What is written from here on is after the ones that end before this one starts.
        while readings.last().is_some_and(|it| it.until <= from) {
            readings.pop();
        }
        if readings.last() != Some(&reading) {
            readings.push(reading);
        }
    }

    /// True if `arrow`, whose only parameter is a name, keeps the parentheses around it.
    pub(crate) fn keeps_parentheses<'a>(arrow: Func<'a>, f: &Formatter<'a>) -> bool {
        let readings = &f.context().return_type_readings;
        !readings.is_empty()
            && (arrow.params().first()).is_some_and(|param| {
                let start = param.span().start;
                readings
                    .iter()
                    .any(|it| it.from <= start && start < it.until)
            })
    }
}

/// True if `arrowParens: "avoid"` applies in a file that TypeScript reads. Angular reads its own expressions.
fn removes_parentheses_that_typescript_reads(f: &Formatter<'_>) -> bool {
    let options = f.options();
    let file = f.file();
    options.arrow_parentheses.is_as_needed()
        && !file.is_flow()
        && (!file.is_javascript()
            || matches!(
                options.parser.as_deref(),
                Some(b"typescript" | b"babel-ts" | b"oxc-ts")
            ))
        && !options.in_html.root.is_angular()
}

/// Where the first `( .. )` starts that `operand` can end with in some layout, and that starts like parameters.
fn tried_parameters<'a>(
    operand: Expr<'a>,
    parentheses: OperandParentheses,
    f: &Formatter<'a>,
) -> Option<u32> {
    let mut from: Option<u32> = None;
    let mut tried = |e: Expr<'a>| {
        let start = e.span().start;
        from = Some(from.map_or(start, |it| it.min(start)));
    };
    if parentheses == OperandParentheses::AroundEach
        && !is_nil(operand)
        && starts_like_parameters(operand)
    {
        tried(operand);
    }
    // A conditional after a `?` or after a `=>` is in parentheses if it fits on the line.
    let mut fits_in_parentheses = parentheses == OperandParentheses::AroundConditional;
    let mut current = operand;
    loop {
        if expression_needs_parentheses(current, f) || is_cast_target(current, f) {
            if starts_like_parameters(current) {
                tried(current);
            }
            return from;
        }
        if current.tag() == ExprTag::Cond && fits_in_parentheses && starts_like_parameters(current)
        {
            tried(current);
        }
        fits_in_parentheses = false;
        match current.kind() {
            ExprKind::Cond { no, .. } => {
                // With `--experimental-ternaries`: `b => c ? d : (⏎e⏎)`, unless the conditional is in another one.
                if parentheses == OperandParentheses::None
                    && !matches!(current.ast_parent(), AstNodes::ConditionalExpression(_))
                    && starts_like_parameters(no)
                {
                    tried(no);
                }
                current = no;
            }
            ExprKind::Fn(arrow) if arrow.is_arrow() => {
                let FnBody::Expr(body) = arrow.body() else {
                    return from;
                };
                // The arrow function writes the parentheses of a sequence.
                if body.binary_op() == Some(BinOp::Comma) {
                    if starts_like_parameters(body) {
                        tried(body);
                    }
                    return from;
                }
                // `b => (c ? d : e)`, but `b => ({}) ? d : e`.
                fits_in_parentheses = body.tag() == ExprTag::Cond
                    && ExpressionLeftSide::leftmost(body).tag() != ExprTag::Object;
                current = body;
            }
            ExprKind::Assign { value, .. } => current = value,
            ExprKind::Yield {
                value: Some(value), ..
            } => current = value,
            // `<T>(a, b)` starts like an arrow function with type parameters, whatever is in the parentheses.
            ExprKind::As { expr, .. } | ExprKind::AsConst(expr)
                if current.is_angle_bracket_assertion() =>
            {
                if expression_needs_parentheses(expr, f) {
                    tried(expr);
                }
                return from;
            }
            // `async(a)` starts like an `async` arrow function. So does `async<T>(a)`, whatever `a` is.
            ExprKind::Call(call) if !call.is_optional() => {
                let callee = call.callee();
                let has_type_arguments = !call.type_args().is_empty()
                    || matches!(callee.kind(), ExprKind::Instantiation { .. });
                let name = match callee.kind() {
                    ExprKind::Instantiation { expr, .. } => expr,
                    _ => callee,
                };
                if !name.as_ident().is_some_and(|name| name.is("async")) {
                    return from;
                }
                match call.args().first() {
                    // `async((a, b))`
                    Some(first) if expression_needs_parentheses(first, f) => {}
                    Some(first) if first.tag() != ExprTag::Spread => {
                        if has_type_arguments || starts_like_parameters(first) {
                            tried(first);
                        }
                    }
                    // `async()`, `async(...a)`
                    _ => tried(current),
                }
                return from;
            }
            _ => return from,
        }
    }
}

/// `({`, `([`, `(a,`, `(a =`, `(a)`: TypeScript's `isParenthesizedArrowFunctionExpression` says `Tristate.Unknown`.
fn starts_like_parameters(e: Expr<'_>) -> bool {
    let is_name = |it: Expr<'_>| matches!(it.tag(), ExprTag::Ident | ExprTag::This);
    let first = match e.kind() {
        ExprKind::Binary {
            op: BinOp::Comma, ..
        } => e.sequence().first().copied(),
        ExprKind::Assign {
            op: None, target, ..
        } => Some(target),
        _ => Some(e),
    };
    first.is_some_and(is_name)
        || matches!(
            (ExpressionLeftSide::from(e).iter().last()).map(|it| it.expr.tag()),
            Some(ExprTag::Object | ExprTag::Array)
        )
}

/// True if `alternate` starts with what no reader takes for a type before a `=>`: `a(`, `a +`, `async b`. Not `a <`.
fn gives_up_after_colon<'a>(alternate: Expr<'a>, f: &Formatter<'a>) -> bool {
    let mut current = ExpressionLeftSide::from(alternate);
    // What starts with the name and the properties that are read from it.
    let mut around_name = None;
    loop {
        if expression_needs_parentheses(current.expr, f) || is_cast_target(current.expr, f) {
            return false;
        }
        let Some(left) = current.left() else {
            break;
        };
        // With `--experimental-ternaries`, a conditional writes the parentheses of a test that is a conditional.
        if current.expr.tag() == ExprTag::Cond && left.expr.tag() == ExprTag::Cond {
            return false;
        }
        if current.expr.tag() != ExprTag::Dot {
            around_name = Some(current.expr);
        }
        current = left;
    }
    let first = current.expr;
    if let Some(arrow) = first.arrow_function() {
        return arrow.is_async() || arrow.return_type().is_some();
    }
    let is_name = match first.kind() {
        ExprKind::Ident(name) => !matches!(name.bytes(), b"keyof" | b"unique" | b"readonly"),
        ExprKind::This => true,
        _ => false,
    };
    is_name
        && match around_name.map(|it| it.kind()) {
            None
            | Some(ExprKind::Call(_) | ExprKind::TaggedTemplate(_) | ExprKind::Cond { .. }) => true,
            // `<`, `<<`, `|` and `&` go on with a type.
            Some(ExprKind::Binary { op, .. }) => {
                !matches!(op, BinOp::Lt | BinOp::Shl | BinOp::BitOr | BinOp::BitAnd)
            }
            Some(_) => false,
        }
}

/// Where a type after the `:` of `conditional` can end: in `f(a ? () => ({}) : b < c, d)`, `c, d` are type arguments.
fn end_of_return_type<'a>(conditional: Expr<'a>, alternate: Expr<'a>) -> u32 {
    let mut end = conditional.span().end;
    // A `<` or a `<<` that isn't in brackets.
    let mut has_open_type_arguments = false;
    let mut rest: SmallVec<[Expr<'a>; 4]> = SmallVec::new();
    rest.push(alternate);
    while let Some(e) = rest.pop() {
        match e.kind() {
            ExprKind::Binary {
                op: BinOp::Lt | BinOp::Shl,
                ..
            } => {
                has_open_type_arguments = true;
                break;
            }
            ExprKind::Binary { left, right, .. } => rest.extend([left, right]),
            ExprKind::Fn(arrow) if arrow.is_arrow() => {
                if let FnBody::Expr(body) = arrow.body() {
                    rest.push(body);
                }
            }
            _ => {}
        }
    }
    if !has_open_type_arguments {
        return end;
    }
    // The arguments, elements or operands that `conditional` ends one of, whatever the source has in parentheses.
    let mut last = conditional;
    loop {
        let parent = match last.parent() {
            Node::Expr(parent) => parent,
            // `last` is what an arrow function returns.
            Node::Func(function) => match function.owner().as_expr() {
                Some(arrow) => {
                    last = arrow;
                    continue;
                }
                None => return end,
            },
            _ => return end,
        };
        match parent.kind() {
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::Array(_) => return parent.span().end,
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } => end = parent.span().end,
            ExprKind::Cond { no, .. } if no == last => {}
            ExprKind::Assign { value, .. } if value == last => {}
            ExprKind::Yield { .. } | ExprKind::Spread(_) => {}
            _ => return end,
        }
        last = parent;
    }
}
