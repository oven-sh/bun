use super::parameters::should_hug_function_parameters;
use crate::prelude::*;
use crate::write;

/// `{ a, b: c }` that is destructured into: a pattern, or the target of an assignment.
pub(crate) enum ObjectPatternLike<'a> {
    ObjectPattern(Pat<'a>, List<'a, PatProp<'a>>),
    ObjectAssignmentTarget(Expr<'a>, List<'a, Prop<'a>>),
}

impl Spanned for ObjectPatternLike<'_> {
    fn span(&self) -> Span {
        match self {
            Self::ObjectPattern(pat, _) => pat.span(),
            Self::ObjectAssignmentTarget(e, _) => e.span(),
        }
    }
}

impl<'a> ObjectPatternLike<'a> {
    fn is_empty(&self) -> bool {
        match self {
            Self::ObjectPattern(_, props) => props.is_empty(),
            Self::ObjectAssignmentTarget(_, props) => props.is_empty(),
        }
    }

    fn parent(&self) -> AstNodes<'a> {
        match self {
            Self::ObjectPattern(pat, _) => pat.ast_parent(),
            Self::ObjectAssignmentTarget(e, _) => e.ast_parent(),
        }
    }

    fn is_inline(&self) -> bool {
        let parent = self.parent();
        matches!(self, Self::ObjectPattern(..))
            && match parent {
                AstNodes::FormalParameter(_) => true,
                AstNodes::AssignmentPattern(_) => matches!(parent.parent(), AstNodes::FormalParameter(_)),
                _ => false,
            }
    }

    /// It is the only parameter of a function, and breaks instead of the parentheses.
    fn is_hugged_parameter(&self, f: &Formatter<'a>) -> bool {
        matches!(self.parent(), AstNodes::FormalParameter(param)
            if param.func().is_some_and(|func| should_hug_function_parameters(func, false, f)))
    }

    /// Prettier's `shouldBreak` for patterns: a property has a pattern as its value. Not in a
    /// parameter of a function, unless that is only a signature.
    fn should_break_properties(&self) -> bool {
        match self {
            Self::ObjectPattern(_, props) => {
                let is_exempt = match self.parent() {
                    AstNodes::CatchParameter(_) | AstNodes::AssignmentPattern(_) => true,
                    AstNodes::FormalParameter(param) => {
                        param.default().is_some() || param.func().is_none_or(|func| func.has_body())
                    }
                    _ => false,
                };
                !is_exempt && props.iter().any(|property| {
                    !property.is_rest()
                        && property.default().is_none()
                        && matches!(property.value().kind(), PatKind::Object(_) | PatKind::Array(_))
                })
            }
            Self::ObjectAssignmentTarget(_, props) => props.iter().any(|property| {
                property.kind() == PropKind::Init
                    && (property.value())
                        .is_some_and(|it| matches!(it.kind(), ExprKind::Object(_) | ExprKind::Array(_)) && is_assignment_target(it))
            }),
        }
    }

    fn is_in_assignment_like(&self) -> bool {
        match self {
            Self::ObjectPattern(..) => matches!(self.parent(), AstNodes::VariableDeclarator(_)),
            Self::ObjectAssignmentTarget(..) => {
                matches!(self.parent(), AstNodes::AssignmentExpression(_) | AstNodes::VariableDeclarator(_))
            }
        }
    }

    fn layout(&self, f: &Formatter<'a>) -> ObjectPatternLayout {
        if self.is_empty() {
            ObjectPatternLayout::Empty
        } else if self.should_break_properties() {
            match self.is_hugged_parameter(f) {
                true => ObjectPatternLayout::Inline,
                false => ObjectPatternLayout::Group { expand: true },
            }
        } else if self.is_inline() || self.is_in_assignment_like() {
            ObjectPatternLayout::Inline
        } else {
            ObjectPatternLayout::Group { expand: false }
        }
    }

    fn write_properties(&self, f: &mut Formatter<'a>) {
        // Nothing can follow a rest element, not even a comma.
        let has_trailing_rest = match self {
            Self::ObjectPattern(_, props) => props.last().is_some_and(PatProp::is_rest),
            Self::ObjectAssignmentTarget(_, props) => props.last().is_some_and(|it| it.kind() == PropKind::Spread),
        };
        let trailing_separator = match has_trailing_rest {
            true => TrailingSeparator::Disallowed,
            false => FormatTrailingCommas::ES5.trailing_separator(f.options()),
        };
        let mut join = f.join_nodes_with_soft_line();
        match self {
            Self::ObjectPattern(_, props) => {
                join.entries_with_trailing_separator(props.iter(), ",", trailing_separator);
            }
            Self::ObjectAssignmentTarget(_, props) => {
                join.entries_with_trailing_separator(props.iter(), ",", trailing_separator);
            }
        }
    }
}

impl<'a> Format<'a> for ObjectPatternLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let should_insert_space_around_brackets = f.options().bracket_spacing.value();
        let format_properties = format_with(|f| {
            write!(
                f,
                soft_block_indent_with_maybe_space(
                    &format_with(|f| self.write_properties(f)),
                    should_insert_space_around_brackets
                )
            );
        });

        write!(f, "{");
        match self.layout(f) {
            ObjectPatternLayout::Empty => write!(f, format_dangling_comments(self.span()).with_soft_block_indent()),
            ObjectPatternLayout::Inline => write!(f, format_properties),
            ObjectPatternLayout::Group { expand } => write!(f, group(&format_properties).should_expand(expand)),
        }
        write!(f, "}");
    }
}

#[derive(Debug, Copy, Clone)]
enum ObjectPatternLayout {
    /// The properties are a group.
    Group { expand: bool },
    /// There are none.
    Empty,
    /// The properties break with what the pattern is in: it is a parameter, or the left side of an
    /// assignment.
    Inline,
}
