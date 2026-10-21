//! `a ? b : c` and `A extends B ? C : D` with the `experimentalTernaries` option: the `?` goes at the end of the
//! condition's line. Prettier's `printTernary`.
//!
//! ```js
//! const animal =
//!   isBird ? "bird"
//!   : isCat ? "cat"
//!   : "unknown";
//! ```

use super::assignment_like::is_short_argument;
use super::conditional::{ConditionalLike, Operand, should_extra_indent};
use super::typecast::{comments_of_expression, is_chain_expression_without_comments};
use crate::js::parentheses;
use crate::js::print::binary_like_expression::is_angular_pipe;
use crate::js::print::statements::parenthesis_before_needs_semicolon;
use crate::prelude::*;
use crate::{format_args, write};

impl<'a> Operand<'a> {
    /// True if one of its comments is a block comment that spans several lines.
    fn has_multiline_block_comment(self, f: &Formatter<'a>) -> bool {
        let comments = match self {
            Operand::Expr(e) if is_chain_expression_without_comments(e, f) => return false,
            Operand::Expr(e) => comments_of_expression(e, f),
            Operand::Type(ty) => f.comments().of_node(ty.as_ast_nodes()),
        };
        (comments.leading.iter())
            .chain(comments.trailing)
            .chain(comments.dangling)
            .any(|comment| comment.is_multiline_block())
    }
}

/// Prettier's `hasMultilineBlockComments`.
fn has_multiline_block_comments<'a>(conditional: ConditionalLike<'a>, f: &Formatter<'a>) -> bool {
    if f.is_quiet() {
        return false;
    }
    match conditional {
        ConditionalLike::ConditionalExpression(e) => match e.kind() {
            ExprKind::Cond { test, yes, no } => [test, yes, no]
                .map(Operand::Expr)
                .into_iter()
                .any(|operand| operand.has_multiline_block_comment(f)),
            _ => false,
        },
        ConditionalLike::TSConditionalType(ty) => match ty.kind() {
            TypeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => [check, extends, yes, no]
                .map(Operand::Type)
                .into_iter()
                .any(|operand| operand.has_multiline_block_comment(f)),
            _ => false,
        },
    }
}

/// Formatted content that's printed more than once.
struct Interned(Option<FormatElement>);

impl<'a> Format<'a> for Interned {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if let Some(element) = self.0 {
            f.write_element(element);
        }
    }
}

/// Prettier's `wrapInParens`: wrapped in parentheses, on its own lines, if the enclosing group breaks.
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

/// True if `conditional`, an expression, breaks regardless of its width: there's a conditional after its `?` or `:`, or
/// an operand has a multi-line block comment. Prettier's `shouldBreak`.
pub(crate) fn should_break<'a>(conditional: Expr<'a>, f: &Formatter<'a>) -> bool {
    let ExprKind::Cond { yes, no, .. } = conditional.kind() else {
        return false;
    };
    Operand::Expr(yes).is_conditional()
        || Operand::Expr(no).is_conditional()
        || has_multiline_block_comments(ConditionalLike::ConditionalExpression(conditional), f)
}

pub(crate) fn write_ternary<'a>(conditional: ConditionalLike<'a>, f: &mut Formatter<'a>) {
    // The last operand before the `?`, the one after it, and the one after the `:`.
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
    // So that what follows comes right after the `)`: `(a ? b : c\n).d`
    let break_closing_paren = !is_ts_conditional
        && match parent {
            AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
            // It's the left side.
            AstNodes::BinaryExpression(binary) => binary
                .binary_op()
                .is_some_and(|operator| is_angular_pipe(operator, f)),
            _ => false,
        };
    let break_ts_closing_paren = match conditional {
        ConditionalLike::TSConditionalType(ty) => parentheses::ts_type::needs_parentheses(ty, f),
        ConditionalLike::ConditionalExpression(_) => false,
    };

    // A chain breaks as a whole.
    let should_break = is_consequent_ternary
        || is_alternate_ternary
        || has_multiline_block_comments(conditional, f);

    // So that a short consequent isn't pushed to the next line:
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
                is_short_argument(consequent, f.options().line_width.value() / 4, f)
                    && is_simple_expression_by_node_count(test, 3, f)
            }
            _ => false,
        };

    let should_group_test_and_consequent = is_in_chain
        || (is_ts_conditional && !is_parent_ternary)
        || (is_parent_ternary
            && matches!(test, Operand::Expr(test) if is_simple_expression_by_node_count(test, 1, f)))
        || try_to_parenthesize_alternate;

    // Prettier's `alternateComments`: they go on their own lines before the `:`. Prettier also prints the test's
    // dangling comments here, a second time: `f(/* comment */) ? a : b`.
    let comments_before_colon = match (f.is_quiet(), conditional) {
        (true, _) => CommentList::empty(),
        (false, ConditionalLike::ConditionalExpression(e)) => {
            f.comments().of_node(e.as_ast_nodes()).dangling
        }
        (false, ConditionalLike::TSConditionalType(ty)) => {
            f.comments().of_node(ty.as_ast_nodes()).dangling
        }
    };

    let test_id = f.group_id("test");
    let test_and_consequent_id = f.group_id("test-and-consequent");

    let format_test_with_question_mark = format_with(|f| {
        let format_test = format_with(|f| match conditional {
            ConditionalLike::ConditionalExpression(e) => {
                let is_conditional = test.is_conditional();
                if parenthesis_before_needs_semicolon(e, f) {
                    write!(f, if_group_breaks(&";"));
                }
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
                match extends.kind() {
                    TypeKind::Cond { .. } | TypeKind::Mapped(_) => write!(f, extends),
                    _ => write!(f, group(&WrapInParens(&extends))),
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
        write!(f, indent(&format_args!(line, consequent)));
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

    // Lines the alternate up with the consequent, which is indented.
    let fill_tab = format_with(|f| match use_tabs {
        true => write!(f, text(b"\t")),
        // A width that's too long for a text is also too long for the consequent's indentation, which the printer
        // rejects.
        false if crate::is_too_long(indent_width as usize) => {}
        false => write!(
            f,
            text(&b" ".repeat((indent_width as usize).saturating_sub(1)))
        ),
    });

    let format_parts = format_with(|f| {
        write!(f, format_test_and_consequent);

        if !comments_before_colon.is_empty() {
            let comments = FormatDanglingComments::Comments {
                comments: comments_before_colon,
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
                // Prettier prints both line breaks, which makes an empty line.
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

/// The parent of the outermost conditional that has `e` as a consequent or alternate, directly or nested.
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

/// True if a line break is printed right after `e`, which is in JSX: `e` ends a conditional's consequent or an
/// attribute's value.
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

/// Prettier's `isSimpleExpressionByNodeCount`: true if `e` has at most `max` nodes, counting only those that are the
/// value of an ESTree node's property. Nodes in a list, like a call's arguments, don't count.
fn is_simple_expression_by_node_count<'a>(e: Expr<'a>, max: u32, f: &Formatter<'a>) -> bool {
    inner_node_count(e, max, f.context().has_babel_tree()) <= max
}

/// The count can stop at anything above `max`. Babel, which Prettier uses to parse JavaScript, has no `ChainExpression`
/// and wraps a name in a `PrivateName`.
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
    match !is_javascript && e.is_chain_root() {
        true => count + 1,
        false => count,
    }
}

/// The same for a type. Anything but the simplest types counts as many nodes.
fn inner_type_node_count(mut ty: TypeNode<'_>) -> u32 {
    let mut arrays = 0u32;
    while let TypeKind::Array(element) = ty.kind() {
        (ty, arrays) = (element, arrays.saturating_add(1));
    }
    arrays.saturating_add(match ty.kind() {
        TypeKind::Keyword(_) => 0,
        TypeKind::StringLit(_) | TypeKind::BoolLit(_) => 1,
        TypeKind::Ref { name, args } => {
            (2 * name.len() as u32).saturating_sub(1) + u32::from(!args.is_empty())
        }
        _ => 4,
    })
}
