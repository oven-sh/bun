//! Prettier's `parser-postcss.js`: the `postcss` tree with selectors, values and parameters parsed.

use super::Parser as Syntax;
use super::media_query::{self, MediaNode};
use super::misc::{line_comment_at_end, next_line_comment};
use super::postcss::{self, Kind, NodeId, Range, Tree};
use super::selector_parser::{SelectorId, Selectors};
use super::value_parser::{ValueId, Values};
use crate::stack::Stack;
use crate::syntax_error::{Message, Rejected, Rejection};
use crate::text;
use bun_core::strings;
use rustc_hash::FxHashMap;
use std::borrow::Cow;
use std::cell::RefCell;

/// `node.value`
pub(crate) enum Value<'a> {
    None,
    Text(Cow<'a, [u8]>),
    Parsed(ValueId),
    /// `--a: { .. }`: `{ type: "css-rule", nodes }`. The nodes are the children of the tree's only node, a rule.
    Rule(Box<Tree>),
}

/// `node.params`
pub(crate) enum Params<'a> {
    None,
    Text(Cow<'a, [u8]>),
    Media(MediaNode<'a>),
    Value(ValueId),
    /// `media-unknown` and `selector-unknown`, which are printed the same way here.
    Unknown(Cow<'a, [u8]>),
}

/// One node's selectors and values. Converting the next node overwrites them.
#[derive(Default)]
pub(crate) struct Parsed {
    pub(crate) selectors: Selectors,
    pub(crate) values: Values,
}

/// A node, without its block's contents.
pub(crate) struct CssNode<'a> {
    pub(crate) kind: Kind,
    /// `locStart(node)` and `locEnd(node)`
    pub(crate) start: usize,
    pub(crate) end: usize,
    /// True if it has `nodes`.
    pub(crate) has_block: bool,
    /// `raws.before`, `raws.between`, `raws.after`, `raws.afterName`
    pub(crate) before: &'a [u8],
    pub(crate) between: Cow<'a, [u8]>,
    pub(crate) after: &'a [u8],
    pub(crate) after_name: &'a [u8],
    /// `raws.semicolon`
    pub(crate) semicolon: bool,
    pub(crate) selector: Option<SelectorId>,
    /// `raws.selector`
    pub(crate) raw_selector: Cow<'a, [u8]>,
    pub(crate) is_scss_nested_property: bool,
    /// `isNested`: an SCSS declaration with a block.
    pub(crate) is_nested: bool,
    pub(crate) prop: Cow<'a, [u8]>,
    pub(crate) value: Value<'a>,
    pub(crate) important: bool,
    pub(crate) raw_important: Option<&'a [u8]>,
    pub(crate) scss_default: bool,
    pub(crate) raw_scss_default: Option<&'a [u8]>,
    pub(crate) scss_global: bool,
    pub(crate) raw_scss_global: Option<&'a [u8]>,
    pub(crate) name: &'a [u8],
    pub(crate) params: Params<'a>,
    /// `raws.params`
    pub(crate) raw_params: Cow<'a, [u8]>,
    pub(crate) custom_selector: Option<Cow<'a, [u8]>>,
    /// A trailing `//` comment split off the end of the params or the value. It's printed after the `;`, or before the
    /// `{`, which then moves to the next line.
    pub(crate) line_comment: &'a [u8],
    /// Flags that `postcss-less` and Prettier set on a Less node.
    pub(crate) extend: bool,
    pub(crate) mixin: bool,
    pub(crate) function: bool,
    pub(crate) variable: bool,
}

/// Result of `Context::split_line_comment`.
struct BeforeLineComment<'a> {
    head: &'a [u8],
    comment: &'a [u8],
}

pub(crate) struct Context<'a> {
    /// The text that's parsed.
    pub(crate) text: &'a [u8],
    /// `options.originalText`
    pub(crate) original_text: &'a [u8],
    /// True if `text` and `original_text` are the same.
    pub(crate) is_original_text: bool,
    /// `Tree::extra`
    pub(crate) extra: &'a [u8],
    pub(crate) syntax: Syntax,
    pub(crate) is_oxfmt: bool,
    /// Why a node couldn't be converted.
    pub(crate) rejection: Rejection,
    pub(crate) stack: Stack,
    /// Caches whether a custom property set's contents [can be converted](Context::can_be_converted), keyed by the
    /// set's start offset. Otherwise a set nested in `n` others would be converted once for each of them.
    pub(crate) convertible_sets: RefCell<FxHashMap<u32, bool>>,
}

/// `text[start..end]`, or nothing if that's out of range.
fn slice<'a>(text: &Cow<'a, [u8]>, start: usize, end: usize) -> Cow<'a, [u8]> {
    match text {
        Cow::Borrowed(text) => Cow::Borrowed(text.get(start..end).unwrap_or_default()),
        Cow::Owned(text) => Cow::Owned(text.get(start..end).unwrap_or_default().to_vec()),
    }
}

/// `text.trim()`
fn trim<'a>(text: &Cow<'a, [u8]>) -> Cow<'a, [u8]> {
    let start = text.len() - bun_core::strings::trim_js_whitespace_start(text).len();
    slice(
        text,
        start,
        start + bun_core::strings::trim_js_whitespace(text).len(),
    )
}

/// Matches `/(\s*)(!default).*$/`, or the same with `!global`, and returns the match's start.
fn find_directive(value: &[u8], directive: &[u8]) -> Option<usize> {
    let mut from = 0;
    while let Some(at) = text::index_of_from(value, directive, from) {
        if bun_core::strings::index_of_any(&value[at..], b"\n\r").is_none()
            && !bun_core::strings::contains(&value[at..], "\u{2028}".as_bytes())
        {
            return Some(bun_core::strings::trim_js_whitespace_end(&value[..at]).len());
        }
        from = at + 1;
    }
    None
}

/// Returns the length of the `/^\s*:?\s*/` match.
fn after_name_prefix_len(after_name: &[u8]) -> usize {
    let rest = bun_core::strings::trim_js_whitespace_start(after_name);
    let rest = bun_core::strings::trim_js_whitespace_start(rest.strip_prefix(b":").unwrap_or(rest));
    after_name.len() - rest.len()
}

/// `params.replace(/^(?!if)([^"'\s(]+)(\s+)\(/, "$1($2")`
fn move_space_after_parenthesis(params: &[u8]) -> Option<Vec<u8>> {
    if params.starts_with(b"if") {
        return None;
    }
    let name_len = params
        .iter()
        .position(|&b| matches!(b, b'"' | b'\'' | b'(') || text::starts_with_white_space(&[b]))
        .filter(|&len| len > 0)?;
    let rest = &params[name_len..];
    let spaces = text::leading_white_space_len(rest);
    if spaces == 0 || rest.get(spaces) != Some(&b'(') {
        return None;
    }
    let mut out = Vec::with_capacity(params.len());
    out.extend_from_slice(&params[..name_len]);
    out.push(b'(');
    out.extend_from_slice(&rest[..spaces]);
    out.extend_from_slice(&rest[spaces + 1..]);
    Some(out)
}

/// `params.replace(/(\$\S+?)(\s+)?\.{3}/, "$1...$2")`
fn move_space_after_dots(params: &[u8]) -> Option<Vec<u8>> {
    let mut from = 0;
    while let Some(dollar) = bun_core::strings::index_of_char_pos(params, b'$', from) {
        // `\S+?` is lazy and doesn't match whitespace.
        let mut at = dollar + 1;
        while params
            .get(at)
            .is_some_and(|&b| !text::starts_with_white_space(&[b]))
        {
            at += 1;
            let spaces = text::leading_white_space_len(&params[at..]);
            if params[at + spaces..].starts_with(b"...") {
                if spaces == 0 {
                    return None;
                }
                let mut out = Vec::with_capacity(params.len());
                out.extend_from_slice(&params[..at]);
                out.extend_from_slice(b"...");
                out.extend_from_slice(&params[at..at + spaces]);
                out.extend_from_slice(&params[at + spaces + 3..]);
                return Some(out);
            }
        }
        // A later `$` before the whitespace would scan the same bytes and fail too, so skip past them.
        from = at;
    }
    None
}

/// True for the at-rules whose params Prettier parses into `node.value`.
fn parses_params_as_value(name: &[u8]) -> bool {
    matches!(
        name,
        b"namespace"
            | b"supports"
            | b"if"
            | b"else"
            | b"for"
            | b"each"
            | b"while"
            | b"debug"
            | b"mixin"
            | b"include"
            | b"function"
            | b"return"
            | b"define-mixin"
            | b"add-mixin"
    )
}

/// `getValueRootOffset` and `getAtRuleParamsRootOffset` for an at-rule.
fn value_root_offset(node: &CssNode<'_>) -> u32 {
    (node.start + 1 + node.name.len() + after_name_prefix_len(node.after_name)) as u32
}

/// oxfmt prints `.a-#{ $b }` as `.a-#{$b}` in selectors as well as in values. Prettier leaves selectors alone.
fn trim_interpolation_whitespace(selector: &[u8]) -> Vec<u8> {
    let mut result: Vec<u8> = Vec::with_capacity(selector.len());
    // The number of open `{` in the interpolation, or 0 outside of one.
    let mut depth = 0u32;
    let mut quote = 0u8;
    let mut at = 0;
    while let Some(&byte) = selector.get(at) {
        at += 1;
        if quote != 0 || (depth == 0 && matches!(byte, b'"' | b'\'')) {
            quote = match quote {
                0 => byte,
                _ if byte == quote => 0,
                _ => quote,
            };
            result.push(byte);
        } else if depth == 0 && byte == b'#' && selector.get(at) == Some(&b'{') {
            result.extend_from_slice(b"#{");
            depth = 1;
            at += 1 + text::leading_white_space_len(&selector[at + 1..]);
        } else if depth > 0 && byte == b'{' {
            depth += 1;
            result.push(byte);
        } else if depth > 0 && byte == b'}' {
            depth -= 1;
            if depth == 0 {
                result.truncate(bun_core::strings::trim_js_whitespace_end(&result).len());
            }
            result.push(byte);
        } else {
            result.push(byte);
        }
    }
    result
}

/// `isScssNestedPropertyNode`. `selector` is the selector as cleaned by `postcss`.
fn is_scss_nested_property(selector: &[u8]) -> bool {
    let mut selector = Cow::Borrowed(selector);
    // `.replace(/\/\*.*?\*\//, "")`
    let mut from = 0;
    while let Some(start) = text::index_of_from(&selector, b"/*", from) {
        let line_end = bun_core::strings::index_of_any(&selector[start..], b"\n\r")
            .map_or(selector.len(), |at| start + at);
        if let Some(end) = text::index_of_from(&selector[..line_end], b"*/", start + 2) {
            selector.to_mut().drain(start..end + 2);
            break;
        }
        from = start + 1;
    }
    // `.replace(/\/\/.*\n/, "")`
    let mut from = 0;
    while let Some(start) = text::index_of_from(&selector, b"//", from) {
        match bun_core::strings::index_of_any(&selector[start..], b"\n\r") {
            Some(at) if selector[start + at] == b'\n' => {
                selector.to_mut().drain(start..=start + at);
                break;
            }
            Some(at) => from = start + at,
            None => break,
        }
    }
    bun_core::strings::trim_js_whitespace_end(&selector).ends_with(b":")
}

impl<'a> Context<'a> {
    pub(crate) fn of(&self, range: Range) -> &'a [u8] {
        postcss::text_of_range(range, self.text, self.extra)
    }

    /// Returns the text of `range` as it is in the original file, trimmed. The copy of a Less file that gets parsed
    /// has a space instead of every `*`, `"` and `'` between a `//` and the end of its line, whether or not the `//`
    /// starts a comment. `range` excludes those spaces at either end of a value, so it's widened over them first.
    pub(crate) fn original_text_of(&self, range: Range) -> &'a [u8] {
        let before = self.text.get(..range.start as usize).unwrap_or_default();
        let spaces_before = before.iter().rev().take_while(|it| **it == b' ').count();
        self.original_text_from(Range::new(range.start - spaces_before as u32, range.end))
    }

    /// Like [`original_text_of`](Self::written), but only widens the end of `range`. Use it when `range` already starts
    /// at the right byte, like a `//` comment's range.
    fn original_text_from(&self, range: Range) -> &'a [u8] {
        let text_after = self.text.get(range.end as usize..);
        let Some(text_after) = text_after.filter(|_| !self.is_original_text) else {
            return strings::trim_js_whitespace(self.of(range));
        };
        let spaces_after = text_after.iter().take_while(|it| **it == b' ').count();
        let original =
            (self.original_text).get(range.start as usize..range.end as usize + spaces_after);
        strings::trim_js_whitespace(original.unwrap_or_default())
    }

    fn concat(&self, ranges: &[Range]) -> Cow<'a, [u8]> {
        let mut all = Range::default();
        for (index, &range) in ranges.iter().enumerate() {
            if all.is_empty() {
                all = range;
            } else if range.is_empty() {
            } else if all.end == range.start {
                all.end = range.end;
            } else {
                let mut text = self.of(all).to_vec();
                ranges[index..]
                    .iter()
                    .for_each(|&range| text.extend_from_slice(self.of(range)));
                return Cow::Owned(text);
            }
        }
        Cow::Borrowed(self.of(all))
    }

    /// Splits `text` at the `//` comment it ends with. Returns the text before the comment, and the comment as it is
    /// in the original file. `start` is the offset of `text` in the file. `text_after` is everything between `text` and
    /// the `{` or the `;`. Returns `None` unless `text_after` has a line break.
    fn split_line_comment(
        &self,
        text: &'a [u8],
        start: u32,
        text_after: &[u8],
    ) -> Option<BeforeLineComment<'a>> {
        if self.syntax == Syntax::Css
            || !strings::contains(text, b"//")
            || strings::index_of_any(text_after, b"\n\r").is_none()
        {
            return None;
        }
        let at = line_comment_at_end(text)?;
        let comment =
            self.original_text_from(Range::new(start + at as u32, start + text.len() as u32));
        let head = &text[..at];
        comment
            .starts_with(b"//")
            .then_some(BeforeLineComment { head, comment })
    }

    /// True if `value`, a custom property's value, has a `//` comment that would swallow a `;` printed after it. CSS
    /// doesn't have `//` comments. Less only recognizes one after whitespace. `postcss-scss` treats every `//` as one.
    fn has_line_comment(&self, value: &[u8]) -> bool {
        let mut at = 0;
        while self.syntax != Syntax::Css
            && let Some(start) = next_line_comment(value, at)
        {
            if self.syntax == Syntax::Scss
                || !value[..start]
                    .last()
                    .is_some_and(|it| !it.is_ascii_whitespace())
            {
                return true;
            }
            at = start + 2;
        }
        false
    }

    /// The Less-only part of `parseNestedCSS` for an at-rule. Returns true if the node needs no further conversion.
    fn convert_less_at_rule(
        &self,
        raw: &postcss::Node,
        node: &mut CssNode<'a>,
        parsed: &mut Parsed,
    ) -> Result<bool, Rejected> {
        let parse = |text: Cow<'a, [u8]>, root_offset: u32, parsed: &mut Parsed| {
            let Parsed { selectors, values } = parsed;
            values
                .parse(&text, self.syntax, root_offset, selectors, &self.stack)
                .map(Value::Parsed)
                .map_err(|_| self.rejection.note(Message::UnreadableAtRule, raw.start))
        };
        // `node.params`
        let clean_params: Cow<'a, [u8]> = match &raw.clean_params {
            Some(clean) => Cow::Owned(clean.to_vec()),
            None => Cow::Borrowed(self.of(raw.params)),
        };
        let skip = |text: &Cow<'a, [u8]>, len: usize| -> Cow<'a, [u8]> {
            match text {
                Cow::Borrowed(text) => Cow::Borrowed(text.get(len..).unwrap_or_default()),
                Cow::Owned(text) => Cow::Owned(text.get(len..).unwrap_or_default().to_vec()),
            }
        };

        // `postcss-less` marks it as a variable, and `node.value` is a string.
        if raw.variable {
            // Prettier parses `node.params`, where `postcss` has already stripped most comments. It then reads the text
            // of the remaining comments at offsets that assume nothing was stripped: `@a: b /* c */ d/* e */f` becomes
            // `@a: b d  c */ d f`.
            let mut value = match raw.value_skips {
                0 => {
                    let colon_and_whitespace_len = after_name_prefix_len(node.after_name) as u32;
                    self.concat(&[
                        Range::new(
                            raw.after_name.start + colon_and_whitespace_len,
                            raw.after_name.end,
                        ),
                        raw.params,
                    ])
                }
                skips => skip(&clean_params, skips as usize),
            };
            if !bun_core::strings::trim_js_whitespace(&value).is_empty() {
                for directive in [&b"!default"[..], b"!global"] {
                    if let Some(at) = find_directive(&value, directive) {
                        match &mut value {
                            Cow::Borrowed(value) => *value = &value[..at],
                            Cow::Owned(value) => value.truncate(at),
                        }
                    }
                }
                node.value = parse(value, value_root_offset(node), parsed)?;
            }
        }

        if raw.mixin {
            // Prettier turns `.a() // b⏎;` into `.a() // b;`.
            let mut params = &node.raw_params[..];
            if let Cow::Borrowed(text) = node.raw_params
                && let Some(BeforeLineComment { head, comment }) =
                    self.split_line_comment(text, value_root_offset(node), self.of(raw.between))
            {
                params = strings::trim_js_whitespace_end(head);
                node.line_comment = comment;
            }
            // `raws.identifier + name + raws.afterName + raws.params`
            let source = [self.of(raw.identifier), node.name, node.after_name, params].concat();
            node.selector = Some(parsed.selectors.parse(&source, &self.stack));
            return Ok(true);
        }
        if raw.function {
            node.params = Params::Text(clean_params);
            return Ok(true);
        }

        // `@color:blue;`
        if let Some(colon) = bun_core::strings::index_of_char_usize(node.name, b':') {
            node.variable = true;
            let rest = &node.name[colon + 1..];
            node.name = &node.name[..colon];
            // Prettier joins `rest` and the params without `raws.afterName`, so `@a:1px solid` becomes `@a: 1pxsolid`.
            // To compute the value's offset in the file it also counts `raws.afterName` instead of the colon. Comment
            // text is read from that offset, so `@a:b(c)/* d */e` becomes `@a: b(c) )/* d * e`.
            let after_colon = raw.name.start + colon as u32 + 1;
            let value = match clean_params.is_empty() {
                true => rest,
                false => self.of(Range::new(after_colon, raw.params.end)),
            };
            node.value = parse(Cow::Borrowed(value), after_colon, parsed)?;
        }
        // `@color :blue;`
        if !matches!(node.name, b"page" | b"nest" | b"keyframes") && clean_params.starts_with(b":")
        {
            node.variable = true;
            node.after_name = match raw.after_name.is_empty() {
                true => self.of(Range::new(raw.params.start, raw.params.start + 1)),
                false => self.of(Range::new(raw.after_name.start, raw.after_name.end + 1)),
            };
            if clean_params.len() > 1 {
                let value = self.of(Range::new(raw.params.start + 1, raw.params.end));
                node.value = parse(Cow::Borrowed(value), raw.params.start + 1, parsed)?;
            }
        }
        Ok(node.variable)
    }

    /// True if `id` and all its descendants can be converted.
    fn can_be_converted(&self, tree: &Tree, id: NodeId, parsed: &mut Parsed) -> bool {
        self.stack.has_room()
            && self.convert(tree, id, parsed).is_ok()
            && tree
                .children(&tree.nodes[id as usize])
                .all(|child| self.can_be_converted(tree, child, parsed))
    }

    /// True if `only` can be converted. It's the only rule in `tree`, which has the contents of the custom property set
    /// that starts at `start`.
    fn is_convertible_set(
        &self,
        start: u32,
        tree: &Tree,
        only: NodeId,
        parsed: &mut Parsed,
    ) -> bool {
        if let Some(&known) = self.convertible_sets.borrow().get(&start) {
            return known;
        }
        let can_be_converted = self.can_be_converted(tree, only, parsed);
        self.convertible_sets
            .borrow_mut()
            .insert(start, can_be_converted);
        can_be_converted
    }

    /// `locEnd(node)`
    pub(crate) fn end_of(&self, tree: &Tree, id: NodeId, parsed: &mut Parsed) -> usize {
        let raw = &tree.nodes[id as usize];
        match raw.end {
            Some(end) if !raw.inline => (end as usize).min(self.original_text.len()),
            _ if !self.stack.has_room() => 0,
            _ => self.convert(tree, id, parsed).map_or(0, |node| node.end),
        }
    }

    /// Returns the at-rule's name as Prettier sees it.
    pub(crate) fn name_of_at_rule(&self, raw: &postcss::Node) -> &'a [u8] {
        let name = self.of(raw.name);
        match bun_core::strings::index_of_char_usize(name, b':') {
            // `@color:blue;`
            Some(colon) if self.syntax == Syntax::Less && !raw.mixin && !raw.function => {
                &name[..colon]
            }
            _ => name,
        }
    }

    /// `parseNestedCSS`, plus `calculateLoc` for the node. Overwrites `parsed`.
    pub(crate) fn convert(
        &self,
        tree: &Tree,
        id: NodeId,
        parsed: &mut Parsed,
    ) -> Result<CssNode<'a>, Rejected> {
        parsed.selectors.clear();
        parsed.values.clear();
        let raw = &tree.nodes[id as usize];
        let mut node = CssNode {
            kind: raw.kind,
            start: raw.start as usize,
            end: 0,
            has_block: raw.has_block,
            before: self.of(raw.before),
            between: Cow::Borrowed(self.of(raw.between)),
            after: self.of(raw.after),
            after_name: self.of(raw.after_name),
            semicolon: raw.semicolon,
            selector: None,
            raw_selector: Cow::Borrowed(b""),
            is_scss_nested_property: false,
            is_nested: raw.is_nested,
            prop: Cow::Borrowed(self.of(raw.prop)),
            value: Value::None,
            important: raw.important,
            raw_important: raw.raw_important.map(|it| self.of(it)),
            scss_default: false,
            raw_scss_default: None,
            scss_global: false,
            raw_scss_global: None,
            name: self.of(raw.name),
            params: Params::None,
            raw_params: Cow::Borrowed(b""),
            custom_selector: None,
            line_comment: b"",
            extend: raw.extend,
            mixin: raw.mixin,
            function: raw.function,
            variable: raw.variable,
        };

        match raw.kind {
            Kind::Root | Kind::Comment => {}
            Kind::Rule => {
                node.raw_selector =
                    match bun_core::strings::trim_js_whitespace(&node.between).is_empty() {
                        true => Cow::Borrowed(self.of(raw.selector)),
                        false => self.concat(&[raw.selector, raw.between]),
                    };
                if self.is_oxfmt
                    && self.syntax == Syntax::Scss
                    && bun_core::strings::contains(&node.raw_selector, b"#{")
                {
                    node.raw_selector =
                        Cow::Owned(trim_interpolation_whitespace(&node.raw_selector));
                }
                // Prettier can't print a selector that's still a string.
                if bun_core::strings::trim_js_whitespace(&node.raw_selector).is_empty()
                    || (node.raw_selector.starts_with(b"@") && node.raw_selector.ends_with(b":"))
                {
                    return Err(self.rejection.note(Message::RuleWithoutSelector, raw.start));
                }
                {
                    let clean = raw
                        .clean_selector
                        .as_deref()
                        .unwrap_or_else(|| self.of(raw.selector));
                    node.is_scss_nested_property =
                        self.syntax == Syntax::Scss && is_scss_nested_property(clean);
                    node.selector = Some(parsed.selectors.parse(&node.raw_selector, &self.stack));
                }
            }
            Kind::Decl => self.convert_declaration(raw, &mut node, parsed)?,
            Kind::AtRule => self.convert_at_rule(raw, &mut node, parsed)?,
        }

        // `calculateLocEnd`
        let text_len = self.original_text.len();
        node.start = node.start.min(text_len);
        node.end = match raw.end {
            // `skipEverythingButNewLine`
            _ if raw.inline => {
                let rest = &self.original_text[node.start..];
                node.start + bun_core::strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len())
            }
            Some(end) => end as usize,
            // `end_of` overwrites `parsed`. That's fine for the root, which prints nothing from it. Other nodes pass a
            // scratch one.
            None => match (raw.kind, raw.last_child) {
                (Kind::AtRule, 0) => {
                    node.start + 1 + node.name.len() + node.after_name.len() + node.raw_params.len()
                }
                (_, 0) => text_len,
                (Kind::Root, last) => self.end_of(tree, last, parsed),
                (_, last) => self.end_of(tree, last, &mut Parsed::default()),
            },
        }
        .min(text_len);
        Ok(node)
    }

    fn convert_declaration(
        &self,
        raw: &postcss::Node,
        node: &mut CssNode<'a>,
        parsed: &mut Parsed,
    ) -> Result<(), Rejected> {
        let value = self.of(raw.value);
        // `getValueRootOffset`
        let root_offset = raw.start + node.prop.len() as u32 + node.between.len() as u32;

        let is_custom_property = node.prop.starts_with(b"--");
        // A custom property set looks like a declaration.
        if is_custom_property && let Some(rest) = value.strip_prefix(b"{") {
            // `--a: {"b":1}` is JSON for a script. Prettier parses it as a set anyway and adds a `;` before the `}`.
            if matches!(
                strings::trim_js_whitespace_start(rest).first(),
                Some(b'"' | b'\'')
            ) {
                node.value = Value::Text(Cow::Borrowed(self.original_text_of(raw.value)));
                return Ok(());
            }
            let mut rules = None;
            if bun_core::strings::trim_js_whitespace_end(raw.clean_value.as_deref().unwrap_or(value)).ends_with(b"}")
                && let Some(end) = raw.end
                && let Ok(tree) = postcss::parse_custom_property_set(
                    self.text.get(..end as usize).unwrap_or(self.text),
                    self.syntax,
                    raw.start,
                )
                && let only = tree.nodes[0].first_child
                && only != 0
                && only == tree.nodes[0].last_child
                && tree.nodes[only as usize].kind == Kind::Rule
                // Text in `tree.extra` wouldn't live long enough.
                && tree.extra.is_empty()
                && self.is_convertible_set(raw.start, &tree, only, parsed)
            {
                rules = Some(Box::new(tree));
            }
            parsed.values.clear();
            node.value = match rules {
                Some(rules) => Value::Rule(rules),
                // Prettier reads `raws.value.raw`, which only exists if the value has comments.
                None if raw.clean_value.is_none() => {
                    return Err(self.rejection.note(Message::UnreadableValue, root_offset));
                }
                None => Value::Parsed(parsed.values.unknown(value, root_offset)),
            };
            return Ok(());
        }

        let mut value = value;
        if bun_core::strings::trim_js_whitespace(value).is_empty() {
            node.value = Value::Text(match &raw.clean_value {
                Some(clean) => Cow::Owned(clean.to_vec()),
                None => Cow::Borrowed(value),
            });
        } else {
            // Prettier reads `b//` in `a: b// c⏎;` as a word and prints `a: b// c;`.
            let trimmed = strings::trim_js_whitespace_end(value);
            if !raw.has_block
                && !is_custom_property
                && let Some(BeforeLineComment { head, comment }) =
                    self.split_line_comment(trimmed, root_offset, &value[trimmed.len()..])
                && head.last().is_some_and(|it| !it.is_ascii_whitespace())
            {
                value = head;
                node.line_comment = comment;
            }
            let has_bang = strings::contains_char(value, b'!');
            if has_bang && let Some(at) = find_directive(value, b"!default") {
                node.scss_default = true;
                node.raw_scss_default = Some(&value[at..])
                    .filter(|it| bun_core::strings::trim_js_whitespace(it) != b"!default");
                value = &value[..at];
            }
            if has_bang && let Some(at) = find_directive(value, b"!global") {
                node.scss_global = true;
                node.raw_scss_global = Some(&value[at..])
                    .filter(|it| bun_core::strings::trim_js_whitespace(it) != b"!global");
                value = &value[..at];
            }
            if value.starts_with(b"progid:") {
                // Keep the string from `postcss`.
                node.value = Value::Text(match &raw.clean_value {
                    Some(clean) => Cow::Owned(clean.to_vec()),
                    None => Cow::Borrowed(self.of(raw.value)),
                });
                return Ok(());
            }
            let root = parsed
                .values
                .parse(
                    value,
                    self.syntax,
                    root_offset,
                    &mut parsed.selectors,
                    &self.stack,
                )
                .map_err(|_| self.rejection.note(Message::UnreadableValue, root_offset))?;
            // Prettier treats every `//` as the start of a comment: `--a: https://b` becomes `--a: https: ; //b`.
            let is_verbatim = is_custom_property
                && strings::contains(value, b"//")
                && next_line_comment(value, 0).is_some()
                && !self.has_line_comment(value);
            let end = raw.value.start + value.len() as u32;
            node.value = match is_verbatim {
                true => Value::Text(Cow::Borrowed(
                    self.original_text_of(Range::new(raw.value.start, end)),
                )),
                false => Value::Parsed(root),
            };
        }

        if self.syntax == Syntax::Less {
            // `a +: b`, a merge: `/^\s*\+\s*:/`
            let spaces = text::leading_white_space_len(&node.between);
            if let Some(rest) = node.between[spaces..].strip_prefix(b"+")
                && bun_core::strings::trim_js_whitespace_start(rest).starts_with(b":")
            {
                node.prop.to_mut().push(b'+');
                node.between.to_mut().remove(spaces);
            }
            // `&:extend(.a)`
            if value.starts_with(b"extend(") {
                node.extend = node.extend || *node.between == *b":";
                if node.extend {
                    node.value = Value::None;
                    let selector = value
                        .get(b"extend(".len()..value.len() - 1)
                        .unwrap_or_default();
                    node.selector = Some(parsed.selectors.parse(selector, &self.stack));
                }
            }
        }
        Ok(())
    }

    fn convert_at_rule(
        &self,
        raw: &postcss::Node,
        node: &mut CssNode<'a>,
        parsed: &mut Parsed,
    ) -> Result<(), Rejected> {
        let has_text =
            |range: Range| !bun_core::strings::trim_js_whitespace(self.of(range)).is_empty();
        let params = trim(&self.concat(&[
            if has_text(raw.after_name) {
                raw.after_name
            } else {
                Range::default()
            },
            raw.params,
            if has_text(raw.between) {
                raw.between
            } else {
                Range::default()
            },
        ]));
        node.raw_params.clone_from(&params);
        if self.syntax == Syntax::Less && self.convert_less_at_rule(raw, node, parsed)? {
            return Ok(());
        }
        let name = node.name;
        // Offset of `params` in the file. Prettier computes it from the name. If the params are only comments, they're
        // in `raws.between` and Prettier doesn't count the whitespace before them: `@else /* a */ {` becomes
        // `@else  /* a * {`.
        let root_offset = match raw.params.is_empty() && raw.after_name.is_empty() {
            true => raw.between.start + text::leading_white_space_len(self.of(raw.between)) as u32,
            false => value_root_offset(node),
        };
        let Parsed { selectors, values } = parsed;
        let value = |text: &[u8], values: &mut Values, selectors: &mut Selectors| {
            values
                .parse(text, self.syntax, root_offset, selectors, &self.stack)
                .map_err(|_| self.rejection.note(Message::UnreadableAtRule, raw.start))
        };

        if self.syntax == Syntax::Css && name == b"custom-selector" {
            // `node.params.match(/:--\S+\s+/)[0].trim()`
            let clean: Cow<'a, [u8]> = match &raw.clean_params {
                Some(clean) => Cow::Owned(clean.to_vec()),
                None => Cow::Borrowed(self.of(raw.params)),
            };
            let unreadable = || self.rejection.note(Message::UnreadableAtRule, raw.start);
            let start = text::index_of_from(&clean, b":--", 0).ok_or_else(unreadable)?;
            let name_len = clean[start..]
                .iter()
                .position(|&b| text::starts_with_white_space(&[b]))
                .ok_or_else(unreadable)?;
            if name_len <= 3 {
                return Err(unreadable());
            }
            node.custom_selector = Some(slice(&clean, start, start + name_len));
            node.selector =
                Some(selectors.parse(&trim(&slice(&clean, name_len, clean.len())), &self.stack));
            return Ok(());
        }
        // When the `{` or the `;` is on the line after the comment, Prettier prints `@media (a) // b {`,
        // `@if $a// b {`, `@else  { // ` and `@extend .a // b;`. It gets two cases right: a comment it finds while
        // parsing a value, which needs whitespace before it, and a comment before the `{` of an at-rule whose params it
        // doesn't parse.
        let is_comment_attached = |head: &[u8]| !head.last().is_some_and(u8::is_ascii_whitespace);
        let mut params = params;
        if let Cow::Borrowed(text) = params
            && let Some(BeforeLineComment { head, comment }) =
                self.split_line_comment(text, root_offset, self.of(raw.between))
            && match &*name.to_ascii_lowercase() {
                b"media" | b"custom-media" => true,
                b"import" | b"use" | b"forward" => is_comment_attached(head),
                _ if parses_params_as_value(name) => is_comment_attached(head),
                _ => !raw.has_block,
            }
        {
            params = Cow::Borrowed(strings::trim_js_whitespace_end(head));
            node.line_comment = comment;
        }
        if params.is_empty() {
            return Ok(());
        }
        if matches!(name, b"warn" | b"error") {
            // oxfmt formats their message like any other expression.
            match self.is_oxfmt.then(|| value(&params, values, selectors)) {
                Some(Ok(parsed)) => node.value = Value::Parsed(parsed),
                _ => node.params = Params::Unknown(params.clone()),
            }
        } else if matches!(name, b"extend" | b"nest") {
            node.selector = Some(selectors.parse(&params, &self.stack));
        } else if name == b"at-root" {
            // `/^\(\s*(?:without|with)\s*:.+\)$/s`
            let is_query = params
                .strip_prefix(b"(")
                .and_then(|it| it.strip_suffix(b")"))
                .is_some_and(|inner| {
                    let inner = bun_core::strings::trim_js_whitespace_start(inner);
                    let rest = inner
                        .strip_prefix(b"without")
                        .or_else(|| inner.strip_prefix(b"with"));
                    rest.and_then(|it| {
                        bun_core::strings::trim_js_whitespace_start(it).strip_prefix(b":")
                    })
                    .is_some_and(|it| !it.is_empty())
                });
            match is_query {
                true => node.params = Params::Value(value(&params, values, selectors)?),
                false => node.selector = Some(selectors.parse(&params, &self.stack)),
            }
        } else if matches!(&*name.to_ascii_lowercase(), b"import" | b"use" | b"forward") {
            node.params = Params::Value(value(&params, values, selectors)?);
        } else if parses_params_as_value(name) {
            let mut text = params.clone();
            if let Some(moved) = move_space_after_dots(&text) {
                text = Cow::Owned(moved);
            }
            if let Some(moved) = move_space_after_parenthesis(&text) {
                text = Cow::Owned(moved);
            }
            node.value = Value::Parsed(value(&text, values, selectors)?);
        } else if matches!(&*name.to_ascii_lowercase(), b"media" | b"custom-media") {
            node.params = if bun_core::strings::contains(&params, b"#{") {
                // Prettier's result for this case is discarded, so the string from `postcss` stays.
                Params::Text(match &raw.clean_params {
                    Some(clean) => Cow::Owned(clean.to_vec()),
                    None => Cow::Borrowed(self.of(raw.params)),
                })
            } else if self.syntax != Syntax::Css
                && strings::contains(&params, b"//")
                && next_line_comment(&params, 0).is_some()
            {
                // Prettier joins a query onto one line: `@media a // b⏎ and (c)` becomes `@media a // b and (c)`. Keep
                // the original text instead.
                let start = root_offset as usize;
                Params::Text(match self.original_text.get(start..start + params.len()) {
                    Some(text) => Cow::Borrowed(text),
                    None => params.clone(),
                })
            } else {
                match params {
                    Cow::Borrowed(text) => match media_query::parse(text) {
                        Ok(list) => Params::Media(list),
                        Err(_) => Params::Unknown(params.clone()),
                    },
                    Cow::Owned(_) => Params::Unknown(params.clone()),
                }
            };
        } else {
            node.params = Params::Text(params.clone());
        }
        Ok(())
    }
}
