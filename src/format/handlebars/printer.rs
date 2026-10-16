//! Prettier's `language-handlebars/printer-glimmer.js`. It writes the parts of the document one after the other.
//!
//! Where what Prettier prints is read as something else than the template, a comment says what Prettier does.

use super::ast::{self, Call, Head, Kind, NOTHING, Node, NodeId, Range, Tree};
use super::lexer::id_len;
use super::tokenizer::is_void_tag;
use crate::FormatOptions;
use crate::css::doc::{self, Doc, Elements, IndentCommand, Line};
use crate::options::EmbeddedLanguageFormatting;
use crate::stack::Stack;
use crate::text;
use bun_core::strings;
use std::borrow::Cow;

const HTML_WHITE_SPACE: &[u8] = b"\t\n\x0C\r ";

/// `string.toUpperCase() === string`, for the first UTF-16 code unit of the name of a tag.
fn starts_with_upper_case(tag: &[u8]) -> bool {
    !tag.first().is_some_and(u8::is_ascii_lowercase)
}

/// Whether there is a blank before and behind words.
#[derive(Copy, Clone, Default)]
struct Blanks {
    before: bool,
    behind: bool,
}

/// What a text is next to in a `ConcatStatement`.
#[derive(Copy, Clone, Default)]
struct Neighbors {
    follows_mustache: bool,
    precedes_mustache: bool,
}

/// What a text is in.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Parent {
    Template,
    Block,
    Element,
    Style,
}

/// What of a text is not written as the tree has it.
#[derive(Copy, Clone)]
enum Escapes {
    Nothing,
    /// `{{`: a mustache in a text has been escaped.
    Mustaches,
    /// And the quote that the text is in.
    MustachesAndQuote(u8),
}

pub(crate) struct Printer<'a> {
    pub(crate) tree: &'a Tree,
    /// `options.originalText`, with blanks in the place of the front matter.
    pub(crate) source: &'a [u8],
    pub(crate) front_matter: &'a [u8],
    pub(crate) options: &'a FormatOptions,
    /// `options.htmlWhitespaceSensitivity !== "ignore"`
    pub(crate) is_white_space_sensitive: bool,
    pub(crate) single_quote: bool,
    pub(crate) out: &'a mut Elements,
    /// How many elements are around what is being printed in which all white space counts.
    pub(crate) pre_depth: usize,
    pub(crate) stack: Stack,
}

impl<'a> Printer<'a> {
    fn text(&self, text: ast::Text) -> &'a [u8] {
        self.tree.text(self.source, text)
    }

    fn list(&self, range: Range) -> &'a [NodeId] {
        self.tree.list(range)
    }

    #[inline]
    fn token(&mut self, text: &str) {
        self.out.token(text);
    }

    fn start_group(&mut self) {
        self.out.start_group(doc::Group::default());
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
        let new_lines = strings::count_char(white_space, b'\n');
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

    /// A text that can have line breaks in it. For a block of code in Markdown, Prettier makes `literalline`s of them.
    fn verbatim(&mut self, text: &[u8]) {
        match self.options.is_in_markdown {
            true => self.with_literal_lines(text, Escapes::Nothing),
            false => self.out.text(text),
        }
    }

    /// `replaceEndOfLine(text)`
    fn with_literal_lines(&mut self, text: &[u8], escapes: Escapes) {
        for (index, line) in strings::split(text, b"\n").enumerate() {
            if index > 0 {
                self.out.line(Line::Literal);
                self.out.break_parent();
            }
            self.with_escapes(line, escapes);
        }
    }

    fn with_escapes(&mut self, mut text: &[u8], escapes: Escapes) {
        match escapes {
            Escapes::Nothing => self.out.text(text),
            Escapes::Mustaches => self.escaped(text),
            // Prettier writes the quote.
            Escapes::MustachesAndQuote(quote) => {
                while let Some(at) = strings::index_of_char_usize(text, quote) {
                    self.escaped(&text[..at]);
                    self.token(if quote == b'"' { "&quot;" } else { "&apos;" });
                    text = &text[at + 1..];
                }
                self.escaped(text);
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

    /// `fill(getTextValueParts(text))`, where `text` is `words` with `blanks` around it.
    fn fill(&mut self, words: &[u8], blanks: Blanks) {
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
        if blanks.before {
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
            rest = rest.trim_ascii_start();
        }
        if blanks.behind {
            separator(self.out);
            empty(self.out);
        }
        self.out.end_fill();
    }

    // ───────────────────────────── utilities.js ─────────────────────────────

    /// `isWhitespaceNode`. For Prettier it is what is white space in JavaScript: a no-break space too, which is none in
    /// HTML.
    fn is_white_space_node(&self, node: NodeId) -> bool {
        matches!(self.tree.kind(node), Kind::Text { chars } if self.text(chars).trim_ascii_start().is_empty())
    }

    fn are_white_space(&self, nodes: &[NodeId]) -> bool {
        nodes.iter().all(|node| self.is_white_space_node(*node))
    }

    /// `isVoidElement`. For Prettier `<imG>` is `<img>`, whatever is in it.
    fn is_void_element(&self, tag: &[u8], children: &[NodeId], is_self_closing: bool) -> bool {
        let is_void_tag = || is_void_tag(&text::to_lower_case(tag)) && !starts_with_upper_case(tag);
        let is_glimmer_component = || {
            !tag.starts_with(b":")
                && (starts_with_upper_case(tag) || strings::contains_char(tag, b'.'))
        };
        is_self_closing
            || ((is_void_tag() || is_glimmer_component()) && self.are_white_space(children))
    }

    /// `isPrettierIgnoreNode`
    fn is_prettier_ignore(&self, node: NodeId) -> bool {
        matches!(self.tree.kind(node), Kind::MustacheComment { value } if strings::trim_js_whitespace(self.text(value)) == b"prettier-ignore")
    }

    /// What is ignored is printed as it is written.
    fn ignored(&mut self, node: Node) {
        self.verbatim(
            self.source
                .get(node.start as usize..node.end as usize)
                .unwrap_or_default(),
        );
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
        if !self.stack.has_room() {
            return;
        }
        for (index, &id) in nodes.iter().enumerate() {
            let node = self.tree.node(id);
            let is_as_written = node.is_as_written
                || self.is_prettier_ignore(id)
                || (index >= 2 && self.is_prettier_ignore(nodes[index - 2]));
            if let Kind::Text { chars } = node.kind {
                let mut chars = Cow::Borrowed(self.text(chars));
                // One more backslash, or the last would escape the `{{` that is printed right behind it. Before a mustache
                // the tree has it: Prettier's `addBackslash`.
                if chars.ends_with(b"\\")
                    && match nodes.get(index + 1).map(|next| self.tree.kind(*next)) {
                        Some(Kind::MustacheComment { .. }) => true,
                        // Where white space does not count, the text puts it on the next line.
                        Some(Kind::BlockStatement { .. }) => {
                            self.is_white_space_sensitive || self.pre_depth > 0 || is_as_written
                        }
                        Some(_) => false,
                        None => parent == Parent::Block && self.is_white_space_sensitive,
                    }
                {
                    chars.to_mut().push(b'\\');
                }
                match is_as_written {
                    // The backslash that escapes a mustache is before the text, so Prettier does not print it.
                    true if self.options.is_in_markdown => {
                        self.with_literal_lines(&chars, Escapes::Mustaches)
                    }
                    true => self.escaped(&chars),
                    false => self.text_node(&chars, nodes, index, parent),
                }
                continue;
            }
            if is_as_written {
                self.ignored(node);
                continue;
            }
            match node.kind {
                Kind::Element { .. } => {
                    let follows_element = index > 0
                        && matches!(self.tree.kind(nodes[index - 1]), Kind::Element { .. });
                    self.element(node, follows_element);
                }
                Kind::BlockStatement { .. } => {
                    let outer =
                        outer.filter(|outer| nodes.len() == 1 && self.is_else_if(id, *outer));
                    self.block_statement(node, outer.map(|outer| outer.1));
                }
                Kind::Mustache { .. } => self.mustache_node(node, false),
                Kind::MustacheComment { value } => self.mustache_comment(node, self.text(value)),
                Kind::Comment { value } => {
                    self.token("<!--");
                    self.verbatim(self.text(value));
                    self.token("-->");
                }
                Kind::Doctype => self.ignored(node),
                Kind::FrontMatter => self.print_front_matter(self.front_matter),
                _ => {}
            }
        }
    }

    fn mustache_comment(&mut self, node: Node, value: &[u8]) {
        let is_tilde = |at: Option<usize>| at.and_then(|at| self.source.get(at)) == Some(&b'~');
        let strips_left = is_tilde(Some(node.start as usize + 2));
        let strips_right = is_tilde((node.end as usize).checked_sub(3));
        // Prettier only looks for the first. Without dashes, the others are read as a comment that ends at `--}}`, and
        // as one that strips what follows it.
        let needs_dashes = strings::contains(value, b"}}")
            || value.starts_with(b"--")
            || (value.ends_with(b"~") && !strips_right);
        let dashes = if needs_dashes { "--" } else { "" };
        self.token(if strips_left { "{{~!" } else { "{{!" });
        self.token(dashes);
        self.verbatim(value);
        self.token(dashes);
        self.token(if strips_right { "~}}" } else { "}}" });
    }

    /// Prettier's `printEmbedFrontMatter`, or `printFrontMatter` where that does not apply.
    fn print_front_matter(&mut self, raw: &[u8]) {
        let formatted = crate::front_matter::parse(raw).and_then(|front_matter| {
            if crate::front_matter::has_indented_delimiter(raw)
                || matches!(
                    self.options.embedded_language_formatting,
                    EmbeddedLanguageFormatting::Off
                )
            {
                return None;
            }
            let language = &raw[front_matter.explicit_language.0..front_matter.explicit_language.1];
            let is_toml = language == b"toml" || (language.is_empty() && raw.starts_with(b"+++"));
            let is_yaml = language == b"yaml" || (language.is_empty() && !is_toml);
            let value =
                match strings::trim_js_whitespace(&raw[front_matter.value.0..front_matter.value.1])
                {
                    b"" if is_yaml || is_toml => Doc::EMPTY,
                    value if is_yaml => crate::yaml::document(value, self.options)
                        .and_then(doc::text_to_doc)
                        .ok()?,
                    _ => return None,
                };
            Some((language, value))
        });
        let Some((language, value)) = formatted else {
            return self.verbatim(raw);
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
    fn embedded_style_sheet(
        &self,
        attributes: &[NodeId],
        children: &[NodeId],
    ) -> Option<Doc<'static>> {
        let [child] = children else {
            return None;
        };
        let Kind::Text { chars } = self.tree.kind(*child) else {
            return None;
        };
        if matches!(
            self.options.embedded_language_formatting,
            EmbeddedLanguageFormatting::Off
        ) {
            return None;
        }
        let language = attributes
            .iter()
            .find_map(|attribute| match self.tree.kind(*attribute) {
                Kind::Attr { name, value } if self.text(name) == b"lang" => Some(value),
                _ => None,
            });
        if let Some(language) = language
            && !matches!(self.tree.kind(language), Kind::Text { chars } if matches!(self.text(chars), b"" | b"css"))
        {
            return None;
        }
        let document =
            crate::css::document(self.text(chars), crate::css::Parser::Css, self.options).ok()?;
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
        let (tag, attributes, children) =
            (self.text(tag), self.list(attributes), self.list(children));
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

        // Prettier wraps the text of the first two like any other, which joins the lines.
        let is_raw_text = match tag == b"style" {
            true => self.has_mustache_that_counts_in_style(children),
            false => {
                (tag.eq_ignore_ascii_case(b"script") || tag.eq_ignore_ascii_case(b"textarea"))
                    && !self.are_white_space(children)
            }
        };
        let is_style = tag == b"style" && !is_raw_text;
        let keeps_white_space = is_raw_text || tag.eq_ignore_ascii_case(b"pre");
        let was_white_space_sensitive = self.is_white_space_sensitive;
        self.is_white_space_sensitive |= is_raw_text;
        self.pre_depth += usize::from(keeps_white_space);
        let is_empty = children.is_empty()
            || ((!self.is_white_space_sensitive || is_style) && self.are_white_space(children));
        if is_empty {
            // Nothing.
        } else if is_style || !self.is_white_space_sensitive {
            self.start_indent();
            self.out.line(Line::Soft);
            match is_style
                .then(|| self.embedded_style_sheet(attributes, children))
                .flatten()
            {
                Some(style_sheet) => self.out.document(&style_sheet),
                None => self.children(
                    children,
                    if is_style {
                        Parent::Style
                    } else {
                        Parent::Element
                    },
                    None,
                ),
            }
            self.out.end_indent();
            self.out.line(Line::Soft);
        } else {
            self.start_indent();
            self.start_group();
            self.children(children, Parent::Element, None);
            self.out.end_group();
            self.out.end_indent();
        }
        self.pre_depth -= usize::from(keeps_white_space);
        self.is_white_space_sensitive = was_white_space_sensitive;
        self.token("</");
        self.out.text(tag);
        self.token(">");
    }

    /// Whether `children`, of a `<style>`, have an escaped mustache, which Prettier prints without its backslash, or
    /// white space next to a mustache, which it does not print.
    fn has_mustache_that_counts_in_style(&self, children: &[NodeId]) -> bool {
        children.iter().enumerate().any(|(index, child)| {
            let Kind::Text { chars } = self.tree.kind(*child) else {
                return false;
            };
            let chars = self.text(chars);
            strings::contains(chars, b"{{")
                || (index > 0 && chars.trim_ascii_start().len() < chars.len())
                || (index + 1 < children.len() && chars.trim_ascii_end().len() < chars.len())
        })
    }

    /// An attribute, a modifier or a comment in a tag.
    fn attribute(&mut self, id: NodeId) {
        let node = self.tree.node(id);
        match node.kind {
            _ if node.is_as_written => self.ignored(node),
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
            Kind::Text { chars } if chars.is_empty() && node.start == node.end => {
                return self.out.text(name);
            }
            Kind::Text { .. } => self.preferred_quote_of(&[value]),
            Kind::Concat { parts } => self.preferred_quote_of(self.list(parts)),
            _ => "",
        };
        let escapes = match quote.as_bytes() {
            [quote, ..] => Escapes::MustachesAndQuote(*quote),
            [] => Escapes::Mustaches,
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
            Kind::Text { chars } => {
                self.text_in_attribute(self.text(chars), is_class, Neighbors::default(), escapes)
            }
            Kind::Concat { parts } => {
                let parts = self.list(parts);
                let tree = self.tree;
                let is_mustache = |index: Option<usize>| {
                    index
                        .and_then(|index| parts.get(index))
                        .is_some_and(|part| matches!(tree.kind(*part), Kind::Mustache { .. }))
                };
                for (index, part) in parts.iter().enumerate() {
                    match self.tree.kind(*part) {
                        Kind::Text { chars } => {
                            let neighbors = Neighbors {
                                follows_mustache: is_mustache(index.checked_sub(1)),
                                precedes_mustache: is_mustache(Some(index + 1)),
                            };
                            self.text_in_attribute(self.text(chars), is_class, neighbors, escapes);
                        }
                        Kind::Mustache { .. } => self.mustache_node(self.tree.node(*part), true),
                        _ => {}
                    }
                }
            }
            Kind::Mustache { .. } => self.mustache_node(node, false),
            _ => {}
        }
        if is_grouped {
            self.out.end_indent();
            self.out.end_group();
        }
        self.token(quote);
    }

    fn text_in_attribute(
        &mut self,
        chars: &[u8],
        is_class: bool,
        neighbors: Neighbors,
        escapes: Escapes,
    ) {
        let Neighbors {
            follows_mustache,
            precedes_mustache,
        } = neighbors;
        // One more, or it would escape the mustache. Prettier only does that for the text in an element.
        let needs_backslash = precedes_mustache && chars.ends_with(b"\\");
        if !is_class {
            self.with_literal_lines(chars, escapes);
            if needs_backslash {
                self.token("\\");
            }
            return;
        }
        // Prettier goes by what JavaScript takes for white space, some of which can be in the name of a class.
        let mut classes = chars.trim_ascii();
        if follows_mustache && chars.trim_ascii_start().len() < chars.len() {
            self.out.line(Line::Space);
        }
        let has_classes = !classes.is_empty();
        // `.replaceAll(/\s+/g, " ")`
        while !classes.is_empty() {
            let len = strings::index_of_any(classes, HTML_WHITE_SPACE).unwrap_or(classes.len());
            self.with_escapes(&classes[..len], escapes);
            classes = &classes[len..];
            if !classes.is_empty() {
                self.token(" ");
                classes = classes.trim_ascii_start();
            }
        }
        if needs_backslash {
            self.token("\\");
        }
        if precedes_mustache && has_classes && chars.trim_ascii_end().len() < chars.len() {
            self.out.line(Line::Space);
        }
    }

    // ───────────────────────────── text ─────────────────────────────

    fn text_node(&mut self, chars: &[u8], siblings: &[NodeId], index: usize, parent: Parent) {
        if parent == Parent::Style {
            return self.text_in_style(chars);
        }
        // Prettier only keeps what is right in a `<pre>` as it is, and prints an escaped mustache without its backslash.
        if self.pre_depth > 0 {
            return self.with_literal_lines(chars, Escapes::Mustaches);
        }
        let (is_first, is_last) = (index == 0, index + 1 == siblings.len());
        let is_white_space_only = chars.trim_ascii_start().is_empty();

        if self.is_white_space_sensitive {
            let trims_leading = is_first && parent == Parent::Template;
            let trims_trailing = is_last && parent == Parent::Template;
            if is_white_space_only {
                if !trims_leading && !trims_trailing {
                    self.breaks(chars, is_last);
                }
                return;
            }
            let without_leading = chars.trim_ascii_start();
            let words = without_leading.trim_ascii_end();
            let leading = &chars[..chars.len() - without_leading.len()];
            let trailing = &without_leading[words.len()..];
            if !leading.is_empty() {
                self.breaks(leading, false);
            }
            self.fill(words, Blanks::default());
            if !trailing.is_empty() && !trims_trailing {
                self.breaks(trailing, is_last);
            }
            return;
        }

        if (is_first || is_last) && is_white_space_only {
            return;
        }
        let kind_at = |index: Option<usize>| {
            index
                .and_then(|index| siblings.get(index))
                .map_or(Kind::Nothing, |node| self.tree.kind(*node))
        };
        let (previous, next) = (kind_at(index.checked_sub(1)), kind_at(Some(index + 1)));
        let is_block_or_element =
            |kind: Kind| matches!(kind, Kind::BlockStatement { .. } | Kind::Element { .. });
        // A text next to a text is an escaped mustache. Prettier joins the two.
        let is_mustache = |kind: Kind| matches!(kind, Kind::Mustache { .. } | Kind::Text { .. });

        let line_breaks = strings::count_char(chars, b'\n');
        // `countLeadingNewLines`, `countTrailingNewLines`
        let mut leading_line_breaks = strings::count_char(
            &chars[..chars.len() - strings::trim_js_whitespace_start(chars).len()],
            b'\n',
        );
        let mut trailing_line_breaks = strings::count_char(
            &chars[strings::trim_js_whitespace_end(chars).len()..],
            b'\n',
        );
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

        let words = chars.trim_ascii();
        self.hard_lines(leading_line_breaks);
        if words.is_empty() {
            // The blank before it is taken for one behind it.
            let before = leading_space && trailing_space;
            self.fill(
                b"",
                Blanks {
                    before,
                    behind: false,
                },
            );
        } else {
            let has_leading = chars.first().is_some_and(u8::is_ascii_whitespace);
            let has_trailing = chars.last().is_some_and(u8::is_ascii_whitespace);
            self.fill(
                words,
                Blanks {
                    before: has_leading && leading_space,
                    behind: has_trailing && trailing_space,
                },
            );
        }
        self.hard_lines(trailing_line_breaks);
    }

    /// A text in `<style>` that is not formatted as a style sheet.
    fn text_in_style(&mut self, chars: &[u8]) {
        let text = &chars[chars.iter().take_while(|byte| **byte == b'\n').count()..];
        let text = text.trim_ascii_end();
        // `htmlWhitespace.dedentString(text)`
        let mut min_indentation = usize::MAX;
        for line in strings::split(text, b"\n") {
            let indentation = line.len() - line.trim_ascii_start().len();
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
            self.out
                .text(line.get(min_indentation..).unwrap_or_default());
        }
    }

    // ───────────────────────────── blocks ─────────────────────────────

    /// The name of the helper, if it is a variable.
    fn head_name(&self, call: Call) -> Option<&'a [u8]> {
        match self.tree.kind(call.path) {
            Kind::Path {
                head: Head::Var,
                name,
                ..
            } => Some(self.text(name)),
            _ => None,
        }
    }

    /// `isElseIfBlock`, for a node that is all that follows `{{else}}` in the block `outer`.
    fn is_else_if(&self, id: NodeId, outer: (Call, u8)) -> bool {
        let node = self.tree.node(id);
        let Kind::BlockStatement {
            call,
            inverse,
            strip,
            ..
        } = node.kind
        else {
            return false;
        };
        // Of `{{else}}{{~#if a}}..{{/if}}`, what the inner tags strip would be lost. Prettier makes `{{else if a}}` of it.
        let mut strips = (strip & !ast::INVERSE_OPEN & !ast::INVERSE_CLOSE)
            | (outer.1 & (ast::INVERSE_CLOSE | ast::CLOSE_OPEN));
        // Handlebars takes the `~` of `{{~else if b}}` in a block that is written `{{else if a}}` for one of `{{~/if}}` too.
        if matches!(self.body_of(inverse).0, [next] if matches!(self.tree.kind(*next), Kind::BlockStatement { strip, .. } if strip & ast::CHAINED != 0))
        {
            strips |= strip & ast::INVERSE_OPEN;
        }
        if node.is_as_written || (strip & ast::CHAINED == 0 && strips != 0) {
            return false;
        }
        match self.head_name(call) {
            Some(b"if") => true,
            Some(name) => self.head_name(outer.0) == Some(name),
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
            self.verbatim(self.text(*name));
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
                // Prettier prints the first name of it, as the tree has it.
                self.expression(call.path, false);
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
        // Prettier leaves white space out wherever it is.
        let is_blank = self.are_white_space(body) && (self.pre_depth == 0 || body.is_empty());
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
            let is_chained = matches!(body, [block] if self.is_else_if(*block, (call, strip)));
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
    fn mustache_node(&mut self, node: Node, is_in_quotes: bool) {
        let Kind::Mustache {
            call,
            is_trusting,
            strip,
        } = node.kind
        else {
            return;
        };
        if node.is_as_written {
            return self.ignored(node);
        }
        self.start_group();
        // Prettier prints `{{{~a~}}}`, which cannot be read.
        self.token(match (is_trusting, strip & ast::OPEN_OPEN != 0) {
            (true, true) => "{{~{",
            (true, false) => "{{{",
            (false, true) => "{{~",
            (false, false) => "{{",
        });
        self.path_and_params(call, is_in_quotes);
        self.token(match (is_trusting, strip & ast::OPEN_CLOSE != 0) {
            (true, true) => "}~}}",
            (true, false) => "}}}",
            (false, true) => "~}}",
            (false, false) => "}}",
        });
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
                self.verbatim(self.text(key));
                self.token("=");
                self.expression(value, false);
            }
        }
    }

    /// `needs_opposite_quote`: Prettier's `needsOppositeQuote`, if it is a string.
    fn expression(&mut self, id: NodeId, needs_opposite_quote: bool) {
        let node = self.tree.node(id);
        match node.kind {
            _ if node.is_as_written => self.ignored(node),
            Kind::SubExpression { .. } if !self.stack.has_room() => {}
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
            Kind::Path { head, name, tail } => {
                let name = if head == Head::This {
                    &b"this"[..]
                } else {
                    self.text(name)
                };
                match self.is_read_as_printed(head, name, tail) {
                    true => self.path(name, tail),
                    false => self.ignored(node),
                }
            }
            // The backslash would escape the quote.
            Kind::String { value } if self.text(value).ends_with(b"\\") => self.ignored(node),
            Kind::String { value } => {
                let mut value = self.text(value);
                let (double, single) = (
                    strings::count_char(value, b'"'),
                    strings::count_char(value, b'\''),
                );
                let quote =
                    preferred_quote(double, single, self.single_quote != needs_opposite_quote);
                self.token(quote);
                while let Some(at) = strings::index_of_char_usize(value, quote.as_bytes()[0]) {
                    self.verbatim(&value[..at]);
                    self.token("\\");
                    self.token(quote);
                    value = &value[at + 1..];
                }
                self.verbatim(value);
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
        let is_as_printed = token.len() <= 15
            && token.iter().all(u8::is_ascii_digit)
            && (token.len() == 1 || token[0] != b'0');
        if is_as_printed {
            return self.out.text(token);
        }
        let value = std::str::from_utf8(token)
            .ok()
            .and_then(|it| it.parse::<f64>().ok())
            .unwrap_or(f64::NAN);
        let printed = bun_sema::atom::number_to_string(value);
        // The lexer knows neither exponents nor `Infinity`, which Prettier prints.
        let is_number = (printed.iter()).all(|byte| matches!(byte, b'0'..=b'9' | b'-' | b'.'));
        self.out.text(if is_number { &printed[..] } else { token });
    }

    /// Whether what `path` prints is read as the same path. What was in brackets need not be: `[this]`, `[@a]`, `[true]`,
    /// `[-1]`, `[else]`, `[a]b]`.
    fn is_read_as_printed(&self, kind: Head, head: &[u8], tail: Range) -> bool {
        let tail = self.tree.names(tail);
        if kind == Head::Var && (head == b"this" || head.starts_with(b"@")) {
            return false;
        }
        if tail.is_empty() && strings::contains_char(head, b'/') {
            let names = head.strip_prefix(b"@").unwrap_or(head);
            return strings::split(names, b"/")
                .all(|name| !name.is_empty() && id_len(name) == name.len() && name != b"this");
        }
        let is_literal =
            matches!(head, b"true" | b"false" | b"null" | b"undefined") || is_negative_number(head);
        head != b"else"
            && !(tail.is_empty() && is_literal)
            && is_part_read_as_printed(head, true)
            && (tail.iter()).all(|part| is_part_read_as_printed(self.text(*part), false))
    }

    /// `printPathExpression`
    fn path(&mut self, head: &[u8], tail: Range) {
        let tail = self.tree.names(tail);
        if tail.is_empty() && strings::contains_char(head, b'/') {
            return self.verbatim(head);
        }
        self.path_part(head, true);
        for part in tail {
            self.token(".");
            self.path_part(self.text(*part), false);
        }
    }

    fn path_part(&mut self, part: &[u8], is_first: bool) {
        let needs_brackets = needs_brackets(part, is_first);
        if needs_brackets {
            self.token("[");
        }
        self.verbatim(part);
        if needs_brackets {
            self.token("]");
        }
    }
}

/// `isPathExpressionPartNeedBrackets`
fn needs_brackets(part: &[u8], is_first: bool) -> bool {
    !(is_first && part.starts_with(b"@"))
        && ((!is_first && matches!(part, b"true" | b"false" | b"null" | b"undefined"))
            || part.first().is_some_and(u8::is_ascii_digit)
            // `/[\s!"#%&'()*+,./;<=>@[\\\]^`{|}~]/`: all that cannot be in an `ID`.
            || id_len(part) != part.len())
}

fn is_part_read_as_printed(part: &[u8], is_first: bool) -> bool {
    match needs_brackets(part, is_first) {
        true => {
            strings::index_of_any(part, b"]\\\n\r").is_none()
                && !strings::contains(part, b"\xE2\x80\xA8")
                && !strings::contains(part, b"\xE2\x80\xA9")
        }
        false if is_first => {
            let name = part.strip_prefix(b"@").unwrap_or(part);
            !name.is_empty() && id_len(name) == name.len()
        }
        false => !part.is_empty() && part != b"this" && !is_negative_number(part),
    }
}

/// `-1`, which is a name only in brackets.
fn is_negative_number(name: &[u8]) -> bool {
    matches!(name, [b'-', digits @ ..] if !digits.is_empty() && digits.iter().all(u8::is_ascii_digit))
}

/// `getPreferredQuote`, for a text that has so many quotes.
fn preferred_quote(double: usize, single: usize, prefers_single: bool) -> &'static str {
    let is_single = if prefers_single {
        single <= double
    } else {
        double > single
    };
    if is_single { "'" } else { "\"" }
}
