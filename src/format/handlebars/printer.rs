//! Prettier's `language-handlebars/printer-glimmer.js`. It writes the parts of the document one after the other.

use super::ast::{self, Call, Head, Kind, NOTHING, Node, NodeId, Range, Tree};
use super::positions::Positions;
use super::tokenizer::is_void_tag;
use crate::FormatOptions;
use crate::css::doc::{self, Doc, Elements, IndentCommand, Line};
use crate::css::text::{self, white_space_len_at_start};
use crate::options::EmbeddedLanguageFormatting;
use bun_core::strings;

const HTML_WHITE_SPACE: &[u8] = b"\t\n\x0C\r ";

fn is_html_white_space(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | 0x0C | b'\r' | b' ')
}

/// `htmlWhitespace.trimStart(text)`
fn trim_start(text: &[u8]) -> &[u8] {
    &text[text.iter().take_while(|byte| is_html_white_space(**byte)).count()..]
}

/// `htmlWhitespace.trimEnd(text)`
fn trim_end(text: &[u8]) -> &[u8] {
    &text[..text.len() - text.iter().rev().take_while(|byte| is_html_white_space(**byte)).count()]
}

fn count_new_lines(text: &[u8]) -> usize {
    strings::count_char(text, b'\n')
}

/// `/\s/.test(text)`
fn has_white_space(text: &[u8]) -> bool {
    (0..text.len()).any(|at| white_space_len_at_start(&text[at..]).is_some())
}

/// `string.toUpperCase() === string`, for the first UTF-16 code unit of the name of a tag.
fn starts_with_upper_case(tag: &[u8]) -> bool {
    !tag.first().is_some_and(u8::is_ascii_lowercase)
}

/// What a text is in.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Parent {
    Template,
    Block,
    Element,
    Pre,
    Style,
}

pub(crate) struct Printer<'a> {
    pub(crate) tree: &'a Tree,
    /// `options.originalText`, with blanks in the place of the front matter.
    pub(crate) source: &'a [u8],
    pub(crate) front_matter: &'a [u8],
    pub(crate) positions: &'a Positions,
    pub(crate) options: &'a FormatOptions,
    /// `options.htmlWhitespaceSensitivity !== "ignore"`
    pub(crate) is_white_space_sensitive: bool,
    pub(crate) single_quote: bool,
    pub(crate) out: &'a mut Elements,
}

impl<'a> Printer<'a> {
    fn text(&self, text: ast::Text) -> &'a [u8] {
        self.tree.text(self.source, text)
    }

    fn list(&self, range: Range) -> &'a [NodeId] {
        self.tree.list(range)
    }

    fn token(&mut self, text: &str) {
        self.out.text(text.as_bytes());
    }

    fn start_group(&mut self) {
        self.out.start_group(false, 0, false);
    }

    fn start_indent(&mut self) {
        self.out.start_indent(IndentCommand::Indent);
    }

    /// `generateHardlines`
    fn hard_lines(&mut self, count: usize) {
        for _ in 0..count.min(2) {
            self.out.hard_line();
        }
    }

    /// A `line`, or as many `hardline`s as `white_space` has line breaks, two at most. `is_dedented`: each in a `dedent`.
    fn breaks(&mut self, white_space: &[u8], is_dedented: bool) {
        let new_lines = count_new_lines(white_space);
        for _ in 0..new_lines.clamp(1, 2) {
            if is_dedented {
                self.out.start_indent(IndentCommand::Dedent);
            }
            match new_lines {
                0 => self.out.line(Line::Space),
                _ => self.out.hard_line(),
            }
            if is_dedented {
                self.out.end_indent();
            }
        }
    }

    /// `replaceEndOfLine(text)`
    fn with_literal_lines(&mut self, text: &[u8], is_escaped: bool) {
        for (index, line) in strings::split(text, b"\n").enumerate() {
            if index > 0 {
                self.out.line(Line::Literal);
                self.out.break_parent();
            }
            match is_escaped {
                true => self.escaped(line),
                false => self.out.text(line),
            }
        }
    }

    /// `text.replaceAll("{{", "\\{{")`: a mustache in a text has been escaped.
    fn escaped(&mut self, mut text: &[u8]) {
        while let Some(at) = strings::index_of(text, b"{{") {
            self.out.text(&text[..at]);
            self.token("\\{{");
            text = &text[at + 2..];
        }
        self.out.text(text);
    }

    /// `fill(getTextValueParts(text))`, where `text` is `words` with a blank before and behind it, if so.
    fn fill(&mut self, has_blank_before: bool, words: &[u8], has_blank_behind: bool) {
        self.out.start_fill();
        let separator = |out: &mut Elements| {
            out.start_item();
            out.line(Line::Space);
            out.end_item();
        };
        let empty = |out: &mut Elements| {
            out.start_item();
            out.end_item();
        };
        if has_blank_before {
            empty(self.out);
            separator(self.out);
        }
        let mut rest = words;
        loop {
            let len = strings::index_of_any(rest, HTML_WHITE_SPACE).unwrap_or(rest.len());
            self.out.start_item();
            self.escaped(&rest[..len]);
            self.out.end_item();
            rest = &rest[len..];
            if rest.is_empty() {
                break;
            }
            separator(self.out);
            rest = trim_start(rest);
        }
        if has_blank_behind {
            separator(self.out);
            empty(self.out);
        }
        self.out.end_fill();
    }

    // ───────────────────────────── utilities.js ─────────────────────────────

    /// `isWhitespaceNode`
    fn is_white_space_node(&self, node: NodeId) -> bool {
        matches!(self.tree.kind(node), Kind::Text { chars } if text::trim_start(self.text(chars)).is_empty())
    }

    fn are_white_space(&self, nodes: &[NodeId]) -> bool {
        nodes.iter().all(|node| self.is_white_space_node(*node))
    }

    /// `isVoidElement`
    fn is_void_element(&self, tag: &[u8], children: &[NodeId], is_self_closing: bool) -> bool {
        let is_void_tag = || is_void_tag(&text::to_lower_case(tag)) && !starts_with_upper_case(tag);
        let is_glimmer_component = || !tag.starts_with(b":") && (starts_with_upper_case(tag) || strings::contains_char(tag, b'.'));
        is_self_closing || is_void_tag() || (is_glimmer_component() && self.are_white_space(children))
    }

    /// `isPrettierIgnoreNode`
    fn is_prettier_ignore(&self, node: NodeId) -> bool {
        matches!(self.tree.kind(node), Kind::MustacheComment { value } if text::trim(self.text(value)) == b"prettier-ignore")
    }

    /// What is ignored is printed as it is written.
    fn ignored(&mut self, node: Node) {
        self.out.text(self.source.get(node.start as usize..node.end as usize).unwrap_or_default());
    }

    // ───────────────────────────── statements ─────────────────────────────

    pub(crate) fn template(&mut self, template: NodeId) {
        if let Kind::Template { body } = self.tree.kind(template) {
            self.start_group();
            self.children(self.list(body), Parent::Template, None);
            self.out.end_group();
        }
    }

    /// `path.map(print, "body")` or `"children"`. `outer`: `nodes` are what follows `{{else}}` in that block.
    fn children(&mut self, nodes: &'a [NodeId], parent: Parent, outer: Option<(Call, u8)>) {
        for (index, &id) in nodes.iter().enumerate() {
            let node = self.tree.node(id);
            if self.is_prettier_ignore(id) || (index >= 2 && self.is_prettier_ignore(nodes[index - 2])) {
                self.ignored(node);
                continue;
            }
            match node.kind {
                Kind::Text { chars } => self.text_node(self.text(chars), nodes, index, parent),
                Kind::Element { .. } => {
                    let follows_element = index > 0 && matches!(self.tree.kind(nodes[index - 1]), Kind::Element { .. });
                    self.element(node, follows_element);
                }
                Kind::BlockStatement { call, .. } => {
                    let outer = outer.filter(|outer| nodes.len() == 1 && self.is_else_if(call, outer.0));
                    self.block_statement(node, outer.map(|outer| outer.1));
                }
                Kind::Mustache { call, is_trusting, strip } => self.mustache(call, is_trusting, strip, false),
                Kind::MustacheComment { value } => self.mustache_comment(node, self.text(value)),
                Kind::Comment { value } => {
                    self.token("<!--");
                    self.out.text(self.text(value));
                    self.token("-->");
                }
                Kind::FrontMatter => self.print_front_matter(self.front_matter),
                _ => {}
            }
        }
    }

    fn mustache_comment(&mut self, node: Node, value: &[u8]) {
        let is_tilde = |at: Option<usize>| at.and_then(|at| self.source.get(at)) == Some(&b'~');
        let strips_left = is_tilde(self.positions.moved(node.start as usize, 2));
        let strips_right = is_tilde(self.positions.moved(node.end as usize, -3));
        let dashes = if strings::contains(value, b"}}") { "--" } else { "" };
        self.token(if strips_left { "{{~!" } else { "{{!" });
        self.token(dashes);
        self.out.text(value);
        self.token(dashes);
        self.token(if strips_right { "~}}" } else { "}}" });
    }

    /// Prettier's `printEmbedFrontMatter`, or `printFrontMatter` where that does not apply.
    fn print_front_matter(&mut self, raw: &[u8]) {
        let formatted = crate::markdown::front_matter::parse(raw).and_then(|front_matter| {
            if matches!(self.options.embedded_language_formatting, EmbeddedLanguageFormatting::Off) {
                return None;
            }
            let language = &raw[front_matter.explicit_language.0..front_matter.explicit_language.1];
            let is_toml = language == b"toml" || (language.is_empty() && raw.starts_with(b"+++"));
            let is_yaml = language == b"yaml" || (language.is_empty() && !is_toml);
            let value = match text::trim(&raw[front_matter.value.0..front_matter.value.1]) {
                b"" if is_yaml || is_toml => Doc::EMPTY,
                value if is_yaml => doc::strip_trailing_hardline(doc::clean(crate::yaml::document(value, self.options).ok()?)),
                _ => return None,
            };
            Some((language, value))
        });
        let Some((language, value)) = formatted else {
            return self.out.text(raw);
        };
        self.out.start_indent(IndentCommand::MarkAsRoot);
        self.out.text(&raw[..3]);
        self.out.text(language);
        self.out.hard_line();
        if !value.is_empty_text() {
            self.out.document(&value);
            self.out.hard_line();
        }
        self.out.text(&raw[raw.len() - 3..]);
        self.out.end_indent();
    }

    // ───────────────────────────── elements ─────────────────────────────

    /// `embed`: the style sheet that is all that a `<style>` has.
    fn embedded_style_sheet(&self, attributes: &[NodeId], children: &[NodeId]) -> Option<Doc<'static>> {
        let [child] = children else {
            return None;
        };
        let Kind::Text { chars } = self.tree.kind(*child) else {
            return None;
        };
        if matches!(self.options.embedded_language_formatting, EmbeddedLanguageFormatting::Off) {
            return None;
        }
        let language = attributes.iter().find_map(|attribute| match self.tree.kind(*attribute) {
            Kind::Attr { name, value } if self.text(name) == b"lang" => Some(value),
            _ => None,
        });
        if let Some(language) = language
            && !matches!(self.tree.kind(language), Kind::Text { chars } if matches!(self.text(chars), b"" | b"css"))
        {
            return None;
        }
        let document = crate::css::document(self.text(chars), crate::css::Parser::Css, self.options).ok()?;
        (!document.is_empty_text()).then_some(document)
    }

    fn element(&mut self, node: Node, follows_element: bool) {
        let Kind::Element {
            tag,
            attributes,
            block_params,
            children,
            is_self_closing,
        } = node.kind
        else {
            return;
        };
        let (tag, attributes, children) = (self.text(tag), self.list(attributes), self.list(children));
        let is_void = self.is_void_element(tag, children, is_self_closing);

        if !self.is_white_space_sensitive && follows_element {
            self.out.line(Line::Soft);
        }
        // `printStartingTag`
        self.start_group();
        self.token("<");
        self.out.text(tag);
        self.start_indent();
        for &attribute in attributes {
            self.out.line(Line::Space);
            self.attribute(attribute);
        }
        if !block_params.is_empty() {
            self.out.line(Line::Space);
            self.block_params(block_params);
        }
        self.out.end_indent();
        self.out.start_if_break(0);
        self.out.line(Line::Soft);
        self.token(if is_void { "/>" } else { ">" });
        self.out.otherwise();
        if is_void {
            self.token(" />");
            self.out.line(Line::Soft);
        } else {
            self.token(">");
        }
        self.out.end_if_break();
        self.out.end_group();
        if is_void {
            return;
        }

        let is_style = tag == b"style";
        let is_empty = children.is_empty() || ((!self.is_white_space_sensitive || is_style) && self.are_white_space(children));
        if is_empty {
            // Nothing is between the tags.
        } else if is_style || !self.is_white_space_sensitive {
            self.start_indent();
            self.out.line(Line::Soft);
            match is_style.then(|| self.embedded_style_sheet(attributes, children)).flatten() {
                Some(style_sheet) => self.out.document(&style_sheet),
                None => self.children(children, if is_style { Parent::Style } else { self.parent_of(tag) }, None),
            }
            self.out.end_indent();
            self.out.line(Line::Soft);
        } else {
            self.start_indent();
            self.start_group();
            self.children(children, self.parent_of(tag), None);
            self.out.end_group();
            self.out.end_indent();
        }
        self.token("</");
        self.out.text(tag);
        self.token(">");
    }

    fn parent_of(&self, tag: &[u8]) -> Parent {
        if tag == b"pre" { Parent::Pre } else { Parent::Element }
    }

    /// An attribute, a modifier or a comment in a tag.
    fn attribute(&mut self, id: NodeId) {
        let node = self.tree.node(id);
        match node.kind {
            Kind::Attr { name, value } => self.attr_node(self.text(name), value),
            Kind::ElementModifier { call } => {
                self.start_group();
                self.token("{{");
                self.path_and_params(call, false);
                self.token("}}");
                self.out.end_group();
            }
            Kind::MustacheComment { .. } if self.is_prettier_ignore(id) => self.ignored(node),
            Kind::MustacheComment { value } => self.mustache_comment(node, self.text(value)),
            _ => {}
        }
    }

    /// `getPreferredQuote`, for the texts in `nodes`.
    fn preferred_quote_of(&self, nodes: &[NodeId]) -> &'static str {
        let (mut double, mut single) = (0, 0);
        for node in nodes {
            if let Kind::Text { chars } = self.tree.kind(*node) {
                double += strings::count_char(self.text(chars), b'"');
                single += strings::count_char(self.text(chars), b'\'');
            }
        }
        preferred_quote(double, single, self.single_quote)
    }

    fn attr_node(&mut self, name: &[u8], value: NodeId) {
        let node = self.tree.node(value);
        let is_class = name.eq_ignore_ascii_case(b"class");
        let quote = match node.kind {
            // There is no value.
            Kind::Text { chars } if chars.is_empty() && node.start == node.end => return self.out.text(name),
            Kind::Text { .. } => self.preferred_quote_of(&[value]),
            Kind::Concat { parts } => self.preferred_quote_of(self.list(parts)),
            _ => "",
        };
        self.out.text(name);
        self.token("=");
        self.token(quote);
        let is_grouped = name == b"class" && !quote.is_empty();
        if is_grouped {
            self.start_group();
            self.start_indent();
        }
        match node.kind {
            Kind::Text { chars } => self.text_in_attribute(self.text(chars), is_class, false, false),
            Kind::Concat { parts } => {
                let parts = self.list(parts);
                let tree = self.tree;
                let is_mustache = |index: Option<usize>| index.and_then(|index| parts.get(index)).is_some_and(|part| matches!(tree.kind(*part), Kind::Mustache { .. }));
                for (index, part) in parts.iter().enumerate() {
                    match self.tree.kind(*part) {
                        Kind::Text { chars } => {
                            let (follows, precedes) = (is_mustache(index.checked_sub(1)), is_mustache(Some(index + 1)));
                            self.text_in_attribute(self.text(chars), is_class, follows, precedes);
                        }
                        Kind::Mustache { call, is_trusting, strip } => self.mustache(call, is_trusting, strip, true),
                        _ => {}
                    }
                }
            }
            Kind::Mustache { call, is_trusting, strip } => self.mustache(call, is_trusting, strip, false),
            _ => {}
        }
        if is_grouped {
            self.out.end_indent();
            self.out.end_group();
        }
        self.token(quote);
    }

    /// `follows_mustache`, `precedes_mustache`: in a `ConcatStatement`.
    fn text_in_attribute(&mut self, chars: &[u8], is_class: bool, follows_mustache: bool, precedes_mustache: bool) {
        if !is_class {
            return self.with_literal_lines(chars, true);
        }
        let mut classes = text::trim(chars);
        if follows_mustache && text::starts_with_white_space(chars) {
            self.out.line(Line::Space);
        }
        let has_classes = !classes.is_empty();
        // `.replaceAll(/\s+/g, " ")`
        while !classes.is_empty() {
            let len = (0..classes.len()).find(|at| white_space_len_at_start(&classes[*at..]).is_some()).unwrap_or(classes.len());
            self.escaped(&classes[..len]);
            classes = &classes[len..];
            if !classes.is_empty() {
                self.token(" ");
                classes = text::trim_start(classes);
            }
        }
        if precedes_mustache && has_classes && text::trim_end(chars).len() < chars.len() {
            self.out.line(Line::Space);
        }
    }

    // ───────────────────────────── text ─────────────────────────────

    fn text_node(&mut self, chars: &[u8], siblings: &[NodeId], index: usize, parent: Parent) {
        match parent {
            Parent::Pre => return self.with_literal_lines(chars, false),
            Parent::Style => return self.text_in_style(chars),
            Parent::Template | Parent::Block | Parent::Element => {}
        }
        let is_white_space_only = trim_start(chars).is_empty();
        let (is_first, is_last) = (index == 0, index + 1 == siblings.len());

        if self.is_white_space_sensitive {
            let trims_leading = is_first && parent == Parent::Template;
            let trims_trailing = is_last && parent == Parent::Template;
            if is_white_space_only {
                if !trims_leading && !trims_trailing {
                    self.breaks(chars, is_last);
                }
                return;
            }
            let without_leading = trim_start(chars);
            let words = trim_end(without_leading);
            let leading = &chars[..chars.len() - without_leading.len()];
            let trailing = &without_leading[words.len()..];
            if !leading.is_empty() {
                self.breaks(leading, false);
            }
            self.fill(false, words, false);
            if !trailing.is_empty() && !trims_trailing {
                self.breaks(trailing, is_last);
            }
            return;
        }

        if (is_first || is_last) && is_white_space_only {
            return;
        }
        let kind_at = |index: Option<usize>| index.and_then(|index| siblings.get(index)).map_or(Kind::Nothing, |node| self.tree.kind(*node));
        let (previous, next) = (kind_at(index.checked_sub(1)), kind_at(Some(index + 1)));
        let is_block_or_element = |kind: Kind| matches!(kind, Kind::BlockStatement { .. } | Kind::Element { .. });
        let is_mustache = |kind: Kind| matches!(kind, Kind::Mustache { .. });

        let line_breaks = count_new_lines(chars);
        // `countLeadingNewLines`, `countTrailingNewLines`
        let mut leading_line_breaks = count_new_lines(&chars[..chars.len() - text::trim_start(chars).len()]);
        let mut trailing_line_breaks = count_new_lines(&chars[text::trim_end(chars).len()..]);
        if is_white_space_only && line_breaks > 0 {
            leading_line_breaks = line_breaks.min(2);
            trailing_line_breaks = 0;
        } else {
            if is_block_or_element(next) {
                trailing_line_breaks = trailing_line_breaks.max(1);
            }
            if is_block_or_element(previous) {
                leading_line_breaks = leading_line_breaks.max(1);
            }
        }
        let mut trailing_space = trailing_line_breaks == 0 && is_mustache(next);
        let mut leading_space = leading_line_breaks == 0 && is_mustache(previous);
        if is_first {
            (leading_line_breaks, leading_space) = (0, false);
        }
        if is_last {
            (trailing_line_breaks, trailing_space) = (0, false);
        }

        let words = trim_end(trim_start(chars));
        self.hard_lines(leading_line_breaks);
        if words.is_empty() {
            // The blank before it is taken for one behind it.
            self.fill(leading_space && trailing_space, b"", false);
        } else {
            let has_leading = chars.first().is_some_and(|byte| is_html_white_space(*byte));
            let has_trailing = chars.last().is_some_and(|byte| is_html_white_space(*byte));
            self.fill(has_leading && leading_space, words, has_trailing && trailing_space);
        }
        self.hard_lines(trailing_line_breaks);
    }

    /// A text in `<style>` that is not formatted as a style sheet.
    fn text_in_style(&mut self, chars: &[u8]) {
        let text = &chars[chars.iter().take_while(|byte| **byte == b'\n').count()..];
        let text = trim_end(text);
        // `htmlWhitespace.dedentString(text)`
        let mut min_indentation = usize::MAX;
        for line in strings::split(text, b"\n") {
            let indentation = line.len() - trim_start(line).len();
            if line.is_empty() || (indentation == line.len() && indentation > 0) {
                continue;
            }
            min_indentation = min_indentation.min(indentation);
            if indentation == 0 {
                break;
            }
        }
        if min_indentation == usize::MAX {
            min_indentation = 0;
        }
        for (index, line) in strings::split(text, b"\n").enumerate() {
            if index > 0 {
                self.out.hard_line();
            }
            self.out.text(line.get(min_indentation..).unwrap_or_default());
        }
    }

    // ───────────────────────────── blocks ─────────────────────────────

    /// The name of the helper, if it is a variable.
    fn head_name(&self, call: Call) -> Option<&'a [u8]> {
        match self.tree.kind(call.path) {
            Kind::Path { head: Head::Var, name, .. } => Some(self.text(name)),
            _ => None,
        }
    }

    /// `isElseIfBlock`, for a block that is all that follows `{{else}}` in the block `outer`.
    fn is_else_if(&self, block: Call, outer: Call) -> bool {
        match self.head_name(block) {
            Some(b"if") => true,
            Some(name) => self.head_name(outer) == Some(name),
            None => false,
        }
    }

    fn body_of(&self, block: NodeId) -> (&'a [NodeId], Range) {
        match self.tree.kind(block) {
            Kind::Block { body, block_params } => (self.list(body), block_params),
            _ => (&[], Range::default()),
        }
    }

    fn block_params(&mut self, names: Range) {
        self.token("as |");
        for (index, name) in self.tree.names(names).iter().enumerate() {
            if index > 0 {
                self.token(" ");
            }
            self.out.text(self.text(*name));
        }
        self.token("|");
    }

    fn open_mustache(&mut self, strips: bool, mark: &str) {
        self.token(if strips { "{{~" } else { "{{" });
        self.token(mark);
    }

    fn close_mustache(&mut self, strips: bool) {
        self.token(if strips { "~}}" } else { "}}" });
    }

    /// `else_if_of`: it is printed as `{{else if ..}}`, of a block with that `strip`.
    fn block_statement(&mut self, node: Node, else_if_of: Option<u8>) {
        let Kind::BlockStatement {
            call,
            program,
            inverse,
            strip,
        } = node.kind
        else {
            return;
        };
        let (body, block_params) = self.body_of(program);
        let has_params = !call.params.is_empty() || !call.pairs.is_empty();
        let is_ignoring_white_space = !self.is_white_space_sensitive;

        self.start_group();
        match else_if_of {
            // `printElseIfBlock`
            Some(outer) => {
                self.open_mustache(outer & ast::INVERSE_OPEN != 0, "else ");
                self.out.text(self.head_name(call).unwrap_or_default());
                self.start_indent();
                self.out.line(Line::Space);
                self.start_group();
                self.params(call, false);
                self.out.end_group();
                if !block_params.is_empty() {
                    self.out.line(Line::Space);
                    self.block_params(block_params);
                }
                self.out.end_indent();
                self.out.line(Line::Soft);
                self.close_mustache(outer & ast::INVERSE_CLOSE != 0);
            }
            // `printOpenBlock`
            None => {
                self.open_mustache(strip & ast::OPEN_OPEN != 0, "#");
                self.expression(call.path, false);
                if has_params || !block_params.is_empty() {
                    self.start_indent();
                    self.out.line(Line::Space);
                    if has_params {
                        self.start_group();
                        self.params(call, false);
                        self.out.end_group();
                    }
                    if !block_params.is_empty() {
                        if has_params {
                            self.out.line(Line::Space);
                        }
                        self.block_params(block_params);
                    }
                    self.out.end_indent();
                }
                self.out.line(Line::Soft);
                self.close_mustache(strip & ast::OPEN_CLOSE != 0);
            }
        }
        self.out.end_group();

        if else_if_of.is_none() {
            self.start_group();
        }
        // `printProgram`
        let is_blank = self.are_white_space(body);
        if !is_blank {
            self.start_indent();
            if is_ignoring_white_space {
                self.out.hard_line();
            }
            self.start_group();
            self.children(body, Parent::Block, None);
            self.out.end_group();
            self.out.end_indent();
        }
        // `printInverse`
        if inverse != NOTHING {
            let (body, _) = self.body_of(inverse);
            let is_chained = matches!(body, [block] if matches!(self.tree.kind(*block), Kind::BlockStatement { call: block, .. } if self.is_else_if(block, call)));
            if !is_chained {
                // `printElseBlock`
                if is_ignoring_white_space {
                    self.out.hard_line();
                }
                self.open_mustache(strip & ast::INVERSE_OPEN != 0, "else");
                self.close_mustache(strip & ast::INVERSE_CLOSE != 0);
                self.start_indent();
            }
            if is_ignoring_white_space {
                self.out.hard_line();
            }
            self.start_group();
            self.children(body, Parent::Block, Some((call, strip)));
            self.out.end_group();
            if !is_chained {
                self.out.end_indent();
            }
        }
        if else_if_of.is_some() {
            return;
        }
        // `printCloseBlock`
        if is_ignoring_white_space {
            match is_blank {
                true => self.out.line(Line::Soft),
                false => self.out.hard_line(),
            }
        }
        self.open_mustache(strip & ast::CLOSE_OPEN != 0, "/");
        self.expression(call.path, false);
        self.close_mustache(strip & ast::CLOSE_CLOSE != 0);
        self.out.end_group();
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// `is_in_quotes`: it is a part of the value of an attribute, which is in quotes.
    fn mustache(&mut self, call: Call, is_trusting: bool, strip: u8, is_in_quotes: bool) {
        self.start_group();
        self.token(if is_trusting { "{{{" } else { "{{" });
        if strip & ast::OPEN_OPEN != 0 {
            self.token("~");
        }
        self.path_and_params(call, is_in_quotes);
        if strip & ast::OPEN_CLOSE != 0 {
            self.token("~");
        }
        self.token(if is_trusting { "}}}" } else { "}}" });
        self.out.end_group();
    }

    /// `printPathAndParams`
    fn path_and_params(&mut self, call: Call, is_in_quotes: bool) {
        if call.params.is_empty() && call.pairs.is_empty() {
            return self.expression(call.path, is_in_quotes);
        }
        self.start_indent();
        self.expression(call.path, is_in_quotes);
        self.out.line(Line::Space);
        self.params(call, is_in_quotes);
        self.out.end_indent();
        self.out.line(Line::Soft);
    }

    /// `printParams`
    fn params(&mut self, call: Call, is_in_quotes: bool) {
        let (params, pairs) = (self.list(call.params), self.list(call.pairs));
        for (index, param) in params.iter().enumerate() {
            if index > 0 {
                self.out.line(Line::Space);
            }
            self.expression(*param, is_in_quotes);
        }
        for (index, pair) in pairs.iter().enumerate() {
            if index > 0 || !params.is_empty() {
                self.out.line(Line::Space);
            }
            if let Kind::HashPair { key, value } = self.tree.kind(*pair) {
                self.out.text(self.text(key));
                self.token("=");
                self.expression(value, false);
            }
        }
    }

    /// `needs_opposite_quote`: Prettier's `needsOppositeQuote`, if it is a string.
    fn expression(&mut self, id: NodeId, needs_opposite_quote: bool) {
        match self.tree.kind(id) {
            Kind::SubExpression { call } => {
                self.start_group();
                self.token("(");
                if call.params.is_empty() && call.pairs.is_empty() {
                    self.expression(call.path, needs_opposite_quote);
                } else {
                    self.start_indent();
                    self.expression(call.path, needs_opposite_quote);
                    self.out.line(Line::Space);
                    self.start_group();
                    self.params(call, needs_opposite_quote);
                    self.out.end_group();
                    self.out.end_indent();
                }
                self.out.line(Line::Soft);
                self.token(")");
                self.out.end_group();
            }
            Kind::Path { head, name, tail } => self.path(if head == Head::This { &b"this"[..] } else { self.text(name) }, tail),
            Kind::String { value } => {
                let mut value = self.text(value);
                let (double, single) = (strings::count_char(value, b'"'), strings::count_char(value, b'\''));
                let quote = preferred_quote(double, single, self.single_quote != needs_opposite_quote);
                self.token(quote);
                while let Some(at) = strings::index_of_char_usize(value, quote.as_bytes()[0]) {
                    self.out.text(&value[..at]);
                    self.token("\\");
                    self.token(quote);
                    value = &value[at + 1..];
                }
                self.out.text(value);
                self.token(quote);
            }
            Kind::Number { token } => self.number(self.text(token)),
            Kind::Boolean(value) => self.token(if value { "true" } else { "false" }),
            Kind::Undefined => self.token("undefined"),
            Kind::Null => self.token("null"),
            _ => {}
        }
    }

    /// `String(Number(token))`
    fn number(&mut self, token: &[u8]) {
        let is_as_printed = token.len() <= 15 && token.iter().all(u8::is_ascii_digit) && (token.len() == 1 || token[0] != b'0');
        if is_as_printed {
            return self.out.text(token);
        }
        let value = std::str::from_utf8(token).ok().and_then(|it| it.parse::<f64>().ok()).unwrap_or(f64::NAN);
        self.out.text(&bun_sema::atom::number_to_string(value));
    }

    /// `printPathExpression`
    fn path(&mut self, head: &[u8], tail: Range) {
        let tail = self.tree.names(tail);
        if tail.is_empty() && strings::contains_char(head, b'/') {
            return self.out.text(head);
        }
        self.path_part(head, true);
        for part in tail {
            self.token(".");
            self.path_part(self.text(*part), false);
        }
    }

    fn path_part(&mut self, part: &[u8], is_first: bool) {
        // `isPathExpressionPartNeedBrackets`
        let needs_brackets = !(is_first && part.starts_with(b"@"))
            && ((!is_first && matches!(part, b"true" | b"false" | b"null" | b"undefined"))
                || part.first().is_some_and(u8::is_ascii_digit)
                || strings::index_of_any(part, b"!\"#%&'()*+,./;<=>@[\\]^`{|}~").is_some()
                || has_white_space(part));
        if needs_brackets {
            self.token("[");
        }
        self.out.text(part);
        if needs_brackets {
            self.token("]");
        }
    }
}

/// `getPreferredQuote`, for a text that has so many quotes.
fn preferred_quote(double: usize, single: usize, prefers_single: bool) -> &'static str {
    let is_single = if prefers_single { single <= double } else { double > single };
    if is_single { "'" } else { "\"" }
}
