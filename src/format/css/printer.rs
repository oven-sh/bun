//! Prettier's `printer-postcss.js` and `print/sequence.js`.

use super::Parser as Syntax;
use super::media_query::{MediaKind, MediaNode};
use super::memo::Memo;
use super::misc::{
    adjust_numbers, adjust_strings, has_newline_backwards, is_next_line_empty, last_line_has_inline_comment,
    maybe_to_lower_case, print_css_number, print_string, print_unit, quote_attribute_value,
};
use super::parse::{Context, CssNode, Params, Parsed, Value};
use super::postcss::{Kind, Node, NodeId, Tree};
use super::selector_parser::{Namespace, SelectorId, SelectorKind, Selectors};
use super::sink::Sink;
use super::text;
use super::value_parser::{ValueId, ValueKind, Values};

/// A node and the nodes that it is in.
#[derive(Copy, Clone)]
pub(crate) struct Scope<'s, 'a> {
    pub(crate) node: &'s CssNode<'a>,
    pub(crate) parent: Option<&'s Scope<'s, 'a>>,
    /// What `node` is a node of.
    tree: &'s Tree,
}

/// The node that is being printed, with what has been parsed of it.
#[derive(Copy, Clone)]
pub(crate) struct Statement<'s, 'a> {
    pub(crate) scope: &'s Scope<'s, 'a>,
    pub(crate) selectors: &'s Selectors,
    pub(crate) values: &'s Values,
    /// The at-rule that it is or is in.
    pub(crate) at_rule: Option<&'s CssNode<'a>>,
}

impl<'s, 'a> Statement<'s, 'a> {
    fn new(scope: &'s Scope<'s, 'a>, selectors: &'s Selectors, values: &'s Values) -> Self {
        let mut statement = Statement {
            scope,
            selectors,
            values,
            at_rule: None,
        };
        statement.at_rule = statement.css_ancestor(Kind::AtRule);
        statement
    }

    pub(crate) fn node(&self) -> &'s CssNode<'a> {
        self.scope.node
    }

    fn parent(&self) -> Option<&'s CssNode<'a>> {
        self.scope.parent.map(|parent| parent.node)
    }

    /// `path.findAncestor((node) => node.type === kind)`, for what is in a selector, a value or
    /// parameters: the node of the style sheet that it belongs to counts.
    pub(crate) fn css_ancestor(&self, kind: Kind) -> Option<&'s CssNode<'a>> {
        std::iter::successors(Some(self.scope), |scope| scope.parent).map(|scope| scope.node).find(|node| node.kind == kind)
    }

    /// `insideAtRuleNode`
    pub(crate) fn inside_at_rule(&self, names: &[&[u8]]) -> bool {
        self.at_rule.is_some_and(|node| names.iter().any(|name| text::eq_lower_case(node.name, name)))
    }

    /// `insideIcssRuleNode`, for a declaration.
    fn inside_icss_rule(&self) -> bool {
        std::iter::successors(Some(self.scope), |scope| scope.parent).any(|scope| {
            let node = scope.node;
            node.kind == Kind::Rule && (node.raw_selector.starts_with(b":import") || node.raw_selector.starts_with(b":export"))
        })
    }
}

pub(crate) struct Printer<'a, 'o> {
    pub(crate) context: Context<'a>,
    pub(crate) single_quote: bool,
    /// `trailingComma` is `"es5"` or `"all"`.
    pub(crate) trailing_comma: bool,
    /// The nodes of the value that what is being printed is in.
    pub(crate) value_stack: Vec<ValueId>,
    /// For a text that is made to be written.
    pub(crate) scratch: Vec<u8>,
    /// Prettier throws an error for the style sheet.
    pub(crate) has_failed: bool,
    pub(crate) sink: Sink<'o>,
    pub(crate) memo: &'o mut Memo,
    /// What has been printed of the declaration depends on nothing but its text and what `memo_context` takes into
    /// account.
    pub(crate) is_memoizable: bool,
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

impl<'a> Printer<'a, '_> {
    pub(crate) fn syntax(&self) -> Syntax {
        self.context.syntax
    }

    /// `options.originalText`
    pub(crate) fn text(&self) -> &'a [u8] {
        self.context.original_text
    }

    // ───────────────────────────── the style sheet ─────────────────────────────

    /// Has `write` write something that no group is around and that a line break follows. See `Sink`. Whatever
    /// `write` does besides writing, doing it twice has to be the same as doing it once.
    ///
    /// `is_too_long`: it will hardly fit on the line.
    fn unit(&mut self, is_too_long: bool, mut write: impl FnMut(&mut Self)) {
        let mark = self.sink.start_unit();
        if !(is_too_long && mark.is_some()) {
            write(self);
        }
        if let Some(mark) = mark
            && (is_too_long || !self.sink.end_unit())
        {
            self.sink.start_document(&mark);
            write(self);
            self.sink.end_document();
        }
    }

    pub(crate) fn print_root(&mut self, tree: &Tree, parsed: &mut Parsed) {
        let Ok(root) = self.context.convert(tree, 0, parsed) else {
            self.has_failed = true;
            return;
        };
        let mut after = text::trim(root.after);
        if let Some(rest) = after.strip_prefix(b";") {
            after = text::trim(rest);
        }
        let scope = Scope {
            node: &root,
            parent: None,
            tree,
        };
        self.print_sequence(&scope, &tree.nodes[0], after, parsed);
        if tree.nodes[0].first_child != 0 {
            self.sink.hard_line();
        }
    }

    /// Whether no block is printed for `raw`.
    fn has_no_block(&self, raw: &Node) -> bool {
        match raw.kind {
            Kind::Root | Kind::Rule => false,
            Kind::Comment => true,
            // A custom property set looks like a declaration.
            Kind::Decl => {
                !raw.has_block && !(self.context.of(raw.prop).starts_with(b"--") && self.context.of(raw.value).starts_with(b"{"))
            }
            Kind::AtRule => !raw.has_block || (self.syntax() == Syntax::Less && (raw.mixin || raw.function)),
        }
    }

    /// `Memo::context` for the declarations in the block of `scope`. `None`: nothing is kept of them.
    fn memo_context(&mut self, scope: &Scope<'_, 'a>) -> Option<u32> {
        let parent = scope.node;
        if matches!(parent.value, Value::Rule(_)) || !self.context.is_original_text {
            return None;
        }
        let (selectors, values) = Default::default();
        let statement = Statement::new(scope, &selectors, &values);
        let flags = [
            self.syntax() == Syntax::Less,
            self.syntax() == Syntax::Scss,
            self.single_quote,
            self.trailing_comma,
            statement.inside_icss_rule(),
            parent.kind == Kind::AtRule && parent.variable,
            statement.css_ancestor(Kind::Rule).is_some_and(|rule| rule.is_scss_nested_property),
            statement.at_rule.is_some(),
        ];
        let flags = flags.iter().fold(0, |flags, &flag| flags << 1 | u32::from(flag));
        Some(self.memo.context(flags, statement.at_rule.map_or(b"", |it| it.name)))
    }

    /// The text of the declaration `raw`, if it has all that `postcss` says of it.
    fn memo_text(&self, raw: &Node) -> Option<&'a [u8]> {
        let is_plain = raw.kind == Kind::Decl
            && !raw.is_nested
            && raw.clean_value.is_none()
            && self.has_no_block(raw)
            && self.context.of(raw.before).iter().all(u8::is_ascii_whitespace);
        self.context.text.get(raw.start as usize..raw.end.filter(|_| is_plain)? as usize)
    }

    /// `printSequence` for the nodes of `block`, which `scope` is for, and `after` behind a blank unless it is empty.
    fn print_sequence(&mut self, scope: &Scope<'_, 'a>, block: &Node, after: &[u8], parsed: &mut Parsed) {
        let (text, tree) = (self.text(), scope.tree);
        let memo_context = self.memo_context(scope);
        let mut previous = None;
        let mut first = block.first_child;
        if first == 0 && !after.is_empty() {
            self.sink.token(" ");
            self.sink.text(after);
        }
        while first != 0 {
            // The nodes from `first` up to `end` are on one line.
            let mut last = &tree.nodes[first as usize];
            while let Some(next) = tree.nodes.get(last.next_sibling as usize).filter(|_| last.next_sibling != 0)
                && ((next.kind == Kind::Comment && !has_newline_backwards(text, (next.start as usize).min(text.len())))
                    || (next.kind == Kind::AtRule && last.kind != Kind::Comment && self.context.name_of_at_rule(next) == b"else"))
            {
                last = next;
            }
            let end = last.next_sibling;

            // What has a block takes care of the line that its `{` ends. Everything else goes with the rest of the
            // line.
            let mut id = first;
            while id != end
                && let raw = &tree.nodes[id as usize]
                && (raw.kind == Kind::Comment || !self.has_no_block(raw))
            {
                if id != first {
                    self.sink.token(" ");
                }
                self.print_in_sequence(scope, id, previous, None, parsed, None);
                previous = Some(raw);
                id = raw.next_sibling;
            }
            let write_after = |printer: &mut Self| {
                if end == 0 && !after.is_empty() {
                    printer.sink.token(" ");
                    printer.sink.text(after);
                }
            };
            if id == end {
                write_after(self);
            } else {
                let raw = &tree.nodes[id as usize];
                // What has been parsed of it is still there when it is written again, if nothing else is parsed.
                let mut node = None;
                let is_only_one_parsed = std::iter::successors(Some(raw.next_sibling), |&id| Some(tree.nodes[id as usize].next_sibling))
                    .take_while(|&id| id != end)
                    .all(|id| matches!(tree.nodes[id as usize], Node { kind: Kind::Comment, inline: false, end: Some(_), .. }));
                let is_too_long = raw.end.is_some_and(|end| !self.sink.has_room_for((end - raw.start.min(end)) as usize));
                self.unit(is_too_long, |printer| {
                    let (mut id, mut previous) = (id, previous);
                    while id != end {
                        if id != first {
                            printer.sink.token(" ");
                        }
                        let node = if is_only_one_parsed { Some(&mut node) } else { None };
                        printer.print_in_sequence(scope, id, previous, memo_context, parsed, node);
                        previous = Some(&tree.nodes[id as usize]);
                        id = tree.nodes[id as usize].next_sibling;
                    }
                    write_after(printer);
                });
            }
            previous = Some(last);
            if end != 0 {
                self.sink.hard_line();
                let last_end = match last.end {
                    Some(end) if !last.inline => (end as usize).min(text.len()),
                    _ => {
                        let mut id = first;
                        while tree.nodes[id as usize].next_sibling != end {
                            id = tree.nodes[id as usize].next_sibling;
                        }
                        self.context.end_of(tree, id, parsed)
                    }
                };
                if is_next_line_empty(text, last_end) {
                    self.sink.hard_line();
                }
            }
            first = end;
        }
    }

    /// Prints the node `id`, which is in the block of `parent` behind `previous`. `converted`: for what is made of it
    /// if it is not a comment. It is not made again if it is there.
    fn print_in_sequence(
        &mut self,
        parent: &Scope<'_, 'a>,
        id: NodeId,
        previous: Option<&Node>,
        memo_context: Option<u32>,
        parsed: &mut Parsed,
        converted: Option<&mut Option<CssNode<'a>>>,
    ) {
        let (text, tree) = (self.text(), parent.tree);
        let raw = &tree.nodes[id as usize];
        let start = (raw.start as usize).min(text.len());
        if previous.is_some_and(|it| it.kind == Kind::Comment && text::trim(self.context.of(it.text)) == b"prettier-ignore") {
            let end = self.context.end_of(tree, id, parsed);
            return self.sink.text(text.get(start..end).unwrap_or_default());
        }
        if raw.kind == Kind::Comment {
            let comment = text.get(start..self.context.end_of(tree, id, parsed)).unwrap_or_default();
            return self.sink.text(if raw.inline || raw.raw_inline { text::trim_end(comment) } else { comment });
        }
        let position = memo_context.zip(self.memo_text(raw)).zip(self.sink.position());
        if let Some(((context, text), _)) = position
            && let Some((output, has_group)) = self.memo.get(context, text)
        {
            return self.sink.write_again(output, has_group);
        }

        let mut own = None;
        let converted = converted.unwrap_or(&mut own);
        if converted.is_none() {
            *converted = self.context.convert(tree, id, parsed).ok();
        }
        let Some(node) = converted else {
            self.has_failed = true;
            return;
        };
        let scope = Scope {
            node,
            parent: Some(parent),
            tree,
        };
        self.is_memoizable = true;
        match node.kind {
            Kind::Root | Kind::Comment => {}
            Kind::Rule => self.print_rule(&scope, raw, parsed),
            Kind::Decl => self.print_declaration(&scope, raw, parsed),
            Kind::AtRule => self.print_at_rule(&scope, raw, parsed),
        }
        if let Some(((context, text), position)) = position
            && self.is_memoizable
            && !self.has_failed
            && let Some((output, has_group)) = self.sink.written_since(position)
        {
            self.memo.insert(context, text, output, has_group);
        }
    }

    /// What is in `block`, each on a line of its own, and `}`. The `{` has been written.
    fn print_block(&mut self, scope: &Scope<'_, 'a>, block: &Node, is_hard_line: bool, parsed: &mut Parsed) {
        let line = if is_hard_line { Sink::hard_line } else { Sink::soft_line };
        if block.first_child != 0 {
            self.sink.start_indent();
            line(&mut self.sink);
            self.print_sequence(scope, block, b"", parsed);
            self.sink.end_indent();
        }
        line(&mut self.sink);
        self.sink.token("}");
    }

    fn print_rule(&mut self, scope: &Scope<'_, 'a>, raw: &Node, parsed: &mut Parsed) {
        let node = scope.node;
        let statement = Statement::new(scope, &parsed.selectors, &parsed.values);
        let unknown_selector = node.selector.filter(|&it| statement.selectors.node(it).kind == SelectorKind::Unknown);
        // `isDetachedRulesetDeclarationNode`: `/^@.+:.*$/`
        let is_detached_ruleset = unknown_selector.is_some_and(|selector| {
            let value = statement.selectors.value(selector);
            value.starts_with(b"@")
                && bun_core::strings::index_of_any(value, b"\n\r").is_none()
                && text::index_of_char_from(value, b':', 2).is_some()
        });
        self.unit(false, |printer| {
            if let Some(selector) = node.selector {
                printer.print_selector(statement, selector, None, None);
            }
            if node.important {
                printer.sink.token(" !important");
            }
            match (node.selector, unknown_selector) {
                (_, Some(selector)) if last_line_has_inline_comment(statement.selectors.value(selector)) => printer.sink.line(),
                (Some(_), _) => printer.sink.token(" "),
                (None, _) => {}
            }
            printer.sink.token("{");
        });
        self.print_block(scope, raw, true, parsed);
        if is_detached_ruleset {
            self.sink.token(";");
        }
    }

    fn print_declaration(&mut self, scope: &Scope<'_, 'a>, raw: &Node, parsed: &mut Parsed) {
        let node = scope.node;
        if let Value::Rule(tree) = &node.value {
            // The lines of the block are written as they come.
            return self.unit(false, |printer| {
                let is_on_its_own_line = printer.print_name(scope);
                printer.sink.token("{");
                let scope = Scope { tree, ..*scope };
                printer.print_block(&scope, &tree.nodes[tree.nodes[0].first_child as usize], true, parsed);
                if is_on_its_own_line {
                    printer.sink.end_indent();
                    printer.sink.end_indent();
                }
                printer.print_rest_of_declaration(&scope);
            });
        }
        let statement = Statement::new(scope, &parsed.selectors, &parsed.values);
        let write = |printer: &mut Self| {
            let is_on_its_own_line = printer.print_name_and_extend(statement);
            match &node.value {
                Value::None | Value::Rule(_) => {}
                Value::Text(value) => printer.sink.text(value),
                Value::Parsed(value) => {
                    // `hasComposesNode`
                    let is_without_lines =
                        statement.values.node(*value).kind == ValueKind::Root && text::eq_lower_case(&node.prop, b"composes");
                    if is_without_lines {
                        printer.sink.start_without_lines();
                    }
                    printer.print_value(statement, *value, None);
                    if is_without_lines {
                        printer.sink.end_without_lines();
                    }
                }
            }
            if is_on_its_own_line {
                printer.sink.end_indent();
                printer.sink.end_indent();
            }
            printer.print_rest_of_declaration(scope);
        };
        match node.has_block {
            false => write(self),
            true => {
                self.unit(false, write);
                self.print_block(scope, raw, false, parsed);
            }
        }
    }

    /// The name of a declaration whose value is a block. See `print_name_and_extend`.
    fn print_name(&mut self, scope: &Scope<'_, 'a>) -> bool {
        let (selectors, values) = Default::default();
        self.print_name_and_extend(Statement::new(scope, &selectors, &values))
    }

    /// What is before the value. Returns whether an `indent` and a `dedent` in it have been started for the value.
    fn print_name_and_extend(&mut self, statement: Statement<'_, 'a>) -> bool {
        let node = statement.node();
        let trimmed_between = text::trim(&node.between);
        let is_colon = trimmed_between == b":";
        let is_value_all_space = matches!(&node.value, Value::Text(value) if value.iter().all(|&b| b == b' '));

        if node.before.iter().any(|&b| b != b';' && !text::starts_with_white_space(&[b])) {
            let before: Vec<u8> =
                node.before.iter().copied().filter(|&b| b != b';' && !text::starts_with_white_space(&[b])).collect();
            self.sink.text(&before);
        }
        let is_in_less_variable = statement.parent().is_some_and(|parent| parent.kind == Kind::AtRule && parent.variable);
        match is_in_less_variable || statement.inside_icss_rule() {
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
            && matches!(node.value, Value::Parsed(value) if top_level_group(statement.values, value).is_some_and(|group| {
                is_at_word_placeholder(statement.values, group)
                    || statement.values.groups(group).first().is_some_and(|&first| is_at_word_placeholder(statement.values, first))
            }));
        if !(node.extend || is_value_all_space || is_placeholder_right_behind_colon) {
            self.sink.token(" ");
        }
        if let Some(selector) = node.selector.filter(|_| self.syntax() == Syntax::Less && node.extend) {
            match statement.selectors.node(selector).child_count > 1 {
                true => {
                    self.sink.start_group(false);
                    self.sink.token("extend(");
                    self.sink.start_indent();
                    self.sink.soft_line();
                    self.print_selector(statement, selector, None, None);
                    self.sink.end_indent();
                    self.sink.soft_line();
                    self.sink.token(")");
                    self.sink.end_group();
                }
                false => {
                    self.sink.token("extend(");
                    self.print_selector(statement, selector, None, None);
                    self.sink.token(")");
                }
            }
        }

        // `path.call(() => shouldBreakList(path), "value", "group", "group")`
        let should_break_top_level_list = matches!(node.value, Value::Parsed(value)
            if top_level_group(statement.values, value).is_some_and(|group| is_list_with_comma_group(statement.values, group)))
            && !node.prop.starts_with(b"--");
        let is_on_its_own_line = !is_colon && last_line_has_inline_comment(trimmed_between) && !should_break_top_level_list;
        if is_on_its_own_line {
            self.sink.start_indent();
            self.sink.hard_line();
            self.sink.start_dedent();
        }
        is_on_its_own_line
    }

    /// What follows the value, up to the `{` if there is a block.
    fn print_rest_of_declaration(&mut self, scope: &Scope<'_, 'a>) {
        let node = scope.node;
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
        match node.has_block {
            true => self.sink.token(" {"),
            // `isTemplatePropNode`
            false if node.prop.starts_with(b"@prettier-placeholder") && self.has_no_semicolon(scope) => {}
            false => self.sink.token(";"),
        }
    }

    /// Whether there is no semicolon behind the node of `scope`.
    fn has_no_semicolon(&mut self, scope: &Scope<'_, 'a>) -> bool {
        self.is_memoizable = false;
        let parent = scope.parent.map(|parent| parent.node);
        // What Prettier makes of `--a: { .. }` has no `raws` to look at.
        if parent.is_some_and(|parent| matches!(parent.value, Value::Rule(_))) {
            self.has_failed = true;
        }
        parent.is_some_and(|parent| !parent.semicolon) && scope.node.end.checked_sub(1).and_then(|at| self.text().get(at)) != Some(&b';')
    }

    fn print_at_rule(&mut self, scope: &Scope<'_, 'a>, raw: &Node, parsed: &mut Parsed) {
        let statement = Statement::new(scope, &parsed.selectors, &parsed.values);
        if self.has_no_block(raw) {
            return self.print_at_rule_up_to_block(statement);
        }
        self.unit(false, |printer| printer.print_at_rule_up_to_block(statement));
        self.print_block(scope, raw, false, parsed);
        if self.syntax() == Syntax::Less && scope.node.variable {
            let semicolon = self.semicolon_of_at_rule(scope);
            self.sink.token(semicolon);
        }
    }

    fn semicolon_of_at_rule(&mut self, scope: &Scope<'_, 'a>) -> &'static str {
        // `isTemplatePlaceholderNode`: an expression in a template of JavaScript.
        if scope.node.name.starts_with(b"prettier-placeholder") && self.has_no_semicolon(scope) { "" } else { ";" }
    }

    /// All of an at-rule, or what is before its block and the `{`.
    fn print_at_rule_up_to_block(&mut self, statement: Statement<'_, 'a>) {
        let node = statement.node();
        let is_placeholder = node.name.starts_with(b"prettier-placeholder");
        let semicolon = self.semicolon_of_at_rule(statement.scope);
        // `/^\(\s*\)$/`
        let is_detached_ruleset_call = node
            .raw_params
            .strip_prefix(b"(")
            .and_then(|it| it.strip_suffix(b")"))
            .is_some_and(|inner| text::trim(inner).is_empty());
        if self.syntax() == Syntax::Less {
            if node.mixin {
                if let Some(selector) = node.selector {
                    self.print_selector(statement, selector, None, None);
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
                if let Value::Parsed(value) = node.value {
                    self.print_value(statement, value, None);
                    self.sink.line_suffix_boundary();
                }
                if !between.is_empty() {
                    self.sink.text(between);
                    self.sink.token(" ");
                }
                return self.sink.token(if node.has_block { "{" } else { semicolon });
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
                Params::Value(value) => self.print_value(statement, *value, None),
            }
        }
        if let Some(selector) = node.selector {
            self.sink.start_indent();
            self.sink.token(" ");
            self.print_selector(statement, selector, None, None);
            self.sink.end_indent();
        }
        match node.value {
            Value::Parsed(value) => {
                // `hasParensAroundNode`
                let has_parens = top_level_group(statement.values, value).is_some_and(|group| {
                    let group = statement.values.node(group);
                    group.kind == ValueKind::ParenGroup && group.open != 0 && group.close != 0
                });
                self.sink.start_group(false);
                self.sink.token(" ");
                self.print_value(statement, value, None);
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
            && matches!(node.params, Params::Value(value)
                if statement.values.node(value).kind == ValueKind::Unknown && statement.values.value(value).is_some_and(|it| it.ends_with(b";")));
        match node.has_block {
            true => {
                let has_inline_comment = match (node.selector, &node.params) {
                    (Some(selector), _) => {
                        statement.selectors.node(selector).kind == SelectorKind::Unknown
                            && last_line_has_inline_comment(statement.selectors.value(selector))
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
            false if is_import_that_ends_with_semicolon => {}
            false => self.sink.token(semicolon),
        }
    }

    /// `isSCSSControlDirectiveNode`
    pub(crate) fn is_scss_control_directive(&self, node: &CssNode<'a>) -> bool {
        self.syntax() == Syntax::Scss
            && node.kind == Kind::AtRule
            && matches!(node.name, b"if" | b"else" | b"for" | b"each" | b"while")
    }

    // ───────────────────────────── media queries ─────────────────────────────

    fn print_media(&mut self, node: &MediaNode<'a>, is_last: bool) {
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

    fn print_namespace(&mut self, selectors: &Selectors, namespace: Option<Namespace>) {
        match namespace {
            None => {}
            Some(Namespace::Empty) => self.sink.token("|"),
            Some(Namespace::Name(name)) => {
                self.sink.text(text::trim(selectors.text(name)));
                self.sink.token("|");
            }
        }
    }

    /// `parent`: the selector that `id` is in. `previous`: what is before it there.
    pub(crate) fn print_selector(
        &mut self,
        statement: Statement<'_, 'a>,
        id: SelectorId,
        parent: Option<SelectorId>,
        previous: Option<SelectorId>,
    ) {
        let selectors = statement.selectors;
        let node = selectors.node(id);
        let value = selectors.text(node.value);
        let single_quote = self.single_quote;
        match node.kind {
            SelectorKind::Root => {
                let custom_selector = match statement.inside_at_rule(&[b"custom-selector"]) {
                    true => statement.at_rule.and_then(|it| it.custom_selector.as_deref()),
                    false => None,
                };
                let is_on_one_line = statement.inside_at_rule(&[b"extend", b"custom-selector", b"nest"]);
                // One on each line, which the group is broken by.
                self.sink.start_group(!is_on_one_line && node.child_count > 1);
                if let Some(name) = custom_selector {
                    self.sink.text(name);
                    self.sink.line();
                }
                let (mut child, mut previous) = (node.first_child, None);
                while child != 0 {
                    if previous.is_some() {
                        self.sink.token(",");
                        match is_on_one_line {
                            true => self.sink.line(),
                            false => self.sink.hard_line(),
                        }
                    }
                    self.print_selector(statement, child, Some(id), previous);
                    previous = Some(child);
                    child = selectors.node(child).next_sibling;
                }
                self.sink.end_group();
            }
            SelectorKind::Selector => {
                self.sink.start_group(false);
                if node.child_count > 2 {
                    self.sink.start_indent();
                }
                let (mut child, mut previous) = (node.first_child, None);
                while child != 0 {
                    self.print_selector(statement, child, Some(id), previous);
                    previous = Some(child);
                    child = selectors.node(child).next_sibling;
                }
                if node.child_count > 2 {
                    self.sink.end_indent();
                }
                self.sink.end_group();
            }
            SelectorKind::Comment | SelectorKind::Nesting => self.sink.text(value),
            SelectorKind::String => self.sink.text(&adjust_strings(value, single_quote)),
            SelectorKind::Tag => {
                self.print_namespace(selectors, node.namespace);
                if previous.is_some_and(|it| selectors.node(it).kind == SelectorKind::Nesting) {
                    return self.sink.text(value);
                }
                // `isKeyframeAtRuleKeywords`
                let is_keyframe_keyword = (text::eq_lower_case(value, b"from") || text::eq_lower_case(value, b"to"))
                    && statement.at_rule.is_some_and(|it| it.name.to_ascii_lowercase().ends_with(b"keyframes"));
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
                self.print_namespace(selectors, node.namespace);
                self.sink.text(text::trim(selectors.text(node.attribute)));
                self.sink.text(node.operator.map(|it| selectors.text(it)).unwrap_or_default());
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
                        let parent = selectors.node(parent);
                        parent.kind == SelectorKind::Selector && parent.first_child == id
                    });
                    if !is_first {
                        self.sink.line();
                    }
                    self.sink.text(value);
                    if node.next_sibling != 0 {
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
                self.print_namespace(selectors, node.namespace);
                self.sink.text(value);
            }
            SelectorKind::Pseudo => {
                self.sink.text(&maybe_to_lower_case(value));
                if node.first_child != 0 {
                    self.sink.start_group(false);
                    self.sink.token("(");
                    self.sink.start_indent();
                    self.sink.soft_line();
                    let (mut child, mut previous) = (node.first_child, None);
                    while child != 0 {
                        if previous.is_some() {
                            self.sink.token(",");
                            self.sink.line();
                        }
                        self.print_selector(statement, child, Some(id), previous);
                        previous = Some(child);
                        child = selectors.node(child).next_sibling;
                    }
                    self.sink.end_indent();
                    self.sink.soft_line();
                    self.sink.token(")");
                    self.sink.end_group();
                }
            }
            SelectorKind::Unknown => self.print_unknown_selector(statement, value),
        }
    }

    fn print_unknown_selector(&mut self, statement: Statement<'_, 'a>, value: &[u8]) {
        self.is_memoizable = false;
        if statement.css_ancestor(Kind::Rule).is_some_and(|rule| rule.is_scss_nested_property) {
            let value = maybe_to_lower_case(value);
            return self.sink.text(&adjust_numbers(&adjust_strings(&value, self.single_quote)));
        }
        let values = statement.values;
        // In the parentheses of `selector()`.
        if let [.., func, paren_group] = self.value_stack[..]
            && let paren_group = values.node(paren_group)
            && paren_group.kind == ValueKind::ParenGroup
            && paren_group.open != 0
            && paren_group.close != 0
            && values.node(func).kind == ValueKind::Func
            && values.value(func) == Some(b"selector")
        {
            let start = values.node(paren_group.open).loc.end_offset.map_or(0, |at| at as usize + 1);
            let end = values.node(paren_group.close).loc.start_offset.map_or(0, |at| at as usize);
            let selector = text::trim(self.text().get(start..end).unwrap_or_default());
            if last_line_has_inline_comment(selector) {
                self.sink.break_parent();
            }
            return self.sink.text(selector);
        }
        // The text is taken from the style sheet, for the sake of Less.
        let parent = statement.node();
        if self.value_stack.is_empty() && !parent.raw_selector.is_empty() {
            let end = parent.start + parent.raw_selector.len();
            return self.sink.text(text::trim(self.text().get(parent.start..end).unwrap_or_default()));
        }
        self.sink.text(value);
    }

    // ───────────────────────────── values ─────────────────────────────

    /// The name of the function that what is being printed is in.
    pub(crate) fn value_function<'v>(&self, values: &'v Values) -> Option<&'v [u8]> {
        let function = self.value_stack.iter().rev().find(|&&id| values.node(id).kind == ValueKind::Func);
        function.and_then(|&id| values.value(id))
    }

    /// `insideValueFunctionNode`
    pub(crate) fn inside_value_function(&self, values: &Values, name: &[u8]) -> bool {
        self.value_function(values).is_some_and(|value| text::eq_lower_case(value, name))
    }

    /// `previous`: what is before `id` in the group that it is in.
    pub(crate) fn print_value(&mut self, statement: Statement<'_, 'a>, id: ValueId, previous: Option<ValueId>) {
        let values = statement.values;
        let node = values.node(id);
        let value = values.value(id).unwrap_or_default();
        match node.kind {
            ValueKind::Root | ValueKind::Value => self.print_child_value(statement, id, node.group),
            ValueKind::Comment => {
                self.is_memoizable = false;
                let (start, end) = (node.loc.start_offset.unwrap_or(0) as usize, node.loc.end_offset.unwrap_or(0) as usize);
                let text = self.text().get(start..end).unwrap_or_default();
                match node.inline {
                    true => {
                        self.sink.start_line_suffix();
                        self.sink.text(text::trim_end(text));
                        self.sink.end_line_suffix();
                    }
                    false => self.sink.text(text),
                }
            }
            ValueKind::CommaGroup => self.print_comma_separated_value_group(statement, id),
            ValueKind::ParenGroup => self.print_parenthesized_value_group(statement, id),
            ValueKind::Func => {
                let is_keyword = ["not", "and", "or"].iter().any(|it| text::eq_lower_case(value, it.as_bytes()));
                self.sink.text(value);
                if is_keyword && statement.inside_at_rule(&[b"supports"]) {
                    self.sink.token(" ");
                }
                self.print_child_value(statement, id, node.group);
            }
            ValueKind::Number => {
                self.scratch.clear();
                print_css_number(value, &mut self.scratch);
                self.sink.text(&self.scratch);
                self.sink.text(print_unit(values.text(node.unit)));
            }
            ValueKind::Paren | ValueKind::Operator | ValueKind::UnicodeRange | ValueKind::Unknown | ValueKind::Comma => {
                self.sink.text(value);
            }
            ValueKind::Text => self.sink.text(values.text_of(id)),
            ValueKind::Word => {
                let is_wide_keyword =
                    ["initial", "inherit", "unset", "revert"].iter().any(|it| text::eq_lower_case(value, it.as_bytes()));
                match (node.is_color && node.is_hex) || is_wide_keyword {
                    true => self.sink.text(&text::to_lower_case(value)),
                    false => self.sink.text(value),
                }
            }
            ValueKind::Colon => {
                let is_escaped = previous.and_then(|it| values.value(it)).is_some_and(|it| it.ends_with(b"\\"));
                self.sink.start_group(false);
                self.sink.token(":");
                if !(is_escaped || self.inside_value_function(values, b"url")) {
                    self.sink.line();
                }
                self.sink.end_group();
            }
            ValueKind::String => {
                self.scratch.clear();
                print_string(values.raw_string(id), self.single_quote, &mut self.scratch);
                self.sink.text(&self.scratch);
            }
            ValueKind::AtWord => {
                self.sink.token("@");
                self.sink.text(value);
            }
            ValueKind::Selector => self.print_selector(statement, node.selector, None, None),
        }
    }

    /// Prints `child`, which is in `parent`.
    pub(crate) fn print_child_value(&mut self, statement: Statement<'_, 'a>, parent: ValueId, child: ValueId) {
        self.value_stack.push(parent);
        self.print_value(statement, child, None);
        self.value_stack.pop();
    }
}

/// `isAtWordPlaceholderNode`
pub(crate) fn is_at_word_placeholder(values: &Values, id: ValueId) -> bool {
    values.node(id).kind == ValueKind::AtWord && values.value(id).is_some_and(|value| value.starts_with(b"prettier-placeholder-"))
}

/// `node.value.group.group`
pub(crate) fn top_level_group(values: &Values, root: ValueId) -> Option<ValueId> {
    let root = values.node(root);
    let value = Some(values.node(root.group)).filter(|value| root.kind == ValueKind::Root && value.kind == ValueKind::Value)?;
    Some(value.group)
}

/// The first condition of `shouldBreakList`.
pub(crate) fn is_list_with_comma_group(values: &Values, id: ValueId) -> bool {
    let node = values.node(id);
    node.kind == ValueKind::ParenGroup && node.open == 0 && values.groups(id).iter().any(|&it| values.node(it).kind == ValueKind::CommaGroup)
}
