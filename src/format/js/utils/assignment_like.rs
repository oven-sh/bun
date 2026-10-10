//! Everything that has a left side, an operator and a right side: `a = b`, `const a = b`, `a: b`.
//! Prettier's `printAssignment`.

use super::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use super::member_chain::is_member_call_chain;
use super::object::{FormatKey, format_computed_or_property_key, write_member_name};
use super::operators::assign_op_text;
use super::string::{FormatLiteralStringToken, StringLiteralParentKind};
use super::suppressed::FormatSuppressedNode;
use super::typecast::is_cast_target;
use crate::js::format::{ExprOptions, FormatExpr, FormatTypeAnnotation};
use crate::js::parentheses::expression::expression_needs_parentheses;
use crate::js::print::arrow_function_expression::FormatJsArrowFunctionExpressionOptions;
use crate::js::print::binary_like_expression::BinaryLikeExpression;
use crate::js::print::decorators::FormatDecorators;
use crate::js::print::expressions::unary_argument_has_comments;
use crate::js::print::jsx::ignored_jsx_gets_no_parentheses;
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

/// The comments between the left side, which is written and ends at `start`, and `right` that trail
/// the left side.
fn format_left_trailing_comments<'a>(start: u32, right: Expr<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return;
    }
    match comments_stay_around_operator(f) {
        true => write_comments_before_operator(start, f),
        false => FormatTrailingComments::Comments(
            f.comments().comments_trailing_left_side(right.span().start),
        )
        .fmt(f),
    }
}

/// See [`comments_stay_around_operator`]: the comments after the left side, which ends at `start`, that
/// trail it. Those behind the operator are hidden.
pub(crate) fn write_comments_before_operator(start: u32, f: &mut Formatter<'_>) {
    let end_of_line_comments = f.comments().end_of_line_comments_after(start);
    let comments = if end_of_line_comments.is_empty() {
        let comments = f.comments().comments_before_character(start, b'=');
        if comments.iter().any(|comment| comment.preceded_by_newline()) {
            &[]
        } else {
            comments
        }
    } else if end_of_line_comments
        .last()
        .is_some_and(|comment| comment.is_multiline_block())
    {
        &[]
    } else {
        end_of_line_comments
    };
    FormatTrailingComments::Comments(comments).fmt(f);
}

/// For oxfmt a comment stays on the side of the `=` or the `:` that it is on, and a line comment on
/// the line of the operator stays there, with what follows on the next line. Prettier attaches it to
/// one of the two sides, and writes it where the line ends that this side ends on.
///
/// ```js
/// const a = // comment      const a = 1; // comment
///   1;
/// ```
pub(crate) fn comments_stay_around_operator(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// The comments behind the operator, which ends at `operator_end`, up to a line comment that ends its
/// line. None if a comment from before the operator is left: then all lead the right side.
pub(crate) fn operator_line_run<'a>(operator_end: u32, f: &Formatter<'a>) -> &'a [Comment] {
    if f.comments().has_comment_before(operator_end) {
        return &[];
    }
    let run = f.comments().end_of_line_comments_after(operator_end);
    if run.last().is_some_and(|comment| comment.is_line()) {
        run
    } else {
        &[]
    }
}

/// A name is short if it is less than this much wider than the indentation: breaking after the
/// operator would gain next to nothing.
const MIN_OVERLAP_FOR_BREAK: u8 = 3;

/// The width of what is written for the computed `key`, with its brackets, if that is one piece of
/// text: there is no group in it and nothing that can break. Only such a key can be short. Prettier
/// asks whether `cleanDoc(keyDoc)` is a string.
///
/// oxfmt takes what is written in the brackets, whatever it is, without the comments around it.
fn computed_key_width<'a>(key: Key<'a>, f: &Formatter<'a>) -> Option<usize> {
    if f.options().flavor.is_oxfmt() {
        return Some(f.source_text().span_width(key.inner_span(f.file())) + 2);
    }
    let span = key.span(f.file());
    if let KeyKind::Computed(e) = key.kind() {
        // A comment in the brackets is a piece of its own.
        let inner = e.outer_span();
        let is_blank = |start: u32, end: u32| {
            (f.source_text().text_for(&Span::new(start.min(end), end)))
                .trim_ascii()
                .is_empty()
        };
        return (is_blank(span.start + 1, inner.start)
            && is_blank(inner.end, span.end.saturating_sub(1)))
        .then(|| plain_expression_width(e, f))?
        .map(|width| width + 2);
    }
    // A template is written with a `lineSuffixBoundary`.
    let is_template = f
        .source_text()
        .text_for(&span)
        .get(1..)
        .is_some_and(|it| it.trim_ascii_start().starts_with(b"`"));
    (!is_template).then(|| f.source_text().span_width(span))
}

/// See [`computed_key_width`]: `a`, `1`, `-1`, `!a`, `typeof a`, `a++`, `a!`, `await a`, `a as T`,
/// `a<T>`. Not `a.b`, `a()`, `` `a` ``, `[]`.
fn plain_expression_width<'a>(e: Expr<'a>, f: &Formatter<'a>) -> Option<usize> {
    let mut width = 0;
    let mut current = e;
    loop {
        if current != e && expression_needs_parentheses(current, f) {
            width += 2;
        }
        current = match current.kind() {
            ExprKind::Ident(_)
            | ExprKind::This
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_) => {
                return Some(width + f.source_text().span_width(current.span()));
            }
            ExprKind::ImportMeta => return Some(width + "import.meta".len()),
            ExprKind::NewTarget => return Some(width + "new.target".len()),
            // An operand with comments is in a group.
            ExprKind::Unary { operand, .. } if unary_argument_has_comments(current, operand, f) => {
                return None;
            }
            ExprKind::Unary { op, operand } => {
                width += op.as_str().len() + usize::from(op.is_keyword());
                operand
            }
            ExprKind::NonNull(inner) => {
                width += current.non_null_count();
                inner
            }
            ExprKind::Await(argument) => {
                width += "await ".len();
                argument
            }
            ExprKind::As { .. } | ExprKind::AsConst(_) if current.is_angle_bracket_assertion() => {
                return None;
            }
            ExprKind::AsConst(inner) => {
                width += " as const".len();
                inner
            }
            ExprKind::As { expr, ty } => {
                width += " as ".len() + plain_type_width(ty, f)?;
                expr
            }
            ExprKind::Satisfies { expr, ty } => {
                width += " satisfies ".len() + plain_type_width(ty, f)?;
                expr
            }
            ExprKind::Instantiation { expr, type_args } => {
                width += plain_type_arguments_width(type_args, f)?;
                expr
            }
            _ => return None,
        };
    }
}

/// See [`computed_key_width`]: `any`, `"a"`, `A.B`, `A<B>`, `A[]`, `A[B]`, `keyof A`, `typeof a`. Not
/// `A | B`, `[A]`, `{}`, `` `a` ``. The width is that of the type as it is written.
fn plain_type_width<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> Option<usize> {
    let mut rest: SmallVec<[TypeNode<'a>; 4]> = SmallVec::new();
    rest.push(ty);
    while let Some(current) = rest.pop() {
        match current.kind() {
            TypeKind::Array(inner) | TypeKind::Keyof(inner) | TypeKind::Readonly(inner) => {
                rest.push(inner)
            }
            TypeKind::IndexedAccess { obj, index } => rest.extend([obj, index]),
            TypeKind::UniqueSymbol => {}
            TypeKind::Ref { args, .. }
            | TypeKind::Typeof { args, .. }
            | TypeKind::Import { args, .. }
                if !args.is_empty() =>
            {
                plain_type_arguments_width(args, f)?;
            }
            TypeKind::Typeof { .. } | TypeKind::Import { .. } => {}
            _ => {
                name_or_literal_type_width(current, f)?;
            }
        }
    }
    Some(f.source_text().span_width(ty.span()))
}

/// `<A>`: one type argument that is a name, a keyword or a literal is written without a group.
fn plain_type_arguments_width<'a>(
    arguments: List<'a, TypeNode<'a>>,
    f: &Formatter<'a>,
) -> Option<usize> {
    match (arguments.len(), arguments.first()) {
        (1, Some(only)) => Some(name_or_literal_type_width(only, f)? + 2),
        _ => None,
    }
}

fn name_or_literal_type_width<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> Option<usize> {
    let is_name_or_literal = match ty.kind() {
        TypeKind::Keyword(_)
        | TypeKind::NumberLit(_)
        | TypeKind::BigIntLit { .. }
        | TypeKind::BoolLit(_) => true,
        TypeKind::StringLit(_) => !f.source_text().text_for(&ty.span()).starts_with(b"`"),
        TypeKind::Ref { args, .. } => args.is_empty(),
        _ => false,
    };
    is_name_or_literal.then(|| f.source_text().span_width(ty.span()))
}

/// The decorators, the modifiers, the name, `?`, `!` and the type of a property of a class.
fn write_property_definition_left<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    let modifiers = member.modifiers();
    if !modifiers.is_empty() {
        write!(f, FormatDecorators::of_member(member));
        let written = modifiers
            .iter()
            .fold(Flags::empty(), |all, it| all | it.flag());
        for (flag, keyword) in [
            (Flags::AMBIENT, "declare "),
            (Flags::PUBLIC, "public "),
            (Flags::PROTECTED, "protected "),
            (Flags::PRIVATE, "private "),
            (Flags::STATIC, "static "),
            (Flags::ABSTRACT, "abstract "),
            (Flags::OVERRIDE, "override "),
            (Flags::READONLY, "readonly "),
            (Flags::ACCESSOR, "accessor "),
        ] {
            if written.contains(flag) {
                write!(f, keyword);
            }
        }
        if written.intersects(Flags::IN | Flags::OUT) {
            crate::js::print::flow::write_variance_sign(modifiers, f);
        }
    }
    match member.key() {
        Some(key) if key.is_computed() => {
            format_computed_or_property_key(key, member.as_ast_nodes(), f)
        }
        Some(key) => {
            write_member_name(key, || member.as_ast_nodes(), f);
        }
        None => {}
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

/// A left side that is a name without comments. See [`AssignmentLike::name_on_the_left`].
#[derive(Copy, Clone)]
enum NameOnTheLeft<'a> {
    /// It is written as it is in the source.
    At(Span),
    /// What is assigned to, which can need parentheses.
    Target(Expr<'a>),
}

impl<'a> Format<'a> for NameOnTheLeft<'a> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        match *self {
            NameOnTheLeft::At(span) => write!(f, source_text(span)),
            NameOnTheLeft::Target(target) => write!(f, target),
        }
    }
}

impl<'a> AssignmentLike<'a> {
    /// What [`AssignmentLike::write_left`] writes and returns, if that is only a name and can be told
    /// without writing it.
    fn name_on_the_left(&self, f: &Formatter<'a>) -> Option<(NameOnTheLeft<'a>, bool)> {
        if !f.is_quiet() {
            return None;
        }
        let key = match *self {
            AssignmentLike::VariableDeclarator(declarator) => {
                let id = declarator.pat();
                let is_name = id.tag() == PatTag::Ident
                    && declarator.ty().is_none()
                    && !declarator.is_definite();
                return is_name.then(|| (NameOnTheLeft::At(id.span()), false));
            }
            AssignmentLike::AssignmentExpression(assignment) => {
                let target = assignment
                    .left()
                    .filter(|target| target.tag() == ExprTag::Ident)?;
                return Some((NameOnTheLeft::Target(target), false));
            }
            AssignmentLike::ObjectProperty(property) => property.key()?,
            AssignmentLike::BindingProperty(property) => property.key()?,
            AssignmentLike::PropertyDefinition(_) | AssignmentLike::AccessorProperty(_) => {
                return None;
            }
        };
        if !matches!(key.kind(), KeyKind::Ident(_)) || f.options().quote_properties.is_consistent()
        {
            return None;
        }
        let span = key.span(f.file());
        let text_width_for_break =
            u32::from(f.options().indent_width.value() + MIN_OVERLAP_FOR_BREAK);
        // No text is wider than it is long.
        let is_short = span.len() < text_width_for_break
            || f.string_width(f.source_text().text_for(&span)) < text_width_for_break;
        Some((NameOnTheLeft::At(span), is_short))
    }

    /// Returns whether the left side is a short name.
    fn write_left(&self, f: &mut Formatter<'a>) -> bool {
        let text_width_for_break =
            (f.options().indent_width.value() + MIN_OVERLAP_FOR_BREAK) as usize;
        match *self {
            AssignmentLike::VariableDeclarator(declarator) => {
                let (id, ty) = (declarator.pat(), declarator.ty());
                let definite = declarator.is_definite().then_some("!");
                let Some(init) = declarator.init() else {
                    write!(f, [id, definite, ty.map(FormatTypeAnnotation)]);
                    return false;
                };
                match ty {
                    // `a: T = // prettier-ignore`: the comment trails the name, which the type is part of.
                    Some(ty)
                        if !f.is_quiet()
                            && f.comments().has_trailing_suppression_comment(ty.span().end) =>
                    {
                        let span = Span::new(id.span().start, ty.span().end);
                        write!(
                            f,
                            [format_leading_comments(span), FormatSuppressedNode(span)]
                        );
                    }
                    Some(ty) => {
                        let type_annotation = WithSpan(FormatTypeAnnotation(ty), ty.span());
                        write!(f, [FormatNodeWithoutTrailingComments(&id), definite]);
                        write!(f, FormatNodeWithoutTrailingComments(&type_annotation));
                    }
                    None => write!(f, [FormatNodeWithoutTrailingComments(&id), definite]),
                }
                format_left_trailing_comments(id.span().end, init, f);
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
                    computed_key_width(key, f).is_some_and(|width| width < text_width_for_break)
                }
                Some(key) => {
                    write_member_name(key, || property.as_ast_nodes(), f) < text_width_for_break
                }
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
                        computed_key_width(key, f).is_some_and(|width| width < text_width_for_break)
                    }
                    Some(key) => write_member_name(key, || node, f) < text_width_for_break,
                    None => false,
                }
            }
            AssignmentLike::PropertyDefinition(property)
            | AssignmentLike::AccessorProperty(property) => {
                write_property_definition_left(property, f);
                false
            }
        }
    }

    fn write_operator(&self, f: &mut Formatter<'a>) {
        match *self {
            Self::AssignmentExpression(assignment) => match assignment.assign_op() {
                Some(None) => write!(f, " ="),
                Some(op) => write!(f, [space(), assign_op_text(op)]),
                None => {}
            },
            Self::ObjectProperty(_) | Self::BindingProperty(_) => write!(f, ":"),
            Self::VariableDeclarator(_)
            | Self::PropertyDefinition(_)
            | Self::AccessorProperty(_) => write!(f, " ="),
        }
    }

    /// `right`: [`AssignmentLike::get_right_expression`].
    /// `fluid_group_id`: in the fluid layout, of the group with the line break after the operator.
    fn write_right(
        &self,
        right: Option<Expr<'a>>,
        f: &mut Formatter<'a>,
        layout: AssignmentLikeLayout,
        fluid_group_id: Option<GroupId>,
    ) {
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
                            && !is_cast_target(right, f) =>
                    {
                        match super::experimental_ternary::should_break(right, f) {
                            true => write!(f, indent(&right)),
                            false => {
                                // Behind the line break after the operator, Prettier's `softline` is
                                // a second one.
                                let line_break = format_with(|f| match fluid_group_id {
                                    Some(_) => write!(
                                        f,
                                        [
                                            if_group_breaks(&soft_empty_line())
                                                .with_group_id(fluid_group_id),
                                            if_group_fits_on_line(&soft_line_break())
                                                .with_group_id(fluid_group_id)
                                        ]
                                    ),
                                    // The chain is broken if this group is.
                                    None if layout == AssignmentLikeLayout::ChainTail => {
                                        write!(f, soft_empty_line())
                                    }
                                    None => write!(f, soft_line_break()),
                                });
                                write!(f, group(&indent(&format_args!(line_break, right))));
                            }
                        }
                    }
                    Some(right) if right.tag() == ExprTag::Fn && !is_cast_target(right, f) => {
                        write!(f, with_assignment_layout(right, Some(layout)));
                    }
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
        // For Prettier the right side is a `ParenthesizedExpression` then, whatever is in it.
        let is_type_cast = right_expression.is_some_and(|e| is_cast_target(e, f));
        let mut starts_with_type_cast = false;
        if let Some(e) = right_expression {
            if let Some(layout) = self.chain_formatting_layout(e, is_type_cast, f) {
                return layout;
            }
            // `a = b = c = d`
            if e.tag() == ExprTag::Assign
                && !is_type_cast
                && matches!(e.as_ast_nodes(), AstNodes::AssignmentExpression(_))
                && e.right().is_some_and(|value| {
                    value.tag() == ExprTag::Assign && !is_cast_target(value, f)
                })
            {
                return AssignmentLikeLayout::BreakAfterOperator;
            }
            match leading_comments_of_right_side(e, f) {
                LeadingComments::None | LeadingComments::TypeCast => {}
                LeadingComments::Break => return AssignmentLikeLayout::BreakAfterOperator,
                LeadingComments::TypeCastOfLeftEdge => starts_with_type_cast = true,
            }
            if e.tag() == ExprTag::Call
                && !is_type_cast
                && let AstNodes::CallExpression(call) = e.as_ast_nodes()
                && call.callee().is_some_and(|callee| {
                    callee.tag() == ExprTag::Ident && callee.text() == b"require"
                })
            {
                return AssignmentLikeLayout::NeverBreakAfterOperator;
            }
        }
        // The right side of a property of a pattern is not an expression.
        if let Self::BindingProperty(property) = *self
            && !f.is_quiet()
            && (f
                .comments()
                .comments_before_iter(property.value().span().start))
            .any(|comment| comment.followed_by_newline() || comment.is_indentable_block())
        {
            return AssignmentLikeLayout::BreakAfterOperator;
        }

        if self.should_break_left_hand_side(left_may_break && !is_type_cast) {
            return AssignmentLikeLayout::BreakLeftHandSide;
        }
        if !is_type_cast
            && right_expression.is_some_and(|right| {
                should_break_after_operator(right, is_left_short, starts_with_type_cast, f)
            })
        {
            return AssignmentLikeLayout::BreakAfterOperator;
        }
        if !left_may_break
            && (is_left_short
                || right_expression.is_some_and(|e| {
                    !is_type_cast
                        && matches!(
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
            AssignmentLike::PropertyDefinition(property)
            | AssignmentLike::AccessorProperty(property) => property.init(),
            AssignmentLike::BindingProperty(_) => None,
        }
    }

    /// There is no operator and no right side: `let a`, `{ a }`.
    fn has_only_left_hand_side(&self) -> bool {
        match *self {
            Self::AssignmentExpression(_) => false,
            Self::VariableDeclarator(declarator) => declarator.init().is_none(),
            Self::PropertyDefinition(property) | Self::AccessorProperty(property) => {
                property.init().is_none()
            }
            // The value of `{ a = 1 }` includes the name.
            Self::BindingProperty(property) => property.is_shorthand(),
            Self::ObjectProperty(property) => property.kind() == PropKind::Shorthand,
        }
    }

    /// Prettier's `isAssignment` chains: `a = b = c`.
    ///
    /// `is_type_cast`: whether `right_expression` is in the parentheses of a type cast.
    fn chain_formatting_layout(
        &self,
        right_expression: Expr<'a>,
        is_type_cast: bool,
        f: &Formatter<'a>,
    ) -> Option<AssignmentLikeLayout> {
        let Self::AssignmentExpression(assignment) = *self else {
            return None;
        };
        if is_cast_target(assignment, f) {
            return None;
        }
        // Anything else is in neither a declarator nor an assignment.
        match assignment.parent() {
            Node::VarDecl(_) => {}
            Node::Expr(parent) if parent.tag() == ExprTag::Assign => {}
            _ => return None,
        }
        let right_is_tail = is_type_cast || right_expression.tag() != ExprTag::Assign;
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
        let is_arrow_chain = !is_type_cast
            && right_expression.arrow_function().is_some_and(|arrow| {
                matches!(arrow.body(), FnBody::Expr(body) if body.arrow_function().is_some() && !is_cast_target(body, f))
            });
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
            || (left_may_break
                && declarator
                    .init()
                    .is_some_and(|init| init.arrow_function().is_some()))
    }

    /// Prettier's `isComplexDestructuringTarget`: an object pattern with more than two properties,
    /// one of which has a value or a default.
    fn is_complex_destructuring(&self) -> bool {
        match *self {
            AssignmentLike::VariableDeclarator(declarator)
                if declarator.pat().tag() != PatTag::Object =>
            {
                false
            }
            AssignmentLike::VariableDeclarator(declarator) => match declarator.pat().kind() {
                PatKind::Object(props) => {
                    props.len() > 2
                        && props.iter().any(|property| {
                            !property.is_rest()
                                && (!property.is_shorthand() || property.default().is_some())
                        })
                }
                _ => false,
            },
            AssignmentLike::AssignmentExpression(assignment) => match (assignment.left())
                .filter(|left| left.tag() == ExprTag::Object && is_assignment_target(*left))
                .map(Expr::kind)
            {
                Some(ExprKind::Object(props)) => {
                    props.len() > 2
                        && props.iter().any(|property| match property.kind() {
                            PropKind::Spread => false,
                            PropKind::Shorthand => property
                                .value()
                                .is_some_and(|value| value.tag() == ExprTag::Assign),
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

/// `a = /** @type {T} */ (⏎/**⏎ * comment⏎ */⏎b)`: oxfmt looks at all comments before `b`.
fn block_comment_in_parentheses_of_cast_breaks(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `a =⏎// comment⏎b?.c` is `a = // comment⏎b?.c` in TypeScript: typescript-estree has a `ChainExpression` around
/// `b?.c`, which Prettier attaches no comment to. The comment leads what is in it, and the right side has none.
fn comments_lead_what_is_in_chain_expression<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    is_chain_root(e) && !f.context().has_tree_of_babel() && !f.options().flavor.is_oxfmt()
}

fn leading_comments_of_right_side<'a>(right: Expr<'a>, f: &Formatter<'a>) -> LeadingComments {
    if f.is_quiet() || comments_lead_what_is_in_chain_expression(right, f) {
        return LeadingComments::None;
    }
    let start = right.span().start;
    if right.tag() == ExprTag::Jsx {
        return match f.comments().is_suppressed(start) && ignored_jsx_gets_no_parentheses(f) {
            true => LeadingComments::Break,
            false => LeadingComments::None,
        };
    }
    if block_comment_in_parentheses_of_cast_breaks(f)
        && (f.comments().comments_before_iter(start)).any(|comment| comment.is_indentable_block())
    {
        return LeadingComments::Break;
    }
    for comment in f.comments().comments_before_iter(start) {
        if comment.leads_left_edge_of(right.span()) {
            continue;
        }
        if comment.followed_by_newline() || comment.is_indentable_block() {
            return LeadingComments::Break;
        }
        // `/** @type {T} */ a.b()` casts nothing.
        if f.comments().is_type_cast_comment(comment)
            && f.source_text()
                .next_non_whitespace_byte_is(comment.end(), b'(')
        {
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
        BinOp::And | BinOp::Or | BinOp::Nullish => Some(
            !BinaryLikeExpression::new(e).is_some_and(|it| it.should_inline_logical_expression(f)),
        ),
        _ => Some(true),
    };
    match right.tag() {
        ExprTag::Binary => breaks_as_binary_expression(right).unwrap_or(true),
        ExprTag::Cond if f.options().experimental_ternaries => {
            matches!(right.kind(), ExprKind::Cond { yes, no, .. } if yes.tag() == ExprTag::Cond || no.tag() == ExprTag::Cond)
        }
        // `/** @type {T} */ (a || b) ? c : d`: the test is in parentheses.
        ExprTag::Cond
            if starts_with_type_cast
                && right.test().is_some_and(|test| is_cast_target(test, f)) =>
        {
            false
        }
        ExprTag::Cond => right
            .test()
            .and_then(breaks_as_binary_expression)
            .unwrap_or(false),
        ExprTag::Class => right
            .as_class()
            .is_some_and(|class| class.decorators().next().is_some()),
        _ if is_left_short => false,
        _ => {
            let inner_expression = get_innermost_expression(right, f);
            (inner_expression.tag() == ExprTag::String && !is_cast_target(inner_expression, f))
                || (!starts_with_type_cast
                    && is_poorly_breakable_member_or_call_chain(inner_expression, f))
        }
    }
}

/// The `a()` of `void !!(await a())`.
#[inline]
fn get_innermost_expression<'a>(mut current: Expr<'a>, f: &Formatter<'a>) -> Expr<'a> {
    loop {
        let inner = match current.tag() {
            _ if is_cast_target(current, f) => None,
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

        let right_expression = self.get_right_expression();
        if let Some((name, is_short)) = self.name_on_the_left(f) {
            let layout = self.layout(right_expression, is_short, false, f);
            let content = format_with(|f| {
                write!(f, name);
                self.write_operator(f);
                self.write_after_operator(right_expression, layout, f);
            });
            return match layout.has_group_around_it(true) {
                true => write!(f, group(&content)),
                false => write!(f, content),
            };
        }

        // Whether there is a group around it all, and one around the left side, depends on the
        // layout, which depends on what is written for the left side.
        let outer_group = f.reserve_tag();
        let left_group = f.reserve_tag();
        // See `comments_stay_around_operator`. Where the left side ends, the right side starts and the
        // operator ends.
        let sides = match !f.is_quiet() && comments_stay_around_operator(f) {
            true => self.sides_with_comments_between(right_expression, f),
            false => None,
        };
        let previous_limit =
            sides.map(|(_, _, operator_end)| f.comments_mut().limit_comments_up_to(operator_end));
        let is_left_short = self.write_left(f);
        if let Some(previous_limit) = previous_limit {
            f.comments_mut().restore_view_limit(previous_limit);
        }
        let operator_line_run = sides.map_or(&[][..], |(_, _, operator_end)| {
            operator_line_run(operator_end, f)
        });
        let has_line_comment_on_operator_line = !operator_line_run.is_empty()
            || sides.is_some_and(|(left_end, ..)| {
                f.comments().has_printed_line_comment_after(left_end)
            });
        let left = f.elements().get(left_group + 1..).unwrap_or_default();
        let is_left_text = left.len() <= 12 && left.iter().all(is_text_on_one_line);
        let left_may_break = !is_left_text
            && f.elements_from(left_group + 1)
                .may_directly_break(f.options().flavor);
        let layout = match self.layout(right_expression, is_left_short, left_may_break, f) {
            AssignmentLikeLayout::Fluid | AssignmentLikeLayout::NeverBreakAfterOperator
                if has_line_comment_on_operator_line
                    && !right_expression.is_some_and(is_require_call) =>
            {
                AssignmentLikeLayout::BreakAfterOperator
            }
            layout => layout,
        };
        // A group of text at the start of a group makes no difference: `Formatter::is_at_start_of_group`.
        if layout != AssignmentLikeLayout::BreakLeftHandSide
            && !(is_left_text && layout.has_group_around_it(false))
        {
            f.group_from(left_group, false);
        }

        self.write_operator(f);
        if let Some((_, right_start, _)) = sides
            && !operator_line_run.is_empty()
        {
            write!(f, FormatTrailingComments::Comments(operator_line_run));
            if operator_line_run
                .iter()
                .any(|comment| f.comments().is_suppression_comment(comment))
            {
                f.comments_mut().mark_suppressed_after_operator(right_start);
            }
        }
        // Without a group of its own the line break follows the group around it all, which the line
        // comment breaks.
        let follows_line_comment =
            has_line_comment_on_operator_line && layout == AssignmentLikeLayout::BreakAfterOperator;
        match follows_line_comment {
            true => {
                let right = format_with(|f| self.write_right(right_expression, f, layout, None));
                write!(f, soft_line_indent_or_space(&right));
            }
            false => self.write_after_operator(right_expression, layout, f),
        }

        if follows_line_comment || layout.has_group_around_it(is_left_text) {
            f.group_from(outer_group, false);
        }
    }
}

/// `require("a")`
fn is_require_call(e: Expr<'_>) -> bool {
    e.tag() == ExprTag::Call
        && matches!(e.as_ast_nodes(), AstNodes::CallExpression(call)
            if call.callee().is_some_and(|callee| callee.tag() == ExprTag::Ident && callee.text() == b"require"))
}

impl<'a> AssignmentLike<'a> {
    /// Where the left side ends, where the right side starts and where the operator between them ends,
    /// if there is a comment between the two sides.
    ///
    /// `right_expression`: [`AssignmentLike::get_right_expression`].
    fn sides_with_comments_between(
        &self,
        right_expression: Option<Expr<'a>>,
        f: &Formatter<'a>,
    ) -> Option<(u32, u32, u32)> {
        let right_start = right_expression.map(|it| it.span().start);
        let (left_end, right_start, operator) = match *self {
            Self::VariableDeclarator(declarator) => (
                declarator
                    .ty()
                    .map_or_else(|| declarator.pat().span().end, |ty| ty.span().end),
                right_start?,
                b'=',
            ),
            Self::AssignmentExpression(assignment) => {
                (assignment.left()?.span().end, right_start?, b'=')
            }
            Self::ObjectProperty(property) => {
                (property.key()?.span(f.file()).end, right_start?, b':')
            }
            Self::BindingProperty(property) => (
                property.key()?.span(f.file()).end,
                property.value().span().start,
                b':',
            ),
            Self::PropertyDefinition(member) | Self::AccessorProperty(member) => {
                let key_end = member.key().map(|key| key.span(f.file()).end);
                (
                    member.ty().map(|ty| ty.span().end).or(key_end)?,
                    right_start?,
                    b'=',
                )
            }
        };
        f.comments()
            .has_any_comment_in(Span::new(left_end, right_start))
            .then(|| {
                (
                    left_end,
                    right_start,
                    f.comments().position_after_character(left_end, operator),
                )
            })
    }
}

/// Whether `element` is text without a line break, or a space.
fn is_text_on_one_line(element: &FormatElement) -> bool {
    match element {
        FormatElement::Token(_) | FormatElement::Space => true,
        FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
            !text.width.is_multiline()
        }
        _ => false,
    }
}

impl AssignmentLikeLayout {
    /// Whether there is a group around the assignment. `is_left_text`: the left side is nothing but
    /// text on one line.
    fn has_group_around_it(self, is_left_text: bool) -> bool {
        match self {
            AssignmentLikeLayout::Chain
            | AssignmentLikeLayout::ChainTail
            | AssignmentLikeLayout::ChainTailArrowFunction => false,
            // All that can break is in the group after the operator, which fits if and only if a group
            // around text and it fits.
            AssignmentLikeLayout::BreakAfterOperator => !is_left_text,
            _ => true,
        }
    }
}

impl<'a> AssignmentLike<'a> {
    /// `right_expression`: [`AssignmentLike::get_right_expression`].
    fn write_after_operator(
        &self,
        right_expression: Option<Expr<'a>>,
        layout: AssignmentLikeLayout,
        f: &mut Formatter<'a>,
    ) {
        let right = format_with(|f| self.write_right(right_expression, f, layout, None));
        match layout {
            AssignmentLikeLayout::Fluid => {
                let group_id = f.group_id("assignment_like");
                let right =
                    format_with(|f| self.write_right(right_expression, f, layout, Some(group_id)));
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
    }
}

/// `expression`, which is told about the layout if it is an arrow function.
pub(crate) fn with_assignment_layout(
    expression: Expr<'_>,
    layout: Option<AssignmentLikeLayout>,
) -> FormatExpr<'_> {
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
fn is_poorly_breakable_member_or_call_chain<'a>(
    expression: Expr<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    if !matches!(
        expression.tag(),
        ExprTag::Call | ExprTag::Dot | ExprTag::Index | ExprTag::NonNull
    ) {
        return false;
    }
    let threshold = f.options().line_width.value() / 4;
    let mut is_chain = false;
    let mut call_expressions: SmallVec<[Expr<'a>; 4]> = SmallVec::new();
    let mut current = expression;

    loop {
        let next = match current.tag() {
            ExprTag::NonNull => current.operand(),
            ExprTag::Call => {
                // One call that can break is all it takes, and most can.
                let arguments = current.as_call().map(Call::args);
                match arguments.map(|it| (it.len(), it.first())) {
                    Some((0, _) | (_, None)) => {}
                    Some((1, Some(only)))
                        if only.tag() != ExprTag::Spread
                            && is_short_argument(only, threshold, f) => {}
                    _ => return false,
                }
                is_chain = true;
                call_expressions.push(current);
                current.callee()
            }
            ExprTag::Dot | ExprTag::Index => {
                is_chain = true;
                current.object()
            }
            ExprTag::Ident | ExprTag::This => break,
            _ => None,
        };
        match next {
            Some(next) => current = next,
            None => return false,
        }
    }
    if !is_chain {
        return false;
    }
    let Some(&first_call) = call_expressions.first() else {
        return true;
    };
    if comment_in_call_chain_makes_it_breakable(f)
        && f.comments().has_comment_in_span(first_call.span())
    {
        return false;
    }
    for &call_expression in &call_expressions {
        let Some(call) = call_expression.call() else {
            continue;
        };
        let has_comment_around_argument = !call.args().is_empty()
            && f.comments()
                .has_comment_in_range(call.callee().span().end, call_expression.span().end);
        if has_comment_around_argument
            || is_complex_type_arguments(call_expression, call.type_args(), f)
        {
            return false;
        }
    }
    // Prettier's `printCallExpression`: only the call of a member can be a member chain. It is asked
    // of every call: in `a.b().c()()` of the second from the right.
    let asked = match only_last_call_can_be_member_chain(f) {
        true => call_expressions.get(..1).unwrap_or_default(),
        false => &call_expressions[..],
    };
    !asked.iter().any(|&call_expression| {
        call_expression
            .callee()
            .is_some_and(|callee| match callee.as_ast_nodes() {
                AstNodes::StaticMemberExpression(_)
                | AstNodes::ComputedMemberExpression(_)
                | AstNodes::PrivateFieldExpression(_) => true,
                AstNodes::CallExpression(_) => only_last_call_can_be_member_chain(f),
                _ => false,
            })
            && is_member_call_chain(call_expression, f)
    })
}

/// `a = await b.c("d")!.e("f")!.g("h")!.i!()`: oxfmt asks whether the last call is a member chain, which the call of
/// `x!` is not, and breaks the line after the `=`. The call of a call is one: `a = b.c().d()(e)`.
fn only_last_call_can_be_member_chain(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// For oxfmt a chain with a comment anywhere in it is not poorly breakable. Prettier only looks at
/// the comments around a lone argument.
fn comment_in_call_chain_makes_it_breakable(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `isShortCallArgument`/`isLoneShortArgument`.
pub(crate) fn is_short_argument<'a>(argument: Expr<'a>, threshold: u16, f: &Formatter<'a>) -> bool {
    let threshold = threshold as usize;
    // Prettier asks for the `length` of a string of JavaScript, oxfmt for that of one of Rust.
    let is_oxfmt = f.options().flavor.is_oxfmt();
    let len = |text: &[u8]| match is_oxfmt {
        true => text.len(),
        false => bun_core::strings::wtf8_len_utf16(text) as usize,
    };
    match argument.as_ast_nodes() {
        AstNodes::IdentifierReference(_) => len(argument.text()) <= threshold,
        AstNodes::UnaryExpression(_) => argument
            .argument()
            .is_some_and(|operand| is_short_argument(operand, threshold as u16, f)),
        AstNodes::RegExpLiteral(_) => {
            matches!(argument.kind(), ExprKind::Regex(regex) if len(regex.pattern()) <= threshold)
        }
        AstNodes::StringLiteral(_) => {
            let text = FormatLiteralStringToken::new(
                argument.text(),
                false,
                StringLiteralParentKind::Expression,
            )
            .clean_text(f);
            match is_oxfmt {
                true => text.width() <= threshold,
                false => len(&text) <= threshold,
            }
        }
        AstNodes::TemplateLiteral(_) => matches!(argument.kind(), ExprKind::Template(template) if {
            let raw = template.raw(0);
            template.quasi_count() == 1 && len(raw) <= threshold && bun_core::strings::index_of_any(raw, b"\r\n").is_none()
        }),
        AstNodes::CallExpression(_) => argument.call().is_some_and(|call| {
            let callee = call.callee();
            call.args().is_empty()
                && matches!(callee.kind(), ExprKind::Ident(_))
                && len(callee.text()) <= threshold.saturating_sub(2)
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
fn is_complex_type_arguments<'a>(
    owner: Expr<'a>,
    params: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) -> bool {
    let Some(span) = params.angle_brackets_span() else {
        return false;
    };
    if params.len() > 1 {
        return true;
    }
    if params.first().is_some_and(|param| {
        matches!(
            param.kind(),
            TypeKind::Union(_) | TypeKind::Intersection(_) | TypeKind::Object(_)
        )
    }) {
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
