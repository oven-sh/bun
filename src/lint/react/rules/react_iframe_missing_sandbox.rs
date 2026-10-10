use crate::jsx::{get_jsx_attribute_name, get_prop_value, has_jsx_prop, has_jsx_prop_ignore_case};
use crate::react::is_create_element_call;
use crate::util_ast::name_of_key;
use crate::util_is_create_element::is_create_element;
use crate::util_pragma::get_from_context;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::static_name;

/// Enforce sandbox attribute on iframe elements
pub struct IframeMissingSandbox;

const ATTRIBUTE_MISSING: Message = Message::new("attributeMissing", "An iframe element is missing a sandbox attribute");
const INVALID_VALUE: Message =
    Message::new("invalidValue", "An iframe element defines a sandbox attribute with invalid value \"{{ value }}\"");
const INVALID_COMBINATION: Message = Message::new(
    "invalidCombination",
    "An iframe element defines a sandbox attribute with both allow-scripts and allow-same-origin which is invalid",
);
const MISSING_SANDBOX_PROP: Message = Message::new("", "An iframe element is missing a sandbox attribute");
const INVALID_SANDBOX_PROP: Message =
    Message::new("", "An iframe element defines a sandbox attribute with invalid value: {{value}}");
const INVALID_SANDBOX_COMBINATION_PROP: Message = Message::new(
    "",
    "An `iframe` element defines a sandbox attribute with both allow-scripts and allow-same-origin which is invalid",
);

const ALLOWED_VALUES: [&[u8]; 14] = [
    b"allow-downloads-without-user-activation",
    b"allow-downloads",
    b"allow-forms",
    b"allow-modals",
    b"allow-orientation-lock",
    b"allow-pointer-lock",
    b"allow-popups",
    b"allow-popups-to-escape-sandbox",
    b"allow-presentation",
    b"allow-same-origin",
    b"allow-scripts",
    b"allow-storage-access-by-user-activation",
    b"allow-top-navigation",
    b"allow-top-navigation-by-user-activation",
];

impl Rule for IframeMissingSandbox {
    const META: Meta = Meta::plugin(Plugin::React, "iframe-missing-sandbox", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    /// The pragma. oxlint knows none.
    type State<'a> = &'a [u8];

    fn new(_: &Options) -> Self {
        IframeMissingSandbox
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        if !file.mentions("createElement") {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<&'a [u8]> {
        let needs_pragma = !file.language().is_oxlint && file.mentions("createElement");
        file.mentions("iframe").then(|| if needs_pragma { get_from_context(file) } else { &b""[..] })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => self.jsx(e, cx),
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

impl IframeMissingSandbox {
    /// upstream's `checkAttributes`
    fn jsx<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let Some(identifier) = jsx.tag().filter(|it| it.is_ident("iframe")) else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // For oxlint `SANDBOX` is the attribute too.
        let first = if is_oxlint { has_jsx_prop_ignore_case(jsx, "sandbox") } else { has_jsx_prop(jsx, "sandbox") };
        let Some(first) = first else {
            // oxlint points at the name.
            let at = if is_oxlint { identifier.span() } else { jsx.opening_span() };
            cx.report(at, if is_oxlint { MISSING_SANDBOX_PROP } else { ATTRIBUTE_MISSING });
            return;
        };
        // oxlint looks at the first only.
        let is_checked = |it: &Prop<'a>| {
            *it == first || (!is_oxlint && get_jsx_attribute_name(*it).is_some_and(|name| name == b"sandbox"))
        };
        for sandbox_prop in jsx.attrs().iter().filter(is_checked) {
            let Some(literal) = get_prop_value(sandbox_prop).and_then(|it| it.as_string_literal()) else {
                continue;
            };
            // oxlint reads `&amp;` as it is written, and points at the value.
            let decoded = sandbox_prop.value().and_then(Expr::as_string).filter(|_| !is_oxlint);
            let at = if is_oxlint { literal.span } else { jsx.opening_span() };
            validate_sandbox_value(decoded.map_or(literal.value, Name::bytes), at, cx);
        }
    }

    /// upstream's `checkProps`
    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        // oxlint takes the `createElement` of everything but `document`.
        let is_creation = |call: &Call<'a>| match is_oxlint {
            true => is_create_element_call(*call),
            false => is_create_element(e, cx.state),
        };
        let Some(call) = e.as_call().filter(is_creation) else {
            return;
        };
        let missing = if is_oxlint { MISSING_SANDBOX_PROP } else { ATTRIBUTE_MISSING };
        // oxlint has a node for parentheses.
        let is_seen = |it: &Expr<'a>| !is_oxlint || !it.is_parenthesized();
        let arguments = call.args();
        if !arguments.first().filter(is_seen).and_then(Expr::as_string).is_some_and(|it| it.is("iframe")) {
            return;
        }
        let Some((object, ExprKind::Object(properties))) = arguments.get(1).filter(is_seen).map(|it| (it, it.kind()))
        else {
            cx.report(e, missing);
            return;
        };
        // oxlint: also `"sandbox"`, and not `[sandbox]`.
        let is_sandbox = |key: Key<'a>| match is_oxlint {
            true => static_name(key).is_some_and(|name| name.is("sandbox")),
            false => name_of_key(key).is_some_and(|name| name == b"sandbox"),
        };
        let Some(sandbox_prop) = properties.iter().find(|it| it.key().is_some_and(is_sandbox)) else {
            // oxlint points at the object.
            cx.report(if is_oxlint { object } else { e }, missing);
            return;
        };
        if let Some(literal) = sandbox_prop.value()
            && let Some(value) = literal.as_string()
        {
            // oxlint points at the value.
            validate_sandbox_value(value.bytes(), if is_oxlint { literal.span() } else { e.span() }, cx);
        }
    }
}

/// upstream's `validateSandboxAttribute`
fn validate_sandbox_value<'a>(value: &'a [u8], span: Span, cx: &Cx<'a, IframeMissingSandbox>) {
    let is_oxlint = cx.language().is_oxlint;
    // oxlint trims what Unicode calls white space.
    let trim: fn(&[u8]) -> &[u8] =
        if is_oxlint { strings::trim_unicode_whitespace } else { strings::trim_js_whitespace };
    let (mut has_allow_same_origin, mut has_allow_scripts) = (false, false);
    for trimmed_atr in strings::split(value, b" ").map(trim) {
        if !trimmed_atr.is_empty() && !ALLOWED_VALUES.contains(&trimmed_atr) {
            let invalid = if is_oxlint { INVALID_SANDBOX_PROP } else { INVALID_VALUE };
            cx.report(span, invalid).data("value", trimmed_atr);
        }
        has_allow_scripts |= trimmed_atr == b"allow-scripts";
        has_allow_same_origin |= trimmed_atr == b"allow-same-origin";
    }
    if has_allow_scripts && has_allow_same_origin {
        cx.report(span, if is_oxlint { INVALID_SANDBOX_COMBINATION_PROP } else { INVALID_COMBINATION });
    }
}
