use crate::jsx::{as_jsx_element, get_string_literal_prop_value, has_jsx_prop_ignore_case};
use crate::nextjs::find_url_query_value;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce font-display behavior with Google Fonts.
pub struct GoogleFontDisplay;

const FONT_DISPLAY_PARAMETER_MISSING: Message =
    Message::new("", "A font-display parameter is missing (adding `&display=optional` is recommended).");
const NOT_RECOMMENDED_FONT_DISPLAY_VALUE: Message =
    Message::new("", "`{{font_display_value}}` is not a recommended font-display value.");

impl Rule for GoogleFontDisplay {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "google-font-display", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        GoogleFontDisplay
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
            let Some(href_prop) = has_jsx_prop_ignore_case(jsx, "href") else {
                return;
            };
            let Some(href) = get_string_literal_prop_value(href_prop) else {
                return;
            };
            if !href.starts_with(b"https://fonts.googleapis.com/css") {
                return;
            }
            match find_url_query_value(href, b"display") {
                None => drop(cx.report(name, FONT_DISPLAY_PARAMETER_MISSING)),
                Some(value @ (b"auto" | b"block" | b"fallback")) => {
                    cx.report(href_prop, NOT_RECOMMENDED_FONT_DISPLAY_VALUE).data("font_display_value", value);
                }
                Some(_) => {}
            }
        });
    }
}
