use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    is_intrinsic_error_type, is_object_flag_set, is_object_type, is_type_parameter,
};
use bun_lint::types::utils::{is_type_any_type, is_type_unknown_type, is_unsafe_assignment};
use bun_lint::types::{ObjectFlags, Type};

/// Disallow type assertions that narrow a type.
pub struct NoUnsafeTypeAssertion;

const UNSAFE_OF_ANY_TYPE_ASSERTION: Message = Message::new(
    "unsafeOfAnyTypeAssertion",
    "Unsafe assertion from {{type}} detected: consider using type guards or a safer assertion.",
);
const UNSAFE_TO_ANY_TYPE_ASSERTION: Message = Message::new(
    "unsafeToAnyTypeAssertion",
    "Unsafe assertion to {{type}} detected: consider using a more specific type to ensure safety.",
);
const UNSAFE_TO_UNCONSTRAINED_TYPE_ASSERTION: Message = Message::new(
    "unsafeToUnconstrainedTypeAssertion",
    "Unsafe type assertion: '{{type}}' could be instantiated with an arbitrary type which could be unrelated to the original type.",
);
const UNSAFE_TYPE_ASSERTION: Message = Message::new(
    "unsafeTypeAssertion",
    "Unsafe type assertion: type '{{type}}' is more narrow than the original type.",
);
const UNSAFE_TYPE_ASSERTION_ASSIGNABLE_TO_CONSTRAINT: Message = Message::new(
    "unsafeTypeAssertionAssignableToConstraint",
    "Unsafe type assertion: the original type is assignable to the constraint of type '{{type}}', but '{{type}}' could be instantiated with a different subtype of its constraint.",
);

fn get_any_type_name(ty: Type) -> &'static str {
    match is_intrinsic_error_type(ty) {
        true => "error typed",
        false => "`any`",
    }
}

fn is_object_literal_type(ty: Type) -> bool {
    is_object_type(ty) && is_object_flag_set(ty, ObjectFlags::OBJECT_LITERAL)
}

impl NoUnsafeTypeAssertion {
    fn check_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::As { expr: expression, ty: type_annotation } = node.kind() else {
            return;
        };
        let expression_type = expression.ty();
        let asserted_type = type_annotation.ty();
        // oxlint points at the expression: `<A>b`.
        let place = if cx.language().is_oxlint { expression.outer_span() } else { node.span() };
        // `as A`, `<A>`
        let (operand, annotation) = (expression.outer_span(), type_annotation.outer_span());
        let assertion = match node.span().start < operand.start {
            true => Span::new(node.span().start, skip_trivia(cx.text(), annotation.end) + 1),
            false => Span::new(skip_trivia(cx.text(), operand.end), annotation.end),
        };
        // tsgolint says which the two types are, and marks the assertion.
        let type_label = |ty: Type| if is_intrinsic_error_type(ty) { b"error".to_vec() } else { ty.to_text() };
        let labels = |labels: &mut Details| {
            let (original, asserted) = (type_label(expression_type), type_label(asserted_type));
            labels.first(format!("Original expression has type `{}`.", bstr::BStr::new(&original)));
            labels.push(annotation, format!("Asserted type is `{}`.", bstr::BStr::new(&asserted)));
            labels.push(assertion, "");
        };

        if expression_type == asserted_type
            || expression_type.is_unresolved()
            || asserted_type.is_unresolved()
        {
            return;
        }

        // Asserting unknown ==> any.
        if is_type_any_type(asserted_type) && is_type_unknown_type(expression_type) {
            cx.report(place, UNSAFE_TO_ANY_TYPE_ASSERTION)
                .comments_apply_at(assertion)
                .data("type", "`any`")
                .labels_with(labels);
            return;
        }

        if let Some(unsafe_expression_any) = is_unsafe_assignment(expression_type, asserted_type, expression) {
            cx.report(place, UNSAFE_OF_ANY_TYPE_ASSERTION)
                .comments_apply_at(assertion)
                .data("type", get_any_type_name(unsafe_expression_any.sender))
                .labels_with(labels);
            return;
        }

        if let Some(unsafe_asserted_any) = is_unsafe_assignment(asserted_type, expression_type, None::<Expr<'a>>) {
            cx.report(place, UNSAFE_TO_ANY_TYPE_ASSERTION)
                .comments_apply_at(assertion)
                .data("type", get_any_type_name(unsafe_asserted_any.sender))
                .labels_with(labels);
            return;
        }

        // The widened type of an object literal does not fail on the check for excess properties.
        let expression_widened_type = match is_object_literal_type(expression_type) {
            true => expression_type.get_widened_type(),
            false => expression_type,
        };
        if expression_widened_type.is_assignable_to(asserted_type) {
            return;
        }

        let mut message = UNSAFE_TYPE_ASSERTION;
        if is_type_parameter(asserted_type) {
            match asserted_type.get_base_constraint_of_type() {
                None => message = UNSAFE_TO_UNCONSTRAINED_TYPE_ASSERTION,
                Some(constraint) if expression_widened_type.is_assignable_to(constraint) => {
                    message = UNSAFE_TYPE_ASSERTION_ASSIGNABLE_TO_CONSTRAINT;
                }
                Some(_) => {}
            }
        }
        cx.report(place, message)
            .comments_apply_at(assertion)
            .data("type", asserted_type.to_text())
            .labels_with(labels);
    }
}

impl Rule for NoUnsafeTypeAssertion {
    const META: Meta = Meta::typescript("no-unsafe-type-assertion", Kind::Problem).requires_types();
    // The type that `as const` asserts is that of the expression.
    const ON: On = On::new().exprs(&[ExprTag::As]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUnsafeTypeAssertion
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check_expression(node, cx);
    }
}
