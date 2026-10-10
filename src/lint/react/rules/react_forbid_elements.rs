use bun_lint_oxlint::ast_util::get_inner_expression;
use crate::jsx::{as_jsx_element, get_element_type};
use crate::react::{is_jsx, is_react_function_call};
use crate::util_is_create_element::is_create_element;
use crate::util_pragma::get_from_context;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;

/// Disallow certain elements
pub struct ForbidElements {
    /// Each with its message. Of two with one name the last counts.
    forbid: Vec<(Box<[u8]>, Option<String>)>,
}

const FORBIDDEN_ELEMENT: Message = Message::new("forbiddenElement", "<{{element}}> is forbidden");
const FORBIDDEN_ELEMENT_MESSAGE: Message =
    Message::new("forbiddenElement_message", "<{{element}}> is forbidden, {{message}}");
const FORBID_ELEMENTS: Message = Message::new("", "<{{element}}> is forbidden.");

/// Whether a call of `createElement` can be in the file. For upstream `a.#createElement()` is one.
fn mentions_create_element(file: &File) -> bool {
    file.mentions("createElement") || (!file.language().is_oxlint && file.mentions("#createElement"))
}

impl Rule for ForbidElements {
    const META: Meta = Meta::plugin(Plugin::React, "forbid-elements", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    /// The pragma.
    type State<'a> = &'a [u8];

    /// `{ forbid: ["a", { element: "b", message }] }`
    fn new(options: &Options) -> Self {
        let element = |item: &Json| {
            let message = item.get(b"message").and_then(Json::as_str).map(|it| bstr::BStr::new(it).to_string());
            Some((item.as_str().or_else(|| item.get(b"element")?.as_str())?.into(), message))
        };
        ForbidElements { forbid: options.object(0).array("forbid").iter().filter_map(element).collect() }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        if !mentions_create_element(file) {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<&'a [u8]> {
        if self.forbid.is_empty() {
            return None;
        }
        // oxlint looks only where JSX can be, and knows no pragma but `React`.
        if file.language().is_oxlint {
            return is_jsx(file).then_some(&b"React"[..]);
        }
        Some(if mentions_create_element(file) { get_from_context(file) } else { &b"React"[..] })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => {
                if let Some(jsx) = as_jsx_element(e)
                    && let Some(name) = jsx.tag()
                {
                    // oxlint asks the settings of jsx-a11y what the element is.
                    let element = match cx.language().is_oxlint {
                        true => get_element_type(cx.file(), jsx),
                        false => Cow::Borrowed(name.text()),
                    };
                    self.add_diagnostic_if_invalid_element(&element, name.span(), cx);
                }
            }
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

impl ForbidElements {
    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let Some(call) = e.as_call() else {
            return;
        };
        // oxlint takes every `createElement(..)` for React's.
        let creates_element = match is_oxlint {
            true => is_react_function_call(call, "createElement"),
            false => is_create_element(e, cx.state),
        };
        if !creates_element {
            return;
        }
        // Parentheses are nodes for oxlint.
        let is_plain = |it: &Expr<'a>| !it.is_chain_root() && !(is_oxlint && it.is_parenthesized());
        let Some(argument) = call.args().first().filter(is_plain) else {
            return;
        };
        let first_char = |name: Name| strings::wtf8_first_codepoint(name.bytes()).and_then(char::from_u32);
        // oxlint has the letters of Unicode.
        let is_uppercase = |c: char| if is_oxlint { c.is_uppercase() } else { c.is_ascii_uppercase() };
        let is_lowercase = |c: char| if is_oxlint { c.is_lowercase() } else { c.is_ascii_lowercase() };
        match argument.kind() {
            // `/^[A-Z_]/`
            ExprKind::Ident(name) if first_char(name).is_some_and(|c| is_uppercase(c) || c == '_') => {
                self.add_diagnostic_if_invalid_element(name.bytes(), argument.span(), cx);
            }
            // `/^[a-z][^.]*$/`
            ExprKind::String(name)
                if first_char(name).is_some_and(is_lowercase) && !strings::contains_char(name.bytes(), b'.') =>
            {
                self.add_diagnostic_if_invalid_element(name.bytes(), argument.span(), cx);
            }
            // upstream tests `String(value)` of every `Literal`, and takes a member expression as it is written.
            ExprKind::True | ExprKind::False | ExprKind::Null | ExprKind::Dot { .. } | ExprKind::Index { .. }
                if !is_oxlint =>
            {
                self.add_diagnostic_if_invalid_element(argument.text(), argument.span(), cx);
            }
            ExprKind::Dot { obj, name, .. } if !argument.is_private_member() => {
                if let Some(object) = get_inner_expression(obj).as_ident() {
                    self.add_diagnostic_if_invalid_element(
                        &[object.bytes(), b".", name.bytes()].concat(),
                        argument.span(),
                        cx,
                    );
                }
            }
            _ => {}
        }
    }

    fn add_diagnostic_if_invalid_element(&self, name: &[u8], span: Span, cx: &Cx<Self>) {
        let Some((_, message)) = self.forbid.iter().rfind(|it| *it.0 == *name) else {
            return;
        };
        // For oxlint the message is the help.
        if cx.language().is_oxlint {
            cx.report(span, FORBID_ELEMENTS)
                .data("element", name.to_vec())
                .help_with(|| message.clone().unwrap_or_default());
            return;
        }
        // upstream's table is an object, of which `__proto__` does not become a key.
        if name == b"__proto__" {
            return;
        }
        match message.as_ref().filter(|it| !it.is_empty()) {
            Some(message) => cx
                .report(span, FORBIDDEN_ELEMENT_MESSAGE)
                .data("element", name.to_vec())
                .data("message", message.clone()),
            None => cx.report(span, FORBIDDEN_ELEMENT).data("element", name.to_vec()),
        };
    }
}
