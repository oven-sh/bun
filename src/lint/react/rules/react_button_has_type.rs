use crate::jsx::{Child, children, get_jsx_attribute_name, get_string_literal_prop_value, has_jsx_prop_ignore_case};
use crate::react::{is_create_element_call, is_jsx};
use crate::util_ast::name_of_key;
use crate::util_is_create_element::is_create_element;
use crate::util_pragma::get_from_context;
use crate::util_prop_types::is_in_object_prototype;
use bun_core::strings;
use bun_lint::language::Parser;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::static_name;
use smallvec::{SmallVec, smallvec};
use std::borrow::Cow;
use std::cmp::Reverse;

/// Disallow usage of `button` elements without an explicit `type` attribute.
pub struct ButtonHasType {
    button: bool,
    submit: bool,
    reset: bool,
}

pub struct State<'a> {
    /// oxlint knows none.
    pragma: &'a [u8],
    /// What is reported as upstream does.
    found: Vec<Found<'a>>,
}

struct Found<'a> {
    /// The element or the call whose listener reports it.
    node: Span,
    at: Span,
    message: Message,
    value: Option<Cow<'a, [u8]>>,
}

const MISSING_TYPE: Message = Message::new("missingType", "Missing an explicit type attribute for button");
const COMPLEX_TYPE: Message = Message::new(
    "complexType",
    "The button type attribute must be specified by a static string or a trivial ternary expression",
);
const INVALID_VALUE: Message =
    Message::new("invalidValue", "\"{{value}}\" is an invalid value for button type attribute");
const FORBIDDEN_VALUE: Message =
    Message::new("forbiddenValue", "\"{{value}}\" is an invalid value for button type attribute");
const MISSING_TYPE_PROP: Message = Message::new("", "`button` elements must have an explicit `type` attribute.");
const INVALID_TYPE_PROP: Message = Message::new("", "`button` elements must have a valid `type` attribute.");

impl Rule for ButtonHasType {
    const META: Meta = Meta::plugin(Plugin::React, "button-has-type", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]).finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        ButtonHasType {
            button: options.bool_or("button", true),
            submit: options.bool_or("submit", true),
            reset: options.bool_or("reset", true),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Jsx]);
        if file.mentions("createElement") {
            on = on.exprs(&[ExprTag::Call]);
        }
        // oxlint has no two reports at one place.
        if !file.language().is_oxlint {
            on = on.finish();
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        let is_oxlint = file.language().is_oxlint;
        // oxlint looks only at files that can have JSX.
        if !file.mentions("button") || (is_oxlint && !is_jsx(file)) {
            return None;
        }
        let needs_pragma = !is_oxlint && file.mentions("createElement");
        Some(State { pragma: if needs_pragma { get_from_context(file) } else { &b""[..] }, found: Vec::new() })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => self.jsx(e, cx),
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut found = std::mem::take(&mut cx.state.found);
        // The listener of a node runs before those of what is in it.
        utils::sort::sort_by_key(&mut found, |it| (it.node.start, Reverse(it.node.end)));
        for Found { at, message, value, .. } in found {
            match value {
                Some(value) => drop(cx.report(at, message).data("value", value)),
                None => drop(cx.report(at, message)),
            }
        }
    }
}

impl ButtonHasType {
    fn jsx<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let Some(identifier) = jsx.tag().filter(|it| it.is_ident("button")) else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint does not look into `{...{ type: .. }}`.
        let Some(type_prop) = (if is_oxlint { has_jsx_prop_ignore_case(jsx, "type") } else { get_prop(jsx) }) else {
            report_missing(e, identifier.span(), cx);
            return;
        };
        let literal = match type_prop.value() {
            // `<button type />`
            None => Some(Cow::Borrowed(&b"true"[..])),
            Some(value) if value.jsx_container_span().is_some() => None,
            // oxlint reads `&amp;` as it is written, and nothing but a string.
            Some(_) if is_oxlint => Some(Cow::Borrowed(get_string_literal_prop_value(type_prop).unwrap_or_default())),
            Some(value) => get_literal_prop_value(value, type_prop.is_jsx_attribute()),
        };
        match (literal, type_prop.value()) {
            (Some(literal), _) => {
                if let Some(found) = self.check_value(e, literal, is_oxlint) {
                    self.report(found, type_prop, cx);
                }
            }
            (None, Some(expression)) => self.check_expression(e, type_prop, expression, cx),
            (None, None) => {}
        }
    }

    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint has a node for parentheses.
        let is_seen = |it: &Expr<'a>| !is_oxlint || !it.is_parenthesized();
        let arguments = call.args();
        if !arguments.first().filter(is_seen).and_then(Expr::as_string).is_some_and(|it| it.is("button")) {
            return;
        }
        // oxlint takes the `createElement` of everything but `document`.
        let is_creation = match is_oxlint {
            true => is_create_element_call(call),
            false => is_create_element(e, cx.state.pragma),
        };
        if !is_creation {
            return;
        }
        let Some((object, ExprKind::Object(properties))) = arguments.get(1).filter(is_seen).map(|it| (it, it.kind()))
        else {
            report_missing(e, e.span(), cx);
            return;
        };
        // oxlint: also `"type"`, and not `[type]`.
        let is_type = |key: Key<'a>| match is_oxlint {
            true => static_name(key).is_some_and(|name| name.is("type")),
            false => name_of_key(key).is_some_and(|name| name == b"type"),
        };
        let Some(type_prop) = properties.iter().find(|it| it.key().is_some_and(is_type)) else {
            report_missing(e, object.span(), cx);
            return;
        };
        if let Some(expression) = type_prop.value() {
            self.check_expression(e, type_prop, expression, cx);
        }
    }

    fn allowed_types_message(&self) -> &'static str {
        match (self.button, self.submit, self.reset) {
            (true, true, true) => "`button`, `submit`, or `reset`",
            (true, true, false) => "`button` or `submit`",
            (true, false, true) => "`button` or `reset`",
            (false, true, true) => "`submit` or `reset`",
            (true, false, false) => "`button`",
            (false, true, false) => "`submit`",
            (false, false, true) => "`reset`",
            (false, false, false) => "",
        }
    }

    /// `type_prop`: the attribute or the property.
    fn report<'a>(&self, found: Found<'a>, type_prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        // oxlint has one text for all that can be wrong with a value, and points at `type_prop`.
        if cx.language().is_oxlint {
            cx.report(type_prop, INVALID_TYPE_PROP).data("allowed_types", self.allowed_types_message());
        } else {
            cx.state.found.push(found);
        }
    }

    /// upstream's `checkExpression`: a value, or `a ? b : c` of such.
    fn check_expression<'a>(
        &self,
        node: Expr<'a>,
        type_prop: Prop<'a>,
        expression: Expr<'a>,
        cx: &mut Cx<'a, Self>,
    ) {
        let is_oxlint = cx.language().is_oxlint;
        let mut pending: SmallVec<[Expr<'a>; 4]> = smallvec![expression];
        while let Some(expression) = pending.pop() {
            let value = match expression.kind() {
                ExprKind::Cond { yes, no, .. } => {
                    pending.extend([no, yes]);
                    continue;
                }
                // oxlint takes the value, upstream what is written.
                ExprKind::Template(template) if is_oxlint => template.as_static().map(|it| Cow::Borrowed(it.bytes())),
                ExprKind::Template(template) if !template.exprs().is_empty() => None,
                // In espree's `raw` every line break is a line feed.
                ExprKind::Template(template) if cx.is_javascript() && cx.language().parser != Parser::TypeScript => {
                    Some(strings::crlf_as_lf(template.raw(0)))
                }
                ExprKind::Template(template) => Some(Cow::Borrowed(template.raw(0))),
                _ => ast_utils::get_static_string_value(expression),
            };
            let found = match value {
                Some(value) => self.check_value(node, value, is_oxlint),
                None => {
                    // A `JSXEmptyExpression` is all that is between the braces.
                    let braces = expression.jsx_container_span().filter(|_| expression.is_missing());
                    let at = braces.map_or_else(|| expression.span(), |it| it.shrink(1, 1));
                    Some(Found { node: node.span(), at, message: COMPLEX_TYPE, value: None })
                }
            };
            if let Some(found) = found {
                self.report(found, type_prop, cx);
                // oxlint says it once.
                if is_oxlint {
                    return;
                }
            }
        }
    }

    /// upstream's `checkValue`: what it reports.
    fn check_value<'a>(&self, node: Expr<'a>, value: Cow<'a, [u8]>, is_oxlint: bool) -> Option<Found<'a>> {
        let configured = match &*value {
            b"button" => Some(self.button),
            b"submit" => Some(self.submit),
            b"reset" => Some(self.reset),
            // `value in configuration` is also true of what `Object.prototype` has. oxlint compares.
            name => (!is_oxlint && is_in_object_prototype(name)).then_some(true),
        };
        let message = match configured {
            Some(true) => return None,
            Some(false) => FORBIDDEN_VALUE,
            None => INVALID_VALUE,
        };
        Some(Found { node: node.span(), at: node.span(), message, value: Some(value) })
    }
}

/// upstream's `reportMissing`. `oxlint_at`: where oxlint points.
fn report_missing<'a>(node: Expr<'a>, oxlint_at: Span, cx: &mut Cx<'a, ButtonHasType>) {
    if cx.language().is_oxlint {
        cx.report(oxlint_at, MISSING_TYPE_PROP);
    } else {
        cx.state.found.push(Found { node: node.span(), at: node.span(), message: MISSING_TYPE, value: None });
    }
}

/// `getProp(attributes, "type")` of jsx-ast-utils: the attribute, or the property of an object literal that is spread.
fn get_prop(jsx: Jsx<'_>) -> Option<Prop<'_>> {
    let is_prop_to_find = |name: Option<&[u8]>| name.is_some_and(|it| it.eq_ignore_ascii_case(b"type"));
    jsx.attrs().iter().find_map(|attribute| match attribute.kind() {
        PropKind::Spread => match attribute.value()?.kind() {
            ExprKind::Object(properties) => {
                properties.iter().find(|it| is_prop_to_find(it.key().and_then(name_of_key)))
            }
            _ => None,
        },
        _ => is_prop_to_find(get_jsx_attribute_name(attribute)).then_some(attribute),
    })
}

/// `String(getLiteralPropValue(prop))` of jsx-ast-utils, for a `value` that is not in braces. `None`: the value of a
/// property that is no `Literal`, which `getProp` puts into braces.
fn get_literal_prop_value(value: Expr<'_>, is_attribute: bool) -> Option<Cow<'_, [u8]>> {
    match value.kind() {
        ExprKind::Jsx(jsx) if is_attribute && jsx.is_fragment() => {
            let mut extracted = Vec::new();
            extract_value_from_jsx(jsx, value.file(), &mut extracted);
            Some(Cow::Owned(extracted))
        }
        ExprKind::Jsx(_) if is_attribute => Some(Cow::Borrowed(&b"null"[..])),
        _ if ast_utils::is_literal(value) => {
            let value = ast_utils::get_static_string_value(value)?;
            // `"TRUE"` is `true`.
            let boolean = [&b"true"[..], b"false"].into_iter().find(|it| value.eq_ignore_ascii_case(it));
            Some(boolean.map_or(value, Cow::Borrowed))
        }
        _ => None,
    }
}

/// `extractValueFromJSXFragment` and `extractValueFromJSXElement` of jsx-ast-utils. What is in braces is not evaluated.
fn extract_value_from_jsx<'a>(jsx: Jsx<'a>, file: &'a File<'a>, extracted: &mut Vec<u8>) {
    // `openingElement.name.name`
    let tag: &[u8] = match jsx.tag().map(Expr::kind) {
        None => b"",
        Some(ExprKind::Ident(name)) => name.bytes(),
        Some(ExprKind::String(name)) if strings::contains_char(name.bytes(), b':') => b"[object Object]",
        Some(ExprKind::String(name)) => name.bytes(),
        Some(ExprKind::Dot { .. }) => b"undefined",
        Some(_) => b"this",
    };
    extracted.push(b'<');
    extracted.extend_from_slice(tag);
    if jsx.is_self_closing() {
        extracted.extend_from_slice(b" />");
        return;
    }
    extracted.push(b'>');
    for child in children(file, jsx) {
        match child {
            Child::Text(raw) => extracted.extend_from_slice(raw),
            Child::Element(jsx) | Child::Fragment(jsx) => extract_value_from_jsx(jsx, file, extracted),
            Child::ExpressionContainer(e) => {
                let value = ast_utils::get_static_string_value(e);
                extracted.extend_from_slice(&value.unwrap_or_else(|| Cow::Borrowed(e.text())));
            }
            Child::Spread => {}
        }
    }
    extracted.extend_from_slice(b"</");
    extracted.extend_from_slice(tag);
    extracted.push(b'>');
}
