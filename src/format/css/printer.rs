//! Prettier's `printer-postcss.js` and `print/sequence.js`.

use super::Parser as Syntax;
use super::media_query::{MediaKind, MediaNode};
use super::misc::{
    adjust_numbers, adjust_strings, has_newline_backwards, is_next_line_empty, last_line_has_inline_comment,
    maybe_to_lower_case, print_css_number, print_string, print_unit, quote_attribute_value,
};
use super::parse::{CssNode, Params, Value};
use super::postcss::Kind;
use super::selector_parser::{Namespace, SelectorKind, SelectorNode};
use super::sink::Sink;
use super::text;
use super::value_parser::{ValueKind, ValueNode};

pub(crate) struct Printer<'t, 'a, 'o> {
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
    /// Prettier throws an error for what has been printed.
    pub(crate) has_failed: bool,
    pub(crate) sink: Sink<'o>,
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

impl<'t, 'a: 't> Printer<'t, 'a, '_> {
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

    /// Has `write` write something that no group is around and that a line break follows. See `Sink`. Whatever
    /// `write` does besides writing, doing it twice has to be the same as doing it once.
    fn unit(&mut self, write: impl Fn(&mut Self)) {
        let mark = self.sink.start_unit();
        write(self);
        if let Some(mark) = mark
            && !self.sink.end_unit(&mark)
        {
            write(self);
            self.sink.end_document();
        }
    }

    pub(crate) fn print_root(&mut self, root: &'t CssNode<'a>) {
        let mut after = text::trim(root.after);
        if let Some(rest) = after.strip_prefix(b";") {
            after = text::trim(rest);
        }
        self.css_stack.push(root);
        self.print_sequence(root.nodes.as_deref().unwrap_or_default(), after);
        self.css_stack.pop();
        if root.nodes.as_ref().is_some_and(|nodes| !nodes.is_empty()) {
            self.sink.hard_line();
        }
    }

    /// Whether no block is printed for `node`.
    fn has_no_block(&self, node: &CssNode<'a>) -> bool {
        match node.kind {
            Kind::Root | Kind::Rule => false,
            Kind::Comment => true,
            Kind::Decl => node.nodes.is_none() && !matches!(node.value, Value::Rule(_)),
            Kind::AtRule => node.nodes.is_none() || (self.syntax == Syntax::Less && (node.mixin || node.function)),
        }
    }

    /// `printSequence`, and `after` behind a blank unless it is empty.
    fn print_sequence(&mut self, nodes: &'t [CssNode<'a>], after: &[u8]) {
        let text = self.text;
        if nodes.is_empty() && !after.is_empty() {
            self.sink.token(" ");
            self.sink.text(after);
        }
        let is_on_the_same_line = |node: &CssNode<'a>, next: &CssNode<'a>| {
            (next.kind == Kind::Comment && !has_newline_backwards(text, next.start))
                || (next.kind == Kind::AtRule && next.name == b"else" && node.kind != Kind::Comment)
        };
        let mut start = 0;
        while start < nodes.len() {
            let mut end = start + 1;
            while nodes.get(end).is_some_and(|next| is_on_the_same_line(&nodes[end - 1], next)) {
                end += 1;
            }
            let write = |printer: &mut Self, from: usize, to: usize| {
                for index in from..to {
                    if index > start {
                        printer.sink.token(" ");
                    }
                    let node = &nodes[index];
                    let previous = index.checked_sub(1).and_then(|at| nodes.get(at));
                    if previous.is_some_and(|it| it.kind == Kind::Comment && text::trim(it.text) == b"prettier-ignore") {
                        printer.sink.text(text.get(node.start..node.end).unwrap_or_default());
                    } else {
                        printer.print_css(node);
                    }
                }
                if to == nodes.len() && !after.is_empty() {
                    printer.sink.token(" ");
                    printer.sink.text(after);
                }
            };
            // What has a block takes care of the line that its `{` ends. Everything else goes with the rest of the
            // line.
            let blocks = nodes[start..end].iter().take_while(|node| node.kind == Kind::Comment || !self.has_no_block(node)).count();
            if blocks > 0 {
                write(self, start, start + blocks);
            }
            if start + blocks < end {
                self.unit(|printer| write(printer, start + blocks, end));
            }
            if end < nodes.len() {
                self.sink.hard_line();
                if is_next_line_empty(text, nodes[end - 1].end) {
                    self.sink.hard_line();
                }
            }
            start = end;
        }
    }

    fn print_css(&mut self, node: &'t CssNode<'a>) {
        self.css_stack.push(node);
        match node.kind {
            Kind::Root => self.print_root(node),
            Kind::Comment => {
                let text = self.text.get(node.start..node.end).unwrap_or_default();
                self.sink.text(if node.inline { text::trim_end(text) } else { text });
            }
            Kind::Rule => self.print_rule(node),
            Kind::Decl => self.print_declaration(node),
            Kind::AtRule => self.print_at_rule(node),
        }
        self.css_stack.pop();
    }

    /// What is in `nodes`, each on a line of its own, and `}`. The `{` has been written.
    fn print_block(&mut self, nodes: &'t [CssNode<'a>], is_hard_line: bool) {
        let line = if is_hard_line { Sink::hard_line } else { Sink::soft_line };
        if !nodes.is_empty() {
            self.sink.start_indent();
            line(&mut self.sink);
            self.print_sequence(nodes, b"");
            self.sink.end_indent();
        }
        line(&mut self.sink);
        self.sink.token("}");
    }

    fn print_rule(&mut self, node: &'t CssNode<'a>) {
        self.unit(|printer| {
            if let Some(selector) = &node.selector {
                printer.print_selector(selector, None, None, true);
            }
            if node.important {
                printer.sink.token(" !important");
            }
            match &node.selector {
                Some(selector) if selector.kind == SelectorKind::Unknown && last_line_has_inline_comment(&selector.value) => {
                    printer.sink.line();
                }
                Some(_) => printer.sink.token(" "),
                None => {}
            }
            printer.sink.token("{");
        });
        self.print_block(node.nodes.as_deref().unwrap_or_default(), true);
        // `isDetachedRulesetDeclarationNode`: `/^@.+:.*$/`
        let is_detached_ruleset = node.selector.as_ref().is_some_and(|selector| {
            let value = &selector.value;
            selector.kind == SelectorKind::Unknown
                && value.starts_with(b"@")
                && bun_core::strings::index_of_any(value, b"\n\r").is_none()
                && text::index_of_char_from(value, b':', 2).is_some()
        });
        if is_detached_ruleset {
            self.sink.token(";");
        }
    }

    fn print_declaration(&mut self, node: &'t CssNode<'a>) {
        let write = |printer: &mut Self| {
            printer.print_name_and_value(node);
            printer.print_rest_of_declaration(node);
        };
        match self.has_no_block(node) {
            true => write(self),
            false => self.unit(write),
        }
        if let Some(nodes) = &node.nodes {
            self.print_block(nodes, false);
        }
    }

    fn print_name_and_value(&mut self, node: &'t CssNode<'a>) {
        let trimmed_between = text::trim(&node.between);
        let is_colon = trimmed_between == b":";
        let is_value_all_space = matches!(&node.value, Value::Text(value) if value.iter().all(|&b| b == b' '));

        if node.before.iter().any(|&b| b != b';' && !text::starts_with_white_space(&[b])) {
            let before: Vec<u8> =
                node.before.iter().copied().filter(|&b| b != b';' && !text::starts_with_white_space(&[b])).collect();
            self.sink.text(&before);
        }
        // The parent, which is before the declaration itself.
        let is_in_less_variable =
            matches!(self.css_stack[..], [.., parent, _] if parent.kind == Kind::AtRule && parent.variable);
        match is_in_less_variable || self.inside_icss_rule() {
            true => self.sink.text(&node.prop),
            false => self.sink.text(&maybe_to_lower_case(&node.prop)),
        }
        if trimmed_between.starts_with(b"//") {
            self.sink.token(" ");
        }
        self.sink.text(trimmed_between);
        // `a:${b} { .. }` in a template of JavaScript.
        let is_placeholder_right_behind_colon = node.is_nested
            && !(is_colon && node.between.ends_with(b" "))
            && matches!(&node.value, Value::Parsed(value) if top_level_group(value).is_some_and(|group| {
                is_at_word_placeholder(group) || group.groups().and_then(<[_]>::first).is_some_and(is_at_word_placeholder)
            }));
        if !(node.extend || is_value_all_space || is_placeholder_right_behind_colon) {
            self.sink.token(" ");
        }
        if let Some(selector) = node.selector.as_ref().filter(|_| self.syntax == Syntax::Less && node.extend) {
            match selector.nodes.len() > 1 {
                true => {
                    self.sink.start_group(false);
                    self.sink.token("extend(");
                    self.sink.start_indent();
                    self.sink.soft_line();
                    self.print_selector(selector, None, None, true);
                    self.sink.end_indent();
                    self.sink.soft_line();
                    self.sink.token(")");
                    self.sink.end_group();
                }
                false => {
                    self.sink.token("extend(");
                    self.print_selector(selector, None, None, true);
                    self.sink.token(")");
                }
            }
        }

        let is_on_its_own_line =
            !is_colon && last_line_has_inline_comment(trimmed_between) && !self.should_break_top_level_list(node);
        if is_on_its_own_line {
            self.sink.start_indent();
            self.sink.hard_line();
            self.sink.start_dedent();
        }
        match &node.value {
            Value::None => {}
            Value::Text(value) => self.sink.text(value),
            Value::Parsed(value) => {
                // `hasComposesNode`
                let is_without_lines = matches!(value.kind, ValueKind::Root { .. }) && text::eq_lower_case(&node.prop, b"composes");
                if is_without_lines {
                    self.sink.start_without_lines();
                }
                self.print_value(value, None);
                if is_without_lines {
                    self.sink.end_without_lines();
                }
            }
            Value::Rule(nodes) => {
                self.sink.token("{");
                self.print_block(nodes, true);
            }
        }
        if is_on_its_own_line {
            self.sink.end_indent();
            self.sink.end_indent();
        }
    }

    /// What follows the value, up to the `{` if there is a block.
    fn print_rest_of_declaration(&mut self, node: &'t CssNode<'a>) {
        let mut bang = |raw: Option<&[u8]>, is_set: bool, word: &'static str, allows_space: bool| match raw {
            Some(raw) => self.sink.text(&normalize_bang(raw, word.as_bytes(), allows_space)),
            None if is_set => {
                self.sink.token(" !");
                self.sink.token(word);
            }
            None => {}
        };
        bang(node.raw_important, node.important, "important", true);
        bang(node.raw_scss_default, node.scss_default, "default", false);
        bang(node.raw_scss_global, node.scss_global, "global", false);
        match &node.nodes {
            Some(_) => self.sink.token(" {"),
            // `isTemplatePropNode`
            None if node.prop.starts_with(b"@prettier-placeholder") && self.has_no_semicolon(node) => {}
            None => self.sink.token(";"),
        }
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

    /// Whether there is no semicolon behind `node`, which is being printed.
    fn has_no_semicolon(&mut self, node: &CssNode<'a>) -> bool {
        // What Prettier makes of `--a: { .. }` has no `raws` to look at.
        if matches!(self.css_stack[..], [.., parent, _] if matches!(parent.value, Value::Rule(_))) {
            self.has_failed = true;
        }
        matches!(self.css_stack[..], [.., parent, _] if !parent.semicolon)
            && node.end.checked_sub(1).and_then(|at| self.text.get(at)) != Some(&b';')
    }

    fn print_at_rule(&mut self, node: &'t CssNode<'a>) {
        if self.has_no_block(node) {
            return self.print_at_rule_up_to_block(node);
        }
        self.unit(|printer| printer.print_at_rule_up_to_block(node));
        self.print_block(node.nodes.as_deref().unwrap_or_default(), false);
        if self.syntax == Syntax::Less && node.variable {
            let semicolon = self.semicolon_of_at_rule(node);
            self.sink.token(semicolon);
        }
    }

    fn semicolon_of_at_rule(&mut self, node: &CssNode<'a>) -> &'static str {
        // `isTemplatePlaceholderNode`: an expression in a template of JavaScript.
        if node.name.starts_with(b"prettier-placeholder") && self.has_no_semicolon(node) { "" } else { ";" }
    }

    /// All of an at-rule, or what is before its block and the `{`.
    fn print_at_rule_up_to_block(&mut self, node: &'t CssNode<'a>) {
        let is_placeholder = node.name.starts_with(b"prettier-placeholder");
        let semicolon = self.semicolon_of_at_rule(node);
        // `/^\(\s*\)$/`
        let is_detached_ruleset_call = node
            .raw_params
            .strip_prefix(b"(")
            .and_then(|it| it.strip_suffix(b")"))
            .is_some_and(|inner| text::trim(inner).is_empty());
        if self.syntax == Syntax::Less {
            if node.mixin {
                if let Some(selector) = &node.selector {
                    self.print_selector(selector, None, None, true);
                }
                if node.important {
                    self.sink.token(" !important");
                }
                return self.sink.token(semicolon);
            }
            if node.function {
                self.sink.text(node.name);
                if let Params::Text(params) = &node.params {
                    self.sink.text(params);
                }
                return self.sink.token(semicolon);
            }
            if node.variable {
                let between = text::trim(&node.between);
                self.sink.token("@");
                self.sink.text(node.name);
                self.sink.token(": ");
                if let Value::Parsed(value) = &node.value {
                    self.print_value(value, None);
                    self.sink.line_suffix_boundary();
                }
                if !between.is_empty() {
                    self.sink.text(between);
                    self.sink.token(" ");
                }
                return self.sink.token(if node.nodes.is_some() { "{" } else { semicolon });
            }
        }
        let is_control_directive = self.is_scss_control_directive(node);
        self.sink.token("@");
        match is_detached_ruleset_call || node.name.ends_with(b":") || is_placeholder {
            true => self.sink.text(node.name),
            false => self.sink.text(&maybe_to_lower_case(node.name)),
        }
        if !matches!(&node.params, Params::None) && !matches!(&node.params, Params::Text(params) if params.is_empty()) {
            // How many line breaks there are before the first other character of `raws.afterName`.
            let spaces = &node.after_name[..text::leading_white_space_len(node.after_name)];
            match bun_core::strings::count_char(spaces, b'\n') {
                _ if is_detached_ruleset_call => {}
                _ if !is_placeholder => self.sink.token(" "),
                _ if node.after_name.is_empty() => {}
                _ if node.name.ends_with(b":") => self.sink.token(" "),
                0 => self.sink.token(" "),
                1 => self.sink.hard_line(),
                _ => {
                    self.sink.hard_line();
                    self.sink.hard_line();
                }
            }
            match &node.params {
                Params::None => {}
                Params::Text(params) | Params::Unknown(params) => self.sink.text(params),
                Params::Media(list) => self.print_media(list, true),
                Params::Value(value) => self.print_value(value, None),
            }
        }
        if let Some(selector) = &node.selector {
            self.sink.start_indent();
            self.sink.token(" ");
            self.print_selector(selector, None, None, true);
            self.sink.end_indent();
        }
        match &node.value {
            Value::Parsed(value) => {
                // `hasParensAroundNode`
                let has_parens = matches!(top_level_group(value).map(|it| &it.kind), Some(ValueKind::ParenGroup { open: Some(_), close: Some(_), .. }));
                self.sink.start_group(false);
                self.sink.token(" ");
                self.print_value(value, None);
                match (is_control_directive, has_parens) {
                    (false, _) => {}
                    (true, true) => self.sink.token(" "),
                    (true, false) => self.sink.line(),
                }
                self.sink.end_group();
            }
            _ if node.name == b"else" => self.sink.token(" "),
            _ => {}
        }
        let is_import_that_ends_with_semicolon = node.name == b"import"
            && matches!(&node.params, Params::Value(value) if matches!(&value.kind, ValueKind::Unknown(text) if text.ends_with(b";")));
        match &node.nodes {
            Some(_) => {
                let has_inline_comment = match (&node.selector, &node.params) {
                    (Some(selector), _) => {
                        selector.kind == SelectorKind::Unknown && last_line_has_inline_comment(&selector.value)
                    }
                    (None, Params::Text(params)) => last_line_has_inline_comment(params),
                    _ => false,
                };
                match (is_control_directive, has_inline_comment) {
                    (true, _) => {}
                    (false, true) => self.sink.line(),
                    (false, false) => self.sink.token(" "),
                }
                self.sink.token("{");
            }
            None if is_import_that_ends_with_semicolon => {}
            None => self.sink.token(semicolon),
        }
    }

    /// `isSCSSControlDirectiveNode`
    pub(crate) fn is_scss_control_directive(&self, node: &CssNode<'a>) -> bool {
        self.syntax == Syntax::Scss
            && node.kind == Kind::AtRule
            && matches!(node.name, b"if" | b"else" | b"for" | b"each" | b"while")
    }

    // ───────────────────────────── media queries ─────────────────────────────

    fn print_media(&mut self, node: &'t MediaNode<'a>, is_last: bool) {
        let children = node.nodes.as_deref().unwrap_or_default();
        match node.kind {
            MediaKind::QueryList => {
                self.sink.start_group(false);
                self.sink.start_indent();
                let mut is_first = true;
                for (index, child) in children.iter().enumerate() {
                    if child.kind == MediaKind::Query && child.value.is_empty() {
                        continue;
                    }
                    if !std::mem::replace(&mut is_first, false) {
                        self.sink.line();
                    }
                    self.print_media(child, index + 1 == children.len());
                }
                self.sink.end_indent();
                self.sink.end_group();
            }
            MediaKind::Query => {
                for (index, child) in children.iter().enumerate() {
                    if index > 0 {
                        self.sink.token(" ");
                    }
                    self.print_media(child, false);
                }
                if !is_last {
                    self.sink.token(",");
                }
            }
            MediaKind::Type | MediaKind::Value => {
                self.sink.text(&adjust_numbers(&adjust_strings(node.value, self.single_quote)));
            }
            MediaKind::FeatureExpression => match &node.nodes {
                None => self.sink.text(node.value),
                Some(children) => {
                    self.sink.token("(");
                    for child in children {
                        self.print_media(child, false);
                    }
                    self.sink.token(")");
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
                self.sink.text(&maybe_to_lower_case(&adjust_strings(&value, self.single_quote)));
            }
            MediaKind::Colon => {
                self.sink.text(node.value);
                self.sink.token(" ");
            }
            MediaKind::Keyword => self.sink.text(&adjust_strings(node.value, self.single_quote)),
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
                self.sink.text(&adjust_strings(&value, self.single_quote));
            }
            MediaKind::Unknown => self.sink.text(node.value),
        }
    }

    // ───────────────────────────── selectors ─────────────────────────────

    fn print_namespace(&mut self, namespace: &Option<Namespace<'a>>) {
        match namespace {
            None => {}
            Some(Namespace::Empty) => self.sink.token("|"),
            Some(Namespace::Name(name)) => {
                self.sink.text(text::trim(name));
                self.sink.token("|");
            }
        }
    }

    /// `parent`: the selector that `node` is in. `previous`: what is before it there.
    pub(crate) fn print_selector(
        &mut self,
        node: &'t SelectorNode<'a>,
        parent: Option<&'t SelectorNode<'a>>,
        previous: Option<&'t SelectorNode<'a>>,
        is_last: bool,
    ) {
        let value: &'t [u8] = &node.value;
        let single_quote = self.single_quote;
        match node.kind {
            SelectorKind::Root => {
                let custom_selector = match self.inside_at_rule(&[b"custom-selector"]) {
                    true => self.css_ancestor(Kind::AtRule).and_then(|it| it.custom_selector.as_deref()),
                    false => None,
                };
                let is_on_one_line = self.inside_at_rule(&[b"extend", b"custom-selector", b"nest"]);
                // One on each line, which the group is broken by.
                self.sink.start_group(!is_on_one_line && node.nodes.len() > 1);
                if let Some(name) = custom_selector {
                    self.sink.text(name);
                    self.sink.line();
                }
                for (index, child) in node.nodes.iter().enumerate() {
                    if index > 0 {
                        self.sink.token(",");
                        match is_on_one_line {
                            true => self.sink.line(),
                            false => self.sink.hard_line(),
                        }
                    }
                    let previous = index.checked_sub(1).and_then(|at| node.nodes.get(at));
                    self.print_selector(child, Some(node), previous, index + 1 == node.nodes.len());
                }
                self.sink.end_group();
            }
            SelectorKind::Selector => {
                self.sink.start_group(false);
                if node.nodes.len() > 2 {
                    self.sink.start_indent();
                }
                self.print_selectors(node);
                if node.nodes.len() > 2 {
                    self.sink.end_indent();
                }
                self.sink.end_group();
            }
            SelectorKind::Comment | SelectorKind::Nesting => self.sink.text(value),
            SelectorKind::String => self.sink.text(&adjust_strings(value, single_quote)),
            SelectorKind::Tag => {
                self.print_namespace(&node.namespace);
                if previous.is_some_and(|it| it.kind == SelectorKind::Nesting) {
                    return self.sink.text(value);
                }
                // `isKeyframeAtRuleKeywords`
                let is_keyframe_keyword = (text::eq_lower_case(value, b"from") || text::eq_lower_case(value, b"to"))
                    && self.css_ancestor(Kind::AtRule).is_some_and(|it| it.name.to_ascii_lowercase().ends_with(b"keyframes"));
                match is_keyframe_keyword {
                    true => self.sink.text(&value.to_ascii_lowercase()),
                    false => self.sink.text(&adjust_numbers(value)),
                }
            }
            SelectorKind::Id => {
                self.sink.token("#");
                self.sink.text(value);
            }
            SelectorKind::Class => {
                self.sink.token(".");
                self.sink.text(&adjust_numbers(&adjust_strings(value, single_quote)));
            }
            SelectorKind::Attribute => {
                self.sink.token("[");
                self.print_namespace(&node.namespace);
                self.sink.text(text::trim(&node.attribute));
                self.sink.text(node.operator.as_deref().unwrap_or_default());
                if node.has_value {
                    let adjusted = adjust_strings(text::trim(value), single_quote);
                    // `replaceEndOfLine(.., literallineWithoutBreakParent)`
                    for (index, line) in bun_core::strings::split(&quote_attribute_value(adjusted, single_quote), b"\n").enumerate() {
                        if index > 0 {
                            self.sink.literal_line();
                        }
                        self.sink.text(line);
                    }
                }
                self.sink.token(if node.insensitive { " i]" } else { "]" });
            }
            SelectorKind::Combinator => {
                if matches!(value, b"+" | b">" | b"~" | b">>>") {
                    let is_first = parent.is_some_and(|parent| {
                        parent.kind == SelectorKind::Selector && parent.nodes.first().is_some_and(|it| std::ptr::eq(it, node))
                    });
                    if !is_first {
                        self.sink.line();
                    }
                    self.sink.text(value);
                    if !is_last {
                        self.sink.token(" ");
                    }
                    return;
                }
                if text::trim_start(value).starts_with(b"(") {
                    self.sink.line();
                }
                let adjusted = adjust_strings(text::trim(value), single_quote);
                let adjusted = adjust_numbers(&adjusted);
                match adjusted.is_empty() {
                    true => self.sink.line(),
                    false => self.sink.text(&adjusted),
                }
            }
            SelectorKind::Universal => {
                self.print_namespace(&node.namespace);
                self.sink.text(value);
            }
            SelectorKind::Pseudo => {
                self.sink.text(&maybe_to_lower_case(value));
                if !node.nodes.is_empty() {
                    self.sink.start_group(false);
                    self.sink.token("(");
                    self.sink.start_indent();
                    self.sink.soft_line();
                    for (index, child) in node.nodes.iter().enumerate() {
                        if index > 0 {
                            self.sink.token(",");
                            self.sink.line();
                        }
                        let previous = index.checked_sub(1).and_then(|at| node.nodes.get(at));
                        self.print_selector(child, Some(node), previous, index + 1 == node.nodes.len());
                    }
                    self.sink.end_indent();
                    self.sink.soft_line();
                    self.sink.token(")");
                    self.sink.end_group();
                }
            }
            SelectorKind::Unknown => self.print_unknown_selector(node),
        }
    }

    fn print_selectors(&mut self, node: &'t SelectorNode<'a>) {
        for (index, child) in node.nodes.iter().enumerate() {
            let previous = index.checked_sub(1).and_then(|at| node.nodes.get(at));
            self.print_selector(child, Some(node), previous, index + 1 == node.nodes.len());
        }
    }

    fn print_unknown_selector(&mut self, node: &'t SelectorNode<'a>) {
        if self.css_ancestor(Kind::Rule).is_some_and(|rule| rule.is_scss_nested_property) {
            let value = maybe_to_lower_case(&node.value);
            return self.sink.text(&adjust_numbers(&adjust_strings(&value, self.single_quote)));
        }
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
            if last_line_has_inline_comment(selector) {
                self.sink.break_parent();
            }
            return self.sink.text(selector);
        }
        // The text is taken from the style sheet, for the sake of Less.
        if self.value_stack.is_empty()
            && let Some(parent) = self.css_stack.last().filter(|parent| !parent.raw_selector.is_empty())
        {
            let end = parent.start + parent.raw_selector.len();
            return self.sink.text(text::trim(self.text.get(parent.start..end).unwrap_or_default()));
        }
        self.sink.text(&node.value);
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
    pub(crate) fn print_value(&mut self, node: &'t ValueNode<'a>, previous: Option<&'t ValueNode<'a>>) {
        match &node.kind {
            ValueKind::Root { group } | ValueKind::Value { group } => self.print_child_value(node, group),
            ValueKind::Comment { inline, .. } => {
                let (start, end) = (node.loc.start_offset.unwrap_or(0) as usize, node.loc.end_offset.unwrap_or(0) as usize);
                let text = self.text.get(start..end).unwrap_or_default();
                match inline {
                    true => {
                        self.sink.start_line_suffix();
                        self.sink.text(text::trim_end(text));
                        self.sink.end_line_suffix();
                    }
                    false => self.sink.text(text),
                }
            }
            ValueKind::CommaGroup { .. } => self.print_comma_separated_value_group(node),
            ValueKind::ParenGroup { .. } => self.print_parenthesized_value_group(node),
            ValueKind::Func { value, group } => {
                let is_keyword = ["not", "and", "or"].iter().any(|it| text::eq_lower_case(value, it.as_bytes()));
                self.sink.text(value);
                if is_keyword && self.inside_at_rule(&[b"supports"]) {
                    self.sink.token(" ");
                }
                self.print_child_value(node, group);
            }
            ValueKind::Paren(b'(') => self.sink.token("("),
            ValueKind::Paren(_) => self.sink.token(")"),
            ValueKind::Number { value, unit } => {
                let mut text = Vec::with_capacity(value.len() + unit.len());
                print_css_number(value, &mut text);
                text.extend_from_slice(print_unit(unit));
                self.sink.text(&text);
            }
            ValueKind::Operator(value) | ValueKind::UnicodeRange(value) | ValueKind::Unknown(value) | ValueKind::Text(value) => {
                self.sink.text(value);
            }
            ValueKind::Word {
                value,
                is_hex,
                is_color,
            } => {
                let is_wide_keyword =
                    ["initial", "inherit", "unset", "revert"].iter().any(|it| text::eq_lower_case(value, it.as_bytes()));
                match (*is_color && *is_hex) || is_wide_keyword {
                    true => self.sink.text(&text::to_lower_case(value)),
                    false => self.sink.text(value),
                }
            }
            ValueKind::Colon => {
                let is_escaped = previous.and_then(ValueNode::value).is_some_and(|it| it.ends_with(b"\\"));
                self.sink.start_group(false);
                self.sink.token(":");
                if !(is_escaped || self.inside_value_function(b"url")) {
                    self.sink.line();
                }
                self.sink.end_group();
            }
            ValueKind::Comma => self.sink.token(","),
            ValueKind::String { value, quote } => {
                let raw = [quote, &**value, quote].concat();
                let mut text = Vec::with_capacity(raw.len());
                print_string(&raw, self.single_quote, &mut text);
                self.sink.text(&text);
            }
            ValueKind::AtWord(value) => {
                self.sink.token("@");
                self.sink.text(value);
            }
            ValueKind::Selector(selector) => self.print_selector(selector, None, None, true),
        }
    }

    /// Prints `child`, which is in `parent`.
    pub(crate) fn print_child_value(&mut self, parent: &'t ValueNode<'a>, child: &'t ValueNode<'a>) {
        self.value_stack.push(parent);
        self.print_value(child, None);
        self.value_stack.pop();
    }
}

/// `isAtWordPlaceholderNode`
pub(crate) fn is_at_word_placeholder(node: &ValueNode<'_>) -> bool {
    matches!(&node.kind, ValueKind::AtWord(value) if value.starts_with(b"prettier-placeholder-"))
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
