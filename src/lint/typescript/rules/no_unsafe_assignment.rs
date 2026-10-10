use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    CompilerOption, is_intrinsic_error_type, is_strict_compiler_option_enabled,
};
use bun_lint::types::utils::{
    get_constrained_type_at_location, is_type_any_array_type, is_type_any_type,
    is_type_unknown_type, is_unsafe_assignment,
};
use bun_lint::types::{NameOf, TsSymbol, Type};
use bun_lint::utils::ts_utils::get_this_expression;
use bun_lint::utils::{Target, TargetElement, TargetKind};
use rustc_hash::FxHashMap;

/// Disallow assigning a value with type `any` to variables and properties.
pub struct NoUnsafeAssignment;

const ANY_ASSIGNMENT: Message =
    Message::new("anyAssignment", "Unsafe assignment of an {{sender}} value.");
const ANY_ASSIGNMENT_THIS: Message = Message::new(
    "anyAssignmentThis",
    "Unsafe assignment of an {{sender}} value. `this` is typed as `any`.\nYou can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.",
);
const UNSAFE_ARRAY_PATTERN: Message = Message::new(
    "unsafeArrayPattern",
    "Unsafe array destructuring of an {{sender}} array value.",
);
const UNSAFE_ARRAY_PATTERN_FROM_TUPLE: Message = Message::new(
    "unsafeArrayPatternFromTuple",
    "Unsafe array destructuring of a tuple element with an {{sender}} value.",
);
const UNSAFE_ARRAY_SPREAD: Message = Message::new(
    "unsafeArraySpread",
    "Unsafe spread of an {{sender}} value in an array.",
);
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
fn describe_sender(sender_type: Type, cx: &Context) -> &'static str {
    match (
        is_intrinsic_error_type(sender_type),
        cx.language().is_oxlint,
    ) {
        (true, _) => "error typed",
        (false, false) => "`any`",
        (false, true) => "any",
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
fn type_of_key<'a>(
    file: &'a File<'a>,
    key: Option<Key<'a>>,
    name: impl FnOnce() -> Type<'a>,
) -> Type<'a> {
    match key.map(Key::kind) {
        // For tsgolint the type at a name in brackets is that of the property too.
        _ if file.language().is_oxlint => name(),
        Some(KeyKind::Computed(expression)) => expression.ty(),
        // The type of the literal, of which it only matters that it is a primitive.
        Some(KeyKind::ComputedString(_)) => file.type_checker().get_string_type(),
        Some(KeyKind::ComputedNumber(_)) => file.type_checker().get_number_type(),
        _ => name(),
    }
}

/// What is assigned to a part of a pattern: its type, or the property that it is the value of.
enum Sender<'a> {
    Type(Type<'a>),
    Property(TsSymbol<'a>),
}

/// An element of an array pattern or the value of a property of an object pattern.
struct Destructured<'a> {
    /// [`span_of_value`]
    span: Span,
    has_default: bool,
    target: Target<'a>,
    sender: Sender<'a>,
    message: Message,
}

impl<'a> Destructured<'a> {
    fn new(
        element: &TargetElement<'a>,
        target: Target<'a>,
        sender: Sender<'a>,
        message: Message,
    ) -> Self {
        // tsgolint looks at the name of a binding element, whatever its default is.
        let is_name_alone = matches!(target, Target::Pat(pat) if pat.file().language().is_oxlint);
        Destructured {
            span: if is_name_alone { target.span() } else { span_of_value(element) },
            has_default: element.default.is_some() && !is_name_alone,
            target,
            sender,
            message,
        }
    }
}

/// tsgolint's `assignmentRelationRange`: the `=` or the `:` before what is assigned, in `whole`.
fn relation_span(sender_node: Expr, whole: Span) -> Span {
    let file = sender_node.file();
    let sender = sender_node
        .jsx_container_span()
        .unwrap_or_else(|| sender_node.outer_span());
    let end = file.end_of_token_before(sender.start);
    match file.text().get(end.wrapping_sub(1) as usize) {
        Some(b'=' | b':') if end > whole.start => Span::new(end - 1, end),
        _ => whole,
    }
}

/// Where a report is shown, and where the comments that disable the rule apply to it. For oxlint these are two places.
#[derive(Copy, Clone)]
struct Place {
    shown: Span,
    of_comments: Span,
}

fn check_destructure<'a>(
    cx: &Context<'a>,
    receiver_node: Target<'a>,
    receiver_span: Span,
    sender_type: Type<'a>,
    sender_node: Expr<'a>,
) {
    // oxlint points at what is assigned.
    let place = |span: Span| Place {
        shown: if cx.language().is_oxlint {
            sender_node.outer_span()
        } else {
            span
        },
        of_comments: span,
    };
    // Not by recursion: a pattern is nested as deeply as the parser allows. The last is the next.
    let mut parts = Vec::new();
    check_pattern(
        cx,
        receiver_node,
        place(receiver_span),
        sender_type,
        &mut parts,
    );
    while let Some(part) = parts.pop() {
        let sender_type = match part.sender {
            Sender::Type(ty) => ty,
            Sender::Property(property) => property.get_type_at_location(sender_node),
        };
        // The any type comes first, to handle `[[[x]]] = [any]` and `{ x: { y: z } } = { x: any }`.
        if is_type_any_type(sender_type) {
            cx.report(place(part.span).shown, part.message)
                .comments_apply_at(part.span)
                .data("sender", describe_sender(sender_type, cx))
                .labels_with(|labels| {
                    let ty = diagnostic_type_text(sender_type);
                    labels.first(format!("Destructured source provides type `{ty}`."));
                    labels.push(part.span, format!("This binding receives type `{ty}`."));
                    labels.push(part.span, "");
                });
        } else if !part.has_default {
            check_pattern(
                cx,
                part.target,
                place(part.target.span()),
                sender_type,
                &mut parts,
            );
        }
    }
}

/// Adds the parts of `receiver_node` to `parts`, the first of them last.
fn check_pattern<'a>(
    cx: &Context<'a>,
    receiver_node: Target<'a>,
    receiver_span: Place,
    sender_type: Type<'a>,
    parts: &mut Vec<Destructured<'a>>,
) {
    let others = parts.len();
    match receiver_node.kind() {
        TargetKind::Array => {
            check_array_destructure(cx, receiver_node, receiver_span, sender_type, parts)
        }
        TargetKind::Object => check_object_destructure(receiver_node, sender_type, parts),
        TargetKind::Ident(_) | TargetKind::Other(_) => {}
    }
    if let Some(added) = parts.get_mut(others..) {
        added.reverse();
    }
}

fn check_array_destructure<'a>(
    cx: &Context<'a>,
    receiver_node: Target<'a>,
    receiver_span: Place,
    sender_type: Type<'a>,
    parts: &mut Vec<Destructured<'a>>,
) {
    // `const [x] = [] as any[];`
    if is_type_any_array_type(sender_type) {
        cx.report(receiver_span.shown, UNSAFE_ARRAY_PATTERN)
            .comments_apply_at(receiver_span.of_comments)
            .data("sender", describe_sender(sender_type, cx))
            .labels_with(|labels| {
                let ty = diagnostic_type_text(sender_type);
                labels.first(format!("Destructured source provides type `{ty}`."));
                labels.push(receiver_span.of_comments, "This binding receives type `any`.");
                labels.push(receiver_span.of_comments, "");
            });
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
            let (sender, message) = (Sender::Type(sender_type), UNSAFE_ARRAY_PATTERN_FROM_TUPLE);
            parts.push(Destructured::new(receiver_element, target, sender, message));
        }
    }
}

fn check_object_destructure<'a>(
    receiver_node: Target<'a>,
    sender_type: Type<'a>,
    parts: &mut Vec<Destructured<'a>>,
) {
    let properties = sender_type.get_properties();
    // The first of each name, if they are many.
    let properties_by_name = (properties.len() > 16).then(|| {
        let mut by_name = FxHashMap::default();
        for property in properties {
            by_name.entry(property.name()).or_insert(property);
        }
        by_name
    });
    for receiver_property in &receiver_node.elements() {
        let (Some(key), Some(target), false) = (
            receiver_property.key,
            receiver_property.target,
            receiver_property.is_rest,
        ) else {
            continue;
        };
        let key = match key.kind() {
            KeyKind::Computed(expression) => name_of_keyword(expression),
            _ => key.name().map(Name::bytes),
        };
        let Some(key) = key else {
            continue;
        };
        let property = match &properties_by_name {
            Some(by_name) => by_name.get(key).copied(),
            None => properties.iter().find(|it| it.name() == key),
        };
        let Some(property) = property else {
            continue;
        };
        let sender = Sender::Property(property);
        parts.push(Destructured::new(
            receiver_property,
            target,
            sender,
            UNSAFE_OBJECT_PATTERN,
        ));
    }
}

/// What tsgolint has for what is assigned: with its parentheses, but for the value of a property.
fn sender_span(sender_node: Expr) -> Span {
    match sender_node.parent() {
        Node::Prop(property) if !property.is_jsx_attribute() => sender_node.span(),
        _ => sender_node.outer_span(),
    }
}

/// tsgolint's `diagnosticTypeText`
fn diagnostic_type_text(ty: Type) -> bstr::BString {
    match is_intrinsic_error_type(ty) {
        true => bstr::BString::from("error"),
        false => bstr::BString::from(ty.to_text()),
    }
}

/// `target`: tsgolint's `localTargetRange`, the type annotation of what is assigned to, or that itself.
fn report_any_assignment<'a>(
    cx: &Context<'a>,
    sender_node: Expr<'a>,
    sender_type: Type<'a>,
    reporting_node: Span,
    receiver_type: Type<'a>,
    target: Span,
    compares: bool,
) {
    let options = cx.file().type_checker().compiler_options();
    // `var foo = this`
    let any_this = get_this_expression(sender_node)
        .filter(|_| !is_strict_compiler_option_enabled(options, CompilerOption::NoImplicitThis))
        .filter(|&this| is_type_any_type(get_constrained_type_at_location(this)));
    let message = if any_this.is_some() {
        ANY_ASSIGNMENT_THIS
    } else {
        ANY_ASSIGNMENT
    };
    // oxlint points at what is assigned, or at the `this`.
    let place = match cx.language().is_oxlint {
        true => any_this.map_or_else(|| sender_span(sender_node), |this| this.outer_span()),
        false => reporting_node,
    };
    cx.report(place, message)
        .comments_apply_at(relation_span(sender_node, reporting_node))
        .data("sender", describe_sender(sender_type, cx))
        .labels_with(|labels| {
            labels.first(match any_this {
                Some(this) => {
                    format!("`this` has type `{}`.", diagnostic_type_text(get_constrained_type_at_location(this)))
                }
                None => format!("Assigned value has type `{}`.", diagnostic_type_text(sender_type)),
            });
            let how = if compares { "Target expects type" } else { "Target is inferred as" };
            labels.push(target, format!("{how} `{}`.", diagnostic_type_text(receiver_type)));
            labels.push(relation_span(sender_node, reporting_node), "");
        });
}

/// Whether it is reported. `compares`: upstream's `comparisonType !== ComparisonType.None`.
fn check_assignment_of_type<'a>(
    cx: &Context<'a>,
    receiver_type: &dyn Fn() -> Type<'a>,
    sender_node: Expr<'a>,
    sender_type: Type<'a>,
    reporting_node: Span,
    target: Span,
    compares: bool,
) -> bool {
    if is_type_any_type(sender_type) {
        // any ==> unknown
        let receiver_type = receiver_type();
        if is_type_unknown_type(receiver_type) {
            return false;
        }
        report_any_assignment(cx, sender_node, sender_type, reporting_node, receiver_type, target, compares);
        return true;
    }
    compares
        && report_unsafe_assignment(
            cx,
            receiver_type(),
            sender_node,
            sender_type,
            reporting_node,
            target,
        )
}

/// Whether it is reported.
fn report_unsafe_assignment<'a>(
    cx: &Context<'a>,
    receiver_type: Type<'a>,
    sender_node: Expr<'a>,
    sender_type: Type<'a>,
    reporting_node: Span,
    target: Span,
) -> bool {
    let Some(result) = is_unsafe_assignment(sender_type, receiver_type, sender_node) else {
        return false;
    };
    let place = if cx.language().is_oxlint {
        sender_span(sender_node)
    } else {
        reporting_node
    };
    cx.report(place, UNSAFE_ASSIGNMENT)
        .comments_apply_at(relation_span(sender_node, reporting_node))
        .data("receiver", in_backticks(result.receiver))
        .data("sender", in_backticks(result.sender))
        .labels_with(|labels| {
            labels.first(format!("Assigned value has type `{}`.", diagnostic_type_text(result.sender)));
            labels.push(target, format!("Target expects type `{}`.", diagnostic_type_text(result.receiver)));
            labels.push(relation_span(sender_node, reporting_node), "");
        });
    true
}

fn check_assignment<'a>(
    cx: &Context<'a>,
    receiver_type: &dyn Fn() -> Type<'a>,
    sender_node: Expr<'a>,
    reporting_node: Span,
    target: Span,
    compares: bool,
) -> bool {
    // Neither `any` nor a type with type arguments.
    if matches!(
        sender_node.tag(),
        ExprTag::Number
            | ExprTag::String
            | ExprTag::BigInt
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Null
    ) {
        return false;
    }
    check_assignment_of_type(
        cx,
        receiver_type,
        sender_node,
        sender_node.ty(),
        reporting_node,
        target,
        compares,
    )
}

/// What is done for an `AssignmentExpression`, an `AssignmentPattern` and a `VariableDeclarator`.
/// `left_span`: the range of `left` with its type annotation.
fn check_assignment_to_target<'a>(
    cx: &Context<'a>,
    left: Target<'a>,
    left_span: Span,
    right: Expr<'a>,
    node: Span,
    target: Span,
    compares: bool,
) {
    let receiver_type = || match left {
        Target::Pat(it) => it.ty(),
        Target::Expr(it) => it.ty(),
    };
    if !check_assignment(cx, &receiver_type, right, node, target, compares)
        && matches!(left.kind(), TargetKind::Array | TargetKind::Object)
    {
        check_destructure(cx, left, left_span, right.ty(), right);
    }
}

fn check_property<'a>(cx: &Context<'a>, node: Prop<'a>, value: Expr<'a>) {
    // The properties of an object pattern are checked via assignments.
    if node.is_import_attribute()
        || matches!(node.parent(), Node::Expr(object) if object.is_assignment_target())
    {
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
                // tsgolint asks the same of the value first, which answers for a bare name too: `{ [a]: b }`, and not
                // `{ [a]: b() }` or `{ [a]: (b) }`.
                let is_bare_name = value.tag() == ExprTag::Ident && !value.is_parenthesized();
                let contextual_type = match key.map(Key::kind) {
                    Some(KeyKind::Ident(_)) => value.contextual_type(),
                    _ if file.language().is_oxlint && is_bare_name => value.contextual_type(),
                    _ => None,
                };
                contextual_type.unwrap_or_else(type_of_name)
            };
            let target = key.map_or_else(|| node.span(), |it| it.span(file));
            check_assignment(cx, &receiver_type, value, node.span(), target, true);
        }
        PropKind::Method | PropKind::Getter | PropKind::Setter => {
            if node.func().is_some_and(Func::has_body) {
                // TypeScript's node for the function is the method or the accessor.
                check_assignment_of_type(
                    cx,
                    &type_of_name,
                    value,
                    node.type_at_location(),
                    node.span(),
                    key.map_or_else(|| node.span(), |it| it.span(file)),
                    true,
                );
            }
        }
    }
}

impl NoUnsafeAssignment {
    // `AssignmentExpression[operator = "="]`, and an `AssignmentPattern` in an assignment.
    fn assign<'a>(node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Assign {
            op: None,
            target,
            value,
        } = node.kind()
        {
            check_assignment_to_target(
                cx,
                Target::Expr(target),
                target.span(),
                value,
                node.span(),
                target.outer_span(),
                true,
            );
        }
    }

    // `ArrayExpression > SpreadElement`
    fn spread<'a>(node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Spread(argument) = node.kind() else {
            return;
        };
        if !matches!(node.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Array && !parent.is_assignment_target())
        {
            return;
        }
        let rest_type = argument.ty();
        if is_type_any_type(rest_type) || is_type_any_array_type(rest_type) {
            let place = if cx.language().is_oxlint {
                argument.outer_span()
            } else {
                node.span()
            };
            cx.report(place, UNSAFE_ARRAY_SPREAD)
                .comments_apply_at(node)
                .data("sender", describe_sender(rest_type, cx))
                .labels_with(|labels| {
                    labels.first(format!("Spread value has type `{}`.", diagnostic_type_text(rest_type)));
                    labels.push(Span::new(node.span().start, node.span().start + 3), "");
                });
        }
    }
}

impl NoUnsafeAssignment {
    // An `AssignmentPattern` in a declaration.
    fn check_param<'a>(node: Param<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(right) = node.default() {
            let left = Target::Pat(node.pat());
            check_assignment_to_target(
                cx,
                left,
                node.binding_span(),
                right,
                node.span_without_modifiers(),
                node.ty().map_or_else(|| node.pat().span(), |it| it.outer_span()),
                true,
            );
        }
    }

    fn check_pattern<'a>(pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        match pattern.kind() {
            PatKind::Array(elements) => {
                for element in elements {
                    if let (Some(left), Some(right)) = (element.pat(), element.default()) {
                        check_assignment_to_target(
                            cx,
                            Target::Pat(left),
                            left.span(),
                            right,
                            element.span(),
                            left.span(),
                            true,
                        );
                    }
                }
            }
            PatKind::Object(properties) => {
                for property in properties {
                    if let Some(right) = property.default() {
                        let left = property.value();
                        let node = Span::new(left.span().start, property.span().end);
                        check_assignment_to_target(
                            cx,
                            Target::Pat(left),
                            left.span(),
                            right,
                            node,
                            left.span(),
                            true,
                        );
                    }
                }
            }
            PatKind::Ident(_) | PatKind::Missing => {}
        }
    }

    // `VariableDeclarator[init != null]`
    fn check_declarator<'a>(node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(init) = node.init() {
            // Without an annotation the type of the variable is inferred, thus equal.
            let compares = node.ty().is_some();
            check_assignment_to_target(
                cx,
                Target::Pat(node.pat()),
                node.binding_span(),
                init,
                node.span(),
                node.ty().map_or_else(|| node.pat().span(), |it| it.outer_span()),
                compares,
            );
        }
    }
}

/// What has a target and a value.
pub enum Assignment<'a> {
    Expr(Expr<'a>),
    Param(Param<'a>),
    Pattern(Pat<'a>),
    Declarator(VarDecl<'a>),
}

impl Rule for NoUnsafeAssignment {
    const META: Meta = Meta::typescript("no-unsafe-assignment", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new()
        .members()
        .exprs(&[ExprTag::Assign, ExprTag::Spread])
        .params()
        .pats(&[PatTag::Array, PatTag::Object])
        .var_decls()
        .props()
        .finish();
    /// They are checked at the end, the outer ones first: two of them can report at one place, and ESLint has them in that order.
    type State<'a> = Vec<(Span, Assignment<'a>)>;

    fn new(_: &Options) -> Self {
        NoUnsafeAssignment
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(Vec::new())
    }

    // `AccessorProperty[value != null]`, `PropertyDefinition[value != null]`
    fn member<'a>(&self, node: Member<'a>, cx: &mut Cx<'a, Self>) {
        let Some(value) = node.init() else {
            return;
        };
        if node.kind() != MemberKind::Property
            || node.is_signature()
            || node.flags().contains(Flags::ABSTRACT)
        {
            return;
        }
        let file = cx.file();
        let receiver_type = || type_of_key(file, node.key(), || NameOf(node).ty());
        let name = || node.key().map_or_else(|| node.span(), |it| it.span(file));
        let target = node.ty().map_or_else(name, |it| it.outer_span());
        check_assignment(cx, &receiver_type, value, node.span(), target, node.ty().is_some());
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            ExprTag::Assign => cx.state.push((node.span(), Assignment::Expr(node))),
            ExprTag::Spread => Self::spread(node, cx),
            _ => {}
        }
    }

    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        cx.state
            .push((pattern.span(), Assignment::Pattern(pattern)));
    }

    fn param<'a>(&self, node: Param<'a>, cx: &mut Cx<'a, Self>) {
        cx.state
            .push((node.span_without_modifiers(), Assignment::Param(node)));
    }

    fn var_decl<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.push((node.span(), Assignment::Declarator(node)));
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut assignments = std::mem::take(&mut cx.state);
        assignments.sort_by_key(|it| (it.0.start, std::cmp::Reverse(it.0.end)));
        for (_, assignment) in assignments {
            match assignment {
                Assignment::Expr(node) => Self::assign(node, cx),
                Assignment::Param(node) => Self::check_param(node, cx),
                Assignment::Pattern(pattern) => Self::check_pattern(pattern, cx),
                Assignment::Declarator(node) => Self::check_declarator(node, cx),
            }
        }
    }

    // `:not(ObjectPattern) > Property`, `JSXAttribute[value != null]`
    fn prop<'a>(&self, node: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let Some(value) = node.value() else {
            return;
        };
        if !node.is_jsx_attribute() {
            check_property(cx, node, value);
        } else if node.kind() != PropKind::Spread
            && value.jsx_container_span().is_some()
            && !value.is_missing()
        {
            let target = node.key().map_or_else(|| node.span(), |it| it.span(cx.file()));
            // tsgolint asks for the contextual type of the value, and its diagnostic is at the `=`.
            let is_oxlint = cx.language().is_oxlint;
            let receiver_type = || {
                let contextual_type = if is_oxlint { value.contextual_type() } else { None };
                contextual_type.unwrap_or_else(|| NameOf(node).ty())
            };
            let whole = if is_oxlint { node.span() } else { value.span() };
            check_assignment(cx, &receiver_type, value, whole, target, true);
        }
    }
}
