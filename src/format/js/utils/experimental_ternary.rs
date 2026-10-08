//! `a ? b : c` and `A extends B ? C : D` with the option `experimentalTernaries`: the `?` is at the
//! end of the line of the condition. Prettier's `printTernary`.
//!
//! ```js
//! const animal =
//!   isBird ? "bird"
//!   : isCat ? "cat"
//!   : "unknown";
//! ```

use super::assignment_like::is_short_argument;
use super::conditional::ConditionalLike;
use super::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::parentheses;
use crate::js::print::binary_like_expression::is_angular_pipe;
use crate::prelude::*;
use crate::{format_args, write};

static SPACES: [u8; u8::MAX as usize] = [b' '; u8::MAX as usize];

/// An operand of either.
#[derive(Copy, Clone)]
enum Operand<'a> {
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

impl Operand<'_> {
    fn is_conditional(self) -> bool {
        match self {
            Operand::Expr(e) => matches!(e.kind(), ExprKind::Cond { .. }),
            Operand::Type(ty) => matches!(ty.kind(), TypeKind::Cond { .. }),
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

/// The comments between the operands, by what they belong to. Prettier's
/// `handleConditionalExpressionComments`.
#[derive(Copy, Clone, Default)]
struct OperandComments<'a> {
    after_test: &'a [Comment],
    before_consequent: &'a [Comment],
    after_consequent: &'a [Comment],
    /// On lines of their own before the `:`.
    before_colon: &'a [Comment],
    before_alternate: &'a [Comment],
}

impl<'a> OperandComments<'a> {
    fn new(
        test: Operand<'a>,
        consequent: Operand<'a>,
        alternate: Operand<'a>,
        f: &Formatter<'a>,
    ) -> Self {
        if f.is_quiet() {
            return Self::default();
        }
        let split = |before: Operand<'a>, after: Operand<'a>, operator: u8| {
            let start = before.span().end;
            let comments = f
                .comments()
                .comments_in(before.span().between(after.span()));
            comments
                .split_at_checked(trailing_count(comments, start, operator, f.source_text()))
                .unwrap_or((comments, &[]))
        };
        let (after_test, before_consequent) = split(test, consequent, b'?');
        let (after_consequent, rest) = split(consequent, alternate, b':');
        // Anything but a block comment on one line. Not in a conditional type, and not before a
        // `ChainExpression`, which TypeScript files have: Prettier compares the alternate with the
        // node that follows the comment, and that is the member access or the call in it.
        let count = match alternate {
            Operand::Expr(e) if f.file().is_javascript() || !is_chain_root(e) => rest
                .iter()
                .take_while(|comment| comment.is_line() || comment.is_multiline_block())
                .count(),
            _ => 0,
        };
        let (before_colon, before_alternate) = rest.split_at_checked(count).unwrap_or((rest, &[]));
        Self {
            after_test,
            before_consequent,
            after_consequent,
            before_colon,
            before_alternate,
        }
    }

    /// Prettier's `hasMultilineBlockComments`: of the comments of the operands.
    fn has_multiline_block(&self) -> bool {
        [
            self.after_test,
            self.before_consequent,
            self.after_consequent,
            self.before_alternate,
        ]
        .into_iter()
        .flatten()
        .any(|comment| comment.is_multiline_block())
    }
}

/// How many of `comments`, which are between an operand that ends at `start` and the next, trail the
/// former: those on its line, if they are before `operator` or the last of them ends the line.
fn trailing_count(
    comments: &[Comment],
    mut start: u32,
    operator: u8,
    source_text: SourceText<'_>,
) -> usize {
    let mut first_after_operator = None;
    for (index, comment) in comments.iter().enumerate() {
        if source_text.contains_newline(Span::before(start, comment.span)) {
            return index;
        }
        if comment.is_line() || comment.followed_by_newline() {
            return index + 1;
        }
        if first_after_operator.is_none()
            && source_text.contains_byte(Span::before(start, comment.span), operator)
        {
            first_after_operator = Some(index);
        }
        start = comment.span.end;
    }
    first_after_operator.unwrap_or(comments.len())
}

/// An operand and the comments after it.
struct FormatOperand<'a>(Operand<'a>, &'a [Comment]);

impl<'a> Format<'a> for FormatOperand<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(
            f,
            [
                FormatNodeWithoutTrailingComments(&self.0),
                FormatTrailingComments::Comments(self.1)
            ]
        );
    }
}

/// Content that has been formatted, to be written more than once.
struct Interned(Option<FormatElement>);

impl<'a> Format<'a> for Interned {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if let Some(element) = self.0 {
            f.write_element(element);
        }
    }
}

/// Prettier's `wrapInParens`: in parentheses, on lines of its own, if the enclosing group breaks.
struct WrapInParens<'b, T>(&'b T);

impl<'a, T: Format<'a>> Format<'a> for WrapInParens<'_, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(
            f,
            [
                if_group_breaks(&"("),
                soft_block_indent(self.0),
                if_group_breaks(&")")
            ]
        );
    }
}

/// Whether `conditional`, an expression, breaks whatever its width: there is a conditional after
/// its `?` or its `:`, or an operand has a block comment of several lines. Prettier's `shouldBreak`.
pub(crate) fn should_break<'a>(conditional: Expr<'a>, f: &Formatter<'a>) -> bool {
    let ExprKind::Cond { test, yes, no } = conditional.kind() else {
        return false;
    };
    let (test, consequent, alternate) =
        (Operand::Expr(test), Operand::Expr(yes), Operand::Expr(no));
    consequent.is_conditional()
        || alternate.is_conditional()
        || OperandComments::new(test, consequent, alternate, f).has_multiline_block()
}

pub(crate) fn write_ternary<'a>(conditional: ConditionalLike<'a>, f: &mut Formatter<'a>) {
    // The last of what is before the `?`, what is after it, and what is after the `:`.
    let (test, consequent, alternate, parent) = match conditional {
        ConditionalLike::ConditionalExpression(e) => match e.kind() {
            ExprKind::Cond { test, yes, no } => (
                Operand::Expr(test),
                Operand::Expr(yes),
                Operand::Expr(no),
                e.ast_parent(),
            ),
            _ => return,
        },
        ConditionalLike::TSConditionalType(ty) => match ty.kind() {
            TypeKind::Cond {
                extends, yes, no, ..
            } => (
                Operand::Type(extends),
                Operand::Type(yes),
                Operand::Type(no),
                ty.ast_parent(),
            ),
            _ => return,
        },
    };
    let is_ts_conditional = matches!(conditional, ConditionalLike::TSConditionalType(_));

    let (is_parent_ternary, is_in_test, is_in_alternate) = match (conditional, parent) {
        (ConditionalLike::ConditionalExpression(e), AstNodes::ConditionalExpression(parent)) => {
            match parent.kind() {
                ExprKind::Cond { test, no, .. } => (true, test == e, no == e),
                _ => (false, false, false),
            }
        }
        (ConditionalLike::TSConditionalType(ty), AstNodes::TSConditionalType(parent)) => {
            match parent.kind() {
                TypeKind::Cond {
                    check, extends, no, ..
                } => (true, check == ty || extends == ty, no == ty),
                _ => (false, false, false),
            }
        }
        _ => (false, false, false),
    };
    let is_consequent_ternary = consequent.is_conditional();
    let is_alternate_ternary = alternate.is_conditional();
    let is_in_chain = is_alternate_ternary || is_in_alternate;
    let use_tabs = f.options().indent_style.is_tab();
    let indent_width = f.options().indent_width.value();
    let is_big_tabs = indent_width > 2 || use_tabs;

    let is_on_same_line_as_return = matches!(
        parent,
        AstNodes::ReturnStatement(_) | AstNodes::ThrowStatement(_)
    ) && !is_consequent_ternary
        && !is_alternate_ternary;
    let is_in_jsx = match conditional {
        ConditionalLike::ConditionalExpression(e) => {
            matches!(
                first_non_conditional_parent(e),
                AstNodes::JSXExpressionContainer(_)
            ) && !matches!(parent.parent(), AstNodes::JSXAttribute(_))
        }
        ConditionalLike::TSConditionalType(_) => false,
    };
    let should_extra_indent = match conditional {
        ConditionalLike::ConditionalExpression(e) => should_extra_indent(e),
        ConditionalLike::TSConditionalType(_) => false,
    };
    // So that what follows is right behind the `)`: `(a ? b : c\n).d`
    let break_closing_paren = !is_ts_conditional
        && match parent {
            AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
            // It is the left side.
            AstNodes::BinaryExpression(binary) => binary
                .binary_operator()
                .is_some_and(|operator| is_angular_pipe(operator, f)),
            _ => false,
        };
    let break_ts_closing_paren = match conditional {
        ConditionalLike::TSConditionalType(ty) => parentheses::ts_type::needs_parentheses(ty, f),
        ConditionalLike::ConditionalExpression(_) => false,
    };

    // A chain breaks as a whole.
    let comments = OperandComments::new(test, consequent, alternate, f);
    let should_break =
        is_consequent_ternary || is_alternate_ternary || comments.has_multiline_block();

    // So that a short consequent is not pushed to the next line:
    //
    //   const result = foo != null ? foo : (
    //     some + long + expression
    //   );
    let try_to_parenthesize_alternate = !is_in_chain
        && !is_parent_ternary
        && match (test, consequent) {
            (Operand::Expr(_), Operand::Expr(consequent)) if is_in_jsx => {
                matches!(consequent.kind(), ExprKind::Null)
            }
            (Operand::Expr(test), Operand::Expr(consequent)) => {
                comments.before_consequent.is_empty()
                    && comments.after_consequent.is_empty()
                    && is_short_argument(consequent, f.options().line_width.value() / 4, f)
                    && is_simple_expression_by_node_count(test, 3, f)
            }
            _ => false,
        };

    let should_group_test_and_consequent = is_in_chain
        || (is_ts_conditional && !is_parent_ternary)
        || (is_parent_ternary
            && matches!(test, Operand::Expr(test) if is_simple_expression_by_node_count(test, 1, f)))
        || try_to_parenthesize_alternate;

    let test_id = f.group_id("test");
    let test_and_consequent_id = f.group_id("test-and-consequent");

    let format_test_with_question_mark = format_with(|f| {
        let format_test = format_with(|f| match conditional {
            ConditionalLike::ConditionalExpression(_) => {
                let is_conditional = test.is_conditional();
                let test = FormatOperand(test, comments.after_test);
                write!(
                    f,
                    [
                        WrapInParens(&test),
                        is_conditional.then_some(expand_parent())
                    ]
                );
            }
            ConditionalLike::TSConditionalType(ty) => {
                let TypeKind::Cond { check, extends, .. } = ty.kind() else {
                    return;
                };
                write!(f, [check, space(), "extends", space()]);
                let format_extends = FormatOperand(test, comments.after_test);
                match extends.kind() {
                    TypeKind::Cond { .. } | TypeKind::Mapped(_) => write!(f, format_extends),
                    _ => write!(f, group(&WrapInParens(&format_extends))),
                }
            }
        });
        write!(
            f,
            group(&format_args!(format_test, space(), "?")).with_group_id(Some(test_id))
        );
    });

    let format_consequent = format_with(|f| {
        let is_on_its_own_line = is_consequent_ternary
            || (is_in_jsx
                && (is_parent_ternary
                    || is_in_chain
                    || matches!(consequent, Operand::Expr(consequent) if matches!(consequent.kind(), ExprKind::Jsx(_)))));
        let line = if is_on_its_own_line {
            hard_line_break()
        } else {
            soft_line_break_or_space()
        };
        write!(
            f,
            indent(&format_args!(
                line,
                FormatOperand(consequent, comments.after_consequent)
            ))
        );
    });

    let format_test_and_consequent = format_with(|f| {
        if !should_group_test_and_consequent {
            return write!(f, [format_test_with_question_mark, format_consequent]);
        }
        let content = format_with(|f| {
            write!(f, format_test_with_question_mark);
            if is_in_chain {
                return write!(f, format_consequent);
            }
            // If the test breaks, so does the consequent.
            let consequent = Interned(f.intern(&format_consequent));
            write!(
                f,
                [
                    if_group_breaks(&consequent).with_group_id(Some(test_id)),
                    if_group_fits_on_line(&group(&consequent)).with_group_id(Some(test_id))
                ]
            );
        });
        write!(
            f,
            group(&content).with_group_id(Some(test_and_consequent_id))
        );
    });

    let format_alternate = format_with(|f| {
        let alternate = FormatNodeWithoutTrailingComments(&alternate);
        if !try_to_parenthesize_alternate {
            return write!(f, alternate);
        }
        let alternate = Interned(f.intern(&alternate));
        write!(
            f,
            [
                if_group_breaks(&alternate).with_group_id(Some(test_and_consequent_id)),
                if_group_fits_on_line(&dedent(&WrapInParens(&alternate)))
                    .with_group_id(Some(test_and_consequent_id))
            ]
        );
    });

    // What lines the alternate up with the consequent, which is indented.
    let fill_tab = format_with(|f| match use_tabs {
        true => write!(f, text(b"\t")),
        false => write!(
            f,
            text(
                SPACES
                    .get(..usize::from(indent_width).saturating_sub(1))
                    .unwrap_or_default()
            )
        ),
    });

    let format_parts = format_with(|f| {
        write!(f, format_test_and_consequent);

        if !comments.before_colon.is_empty() {
            let comments = FormatDanglingComments::Comments {
                comments: comments.before_colon,
                indent: DanglingIndentMode::None,
            };
            write!(
                f,
                [
                    indent(&format_args!(hard_line_break(), comments)),
                    hard_line_break()
                ]
            );
        } else if is_alternate_ternary {
            write!(f, hard_line_break());
        } else if try_to_parenthesize_alternate {
            write!(
                f,
                [
                    if_group_breaks(&soft_line_break_or_space())
                        .with_group_id(Some(test_and_consequent_id)),
                    if_group_fits_on_line(&space()).with_group_id(Some(test_and_consequent_id))
                ]
            );
        } else {
            write!(f, soft_line_break_or_space());
        }

        write!(f, ":");

        if is_alternate_ternary || !is_big_tabs {
            write!(f, space());
        } else if should_group_test_and_consequent {
            let if_it_fits = format_with(|f| match is_in_chain || try_to_parenthesize_alternate {
                true => write!(f, space()),
                false => write!(
                    f,
                    [if_group_breaks(&fill_tab), if_group_fits_on_line(&space())]
                ),
            });
            write!(
                f,
                [
                    if_group_breaks(&fill_tab).with_group_id(Some(test_and_consequent_id)),
                    if_group_fits_on_line(&if_it_fits).with_group_id(Some(test_and_consequent_id))
                ]
            );
        } else {
            write!(
                f,
                [if_group_breaks(&fill_tab), if_group_fits_on_line(&space())]
            );
        }

        if is_alternate_ternary {
            write!(f, format_alternate);
        } else {
            let line = (is_in_jsx && !try_to_parenthesize_alternate).then(|| match conditional {
                // Prettier writes both line breaks, which makes an empty line.
                ConditionalLike::ConditionalExpression(e) if is_followed_by_line_break(e) => {
                    soft_empty_line()
                }
                _ => soft_line_break(),
            });
            write!(f, group(&format_args!(indent(&format_alternate), line)));
        }

        write!(
            f,
            [
                (break_closing_paren && !should_extra_indent).then_some(soft_line_break()),
                should_break.then_some(expand_parent())
            ]
        );
    });

    if is_on_same_line_as_return {
        write!(f, group(&indent(&format_parts)));
    } else if should_extra_indent || (is_ts_conditional && is_in_test) {
        write!(
            f,
            group(&format_args!(
                indent(&format_args!(soft_line_break(), format_parts)),
                break_ts_closing_paren.then_some(soft_line_break())
            ))
        );
    } else if !is_parent_ternary || is_in_test {
        write!(f, group(&format_parts));
    } else {
        write!(f, format_parts);
    }
}

/// What the outermost conditional is in that `e` is a consequent or an alternate of, directly or
/// not.
fn first_non_conditional_parent(e: Expr<'_>) -> AstNodes<'_> {
    let mut previous = e;
    let mut current = e.ast_parent();
    while let AstNodes::ConditionalExpression(conditional) = current
        && conditional.test() != Some(previous)
    {
        previous = conditional;
        current = current.parent();
    }
    current
}

/// Whether a line break is written right after `e`, which is in JSX: it is the end of what is after
/// the `?` of a conditional, or of the value of an attribute.
fn is_followed_by_line_break(e: Expr<'_>) -> bool {
    let mut last = e;
    let mut parent = e.ast_parent();
    while let AstNodes::ConditionalExpression(conditional) = parent {
        if conditional.alternate() != Some(last) {
            return conditional.test() != Some(last);
        }
        last = conditional;
        parent = parent.parent();
    }
    matches!(parent, AstNodes::JSXExpressionContainer(_))
        && matches!(parent.parent(), AstNodes::JSXAttribute(_))
}

/// Prettier's `shouldExtraIndentForConditionalExpression`: whether `conditional` is what a chain of
/// member accesses and calls starts with, which is the whole of what is returned, assigned, ..
fn should_extra_indent(conditional: Expr<'_>) -> bool {
    let mut child = conditional;
    let mut parent = conditional.ast_parent();
    loop {
        match parent {
            AstNodes::ChainExpression(_) => {}
            AstNodes::TSNonNullExpression(it) => child = it,
            AstNodes::CallExpression(it) if it.callee() == Some(child) => child = it,
            AstNodes::StaticMemberExpression(it)
            | AstNodes::ComputedMemberExpression(it)
            | AstNodes::PrivateFieldExpression(it)
                if it.object() == Some(child) =>
            {
                child = it;
            }
            AstNodes::NewExpression(it) if it.callee() == Some(child) => {
                child = it;
                parent = parent.parent();
                break;
            }
            AstNodes::TSAsExpression(it) | AstNodes::TSSatisfiesExpression(it)
                if it.expression() == Some(child) =>
            {
                child = it;
                parent = parent.parent();
                break;
            }
            _ => break,
        }
        parent = parent.parent();
    }
    if child == conditional {
        return false;
    }
    match parent {
        AstNodes::AssignmentExpression(it) => it.right() == Some(child),
        AstNodes::VariableDeclarator(it) => it.init() == Some(child),
        AstNodes::ReturnStatement(_) | AstNodes::ThrowStatement(_) => true,
        AstNodes::UnaryExpression(it)
        | AstNodes::YieldExpression(it)
        | AstNodes::AwaitExpression(it) => it.argument() == Some(child),
        _ => false,
    }
}

/// Prettier's `isSimpleExpressionByNodeCount`: whether there are at most `max` nodes in `e`, of
/// those that are the value of a property of a node of ESTree. What is in a list, like the
/// arguments of a call, does not count.
fn is_simple_expression_by_node_count<'a>(e: Expr<'a>, max: u32, f: &Formatter<'a>) -> bool {
    inner_node_count(e, max, f.context().has_tree_of_babel()) <= max
}

/// The count can stop at anything above `max`. Babel, which reads JavaScript for Prettier, has no
/// `ChainExpression` and has a name in a `PrivateName`.
fn inner_node_count(e: Expr<'_>, max: u32, is_javascript: bool) -> u32 {
    let child = |e: Expr<'_>, count: u32| match count > max {
        true => count,
        false => count + 1 + inner_node_count(e, max - count, is_javascript),
    };
    let private_name = u32::from(is_javascript);
    let count = match e.kind() {
        ExprKind::Missing
        | ExprKind::Ident(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::Template(_)
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Binary {
            op: BinOp::Comma, ..
        } => 0,
        ExprKind::PrivateIdentifier(_) => private_name,
        ExprKind::ImportMeta | ExprKind::NewTarget => 2,
        ExprKind::Dot { obj, name, .. } => child(
            obj,
            1 + if name.bytes().starts_with(b"#") {
                private_name
            } else {
                0
            },
        ),
        ExprKind::Index { obj, index, .. } => child(index, child(obj, 0)),
        ExprKind::Call(call) | ExprKind::New(call) => {
            child(call.callee(), u32::from(!call.type_args().is_empty()))
        }
        // The template is a node.
        ExprKind::TaggedTemplate(call) => {
            child(call.callee(), 1 + u32::from(!call.type_args().is_empty()))
        }
        ExprKind::Unary { operand, .. } | ExprKind::Await(operand) | ExprKind::Spread(operand) => {
            child(operand, 0)
        }
        ExprKind::Yield { value, .. } => value.map_or(0, |value| child(value, 0)),
        ExprKind::Binary { left, right, .. } => child(right, child(left, 0)),
        ExprKind::Assign { target, value, .. } => child(value, child(target, 0)),
        ExprKind::Cond { test, yes, no } => child(no, child(yes, child(test, 0))),
        ExprKind::NonNull(expression) => {
            child(expression, e.non_null_count().saturating_sub(1) as u32)
        }
        ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
            child(expr, 1 + inner_type_node_count(ty))
        }
        // `const` is a `TSTypeReference` with a name.
        ExprKind::AsConst(expr) => child(expr, 2),
        ExprKind::Instantiation { expr, .. } => child(expr, 1),
        ExprKind::ImportCall { args } => args
            .iter()
            .fold(0, |count, argument| child(argument, count)),
        ExprKind::Fn(func) => {
            let signature = u32::from(func.name().is_some())
                + u32::from(!func.type_params().is_empty())
                + func
                    .return_type()
                    .map_or(0, |ty| 2 + inner_type_node_count(ty));
            match func.body() {
                FnBody::Expr(body) => child(body, signature),
                _ => signature + 1,
            }
        }
        // At least the body, or the opening element and its name.
        ExprKind::Class(class) => {
            1 + u32::from(class.name().is_some()) + class.extends().map_or(0, |it| child(it, 0))
        }
        ExprKind::Jsx(_) => 2,
    };
    match !is_javascript && is_chain_root(e) {
        true => count + 1,
        false => count,
    }
}

/// The same for a type. Anything but the simplest counts as many.
fn inner_type_node_count(ty: TypeNode<'_>) -> u32 {
    match ty.kind() {
        TypeKind::Keyword(_) => 0,
        TypeKind::StringLit(_) | TypeKind::BoolLit(_) => 1,
        TypeKind::Ref { name, args } => {
            (2 * name.len() as u32).saturating_sub(1) + u32::from(!args.is_empty())
        }
        TypeKind::Array(element) => 1 + inner_type_node_count(element),
        _ => 4,
    }
}
