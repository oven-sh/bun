use crate::jsx::{get_jsx_attribute_name, get_string_literal_prop_value, has_jsx_prop};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents the usage of `<a>` elements to navigate between Next.js pages.
pub struct NoHtmlLinkForPages;

const NO_HTML_LINK_FOR_PAGES: Message = Message::new("", "Do not use `<a>` elements to navigate between Next.js pages.");

impl Rule for NoHtmlLinkForPages {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-html-link-for-pages", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoHtmlLinkForPages
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("href") {
            return;
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            if !jsx.tag().is_some_and(|it| it.is_ident("a")) {
                return;
            }
            let has_target_blank = jsx.attrs().iter().any(|it| {
                get_jsx_attribute_name(it).is_some_and(|name| name == b"target")
                    && get_string_literal_prop_value(it).is_some_and(|value| value == b"_blank")
            });
            if !has_target_blank
                && has_jsx_prop(jsx, "download").is_none()
                && has_jsx_prop(jsx, "href").and_then(get_string_literal_prop_value).is_some_and(is_internal_page_link)
            {
                cx.report(jsx.opening_span(), NO_HTML_LINK_FOR_PAGES);
            }
        });
    }
}

fn is_internal_page_link(href: &[u8]) -> bool {
    const OTHERS: [&[u8]; 8] = [b"http://", b"https://", b"//", b"mailto:", b"tel:", b"ftp:", b"file:", b"#"];
    if href.is_empty() || OTHERS.iter().any(|it| href.starts_with(it)) {
        return false;
    }
    let first_segment = strings::split_once_char(href, b'/').map_or(href, |it| it.0);
    !strings::contains_char(first_segment, b':')
}
