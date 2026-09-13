//! The scanner: source bytes -> preprocessing tokens.
//!
//! This is the only place that reads source bytes. Backslash-newline splices
//! (translation phase 2) and comments (phase 3) are handled here.

use std::rc::Rc;

use bun_core::strings;

use crate::token::{Error, Loc, PpKind, PpToken, Punct, Res, TokenSource};

pub(crate) struct Lexer {
    src: Rc<[u8]>,
    file: u32,
    pos: usize,
    line: u32,
    at_start_of_line: bool,
}

impl Lexer {
    /// `file` is the index of this source in the file table; it is stamped on every token.
    pub(crate) fn new(src: Rc<[u8]>, file: u32) -> Lexer {
        // A UTF-8 byte order mark is not part of the program.
        let pos = if src.starts_with(&[0xef, 0xbb, 0xbf]) {
            3
        } else {
            0
        };
        let mut lexer = Lexer {
            src,
            file,
            pos,
            line: 1,
            at_start_of_line: true,
        };
        lexer.skip_splices();
        lexer
    }

    /// A scanner of `src` that starts at the byte `pos`, where a token starts.
    pub(crate) fn at(src: Rc<[u8]>, file: u32, pos: usize) -> Lexer {
        Lexer {
            pos: pos.min(src.len()),
            src,
            file,
            line: 1,
            at_start_of_line: false,
        }
    }

    pub(crate) fn position(&self) -> usize {
        self.pos
    }

    fn loc(&self) -> Loc {
        Loc {
            file: self.file,
            line: self.line,
            offset: self.pos as u32,
        }
    }

    /// Length of a backslash-newline at `pos`, or 0.
    fn splice_len(&self, pos: usize) -> usize {
        if self.src.get(pos) != Some(&b'\\') {
            return 0;
        }
        match (self.src.get(pos + 1), self.src.get(pos + 2)) {
            (Some(b'\n'), _) => 2,
            (Some(b'\r'), Some(b'\n')) => 3,
            _ => 0,
        }
    }

    /// Keeps the invariant that `pos` never rests on a backslash-newline.
    fn skip_splices(&mut self) {
        loop {
            let n = self.splice_len(self.pos);
            if n == 0 {
                return;
            }
            self.pos += n;
            self.line += 1;
        }
    }

    /// The byte `n` positions ahead, looking through splices; 0 at end of input.
    fn peek_at(&self, n: usize) -> u8 {
        let mut pos = self.pos;
        let mut remaining = n;
        loop {
            let splice = self.splice_len(pos);
            if splice != 0 {
                pos += splice;
                continue;
            }
            if remaining == 0 {
                return self.src.get(pos).copied().unwrap_or(0);
            }
            if pos >= self.src.len() {
                return 0;
            }
            pos += 1;
            remaining -= 1;
        }
    }

    fn peek(&self) -> u8 {
        self.src.get(self.pos).copied().unwrap_or(0)
    }

    fn at_end(&self) -> bool {
        self.pos >= self.src.len()
    }

    fn bump(&mut self) -> u8 {
        let b = self.peek();
        if self.at_end() {
            return 0;
        }
        self.pos += 1;
        if b == b'\n' {
            self.line += 1;
        }
        self.skip_splices();
        b
    }

    /// Skips whitespace and comments. Returns whether anything was skipped.
    fn skip_trivia(&mut self) -> Res<bool> {
        let mut skipped = false;
        loop {
            let b = self.peek();
            if self.at_end() {
                return Ok(skipped);
            }
            match b {
                b'\n' => {
                    self.bump();
                    self.at_start_of_line = true;
                    skipped = true;
                }
                b' ' | b'\t' | b'\r' | 0x0b | 0x0c => {
                    self.bump();
                    skipped = true;
                }
                b'/' if self.peek_at(1) == b'/' => {
                    self.skip_line_comment();
                    skipped = true;
                }
                b'/' if self.peek_at(1) == b'*' => {
                    let start = self.loc();
                    self.bump();
                    self.bump();
                    if !self.skip_block_comment() {
                        return Err(Error {
                            loc: start,
                            msg: "unterminated /* comment".to_string(),
                            note: None,
                        });
                    }
                    skipped = true;
                }
                _ => return Ok(skipped),
            }
        }
    }

    /// Lexes a quoted literal. Returns false if the line ends first: the token then is
    /// the unmatched quote plus the rest of the line, which only matters if it survives to
    /// the parser (skipped groups and `#error` lines may contain lone apostrophes).
    fn lex_quoted(&mut self, quote: u8, text: &mut Vec<u8>) -> bool {
        text.push(self.bump());
        loop {
            // Up to whatever is not just more of the literal.
            let rest = &self.src[self.pos..];
            let plain = strings::index_of_any(rest, &[quote, b'\\', b'\n']).unwrap_or(rest.len());
            text.extend_from_slice(&rest[..plain]);
            self.pos += plain;
            if self.at_end() || self.peek() == b'\n' {
                return false;
            }
            if self.splice_len(self.pos) != 0 {
                self.skip_splices();
                continue;
            }
            let b = self.bump();
            text.push(b);
            if b == b'\\' {
                if self.at_end() || self.peek() == b'\n' {
                    return false;
                }
                text.push(self.bump());
            } else {
                return true;
            }
        }
    }

    /// From the `//` to the end of the line, which a backslash-newline does not end.
    fn skip_line_comment(&mut self) {
        loop {
            let rest = &self.src[self.pos..];
            let Some(newline) = strings::index_of_char_usize(rest, b'\n') else {
                self.pos = self.src.len();
                return;
            };
            let spliced = match newline {
                0 => false,
                1 => rest[0] == b'\\',
                _ => {
                    rest[newline - 1] == b'\\'
                        || (rest[newline - 1] == b'\r' && rest[newline - 2] == b'\\')
                }
            };
            if !spliced {
                self.pos += newline;
                return;
            }
            self.pos += newline + 1;
            self.line += 1;
        }
    }

    /// From after the `/*` to after the `*/`. False when there is none.
    fn skip_block_comment(&mut self) -> bool {
        loop {
            let rest = &self.src[self.pos..];
            let Some(star) = strings::index_of_char_usize(rest, b'*') else {
                self.line += strings::count_char(rest, b'\n') as u32;
                self.pos = self.src.len();
                return false;
            };
            self.line += strings::count_char(&rest[..star], b'\n') as u32;
            self.pos += star + 1;
            // The `/` may be a line further on: `*\` at the end of one, `/` starting the next.
            self.skip_splices();
            if self.peek() == b'/' && !self.at_end() {
                self.bump();
                return true;
            }
        }
    }

    /// Appends to `text` the bytes from here on that `more` holds for.
    fn take_while(&mut self, text: &mut Vec<u8>, more: impl Fn(u8) -> bool) {
        loop {
            let rest = &self.src[self.pos..];
            let run = rest.iter().take_while(|&&b| more(b)).count();
            text.extend_from_slice(&rest[..run]);
            self.pos += run;
            if self.splice_len(self.pos) == 0 {
                return;
            }
            self.skip_splices();
        }
    }

    /// After `#include`: a `<...>` header name on the current line, if one follows.
    pub(crate) fn angled_header_name(&mut self) -> Option<Vec<u8>> {
        while matches!(self.peek(), b' ' | b'\t') && !self.at_end() {
            self.bump();
        }
        if self.peek() != b'<' {
            return None;
        }
        let mut end = self.pos + 1;
        while let Some(&b) = self.src.get(end) {
            if b == b'\n' {
                return None;
            }
            if b == b'>' {
                let name = self.src[self.pos + 1..end].to_vec();
                while self.pos <= end {
                    self.bump();
                }
                return Some(name);
            }
            end += 1;
        }
        None
    }

    fn punct(&mut self) -> Option<Punct> {
        use Punct::*;
        let (b0, b1, b2) = (self.peek(), self.peek_at(1), self.peek_at(2));
        let (p, len) = match (b0, b1, b2) {
            (b'.', b'.', b'.') => (Ellipsis, 3),
            (b'<', b'<', b'=') => (ShlAssign, 3),
            (b'>', b'>', b'=') => (ShrAssign, 3),
            (b'-', b'>', _) => (Arrow, 2),
            (b'+', b'+', _) => (PlusPlus, 2),
            (b'-', b'-', _) => (MinusMinus, 2),
            (b'<', b'<', _) => (Shl, 2),
            (b'>', b'>', _) => (Shr, 2),
            (b'<', b'=', _) => (Le, 2),
            (b'>', b'=', _) => (Ge, 2),
            (b'=', b'=', _) => (EqEq, 2),
            (b'!', b'=', _) => (Ne, 2),
            (b'&', b'&', _) => (AmpAmp, 2),
            (b'|', b'|', _) => (PipePipe, 2),
            (b'*', b'=', _) => (StarAssign, 2),
            (b'/', b'=', _) => (SlashAssign, 2),
            (b'%', b'=', _) => (PercentAssign, 2),
            (b'+', b'=', _) => (PlusAssign, 2),
            (b'-', b'=', _) => (MinusAssign, 2),
            (b'&', b'=', _) => (AmpAssign, 2),
            (b'^', b'=', _) => (CaretAssign, 2),
            (b'|', b'=', _) => (PipeAssign, 2),
            (b'#', b'#', _) => (HashHash, 2),
            (b'[', _, _) => (LBracket, 1),
            (b']', _, _) => (RBracket, 1),
            (b'(', _, _) => (LParen, 1),
            (b')', _, _) => (RParen, 1),
            (b'{', _, _) => (LBrace, 1),
            (b'}', _, _) => (RBrace, 1),
            (b'.', _, _) => (Dot, 1),
            (b'&', _, _) => (Amp, 1),
            (b'*', _, _) => (Star, 1),
            (b'+', _, _) => (Plus, 1),
            (b'-', _, _) => (Minus, 1),
            (b'~', _, _) => (Tilde, 1),
            (b'!', _, _) => (Bang, 1),
            (b'/', _, _) => (Slash, 1),
            (b'%', _, _) => (Percent, 1),
            (b'<', _, _) => (Lt, 1),
            (b'>', _, _) => (Gt, 1),
            (b'^', _, _) => (Caret, 1),
            (b'|', _, _) => (Pipe, 1),
            (b'?', _, _) => (Question, 1),
            (b':', _, _) => (Colon, 1),
            (b';', _, _) => (Semi, 1),
            (b'=', _, _) => (Assign, 1),
            (b',', _, _) => (Comma, 1),
            (b'#', _, _) => (Hash, 1),
            _ => return None,
        };
        for _ in 0..len {
            self.bump();
        }
        Some(p)
    }
}

fn is_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_' || b == b'$' || b >= 0x80
}

fn is_ident_continue(b: u8) -> bool {
    is_ident_start(b) || b.is_ascii_digit()
}

impl TokenSource for Lexer {
    fn next_token(&mut self) -> Res<PpToken> {
        let has_leading_space = self.skip_trivia()?;
        let at_start_of_line = self.at_start_of_line;
        self.at_start_of_line = false;
        let loc = self.loc();
        let mut text = Vec::new();

        let kind = if self.at_end() {
            PpKind::Eof
        } else {
            let b = self.peek();
            if is_ident_start(b) {
                self.take_while(&mut text, is_ident_continue);
                // An encoding prefix glued to a quote is part of the literal.
                let quote = self.peek();
                if (quote == b'"' || quote == b'\'')
                    && matches!(text.as_slice(), b"L" | b"u" | b"U" | b"u8")
                {
                    if !self.lex_quoted(quote, &mut text) {
                        PpKind::Other
                    } else if quote == b'"' {
                        PpKind::StrLit
                    } else {
                        PpKind::CharLit
                    }
                } else {
                    PpKind::Ident
                }
            } else if b.is_ascii_digit() || (b == b'.' && self.peek_at(1).is_ascii_digit()) {
                // pp-number: digits, letters, '.', and a sign right after an exponent letter.
                loop {
                    self.take_while(&mut text, |c| {
                        c.is_ascii_alphanumeric() || c == b'.' || c == b'_'
                    });
                    let exponent = text.last().is_some_and(|c| matches!(c | 0x20, b'e' | b'p'));
                    if exponent && matches!(self.peek(), b'+' | b'-') && !self.at_end() {
                        text.push(self.bump());
                    } else {
                        break;
                    }
                }
                PpKind::Number
            } else if b == b'"' {
                if self.lex_quoted(b'"', &mut text) {
                    PpKind::StrLit
                } else {
                    PpKind::Other
                }
            } else if b == b'\'' {
                if self.lex_quoted(b'\'', &mut text) {
                    PpKind::CharLit
                } else {
                    PpKind::Other
                }
            } else if let Some(p) = self.punct() {
                PpKind::Punct(p)
            } else {
                // Any other character is a preprocessing token of its own.
                text.push(self.bump());
                PpKind::Other
            }
        };
        Ok(PpToken {
            kind,
            text,
            loc,
            at_start_of_line,
            has_leading_space,
        })
    }
}
