//! Prettier's `language-html/utilities/index.js` and `utilities/html-whitespace.js`.

use super::ast::{Attribute, Flags, Id, Kind, Node, Span, Tree};
use super::data::{self, Display};
use super::{Options, Parser};
use crate::css::text;
use crate::options::HtmlWhitespaceSensitivity;
use bun_core::strings;
use std::borrow::Cow;

// ───────────────────────────── `htmlWhitespace` ─────────────────────────────

#[inline]
pub(crate) fn is_html_whitespace(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | 0x0C | b'\r' | b' ')
}

pub(crate) fn leading_whitespace_count(text: &[u8]) -> usize {
    text.iter()
        .take_while(|&&byte| is_html_whitespace(byte))
        .count()
}

pub(crate) fn trailing_whitespace_count(text: &[u8]) -> usize {
    text.iter()
        .rev()
        .take_while(|&&byte| is_html_whitespace(byte))
        .count()
}

pub(crate) fn html_trim_start(text: &[u8]) -> &[u8] {
    &text[leading_whitespace_count(text)..]
}

pub(crate) fn html_trim_end(text: &[u8]) -> &[u8] {
    &text[..text.len() - trailing_whitespace_count(text)]
}

pub(crate) fn html_trim(text: &[u8]) -> &[u8] {
    html_trim_end(html_trim_start(text))
}

pub(crate) fn has_html_whitespace(text: &[u8]) -> bool {
    text.iter().any(|&byte| is_html_whitespace(byte))
}

/// `htmlWhitespace.split(text)`: with an empty string where the text starts or ends with white space.
pub(crate) fn html_split(text: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut rest = Some(text);
    std::iter::from_fn(move || {
        let text = rest?;
        let len = text
            .iter()
            .take_while(|&&byte| !is_html_whitespace(byte))
            .count();
        let after = &text[len..];
        rest = (!after.is_empty()).then(|| html_trim_start(after));
        Some(&text[..len])
    })
}

/// `htmlWhitespace.dedentString(text)`: by how much every line is to be shortened at its start.
pub(crate) fn min_indentation(text: &[u8]) -> usize {
    let mut min_indentation = usize::MAX;
    for line in strings::split(text, b"\n") {
        if line.is_empty() {
            continue;
        }
        let indentation = leading_whitespace_count(line);
        if indentation == 0 {
            return 0;
        }
        if line.len() != indentation {
            min_indentation = min_indentation.min(indentation);
        }
    }
    if min_indentation == usize::MAX {
        0
    } else {
        min_indentation
    }
}

/// `htmlWhitespace.dedentString(text)`
pub(crate) fn dedent_string(text: &[u8]) -> Cow<'_, [u8]> {
    let min_indentation = min_indentation(text);
    if min_indentation == 0 {
        return Cow::Borrowed(text);
    }
    let mut result = Vec::with_capacity(text.len());
    for (index, line) in strings::split(text, b"\n").enumerate() {
        if index > 0 {
            result.push(b'\n');
        }
        result.extend_from_slice(line.get(min_indentation..).unwrap_or_default());
    }
    Cow::Owned(result)
}

/// `htmlTrimPreserveIndentation`
pub(crate) fn html_trim_preserve_indentation(text: &[u8]) -> &[u8] {
    // `.replaceAll(/^[\t\f\r ]*\n/g, "")`: without the `m` flag, it is one line at most.
    let text = html_trim_end(text);
    let blanks = text
        .iter()
        .take_while(|byte| matches!(byte, b'\t' | 0x0C | b'\r' | b' '))
        .count();
    match text.get(blanks) {
        Some(b'\n') => &text[blanks + 1..],
        _ => text,
    }
}

// ───────────────────────────── nodes ─────────────────────────────

/// `isUnknownNamespace`
pub(crate) fn is_unknown_namespace(node: &Node<'_>) -> bool {
    node.kind == Kind::Element
        && !node.has(Flags::HAS_EXPLICIT_NAMESPACE)
        && !matches!(node.namespace, b"html" | b"svg")
}

/// `isTextLikeNode`
#[inline]
pub(crate) fn is_text_like(node: &Node<'_>) -> bool {
    matches!(node.kind, Kind::Text | Kind::Comment)
}

/// `isPreLikeNode` and `isIndentationSensitiveNode`
pub(crate) fn is_pre_like(node: &Node<'_>) -> bool {
    node.kind == Kind::Element
        && (node.namespace.is_empty() || is_unknown_namespace(node))
        && data::is_pre_tag(&node.name)
}

/// `isScriptLikeTag`
pub(crate) fn is_script_like_tag(node: &Node<'_>, options: &Options<'_>) -> bool {
    if node.kind != Kind::Element {
        return false;
    }
    match &node.name[..] {
        b"script" | b"style" => {
            matches!(node.namespace, b"" | b"svg") || is_unknown_namespace(node)
        }
        b"mj-style" => node.namespace.is_empty() && options.parser == Parser::Mjml,
        _ => false,
    }
}

/// `isPrettierIgnore`
fn is_prettier_ignore(node: &Node<'_>) -> bool {
    node.kind == Kind::Comment && text::trim(&node.value) == b"prettier-ignore"
}

/// `unescapeQuoteEntities`
pub(crate) fn unescape_quote_entities(text: &[u8]) -> Cow<'_, [u8]> {
    if !strings::contains(text, b"&apos;") && !strings::contains(text, b"&quot;") {
        return Cow::Borrowed(text);
    }
    let mut result = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = strings::index_of_char_usize(rest, b'&') {
        result.extend_from_slice(&rest[..at]);
        rest = &rest[at..];
        if let Some(after) = rest.strip_prefix(b"&apos;") {
            result.push(b'\'');
            rest = after;
        } else if let Some(after) = rest.strip_prefix(b"&quot;") {
            result.push(b'"');
            rest = after;
        } else {
            result.push(b'&');
            rest = &rest[1..];
        }
    }
    result.extend_from_slice(rest);
    Cow::Owned(result)
}

/// `/^PRETTIER_HTML_PLACEHOLDER_\d+_\d+_IN_JS$/.test(value)`
pub(crate) fn is_placeholder_in_js(value: &[u8]) -> bool {
    let digits = |text: &'_ [u8]| -> Option<usize> {
        Some(text.iter().take_while(|byte| byte.is_ascii_digit()).count())
            .filter(|&count| count > 0)
    };
    (|| {
        let rest = value.strip_prefix(b"PRETTIER_HTML_PLACEHOLDER_")?;
        let rest = rest[digits(rest)?..].strip_prefix(b"_")?;
        Some(&rest[digits(rest)?..] == b"_IN_JS")
    })()
    .unwrap_or(false)
}

/// `shouldUnquoteAttributeValue`
pub(crate) fn should_unquote_attribute_value(attr: &Attribute<'_>, options: &Options<'_>) -> bool {
    let (Some(span), Some(value)) = (attr.value_span, attr.value) else {
        return false;
    };
    // `isAttributeValueQuoted`
    if span.len() as usize == value.len() + 2 {
        return false;
    }
    is_placeholder_in_js(value)
        || (options.parser == Parser::Lwc && value.starts_with(b"{") && value.ends_with(b"}"))
}

/// `preferHardlineAsSurroundingSpaces`
fn prefer_hardline_as_surrounding_spaces(node: &Node<'_>) -> bool {
    match node.kind {
        Kind::IeConditionalComment | Kind::Comment => true,
        Kind::Element => matches!(&node.name[..], b"script" | b"select"),
        _ => false,
    }
}

fn is_text_or_interpolation(node: &Node<'_>) -> bool {
    matches!(node.kind, Kind::Text | Kind::Interpolation)
}

/// By how many lines the start of `second` is below the end of `first`, up to two.
fn lines_between(options: &Options<'_>, first: Span, second: Span) -> usize {
    let Some(between) = options
        .original_text
        .get(first.end as usize..second.start as usize)
    else {
        return 0;
    };
    match strings::index_of_char_usize(between, b'\n') {
        None => 0,
        Some(first) => 1 + usize::from(strings::contains_char(&between[first + 1..], b'\n')),
    }
}

impl<'a> Tree<'a> {
    fn node_at(&self, id: Option<Id>) -> Option<&Node<'a>> {
        id.map(|id| &self[id])
    }

    pub(crate) fn parent_of(&self, id: Id) -> Option<&Node<'a>> {
        self.node_at(self.parent(id))
    }

    pub(crate) fn prev_of(&self, id: Id) -> Option<&Node<'a>> {
        self.node_at(self.prev(id))
    }

    pub(crate) fn next_of(&self, id: Id) -> Option<&Node<'a>> {
        self.node_at(self.next(id))
    }

    /// `hasPrettierIgnore`
    pub(crate) fn has_prettier_ignore(&self, id: Id) -> bool {
        self.prev_of(id).is_some_and(is_prettier_ignore)
    }

    /// `isVueSfcBlock`
    pub(crate) fn is_vue_sfc_block(&self, id: Id, options: &Options<'_>) -> bool {
        options.parser == Parser::Vue
            && self[id].kind == Kind::Element
            && self
                .parent_of(id)
                .is_some_and(|parent| parent.kind == Kind::Root)
            && !(self[id].namespace.is_empty() && self[id].name.eq_ignore_ascii_case(b"html"))
    }

    /// `isVueCustomBlock`
    pub(crate) fn is_vue_custom_block(&self, id: Id, options: &Options<'_>) -> bool {
        self.is_vue_sfc_block(id, options)
            && !(self[id].namespace.is_empty()
                && matches!(&self[id].name[..], b"template" | b"style" | b"script"))
    }

    /// `isVueNonHtmlBlock`
    pub(crate) fn is_vue_non_html_block(&self, id: Id, options: &Options<'_>) -> bool {
        self.is_vue_sfc_block(id, options)
            && (self.is_vue_custom_block(id, options)
                || self
                    .attribute_value(id, b"lang")
                    .is_some_and(|lang| lang != b"html"))
    }

    /// `isVueScriptTag`
    pub(crate) fn is_vue_script_tag(&self, id: Id, options: &Options<'_>) -> bool {
        self.is_vue_sfc_block(id, options) && &self[id].name[..] == b"script"
    }

    /// `shouldPreserveContent`
    pub(crate) fn should_preserve_content(&self, id: Id, options: &Options<'_>) -> bool {
        let node = &self[id];
        if node.kind == Kind::IeConditionalComment {
            // An element that is not closed in the comment, or something that cannot be parsed.
            if self.node_at(self.last_child(id)).is_some_and(|last| {
                !last.has(Flags::IS_SELF_CLOSING) && !last.has(Flags::HAS_END_SPAN)
            }) {
                return true;
            }
            if !node.has(Flags::IS_COMPLETE) {
                return true;
            }
        }
        if is_pre_like(node)
            && self
                .children(id)
                .any(|child| !is_text_or_interpolation(&self[child]))
        {
            return true;
        }
        self.is_vue_non_html_block(id, options) && !is_script_like_tag(node, options)
    }

    /// `isWhitespaceSensitiveNode`
    pub(crate) fn is_whitespace_sensitive(&self, id: Id, options: &Options<'_>) -> bool {
        let node = &self[id];
        is_script_like_tag(node, options) || node.kind == Kind::Interpolation || is_pre_like(node)
    }

    /// What `isLeadingSpaceSensitiveNode` and `isTrailingSpaceSensitiveNode` have in common. `neighbor`: the
    /// sibling on the side in question.
    fn is_space_sensitive(
        &self,
        id: Id,
        neighbor: Option<&Node<'a>>,
        options: &Options<'_>,
    ) -> bool {
        let node = &self[id];
        if matches!(node.kind, Kind::FrontMatter | Kind::AngularControlFlowBlock) {
            return false;
        }
        if is_text_or_interpolation(node) && neighbor.is_some_and(is_text_or_interpolation) {
            return true;
        }
        let Some(parent_id) = self.parent(id) else {
            return false;
        };
        let parent = &self[parent_id];
        if parent.css_display == Display::None {
            return false;
        }
        if is_pre_like(parent) {
            return true;
        }
        match neighbor {
            None => {
                !(parent.kind == Kind::Root
                    || is_pre_like(node)
                    || is_script_like_tag(parent, options)
                    || self.is_vue_custom_block(parent_id, options)
                    || parent.css_display.is_block_like()
                    || parent.css_display == Display::InlineBlock)
            }
            Some(neighbor) => !neighbor.css_display.is_block_like(),
        }
    }

    /// `isLeadingSpaceSensitiveNode`
    pub(crate) fn is_leading_space_sensitive(&self, id: Id, options: &Options<'_>) -> bool {
        let prev = self.prev_of(id);
        let is_sensitive = self.is_space_sensitive(id, prev, options);
        if is_sensitive
            && prev.is_none()
            && self.parent_of(id).is_some_and(|parent| {
                parent.kind == Kind::Element && parent.tag_definition.ignore_first_lf
            })
        {
            return self[id].kind == Kind::Interpolation;
        }
        is_sensitive
    }

    /// `isTrailingSpaceSensitiveNode`
    pub(crate) fn is_trailing_space_sensitive(&self, id: Id, options: &Options<'_>) -> bool {
        self.is_space_sensitive(id, self.next_of(id), options)
    }

    /// `isDanglingSpaceSensitiveNode`
    pub(crate) fn is_dangling_space_sensitive(&self, id: Id, options: &Options<'_>) -> bool {
        let node = &self[id];
        !node.css_display.is_block_like()
            && node.css_display != Display::InlineBlock
            && !is_script_like_tag(node, options)
    }

    /// `forceNextEmptyLine`
    pub(crate) fn force_next_empty_line(&self, id: Id, options: &Options<'_>) -> bool {
        self[id].kind == Kind::FrontMatter
            || self
                .next_of(id)
                .is_some_and(|next| lines_between(options, self[id].span, next.span) > 1)
    }

    /// `hasNonTextChild`
    fn has_non_text_child(&self, id: Id) -> bool {
        self[id].has_children_property()
            && self
                .children(id)
                .any(|child| self[child].kind != Kind::Text)
    }

    /// `forceBreakContent`
    pub(crate) fn force_break_content(&self, id: Id, options: &Options<'_>) -> bool {
        let node = &self[id];
        if self.force_break_children(id) {
            return true;
        }
        if node.kind == Kind::Element
            && self.has_children(id)
            && (matches!(&node.name[..], b"body" | b"script" | b"style")
                || self
                    .children(id)
                    .any(|child| self.has_non_text_child(child)))
        {
            return true;
        }
        self.only_child(id).is_some_and(|only| {
            self[only].kind != Kind::Text
                && self.has_leading_line_break(only, options)
                && (!self[only].has(Flags::IS_TRAILING_SPACE_SENSITIVE)
                    || self.has_trailing_line_break(only, options))
        })
    }

    /// `forceBreakChildren`
    pub(crate) fn force_break_children(&self, id: Id) -> bool {
        let node = &self[id];
        node.kind == Kind::Element
            && self.has_children(id)
            && (matches!(
                &node.name[..],
                b"html" | b"head" | b"ul" | b"ol" | b"select"
            ) || node.css_display == Display::Table)
    }

    /// `preferHardlineAsLeadingSpaces`
    pub(crate) fn prefer_hardline_as_leading_spaces(&self, id: Id, options: &Options<'_>) -> bool {
        prefer_hardline_as_surrounding_spaces(&self[id])
            || self
                .prev(id)
                .is_some_and(|prev| self.prefer_hardline_as_trailing_spaces(prev, options))
            || self.has_surrounding_line_break(id, options)
    }

    fn prefer_hardline_as_trailing_spaces(&self, id: Id, options: &Options<'_>) -> bool {
        prefer_hardline_as_surrounding_spaces(&self[id])
            || (self[id].kind == Kind::Element && self[id].is_full_name(b"br"))
            || self.has_surrounding_line_break(id, options)
    }

    fn has_surrounding_line_break(&self, id: Id, options: &Options<'_>) -> bool {
        self.has_leading_line_break(id, options) && self.has_trailing_line_break(id, options)
    }

    fn has_leading_line_break(&self, id: Id, options: &Options<'_>) -> bool {
        let node = &self[id];
        node.has(Flags::HAS_LEADING_SPACES)
            && match (self.prev_of(id), self.parent_of(id)) {
                (Some(prev), _) => lines_between(options, prev.span, node.span) > 0,
                (None, Some(parent)) => {
                    parent.kind == Kind::Root
                        || parent
                            .start_span()
                            .is_some_and(|span| lines_between(options, span, node.span) > 0)
                }
                (None, None) => false,
            }
    }

    fn has_trailing_line_break(&self, id: Id, options: &Options<'_>) -> bool {
        let node = &self[id];
        node.has(Flags::HAS_TRAILING_SPACES)
            && match (self.next_of(id), self.parent_of(id)) {
                (Some(next), _) => lines_between(options, node.span, next.span) > 0,
                (None, Some(parent)) => {
                    parent.kind == Kind::Root
                        || parent
                            .end_span()
                            .is_some_and(|span| lines_between(options, node.span, span) > 0)
                }
                (None, None) => false,
            }
    }

    /// `getLastDescendant`
    pub(crate) fn last_descendant(&self, mut id: Id) -> Id {
        while let Some(last) = self.last_child(id) {
            id = last;
        }
        id
    }

    /// `getNodeCssStyleDisplay`. `is_in_svg_foreign_object`: the node or something around it is one.
    pub(crate) fn css_display(
        &self,
        id: Id,
        is_in_svg_foreign_object: bool,
        options: &Options<'_>,
    ) -> Display {
        if self.is_vue_sfc_block(id, options) {
            return Display::Block;
        }
        let node = &self[id];
        // `<!-- display: block -->`: `/^\s*display:\s*([a-z]+)\s*$/`
        if let Some(prev) = self.prev_of(id).filter(|prev| prev.kind == Kind::Comment)
            && let Some(value) = text::trim(&prev.value)
                .strip_prefix(b"display:")
                .map(text::trim_start)
            && !value.is_empty()
            && value.iter().all(u8::is_ascii_lowercase)
        {
            return Display::from_name(value);
        }
        let is_svg = node.kind == Kind::Element && node.namespace == b"svg";
        if is_svg && !is_in_svg_foreign_object {
            return if &node.name[..] == b"svg" {
                Display::InlineBlock
            } else {
                Display::Block
            };
        }
        match options.format.html_whitespace_sensitivity {
            HtmlWhitespaceSensitivity::Strict => Display::Inline,
            HtmlWhitespaceSensitivity::Ignore => Display::Block,
            HtmlWhitespaceSensitivity::Css => {
                let is_html = node.kind == Kind::Element
                    && (node.namespace.is_empty() || is_svg || is_unknown_namespace(node));
                is_html
                    .then(|| data::css_display_of_tag(&node.name))
                    .flatten()
                    .unwrap_or(Display::Inline)
            }
        }
    }
}
