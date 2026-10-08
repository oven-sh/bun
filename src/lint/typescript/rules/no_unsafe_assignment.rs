use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    CompilerOption, is_intrinsic_error_type, is_strict_compiler_option_enabled,
};
use bun_lint::types::utils::{
    get_constrained_type_at_location, is_type_any_array_type, is_type_any_type, is_type_unknown_type,
    is_unsafe_assignment,
};
use bun_lint::types::{NameOf, Type};
use bun_lint::utils::ts_utils::get_this_expression;
use bun_lint::utils::{Target, TargetElement, TargetKind};

/// Disallow assigning a value with type `any` to variables and properties.
pub struct NoUnsafeAssignment;

const ANY_ASSIGNMENT: Message = Message::new("anyAssignment", "Unsafe assignment of an {{sender}} value.");
const ANY_ASSIGNMENT_THIS: Message = Message::new(
    "anyAssignmentThis",
    "Unsafe assignment of an {{sender}} value. `this` is typed as `any`.\nYou can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.",
);
const UNSAFE_ARRAY_PATTERN: Message =
    Message::new("unsafeArrayPattern", "Unsafe array destructuring of an {{sender}} array value.");
const UNSAFE_ARRAY_PATTERN_FROM_TUPLE: Message = Message::new(
    "unsafeArrayPatternFromTuple",
    "Unsafe array destructuring of a tuple element with an {{sender}} value.",
);
const UNSAFE_ARRAY_SPREAD: Message =
    Message::new("unsafeArraySpread", "Unsafe spread of an {{sender}} value in an array.");
const UNSAFE_ASSIGNMENT: Message = Message::new(
    "unsafeAssignment",
    "Unsafe assignment of type {{sender}} to a variable of type {{receiver}}.",
);
const UNSAFE_OBJECT_PATTERN: Message = Message::new(
    "unsafeObjectPattern",
    "Unsafe object destructuring of a property with an {{sender}} value.",
);

type Context<'a> = Cx<'a, NoUnsafeAssignment>;

/// `createData(senderType).sender`
fn describe_sender(sender_type: Type) -> &'static str {
    match is_intrinsic_error_type(sender_type) {
        true => "error typed",
        false => "`any`",
    }
}

fn in_backticks(ty: Type) -> Vec<u8> {
    [&b"`"[..], &ty.to_text()[..], b"`"].concat()
}

/// The range of an element of an `ArrayPattern`, or of the `value` of a `Property` of an
/// `ObjectPattern`: with the default value.
fn span_of_value(element: &TargetElement) -> Span {
    match element.node {
        Node::PatProp(it) => Span::new(it.value().span().start, it.span().end),
        Node::Prop(it) => it.value().map_or_else(|| it.span(), |value| value.span()),
        node => node.span(),
    }
}

/// What `String(key.value)` is for a key in brackets that is a literal and neither a string nor a
/// number.
fn name_of_keyword(key: Expr) -> Option<&'static [u8]> {
    match key.kind() {
        ExprKind::True => Some(b"true"),
        ExprKind::False => Some(b"false"),
        ExprKind::Null => Some(b"null"),
        _ => None,
    }
}

/// `services.getTypeAtLocation(node.key)`, where `name` is that of a key without brackets.
fn type_of_key<'a>(file: &'a File<'a>, key: Option<Key<'a>>, name: impl FnOnce() -> Type<'a>) -> Type<'a> {
    match key.map(Key::kind) {
        Some(KeyKind::Computed(expression)) => expression.ty(),
        // The type of the literal, of which it only matters that it is a primitive.
        Some(KeyKind::ComputedString(_)) => file.type_checker().get_string_type(),
        Some(KeyKind::ComputedNumber(_)) => file.type_checker().get_number_type(),
        _ => name(),
    }
}

fn check_destructured_value<'a>(
    cx: &Context<'a>,
    element: &TargetElement<'a>,
    target: Target<'a>,
    sender_type: Type<'a>,
    sender_node: Expr<'a>,
    message: Message,
) {
    // The any type comes first, to handle `[[[x]]] = [any]` and `{ x: { y: z } } = { x: any }`.
    if is_type_any_type(sender_type) {
        cx.report(span_of_value(element), message).data("sender", describe_sender(sender_type));
    } else if element.default.is_none() {
        check_destructure(cx, target, target.span(), sender_type, sender_node);
    }
}

fn check_destructure<'a>(
    cx: &Context<'a>,
    receiver_node: Target<'a>,
    receiver_span: Span,
    sender_type: Type<'a>,
    sender_node: Expr<'a>,
) {
    match receiver_node.kind() {
        TargetKind::Array => check_array_destructure(cx, receiver_node, receiver_span, sender_type, sender_node),
        TargetKind::Object => check_object_destructure(cx, receiver_node, sender_type, sender_node),
        TargetKind::Ident(_) | TargetKind::Other(_) => {}
    }
}

fn check_array_destructure<'a>(
    cx: &Context<'a>,
    receiver_node: Target<'a>,
    receiver_span: Span,
    sender_type: Type<'a>,
    sender_node: Expr<'a>,
) {
    // `const [x] = [] as any[];`
    if is_type_any_array_type(sender_type) {
        cx.report(receiver_span, UNSAFE_ARRAY_PATTERN).data("sender", describe_sender(sender_type));
        return;
    }
    if !sender_type.is_tuple_type() {
        return;
    }
    // `const [x] = [1 as any];`
    let tuple_elements = sender_type.get_type_arguments();
    for (receiver_index, receiver_element) in receiver_node.elements().iter().enumerate() {
        // A rest element is not a 1:1 assignment.
        if let Some(target) = receiver_element.target
            && !receiver_element.is_rest
            && let Some(sender_type) = tuple_elements.get(receiver_index)
        {
            let message = UNSAFE_ARRAY_PATTERN_FROM_TUPLE;
            check_destructured_value(cx, receiver_element, target, sender_type, sender_node, message);
        }
    }
}

fn check_object_destructure<'a>(
    cx: &Context<'a>,
    receiver_node: Target<'a>,
    sender_type: Type<'a>,
    sender_node: Expr<'a>,
) {
    for receiver_property in &receiver_node.elements() {
        let (Some(key), Some(target), false) =
            (receiver_property.key, receiver_property.target, receiver_property.is_rest)
        else {
            continue;
        };
        let key = match key.kind() {
            KeyKind::Computed(expression) => name_of_keyword(expression),
            _ => key.name().map(Name::bytes),
        };
        let Some(key) = key else {
            continue;
        };
        let Some(property) = sender_type.get_properties().iter().find(|it| it.name() == key) else {
            continue;
        };
        let sender_type = property.get_type_at_location(sender_node);
        check_destructured_value(cx, receiver_property, target, sender_type, sender_node, UNSAFE_OBJECT_PATTERN);
    }
}

/// Whether it is reported. `compares`: upstream's `comparisonType !== ComparisonType.None`.
fn check_assignment_of_type<'a>(
    cx: &Context<'a>,
    receiver_type: impl FnOnce() -> Type<'a>,
    sender_node: Expr<'a>,
    sender_type: Type<'a>,
    reporting_node: Span,
    compares: bool,
) -> bool {
    if is_type_any_type(sender_type) {
        // any ==> unknown
        if is_type_unknown_type(receiver_type()) {
            return false;
        }
        let options = cx.file().type_checker().compiler_options();
        // `var foo = this`
        let is_this_any = !is_strict_compiler_option_enabled(options, CompilerOption::NoImplicitThis)
            && get_this_expression(sender_node)
                .is_some_and(|this| is_type_any_type(get_constrained_type_at_location(this)));
        let message = if is_this_any { ANY_ASSIGNMENT_THIS } else { ANY_ASSIGNMENT };
        cx.report(reporting_node, message).data("sender", describe_sender(sender_type));
        return true;
    }
    if !compares {
        return false;
    }
    let Some(result) = is_unsafe_assignment(sender_type, receiver_type(), sender_node) else {
        return false;
    };
    cx.report(reporting_node, UNSAFE_ASSIGNMENT)
        .data("receiver", in_backticks(result.receiver))
        .data("sender", in_backticks(result.sender));
    true
}

fn check_assignment<'a>(
    cx: &Context<'a>,
    receiver_type: impl FnOnce() -> Type<'a>,
    sender_node: Expr<'a>,
    reporting_node: Span,
    compares: bool,
) -> bool {
    // Neither `any` nor a type with type arguments.
    if matches!(
        sender_node.tag(),
        ExprTag::Number | ExprTag::String | ExprTag::BigInt | ExprTag::True | ExprTag::False | ExprTag::Null
    ) {
        return false;
    }
    check_assignment_of_type(cx, receiver_type, sender_node, sender_node.ty(), reporting_node, compares)
}

/// What is done for an `AssignmentExpression`, an `AssignmentPattern` and a `VariableDeclarator`.
/// `left_span`: the range of `left` with its type annotation.
fn check_assignment_to_target<'a>(
    cx: &Context<'a>,
    left: Target<'a>,
    left_span: Span,
    right: Expr<'a>,
    node: Span,
    compares: bool,
) {
    let receiver_type = || match left {
        Target::Pat(it) => it.ty(),
        Target::Expr(it) => it.ty(),
    };
    if !check_assignment(cx, receiver_type, right, node, compares)
        && matches!(left.kind(), TargetKind::Array | TargetKind::Object)
    {
        check_destructure(cx, left, left_span, right.ty(), right);
    }
}

fn check_property<'a>(cx: &Context<'a>, node: Prop<'a>, value: Expr<'a>) {
    // The properties of an object pattern are checked via assignments.
    if node.is_import_attribute() || matches!(node.parent(), Node::Expr(object) if object.is_assignment_target()) {
        return;
    }
    let (file, key) = (cx.file(), node.key());
    let type_of_name = || type_of_key(file, key, || NameOf(node).ty());
    match node.kind() {
        PropKind::Spread => {}
        // `{ a = 1 }` is an `AssignmentPattern`.
        PropKind::Shorthand if value.tag() == ExprTag::Assign => {}
        PropKind::Init | PropKind::Shorthand => {
            // `getContextualType(checker, key)` is the contextual type of the property if the key
            // is an identifier, and nothing otherwise.
            let receiver_type = || {
                let contextual_type = match key.map(Key::kind) {
                    Some(KeyKind::Ident(_)) => value.contextual_type(),
                    _ => None,
                };
                contextual_type.unwrap_or_else(type_of_name)
            };
            check_assignment(cx, receiver_type, value, node.span(), true);
        }
        PropKind::Method | PropKind::Getter | PropKind::Setter => {
            if node.func().is_some_and(Func::has_body) {
                // TypeScript's node for the function is the method or the accessor.
                check_assignment_of_type(cx, type_of_name, value, node.type_at_location(), node.span(), true);
            }
        }
    }
}

impl Rule for NoUnsafeAssignment {
    const META: Meta = Meta::typescript("no-unsafe-assignment", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnsafeAssignment
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        // `AccessorProperty[value != null]`, `PropertyDefinition[value != null]`
        on.members(|_, node, cx| {
            let Some(value) = node.init() else {
                return;
            };
            if node.kind() != MemberKind::Property || node.is_signature() || node.flags().contains(Flags::ABSTRACT) {
                return;
            }
            let file = cx.file();
            let receiver_type = || type_of_key(file, node.key(), || NameOf(node).ty());
            check_assignment(cx, receiver_type, value, node.span(), node.ty().is_some());
        });

        // `AssignmentExpression[operator = "="]`, and an `AssignmentPattern` in an assignment.
        on.exprs([ExprTag::Assign], |_, node, cx| {
            if let ExprKind::Assign {
                op: None,
                target,
                value,
            } = node.kind()
            {
                check_assignment_to_target(cx, Target::Expr(target), target.span(), value, node.span(), true);
            }
        });

        // An `AssignmentPattern` in a declaration.
        on.params(|_, node, cx| {
            if let Some(right) = node.default() {
                let left = Target::Pat(node.pat());
                check_assignment_to_target(cx, left, node.binding_span(), right, node.span_without_modifiers(), true);
            }
        });
        on.pats([PatTag::Array, PatTag::Object], |_, pattern, cx| match pattern.kind() {
            PatKind::Array(elements) => {
                for element in elements {
                    if let (Some(left), Some(right)) = (element.pat(), element.default()) {
                        check_assignment_to_target(cx, Target::Pat(left), left.span(), right, element.span(), true);
                    }
                }
            }
            PatKind::Object(properties) => {
                for property in properties {
                    if let Some(right) = property.default() {
                        let left = property.value();
                        let node = Span::new(left.span().start, property.span().end);
                        check_assignment_to_target(cx, Target::Pat(left), left.span(), right, node, true);
                    }
                }
            }
            PatKind::Ident(_) | PatKind::Missing => {}
        });

        // `VariableDeclarator[init != null]`
        on.var_decls(|_, node, cx| {
            if let Some(init) = node.init() {
                // Without an annotation the type of the variable is inferred, thus equal.
                let compares = node.ty().is_some();
                check_assignment_to_target(cx, Target::Pat(node.pat()), node.binding_span(), init, node.span(), compares);
            }
        });

        // `:not(ObjectPattern) > Property`, `JSXAttribute[value != null]`
        on.props(|_, node, cx| {
            let Some(value) = node.value() else {
                return;
            };
            if !node.is_jsx_attribute() {
                check_property(cx, node, value);
            } else if node.kind() != PropKind::Spread && value.jsx_container_span().is_some() && !value.is_missing() {
                check_assignment(cx, || NameOf(node).ty(), value, value.span(), true);
            }
        });

        // `ArrayExpression > SpreadElement`
        on.exprs([ExprTag::Spread], |_, node, cx| {
            let ExprKind::Spread(argument) = node.kind() else {
                return;
            };
            if !matches!(node.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Array && !parent.is_assignment_target())
            {
                return;
            }
            let rest_type = argument.ty();
            if is_type_any_type(rest_type) || is_type_any_array_type(rest_type) {
                cx.report(node, UNSAFE_ARRAY_SPREAD).data("sender", describe_sender(rest_type));
            }
        });
    }
}
