use crate::jsx::{as_jsx_element, get_prop_value, get_string_literal_prop_value, has_jsx_prop_ignore_case};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces the use of the `next/script` component when implementing Google Analytics in Next.js applications, instead of using
/// regular `<script>` tags.
pub struct NextScriptForGa;

const NEXT_SCRIPT_FOR_GA: Message =
    Message::new("", "Prefer `next/script` component when using the inline script for Google Analytics.");

const SUPPORTED_SRCS: [&[u8]; 2] = [b"www.google-analytics.com/analytics.js", b"www.googletagmanager.com/gtag/js"];
const SUPPORTED_HTML_CONTENT_URLS: [&[u8]; 2] = [b"www.google-analytics.com/analytics.js", b"www.googletagmanager.com/gtm.js"];

impl Rule for NextScriptForGa {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "next-script-for-ga", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NextScriptForGa
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("script") {
            return;
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let Some(jsx) = as_jsx_element(e) else {
                return;
            };
            let Some(name) = jsx.tag().filter(|it| it.is_ident("script")) else {
                return;
            };
            let src = has_jsx_prop_ignore_case(jsx, "src").and_then(get_string_literal_prop_value);
            let has_any = |text: &[u8], urls: [&[u8]; 2]| urls.iter().any(|url| strings::contains(text, url));
            if src.is_some_and(|src| has_any(src, SUPPORTED_SRCS))
                || matches!(get_dangerously_set_inner_html_prop_value(jsx).filter(|it| !it.is_parenthesized()).map(Expr::kind),
                    Some(ExprKind::Template(template)) if has_any(template.raw(0), SUPPORTED_HTML_CONTENT_URLS))
            {
                cx.report(name, NEXT_SCRIPT_FOR_GA);
            }
        });
    }
}

/// The `a` of `dangerouslySetInnerHTML={{ __html: a }}`.
fn get_dangerously_set_inner_html_prop_value(jsx: Jsx<'_>) -> Option<Expr<'_>> {
    let object = get_prop_value(has_jsx_prop_ignore_case(jsx, "dangerouslysetinnerhtml")?)?.as_expression()?;
    let ExprKind::Object(properties) = object.kind() else {
        return None;
    };
    if object.is_parenthesized() {
        return None;
    }
    let is_html = |it: &Prop| matches!(it.key().map(Key::kind), Some(KeyKind::Ident(name)) if name.is("__html"));
    properties.iter().find(is_html)?.value()
}
