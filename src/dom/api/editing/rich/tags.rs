//! Kinds of HTML elements.

use super::Maybe;
use crate::api::ui::prelude::*;

/// What has or is the name of an HTML element.
pub(super) trait Tagged: Copy {
    fn html_name(self) -> Known;
}

impl Tagged for Known {
    fn html_name(self) -> Known {
        self
    }
}

impl Tagged for &Node {
    fn html_name(self) -> Known {
        self.html_tag()
    }
}

impl Tagged for Maybe<'_> {
    fn html_name(self) -> Known {
        self.map_or(Known::Other, Node::html_tag)
    }
}

pub(super) fn is(node: impl Tagged, tag: Known) -> bool {
    node.html_name() == tag
}

macro_rules! sets {
    ($($name:ident [$($tag:tt)+])+) => {$(
        pub(super) fn $name(node: impl Tagged) -> bool {
            matches!(node.html_name(), $(atom!($tag))|+)
        }
    )+};
}

sets! {
    is_list ["ol" "ul"]
    is_item ["li" "dt" "dd"]
    is_definition ["dt" "dd"]
    is_cell ["td" "th"]
    is_table_part ["thead" "tbody" "tfoot" "tr" "th" "td"]
    is_row_holder ["colgroup" "table" "tbody" "tfoot" "thead" "tr"]
    is_only_in_tables ["body" "caption" "col" "colgroup" "frame" "frameset" "head" "html" "tbody" "td" "tfoot" "th" "thead" "tr"]
    is_raw_text ["script" "style" "plaintext" "xmp"]
    is_replaced ["img" "input" "textarea" "select" "video" "audio" "canvas" "iframe" "object" "embed" "meter" "progress"]
    is_not_for_paragraphs ["address" "article" "aside" "blockquote" "caption" "center" "col" "colgroup" "dd" "details" "dir" "div" "dl" "dt"
        "fieldset" "figcaption" "figure" "footer" "form" "h1" "h2" "h3" "h4" "h5" "h6" "header" "hgroup" "hr" "li" "listing" "menu" "nav" "ol" "p"
        "plaintext" "pre" "section" "summary" "table" "tbody" "td" "tfoot" "th" "thead" "tr" "ul" "xmp"]
    is_inline_container ["a" "abbr" "b" "bdi" "bdo" "cite" "code" "dfn" "em" "h1" "h2" "h3" "h4" "h5" "h6" "i" "kbd" "mark" "p" "pre" "q" "rp" "rt"
        "ruby" "s" "samp" "small" "span" "strong" "sub" "sup" "u" "var" "acronym" "listing" "strike" "xmp" "big" "blink" "font" "marquee" "nobr" "tt"]
    is_modifiable_tag ["a" "b" "em" "font" "i" "s" "span" "strike" "strong" "sub" "sup" "u"]
    is_formatting ["abbr" "acronym" "b" "bdi" "bdo" "big" "blink" "cite" "code" "dfn" "em" "font" "i" "ins" "kbd" "mark" "nobr" "q" "s" "samp" "small"
        "span" "strike" "strong" "sub" "sup" "tt" "u" "var"]
    is_line_container ["address" "div" "h1" "h2" "h3" "h4" "h5" "h6" "listing" "p" "pre" "xmp"]
    is_preformatted ["listing" "pre" "xmp"]
    is_void ["area" "base" "br" "col" "embed" "hr" "link" "meta" "param" "source" "track" "wbr"]
    is_formattable_block ["address" "dd" "div" "dt" "h1" "h2" "h3" "h4" "h5" "h6" "p" "pre"]
    is_heading ["h1" "h2" "h3" "h4" "h5" "h6"]
    is_never_inserted ["script" "style" "meta" "link" "title" "base"]
    is_break ["br"]
}

pub(super) fn is_tag_allowed_in_tag(child: Known, parent: Known) -> bool {
    match parent {
        _ if is_raw_text(parent) => false,
        atom!("colgroup") => child == atom!("col"),
        atom!("table") => {
            is_table_part(child)
                || matches!(child, atom!("caption") | atom!("col") | atom!("colgroup"))
        }
        atom!("tbody") | atom!("thead") | atom!("tfoot") => is_cell(child) || child == atom!("tr"),
        atom!("tr") => is_cell(child),
        atom!("dl") => is_definition(child),
        atom!("dir") | atom!("ol") | atom!("ul") => {
            is_list(child) || matches!(child, atom!("dir") | atom!("li"))
        }
        atom!("hgroup") => is_heading(child),
        atom!("a") | atom!("nobr") if child == parent => false,
        _ => {
            !is_only_in_tables(child)
                && !is_item(child)
                && !(is_inline_container(parent) && is_not_for_paragraphs(child))
        }
    }
}

pub(super) fn is_tag_allowed_in(child: Known, parent: &Node) -> bool {
    if !parent.is_html_element() {
        return parent.is_element() || parent.as_fragment().is_some();
    }
    let forbids = |above: Known| {
        child == atom!("a") && above == child
            || is_not_for_paragraphs(child) && is_inline_container(above)
            || is_heading(child) && is_heading(above)
    };
    !parent
        .inclusive_ancestors()
        .map(Node::html_tag)
        .any(forbids)
        && is_tag_allowed_in_tag(child, parent.html_tag())
}

/// `None` if it depends on what element it is.
fn is_other_node_allowed(child: &Node, parent: Known) -> Option<bool> {
    match child.as_text() {
        Some(text) => {
            Some(!is_row_holder(parent) || text.with_data(|it| it.units().all(is_ascii_whitespace)))
        }
        None if child.is_html_element() => None,
        None => {
            Some(!is_raw_text(parent) && (child.is_element() || child.kind().is_character_data()))
        }
    }
}

pub(super) fn is_allowed_in_tag(child: &Node, parent: Known) -> bool {
    is_other_node_allowed(child, parent)
        .unwrap_or_else(|| is_tag_allowed_in_tag(child.html_tag(), parent))
}

pub(super) fn is_allowed_in(child: &Node, parent: &Node) -> bool {
    is_other_node_allowed(child, parent.html_tag())
        .unwrap_or_else(|| is_tag_allowed_in(child.html_tag(), parent))
}
