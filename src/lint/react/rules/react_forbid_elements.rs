use bun_lint_oxlint::ast_util::get_inner_expression;
use crate::jsx::{as_jsx_element, get_element_type};
use crate::react::{is_jsx, is_react_function_call};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Allows you to configure a list of forbidden elements and to specify their desired replacements.
pub struct ForbidElements {
    /// Each with its message, which is the help. Of two with one name the last counts.
    forbid: Vec<(Box<[u8]>, Option<String>)>,
}

const FORBID_ELEMENTS: Message = Message::new("", "<{{element}}> is forbidden.");

impl Rule for ForbidElements {
    const META: Meta = Meta::oxlint(Plugin::React, "forbid-elements", Kind::Suggestion);
    type State<'a> = ();

    /// `{ forbid: ["a", { element: "b", message }] }`
    fn new(options: &Options) -> Self {
        let element = |item: &Json| {
            let message = item.get(b"message").and_then(Json::as_str).map(|it| bstr::BStr::new(it).to_string());
            Some((item.as_str().or_else(|| item.get(b"element")?.as_str())?.into(), message))
        };
        ForbidElements { forbid: options.object(0).array("forbid").iter().filter_map(element).collect() }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_jsx(file) || self.forbid.is_empty() {
            return;
        }
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            if let Some(jsx) = as_jsx_element(e)
                && let Some(name) = jsx.tag()
            {
                rule.add_diagnostic_if_invalid_element(&get_element_type(cx.file(), jsx), name.span(), cx);
            }
        });
        if !file.mentions("createElement") {
            return;
        }
        on.exprs([ExprTag::Call], |rule, e, cx| {
            let Some(call) = e.as_call().filter(|call| is_react_function_call(*call, "createElement")) else {
                return;
            };
            let Some(argument) = call.args().first().filter(|it| !it.is_parenthesized() && !it.is_chain_root()) else {
                return;
            };
            let first_char = |name: Name| strings::wtf8_first_codepoint(name.bytes()).and_then(char::from_u32);
            match argument.kind() {
                // `/^[A-Z_]/`
                ExprKind::Ident(name) if first_char(name).is_some_and(|c| c.is_uppercase() || c == '_') => {
                    rule.add_diagnostic_if_invalid_element(name.bytes(), argument.span(), cx);
                }
                // `/^[a-z][^.]*$/`
                ExprKind::String(name)
                    if first_char(name).is_some_and(char::is_lowercase)
                        && !strings::contains_char(name.bytes(), b'.') =>
                {
                    rule.add_diagnostic_if_invalid_element(name.bytes(), argument.span(), cx);
                }
                ExprKind::Dot { obj, name, .. } if !argument.is_private_member() => {
                    if let Some(object) = get_inner_expression(obj).as_ident() {
                        rule.add_diagnostic_if_invalid_element(
                            &[object.bytes(), b".", name.bytes()].concat(),
                            argument.span(),
                            cx,
                        );
                    }
                }
                _ => {}
            }
        });
    }
}

impl ForbidElements {
    fn add_diagnostic_if_invalid_element(&self, name: &[u8], span: Span, cx: &Cx<Self>) {
        if let Some((_, message)) = self.forbid.iter().rfind(|it| *it.0 == *name) {
            cx.report(span, FORBID_ELEMENTS)
                .data("element", name.to_vec())
                .help_with(|| message.clone().unwrap_or_default());
        }
    }
}
