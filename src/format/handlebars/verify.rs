//! `--debug-check`: the formatted template says what the template says.
//!
//! Both are parsed, and each tree is written down without what the printer is free to change: how the words of a text are
//! spread over lines, quotes, how a number is written, `{{else}}{{#if a}}` for `{{else if a}}`, all but the letters of a
//! style sheet, the front matter. What is written down has to be the same.

use super::ast::{self, Call, Kind, NOTHING, Node, NodeId, Range, Text, Tree};
use crate::stack::Stack;
use bun_core::strings;

const HTML_WHITE_SPACE: &[u8] = b"\t\n\x0C\r ";

pub(super) struct Writer<'a> {
    pub(super) tree: &'a Tree,
    pub(super) source: &'a [u8],
    pub(super) is_white_space_sensitive: bool,
    pub(super) out: Vec<u8>,
    /// The texts that follow each other, as one.
    pub(super) run: Vec<u8>,
    /// How many elements are around in which all white space counts.
    pub(super) pre_depth: usize,
    pub(super) stack: Stack,
}

impl<'a> Writer<'a> {
    fn text(&self, text: Text) -> &'a [u8] {
        self.tree.text(self.source, text)
    }

    fn list(&self, range: Range) -> &'a [NodeId] {
        self.tree.list(range)
    }

    /// `mark` says what comes, a NUL ends it.
    fn field(&mut self, mark: u8, bytes: &[u8]) {
        self.out.push(mark);
        self.out.extend_from_slice(bytes);
        self.out.push(0);
    }

    fn as_written(&mut self, node: Node) {
        let text = self.source.get(node.start as usize..node.end as usize);
        self.field(b'W', text.unwrap_or_default());
    }

    fn names(&mut self, names: Range) {
        for name in self.tree.names(names) {
            self.field(b'|', self.text(*name));
        }
    }

    fn words(&mut self, text: &[u8]) {
        let mut rest = text.trim_ascii_start();
        while !rest.is_empty() {
            let len = strings::index_of_any(rest, HTML_WHITE_SPACE).unwrap_or(rest.len());
            self.field(b'w', &rest[..len]);
            rest = rest[len..].trim_ascii_start();
        }
    }

    fn is_white_space(&self, nodes: &[NodeId]) -> bool {
        nodes.iter().all(|node| matches!(self.tree.kind(*node), Kind::Text { chars } if self.text(chars).trim_ascii_start().is_empty()))
    }

    pub(super) fn template(&mut self, template: NodeId) {
        if let Kind::Template { body } = self.tree.kind(template) {
            self.children(self.list(body), false);
        }
    }

    /// `is_in_style`: the white space between a text and what is no text counts.
    fn children(&mut self, nodes: &'a [NodeId], is_in_style: bool) {
        if !self.stack.has_room() {
            return;
        }
        let mut index = 0;
        while let Some(&id) = nodes.get(index) {
            let node = self.tree.node(id);
            let Kind::Text { .. } = node.kind else {
                self.child(node);
                index += 1;
                continue;
            };
            let first = index;
            let mut run = std::mem::take(&mut self.run);
            run.clear();
            while let Some(Kind::Text { chars }) = nodes.get(index).map(|it| self.tree.kind(*it)) {
                run.extend_from_slice(self.text(chars));
                index += 1;
            }
            if self.pre_depth > 0 {
                self.field(b't', &run);
            } else {
                if is_in_style && first > 0 && run.trim_ascii_start().len() < run.len() {
                    self.out.push(b' ');
                }
                self.words(&run);
                if is_in_style && index < nodes.len() && run.trim_ascii_end().len() < run.len() {
                    self.out.push(b' ');
                }
            }
            self.run = run;
        }
    }

    fn child(&mut self, node: Node) {
        match node.kind {
            _ if node.is_as_written => self.as_written(node),
            Kind::Element { .. } => self.element(node),
            Kind::BlockStatement { .. } => self.block(node, false),
            Kind::Mustache { .. } => self.mustache(node),
            Kind::MustacheComment { value } => self.mustache_comment(node, value),
            Kind::Comment { value } => self.field(b'c', self.text(value)),
            Kind::Doctype => self.as_written(node),
            _ => {}
        }
    }

    fn mustache_comment(&mut self, node: Node, value: Text) {
        let is_tilde = |at: Option<usize>| at.and_then(|at| self.source.get(at)) == Some(&b'~');
        let strips = [
            is_tilde(Some(node.start as usize + 2)),
            is_tilde((node.end as usize).checked_sub(3)),
        ];
        self.out.extend(strips.map(u8::from));
        self.field(b'!', self.text(value));
    }

    fn element(&mut self, node: Node) {
        let Kind::Element {
            tag,
            attributes,
            block_params,
            children,
            ..
        } = node.kind
        else {
            return;
        };
        let (tag, children) = (self.text(tag), self.list(children));
        self.field(b'<', tag);
        for &attribute in self.list(attributes) {
            self.attribute(attribute);
        }
        self.names(block_params);
        self.out.push(b'>');
        let is = |name: &[u8]| tag.eq_ignore_ascii_case(name);
        let keeps_white_space = !self.is_white_space(children)
            && (is(b"script") || is(b"textarea") || (is(b"pre") && self.is_white_space_sensitive));
        self.pre_depth += usize::from(keeps_white_space);
        match (tag == b"style", children) {
            // It may have been formatted.
            (true, [only]) if matches!(self.tree.kind(*only), Kind::Text { .. }) => {
                if let Kind::Text { chars } = self.tree.kind(*only) {
                    let letters = self.text(chars).iter();
                    let letters = letters.filter(|it| it.is_ascii_alphabetic() || !it.is_ascii());
                    self.out.extend(letters.map(u8::to_ascii_lowercase));
                }
            }
            (is_style, _) => self.children(children, is_style),
        }
        self.pre_depth -= usize::from(keeps_white_space);
        self.out.push(b'/');
    }

    fn attribute(&mut self, id: NodeId) {
        let node = self.tree.node(id);
        match node.kind {
            _ if node.is_as_written => self.as_written(node),
            Kind::Attr { name, value } => {
                let name = self.text(name);
                self.field(b'@', name);
                let is_class = name.eq_ignore_ascii_case(b"class");
                let value = self.tree.node(value);
                match value.kind {
                    Kind::Text { chars } if chars.is_empty() && value.start == value.end => {}
                    Kind::Concat { parts } => {
                        self.out.push(b'=');
                        for &part in self.list(parts) {
                            self.part_of_value(self.tree.node(part), is_class);
                        }
                    }
                    _ => {
                        self.out.push(b'=');
                        self.part_of_value(value, is_class);
                    }
                }
            }
            Kind::ElementModifier { call } => {
                self.out.push(b'M');
                self.call(call);
            }
            Kind::MustacheComment { value } => self.mustache_comment(node, value),
            _ => {}
        }
    }

    fn part_of_value(&mut self, node: Node, is_class: bool) {
        let Kind::Text { chars } = node.kind else {
            return self.mustache(node);
        };
        let mut rest = self.text(chars);
        if is_class {
            return self.words(rest);
        }
        // The quote that the value is in is written as an entity.
        self.out.push(b't');
        while let Some(at) = strings::index_of_char_usize(rest, b'&') {
            self.out.extend_from_slice(&rest[..at]);
            rest = &rest[at..];
            let (character, len) = match rest {
                _ if rest.starts_with(b"&quot;") => (b'"', 6),
                _ if rest.starts_with(b"&apos;") => (b'\'', 6),
                _ => (b'&', 1),
            };
            self.out.push(character);
            rest = &rest[len..];
        }
        self.out.extend_from_slice(rest);
        self.out.push(0);
    }

    fn body_of(&self, block: NodeId) -> (&'a [NodeId], Range) {
        match self.tree.kind(block) {
            Kind::Block { body, block_params } => (self.list(body), block_params),
            _ => (&[], Range::default()),
        }
    }

    /// `is_all_of_inverse`: nothing else but white space follows the `{{else}}` of the block that it is in. Then it makes no difference
    /// whether it is written `{{else if a}}` or `{{else}}{{#if a}}..{{/if}}`, and of two tags with nothing between them,
    /// what the first strips on its right and the second on its left is nothing.
    fn block(&mut self, node: Node, is_all_of_inverse: bool) {
        let Kind::BlockStatement {
            call,
            program,
            inverse,
            strip,
        } = node.kind
        else {
            return;
        };
        if !self.stack.has_room() {
            return;
        }
        let (body, block_params) = self.body_of(program);
        let (inverse_body, _) = self.body_of(inverse);
        let mut counted = inverse_body
            .iter()
            .filter(|id| self.pre_depth > 0 || !self.is_white_space(std::slice::from_ref(*id)));
        let only = match (counted.next(), counted.next()) {
            (Some(only), None) => Some(self.tree.node(*only))
                .filter(|it| matches!(it.kind, Kind::BlockStatement { .. }) && !it.is_as_written),
            _ => None,
        };
        let mut strip = strip & !ast::CHAINED;
        if only.is_some() {
            strip &= !(ast::INVERSE_CLOSE | ast::CLOSE_OPEN);
        }
        if is_all_of_inverse {
            strip &= !(ast::OPEN_OPEN | ast::CLOSE_CLOSE);
        }
        self.out.extend([b'#', strip]);
        self.call(call);
        self.names(block_params);
        self.out.push(b'>');
        self.children(body, false);
        if inverse != NOTHING {
            self.out.push(b'^');
            match only {
                Some(only) => self.block(only, true),
                None => self.children(inverse_body, false),
            }
        }
        self.out.push(b'/');
    }

    fn mustache(&mut self, node: Node) {
        match node.kind {
            _ if node.is_as_written => self.as_written(node),
            Kind::Mustache {
                call,
                is_trusting,
                strip,
            } => {
                self.out.extend([b'{', u8::from(is_trusting), strip]);
                self.call(call);
            }
            _ => {}
        }
    }

    fn call(&mut self, call: Call) {
        self.expression(call.path);
        for &param in self.list(call.params) {
            self.out.push(b',');
            self.expression(param);
        }
        for &pair in self.list(call.pairs) {
            if let Kind::HashPair { key, value } = self.tree.kind(pair) {
                self.field(b'=', self.text(key));
                self.expression(value);
            }
        }
        self.out.push(b'}');
    }

    fn expression(&mut self, id: NodeId) {
        let node = self.tree.node(id);
        match node.kind {
            _ if node.is_as_written => self.as_written(node),
            Kind::SubExpression { .. } if !self.stack.has_room() => {}
            Kind::SubExpression { call } => {
                self.out.push(b'(');
                self.call(call);
            }
            Kind::Path { head, name, tail } => {
                self.out.push(head as u8);
                self.field(b'p', self.text(name));
                self.names(tail);
            }
            Kind::String { value } => self.field(b's', self.text(value)),
            Kind::Number { token } => {
                let value = std::str::from_utf8(self.text(token)).ok();
                let value = value
                    .and_then(|it| it.parse::<f64>().ok())
                    .unwrap_or(f64::NAN);
                self.field(b'n', &value.to_bits().to_le_bytes());
            }
            Kind::Boolean(value) => self.out.extend([b'b', u8::from(value)]),
            Kind::Undefined => self.out.push(b'u'),
            Kind::Null => self.out.push(b'0'),
            _ => {}
        }
    }
}
