use super::expressions::FormatObjectMember;
use super::parameters::should_hug_function_parameters;
use crate::prelude::*;
use crate::write;

/// `{ .. }`: an object literal or a type literal.
#[derive(Clone, Copy)]
pub(crate) enum ObjectLike<'a> {
    ObjectExpression(Expr<'a>, List<'a, Prop<'a>>),
    TSTypeLiteral(TypeNode<'a>, List<'a, Member<'a>>),
}

impl<'a> ObjectLike<'a> {
    fn span(&self) -> Span {
        match self {
            ObjectLike::ObjectExpression(e, _) => e.span(),
            ObjectLike::TSTypeLiteral(ty, _) => ty.span(),
        }
    }

    fn node(&self) -> AstNodes<'a> {
        match self {
            ObjectLike::ObjectExpression(e, _) => e.as_ast_nodes(),
            ObjectLike::TSTypeLiteral(ty, _) => ty.as_ast_nodes(),
        }
    }

    /// True if it's the type of a function's only parameter: `const fn = ({ foo }: { foo: string }) => {}`.
    pub(crate) fn should_hug(&self, f: &Formatter<'a>) -> bool {
        let Self::TSTypeLiteral(ty, _) = *self else {
            return false;
        };
        let annotation = ty.ast_parent();
        if !matches!(annotation, AstNodes::TSTypeAnnotation(_)) {
            return false;
        }
        match annotation.parent() {
            AstNodes::FormalParameter(param) if param.default().is_none() => param
                .func()
                .is_some_and(|func| should_hug_function_parameters(func, false, f)),
            AstNodes::TSThisParameter(param) => param.func().is_some_and(|func| {
                matches!(func.as_ast_nodes(), AstNodes::Function(_))
                    && should_hug_function_parameters(func, false, f)
            }),
            _ => false,
        }
    }

    /// `({⏎ a⏎}: {⏎ /* comment */⏎}) => {}`: in Prettier a hugged type that contains only block comments doesn't get
    /// its own group.
    fn breaks_with_pattern(&self, f: &Formatter<'a>) -> bool {
        if f.options().flavor.is_oxfmt() || f.is_quiet() {
            return false;
        }
        let comments = f.comments().of_node(self.node()).dangling;
        !comments.is_empty()
            && comments.iter().all(|comment| !comment.is_line())
            && self.should_hug(f)
    }

    fn first_member_start(&self) -> Option<u32> {
        match self {
            Self::ObjectExpression(_, props) => props.first().map(|it| it.span().start),
            Self::TSTypeLiteral(_, members) => members.first().map(|it| it.span().start),
        }
    }

    fn write_members(&self, f: &mut Formatter<'a>) {
        match *self {
            Self::ObjectExpression(_, props) => {
                let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
                let members = props.iter().map(FormatObjectMember);
                f.join_nodes_with_soft_line()
                    .entries_with_trailing_separator(members, ",", trailing_separator);
            }
            Self::TSTypeLiteral(_, members) => super::ts_types::write_ts_signatures(members, f),
        }
    }
}

impl<'a> Format<'a> for ObjectLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(f, "{");
        if let Some(first_member_start) = self.first_member_start() {
            // An object with a line break after its `{` in the source stays broken.
            let before_first = Span::new(self.span().start, first_member_start);
            let should_expand = f.options().expand == Expand::Auto
                && match f.options().flavor.is_oxfmt() {
                    true => f.source_text().contains_newline(before_first),
                    false => f.source_text().has_newline_in_range(before_first),
                };
            let members = format_with(|f| self.write_members(f));
            let inner =
                soft_block_indent_with_maybe_space(&members, f.options().bracket_spacing.value());
            match self.should_hug(f) {
                true => write!(f, inner),
                false => write!(
                    f,
                    group(&inner)
                        .should_expand(should_expand)
                        .stays_expanded(f.options().expand == Expand::Auto)
                ),
            }
        } else if self.breaks_with_pattern(f) {
            write!(f, soft_block_indent(&dangling_comments(self.node())));
        } else {
            write!(f, dangling_comments(self.node()).with_soft_block_indent());
        }
        write!(f, "}");
    }
}
