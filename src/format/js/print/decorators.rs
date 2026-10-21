use crate::js::format::format_node;
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

/// The decorators of a class, a member or a parameter, and the space or the line break after them.
pub(crate) struct FormatDecorators<'a> {
    decorators: SmallVec<[Expr<'a>; 2]>,
    /// The decorated node. For a class whose decorators come before `export`, it's the `ExportNamedDeclaration` or the
    /// `ExportDefaultDeclaration`.
    parent: AstNodes<'a>,
}

impl<'a> FormatDecorators<'a> {
    pub(crate) fn new(decorators: impl Iterator<Item = Expr<'a>>, parent: AstNodes<'a>) -> Self {
        FormatDecorators {
            decorators: decorators.collect(),
            parent,
        }
    }

    pub(crate) fn from_param(param: Param<'a>) -> Self {
        Self::new(param.decorators(), param.as_ast_nodes())
    }

    pub(crate) fn from_member(member: Member<'a>) -> Self {
        Self::new(member.decorators(), member.as_ast_nodes())
    }

    /// `@a export class B {}`, as opposed to `export @a class B {}`.
    fn are_before_export(&self) -> bool {
        (self.decorators.first()).is_some_and(|first| first.span().end <= self.parent.span().start)
    }

    /// True if one of them is followed by a line break in the source.
    fn should_expand(&self, f: &Formatter<'a>) -> bool {
        (self.decorators.iter()).any(|it| {
            f.source_text()
                .has_line_terminator_after(it.outer_span().end)
        })
    }
}

/// Only for a class member's decorators. Prettier doesn't keep them.
fn keeps_empty_lines_between_decorators(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

impl<'a> Format<'a> for FormatDecorators<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if self.decorators.is_empty() {
            return;
        }
        let decorators = || self.decorators.iter().copied().map(FormatDecorator);
        match self.parent {
            AstNodes::PropertyDefinition(_)
            | AstNodes::MethodDefinition(_)
            | AstNodes::AccessorProperty(_) => {
                return write!(
                    f,
                    group(&format_args!(
                        format_with(|f| {
                            if keeps_empty_lines_between_decorators(f) {
                                f.join_nodes_with_soft_line().entries(decorators());
                            } else {
                                f.join_with(soft_line_break_or_space())
                                    .entries(decorators());
                            }
                        }),
                        soft_line_break_or_space()
                    ))
                    .should_expand(self.should_expand(f))
                );
            }
            AstNodes::FormalParameter(_) | AstNodes::FormalParameterRest(_) => {
                write!(f, self.should_expand(f).then_some(expand_parent()));
            }
            // Prettier's `printDecoratorsBeforeExport`
            AstNodes::ExportNamedDeclaration(_) | AstNodes::ExportDefaultDeclaration(_)
                if self.are_before_export() =>
            {
                write!(f, expand_parent());
            }
            AstNodes::ExportNamedDeclaration(_) | AstNodes::ExportDefaultDeclaration(_) => {
                write!(f, hard_line_break());
            }
            _ => write!(f, expand_parent()),
        }
        f.join_with(soft_line_break_or_space())
            .entries(decorators());
        write!(f, soft_line_break_or_space());
    }
}

/// `a`, `a.b.c`
fn is_identifier_or_static_member_only(callee: Expr<'_>) -> bool {
    let mut e = callee;
    loop {
        match e.as_ast_nodes() {
            AstNodes::IdentifierReference(_) => return true,
            AstNodes::StaticMemberExpression(_) => match e.object() {
                Some(object) => e = object,
                None => return false,
            },
            _ => return false,
        }
    }
}

/// The `@e` around `e`.
#[derive(Copy, Clone)]
pub(crate) struct FormatDecorator<'a>(pub(crate) Expr<'a>);

impl Spanned for FormatDecorator<'_> {
    fn span(&self) -> Span {
        AstNodes::Decorator(self.0).span()
    }
}

impl<'a> Format<'a> for FormatDecorator<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let expression = self.0;
        let node = AstNodes::Decorator(expression);
        format_node(node, f, |f| {
            // `@a`, `@a.b`, `@a.b()` are printed bare. Anything else gets parentheses.
            let needs_parentheses = match expression.as_ast_nodes() {
                AstNodes::IdentifierReference(_) => false,
                AstNodes::CallExpression(call) => !call
                    .callee()
                    .is_some_and(is_identifier_or_static_member_only),
                AstNodes::StaticMemberExpression(member) => !member
                    .object()
                    .is_some_and(is_identifier_or_static_member_only),
                _ => true,
            };
            write!(
                f,
                [
                    "@",
                    needs_parentheses.then_some("("),
                    expression,
                    needs_parentheses.then_some(")")
                ]
            );
        });
    }
}
