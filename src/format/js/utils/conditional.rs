//! `a ? b : c` and `A extends B ? C : D`. Prettier's `printTernary`.

use super::typecast::is_cast_target_that_hides_its_kind;
use crate::js::format::format_node;
use crate::js::print::binary_like_expression::is_angular_pipe;
use crate::prelude::*;
use crate::write;

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
        let no_wrap = match expression.kind() {
            ExprKind::Ident(name) => name.bytes() == b"undefined",
            ExprKind::Null => true,
            _ => is_conditional && self.is_alternate,
        };

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
