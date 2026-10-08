//! Prettier's `parser-postcss.js`: the tree of `postcss`, with selectors, values and parameters
//! parsed.

use super::Parser as Syntax;
use super::media_query::{self, MediaNode};
use super::postcss::{self, Kind, NodeId, Range, Tree};
use super::selector_parser::{SelectorId, Selectors};
use super::text::{self, ByteSet};
use super::value_parser::{ValueId, Values};
use std::borrow::Cow;

/// `node.value`
pub(crate) enum Value<'a> {
    None,
    Text(Cow<'a, [u8]>),
    Parsed(ValueId),
    /// `--a: { .. }`: `{ type: "css-rule", nodes }`. The nodes are those of the rule that is the only node of the
    /// tree.
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

/// The selectors and the values of a node. Those of the next node take their place.
#[derive(Default)]
pub(crate) struct Parsed {
    pub(crate) selectors: Selectors,
    pub(crate) values: Values,
}

/// A node, without what is in its block.
pub(crate) struct CssNode<'a> {
    pub(crate) kind: Kind,
    /// `locStart(node)` and `locEnd(node)`
    pub(crate) start: usize,
    pub(crate) end: usize,
    /// Whether it has `nodes`.
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
    /// `isNested`: a declaration of SCSS with a block.
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
    /// What `postcss-less` and Prettier say of a node of Less.
    pub(crate) extend: bool,
    pub(crate) mixin: bool,
    pub(crate) function: bool,
    pub(crate) variable: bool,
}

pub(crate) struct SyntaxError;

impl From<postcss::SyntaxError> for SyntaxError {
    fn from(_: postcss::SyntaxError) -> Self {
        SyntaxError
    }
}

pub(crate) struct Context<'a> {
    /// What is parsed.
    pub(crate) text: &'a [u8],
    /// `options.originalText`
    pub(crate) original_text: &'a [u8],
    /// Whether that is the same.
    pub(crate) is_original_text: bool,
    /// `Tree::extra`
    pub(crate) extra: &'a [u8],
    pub(crate) syntax: Syntax,
}

/// The part of `text` from `start` to `end`.
fn slice<'a>(text: &Cow<'a, [u8]>, start: usize, end: usize) -> Cow<'a, [u8]> {
    match text {
        Cow::Borrowed(text) => Cow::Borrowed(text.get(start..end).unwrap_or_default()),
        Cow::Owned(text) => Cow::Owned(text.get(start..end).unwrap_or_default().to_vec()),
    }
}

/// `text.trim()`
fn trim<'a>(text: &Cow<'a, [u8]>) -> Cow<'a, [u8]> {
    let start = text.len() - text::trim_start(text).len();
    slice(text, start, start + text::trim(text).len())
}

/// `/(\s*)(!default).*$/` or the same with `!global`: where the match starts.
fn find_directive(value: &[u8], directive: &[u8]) -> Option<usize> {
    let mut from = 0;
    while let Some(at) = text::index_of_from(value, directive, from) {
        if bun_core::strings::index_of_any(&value[at..], b"\n\r").is_none()
            && !text::includes(&value[at..], "\u{2028}".as_bytes())
        {
            return Some(text::trim_end(&value[..at]).len());
        }
        from = at + 1;
    }
    None
}

/// `/^\s*:?\s*/`: the length of the match.
fn after_name_prefix_len(after_name: &[u8]) -> usize {
    let rest = text::trim_start(after_name);
    let rest = text::trim_start(rest.strip_prefix(b":").unwrap_or(rest));
    after_name.len() - rest.len()
}

/// `params.replace(/^(?!if)([^"'\s(]+)(\s+)\(/, "$1($2")`
fn move_space_behind_parenthesis(params: &[u8]) -> Option<Vec<u8>> {
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
fn move_space_behind_dots(params: &[u8]) -> Option<Vec<u8>> {
    let mut from = 0;
    while let Some(dollar) = text::index_of_char_from(params, b'$', from) {
        // `\S+?` takes as little as it can, and no white space.
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
        from = dollar + 1;
    }
    None
}

/// `getValueRootOffset` and `getAtRuleParamsRootOffset` for an at-rule.
fn value_root_offset(node: &CssNode<'_>) -> u32 {
    (node.start + 1 + node.name.len() + after_name_prefix_len(node.after_name)) as u32
}

/// `isScssNestedPropertyNode`. `selector`: as `postcss` has cleaned it.
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
    text::trim_end(&selector).ends_with(b":")
}

impl<'a> Context<'a> {
    pub(crate) fn of(&self, range: Range) -> &'a [u8] {
        postcss::text_of_range(range, self.text, self.extra)
    }

    /// The texts of `ranges`, one after the other.
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

    /// What `parseNestedCSS` does with an at-rule of Less only. Returns whether that is all.
    fn convert_less_at_rule(
        &self,
        raw: &postcss::Node,
        node: &mut CssNode<'a>,
        parsed: &mut Parsed,
    ) -> Result<bool, SyntaxError> {
        let parse = |text: Cow<'a, [u8]>, node: &CssNode<'a>, parsed: &mut Parsed| {
            let Parsed { selectors, values } = parsed;
            values
                .parse(&text, self.syntax, value_root_offset(node), selectors)
                .map(Value::Parsed)
                .map_err(|_| SyntaxError)
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

        // For `postcss-less` it is a variable, and `node.value` is a string.
        if raw.variable {
            let mut value = skip(&clean_params, raw.value_skips as usize);
            if !text::trim(&value).is_empty() {
                for directive in [&b"!default"[..], b"!global"] {
                    if let Some(at) = find_directive(&value, directive) {
                        match &mut value {
                            Cow::Borrowed(value) => *value = &value[..at],
                            Cow::Owned(value) => value.truncate(at),
                        }
                    }
                }
                node.value = parse(value, node, parsed)?;
            }
        }

        if raw.mixin {
            // `raws.identifier + name + raws.afterName + raws.params`
            let source = [
                self.of(raw.identifier),
                node.name,
                node.after_name,
                &node.raw_params,
            ]
            .concat();
            node.selector = Some(parsed.selectors.parse(&source));
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
            let value = if clean_params.is_empty() {
                Cow::Borrowed(rest)
            } else if node.after_name.is_empty() && raw.clean_params.is_none() {
                Cow::Borrowed(self.of(Range::new(
                    raw.name.start + colon as u32 + 1,
                    raw.params.end,
                )))
            } else {
                Cow::Owned([rest, &clean_params].concat())
            };
            node.value = parse(value, node, parsed)?;
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
                node.value = parse(skip(&clean_params, 1), node, parsed)?;
            }
        }
        Ok(node.variable)
    }

    /// Whether `id` and everything in it can be converted.
    fn can_be_converted(&self, tree: &Tree, id: NodeId, parsed: &mut Parsed) -> bool {
        self.convert(tree, id, parsed).is_ok()
            && tree
                .children(&tree.nodes[id as usize])
                .all(|child| self.can_be_converted(tree, child, parsed))
    }

    /// `locEnd(node)`
    pub(crate) fn end_of(&self, tree: &Tree, id: NodeId, parsed: &mut Parsed) -> usize {
        let raw = &tree.nodes[id as usize];
        match raw.end {
            Some(end) if !raw.inline => (end as usize).min(self.original_text.len()),
            _ => self.convert(tree, id, parsed).map_or(0, |node| node.end),
        }
    }

    /// The name that an at-rule has for Prettier.
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

    /// `parseNestedCSS`, and `calculateLoc` for the node. What has been in `parsed` is lost.
    pub(crate) fn convert(
        &self,
        tree: &Tree,
        id: NodeId,
        parsed: &mut Parsed,
    ) -> Result<CssNode<'a>, SyntaxError> {
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
            extend: raw.extend,
            mixin: raw.mixin,
            function: raw.function,
            variable: raw.variable,
        };

        match raw.kind {
            Kind::Root | Kind::Comment => {}
            Kind::Rule => {
                node.raw_selector = match text::trim(&node.between).is_empty() {
                    true => Cow::Borrowed(self.of(raw.selector)),
                    false => self.concat(&[raw.selector, raw.between]),
                };
                // Prettier has no way to print a selector that is still a string.
                if text::trim(&node.raw_selector).is_empty()
                    || (node.raw_selector.starts_with(b"@") && node.raw_selector.ends_with(b":"))
                {
                    return Err(SyntaxError);
                }
                {
                    let clean = raw
                        .clean_selector
                        .as_deref()
                        .unwrap_or_else(|| self.of(raw.selector));
                    node.is_scss_nested_property =
                        self.syntax == Syntax::Scss && is_scss_nested_property(clean);
                    node.selector = Some(parsed.selectors.parse(&node.raw_selector));
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
            // What is in `parsed` is lost, which only matters for what is printed: the root is not.
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
    ) -> Result<(), SyntaxError> {
        let value = self.of(raw.value);
        // `getValueRootOffset`
        let root_offset = raw.start + node.prop.len() as u32 + node.between.len() as u32;

        // A custom property set looks like a declaration.
        if node.prop.starts_with(b"--") && value.starts_with(b"{") {
            let mut rules = None;
            if text::trim_end(raw.clean_value.as_deref().unwrap_or(value)).ends_with(b"}")
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
                // What is in it would not live long enough.
                && tree.extra.is_empty()
                && self.can_be_converted(&tree, only, parsed)
            {
                rules = Some(Box::new(tree));
            }
            parsed.values.clear();
            node.value = match rules {
                Some(rules) => Value::Rule(rules),
                // Prettier reads `raws.value.raw`, which is only there if the value has comments.
                None if raw.clean_value.is_none() => return Err(SyntaxError),
                None => Value::Parsed(parsed.values.unknown(value, root_offset)),
            };
            return Ok(());
        }

        let mut value = value;
        if text::trim(value).is_empty() {
            node.value = Value::Text(match &raw.clean_value {
                Some(clean) => Cow::Owned(clean.to_vec()),
                None => Cow::Borrowed(value),
            });
        } else {
            static BANG: ByteSet = ByteSet::new(b"!");
            let has_bang = BANG.find(value, 0).is_some();
            if has_bang && let Some(at) = find_directive(value, b"!default") {
                node.scss_default = true;
                node.raw_scss_default =
                    Some(&value[at..]).filter(|it| text::trim(it) != b"!default");
                value = &value[..at];
            }
            if has_bang && let Some(at) = find_directive(value, b"!global") {
                node.scss_global = true;
                node.raw_scss_global = Some(&value[at..]).filter(|it| text::trim(it) != b"!global");
                value = &value[..at];
            }
            if value.starts_with(b"progid:") {
                // It stays the string that `postcss` has made of it.
                node.value = Value::Text(match &raw.clean_value {
                    Some(clean) => Cow::Owned(clean.to_vec()),
                    None => Cow::Borrowed(self.of(raw.value)),
                });
                return Ok(());
            }
            let root = parsed
                .values
                .parse(value, self.syntax, root_offset, &mut parsed.selectors)
                .map_err(|_| SyntaxError)?;
            node.value = Value::Parsed(root);
        }

        if self.syntax == Syntax::Less {
            // `a +: b`, which merges: `/^\s*\+\s*:/`
            let spaces = text::leading_white_space_len(&node.between);
            if let Some(rest) = node.between[spaces..].strip_prefix(b"+")
                && text::trim_start(rest).starts_with(b":")
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
                    node.selector = Some(parsed.selectors.parse(selector));
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
    ) -> Result<(), SyntaxError> {
        let has_text = |range: Range| !text::trim(self.of(range)).is_empty();
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
        let root_offset = value_root_offset(node);
        let Parsed { selectors, values } = parsed;
        let value = |text: &[u8], values: &mut Values, selectors: &mut Selectors| {
            values
                .parse(text, self.syntax, root_offset, selectors)
                .map_err(|_| SyntaxError)
        };

        if self.syntax == Syntax::Css && name == b"custom-selector" {
            // `node.params.match(/:--\S+\s+/)[0].trim()`
            let clean: Cow<'a, [u8]> = match &raw.clean_params {
                Some(clean) => Cow::Owned(clean.to_vec()),
                None => Cow::Borrowed(self.of(raw.params)),
            };
            let start = text::index_of_from(&clean, b":--", 0).ok_or(SyntaxError)?;
            let name_len = clean[start..]
                .iter()
                .position(|&b| text::starts_with_white_space(&[b]))
                .ok_or(SyntaxError)?;
            if name_len <= 3 {
                return Err(SyntaxError);
            }
            node.custom_selector = Some(slice(&clean, start, start + name_len));
            node.selector = Some(selectors.parse(&trim(&slice(&clean, name_len, clean.len()))));
            return Ok(());
        }
        if params.is_empty() {
            return Ok(());
        }
        if matches!(name, b"warn" | b"error") {
            node.params = Params::Unknown(params.clone());
        } else if matches!(name, b"extend" | b"nest") {
            node.selector = Some(selectors.parse(&params));
        } else if name == b"at-root" {
            // `/^\(\s*(?:without|with)\s*:.+\)$/s`
            let is_query = params
                .strip_prefix(b"(")
                .and_then(|it| it.strip_suffix(b")"))
                .is_some_and(|inner| {
                    let inner = text::trim_start(inner);
                    let rest = inner
                        .strip_prefix(b"without")
                        .or_else(|| inner.strip_prefix(b"with"));
                    rest.and_then(|it| text::trim_start(it).strip_prefix(b":"))
                        .is_some_and(|it| !it.is_empty())
                });
            match is_query {
                true => node.params = Params::Value(value(&params, values, selectors)?),
                false => node.selector = Some(selectors.parse(&params)),
            }
        } else if matches!(&*name.to_ascii_lowercase(), b"import" | b"use" | b"forward") {
            node.params = Params::Value(value(&params, values, selectors)?);
        } else if matches!(
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
        ) {
            let mut text = params.clone();
            if let Some(moved) = move_space_behind_dots(&text) {
                text = Cow::Owned(moved);
            }
            if let Some(moved) = move_space_behind_parenthesis(&text) {
                text = Cow::Owned(moved);
            }
            node.value = Value::Parsed(value(&text, values, selectors)?);
        } else if matches!(&*name.to_ascii_lowercase(), b"media" | b"custom-media") {
            node.params = if text::includes(&params, b"#{") {
                // What Prettier makes of it is lost, and the string of `postcss` stays.
                Params::Text(match &raw.clean_params {
                    Some(clean) => Cow::Owned(clean.to_vec()),
                    None => Cow::Borrowed(self.of(raw.params)),
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
