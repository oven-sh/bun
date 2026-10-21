//! Everything with a left side, an operator and a right side: `a = b`, `const a = b`, `a: b`. Prettier's
//! `printAssignment`.

use super::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use super::member_chain::is_member_call_chain;
use super::object::{FormatKey, KeyParent, format_computed_or_property_key, write_member_name};
use super::string::{FormatLiteralStringToken, StringLiteralParentKind};
use super::suppressed::FormatSuppressedNode;
use super::typecast::{
    comments_of_outermost_node, has_comments, has_leading_own_line_comment, is_cast_target,
};
use crate::js::format::{ExprOptions, FormatExpr, FormatTypeAnnotation};
use crate::js::parentheses::expression::expression_needs_parentheses;
use crate::js::print::arrow_function_expression::FormatJsArrowFunctionExpressionOptions;
use crate::js::print::binary_like_expression::BinaryLikeExpression;
use crate::js::print::class::write_comments_between_modifiers;
use crate::js::print::decorators::FormatDecorators;
use crate::js::print::patterns::FormatBindingPropertyValue;
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

/// Where an assignment breaks if it doesn't fit on the line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AssignmentLikeLayout {
    /// Breaks in the right side first, then after the operator.
    Fluid,
    /// Breaks after the operator first.
    BreakAfterOperator,
    /// Never breaks after the operator.
    NeverBreakAfterOperator,
    /// The middle of `a = b = c = d`: each assignment is on its own line.
    Chain,
    /// The last assignment of such a chain.
    ChainTail,
    /// Breaks in the left side first, which is a complex destructuring pattern or type.
    BreakLeftHandSide,
    /// The last assignment of a chain, whose right side is a chain of arrow functions.
    ChainTailArrowFunction,
}

/// oxfmt keeps a comment on its side of the `=` or `:`, and a line comment on the operator's line stays there, with
/// what follows on the next line. Prettier attaches it to one of the two sides, and prints it at the end of the line
/// that side ends on.
///
/// ```js
/// const a = // comment      const a = 1; // comment
///   1;
/// ```
///
/// The comments that stay right after the operator are attached to the assignment as dangling comments.
fn comments_stay_around_operator(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// A name is short if it's less than this much wider than the indentation. Breaking after the operator would then gain
/// next to nothing.
const MIN_OVERLAP_FOR_BREAK: u32 = 3;

/// The printed width of the computed `key`, with its brackets, if it's a single piece of text, with no group in it and
/// nothing that can break. Only such a key can be short. Prettier checks that `cleanDoc(keyDoc)` is a string.
///
/// oxfmt measures the source text in the brackets, whatever it is, without the comments around it.
fn computed_key_width<'a>(key: Key<'a>, f: &Formatter<'a>) -> Option<usize> {
    if f.options().flavor.is_oxfmt() {
        return Some(f.source_text().span_width(key.inner_span(f.file())) + 2);
    }
    let span = key.span(f.file());
    if let KeyKind::Computed(e) = key.kind() {
        // A comment in the brackets is a separate piece.
        return match !f.is_quiet() && has_comments(e, f) {
            true => None,
            false => plain_expression_width(e, f).map(|width| width + 2),
        };
    }
    // A template is printed with a `lineSuffixBoundary`.
    let is_template = f
        .source_text()
        .text_for(&span)
        .get(1..)
        .is_some_and(|it| it.trim_ascii_start().starts_with(b"`"));
    (!is_template).then(|| f.source_text().span_width(span))
}

/// `{ a /* comment */: b }`: in Prettier a name with a comment is more than one piece of text, so it isn't short. oxfmt
/// only looks at the name.
fn comments_make_name_long<'a>(key: Key<'a>, f: &Formatter<'a>) -> bool {
    if f.is_quiet() || f.options().flavor.is_oxfmt() {
        return false;
    }
    let comments = f.comments().of_name(key.inner_span(f.file()).start);
    !comments.leading.is_empty() || !comments.trailing.is_empty()
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
            ExprKind::Unary { operand, .. } if has_comments(operand, f) => return None,
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

/// See [`computed_key_width`]: `any`, `"a"`, `A.B`, `A<B>`, `A[]`, `A[B]`, `keyof A`, `typeof a`. Not `A | B`, `[A]`,
/// `{}`, `` `a` ``. The width is that of the type's source text.
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

/// `<A>`: a single type argument that's a name, a keyword or a literal is printed without a group.
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

/// A class property's decorators, modifiers, name, `?`, `!` and type.
fn write_property_definition_left<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    let modifiers = member.modifiers();
    if !modifiers.is_empty() {
        write!(f, FormatDecorators::from_member(member));
        write_comments_between_modifiers(member, f);
        let present_flags = modifiers
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
            if present_flags.contains(flag) {
                write!(f, keyword);
            }
        }
        if present_flags.intersects(Flags::IN | Flags::OUT) {
            crate::js::print::flow::write_variance_sign(modifiers, f);
        }
    }
    match member.key() {
        Some(key) if key.is_computed() => {
            format_computed_or_property_key(key, member.as_ast_nodes(), f)
        }
        Some(key) => {
            write_member_name(key, KeyParent::Member(member), f);
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

/// `let a /* comment */⏎: T`: in oxfmt the comment trails `a` and stays before the type annotation. In Prettier it
/// leads the type annotation.
fn comments_between_name_and_type<'a>(
    declarator: VarDecl<'a>,
    f: &Formatter<'a>,
) -> CommentList<'a> {
    let Some(ty) = declarator.ty().filter(|_| !f.is_quiet()) else {
        return CommentList::empty();
    };
    let comments = (f.comments())
        .of_node(declarator.pat().as_ast_nodes())
        .trailing;
    let count = (comments.iter())
        .take_while(|comment| comment.span().start < ty.span().start)
        .count();
    comments.slice(0, count)
}

/// A left side that's a name without comments. See [`AssignmentLike::name_on_the_left`].
#[derive(Copy, Clone)]
enum NameOnTheLeft<'a> {
    /// Copied from the source.
    At(Span),
    /// An assignment target, which can need parentheses.
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
    /// Returns what [`AssignmentLike::write_left`] would print and return, if that's only a name and can be determined
    /// without printing it.
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
        let text_width_for_break = f
            .options()
            .indent_width
            .value()
            .saturating_add(MIN_OVERLAP_FOR_BREAK);
        // Text is never wider than its byte length.
        let is_short = span.len() < text_width_for_break
            || f.string_width(f.source_text().text_for(&span)) < text_width_for_break;
        Some((NameOnTheLeft::At(span), is_short))
    }

    /// Returns true if the left side is a short name.
    fn write_left(&self, f: &mut Formatter<'a>) -> bool {
        let text_width_for_break =
            f.options().indent_width.value() as usize + MIN_OVERLAP_FOR_BREAK as usize;
        match *self {
            AssignmentLike::VariableDeclarator(declarator) => {
                let (id, ty) = (declarator.pat(), declarator.ty());
                let definite = declarator.is_definite().then_some("!");
                // In Prettier the type annotation is part of the name. So it's copied along with an ignored name, and
                // the name's trailing comments come after it.
                match ty {
                    Some(ty) if !f.is_quiet() && f.comments().is_ignored(id.as_ast_nodes()) => {
                        let span = Span::new(id.span().start, ty.span().end);
                        write!(
                            f,
                            [
                                leading_comments(id.as_ast_nodes()),
                                FormatSuppressedNode(span)
                            ]
                        );
                    }
                    _ => write!(
                        f,
                        [
                            FormatNodeWithoutTrailingComments(&id),
                            FormatTrailingComments::Comments(comments_between_name_and_type(
                                declarator, f
                            )),
                            definite,
                            ty.map(FormatTypeAnnotation)
                        ]
                    ),
                }
                if !f.is_quiet() {
                    write!(f, trailing_comments(id.as_ast_nodes()));
                }
                false
            }
            AssignmentLike::AssignmentExpression(assignment) => {
                write!(f, assignment.left());
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
                    write_member_name(key, KeyParent::Property(property), f) < text_width_for_break
                        && !comments_make_name_long(key, f)
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
                    Some(key) => {
                        write_member_name(key, KeyParent::Node(node), f) < text_width_for_break
                            && !comments_make_name_long(key, f)
                    }
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

    /// `right` is [`AssignmentLike::get_right_expression`].
    /// `fluid_group_id` is, in the fluid layout, the id of the group with the line break after the operator.
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
                            && !is_cast_target(right, f)
                            && (f.is_quiet() || !f.comments().is_ignored(right.as_ast_nodes())) =>
                    {
                        // The conditional prints its own indentation, so its comments go outside it.
                        if !f.is_quiet() {
                            write!(f, leading_comments(right.as_ast_nodes()));
                        }
                        match super::experimental_ternary::should_break(right, f) {
                            true => write!(f, indent(&right)),
                            false => {
                                // After the line break that follows the operator, Prettier's `softline` is a second
                                // one.
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
            }
        }
    }

    /// Prettier's `chooseLayout`.
    ///
    /// `right_expression` is [`AssignmentLike::get_right_expression`].
    fn layout(
        &self,
        right_expression: Option<Expr<'a>>,
        is_left_short: bool,
        left_may_break: bool,
        f: &mut Formatter<'a>,
    ) -> AssignmentLikeLayout {
        // Prettier then sees a `ParenthesizedExpression` on the right side, whatever is inside.
        let is_type_cast = right_expression.is_some_and(|e| is_cast_target(e, f));
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
            if has_leading_comment_that_breaks_after_operator(e, f)
                || !self.comments_after_operator(f).is_empty()
            {
                return AssignmentLikeLayout::BreakAfterOperator;
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
        // A pattern property's right side isn't an expression.
        if let Self::BindingProperty(property) = *self
            && !f.is_quiet()
        {
            let value = match property.default() {
                Some(_) => AstNodes::AssignmentPattern(Node::PatProp(property)),
                None => property.value().as_ast_nodes(),
            };
            if (f.comments().of_node(value).leading.iter())
                .any(|comment| comment.has_newline_after() || comment.is_indentable_block())
            {
                return AssignmentLikeLayout::BreakAfterOperator;
            }
        }

        if self.should_break_left_hand_side(left_may_break && !is_type_cast) {
            return AssignmentLikeLayout::BreakLeftHandSide;
        }
        if !is_type_cast
            && right_expression
                .is_some_and(|right| should_break_after_operator(right, is_left_short, f))
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

    /// No operator and no right side: `let a`, `{ a }`.
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
    /// `is_type_cast` means `right_expression` is in a type cast's parentheses.
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
                .filter(|left| left.tag() == ExprTag::Object && left.is_assignment_target())
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

/// Something to format, paired with a span it doesn't know itself.
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

/// `a = /** @type {T} */ (⏎/**⏎ * comment⏎ */⏎b)`: oxfmt looks at all comments before `b`.
fn block_comment_in_parentheses_of_cast_breaks(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// True if a leading comment of `right`, an assignment's right side, ends its line, or is a block comment whose lines
/// all start with `*`. The right side then starts on its own line.
fn has_leading_comment_that_breaks_after_operator<'a>(right: Expr<'a>, f: &Formatter<'a>) -> bool {
    if f.is_quiet() {
        return false;
    }
    has_leading_own_line_comment(right, f)
        || (comments_of_outermost_node(right, f).leading.iter())
            .any(|comment| comment.is_indentable_block())
        || (block_comment_in_parentheses_of_cast_breaks(f)
            && is_cast_target(right, f)
            && (f
                .comments()
                .of_node(right.as_chain_element())
                .leading
                .iter())
            .any(|comment| comment.is_indentable_block()))
}

/// Prettier's `shouldBreakAfterOperator`.
fn should_break_after_operator<'a>(
    right: Expr<'a>,
    is_left_short: bool,
    f: &mut Formatter<'a>,
) -> bool {
    // `None` if it's neither a binary nor a logical expression.
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
        ExprTag::Cond if right.test().is_some_and(|test| is_cast_target(test, f)) => false,
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
                || is_poorly_breakable_member_or_call_chain(inner_expression, f)
        }
    }
}

/// The `a()` in `void !!(await a())`.
#[inline]
fn get_innermost_expression<'a>(mut current: Expr<'a>, f: &Formatter<'a>) -> Expr<'a> {
    loop {
        let inner = match current.tag() {
            _ if is_cast_target(current, f) => None,
            ExprTag::Unary if current.unary_op().is_some_and(|op| op.is_update()) => None,
            ExprTag::Unary | ExprTag::Await | ExprTag::Yield => current.argument(),
            // All of `a?.b!` is a `ChainExpression`.
            ExprTag::NonNull if !current.is_chain_root() => current.expression(),
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

        // Whether there's a group around everything, and one around the left side, depends on the layout, which depends
        // on the left side's output.
        let outer_group = f.reserve_tag();
        let left_group = f.reserve_tag();
        let is_left_short = self.write_left(f);
        let left = f.elements().get(left_group + 1..).unwrap_or_default();
        let is_left_text = left.len() <= 12 && left.iter().all(is_text_on_one_line);
        let left_may_break = !is_left_text
            && f.elements_from(left_group + 1)
                .may_directly_break(f.options().flavor);
        let comments_after_operator = self.comments_after_operator(f);
        let has_line_comment_on_operator_line = !comments_after_operator.is_empty()
            || (!f.is_quiet()
                && comments_stay_around_operator(f)
                && f.comments()
                    .has_printed_line_comment_after(self.left_end(f)));
        let layout = match self.layout(right_expression, is_left_short, left_may_break, f) {
            AssignmentLikeLayout::Fluid | AssignmentLikeLayout::NeverBreakAfterOperator
                if has_line_comment_on_operator_line
                    && !right_expression.is_some_and(is_require_call) =>
            {
                AssignmentLikeLayout::BreakAfterOperator
            }
            layout => layout,
        };
        // A group of text at the start of a group makes no difference: see `Formatter::is_at_start_of_group`.
        if layout != AssignmentLikeLayout::BreakLeftHandSide
            && !(is_left_text && layout.has_group_around_it(false))
        {
            f.group_from(left_group, false);
        }

        self.write_operator(f);
        write!(f, FormatTrailingComments::Comments(comments_after_operator));
        // Without its own group, the line break follows the outer group, which the line comment breaks.
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
    fn node(&self) -> AstNodes<'a> {
        match *self {
            Self::VariableDeclarator(declarator) => AstNodes::VariableDeclarator(declarator),
            Self::AssignmentExpression(assignment) => assignment.as_ast_nodes(),
            Self::ObjectProperty(property) => property.as_ast_nodes(),
            Self::BindingProperty(property) => AstNodes::BindingProperty(property),
            Self::PropertyDefinition(member) | Self::AccessorProperty(member) => {
                member.as_ast_nodes()
            }
        }
    }

    /// See [`comments_stay_around_operator`].
    fn comments_after_operator(&self, f: &Formatter<'a>) -> CommentList<'a> {
        match !f.is_quiet() && comments_stay_around_operator(f) {
            true => f.comments().of_node(self.node()).dangling,
            false => CommentList::empty(),
        }
    }

    /// The end of the left side.
    fn left_end(&self, f: &Formatter<'a>) -> u32 {
        let key_end = |key: Option<Key<'a>>| key.map_or(0, |key| key.span(f.file()).end);
        match *self {
            Self::VariableDeclarator(declarator) => declarator
                .ty()
                .map_or_else(|| declarator.pat().span().end, |ty| ty.span().end),
            Self::AssignmentExpression(assignment) => {
                assignment.left().map_or(0, |left| left.span().end)
            }
            Self::ObjectProperty(property) => key_end(property.key()),
            Self::BindingProperty(property) => key_end(property.key()),
            Self::PropertyDefinition(member) | Self::AccessorProperty(member) => member
                .ty()
                .map_or_else(|| key_end(member.key()), |ty| ty.span().end),
        }
    }
}

/// True if `element` is text without a line break, or a space.
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
    /// True if there's a group around the assignment. `is_left_text` means the left side is only text on one line.
    fn has_group_around_it(self, is_left_text: bool) -> bool {
        match self {
            AssignmentLikeLayout::Chain
            | AssignmentLikeLayout::ChainTail
            | AssignmentLikeLayout::ChainTailArrowFunction => false,
            // Everything that can break is in the group after the operator, which fits if and only if a group around
            // the text and it fits.
            AssignmentLikeLayout::BreakAfterOperator => !is_left_text,
            _ => true,
        }
    }
}

impl<'a> AssignmentLike<'a> {
    /// `right_expression` is [`AssignmentLike::get_right_expression`].
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

/// `expression`, which gets the layout passed down if it's an arrow function.
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
        // Prettier sees a `ParenthesizedExpression`.
        if is_cast_target(current, f) {
            return false;
        }
        let next = match current.tag() {
            ExprTag::NonNull => current.operand(),
            ExprTag::Call => {
                // One call that can break is enough, and most can.
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
        let Some(call) = call_expression.as_call_like() else {
            continue;
        };
        if is_complex_type_arguments(call_expression, call.type_args(), f) {
            return false;
        }
    }
    // Prettier's `printCallExpression`: only a call of a member can be a member chain. Every call is checked: in
    // `a.b().c()()` that catches the second from the right.
    let checked_calls = match only_last_call_can_be_member_chain(f) {
        true => call_expressions.get(..1).unwrap_or_default(),
        false => &call_expressions[..],
    };
    !checked_calls.iter().any(|&call_expression| {
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

/// `a = await b.c("d")!.e("f")!.g("h")!.i!()`: oxfmt only checks if the last call is a member chain, which a call of
/// `x!` isn't, so it breaks the line after the `=`. A call of a call is one: `a = b.c().d()(e)`.
fn only_last_call_can_be_member_chain(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// In oxfmt a chain with a comment anywhere in it isn't poorly breakable. Prettier only looks at the comments around a
/// lone argument.
fn comment_in_call_chain_makes_it_breakable(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `isShortCallArgument`/`isLoneShortArgument`.
pub(crate) fn is_short_argument<'a>(
    mut argument: Expr<'a>,
    threshold: u32,
    f: &Formatter<'a>,
) -> bool {
    let threshold = threshold as usize;
    let has_comments = |e: Expr<'a>| !f.is_quiet() && has_comments(e, f);
    if has_comments(argument) {
        return false;
    }
    let mut node = argument.as_ast_nodes();
    while let AstNodes::UnaryExpression(_) = node {
        match argument.argument() {
            Some(operand) if !has_comments(operand) => {
                (argument, node) = (operand, operand.as_ast_nodes());
            }
            _ => return false,
        }
    }
    // Prettier uses a JavaScript string's `length`, oxfmt a Rust string's.
    let is_oxfmt = f.options().flavor.is_oxfmt();
    let len = |text: &[u8]| match is_oxfmt {
        true => text.len(),
        false => bun_core::strings::wtf8_len_utf16(text) as usize,
    };
    match node {
        AstNodes::IdentifierReference(_) => len(argument.text()) <= threshold,
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
        AstNodes::CallExpression(_) => argument.as_call_like().is_some_and(|call| {
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
