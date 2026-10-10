use bun_lint_oxlint::ast_util::{get_inner_expression, iter_outer_expressions, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce correct `Error` subclassing.
pub struct CustomErrorDefinition;

const INVALID_CLASS_NAME: Message = Message::new("", "Invalid class name, use `{{expected}}`.");
const MISSING_SUPER_CALL: Message = Message::new("", "Missing call to `super()` in constructor.");
const INVALID_NAME_PROPERTY: Message = Message::new("", "The `name` property should be set to `{{name}}`.");
const PASS_MESSAGE_TO_SUPER: Message =
    Message::new("", "Pass the error message to `super()` instead of setting `this.message`.");
const INVALID_EXPORT: Message = Message::new("", "Exported error name should match error class");

/// `Error`, `TypeError`, `Http2Error`: words that start with a capital letter, the last of which is `Error`.
fn is_valid_super_class_name(name: &[u8]) -> bool {
    name.strip_suffix(b"Error").is_some_and(|prefix| {
        prefix.first().is_none_or(u8::is_ascii_uppercase) && prefix.iter().all(u8::is_ascii_alphanumeric)
    })
}

fn has_valid_super_class(class: Class) -> bool {
    let Some(super_class) = class.extends().map(get_inner_expression) else {
        return false;
    };
    let name = match super_class.tag() {
        ExprTag::Ident => super_class.as_ident(),
        ExprTag::Dot | ExprTag::Index if !super_class.is_chain_root() => static_property_name(super_class),
        _ => None,
    };
    name.is_some_and(|it| is_valid_super_class_name(it.bytes()))
}

/// The `a` of `exports.a = class ..`.
fn get_export_assignment_info(class: Class<'_>) -> Option<Ident<'_>> {
    let Node::Expr(class) = class.owner() else {
        return None;
    };
    let Node::Expr(assignment) = iter_outer_expressions(class).next()? else {
        return None;
    };
    if assignment.tag() != ExprTag::Assign || assignment.is_assignment_target() {
        return None;
    }
    match assignment.left()?.kind() {
        ExprKind::Dot { obj, name, .. } if obj.is_ident("exports") && !obj.is_parenthesized() => {
            Some(name).filter(|it| !it.bytes().starts_with(b"#"))
        }
        _ => None,
    }
}

/// `name` with a capital letter first and `Error` last.
fn get_class_name(name: &[u8]) -> Vec<u8> {
    let Ok(name) = std::str::from_utf8(name) else {
        return name.to_vec();
    };
    let mut chars = name.chars();
    let mut uppered: String = chars.next().into_iter().flat_map(char::to_uppercase).collect();
    uppered.push_str(chars.as_str());
    let stripped = uppered.len().checked_sub(5).and_then(|it| uppered.split_at_checked(it));
    if let Some(len) = stripped.filter(|it| it.1.eq_ignore_ascii_case("error")).map(|it| it.0.len()) {
        uppered.truncate(len);
    }
    uppered.push_str("Error");
    uppered.into_bytes()
}

/// The `e` of the statement `e;`.
fn expression_of(stmt: Stmt<'_>) -> Option<Expr<'_>> {
    match stmt.kind() {
        StmtKind::Expr(e) if !e.is_parenthesized() && stmt.directive().is_none() => Some(e),
        _ => None,
    }
}

fn is_super_call(stmt: Stmt) -> bool {
    let call = expression_of(stmt).filter(|it| it.tag() == ExprTag::Call && !it.is_chain_root());
    call.and_then(Expr::callee).is_some_and(|it| it.tag() == ExprTag::Super && !it.is_parenthesized())
}

/// The `a` of `this.prop_name = a;`.
fn this_assignment<'a>(stmt: Stmt<'a>, prop_name: &str) -> Option<Expr<'a>> {
    let ExprKind::Assign { target, value, .. } = expression_of(stmt)?.kind() else {
        return None;
    };
    match target.kind() {
        ExprKind::Dot { obj, name, .. }
            if obj.tag() == ExprTag::This && !obj.is_parenthesized() && name.name().is(prop_name) =>
        {
            Some(value)
        }
        _ => None,
    }
}

fn is_expected_string_literal<'a>(e: Expr<'a>, expected: Name<'a>) -> bool {
    e.as_string() == Some(expected) && !e.is_parenthesized()
}

impl Rule for CustomErrorDefinition {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "custom-error-definition", Kind::Suggestion);
    const ON: On = On::new().enter(NodeTags::CLASS);
    no_state!();

    fn new(_: &Options) -> Self {
        CustomErrorDefinition
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.has_classes() { Self::ON } else { On::new() }
    }

    // The outer one first, as oxlint: a class that is the value of `name` is reported twice at one place.
    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Class(class) = node else {
            return;
        };
        if !has_valid_super_class(class) {
            return;
        }
        let Some(id) = class.name() else {
            return;
        };
        let name = id.name();
        if let Some(exported) = get_export_assignment_info(class).filter(|it| it.name() != name) {
            cx.report(exported, INVALID_EXPORT);
        }
        let expected_class_name = get_class_name(name.bytes());
        if name.bytes() != expected_class_name {
            cx.report(id, INVALID_CLASS_NAME).data("expected", expected_class_name);
        }

        let constructors = || class.members().iter().filter(|it| it.is_constructor());
        let constructor_body = constructors().find_map(|it| it.func().filter(|it| it.has_body()));
        let is_name = |key: Key| matches!(key.kind(), KeyKind::Ident(_) | KeyKind::String(_)) && key.is("name");
        let name_property = class.members().iter().find(|it| {
            it.kind() == MemberKind::Property
                && !it.flags().intersects(Flags::STATIC | Flags::ACCESSOR)
                && it.key().is_some_and(is_name)
        });
        // Where the field says what the name is, if that is not the name of the class.
        let invalid_name_property = name_property.and_then(|property| match property.init() {
            Some(value) => (!is_expected_string_literal(value, name)).then(|| value.outer_span()),
            None => Some(property.span()),
        });

        let Some((constructor, body)) = constructor_body.and_then(|it| Some((it, it.body_span()?))) else {
            if constructors().next().is_none() {
                let span = if name_property.is_some() { invalid_name_property } else { Some(class.estree_span()) };
                if let Some(span) = span {
                    cx.report(span, INVALID_NAME_PROPERTY).data("name", name);
                }
            }
            return;
        };
        let statements = || constructor.body_statements().into_iter().flatten();
        match statements().find(|it| is_super_call(*it)) {
            None => {
                cx.report(body, MISSING_SUPER_CALL);
            }
            Some(super_call) if statements().any(|it| this_assignment(it, "message").is_some()) => {
                cx.report(super_call, PASS_MESSAGE_TO_SUPER);
            }
            Some(_) => {}
        }
        let invalid_name_span = match statements().find_map(|it| this_assignment(it, "name")) {
            Some(value) => (!is_expected_string_literal(value, name)).then(|| value.outer_span()),
            None if name_property.is_some() => invalid_name_property,
            None => Some(body),
        };
        if let Some(span) = invalid_name_span {
            cx.report(span, INVALID_NAME_PROPERTY).data("name", name);
        }
    }
}
