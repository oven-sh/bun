//! `yaml` 2.9: `parse/lexer.js`. All of the text is there from the start, and its line breaks are `\n`.

use crate::text::BOM;
use bun_core::strings;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum LexemeKind {
    /// `\x02`: the start of a document.
    Document,
    /// `\x18`: a flow collection ends where it should not.
    FlowEnd,
    /// `\x1f`: what follows is the text of a scalar.
    Scalar,
    Text,
}

#[derive(Debug, Copy, Clone)]
pub(crate) struct Lexeme {
    pub(crate) kind: LexemeKind,
    pub(crate) start: u32,
    pub(crate) end: u32,
}

#[derive(Copy, Clone)]
enum State {
    Stream,
    BlockStart,
    Doc,
    Flow,
}

fn is_empty(ch: Option<u8>) -> bool {
    matches!(ch, None | Some(b' ' | b'\n' | b'\r' | b'\t'))
}

fn is_flow_indicator(ch: Option<u8>) -> bool {
    matches!(ch, Some(b',' | b'[' | b']' | b'{' | b'}'))
}

fn is_not_anchor_char(ch: Option<u8>) -> bool {
    matches!(
        ch,
        None | Some(b' ' | b',' | b'[' | b']' | b'{' | b'}' | b'\n' | b'\r' | b'\t')
    )
}

fn is_tag_char(ch: u8) -> bool {
    ch.is_ascii_alphanumeric() || strings::contains_char(b"-#;/?:@&=+$_.!~*'()", ch)
}

struct Lexer<'a> {
    buffer: &'a [u8],
    out: Vec<Lexeme>,
    block_scalar_indent: i32,
    block_scalar_keep: bool,
    flow_key: bool,
    flow_level: u32,
    indent_next: usize,
    indent_value: usize,
    /// Where the line ends that `get_line` has been asked for last.
    line_end_pos: Option<usize>,
    pos: usize,
}

impl<'a> Lexer<'a> {
    fn at(&self, index: usize) -> Option<u8> {
        self.buffer.get(index).copied()
    }

    fn char_at(&self, n: usize) -> Option<u8> {
        self.at(self.pos + n)
    }

    fn marker(&mut self, kind: LexemeKind) {
        let pos = self.pos as u32;
        self.out.push(Lexeme {
            kind,
            start: pos,
            end: pos,
        });
    }

    fn at_line_end(&self) -> bool {
        let mut i = self.pos;
        while matches!(self.at(i), Some(b' ' | b'\t')) {
            i += 1;
        }
        matches!(self.at(i), None | Some(b'#' | b'\n'))
    }

    /// Where the scalar goes on in the line that starts at `offset`, if it does.
    fn continue_scalar(&self, offset: usize) -> Option<usize> {
        if self.indent_next > 0 {
            let mut indent = 0;
            while self.at(offset + indent) == Some(b' ') {
                indent += 1;
            }
            return (self.at(offset + indent) == Some(b'\n') || indent >= self.indent_next)
                .then_some(offset + indent);
        }
        let rest = self.buffer.get(offset..).unwrap_or_default();
        if (rest.starts_with(b"---") || rest.starts_with(b"...")) && is_empty(rest.get(3).copied())
        {
            return None;
        }
        Some(offset)
    }

    fn get_line(&mut self) -> &'a [u8] {
        let end = match self.line_end_pos {
            Some(end) if end >= self.pos => end,
            _ => {
                let rest = self.buffer.get(self.pos..).unwrap_or_default();
                self.pos + strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len())
            }
        };
        self.line_end_pos = Some(end);
        self.buffer.get(self.pos..end).unwrap_or_default()
    }

    fn index_of(&self, ch: u8, from: usize) -> Option<usize> {
        strings::index_of_char_usize(self.buffer.get(from..)?, ch).map(|at| from + at)
    }

    fn push_count(&mut self, n: usize) -> usize {
        if n > 0 {
            self.out.push(Lexeme {
                kind: LexemeKind::Text,
                start: self.pos as u32,
                end: (self.pos + n) as u32,
            });
            self.pos += n;
        }
        n
    }

    fn push_to_index(&mut self, i: usize, allow_empty: bool) -> usize {
        let i = i.min(self.buffer.len());
        if i > self.pos {
            return self.push_count(i - self.pos);
        }
        if allow_empty {
            self.marker(LexemeKind::Text);
        }
        0
    }

    fn push_newline(&mut self) -> usize {
        match self.char_at(0) {
            Some(b'\n') => self.push_count(1),
            _ => 0,
        }
    }

    fn push_spaces(&mut self, allow_tabs: bool) -> usize {
        let mut i = self.pos;
        while matches!(self.at(i), Some(ch) if ch == b' ' || (allow_tabs && ch == b'\t')) {
            i += 1;
        }
        self.push_count(i - self.pos)
    }

    fn push_until(&mut self, test: impl Fn(Option<u8>) -> bool) -> usize {
        let mut i = self.pos;
        while !test(self.at(i)) {
            i += 1;
        }
        self.push_to_index(i, false)
    }

    fn push_tag(&mut self) -> usize {
        if self.char_at(1) == Some(b'<') {
            let mut i = self.pos + 2;
            while !is_empty(self.at(i)) && self.at(i) != Some(b'>') {
                i += 1;
            }
            let end = if self.at(i) == Some(b'>') { i + 1 } else { i };
            return self.push_to_index(end, false);
        }
        let mut i = self.pos + 1;
        while let Some(ch) = self.at(i) {
            let is_hex = |ch: Option<u8>| ch.is_some_and(|it| it.is_ascii_hexdigit());
            if is_tag_char(ch) {
                i += 1;
            } else if ch == b'%' && is_hex(self.at(i + 1)) && is_hex(self.at(i + 2)) {
                i += 3;
            } else {
                break;
            }
        }
        self.push_to_index(i, false)
    }

    fn push_indicators(&mut self) -> usize {
        let mut n = 0;
        loop {
            match self.char_at(0) {
                Some(b'!') => {
                    n += self.push_tag();
                    n += self.push_spaces(true);
                }
                Some(b'&') => {
                    n += self.push_until(is_not_anchor_char);
                    n += self.push_spaces(true);
                }
                Some(b'-' | b'?' | b':') => {
                    let in_flow = self.flow_level > 0;
                    let ch1 = self.char_at(1);
                    if !(is_empty(ch1) || (in_flow && is_flow_indicator(ch1))) {
                        return n;
                    }
                    if !in_flow {
                        self.indent_next = self.indent_value + 1;
                    } else {
                        self.flow_key = false;
                    }
                    n += self.push_count(1);
                    n += self.push_spaces(true);
                }
                _ => return n,
            }
        }
    }

    fn parse_stream(&mut self) -> State {
        let mut line = self.get_line();
        if let Some(rest) = line.strip_prefix(BOM) {
            self.push_count(BOM.len());
            line = rest;
        }
        if line.first() == Some(&b'%') {
            let mut dir_end = line.len();
            let mut from = 0;
            while let Some(at) = line
                .get(from..)
                .and_then(|rest| strings::index_of_char_usize(rest, b'#'))
            {
                let cs = from + at;
                if matches!(line[cs - 1], b' ' | b'\t') {
                    dir_end = cs - 1;
                    break;
                }
                from = cs + 1;
            }
            while matches!(line[dir_end - 1], b' ' | b'\t') {
                dir_end -= 1;
            }
            let n = self.push_count(dir_end) + self.push_spaces(true);
            self.push_count(line.len() - n);
            return State::Stream;
        }
        if self.at_line_end() {
            let sp = self.push_spaces(true);
            self.push_count(line.len() - sp);
            self.push_newline();
            return State::Stream;
        }
        self.marker(LexemeKind::Document);
        self.parse_line_start()
    }

    fn parse_line_start(&mut self) -> State {
        let rest = self.buffer.get(self.pos..).unwrap_or_default();
        let is_doc_start = rest.starts_with(b"---");
        if (is_doc_start || rest.starts_with(b"...")) && is_empty(rest.get(3).copied()) {
            self.push_count(3);
            self.indent_value = 0;
            self.indent_next = 0;
            return if is_doc_start {
                State::Doc
            } else {
                State::Stream
            };
        }
        self.indent_value = self.push_spaces(false);
        if self.indent_next > self.indent_value && !is_empty(self.char_at(1)) {
            self.indent_next = self.indent_value;
        }
        self.parse_block_start()
    }

    fn parse_block_start(&mut self) -> State {
        if matches!(self.char_at(0), Some(b'-' | b'?' | b':')) && is_empty(self.char_at(1)) {
            let n = self.push_count(1) + self.push_spaces(true);
            self.indent_next = self.indent_value + 1;
            self.indent_value += n;
            return State::BlockStart;
        }
        State::Doc
    }

    fn parse_document(&mut self) -> State {
        self.push_spaces(true);
        let line = self.get_line();
        let mut n = self.push_indicators();
        match line.get(n) {
            Some(b'#') => {
                self.push_count(line.len() - n);
                self.push_newline();
                self.parse_line_start()
            }
            None => {
                self.push_newline();
                self.parse_line_start()
            }
            Some(b'{' | b'[') => {
                self.push_count(1);
                self.flow_key = false;
                self.flow_level = 1;
                State::Flow
            }
            Some(b'}' | b']') => {
                self.push_count(1);
                State::Doc
            }
            Some(b'*') => {
                self.push_until(is_not_anchor_char);
                State::Doc
            }
            Some(b'"' | b'\'') => self.parse_quoted_scalar(),
            Some(b'|' | b'>') => {
                n += self.parse_block_scalar_header();
                n += self.push_spaces(true);
                self.push_count(line.len() - n);
                self.push_newline();
                self.parse_block_scalar()
            }
            Some(_) => self.parse_plain_scalar(),
        }
    }

    fn parse_flow_collection(&mut self) -> State {
        let mut indent = None;
        loop {
            let nl = self.push_newline();
            let mut sp = 0;
            if nl > 0 {
                sp = self.push_spaces(false);
                self.indent_value = sp;
                indent = Some(sp);
            }
            sp += self.push_spaces(true);
            if nl + sp == 0 {
                break;
            }
        }
        let line = self.get_line();
        if indent.is_some_and(|indent| indent < self.indent_next && line.first() != Some(&b'#'))
            || (indent == Some(0)
                && (line.starts_with(b"---") || line.starts_with(b"..."))
                && is_empty(line.get(3).copied()))
        {
            // The last `]` or `}` can be as far to the left as the first `[` or `{`.
            let at_flow_end_marker = indent.is_some_and(|indent| indent + 1 == self.indent_next)
                && self.flow_level == 1
                && matches!(line.first(), Some(b']' | b'}'));
            if !at_flow_end_marker {
                self.flow_level = 0;
                self.marker(LexemeKind::FlowEnd);
                return self.parse_line_start();
            }
        }
        let mut n = 0;
        while line.get(n) == Some(&b',') {
            n += self.push_count(1);
            n += self.push_spaces(true);
            self.flow_key = false;
        }
        n += self.push_indicators();
        match line.get(n) {
            None => State::Flow,
            Some(b'#') => {
                self.push_count(line.len() - n);
                State::Flow
            }
            Some(b'{' | b'[') => {
                self.push_count(1);
                self.flow_key = false;
                self.flow_level += 1;
                State::Flow
            }
            Some(b'}' | b']') => {
                self.push_count(1);
                self.flow_key = true;
                self.flow_level -= 1;
                if self.flow_level > 0 {
                    State::Flow
                } else {
                    State::Doc
                }
            }
            Some(b'*') => {
                self.push_until(is_not_anchor_char);
                State::Flow
            }
            Some(b'"' | b'\'') => {
                self.flow_key = true;
                self.parse_quoted_scalar()
            }
            Some(b':')
                if self.flow_key || is_empty(self.char_at(1)) || self.char_at(1) == Some(b',') =>
            {
                self.flow_key = false;
                self.push_count(1);
                self.push_spaces(true);
                State::Flow
            }
            Some(_) => {
                self.flow_key = false;
                self.parse_plain_scalar()
            }
        }
    }

    fn parse_quoted_scalar(&mut self) -> State {
        let quote = self.char_at(0).unwrap_or(b'"');
        let mut end = self.index_of(quote, self.pos + 1);
        if quote == b'\'' {
            while let Some(at) = end.filter(|&at| self.at(at + 1) == Some(b'\'')) {
                end = self.index_of(b'\'', at + 2);
            }
        } else {
            while let Some(at) = end {
                let backslashes = self.buffer[..at]
                    .iter()
                    .rev()
                    .take_while(|&&b| b == b'\\')
                    .count();
                if backslashes % 2 == 0 {
                    break;
                }
                end = self.index_of(b'"', at + 1);
            }
        }
        // Only the line breaks between the quotes count.
        let limit = end.unwrap_or(0);
        let newline_before_end = |from: usize| {
            strings::index_of_char_usize(self.buffer.get(from..limit)?, b'\n').map(|at| from + at)
        };
        let mut nl = newline_before_end(self.pos);
        while let Some(at) = nl {
            match self.continue_scalar(at + 1) {
                Some(cs) => nl = newline_before_end(cs),
                None => break,
            }
        }
        if let Some(at) = nl {
            // It is not indented as it has to be.
            end = Some(at - 1);
        }
        let end = end.unwrap_or(self.buffer.len());
        self.push_to_index(end + 1, false);
        if self.flow_level > 0 {
            State::Flow
        } else {
            State::Doc
        }
    }

    fn parse_block_scalar_header(&mut self) -> usize {
        self.block_scalar_indent = -1;
        self.block_scalar_keep = false;
        let mut i = self.pos;
        loop {
            i += 1;
            match self.at(i) {
                Some(b'+') => self.block_scalar_keep = true,
                Some(ch @ b'1'..=b'9') => self.block_scalar_indent = i32::from(ch - b'0') - 1,
                Some(b'-') => {}
                _ => break,
            }
        }
        self.push_until(|ch| is_empty(ch) || ch == Some(b'#'))
    }

    fn parse_block_scalar(&mut self) -> State {
        // One more than the position of the last line break, which can be before the text.
        let mut after_nl = self.pos;
        let mut indent = 0;
        let mut i = self.pos;
        loop {
            match self.at(i) {
                Some(b' ') => indent += 1,
                Some(b'\n') => {
                    after_nl = i + 1;
                    indent = 0;
                }
                _ => break,
            }
            i += 1;
        }
        if indent >= self.indent_next {
            self.indent_next = match self.block_scalar_indent {
                -1 => indent,
                explicit => explicit as usize + self.indent_next.max(1),
            };
            loop {
                let Some(cs) = self.continue_scalar(after_nl) else {
                    break;
                };
                match self.index_of(b'\n', cs) {
                    Some(nl) => after_nl = nl + 1,
                    None => {
                        after_nl = self.buffer.len() + 1;
                        break;
                    }
                }
            }
        }
        // Tabs at the end that are not indented enough are an error. For the parser to see them, they
        // are part of the scalar.
        let mut i = after_nl;
        while self.at(i) == Some(b' ') {
            i += 1;
        }
        if self.at(i) == Some(b'\t') {
            while matches!(self.at(i), Some(b'\t' | b' ' | b'\r' | b'\n')) {
                i += 1;
            }
            after_nl = i;
        } else if !self.block_scalar_keep {
            // Lines at the end with nothing in them, and not indented further, are not part of it.
            while after_nl >= 2 {
                let last_char = after_nl - 2;
                let mut i = last_char as isize;
                while i >= 0 && self.at(i as usize) == Some(b' ') {
                    i -= 1;
                }
                if i >= self.pos as isize
                    && self.at(i as usize) == Some(b'\n')
                    && i as usize + 1 + indent > last_char
                {
                    after_nl = i as usize + 1;
                } else {
                    break;
                }
            }
        }
        self.marker(LexemeKind::Scalar);
        self.push_to_index(after_nl, true);
        self.parse_line_start()
    }

    fn parse_plain_scalar(&mut self) -> State {
        let in_flow = self.flow_level > 0;
        // One more than the position of the last character.
        let mut end = self.pos;
        let mut i = self.pos;
        while let Some(ch) = self.at(i) {
            let next = self.at(i + 1);
            if ch == b':' {
                if is_empty(next) || (in_flow && is_flow_indicator(next)) {
                    break;
                }
                end = i + 1;
            } else if is_empty(Some(ch)) {
                if ch == b'\r' {
                    end = i + 1;
                }
                if next == Some(b'#') || (in_flow && is_flow_indicator(next)) {
                    break;
                }
                if ch == b'\n' {
                    let Some(cs) = self.continue_scalar(i + 1) else {
                        break;
                    };
                    // To go on, but still see a ` #`.
                    i = i.max(cs.saturating_sub(2));
                }
            } else {
                if in_flow && is_flow_indicator(Some(ch)) {
                    break;
                }
                end = i + 1;
            }
            i += 1;
        }
        self.marker(LexemeKind::Scalar);
        self.push_to_index(end, true);
        if in_flow { State::Flow } else { State::Doc }
    }
}

pub(crate) fn lex(text: &[u8]) -> Vec<Lexeme> {
    let mut lexer = Lexer {
        buffer: text,
        out: Vec::new(),
        block_scalar_indent: -1,
        block_scalar_keep: false,
        flow_key: false,
        flow_level: 0,
        indent_next: 0,
        indent_value: 0,
        line_end_pos: None,
        pos: 0,
    };
    let mut next = State::Stream;
    while lexer.pos < text.len() {
        next = match next {
            State::Stream => lexer.parse_stream(),
            State::BlockStart => lexer.parse_block_start(),
            State::Doc => lexer.parse_document(),
            State::Flow => lexer.parse_flow_collection(),
        };
    }
    lexer.out
}
