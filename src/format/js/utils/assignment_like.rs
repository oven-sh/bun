//! Everything that has a left side, an operator and a right side: `a = b`, `const a = b`, `a: b`.
//! Prettier's `printAssignment`.

use super::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use super::member_chain::is_member_call_chain;
use super::object::{FormatKey, format_computed_or_property_key, write_member_name};
use super::operators::assign_op_text;
use super::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::js::format::{ExprOptions, FormatExpr, FormatTypeAnnotation};
use crate::js::print::arrow_function_expression::FormatJsArrowFunctionExpressionOptions;
use crate::js::print::binary_like_expression::BinaryLikeExpression;
use crate::js::print::decorators::FormatDecorators;
use crate::js::print::patterns::FormatBindingPropertyValue;
use crate::js::print::sequence_expression::write_comments_before_closing_parenthesis;
use crate::js::print::type_parameters::type_arguments;
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

#[derive(Clone, Copy)]
pub(crate) enum AssignmentLike<'a> {
    VariableDeclarator(VarDecl<'a>),
    AssignmentExpression(Expr<'a>),
    ObjectProperty(Prop<'a>),
    BindingProperty(PatProp<'a>),
    PropertyDefinition(Member<'a>),
    AccessorProperty(Member<'a>),
}

/// Where an assignment breaks if it does not fit on the line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AssignmentLikeLayout {
    /// First in the right side, then after the operator.
    Fluid,
    /// First after the operator.
    BreakAfterOperator,
    /// Never after the operator.
    NeverBreakAfterOperator,
    /// The middle of `a = b = c = d`: each assignment is on its own line.
    Chain,
    /// The last assignment of such a chain.
    ChainTail,
    /// First in the left side, which is a complex destructuring pattern or type.
    BreakLeftHandSide,
    /// The last assignment of a chain, whose right side is a chain of arrow functions.
    ChainTailArrowFunction,
}

/// Prettier's `handleAssignmentLikeComments`: which of the comments between the left side, which
/// ends at `start`, and `right` trail the left side.
fn format_left_trailing_comments<'a>(start: u32, right: Expr<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return;
    }
    // A `(` after the operator can be the first token of the right side.
    let end_of_line_comments = Some(f.comments().end_of_line_comments_after_left_side(start))
        .filter(|comments| comments.last().is_none_or(|last| !last.is_moved() && last.end() <= right.span().start))
        .unwrap_or_default();
    let comments = if end_of_line_comments.is_empty() {
        let comments = f.comments().comments_before_character(start, b'=');
        if comments.iter().any(|c| c.preceded_by_newline()) { &[] } else { comments }
    } else if should_print_as_leading(right) || end_of_line_comments.last().is_some_and(|c| c.is_block()) {
        &[]
    } else {
        end_of_line_comments
    };
    FormatTrailingComments::Comments(comments).fmt(f);
}

fn should_print_as_leading(e: Expr<'_>) -> bool {
    matches!(e.tag(), ExprTag::Object | ExprTag::Array | ExprTag::Template | ExprTag::TaggedTemplate)
}

/// A name is short if it is less than this much wider than the indentation: breaking after the
/// operator would gain next to nothing.
const MIN_OVERLAP_FOR_BREAK: u8 = 3;

/// Whether all that is written for the computed `key` is one piece of text. Only such a key can be
/// short.
fn is_plain_computed_key(key: Key<'_>) -> bool {
    match key.kind() {
        KeyKind::Computed(e) => matches!(
            e.kind(),
            ExprKind::Ident(_)
                | ExprKind::This
                | ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::BigInt(_)
                | ExprKind::Regex(_)
        ),
        _ => true,
    }
}

fn has_modifier(member: Member<'_>, flag: Flags) -> bool {
    member.modifiers().iter().any(|it| it.flag() == flag)
}

/// The decorators, the modifiers, the name, `?`, `!` and the type of a property of a class.
fn write_property_definition_left<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    let node = member.as_ast_nodes();
    write!(f, FormatDecorators::of_member(member));
    for (flag, keyword) in [
        (Flags::AMBIENT, "declare"),
        (Flags::PUBLIC, "public"),
        (Flags::PROTECTED, "protected"),
        (Flags::PRIVATE, "private"),
        (Flags::STATIC, "static"),
        (Flags::ABSTRACT, "abstract"),
        (Flags::OVERRIDE, "override"),
        (Flags::READONLY, "readonly"),
        (Flags::ACCESSOR, "accessor"),
    ] {
        if has_modifier(member, flag) {
            write!(f, [keyword, space()]);
        }
    }
    if let Some(key) = member.key() {
        format_computed_or_property_key(key, node, f);
    }
    let flags = member.flags();
    write!(
        f,
        [
            flags.contains(Flags::OPTIONAL).then_some("?"),
            flags.contains(Flags::DEFINITE).then_some("!"),
            member.ty().map(FormatTypeAnnotation)
        ]
    );
}

impl<'a> AssignmentLike<'a> {
    /// Returns whether the left side is a short name.
    fn write_left(&self, f: &mut Formatter<'a>) -> bool {
        let text_width_for_break = (f.options().indent_width.value() + MIN_OVERLAP_FOR_BREAK) as usize;
        match *self {
            AssignmentLike::VariableDeclarator(declarator) => {
                let (id, ty) = (declarator.pat(), declarator.ty());
                let definite = declarator.is_definite().then_some("!");
                let Some(init) = declarator.init() else {
                    write!(f, [id, definite, ty.map(FormatTypeAnnotation)]);
                    return false;
                };
                write!(f, [FormatNodeWithoutTrailingComments(&id), definite]);
                let end = match ty {
                    Some(ty) => {
                        let type_annotation = WithSpan(FormatTypeAnnotation(ty), ty.span());
                        write!(f, FormatNodeWithoutTrailingComments(&type_annotation));
                        ty.span().end
                    }
                    None => id.span().end,
                };
                format_left_trailing_comments(end, init, f);
                false
            }
            AssignmentLike::AssignmentExpression(assignment) => {
                let (Some(target), Some(value)) = (assignment.left(), assignment.right()) else {
                    return false;
                };
                write!(f, FormatNodeWithoutTrailingComments(&target));
                format_left_trailing_comments(target.span().end, value, f);
                false
            }
            AssignmentLike::ObjectProperty(property) => match property.key() {
                _ if property.kind() == PropKind::Shorthand => {
                    write!(f, property.value());
                    false
                }
                Some(key) if key.is_computed() => {
                    write!(f, ["[", FormatKey::new(key, property.as_ast_nodes()), "]"]);
                    is_plain_computed_key(key) && f.source_text().span_width(key.span(f.file())) < text_width_for_break
                }
                Some(key) => write_member_name(key, || property.as_ast_nodes(), f) < text_width_for_break,
                None => false,
            },
            AssignmentLike::BindingProperty(property) => {
                let node = AstNodes::BindingProperty(property);
                match property.key() {
                    _ if property.is_shorthand() => {
                        write!(f, FormatBindingPropertyValue(property));
                        false
                    }
                    Some(key) if key.is_computed() => {
                        write!(f, ["[", FormatKey::new(key, node), "]"]);
                        is_plain_computed_key(key) && f.source_text().span_width(key.span(f.file())) < text_width_for_break
                    }
                    Some(key) => write_member_name(key, || node, f) < text_width_for_break,
                    None => false,
                }
            }
            AssignmentLike::PropertyDefinition(property) | AssignmentLike::AccessorProperty(property) => {
                write_property_definition_left(property, f);
                false
            }
        }
    }

    fn write_operator(&self, f: &mut Formatter<'a>) {
        match *self {
            Self::AssignmentExpression(assignment) => {
                let Some(op) = assignment.assign_op() else {
                    return;
                };
                write!(f, [space(), assign_op_text(op)]);
            }
            Self::ObjectProperty(_) | Self::BindingProperty(_) => write!(f, ":"),
            Self::VariableDeclarator(_) | Self::PropertyDefinition(_) | Self::AccessorProperty(_) => {
                write!(f, [space(), "="]);
            }
        }
    }

    /// `right`: [`AssignmentLike::get_right_expression`].
    fn write_right(&self, right: Option<Expr<'a>>, f: &mut Formatter<'a>, layout: AssignmentLikeLayout) {
        match *self {
            Self::BindingProperty(property) => write!(f, FormatBindingPropertyValue(property)),
            _ => {
                match right {
                    // Prettier's `isOnSameLineAsAssignment`.
                    Some(right)
                        if f.options().experimental_ternaries
                            && right.tag() == ExprTag::Cond
                            && layout != AssignmentLikeLayout::BreakAfterOperator
                            && !matches!(self, Self::AccessorProperty(_))
                            && !f.comments().is_type_cast_node(&right) =>
                    {
                        match super::experimental_ternary::should_break(right, f) {
                            true => write!(f, indent(&right)),
                            false => write!(f, group(&indent(&format_args!(soft_line_break(), right)))),
                        }
                    }
                    Some(right) if right.tag() == ExprTag::Fn => write!(f, with_assignment_layout(right, Some(layout))),
                    Some(right) => write!(f, right),
                    None => {}
                }
                if let Self::AssignmentExpression(assignment) = *self {
                    write_comments_before_closing_parenthesis(assignment, f);
                }
            }
        }
    }

    /// Prettier's `chooseLayout`.
    ///
    /// `right_expression`: [`AssignmentLike::get_right_expression`].
    fn layout(
        &self,
        right_expression: Option<Expr<'a>>,
        is_left_short: bool,
        left_may_break: bool,
        f: &mut Formatter<'a>,
    ) -> AssignmentLikeLayout {
        let (mut is_type_cast, mut starts_with_type_cast) = (false, false);
        if let Some(e) = right_expression {
            if let Some(layout) = self.chain_formatting_layout(e) {
                return layout;
            }
            // `a = b = c = d`
            if e.tag() == ExprTag::Assign
                && matches!(e.as_ast_nodes(), AstNodes::AssignmentExpression(_))
                && e.right().is_some_and(|value| value.tag() == ExprTag::Assign)
            {
                return AssignmentLikeLayout::BreakAfterOperator;
            }
            match leading_comments_of_right_side(e, f) {
                LeadingComments::None => {}
                LeadingComments::Break => return AssignmentLikeLayout::BreakAfterOperator,
                LeadingComments::TypeCast => is_type_cast = true,
                LeadingComments::TypeCastOfLeftEdge => starts_with_type_cast = true,
            }
            if e.tag() == ExprTag::Call
                && let AstNodes::CallExpression(call) = e.as_ast_nodes()
                && call.callee().is_some_and(|callee| callee.tag() == ExprTag::Ident && callee.text() == b"require")
            {
                return AssignmentLikeLayout::NeverBreakAfterOperator;
            }
        }

        if self.should_break_left_hand_side(left_may_break) {
            return AssignmentLikeLayout::BreakLeftHandSide;
        }
        if !is_type_cast && right_expression
                .is_some_and(|right| should_break_after_operator(right, is_left_short, starts_with_type_cast, f)) {
            return AssignmentLikeLayout::BreakAfterOperator;
        }
        if !left_may_break
            && (is_left_short
                || right_expression.is_some_and(|e| {
                    matches!(
                        e.tag(),
                        ExprTag::Class
                            | ExprTag::Template
                            | ExprTag::TaggedTemplate
                            | ExprTag::True
                            | ExprTag::False
                            | ExprTag::Number
                    )
                }))
        {
            return AssignmentLikeLayout::NeverBreakAfterOperator;
        }
        AssignmentLikeLayout::Fluid
    }

    fn get_right_expression(&self) -> Option<Expr<'a>> {
        match *self {
            AssignmentLike::VariableDeclarator(declarator) => declarator.init(),
            AssignmentLike::AssignmentExpression(assignment) => assignment.right(),
            AssignmentLike::ObjectProperty(property) => property.value(),
            AssignmentLike::PropertyDefinition(property) | AssignmentLike::AccessorProperty(property) => property.init(),
            AssignmentLike::BindingProperty(_) => None,
        }
    }

    /// There is no operator and no right side: `let a`, `{ a }`.
    fn has_only_left_hand_side(&self) -> bool {
        match *self {
            Self::AssignmentExpression(_) => false,
            Self::VariableDeclarator(declarator) => declarator.init().is_none(),
            Self::PropertyDefinition(property) | Self::AccessorProperty(property) => property.init().is_none(),
            // The value of `{ a = 1 }` includes the name.
            Self::BindingProperty(property) => property.is_shorthand(),
            Self::ObjectProperty(property) => property.kind() == PropKind::Shorthand,
        }
    }

    /// Prettier's `isAssignment` chains: `a = b = c`.
    fn chain_formatting_layout(&self, right_expression: Expr<'a>) -> Option<AssignmentLikeLayout> {
        let Self::AssignmentExpression(assignment) = *self else {
            return None;
        };
        // Anything else is in neither a declarator nor an assignment.
        match assignment.parent() {
            Node::VarDecl(_) => {}
            Node::Expr(parent) if parent.tag() == ExprTag::Assign => {}
            _ => return None,
        }
        let right_is_tail = right_expression.tag() != ExprTag::Assign;
        let parent = assignment.ast_parent();
        let upper_chain_is_eligible = match parent {
            AstNodes::VariableDeclarator(_) => !right_is_tail,
            AstNodes::AssignmentExpression(_) => {
                !right_is_tail
                    || !matches!(parent.parent(), AstNodes::ExpressionStatement(statement) if !statement.is_arrow_function_body())
            }
            _ => false,
        };
        if !upper_chain_is_eligible {
            return None;
        }
        if !right_is_tail {
            return Some(AssignmentLikeLayout::Chain);
        }
        let is_arrow_chain = right_expression.arrow_function().is_some_and(
            |arrow| matches!(arrow.body(), FnBody::Expr(body) if body.arrow_function().is_some()),
        );
        Some(match is_arrow_chain {
            true => AssignmentLikeLayout::ChainTailArrowFunction,
            false => AssignmentLikeLayout::ChainTail,
        })
    }

    fn should_break_left_hand_side(&self, left_may_break: bool) -> bool {
        if self.is_complex_destructuring() {
            return true;
        }
        let Self::VariableDeclarator(declarator) = *self else {
            return false;
        };
        declarator.ty().is_some_and(is_complex_type_annotation)
            || (left_may_break && declarator.init().is_some_and(|init| init.arrow_function().is_some()))
    }

    /// Prettier's `isComplexDestructuringTarget`: an object pattern with more than two properties,
    /// one of which has a value or a default.
    fn is_complex_destructuring(&self) -> bool {
        match *self {
            AssignmentLike::VariableDeclarator(declarator) if declarator.pat().tag() != PatTag::Object => false,
            AssignmentLike::VariableDeclarator(declarator) => match declarator.pat().kind() {
                PatKind::Object(props) => {
                    props.len() > 2
                        && props.iter().any(|property| {
                            !property.is_rest() && (!property.is_shorthand() || property.default().is_some())
                        })
                }
                _ => false,
            },
            AssignmentLike::AssignmentExpression(assignment) => match (assignment.left())
                .filter(|left| left.tag() == ExprTag::Object)
                .map(Expr::kind)
            {
                Some(ExprKind::Object(props)) => {
                    props.len() > 2
                        && props.iter().any(|property| match property.kind() {
                            PropKind::Spread => false,
                            PropKind::Shorthand => {
                                property.value().is_some_and(|value| value.tag() == ExprTag::Assign)
                            }
                            _ => true,
                        })
                }
                _ => false,
            },
            _ => false,
        }
    }
}

/// Something to format, with a span that it does not know itself.
struct WithSpan<T>(T, Span);

impl<'a, T: Format<'a>> Format<'a> for WithSpan<T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        self.0.fmt(f);
    }
}

impl<T> Spanned for WithSpan<T> {
    fn span(&self) -> Span {
        self.1
    }
}

/// What the comments before the right side of an assignment mean for its layout.
enum LeadingComments {
    None,
    /// One ends its line, or is a block whose lines all start with `*`: the right side starts on
    /// its own line.
    Break,
    /// `/** @type {T} */ (e)`: the right side is in parentheses.
    TypeCast,
    /// `/** @type {T} */ (a).b`, `/** @type {T} */ (a) || b`: what the right side starts with is.
    TypeCastOfLeftEdge,
}

fn leading_comments_of_right_side<'a>(right: Expr<'a>, f: &Formatter<'a>) -> LeadingComments {
    if f.is_quiet() {
        return LeadingComments::None;
    }
    let start = right.span().start;
    if right.tag() == ExprTag::Jsx {
        return match f.comments().is_suppressed(start) {
            true => LeadingComments::Break,
            false => LeadingComments::None,
        };
    }
    for comment in f.comments().comments_before_iter(start) {
        if comment.followed_by_newline() || comment.is_indentable_block() {
            return LeadingComments::Break;
        }
        if f.comments().is_type_cast_comment(comment) {
            return match right.is_parenthesized() {
                true => LeadingComments::TypeCast,
                false => LeadingComments::TypeCastOfLeftEdge,
            };
        }
    }
    LeadingComments::None
}

/// Prettier's `shouldBreakAfterOperator`.
fn should_break_after_operator<'a>(
    right: Expr<'a>,
    is_left_short: bool,
    starts_with_type_cast: bool,
    f: &mut Formatter<'a>,
) -> bool {
    // `None`: it is neither a binary nor a logical expression.
    let breaks_as_binary_expression = |e: Expr<'a>| match e.binary_op()? {
        BinOp::Comma => None,
        BinOp::And | BinOp::Or | BinOp::Nullish => {
            Some(!BinaryLikeExpression::new(e).is_some_and(|it| it.should_inline_logical_expression()))
        }
        _ => Some(true),
    };
    match right.tag() {
        ExprTag::Binary => breaks_as_binary_expression(right).unwrap_or(true),
        ExprTag::Cond if f.options().experimental_ternaries => {
            matches!(right.kind(), ExprKind::Cond { yes, no, .. } if yes.tag() == ExprTag::Cond || no.tag() == ExprTag::Cond)
        }
        // `/** @type {T} */ (a || b) ? c : d`: the test is in parentheses.
        ExprTag::Cond if starts_with_type_cast && right.test().is_some_and(Expr::is_parenthesized) => false,
        ExprTag::Cond => right.test().and_then(breaks_as_binary_expression).unwrap_or(false),
        ExprTag::Class => right.as_class().is_some_and(|class| class.decorators().next().is_some()),
        _ if is_left_short => false,
        _ => {
            let inner_expression = get_innermost_expression(right);
            inner_expression.tag() == ExprTag::String
                || (!starts_with_type_cast && is_poorly_breakable_member_or_call_chain(inner_expression, f))
        }
    }
}

/// The `a()` of `void !!(await a())`.
#[inline]
fn get_innermost_expression(mut current: Expr<'_>) -> Expr<'_> {
    loop {
        let inner = match current.tag() {
            ExprTag::Unary if current.unary_op().is_some_and(|op| op.is_update()) => None,
            ExprTag::Unary | ExprTag::Await | ExprTag::Yield => current.argument(),
            // All of `a?.b!` is a `ChainExpression`.
            ExprTag::NonNull if !is_chain_root(current) => current.expression(),
            _ => None,
        };
        match inner {
            Some(inner) => current = inner,
            None => return current,
        }
    }
}

impl<'a> Format<'a> for AssignmentLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if self.has_only_left_hand_side() {
            self.write_left(f);
            return;
        }

        // Whether there is a group around it all, and one around the left side, depends on the
        // layout, which depends on what is written for the left side.
        let outer_group = f.reserve_tag();
        let left_group = f.reserve_tag();
        let is_left_short = self.write_left(f);
        let left_may_break = match f.elements().get(left_group + 1..) {
            Some([FormatElement::SourceText(_)]) => false,
            _ => f.elements_from(left_group + 1).may_directly_break(),
        };
        let right_expression = self.get_right_expression();
        let layout = self.layout(right_expression, is_left_short, left_may_break, f);
        if layout != AssignmentLikeLayout::BreakLeftHandSide {
            f.group_from(left_group, false);
        }

        self.write_operator(f);

        let right = format_with(|f| self.write_right(right_expression, f, layout));
        match layout {
            AssignmentLikeLayout::Fluid => {
                let group_id = f.group_id("assignment_like");
                write!(
                    f,
                    [
                        group(&indent(&soft_line_break_or_space())).with_group_id(Some(group_id)),
                        line_suffix_boundary(),
                        indent_if_group_breaks(&right, group_id)
                    ]
                );
            }
            AssignmentLikeLayout::BreakAfterOperator => {
                write!(f, group(&soft_line_indent_or_space(&right)));
            }
            AssignmentLikeLayout::NeverBreakAfterOperator => write!(f, [space(), right]),
            // The chain starts with a line break.
            AssignmentLikeLayout::ChainTailArrowFunction => write!(f, right),
            AssignmentLikeLayout::BreakLeftHandSide => write!(f, [space(), group(&right)]),
            AssignmentLikeLayout::Chain => write!(f, [soft_line_break_or_space(), right]),
            AssignmentLikeLayout::ChainTail => write!(f, soft_line_indent_or_space(&right)),
        }

        if !matches!(
            layout,
            AssignmentLikeLayout::Chain | AssignmentLikeLayout::ChainTail | AssignmentLikeLayout::ChainTailArrowFunction
        ) {
            f.group_from(outer_group, false);
        }
    }
}

/// `expression`, which is told about the layout if it is an arrow function.
pub(crate) fn with_assignment_layout(expression: Expr<'_>, layout: Option<AssignmentLikeLayout>) -> FormatExpr<'_> {
    let options = match expression.arrow_function() {
        Some(_) => ExprOptions::Arrow(FormatJsArrowFunctionExpressionOptions {
            assignment_layout: layout,
            ..FormatJsArrowFunctionExpressionOptions::default()
        }),
        None => ExprOptions::None,
    };
    FormatExpr::with_options(expression, options)
}

/// Prettier's `isPoorlyBreakableMemberOrCallChain`: a chain that starts with a name or `this`, and
/// has no calls, or only calls with no argument or one short argument.
fn is_poorly_breakable_member_or_call_chain<'a>(expression: Expr<'a>, f: &mut Formatter<'a>) -> bool {
    if !matches!(expression.tag(), ExprTag::Call | ExprTag::Dot | ExprTag::Index | ExprTag::NonNull) {
        return false;
    }
    let threshold = f.options().line_width.value() / 4;
    let mut is_chain = false;
    let mut call_expressions: SmallVec<[Expr<'a>; 4]> = SmallVec::new();
    // Below a call. Prettier's `printMemberChain` labels such a chain a member chain however short.
    let mut has_comment_between_links = false;
    let mut current = expression;

    loop {
        current = match current.kind() {
            ExprKind::NonNull(inner) => inner,
            ExprKind::Call(call) => {
                is_chain = true;
                call_expressions.push(current);
                call.callee()
            }
            ExprKind::Dot { obj, name, .. } => {
                is_chain = true;
                // `a./* comment */ b()`: that one leads the name, which is not a link.
                has_comment_between_links |= !call_expressions.is_empty()
                    && !f.is_quiet()
                    && (f.comments().comments_in_range(obj.outer_span().end, name.span().start).iter()).any(|comment| {
                        comment.preceded_by_newline()
                            || comment.followed_by_newline()
                            || f.source_text().bytes_contain(comment.span.end, name.span().start, b'.')
                    });
                obj
            }
            ExprKind::Index { obj, .. } => {
                is_chain = true;
                obj
            }
            ExprKind::Ident(_) | ExprKind::This => break,
            _ => return false,
        };
    }
    if !is_chain {
        return false;
    }
    let Some(&first_call) = call_expressions.first() else {
        return true;
    };
    if has_comment_between_links
        || (comment_in_call_chain_makes_it_breakable(f) && f.comments().has_comment_in_span(first_call.span()))
    {
        return false;
    }
    for &call_expression in &call_expressions {
        let Some(call) = call_expression.call() else {
            continue;
        };
        let is_breakable_call = match (call.args().len(), call.args().first()) {
            (0, _) | (_, None) => false,
            (1, Some(first)) => {
                matches!(first.kind(), ExprKind::Spread(_))
                    || !is_short_argument(first, threshold, f)
                    || f.comments().has_comment_in_range(call.callee().span().end, call_expression.span().end)
            }
            _ => true,
        };
        if is_breakable_call || is_complex_type_arguments(call_expression, call.type_args(), f) {
            return false;
        }
    }
    !is_member_call_chain(first_call, f)
}

/// For oxfmt a chain with a comment anywhere in it is not poorly breakable. Prettier only looks at
/// the comments around a lone argument.
fn comment_in_call_chain_makes_it_breakable(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `isShortCallArgument`/`isLoneShortArgument`.
pub(crate) fn is_short_argument<'a>(argument: Expr<'a>, threshold: u16, f: &Formatter<'a>) -> bool {
    let threshold = threshold as usize;
    match argument.as_ast_nodes() {
        AstNodes::IdentifierReference(_) => argument.text().len() <= threshold,
        AstNodes::UnaryExpression(_) => {
            argument.argument().is_some_and(|operand| is_short_argument(operand, threshold as u16, f))
        }
        AstNodes::RegExpLiteral(_) => matches!(argument.kind(), ExprKind::Regex(regex) if regex.pattern().len() <= threshold),
        AstNodes::StringLiteral(_) => {
            FormatLiteralStringToken::new(argument.text(), false, StringLiteralParentKind::Expression)
                .clean_text(f)
                .width()
                <= threshold
        }
        AstNodes::TemplateLiteral(_) => matches!(argument.kind(), ExprKind::Template(template) if {
            let raw = template.raw(0);
            template.quasi_count() == 1 && raw.len() <= threshold && bun_core::strings::index_of_any(raw, b"\r\n").is_none()
        }),
        AstNodes::CallExpression(_) => argument.call().is_some_and(|call| {
            let callee = call.callee();
            call.args().is_empty()
                && matches!(callee.kind(), ExprKind::Ident(_))
                && callee.text().len() <= threshold.saturating_sub(2)
        }),
        AstNodes::ThisExpression(_)
        | AstNodes::NullLiteral(_)
        | AstNodes::BigIntLiteral(_)
        | AstNodes::BooleanLiteral(_)
        | AstNodes::NumericLiteral(_) => true,
        _ => false,
    }
}

/// Prettier's `isComplexTypeArguments`, for the type arguments of the call `owner`.
fn is_complex_type_arguments<'a>(owner: Expr<'a>, params: List<'a, TypeNode<'a>>, f: &mut Formatter<'a>) -> bool {
    let Some(span) = params.angle_brackets_span() else {
        return false;
    };
    if params.len() > 1 {
        return true;
    }
    if params
        .first()
        .is_some_and(|param| matches!(param.kind(), TypeKind::Union(_) | TypeKind::Intersection(_) | TypeKind::Object(_)))
    {
        return true;
    }
    f.speculate_will_break(&WithSpan(type_arguments(params, Node::Expr(owner)), span))
}

/// Prettier's `isComplexTypeAnnotation`: `A<B<C>, D>`.
pub(crate) fn is_complex_type_annotation(ty: TypeNode<'_>) -> bool {
    let TypeKind::Ref { args, .. } = ty.kind() else {
        return false;
    };
    args.len() > 1
        && args.iter().any(|argument| match argument.kind() {
            TypeKind::Cond { .. } => true,
            TypeKind::Ref { args, .. } => !args.is_empty(),
            _ => false,
        })
}
