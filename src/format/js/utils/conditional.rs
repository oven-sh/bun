//! `a ? b : c` and `A extends B ? C : D`. Prettier's `printTernary`.

use super::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::prelude::*;
use crate::write;

#[derive(Copy, Clone)]
pub(crate) enum ConditionalLike<'a> {
    ConditionalExpression(Expr<'a>),
    TSConditionalType(TypeNode<'a>),
}

/// An operand of either.
#[derive(Copy, Clone, PartialEq, Eq)]
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

impl<'a> Format<'a> for Operand<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self {
            Operand::Expr(e) => e.fmt(f),
            Operand::Type(ty) => ty.fmt(f),
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

impl<'a> ConditionalLike<'a> {
    fn span(&self) -> Span {
        match self {
            ConditionalLike::ConditionalExpression(e) => e.span(),
            ConditionalLike::TSConditionalType(ty) => ty.span(),
        }
    }

    fn parent(&self) -> AstNodes<'a> {
        match self {
            ConditionalLike::ConditionalExpression(e) => e.ast_parent(),
            ConditionalLike::TSConditionalType(ty) => ty.ast_parent(),
        }
    }

    /// What is after the `?`, and what is after the `:`.
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

/// Where a conditional is in another.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConditionalLayout {
    /// It is not in another conditional.
    Root {
        /// One of the operands of it or of the conditionals in it is a JSX element.
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
    NestedTest,
    /// ```javascript
    /// a
    ///   ? b
    ///     ? c
    ///     : d
    ///   : e;
    /// ```
    NestedConsequent,
    /// The condition is aligned with what is after the `:` of the parent.
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
        matches!(self, Self::NestedTest)
    }

    fn is_nested_alternate(self) -> bool {
        matches!(self, Self::NestedAlternate)
    }

    fn is_jsx_chain(self) -> bool {
        matches!(self, Self::Root { jsx_chain: true })
    }
}

/// Writes the comments after an operand that ends at `start`, up to `operator` or to the end of the
/// line. `end`: where the next operand starts.
fn format_operand_trailing_comments<'a>(mut start: u32, end: u32, operator: u8, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return;
    }
    let comments = f.comments().unprinted_comments();
    let source_text = f.source_text();
    let mut index_before_operator = None;
    let mut count = None;
    for (index, comment) in comments.iter().enumerate() {
        if comment.span.end > end {
            count = Some(index_before_operator.unwrap_or(index));
            break;
        }
        if source_text.contains_newline_between(start, comment.span.start) {
            // It is on a new line.
            count = Some(index);
            break;
        } else if comment.is_line() || comment.followed_by_newline() {
            count = Some(index + 1);
            break;
        } else if source_text.bytes_contain(start, comment.span.start, operator) {
            index_before_operator = Some(index);
        }
        start = comment.span.end;
    }
    let count = count.unwrap_or_else(|| index_before_operator.unwrap_or(comments.len()));
    FormatTrailingComments::Comments(comments.get(..count).unwrap_or_default()).fmt(f);
}

fn is_jsx_conditional_chain(e: Expr<'_>) -> bool {
    let ExprKind::Cond { test, yes, no } = e.kind() else {
        return false;
    };
    [test, yes, no].into_iter().any(|operand| matches!(operand.kind(), ExprKind::Jsx(_)) || is_jsx_conditional_chain(operand))
}

impl<'a> FormatConditionalLike<'a> {
    fn layout(&self) -> ConditionalLayout {
        match (self.conditional, self.conditional.parent()) {
            (ConditionalLike::ConditionalExpression(e), AstNodes::ConditionalExpression(parent)) => match parent.kind() {
                ExprKind::Cond { test, .. } if test == e => ConditionalLayout::NestedTest,
                ExprKind::Cond { yes, .. } if yes == e => ConditionalLayout::NestedConsequent,
                _ => ConditionalLayout::NestedAlternate,
            },
            (ConditionalLike::TSConditionalType(ty), AstNodes::TSConditionalType(parent)) => match parent.kind() {
                TypeKind::Cond { check, extends, .. } if check == ty || extends == ty => ConditionalLayout::NestedTest,
                TypeKind::Cond { yes, .. } if yes == ty => ConditionalLayout::NestedConsequent,
                _ => ConditionalLayout::NestedAlternate,
            },
            (ConditionalLike::ConditionalExpression(e), _) => ConditionalLayout::Root {
                jsx_chain: is_jsx_conditional_chain(e),
            },
            _ => ConditionalLayout::Root { jsx_chain: false },
        }
    }

    /// Whether it is what a chain of member accesses and calls starts with, which is the whole of
    /// what is returned, assigned, ..:
    ///
    /// ```javascript
    /// return (
    ///   a
    ///     ? b
    ///     : c
    /// ).member;
    /// ```
    fn should_extra_indent(&self, layout: ConditionalLayout) -> bool {
        let ConditionalLike::ConditionalExpression(conditional) = self.conditional else {
            return false;
        };
        if !layout.is_root() {
            return false;
        }

        let mut expression = conditional;
        let mut parent = conditional.ast_parent();
        loop {
            match parent {
                AstNodes::ChainExpression(_) => parent = parent.parent(),
                AstNodes::StaticMemberExpression(e)
                | AstNodes::ComputedMemberExpression(e)
                | AstNodes::CallExpression(e)
                | AstNodes::TSNonNullExpression(e) => {
                    let head = e.object().or_else(|| e.callee()).or_else(|| e.expression());
                    if head != Some(expression) {
                        break;
                    }
                    expression = e;
                    parent = parent.parent();
                }
                AstNodes::NewExpression(e) | AstNodes::TSAsExpression(e) | AstNodes::TSSatisfiesExpression(e) => {
                    parent = parent.parent();
                    if e.callee().or_else(|| e.expression()) == Some(expression) {
                        expression = e;
                    }
                    break;
                }
                _ => break,
            }
        }
        if expression == conditional {
            return false;
        }

        match parent {
            AstNodes::VariableDeclarator(declarator) => declarator.init() == Some(expression),
            AstNodes::ReturnStatement(_) | AstNodes::ThrowStatement(_) => true,
            AstNodes::UnaryExpression(e) | AstNodes::YieldExpression(e) | AstNodes::AwaitExpression(e) => {
                e.argument() == Some(expression)
            }
            AstNodes::AssignmentExpression(assignment) => assignment.right() == Some(expression),
            _ => false,
        }
    }

    fn is_parent_static_member_expression(&self, layout: ConditionalLayout) -> bool {
        layout.is_root()
            && matches!(self.conditional, ConditionalLike::ConditionalExpression(_))
            && matches!(self.conditional.parent(), AstNodes::StaticMemberExpression(_))
    }

    fn format_test(&self, f: &mut Formatter<'a>, layout: ConditionalLayout) {
        let format_inner = format_with(|f| {
            let (start, end) = match self.conditional {
                ConditionalLike::ConditionalExpression(conditional) => {
                    let ExprKind::Cond { test, yes, .. } = conditional.kind() else {
                        return;
                    };
                    write!(f, FormatNodeWithoutTrailingComments(&test));
                    (test.span().end, yes.span().start)
                }
                ConditionalLike::TSConditionalType(conditional) => {
                    let TypeKind::Cond {
                        check, extends, yes, ..
                    } = conditional.kind()
                    else {
                        return;
                    };
                    write!(f, [check, space(), "extends", space(), FormatNodeWithoutTrailingComments(&extends)]);
                    (extends.span().end, yes.span().start)
                }
            };
            format_operand_trailing_comments(start, end, b'?', f);
        });

        if layout.is_nested_alternate() {
            // The comments before it are not aligned.
            let comments = f.comments().comments_before(self.conditional.span().start);
            write!(f, [FormatLeadingComments::Comments(comments), align(2, &format_inner)]);
        } else {
            write!(f, format_inner);
        }
    }

    fn format_consequent_and_alternate(&self, f: &mut Formatter<'a>) {
        let Some((consequent, alternate)) = self.conditional.consequent_and_alternate() else {
            return;
        };
        let is_space = f.options().indent_style.is_space();
        write!(f, [soft_line_break_or_space(), "?", space()]);

        let format_consequent_with_trailing_comments = format_with(|f| {
            write!(f, FormatNodeWithoutTrailingComments(&consequent));
            format_operand_trailing_comments(consequent.span().end, alternate.span().start, b':', f);
        });
        let format_consequent = format_with(|f| match is_space {
            true => write!(f, align(2, &format_consequent_with_trailing_comments)),
            false => write!(f, indent(&format_consequent_with_trailing_comments)),
        });
        // `a ? (b ? c : d) : e`
        let is_nested_consequent = consequent.is_conditional();
        write!(
            f,
            [
                is_nested_consequent.then_some(if_group_fits_on_line(&"(")),
                format_consequent,
                is_nested_consequent.then_some(if_group_fits_on_line(&")")),
                soft_line_break_or_space(),
                ":",
                space()
            ]
        );

        let format_alternate = FormatNodeWithoutTrailingComments(&alternate);
        match is_space {
            true => write!(f, align(2, &format_alternate)),
            false => write!(f, indent(&format_alternate)),
        }
    }
}

impl<'a> Format<'a> for ConditionalLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        FormatConditionalLike {
            conditional: *self,
            jsx_chain: false,
        }
        .fmt(f);
    }
}

struct FormatConditionalLike<'a> {
    conditional: ConditionalLike<'a>,
    /// It is in a conditional that is a JSX chain.
    jsx_chain: bool,
}

impl<'a> Format<'a> for FormatConditionalLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let layout = self.layout();
        let should_extra_indent = self.should_extra_indent(layout);
        let is_jsx_chain = self.jsx_chain || layout.is_jsx_chain();

        let format_inner = format_with(|f| {
            self.format_test(f, layout);

            let tail = format_with(|f| self.format_consequent_and_alternate(f));
            if is_jsx_chain
                && let ConditionalLike::ConditionalExpression(conditional) = self.conditional
                && let ExprKind::Cond { yes, no, .. } = conditional.kind()
            {
                write!(
                    f,
                    [
                        space(),
                        "?",
                        space(),
                        FormatJsxChainExpression {
                            expression: yes,
                            alternate: false
                        },
                        space(),
                        ":",
                        space(),
                        FormatJsxChainExpression {
                            expression: no,
                            alternate: true
                        }
                    ]
                );
            } else {
                match layout {
                    ConditionalLayout::Root { .. } | ConditionalLayout::NestedTest => write!(f, indent(&tail)),
                    // The `dedent` takes back the `align` of the parent, which with tabs would
                    // become an indentation of its own.
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
            if !should_extra_indent && !is_jsx_chain && self.is_parent_static_member_expression(layout) {
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

/// An operand of a conditional that has a JSX element in it. If the conditional breaks, it is in
/// parentheses, unless it is `null`, `undefined` or a conditional after the `:`.
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
    alternate: bool,
}

impl<'a> Format<'a> for FormatJsxChainExpression<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let expression = self.expression;
        let is_conditional = matches!(expression.kind(), ExprKind::Cond { .. });
        let no_wrap = match expression.kind() {
            ExprKind::Ident(name) => name.bytes() == b"undefined",
            ExprKind::Null => true,
            _ => is_conditional && self.alternate,
        };

        let format_expression = format_with(|f| match is_conditional {
            true => FormatConditionalLike {
                conditional: ConditionalLike::ConditionalExpression(expression),
                jsx_chain: true,
            }
            .fmt(f),
            false => expression.fmt(f),
        });

        if no_wrap {
            write!(f, format_expression);
        } else {
            write!(f, [if_group_breaks(&"("), soft_block_indent(&format_expression), if_group_breaks(&")")]);
        }
    }
}
