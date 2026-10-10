use bun_lint_oxlint::ast_util::static_name;
use crate::jsx::{as_jsx_element, get_jsx_element_name};
use crate::react::{is_create_element_call, is_jsx};
use crate::util_jsx::is_dom_component;
use bun_core::strings;
use bun_glob::{Options as GlobOptions, Pattern};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;

/// Disallow usage of dangerous JSX properties.
pub struct NoDanger {
    custom_component_names: Vec<Pattern>,
}

const DANGEROUS_PROP: Message = Message::new("dangerousProp", "Dangerous property '{{name}}' found");
const NO_DANGER: Message = Message::new("", "Do not use `dangerouslySetInnerHTML` prop");

impl Rule for NoDanger {
    const META: Meta = Meta::plugin(Plugin::React, "no-danger", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let names = options.object(0).strings("customComponentNames");
        let minimatch = |name: &str| Pattern::new(name.as_bytes(), GlobOptions::MINIMATCH_3);
        NoDanger { custom_component_names: names.into_iter().map(minimatch).collect() }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        // oxlint also looks at the props of `createElement`.
        if !file.language().is_oxlint || !file.mentions("createElement") {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if (file.language().is_oxlint && !is_jsx(file)) || !file.mentions("dangerouslySetInnerHTML") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => {
                let Some(jsx) = as_jsx_element(e) else {
                    return;
                };
                let is_dangerous = |it: &Prop| it.key().is_some_and(|name| name.is("dangerouslySetInnerHTML"));
                let mut dangerous = jsx.attrs().iter().filter(is_dangerous).peekable();
                let Some(first) = dangerous.peek().and_then(|it| it.key()) else {
                    return;
                };
                // oxlint looks at every element, and points at the name of the first.
                if cx.language().is_oxlint {
                    cx.report(first.span(cx.file()), NO_DANGER);
                } else if is_dom_component(jsx) || self.is_custom_component(jsx) {
                    for attribute in dangerous {
                        cx.report(attribute.span(), DANGEROUS_PROP).data("name", "dangerouslySetInnerHTML");
                    }
                }
            }
            ExprTag::Call => {
                if let Some(call) = e.as_call()
                    && is_create_element_call(call)
                    && let Some(ExprKind::Object(properties)) =
                        call.args().get(1).filter(|it| !it.is_parenthesized()).map(Expr::kind)
                {
                    let is_danger =
                        |key: &Key| static_name(*key).is_some_and(|name| name.is("dangerouslySetInnerHTML"));
                    for key in properties.iter().filter_map(Prop::key).filter(is_danger) {
                        cx.report(key.inner_span(cx.file()), NO_DANGER);
                    }
                }
            }
            _ => {}
        }
    }
}

impl NoDanger {
    /// `enableCheckingCustomComponent`
    fn is_custom_component(&self, jsx: Jsx<'_>) -> bool {
        if self.custom_component_names.is_empty() {
            return false;
        }
        function_name(jsx).is_some_and(|name| self.custom_component_names.iter().any(|it| it.matches(&name)))
    }
}

/// `functionName`. `None` for `<a:b>`, where upstream has a node and no text.
fn function_name(jsx: Jsx<'_>) -> Option<Cow<'_, [u8]>> {
    match jsx.tag()?.kind() {
        ExprKind::String(name) if strings::contains_char(name.bytes(), b':') => None,
        // Upstream reads the `name` of an `object` that has none.
        ExprKind::Dot { obj, name, .. } if obj.tag() == ExprTag::Dot => {
            Some(Cow::Owned([&b"undefined."[..], name.bytes()].concat()))
        }
        _ => Some(get_jsx_element_name(jsx)),
    }
}
