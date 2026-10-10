use bun_lint_oxlint::ast_util::static_name;
use crate::jsx::{get_prop_value, has_jsx_prop_ignore_case};
use crate::react::is_create_element_call;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce the `sandbox` attribute on `iframe` elements.
pub struct IframeMissingSandbox;

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
    const META: Meta = Meta::oxlint(Plugin::React, "iframe-missing-sandbox", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    type State<'a> = ();

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

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("iframe").then_some(())
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
    fn jsx<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let Some(identifier) = jsx.tag().filter(|it| it.is_ident("iframe")) else {
            return;
        };
        match has_jsx_prop_ignore_case(jsx, "sandbox") {
            None => drop(cx.report(identifier, MISSING_SANDBOX_PROP)),
            Some(sandbox_prop) => {
                if let Some(literal) = get_prop_value(sandbox_prop).and_then(|it| it.as_string_literal()) {
                    validate_sandbox_value(literal.value, literal.span, cx);
                }
            }
        }
    }

    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|call| is_create_element_call(*call)) else {
            return;
        };
        let arguments = call.args();
        if !arguments
            .first()
            .is_some_and(|it| it.as_string().is_some_and(|it| it.is("iframe")) && !it.is_parenthesized())
        {
            return;
        }
        let Some((object, ExprKind::Object(properties))) =
            arguments.get(1).filter(|it| !it.is_parenthesized()).map(|it| (it, it.kind()))
        else {
            cx.report(e, MISSING_SANDBOX_PROP);
            return;
        };
        let Some(sandbox_prop) =
            properties.iter().find(|it| it.key().and_then(static_name).is_some_and(|key| key.is("sandbox")))
        else {
            cx.report(object, MISSING_SANDBOX_PROP);
            return;
        };
        if let Some(literal) = sandbox_prop.value()
            && let Some(value) = literal.as_string()
        {
            validate_sandbox_value(value.bytes(), literal.span(), cx);
        }
    }
}

fn validate_sandbox_value<'a>(value: &'a [u8], span: Span, cx: &Cx<'a, IframeMissingSandbox>) {
    let (mut has_allow_same_origin, mut has_allow_scripts) = (false, false);
    for trimmed_atr in strings::split(value, b" ").map(strings::trim_unicode_whitespace) {
        if !trimmed_atr.is_empty() && !ALLOWED_VALUES.contains(&trimmed_atr) {
            cx.report(span, INVALID_SANDBOX_PROP).data("value", trimmed_atr);
        }
        has_allow_scripts |= trimmed_atr == b"allow-scripts";
        has_allow_same_origin |= trimmed_atr == b"allow-same-origin";
    }
    if has_allow_scripts && has_allow_same_origin {
        cx.report(span, INVALID_SANDBOX_COMBINATION_PROP);
    }
}
