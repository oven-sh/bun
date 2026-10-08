//! Prettier's `printer-postcss.js` and `print/sequence.js`.

use super::Parser as Syntax;
use super::doc::{Doc, dedent, docs, group, hardline, indent, join, line_suffix, remove_lines, replace_end_of_line_with_literal_lines};
use super::media_query::{MediaKind, MediaNode};
use super::misc::{
    adjust_numbers, adjust_strings, has_newline_backwards, is_next_line_empty, last_line_has_inline_comment,
    maybe_to_lower_case, print_css_number, print_string, print_unit, quote_attribute_value,
};
use super::parse::{CssNode, Params, Value};
use super::postcss::Kind;
use super::selector_parser::{Namespace, SelectorKind, SelectorNode};
use super::text;
use super::value_parser::{ValueKind, ValueNode};
use std::borrow::Cow;

pub(crate) struct Printer<'t, 'a> {
    /// `options.originalText`
    pub(crate) text: &'a [u8],
    pub(crate) syntax: Syntax,
    pub(crate) single_quote: bool,
    /// `trailingComma` is `"es5"` or `"all"`.
    pub(crate) trailing_comma: bool,
    /// The nodes of the style sheet that what is being printed is in, itself included if it is one.
    pub(crate) css_stack: Vec<&'t CssNode<'a>>,
    /// The nodes of the value that what is being printed is in.
    pub(crate) value_stack: Vec<&'t ValueNode<'a>>,
}

fn owned<'t>(text: Cow<'_, [u8]>, original: &'t [u8]) -> Doc<'t> {
    match text {
        Cow::Borrowed(_) => Doc::from(original),
        Cow::Owned(text) => Doc::from(text),
    }
}

/// `text.replace(/\s*!\s*important/i, " !important")`, and the same for other words.
fn normalize_bang(text: &[u8], word: &[u8], allows_space: bool) -> Vec<u8> {
    let mut from = 0;
    while let Some(bang) = text::index_of_char_from(text, b'!', from) {
        let after = &text[bang + 1..];
        let after = if allows_space { text::trim_start(after) } else { after };
        if after.len() >= word.len() && after[..word.len()].eq_ignore_ascii_case(word) {
            let mut out = text::trim_end(&text[..bang]).to_vec();
            out.extend_from_slice(b" !");
            out.extend_from_slice(word);
            out.extend_from_slice(&after[word.len()..]);
            return out;
        }
        from = bang + 1;
    }
    text.to_vec()
}

impl<'t, 'a: 't> Printer<'t, 'a> {
    // ───────────────────────────── ancestors ─────────────────────────────

    /// `path.findAncestor((node) => node.type === kind)`, for what is in a selector, a value or
    /// parameters: the node of the style sheet that it belongs to counts.
    pub(crate) fn css_ancestor(&self, kind: Kind) -> Option<&'t CssNode<'a>> {
        self.css_stack.iter().rev().find(|node| node.kind == kind).copied()
    }

    /// `insideAtRuleNode`
    pub(crate) fn inside_at_rule(&self, names: &[&[u8]]) -> bool {
        self.css_ancestor(Kind::AtRule).is_some_and(|node| names.iter().any(|name| text::eq_lower_case(node.name, name)))
    }

    /// `insideIcssRuleNode`, for a declaration.
    fn inside_icss_rule(&self) -> bool {
        self.css_stack.iter().any(|node| {
            node.kind == Kind::Rule && (node.raw_selector.starts_with(b":import") || node.raw_selector.starts_with(b":export"))
        })
    }

    // ───────────────────────────── the style sheet ─────────────────────────────

    pub(crate) fn print_root(&mut self, root: &'t CssNode<'a>) -> Doc<'t> {
        self.css_stack.push(root);
        let nodes = self.print_sequence(root);
        self.css_stack.pop();
        let mut after = text::trim(root.after);
        if let Some(rest) = after.strip_prefix(b";") {
            after = text::trim(rest);
        }
        let has_nodes = root.nodes.as_ref().is_some_and(|nodes| !nodes.is_empty());
        docs![
            nodes,
            if after.is_empty() { Doc::EMPTY } else { docs![" ", after] },
            if has_nodes { hardline() } else { Doc::EMPTY },
        ]
    }

    /// `printSequence`
    fn print_sequence(&mut self, parent: &'t CssNode<'a>) -> Doc<'t> {
        let nodes = parent.nodes.as_deref().unwrap_or_default();
        let mut parts = Vec::with_capacity(nodes.len() * 2);
        for (index, node) in nodes.iter().enumerate() {
            let previous = index.checked_sub(1).and_then(|at| nodes.get(at));
            if previous.is_some_and(|it| it.kind == Kind::Comment && text::trim(it.text) == b"prettier-ignore") {
                parts.push(Doc::from(self.text.get(node.start..node.end).unwrap_or_default()));
            } else {
                parts.push(self.print_css(node, index + 1 == nodes.len()));
            }
            let Some(next) = nodes.get(index + 1) else {
                break;
            };
            if (next.kind == Kind::Comment && !has_newline_backwards(self.text, next.start))
                || (next.kind == Kind::AtRule && next.name == b"else" && node.kind != Kind::Comment)
            {
                parts.push(Doc::from(" "));
            } else {
                parts.push(hardline());
                if is_next_line_empty(self.text, node.end) {
                    parts.push(hardline());
                }
            }
        }
        Doc::Array(parts)
    }

    fn print_css(&mut self, node: &'t CssNode<'a>, _is_last: bool) -> Doc<'t> {
        self.css_stack.push(node);
        let doc = match node.kind {
            Kind::Root => self.print_root(node),
            Kind::Comment => {
                let text = self.text.get(node.start..node.end).unwrap_or_default();
                Doc::from(if node.inline { text::trim_end(text) } else { text })
            }
            Kind::Rule => self.print_rule(node),
            Kind::Decl => self.print_declaration(node),
            Kind::AtRule => self.print_at_rule(node),
        };
        self.css_stack.pop();
        doc
    }

    /// `{`, what is in it, each on a line of its own, and `}`.
    fn print_block(&mut self, node: &'t CssNode<'a>, line: fn() -> Doc<'t>) -> Doc<'t> {
        let is_empty = node.nodes.as_ref().is_none_or(|nodes| nodes.is_empty());
        docs![
            "{",
            if is_empty { Doc::EMPTY } else { indent(docs![line(), self.print_sequence(node)]) },
            line(),
            "}",
        ]
    }

    fn print_rule(&mut self, node: &'t CssNode<'a>) -> Doc<'t> {
        let selector = match &node.selector {
            Some(selector) => self.print_selector(selector, None, None, true),
            None => Doc::EMPTY,
        };
        let separator = match &node.selector {
            Some(selector) if selector.kind == SelectorKind::Unknown && last_line_has_inline_comment(&selector.value) => {
                Doc::LINE
            }
            Some(_) => Doc::from(" "),
            None => Doc::EMPTY,
        };
        // `isDetachedRulesetDeclarationNode`: `/^@.+:.*$/`
        let is_detached_ruleset = node.selector.as_ref().is_some_and(|selector| {
            let value = &selector.value;
            selector.kind == SelectorKind::Unknown
                && value.starts_with(b"@")
                && bun_core::strings::index_of_any(value, b"\n\r").is_none()
                && text::index_of_char_from(value, b':', 2).is_some()
        });
        docs![
            selector,
            if node.important { " !important" } else { "" },
            separator,
            self.print_block(node, hardline),
            if is_detached_ruleset { ";" } else { "" },
        ]
    }

    fn print_declaration(&mut self, node: &'t CssNode<'a>) -> Doc<'t> {
        let trimmed_between = text::trim(node.between);
        let is_colon = trimmed_between == b":";
        let is_value_all_space = matches!(&node.value, Value::Text(value) if value.iter().all(|&b| b == b' '));
        let mut value = match &node.value {
            Value::None => Doc::EMPTY,
            Value::Text(value) => Doc::from(&**value),
            Value::Parsed(value) => self.print_value(value, None),
            Value::Rule(_) => docs!["{", self.print_rule_value(node), hardline(), "}"],
        };
        // `hasComposesNode`
        if matches!(&node.value, Value::Parsed(value) if matches!(value.kind, ValueKind::Root { .. }))
            && text::eq_lower_case(node.prop, b"composes")
        {
            value = remove_lines(value);
        }
        if !is_colon && last_line_has_inline_comment(trimmed_between) && !self.should_break_top_level_list(node) {
            value = indent(docs![hardline(), dedent(value)]);
        }

        let before: Vec<u8> =
            node.before.iter().copied().filter(|&b| b != b';' && !text::starts_with_white_space(&[b])).collect();
        let prop = match self.inside_icss_rule() {
            true => Doc::from(node.prop),
            false => owned(maybe_to_lower_case(node.prop), node.prop),
        };
        let bang = |raw: Option<&[u8]>, is_set: bool, word: &'static str, allows_space: bool| match raw {
            Some(raw) => Doc::from(normalize_bang(raw, word.as_bytes(), allows_space)),
            None if is_set => docs![" !", word],
            None => Doc::EMPTY,
        };
        docs![
            before,
            prop,
            if trimmed_between.starts_with(b"//") { " " } else { "" },
            trimmed_between,
            if is_value_all_space { "" } else { " " },
            value,
            bang(node.raw_important, node.important, "important", true),
            bang(node.raw_scss_default, node.scss_default, "default", false),
            bang(node.raw_scss_global, node.scss_global, "global", false),
            match &node.nodes {
                Some(_) => docs![" ", self.print_block(node, || Doc::SOFTLINE)],
                None => Doc::from(";"),
            },
        ]
    }

    /// What is between the braces of `--a: { .. }`.
    fn print_rule_value(&mut self, node: &'t CssNode<'a>) -> Doc<'t> {
        let Value::Rule(nodes) = &node.value else {
            return Doc::EMPTY;
        };
        if nodes.is_empty() {
            return Doc::EMPTY;
        }
        let mut parts = Vec::with_capacity(nodes.len() * 2);
        for (index, child) in nodes.iter().enumerate() {
            let previous = index.checked_sub(1).and_then(|at| nodes.get(at));
            if previous.is_some_and(|it| it.kind == Kind::Comment && text::trim(it.text) == b"prettier-ignore") {
                parts.push(Doc::from(self.text.get(child.start..child.end).unwrap_or_default()));
            } else {
                parts.push(self.print_css(child, index + 1 == nodes.len()));
            }
            let Some(next) = nodes.get(index + 1) else {
                break;
            };
            if next.kind == Kind::Comment && !has_newline_backwards(self.text, next.start) {
                parts.push(Doc::from(" "));
            } else {
                parts.push(hardline());
                if is_next_line_empty(self.text, child.end) {
                    parts.push(hardline());
                }
            }
        }
        indent(docs![hardline(), parts])
    }

    /// `path.call(() => shouldBreakList(path), "value", "group", "group")`
    fn should_break_top_level_list(&self, node: &CssNode<'a>) -> bool {
        let Value::Parsed(root) = &node.value else {
            return false;
        };
        let ValueKind::Root { group } = &root.kind else {
            return false;
        };
        let ValueKind::Value { group } = &group.kind else {
            return false;
        };
        is_list_with_comma_group(group) && !node.prop.starts_with(b"--")
    }

    fn print_at_rule(&mut self, node: &'t CssNode<'a>) -> Doc<'t> {
        // `/^\(\s*\)$/`
        let is_detached_ruleset_call = node
            .raw_params
            .strip_prefix(b"(")
            .and_then(|it| it.strip_suffix(b")"))
            .is_some_and(|inner| text::trim(inner).is_empty());
        let is_control_directive = self.is_scss_control_directive(node);
        let name = match is_detached_ruleset_call || node.name.ends_with(b":") {
            true => Doc::from(node.name),
            false => owned(maybe_to_lower_case(node.name), node.name),
        };
        let params = match &node.params {
            Params::None => None,
            Params::Text(params) if params.is_empty() => None,
            Params::Text(params) | Params::Unknown(params) => Some(Doc::from(&**params)),
            Params::Media(list) => Some(self.print_media(list, true)),
            Params::Value(value) => Some(self.print_value(value, None)),
        };
        let params = match params {
            Some(params) => docs![if is_detached_ruleset_call { "" } else { " " }, params],
            None => Doc::EMPTY,
        };
        let selector = match &node.selector {
            Some(selector) => indent(docs![" ", self.print_selector(selector, None, None, true)]),
            None => Doc::EMPTY,
        };
        let value = match &node.value {
            Value::Parsed(value) => {
                // `hasParensAroundNode`
                let has_parens = matches!(top_level_group(value).map(|it| &it.kind), Some(ValueKind::ParenGroup { open: Some(_), close: Some(_), .. }));
                group(docs![
                    " ",
                    self.print_value(value, None),
                    match (is_control_directive, has_parens) {
                        (false, _) => Doc::EMPTY,
                        (true, true) => Doc::from(" "),
                        (true, false) => Doc::LINE,
                    },
                ])
            }
            _ if node.name == b"else" => Doc::from(" "),
            _ => Doc::EMPTY,
        };
        let is_import_that_ends_with_semicolon = node.name == b"import"
            && matches!(&node.params, Params::Value(value) if matches!(&value.kind, ValueKind::Unknown(text) if text.ends_with(b";")));
        let rest = match &node.nodes {
            Some(_) => {
                let has_inline_comment = match (&node.selector, &node.params) {
                    (Some(selector), _) => {
                        selector.kind == SelectorKind::Unknown && last_line_has_inline_comment(&selector.value)
                    }
                    (None, Params::Text(params)) => last_line_has_inline_comment(params),
                    _ => false,
                };
                docs![
                    match (is_control_directive, has_inline_comment) {
                        (true, _) => Doc::EMPTY,
                        (false, true) => Doc::LINE,
                        (false, false) => Doc::from(" "),
                    },
                    self.print_block(node, || Doc::SOFTLINE),
                ]
            }
            None if is_import_that_ends_with_semicolon => Doc::EMPTY,
            None => Doc::from(";"),
        };
        docs!["@", name, params, selector, value, rest]
    }

    /// `isSCSSControlDirectiveNode`
    pub(crate) fn is_scss_control_directive(&self, node: &CssNode<'a>) -> bool {
        self.syntax == Syntax::Scss
            && node.kind == Kind::AtRule
            && matches!(node.name, b"if" | b"else" | b"for" | b"each" | b"while")
    }

    // ───────────────────────────── media queries ─────────────────────────────

    fn print_media(&mut self, node: &'t MediaNode<'a>, is_last: bool) -> Doc<'t> {
        let children = node.nodes.as_deref().unwrap_or_default();
        let adjusted = |value: &'t [u8], numbers: bool| -> Doc<'t> {
            let strings = adjust_strings(value, self.single_quote);
            match numbers {
                false => owned(strings, value),
                true => match (adjust_numbers(&strings), &strings) {
                    (Cow::Owned(text), _) => Doc::from(text),
                    (Cow::Borrowed(_), Cow::Owned(text)) => Doc::from(text.clone()),
                    (Cow::Borrowed(_), Cow::Borrowed(_)) => Doc::from(value),
                },
            }
        };
        match node.kind {
            MediaKind::QueryList => {
                let count = children.len();
                let mut parts = Vec::with_capacity(count);
                for (index, child) in children.iter().enumerate() {
                    if child.kind == MediaKind::Query && child.value.is_empty() {
                        continue;
                    }
                    parts.push(self.print_media(child, index + 1 == count));
                }
                group(indent(join(&Doc::LINE, parts)))
            }
            MediaKind::Query => {
                let parts = children.iter().map(|child| self.print_media(child, false)).collect();
                docs![join(&Doc::from(" "), parts), if is_last { "" } else { "," }]
            }
            MediaKind::Type | MediaKind::Value => adjusted(node.value, true),
            MediaKind::FeatureExpression => match &node.nodes {
                None => Doc::from(node.value),
                Some(children) => {
                    let parts: Vec<Doc<'t>> = children.iter().map(|child| self.print_media(child, false)).collect();
                    docs!["(", parts, ")"]
                }
            },
            MediaKind::Feature => {
                // `value.replaceAll(/ +/g, " ")`
                let mut value = Vec::with_capacity(node.value.len());
                for &byte in node.value {
                    if byte != b' ' || value.last() != Some(&b' ') {
                        value.push(byte);
                    }
                }
                let value = adjust_strings(&value, self.single_quote).into_owned();
                Doc::from(maybe_to_lower_case(&value).into_owned())
            }
            MediaKind::Colon => docs![node.value, " "],
            MediaKind::Keyword => adjusted(node.value, false),
            MediaKind::Url => {
                // `.replaceAll(/^url\(\s+/gi, "url(").replaceAll(/\s+\)$/g, ")")`
                let mut value = node.value.to_vec();
                if value.len() >= 4 && value[..4].eq_ignore_ascii_case(b"url(") && text::starts_with_white_space(&value[4..]) {
                    value = [b"url(", text::trim_start(&value[4..])].concat();
                }
                if let Some(rest) = value.strip_suffix(b")")
                    && text::trim_end(rest).len() < rest.len()
                {
                    value = [text::trim_end(rest), b")"].concat();
                }
                Doc::from(adjust_strings(&value, self.single_quote).into_owned())
            }
            MediaKind::Unknown => Doc::from(node.value),
        }
    }

    // ───────────────────────────── selectors ─────────────────────────────

    fn print_namespace(namespace: &'t Option<Namespace<'a>>) -> Doc<'t> {
        match namespace {
            None => Doc::EMPTY,
            Some(Namespace::Empty) => Doc::from("|"),
            Some(Namespace::Name(name)) => docs![text::trim(name), "|"],
        }
    }

    /// `parent`: the selector that `node` is in. `previous`: what is before it there.
    pub(crate) fn print_selector(
        &mut self,
        node: &'t SelectorNode<'a>,
        parent: Option<&'t SelectorNode<'a>>,
        previous: Option<&'t SelectorNode<'a>>,
        is_last: bool,
    ) -> Doc<'t> {
        let value: &'t [u8] = &node.value;
        let single_quote = self.single_quote;
        let adjust = |value: &[u8]| adjust_numbers(&adjust_strings(value, single_quote)).into_owned();
        match node.kind {
            SelectorKind::Root => {
                let custom_selector = match self.inside_at_rule(&[b"custom-selector"]) {
                    true => self.css_ancestor(Kind::AtRule).and_then(|it| it.custom_selector),
                    false => None,
                };
                let separator = match self.inside_at_rule(&[b"extend", b"custom-selector", b"nest"]) {
                    true => Doc::LINE,
                    false => hardline(),
                };
                let nodes = self.print_selectors(node);
                group(docs![
                    match custom_selector {
                        Some(name) => docs![name, Doc::LINE],
                        None => Doc::EMPTY,
                    },
                    join(&docs![",", separator], nodes),
                ])
            }
            SelectorKind::Selector => {
                let nodes = Doc::Array(self.print_selectors(node));
                group(if node.nodes.len() > 2 { indent(nodes) } else { nodes })
            }
            SelectorKind::Comment | SelectorKind::Nesting => Doc::from(value),
            SelectorKind::String => owned(adjust_strings(value, single_quote), value),
            SelectorKind::Tag => {
                let name = if previous.is_some_and(|it| it.kind == SelectorKind::Nesting) {
                    Doc::from(value)
                } else {
                    // `isKeyframeAtRuleKeywords`
                    let is_keyframe_keyword = (text::eq_lower_case(value, b"from") || text::eq_lower_case(value, b"to"))
                        && self.css_ancestor(Kind::AtRule).is_some_and(|it| it.name.to_ascii_lowercase().ends_with(b"keyframes"));
                    match is_keyframe_keyword {
                        true => Doc::from(value.to_ascii_lowercase()),
                        false => owned(adjust_numbers(value), value),
                    }
                };
                docs![Self::print_namespace(&node.namespace), name]
            }
            SelectorKind::Id => docs!["#", value],
            SelectorKind::Class => docs![".", adjust(value)],
            SelectorKind::Attribute => {
                let attribute_value = match node.has_value {
                    true => {
                        let adjusted = adjust_strings(text::trim(value), single_quote);
                        replace_end_of_line_with_literal_lines(Cow::Owned(
                            quote_attribute_value(adjusted, single_quote).into_owned(),
                        ))
                    }
                    false => Doc::EMPTY,
                };
                docs![
                    "[",
                    Self::print_namespace(&node.namespace),
                    text::trim(&node.attribute),
                    node.operator.as_deref().unwrap_or_default(),
                    attribute_value,
                    if node.insensitive { " i" } else { "" },
                    "]",
                ]
            }
            SelectorKind::Combinator => {
                if matches!(value, b"+" | b">" | b"~" | b">>>") {
                    let is_first = parent.is_some_and(|parent| {
                        parent.kind == SelectorKind::Selector && parent.nodes.first().is_some_and(|it| std::ptr::eq(it, node))
                    });
                    return docs![
                        if is_first { Doc::EMPTY } else { Doc::LINE },
                        value,
                        if is_last { "" } else { " " },
                    ];
                }
                let leading = if text::trim_start(value).starts_with(b"(") { Doc::LINE } else { Doc::EMPTY };
                let adjusted = adjust(text::trim(value));
                docs![leading, if adjusted.is_empty() { Doc::LINE } else { Doc::from(adjusted) }]
            }
            SelectorKind::Universal => docs![Self::print_namespace(&node.namespace), value],
            SelectorKind::Pseudo => {
                let arguments = match node.nodes.is_empty() {
                    true => Doc::EMPTY,
                    false => {
                        let nodes = self.print_selectors(node);
                        group(docs![
                            "(",
                            indent(docs![Doc::SOFTLINE, join(&docs![",", Doc::LINE], nodes)]),
                            Doc::SOFTLINE,
                            ")",
                        ])
                    }
                };
                docs![owned(maybe_to_lower_case(value), value), arguments]
            }
            SelectorKind::Unknown => self.print_unknown_selector(node),
        }
    }

    fn print_selectors(&mut self, node: &'t SelectorNode<'a>) -> Vec<Doc<'t>> {
        let count = node.nodes.len();
        (0..count)
            .map(|index| {
                let previous = index.checked_sub(1).and_then(|at| node.nodes.get(at));
                self.print_selector(&node.nodes[index], Some(node), previous, index + 1 == count)
            })
            .collect()
    }

    fn print_unknown_selector(&mut self, node: &'t SelectorNode<'a>) -> Doc<'t> {
        // In the parentheses of `selector()`.
        if let [.., func, paren_group] = self.value_stack[..]
            && let ValueKind::ParenGroup {
                open: Some(open),
                close: Some(close),
                ..
            } = &paren_group.kind
            && matches!(&func.kind, ValueKind::Func { value, .. } if **value == *b"selector")
        {
            let start = open.loc.end_offset.map_or(0, |at| at as usize + 1);
            let end = close.loc.start_offset.map_or(0, |at| at as usize);
            let selector = text::trim(self.text.get(start..end).unwrap_or_default());
            return match last_line_has_inline_comment(selector) {
                true => docs![Doc::BreakParent, selector],
                false => Doc::from(selector),
            };
        }
        // The text is taken from the style sheet, for the sake of Less.
        if self.value_stack.is_empty()
            && let Some(parent) = self.css_stack.last().filter(|parent| !parent.raw_selector.is_empty())
        {
            let end = parent.start + parent.raw_selector.len();
            return Doc::from(text::trim(self.text.get(parent.start..end).unwrap_or_default()));
        }
        Doc::from(&*node.value)
    }

    // ───────────────────────────── values ─────────────────────────────

    /// `insideValueFunctionNode`
    pub(crate) fn inside_value_function(&self, name: &[u8]) -> bool {
        let function = self.value_stack.iter().rev().find_map(|node| match &node.kind {
            ValueKind::Func { value, .. } => Some(value),
            _ => None,
        });
        function.is_some_and(|value| text::eq_lower_case(value, name))
    }

    /// `previous`: what is before `node` in the group that it is in.
    pub(crate) fn print_value(&mut self, node: &'t ValueNode<'a>, previous: Option<&'t ValueNode<'a>>) -> Doc<'t> {
        match &node.kind {
            ValueKind::Root { group } | ValueKind::Value { group } => self.print_child_value(node, group),
            ValueKind::Comment { inline } => {
                let (start, end) = (node.loc.start_offset.unwrap_or(0) as usize, node.loc.end_offset.unwrap_or(0) as usize);
                let text = self.text.get(start..end).unwrap_or_default();
                match inline {
                    true => line_suffix(text::trim_end(text)),
                    false => Doc::from(text),
                }
            }
            ValueKind::CommaGroup { .. } => self.print_comma_separated_value_group(node),
            ValueKind::ParenGroup { .. } => self.print_parenthesized_value_group(node),
            ValueKind::Func { value, group } => {
                let is_keyword = ["not", "and", "or"].iter().any(|it| text::eq_lower_case(value, it.as_bytes()));
                docs![
                    &**value,
                    if is_keyword && self.inside_at_rule(&[b"supports"]) { " " } else { "" },
                    self.print_child_value(node, group),
                ]
            }
            ValueKind::Paren(b'(') => Doc::from("("),
            ValueKind::Paren(_) => Doc::from(")"),
            ValueKind::Number { value, unit } => {
                let mut text = Vec::with_capacity(value.len() + unit.len());
                print_css_number(value, &mut text);
                text.extend_from_slice(print_unit(unit));
                Doc::from(text)
            }
            ValueKind::Operator(value) | ValueKind::UnicodeRange(value) | ValueKind::Unknown(value) | ValueKind::Text(value) => {
                Doc::from(&**value)
            }
            ValueKind::Word {
                value,
                is_hex,
                is_color,
            } => {
                let is_wide_keyword =
                    ["initial", "inherit", "unset", "revert"].iter().any(|it| text::eq_lower_case(value, it.as_bytes()));
                match (*is_color && *is_hex) || is_wide_keyword {
                    true => owned(text::to_lower_case(value), value),
                    false => Doc::from(&**value),
                }
            }
            ValueKind::Colon => {
                let is_escaped = previous.and_then(ValueNode::value).is_some_and(|it| it.ends_with(b"\\"));
                group(docs![":", if is_escaped || self.inside_value_function(b"url") { Doc::EMPTY } else { Doc::LINE }])
            }
            ValueKind::Comma => Doc::from(","),
            ValueKind::String { value, quote } => {
                let raw = [quote, &**value, quote].concat();
                let mut text = Vec::with_capacity(raw.len());
                print_string(&raw, self.single_quote, &mut text);
                Doc::from(text)
            }
            ValueKind::AtWord(value) => docs!["@", &**value],
            ValueKind::Selector(selector) => self.print_selector(selector, None, None, true),
        }
    }

    /// Prints `child`, which is in `parent`.
    pub(crate) fn print_child_value(&mut self, parent: &'t ValueNode<'a>, child: &'t ValueNode<'a>) -> Doc<'t> {
        self.value_stack.push(parent);
        let doc = self.print_value(child, None);
        self.value_stack.pop();
        doc
    }
}

/// `node.value.group.group`
pub(crate) fn top_level_group<'t, 'a>(root: &'t ValueNode<'a>) -> Option<&'t ValueNode<'a>> {
    let ValueKind::Root { group } = &root.kind else {
        return None;
    };
    let ValueKind::Value { group } = &group.kind else {
        return None;
    };
    Some(group)
}

/// The first condition of `shouldBreakList`.
pub(crate) fn is_list_with_comma_group(node: &ValueNode<'_>) -> bool {
    matches!(&node.kind, ValueKind::ParenGroup { open: None, groups, .. }
        if groups.iter().any(|it| matches!(it.kind, ValueKind::CommaGroup { .. })))
}
