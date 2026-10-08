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

    /// It is the type of the only parameter of a function:
    /// `const fn = ({ foo }: { foo: string }) => {}`.
    fn should_hug(&self, f: &Formatter<'a>) -> bool {
        let Self::TSTypeLiteral(ty, _) = *self else {
            return false;
        };
        let annotation = ty.ast_parent();
        if !matches!(annotation, AstNodes::TSTypeAnnotation(_)) {
            return false;
        }
        match annotation.parent() {
            AstNodes::FormalParameter(param) if param.default().is_none() => {
                param.func().is_some_and(|func| should_hug_function_parameters(func, false, f))
            }
            AstNodes::TSThisParameter(param) => param.func().is_some_and(|func| {
                matches!(func.as_ast_nodes(), AstNodes::Function(_)) && should_hug_function_parameters(func, false, f)
            }),
            _ => false,
        }
    }

    fn first_member_start(&self) -> Option<u32> {
        match self {
            Self::ObjectExpression(_, props) => props.first().map(|it| it.span().start),
            Self::TSTypeLiteral(_, members) => members.first().map(|it| it.span().start),
        }
    }

    fn is_inside_jsx_spread(&self) -> bool {
        matches!(
            self,
            Self::ObjectExpression(e, _)
                if matches!(e.ast_parent(), AstNodes::JSXSpreadAttribute(_) | AstNodes::JSXSpreadChild(_))
        )
    }

    fn write_members(&self, f: &mut Formatter<'a>) {
        match *self {
            Self::ObjectExpression(_, props) => {
                let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
                f.join_nodes_with_soft_line().entries_with_trailing_separator(props.iter(), ",", trailing_separator);
            }
            Self::TSTypeLiteral(_, members) => super::ts_types::write_ts_signatures(members, f),
        }
    }
}

impl<'a> Format<'a> for ObjectLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(f, "{");
        if let Some(first_member_start) = self.first_member_start() {
            // An object that has a line break after its `{` in the source stays broken.
            let should_expand = f.options().expand == Expand::Auto
                && f.source_text().contains_newline_between(self.span().start, first_member_start);
            let members = format_with(|f| self.write_members(f));
            let inner = soft_block_indent_with_maybe_space(&members, f.options().bracket_spacing.value());
            match self.should_hug(f) {
                true => write!(f, inner),
                false => write!(f, group(&inner).should_expand(should_expand)),
            }
        } else if self.is_inside_jsx_spread() {
            // `<div {...{/* comment */}} />` can stay on one line.
            write!(f, format_dangling_comments(self.span()).with_soft_block_indent());
        } else {
            write!(f, format_dangling_comments(self.span()).with_block_indent());
        }
        write!(f, "}");
    }
}
