use crate::jsx::{as_jsx_element, get_string_literal_prop_value, has_jsx_prop_ignore_case};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces the presence of `rel="preconnect"` when using Google Fonts via `<link>` tags.
pub struct GoogleFontPreconnect;

const GOOGLE_FONT_PRECONNECT: Message = Message::new("", "`rel=\"preconnect\"` is missing from Google Font.");

impl Rule for GoogleFontPreconnect {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "google-font-preconnect", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        GoogleFontPreconnect
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("link") {
            return;
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let Some(jsx) = as_jsx_element(e) else {
                return;
            };
            let Some(name) = jsx.tag().filter(|it| it.is_ident("link")) else {
                return;
            };
            let href = has_jsx_prop_ignore_case(jsx, "href").and_then(get_string_literal_prop_value);
            if !href.is_some_and(|it| it.starts_with(b"https://fonts.gstatic.com")) {
                return;
            }
            let rel = has_jsx_prop_ignore_case(jsx, "rel").and_then(get_string_literal_prop_value);
            if rel.is_none_or(|it| it != b"preconnect") {
                cx.report(name, GOOGLE_FONT_PRECONNECT);
            }
        });
    }
}
