//! The lexer. It hands out one token at a time, on demand, because `/`, `}` and `<` mean different things depending on
//! what the parser expects.

use crate::ast::{F_BLANK, F_BLANK_LINE, F_ESCAPE, F_QUOTE, F_SLOW_TEXT, F_TAIL};
use crate::lang::lang;
use crate::parse::core::TYPED_TS;
use crate::{
    Bytes, Quick, R, Words, bytes_before, rare, where_byte_is, where_not_printable, zeros,
};
use bun_core::lexer::{
    is_identifier_start, is_recent_identifier_part, is_recent_identifier_start,
    is_type_script_identifier_part,
};
use bun_core::strings;

/// What [`Quick::save`] gives.
#[derive(Clone, Copy)]
pub(crate) struct Saved {
    pos: i32,
    tok: i32,
    start: i32,
    end: i32,
    nl: i32,
    flags: i32,
    kw: i32,
    prev: i32,
    comments: i32,
}

pub(crate) struct Lexer {
    // ---- state
    pub(crate) pos: i32,
    pub(crate) tok: i32,
    pub(crate) tok_start: i32,
    pub(crate) tok_end: i32,
    /// a line terminator stands between the previous token and this one
    pub(crate) tok_nl: i32,
    /// node flags that describe the token's text
    pub(crate) tok_flags: i32,
    pub(crate) tok_kw: i32,
    pub(crate) prev_end: i32,
    pub(crate) c: Vec<i32>,
    pub(crate) c_count: i32,
    pub(crate) c_base: i32,
    // ---- going back: a lookahead saves these and restores them
    /// The same for a parser that tries a reading of the text and may have to give it up. These nest.
    pub(crate) marks: Vec<i32>,
    pub(crate) marks_top: i32,
    /// Length of the white space character that starts with the non-ASCII byte at p, or 0. Line separators count + 16.
    /// Babel with the plugin "flow_comments": what stands in `/*:: .. */`, `/*: .. */` and `/* flow-include .. */` is code.
    pub(crate) flow_comments: bool,
    pub(crate) flow_comment_end: i32,
    /// flow-parser takes `>` and `}` in the text of an element for text.
    pub(crate) lenient_jsx_text: bool,
    /// The scanner of TypeScript takes U+0085 and U+200B for white space.
    pub(crate) type_script_spaces: bool,
}
impl Lexer {
    pub(crate) fn new() -> Self {
        Self {
            pos: 0,
            tok: 0,
            tok_start: 0,
            tok_end: 0,
            tok_nl: 0,
            tok_flags: 0,
            tok_kw: 0,
            prev_end: 0,
            c: zeros(4096),
            c_count: 0,
            c_base: 0,
            marks: zeros(144),
            marks_top: 0,
            flow_comments: false,
            flow_comment_end: -1,
            lenient_jsx_text: false,
            type_script_spaces: false,
        }
    }
}

#[allow(non_upper_case_globals)]
pub(crate) mod tk {
    pub(crate) const EOF: i32 = 0;
    pub(crate) const Name: i32 = 1;
    pub(crate) const PrivateName: i32 = 2;
    pub(crate) const Num: i32 = 3;
    pub(crate) const BigInt: i32 = 4;
    pub(crate) const String: i32 = 5;
    pub(crate) const BackQuote: i32 = 6;
    pub(crate) const Regex: i32 = 7;
    pub(crate) const JSXName: i32 = 8;
    pub(crate) const JSXText: i32 = 9;
    // punctuation
    pub(crate) const BraceL: i32 = 10;
    pub(crate) const BraceR: i32 = 11;
    pub(crate) const ParenL: i32 = 12;
    pub(crate) const ParenR: i32 = 13;
    pub(crate) const BracketL: i32 = 14;
    pub(crate) const BracketR: i32 = 15;
    pub(crate) const Semi: i32 = 16;
    pub(crate) const Comma: i32 = 17;
    pub(crate) const Dot: i32 = 18;
    pub(crate) const QuestionDot: i32 = 19;
    pub(crate) const Ellipsis: i32 = 20;
    pub(crate) const Question: i32 = 21;
    pub(crate) const Colon: i32 = 22;
    pub(crate) const Arrow: i32 = 23;
    pub(crate) const At: i32 = 24;
    pub(crate) const DoubleColon: i32 = 25;
    // assignment operators
    pub(crate) const Eq: i32 = 26;
    pub(crate) const AddEq: i32 = 27;
    pub(crate) const SubEq: i32 = 28;
    pub(crate) const MulEq: i32 = 29;
    pub(crate) const DivEq: i32 = 30;
    pub(crate) const ModEq: i32 = 31;
    pub(crate) const PowEq: i32 = 32;
    pub(crate) const ShlEq: i32 = 33;
    pub(crate) const ShrEq: i32 = 34;
    pub(crate) const UShrEq: i32 = 35;
    pub(crate) const AndEq: i32 = 36;
    pub(crate) const OrEq: i32 = 37;
    pub(crate) const XorEq: i32 = 38;
    pub(crate) const LAndEq: i32 = 39;
    pub(crate) const LOrEq: i32 = 40;
    pub(crate) const NullishEq: i32 = 41;
    // unary only
    pub(crate) const Inc: i32 = 42;
    pub(crate) const Dec: i32 = 43;
    pub(crate) const Not: i32 = 44;
    pub(crate) const Tilde: i32 = 45;
    // binary operators
    pub(crate) const Pipeline: i32 = 46;
    pub(crate) const Nullish: i32 = 47;
    pub(crate) const LOr: i32 = 48;
    pub(crate) const LAnd: i32 = 49;
    pub(crate) const BitOr: i32 = 50;
    pub(crate) const BitXor: i32 = 51;
    pub(crate) const BitAnd: i32 = 52;
    pub(crate) const EqEq: i32 = 53;
    pub(crate) const NotEq: i32 = 54;
    pub(crate) const EqEqEq: i32 = 55;
    pub(crate) const NotEqEq: i32 = 56;
    pub(crate) const Lt: i32 = 57;
    pub(crate) const Gt: i32 = 58;
    pub(crate) const LtEq: i32 = 59;
    pub(crate) const GtEq: i32 = 60;
    pub(crate) const Shl: i32 = 61;
    pub(crate) const Shr: i32 = 62;
    pub(crate) const UShr: i32 = 63;
    pub(crate) const Add: i32 = 64;
    pub(crate) const Sub: i32 = 65;
    pub(crate) const Mul: i32 = 66;
    pub(crate) const Div: i32 = 67;
    pub(crate) const Mod: i32 = 68;
    pub(crate) const Pow: i32 = 69;
    // keywords that are operators
    pub(crate) const In: i32 = 70;
    pub(crate) const Instanceof: i32 = 71;
    pub(crate) const Typeof: i32 = 72;
    pub(crate) const Void: i32 = 73;
    pub(crate) const Delete: i32 = 74;
    // other keywords
    pub(crate) const Break: i32 = 75;
    pub(crate) const Case: i32 = 76;
    pub(crate) const Catch: i32 = 77;
    pub(crate) const Class: i32 = 78;
    pub(crate) const Const: i32 = 79;
    pub(crate) const Continue: i32 = 80;
    pub(crate) const Debugger: i32 = 81;
    pub(crate) const Default: i32 = 82;
    pub(crate) const Do: i32 = 83;
    pub(crate) const Else: i32 = 84;
    pub(crate) const Export: i32 = 85;
    pub(crate) const Extends: i32 = 86;
    pub(crate) const False: i32 = 87;
    pub(crate) const Finally: i32 = 88;
    pub(crate) const For: i32 = 89;
    pub(crate) const Function: i32 = 90;
    pub(crate) const If: i32 = 91;
    pub(crate) const Import: i32 = 92;
    pub(crate) const New: i32 = 93;
    pub(crate) const Null: i32 = 94;
    pub(crate) const Return: i32 = 95;
    pub(crate) const Super: i32 = 96;
    pub(crate) const Switch: i32 = 97;
    pub(crate) const This: i32 = 98;
    pub(crate) const Throw: i32 = 99;
    pub(crate) const True: i32 = 100;
    pub(crate) const Try: i32 = 101;
    pub(crate) const Var: i32 = 102;
    pub(crate) const While: i32 = 103;
    pub(crate) const With: i32 = 104;
}
/// Names that mean something in some places. `tok_kw` holds one of these when `tok` is Tk.Name.
#[allow(non_upper_case_globals)]
pub(crate) mod kw {
    pub(crate) const None: i32 = 0;
    pub(crate) const Async: i32 = 1;
    pub(crate) const Await: i32 = 2;
    pub(crate) const Let: i32 = 3;
    pub(crate) const Static: i32 = 4;
    pub(crate) const Yield: i32 = 5;
    pub(crate) const Of: i32 = 6;
    pub(crate) const Get: i32 = 7;
    pub(crate) const Set: i32 = 8;
    pub(crate) const From: i32 = 9;
    pub(crate) const As: i32 = 10;
    pub(crate) const Using: i32 = 11;
    pub(crate) const Accessor: i32 = 12;
    pub(crate) const Defer: i32 = 13;
    pub(crate) const Source: i32 = 14;
    pub(crate) const Module: i32 = 15;
    pub(crate) const Target: i32 = 16;
    pub(crate) const Meta: i32 = 17;
    pub(crate) const Enum: i32 = 18;
}
pub(crate) static PREC: [u8; 105] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 7, 7, 7, 8, 8, 8, 8, 9, 9, 9,
    10, 10, 11, 11, 11, 12, 8, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
// ---- character classes
pub(crate) const C_ID_START: i32 = 1;
pub(crate) const C_ID_PART: i32 = 2;
pub(crate) const C_DIGIT: i32 = 4;
pub(crate) const C_HEX: i32 = 8;
/// the same as C_ID_START without the bytes from 128 on (32: the same for C_ID_PART)
pub(crate) const C_ASCII_START: i32 = 16;
pub(crate) static CT: [u8; 256] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 51, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 46, 46, 46, 46, 46, 46, 46, 46, 46, 46, 0, 0,
    0, 0, 0, 0, 0, 59, 59, 59, 59, 59, 59, 51, 51, 51, 51, 51, 51, 51, 51, 51, 51, 51, 51, 51, 51,
    51, 51, 51, 51, 51, 51, 0, 0, 0, 0, 51, 0, 59, 59, 59, 59, 59, 59, 51, 51, 51, 51, 51, 51, 51,
    51, 51, 51, 51, 51, 51, 51, 51, 51, 51, 51, 51, 51, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
];
// ---- comments: 8 words each
pub(crate) const C_STRIDE: i32 = 8;
pub(crate) const C_START: i32 = 0;
pub(crate) const C_END: i32 = 1;
pub(crate) const C_FLAGS: i32 = 2;
pub(crate) const C_ENCLOSING: i32 = 3;
pub(crate) const C_PRECEDING: i32 = 4;
pub(crate) const C_FOLLOWING: i32 = 5;
pub(crate) const C_NEXT: i32 = 6;
pub(crate) const C_NODE: i32 = 7;
pub(crate) const CF_BLOCK: i32 = 1;
/// there is a node for it (K.ReadyComment): it is not attached to another one
pub(crate) const CF_CLAIMED: i32 = 16384;
pub(crate) const CF_HASHBANG: i32 = 2;
/// nothing but printable ASCII and line feeds: a piece is as wide as it is long
pub(crate) const CF_PLAIN: i32 = 256;
/// of a plain block comment: it has several lines, and all but the first start with `*`
pub(crate) const CF_INDENTABLE: i32 = 512;
impl Quick {
    pub(crate) fn push_comment(&mut self, start: i32, end: i32, flags: i32) {
        let at = self.lexer.c_count * C_STRIDE;
        if at + C_STRIDE > (self.lexer.c.len() as i32) {
            let mut grown = zeros::<i32>(self.lexer.c.len() as i32 * 2);
            grown.set_all(&self.lexer.c, 0);
            self.lexer.c = grown;
        }
        self.lexer.c.put(at, start);
        self.lexer.c.put(at + 1, end);
        self.lexer.c.put(at + 2, flags);
        self.lexer.c.put(at + 3, 0);
        self.lexer.c.put(at + 4, 0);
        self.lexer.c.put(at + 5, 0);
        self.lexer.c.put(at + 6, -1);
        self.lexer.c.put(at + 7, 0);
        self.lexer.c_count += 1;
    }

    pub(crate) fn set_comment_count(&mut self, count: i32) {
        self.lexer.c_count = count;
    }

    /// Goes back to the comments of the run that was interrupted by another one.
    pub(crate) fn set_comment_window(&mut self, base: i32, count: i32) {
        self.lexer.c_base = base;
        self.lexer.c_count = count;
    }

    /// Starts at the beginning of the window. The comments of this run are C[c_base .. c_count).
    pub(crate) fn reset_lexer(&mut self) -> R<()> {
        self.lexer.pos = self.text.src_start;
        self.lexer.tok = tk::EOF;
        let v0 = self.text.src_start;
        self.lexer.prev_end = v0;
        self.lexer.tok_end = v0;
        self.lexer.tok_start = v0;
        self.lexer.tok_nl = 0;
        self.lexer.tok_flags = 0;
        self.lexer.tok_kw = 0;
        self.lexer.c_base = self.lexer.c_count;
        self.lexer.marks_top = 0;
        // #! line
        if self.t.at(self.lexer.pos) == 35 && self.t.at(self.lexer.pos + 1) == 33 {
            let mut p = self.lexer.pos;
            while p < self.text.src_end && self.t.at(p) != 10 {
                let c = self.t.at(p);
                if (c < 32 || c >= 127) && c != 9 {
                    let length = self.length_in_comment(p);
                    if length == 0 {
                        return Err(self.rare(rare::ODD_BYTES));
                    }
                    p += length;
                    continue;
                }
                p += 1;
            }
            self.push_comment(self.lexer.pos, p, CF_HASHBANG);
            self.lexer.pos = p;
        }
        Ok(())
    }

    /// Where the lexer stands, for a look ahead over a few tokens: [`Quick::restore`] goes back there.
    pub(crate) fn save(&self) -> Saved {
        Saved {
            pos: self.lexer.pos,
            tok: self.lexer.tok,
            start: self.lexer.tok_start,
            end: self.lexer.tok_end,
            nl: self.lexer.tok_nl,
            flags: self.lexer.tok_flags,
            kw: self.lexer.tok_kw,
            prev: self.lexer.prev_end,
            comments: self.lexer.c_count,
        }
    }

    pub(crate) fn restore(&mut self, saved: Saved) {
        self.lexer.pos = saved.pos;
        self.lexer.tok = saved.tok;
        self.lexer.tok_start = saved.start;
        self.lexer.tok_end = saved.end;
        self.lexer.tok_nl = saved.nl;
        self.lexer.tok_flags = saved.flags;
        self.lexer.tok_kw = saved.kw;
        self.lexer.prev_end = saved.prev;
        self.lexer.c_count = saved.comments;
    }

    /// Remembers where the lexer stands. Every mark() is followed by rewind() or unmark() with its result.
    pub(crate) fn mark(&mut self) -> i32 {
        let m = self.lexer.marks_top;
        if m + 9 > (self.lexer.marks.len() as i32) {
            let mut grown = zeros::<i32>(self.lexer.marks.len() as i32 * 2);
            grown.set_all(&self.lexer.marks, 0);
            self.lexer.marks = grown;
        }
        self.lexer.marks.put(m, self.lexer.pos);
        self.lexer.marks.put(m + 1, self.lexer.tok);
        self.lexer.marks.put(m + 2, self.lexer.tok_start);
        self.lexer.marks.put(m + 3, self.lexer.tok_end);
        self.lexer.marks.put(m + 4, self.lexer.tok_nl);
        self.lexer.marks.put(m + 5, self.lexer.tok_flags);
        self.lexer.marks.put(m + 6, self.lexer.tok_kw);
        self.lexer.marks.put(m + 7, self.lexer.prev_end);
        self.lexer.marks.put(m + 8, self.lexer.c_count);
        self.lexer.marks_top = m + 9;
        self.keep_place(m / 9);
        return m;
    }

    /// Goes back to the mark, and forgets it and all later ones.
    pub(crate) fn rewind(&mut self, m: i32) {
        self.lexer.pos = self.lexer.marks.at(m);
        self.lexer.tok = self.lexer.marks.at(m + 1);
        self.lexer.tok_start = self.lexer.marks.at(m + 2);
        self.lexer.tok_end = self.lexer.marks.at(m + 3);
        self.lexer.tok_nl = self.lexer.marks.at(m + 4);
        self.lexer.tok_flags = self.lexer.marks.at(m + 5);
        self.lexer.tok_kw = self.lexer.marks.at(m + 6);
        self.lexer.prev_end = self.lexer.marks.at(m + 7);
        self.lexer.c_count = self.lexer.marks.at(m + 8);
        self.lexer.marks_top = m;
        self.go_back_to_place(m / 9);
    }

    /// Forgets the mark and all later ones.
    pub(crate) fn unmark(&mut self, m: i32) {
        self.lexer.marks_top = m;
    }

    /// The current token starts with `<` or `>`: takes that one character for the token and reads the next token behind it.
    pub(crate) fn next_after_first_character(&mut self) -> R<()> {
        self.lexer.tok_end = self.lexer.tok_start + 1;
        self.lexer.pos = self.lexer.tok_end;
        self.next()?;
        Ok(())
    }

    pub(crate) fn set_flow_comments(&mut self, value: bool) {
        self.lexer.flow_comments = value;
        self.lexer.flow_comment_end = -1;
    }

    pub(crate) fn set_lenient_jsx_text(&mut self, value: bool) {
        self.lexer.lenient_jsx_text = value;
    }

    pub(crate) fn set_type_script_spaces(&mut self, value: bool) {
        self.lexer.type_script_spaces = value;
    }

    /// How much of the comment that starts at `p` to skip to get to the code in it; 0 if it is a comment like any other.
    pub(crate) fn flow_comment_start(&self, p: i32) -> i32 {
        let mut shift: i32 = 2;
        while self.t.at(p + shift) == 32 || self.t.at(p + shift) == 9 {
            shift += 1;
        }
        if self.t.at(p + shift) == 58 {
            return if self.t.at(p + shift + 1) == 58 {
                shift + 2
            } else {
                shift
            };
        }
        let word = b"flow-include";
        let mut i: i32 = 0;
        while i < 12 {
            if self.t.at(p + shift + i) != word.at(i) {
                return 0;
            }
            i += 1;
        }
        return shift + 12;
    }

    /// How many bytes the character at `p` of a comment has, which is neither a printable character of ASCII nor a tab; 0 if it is a
    /// control character, white space or no character: comments are trimmed, line by line, and measured.
    #[cold]
    pub(crate) fn length_in_comment(&self, p: i32) -> i32 {
        if self.t.at(p) < 128 || self.unicode_space(p) != 0 {
            0
        } else {
            self.character_length(p)
        }
    }

    /// The byte at `p` of a string, a template, a regular expression or the text of an element, which is not a printable character of
    /// ASCII, a tab or a line feed, is a control character, or starts U+2028 or U+2029: what counts as a line differs from place to place.
    #[inline(always)]
    pub(crate) fn is_odd_in_text(&self, p: i32) -> bool {
        let c = self.t.at(p);
        c < 128 || (c == 0xe2 && self.is_line_separator(p))
    }

    /// How many bytes the character has that starts with the byte at p, which is not ASCII; 0 if this is not UTF-8.
    #[cold]
    pub(crate) fn character_length(&self, p: i32) -> i32 {
        let a = self.t.at(p);
        let b = self.t.at(p + 1);
        let goes_on = |q: i32| (self.t.at(q) & 0xc0) == 0x80;
        if a < 0xc2 || !goes_on(p + 1) {
            return 0;
        }
        if a < 0xe0 {
            return 2;
        }
        if !goes_on(p + 2) {
            return 0;
        }
        if a < 0xf0 {
            return if (a == 0xe0 && b < 0xa0) || (a == 0xed && b >= 0xa0) {
                0
            } else {
                3
            };
        }
        return if !goes_on(p + 3) || a > 0xf4 || (a == 0xf0 && b < 0x90) || (a == 0xf4 && b >= 0x90)
        {
            0
        } else {
            4
        };
    }

    /// Does U+2028 or U+2029 stand at p?
    #[cold]
    pub(crate) fn is_line_separator(&self, p: i32) -> bool {
        self.t.at(p) == 0xe2
            && self.t.at(p + 1) == 0x80
            && (self.t.at(p + 2) == 0xa8 || self.t.at(p + 2) == 0xa9)
    }

    pub(crate) fn unicode_space(&self, p: i32) -> i32 {
        let a = self.t.at(p);
        let b = self.t.at(p + 1);
        let c = self.t.at(p + 2);
        if a == 0xc2 {
            return if b == 0xa0 || (b == 0x85 && self.lexer.type_script_spaces) {
                2
            } else {
                0
            };
        }
        if a == 0xe2 {
            if b == 0x80 {
                if c == 0xa8 || c == 0xa9 {
                    return 3 + 16;
                }
                if c == 0x8b && self.lexer.type_script_spaces {
                    return 3;
                }
                if (c >= 0x80 && c <= 0x8a) || c == 0xaf {
                    return 3;
                }
                return 0;
            }
            return if b == 0x81 && c == 0x9f { 3 } else { 0 };
        }
        if a == 0xef {
            return if b == 0xbb && c == 0xbf { 3 } else { 0 };
        }
        if a == 0xe3 {
            return if b == 0x80 && c == 0x80 { 3 } else { 0 };
        }
        if a == 0xe1 {
            return if b == 0x9a && c == 0x80 { 3 } else { 0 };
        }
        return 0;
    }
}
impl Quick {
    pub(crate) fn skip_space(&mut self) -> R<()> {
        let mut p = self.lexer.pos;
        let mut nl: i32 = 0;
        loop {
            let c = self.t.at(p);
            if c > 47 && c < 128 {
                break;
            }
            if c == 32 || c == 9 {
                p += 1;
            } else if c == 10 || c == 13 {
                nl = 1;
                p = self.blanks_end(p + 1);
            } else if c == 47 {
                let d = self.t.at(p + 1);
                if d == 47 {
                    let start = p;
                    let mut flags = CF_PLAIN;
                    p += 2;
                    loop {
                        loop {
                            let stops = where_not_printable(self.t.u128_at(p));
                            if stops != 0 {
                                p += bytes_before(stops);
                                break;
                            }
                            p += 16;
                        }
                        let e = self.t.at(p);
                        if e < 0x20 || e > 0x7e {
                            if e == 10 || e == 13 || (e == 0 && p >= self.text.src_end) {
                                break;
                            }
                            if e == 0xe2
                                && self.t.at(p + 1) == 0x80
                                && (self.t.at(p + 2) == 0xa8 || self.t.at(p + 2) == 0xa9)
                            {
                                break;
                            }
                            flags = 0;
                            if e != 9 {
                                let length = self.length_in_comment(p);
                                if length == 0 {
                                    return Err(self.rare(rare::ODD_BYTES));
                                }
                                p += length;
                                continue;
                            }
                        }
                        p += 1;
                    }
                    self.push_comment(start, p, flags);
                } else if d == 42 {
                    if self.lexer.flow_comments {
                        let skip = self.flow_comment_start(p);
                        if skip != 0 {
                            // (a declaration does not start outside of it and go on inside)
                            if self.lexer.tok == tk::Export {
                                return Err(self.text_refuse());
                            }
                            // Where it ends is all there is to remember: looking ahead and going back need no care.
                            let mut end = p + skip;
                            // the end stands behind `//` on its line
                            let mut is_hidden = false;
                            while !(self.t.at(end) == 42 && self.t.at(end + 1) == 47) {
                                if end >= self.text.src_end {
                                    return Err(self.fail(p));
                                }
                                if self.t.at(end) == 47 && self.t.at(end + 1) == 47 {
                                    is_hidden = true;
                                } else if self.t.at(end) == 10 {
                                    is_hidden = false;
                                }
                                end += 1;
                            }
                            if is_hidden {
                                return Err(self.text_refuse());
                            }
                            self.lexer.flow_comment_end = end;
                            p += skip;
                            continue;
                        }
                    }
                    let start = p;
                    let mut flags = CF_BLOCK | CF_PLAIN;
                    let mut indentable: i32 = 1;
                    p += 2;
                    loop {
                        loop {
                            let v = self.t.u128_at(p);
                            let stops = where_not_printable(v) | where_byte_is(v, b'*');
                            if stops != 0 {
                                p += bytes_before(stops);
                                break;
                            }
                            p += 16;
                        }
                        let e = self.t.at(p);
                        if e == 42 {
                            if self.t.at(p + 1) == 47 {
                                break;
                            }
                        } else if e == 10 {
                            nl = 1;
                            flags |= CF_INDENTABLE;
                            p = self.blanks_end(p + 1);
                            if self.t.at(p) != 42 {
                                indentable = 0;
                            }
                            continue;
                        } else if e < 0x20 || e > 0x7e {
                            if e == 13 {
                                nl = 1;
                            } else if e == 0 && p >= self.text.src_end {
                                return Err(self.fail(start));
                            }
                            flags &= !CF_PLAIN;
                            if e != 9 {
                                let length = self.length_in_comment(p);
                                if length == 0 {
                                    return Err(self.rare(rare::ODD_BYTES));
                                }
                                p += length;
                                continue;
                            }
                        }
                        p += 1;
                    }
                    p += 2;
                    if indentable == 0 {
                        flags &= !CF_INDENTABLE;
                    }
                    self.push_comment(start, p, flags);
                } else {
                    break;
                }
            } else if c == 11 || c == 12 || (c >= 128 && self.unicode_space(p) != 0) {
                // Whether it ends a line, is part of an empty one or of a comment's text is asked in too many places.
                return Err(self.rare(rare::ODD_BYTES));
            } else {
                break;
            }
        }
        self.lexer.pos = p;
        self.lexer.tok_nl = nl;
        Ok(())
    }

    pub(crate) fn lexer_finish(&mut self, type_: i32, end: i32) {
        self.lexer.tok = type_;
        self.lexer.tok_end = end;
        self.lexer.pos = end;
    }
}
// ---- keywords: a perfect hash of the first, the second and the last character and the length
pub(crate) const KW_A: i32 = 7;
pub(crate) const KW_B: i32 = 5;
pub(crate) const KW_C: i32 = 34;
pub(crate) const KW_D: i32 = 6;
pub(crate) const KW_MASK: i32 = 127;
/// length | token << 8 | contextual name << 16
pub(crate) static KW_INFO: [i32; 128] = [
    131333, 0, 0, 0, 0, 0, 0, 0, 19717, 20744, 25859, 22023, 23558, 0, 0, 0, 0, 0, 25092, 22535, 0,
    0, 590084, 0, 524547, 0, 0, 0, 19460, 1048838, 0, 393474, 25349, 0, 0, 0, 0, 0, 0, 21766, 0, 0,
    65797, 22787, 0, 17922, 0, 0, 24581, 21250, 0, 262406, 983302, 19973, 26628, 22277, 655618,
    18438, 0, 24068, 19205, 0, 721157, 0, 0, 0, 327941, 18950, 459011, 18692, 0, 20999, 0, 0, 0, 0,
    0, 18186, 0, 0, 0, 26373, 0, 0, 0, 26115, 0, 24326, 0, 0, 0, 23811, 0, 0, 917766, 23048, 0,
    21508, 0, 0, 0, 0, 20229, 196867, 25604, 0, 786696, 0, 24838, 0, 1114372, 0, 0, 0, 0, 0, 0,
    23298, 0, 852229, 0, 0, 20488, 1179908, 0, 0, 0, 0,
];
/// where the word stands in T
pub(crate) static KW_TEXT: [i32; 128] = [
    189, 0, 0, 0, 0, 0, 0, 0, 154, 306, 95, 276, 215, 0, 0, 0, 0, 0, 104, 283, 0, 0, 136, 0, 101,
    0, 0, 0, 124, 233, 0, 79, 174, 0, 0, 0, 0, 0, 0, 221, 0, 0, 184, 89, 0, 75, 0, 0, 179, 77, 0,
    245, 263, 149, 132, 159, 81, 227, 0, 112, 164, 0, 199, 0, 0, 0, 194, 257, 98, 128, 0, 269, 0,
    0, 0, 0, 0, 322, 0, 0, 0, 169, 0, 0, 0, 83, 0, 209, 0, 0, 0, 92, 0, 0, 251, 290, 0, 116, 0, 0,
    0, 0, 144, 86, 108, 0, 314, 0, 239, 0, 140, 0, 0, 0, 0, 0, 0, 73, 0, 204, 0, 0, 298, 120, 0, 0,
    0, 0,
];
// by first character: bit n is set if a word of n characters starts with it (n counts modulo 32, classify_name() looks closer)
pub(crate) static KW_LENGTHS: [i32; 128] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 292, 32, 304, 484, 208, 440, 8, 0, 1092, 0, 0, 8, 80, 24, 4, 0, 0, 64, 104, 120, 32, 24, 48,
    0, 32, 0, 0, 0, 0, 0, 0,
];
// The same words by their first four bytes, which tell them all apart: one read and one multiplication, for keyword_at().
pub(crate) const FOUR_MULTIPLIER: i32 = 0x7331f7b1;
pub(crate) static FOUR_KEY: [i32; 128] = [
    0, 1701869940, 0, 0, 1701602660, 0, 0, 0, 1635018093, 0, 0, 0, 29537, 0, 1818847351, 0, 0,
    1634038370, 1970562418, 1936617315, 26217, 1668571491, 0, 1752459639, 1953721961, 0, 0, 0,
    1853453153, 1701209444, 0, 0, 0, 0, 0, 0, 0, 0, 7628135, 0, 0, 1767995233, 7496054, 1818585465,
    7824750, 0, 1969516397, 0, 0, 0, 0, 0, 0, 0, 1969382756, 1920298867, 1952543859, 0, 0,
    1634100580, 0, 1702195828, 1836412517, 1684631414, 1819047278, 0, 7959156, 0, 0, 1869768820,
    7628140, 0, 0, 0, 1702060387, 1701012321, 1936287860, 0, 1668183398, 0, 1702063205, 1869639017,
    1735549300, 0, 28516, 0, 0, 0, 0, 7628147, 0, 28265, 0, 0, 1852404597, 0, 0, 0, 1953068915, 0,
    1701868915, 0, 0, 0, 0, 0, 0, 1936482662, 1953394531, 26223, 7499622, 0, 0, 1634625894, 0, 0,
    1836020326, 0, 0, 0, 1702131813, 0, 0, 0, 0, 1869641829, 1935764579, 0,
];
pub(crate) static FOUR_INFO: [i32; 128] = [
    0, 18438, 0, 0, 18950, 0, 0, 0, 1114372, 0, 0, 0, 655618, 0, 26373, 0, 0, 19205, 24326, 20229,
    23298, 19717, 0, 26628, 18186, 0, 0, 0, 65797, 852229, 0, 0, 0, 0, 0, 0, 0, 0, 459011, 0, 0,
    131333, 26115, 327941, 23811, 0, 983302, 0, 0, 0, 0, 0, 0, 0, 20744, 917766, 262406, 0, 0,
    20999, 0, 25604, 1179908, 18692, 24068, 0, 25859, 0, 0, 25349, 196867, 0, 0, 0, 19460, 786696,
    25092, 0, 23048, 0, 21508, 23558, 1048838, 0, 21250, 0, 0, 0, 0, 524547, 0, 17922, 0, 0,
    721157, 0, 0, 0, 24838, 0, 24581, 0, 0, 0, 0, 0, 0, 22277, 20488, 393474, 22787, 0, 0, 22535,
    0, 0, 590084, 0, 0, 0, 22023, 0, 0, 0, 0, 21766, 19973, 0,
];
pub(crate) static FOUR_TEXT: [i32; 128] = [
    0, 227, 0, 0, 257, 0, 0, 0, 140, 0, 0, 0, 81, 0, 169, 0, 0, 164, 209, 144, 73, 154, 0, 132,
    322, 0, 0, 0, 184, 204, 0, 0, 0, 0, 0, 0, 0, 0, 98, 0, 0, 189, 83, 194, 92, 0, 263, 0, 0, 0, 0,
    0, 0, 0, 306, 251, 245, 0, 0, 269, 0, 108, 120, 128, 112, 0, 95, 0, 0, 174, 86, 0, 0, 0, 124,
    314, 104, 0, 290, 0, 116, 215, 233, 0, 77, 0, 0, 0, 0, 101, 0, 75, 0, 0, 199, 0, 0, 0, 239, 0,
    179, 0, 0, 0, 0, 0, 0, 159, 298, 79, 89, 0, 0, 283, 0, 0, 136, 0, 0, 0, 276, 0, 0, 0, 0, 221,
    149, 0,
];
impl Quick {
    /// Are the `len` bytes at a and at b the same? `len` is from 1 to 16.
    #[inline(always)]
    fn is_same_word(&self, a: i32, b: i32, len: i32) -> bool {
        if len >= 8 {
            return self.t.u64_at(a) == self.t.u64_at(b)
                && self.t.u64_at(a + len - 8) == self.t.u64_at(b + len - 8);
        }
        (self.t.u64_at(a) ^ self.t.u64_at(b)).wrapping_shl(((8 - len) << 3) as u32) == 0
    }

    /// Sets tok and tok_kw for the name T[s, s + len), len >= 2, which has been taken for a plain name so far.
    #[inline(always)]
    pub(crate) fn classify_name(&mut self, s: i32, len: i32) {
        let h = (self.t.at(s) * KW_A
            + self.t.at(s + 1) * KW_B
            + self.t.at(s + len - 1) * KW_C
            + len * KW_D)
            & KW_MASK;
        let info = KW_INFO.at(h);
        if (info & 255) != len {
            return;
        }
        if !self.is_same_word(s, KW_TEXT.at(h), len) {
            return;
        }
        self.lexer.tok = (info >> 8) & 255;
        self.lexer.tok_kw = info >> 16;
    }

    /// For a reader of bytes (fast.rs): what the ASCII word T[s, s + len) is. 0 for a plain name, else its token | its contextual name << 8.
    #[inline]
    pub(crate) fn keyword_at(&self, s: i32, len: i32) -> i32 {
        let mut four = self.t.i32_at(s);
        if len < 4 {
            four &= 1_i32.wrapping_shl((len << 3) as u32) - 1;
        }
        let g = ((four.wrapping_mul(FOUR_MULTIPLIER) as u32) >> 25) as i32;
        if FOUR_KEY.at(g) != four {
            return 0;
        }
        let info = FOUR_INFO.at(g);
        if (info & 255) != len {
            return 0;
        }
        if !self.is_same_word(s, FOUR_TEXT.at(g), len) {
            return 0;
        }
        return info >> 8;
    }
}
/// How much to skip at a backslash with the byte `e` behind it, in a string, a template or a regular expression. What is not printable
/// ASCII is looked at like every other byte of the text: it may be no character, or have a width of its own.
#[inline(always)]
fn escape_length(e: i32) -> i32 {
    if e >= 32 && e < 127 { 2 } else { 1 }
}

/// A bit for each letter, from `a` on: d g i m s u v y
const REGEX_FLAGS: i32 = 0x01341148;
const REGEX_U_AND_V: i32 = 0x00300000;

impl Quick {
    /// Can the character of two to four bytes at `p` be in a name, or start one? As the long way's lexer asks: TypeScript's tables are
    /// those of an older Unicode than Babel's.
    fn is_in_name(&self, p: i32, is_first: bool) -> bool {
        let c = self.t.at(p);
        let code = if c < 0xe0 {
            ((c & 0x1f) << 6) | (self.t.at(p + 1) & 0x3f)
        } else if c < 0xf0 {
            ((c & 0x0f) << 12) | ((self.t.at(p + 1) & 0x3f) << 6) | (self.t.at(p + 2) & 0x3f)
        } else {
            ((c & 0x07) << 18)
                | ((self.t.at(p + 1) & 0x3f) << 12)
                | ((self.t.at(p + 2) & 0x3f) << 6)
                | (self.t.at(p + 3) & 0x3f)
        };
        let knows_recent = self.parse.typed != TYPED_TS;
        if is_first {
            is_identifier_start(code as u32) || (knows_recent && is_recent_identifier_start(code))
        } else {
            is_type_script_identifier_part(code)
                || (knows_recent && is_recent_identifier_part(code))
        }
    }

    /// Scans the rest of a name that has a non-ASCII byte or a backslash at p. Returns its end.
    pub(crate) fn slow_name(&mut self, mut p: i32) -> R<i32> {
        loop {
            let c = self.t.at(p);
            if c == 92 {
                // \uXXXX or \u{X}: which characters it may stand for, and which words it may spell, depends on the place
                return Err(self.text_refuse());
            } else if c >= 128 {
                if self.unicode_space(p) != 0 {
                    return Ok(p);
                }
                let length = self.character_length(p);
                if length == 0 {
                    return Err(self.fail(p));
                }
                if !self.is_in_name(p, p == self.lexer.pos) {
                    if p == self.lexer.pos {
                        return Err(self.fail(p));
                    }
                    return Ok(p);
                }
                self.lexer.tok_flags |= F_SLOW_TEXT;
                p += length;
            } else if (CT.at(c) & C_ID_PART) != 0 {
                p += 1;
            } else {
                return Ok(p);
            }
        }
    }

    pub(crate) fn read_name(&mut self) -> R<()> {
        let s = self.lexer.pos;
        let mut p = s;
        let mut c = self.t.at(p);
        while c < 128 && (CT.at(c) & C_ID_PART) != 0 {
            p += 1;
            c = self.t.at(p);
        }
        self.lexer.tok = tk::Name;
        self.lexer.tok_kw = kw::None;
        if c >= 128 || c == 92 {
            let e = self.slow_name(p)?;
            // white space beyond ASCII behind a word of the language
            if e == p && e - s >= 2 && e - s <= 10 {
                self.classify_name(s, e - s);
            }
            p = e;
        } else {
            let len = p - s;
            if len >= 2 && len <= 10 {
                self.classify_name(s, len);
            }
        }
        self.lexer.tok_end = p;
        self.lexer.pos = p;
        Ok(())
    }

    /// Is T[s, e), which read_number() has taken for a number, one? It has a separator, a prefix or a zero in front of its digits.
    #[cold]
    fn is_valid_odd_number(&self, s: i32, mut e: i32) -> bool {
        let d = self.t.at(s + 1) | 32;
        if self.t.at(e - 1) == 110 {
            e -= 1;
        }
        let mut from = s;
        let mut highest = 57;
        let mut letters = false;
        if self.t.at(s) == 48 && (d == 120 || d == 111 || d == 98) {
            from = s + 2;
            highest = if d == 98 {
                49
            } else if d == 111 {
                55
            } else {
                57
            };
            letters = d == 120;
            if from == e {
                return false;
            }
        } else if self.t.at(s) == 48 && s + 1 < e && d != (46 | 32) && d != 101 {
            // `010`, `08`: numbers of old in JavaScript, if there are digits and nothing else
            if self.parse.typed == TYPED_TS || self.t.at(e) == 110 {
                return false;
            }
            let mut p = s;
            while p < e {
                if (CT.at(self.t.at(p)) & C_DIGIT) == 0 {
                    return false;
                }
                p += 1;
            }
            return true;
        }
        // a separator stands between two digits
        let is_digit =
            |c: i32| (c >= 48 && c <= highest) || (letters && (CT.at(c) & C_HEX) != 0 && c > 57);
        let mut p = from;
        while p < e {
            let c = self.t.at(p);
            if c == 95 {
                if p == from || !is_digit(self.t.at(p - 1)) || !is_digit(self.t.at(p + 1)) {
                    return false;
                }
            } else if from != s && !is_digit(c) {
                return false;
            }
            p += 1;
        }
        true
    }

    pub(crate) fn read_number(&mut self) -> R<()> {
        let start = self.lexer.pos;
        let mut p = start;
        let mut type_ = tk::Num;
        let c = self.t.at(p);
        let d = self.t.at(p + 1) | 32;
        // a zero with something else than `.` behind it, or a separator
        let mut is_odd = c == 48 && (CT.at(d) & C_ID_PART) != 0;
        if c == 48 && (d == 120 || d == 111 || d == 98) {
            p += 2;
            while (CT.at(self.t.at(p)) & C_HEX) != 0 || self.t.at(p) == 95 {
                p += 1;
            }
            if self.t.at(p) == 110 {
                type_ = tk::BigInt;
                p += 1;
            }
        } else {
            while (CT.at(self.t.at(p)) & C_DIGIT) != 0 {
                p += 1;
            }
            if self.t.at(p) == 95 {
                is_odd = true;
                while (CT.at(self.t.at(p)) & C_DIGIT) != 0 || self.t.at(p) == 95 {
                    p += 1;
                }
            }
            if self.t.at(p) == 110 {
                type_ = tk::BigInt;
                p += 1;
            } else {
                if self.t.at(p) == 46 {
                    p += 1;
                    while (CT.at(self.t.at(p)) & C_DIGIT) != 0 || self.t.at(p) == 95 {
                        is_odd |= self.t.at(p) == 95;
                        p += 1;
                    }
                }
                if (self.t.at(p) | 32) == 101 {
                    let sign = self.t.at(p + 1);
                    let q = if sign == 43 || sign == 45 {
                        p + 2
                    } else {
                        p + 1
                    };
                    if (CT.at(self.t.at(q)) & C_DIGIT) != 0 {
                        p = q;
                        while (CT.at(self.t.at(p)) & C_DIGIT) != 0 || self.t.at(p) == 95 {
                            is_odd |= self.t.at(p) == 95;
                            p += 1;
                        }
                    }
                }
            }
        }
        if (CT.at(self.t.at(p)) & C_ID_START) != 0 && self.t.at(p) < 128 {
            return Err(self.fail(p));
        }
        if is_odd && !self.is_valid_odd_number(start, p) {
            return Err(self.fail(start));
        }
        self.lexer_finish(type_, p);
        Ok(())
    }
}
/// The token that a byte is whatever follows it: ( ) [ ] { } ; , ~ @ and the backquote. 0 for all others.
static ALONE: [u8; 128] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 12, 13, 0, 0, 17, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 0, 0,
    0, 0, 24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 14, 0,
    15, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10,
    0, 11, 45, 0,
];
impl Quick {
    /// Is the escape at p, a backslash before `x`, `u` or a digit, one that every parser takes? `legacy`: `\1` and the like are.
    #[cold]
    pub(crate) fn is_valid_escape(&self, p: i32, legacy: bool) -> bool {
        let is_hex = |q: i32| (CT.at(self.t.at(q)) & C_HEX) != 0;
        match self.t.at(p + 1) {
            120 => is_hex(p + 2) && is_hex(p + 3),
            117 => {
                if self.t.at(p + 2) != 123 {
                    return is_hex(p + 2) && is_hex(p + 3) && is_hex(p + 4) && is_hex(p + 5);
                }
                let mut q = p + 3;
                let mut value: i32 = 0;
                while is_hex(q) {
                    let c = self.t.at(q);
                    value = (value << 4) | (if c <= 57 { c - 48 } else { (c | 32) - 87 });
                    if value > 0x10ffff {
                        return false;
                    }
                    q += 1;
                }
                q != p + 3 && self.t.at(q) == 125
            }
            48 => legacy || (CT.at(self.t.at(p + 2)) & C_DIGIT) == 0,
            _ => legacy,
        }
    }

    #[inline(never)]
    pub(crate) fn read_string(&mut self, quote: i32) -> R<()> {
        let end = self.text.src_end;
        let start = self.lexer.pos;
        let mut p = start + 1;
        let mut flags: i32 = 0;
        loop {
            // up to a quote, a backslash, or what is not printable ASCII
            while p < end {
                let v = self.t.u128_at(p);
                let stops = where_not_printable(v)
                    | where_byte_is(v, b'"')
                    | where_byte_is(v, b'\'')
                    | where_byte_is(v, b'\\');
                if stops != 0 {
                    p += bytes_before(stops);
                    break;
                }
                p += 16;
            }
            let c = self.t.at(p);
            if c == quote {
                break;
            }
            if c == 92 {
                flags |= F_ESCAPE;
                let e = self.t.at(p + 1);
                if (e == 117 || e == 120 || (CT.at(e) & C_DIGIT) != 0)
                    && !self.is_valid_escape(p, self.parse.typed != TYPED_TS)
                {
                    return Err(self.fail(p));
                }
                p += if e == 10 { 2 } else { escape_length(e) };
                continue;
            }
            if c == 34 || c == 39 {
                flags |= F_QUOTE;
            } else if c < 32 || c >= 127 {
                if c == 10 || c == 13 || (c == 0 && p >= self.text.src_end) {
                    return Err(self.fail(start));
                }
                if c != 9 && self.is_odd_in_text(p) {
                    return Err(self.rare(rare::ODD_BYTES));
                }
                flags |= F_SLOW_TEXT;
                if c >= 128 {
                    let length = self.character_length(p);
                    if length == 0 {
                        return Err(self.text_refuse());
                    }
                    p += length;
                    continue;
                }
            }
            p += 1;
        }
        self.lexer.tok_flags = flags;
        self.lexer_finish(tk::String, p + 1);
        Ok(())
    }

    // The token behind the end, at `p`, of a comment of Flow whose text is code.
    pub(crate) fn next_behind_flow_comment(&mut self, p: i32) -> R<()> {
        self.stack()?;
        let end = self.lexer.tok_end;
        let nl = self.lexer.tok_nl;
        self.lexer.pos = p + 2;
        self.next()?;
        self.lexer.prev_end = end;
        self.lexer.tok_nl |= nl;
        Ok(())
    }

    pub(crate) fn next(&mut self) -> R<()> {
        self.lexer.prev_end = self.lexer.tok_end;
        let mut p = self.lexer.pos;
        // Most tokens follow the previous one at once or after one blank. Anything else is for skip_space().
        p += (self.t.at(p) == 32) as i32;
        let mut c = self.t.at(p);
        if c <= 32 || c == 47 || c >= 128 {
            self.lexer.pos = p;
            self.skip_space()?;
            p = self.lexer.pos;
            c = self.t.at(p);
            // (behind a `[` or a `,` it stands for a hole in an array)
            if c == 44
                && self.lexer.tok_nl != 0
                && !matches!(self.t.at(self.lexer.prev_end - 1), 91 | 44)
            {
                self.lexer.tok_start = p;
                return Err(self.rare(rare::COMMA));
            }
        } else {
            self.lexer.tok_nl = 0;
        }
        self.lexer.tok_start = p;
        self.lexer.tok_flags = 0;
        #[cfg(feature = "tally")]
        crate::tally::token(p);
        if (CT.at(c) & C_ASCII_START) != 0 {
            // nearly every second token
            return self.next_name(p, c);
        }
        let alone = ALONE.at(c);
        if alone != 0 {
            self.lexer_finish(alone, p + 1);
            return Ok(());
        }
        self.lexer.pos = p;
        self.next_of_many_kinds(p, c)
    }

    /// next() for a name, which starts at p with the letter, `_` or `$` `c`.
    #[inline(never)]
    fn next_name(&mut self, p: i32, c: i32) -> R<()> {
        let q = self.name_end(p + 1);
        let e = self.t.at(q);
        if e >= 128 || e == 92 {
            self.lexer.pos = p;
            return self.next_of_many_kinds(p, c);
        }
        self.lexer.tok = tk::Name;
        self.lexer.tok_kw = kw::None;
        self.lexer.tok_end = q;
        self.lexer.pos = q;
        let len = q - p;
        if (KW_LENGTHS.at(c).wrapping_shr(len as u32) & 1) != 0 {
            self.classify_name(p, len);
        }
        Ok(())
    }

    /// next() for what is neither a plain name nor a token of one byte: the token starts at p with `c`.
    #[inline(never)]
    fn next_of_many_kinds(&mut self, p: i32, c: i32) -> R<()> {
        match c {
            0 => {
                if p >= self.text.src_end {
                    self.lexer_finish(tk::EOF, p);
                    return Ok(());
                }
                return Err(self.fail(p));
            }
            58 => {
                if self.t.at(p + 1) == 58 {
                    self.lexer_finish(tk::DoubleColon, p + 2);
                } else {
                    self.lexer_finish(tk::Colon, p + 1);
                }
                return Ok(());
            }
            46 => {
                let d = self.t.at(p + 1);
                if d >= 48 && d <= 57 {
                    self.read_number()?;
                } else if d == 46 && self.t.at(p + 2) == 46 {
                    self.lexer_finish(tk::Ellipsis, p + 3);
                } else {
                    self.lexer_finish(tk::Dot, p + 1);
                }
                return Ok(());
            }
            34 | 39 => {
                self.read_string(c)?;
                return Ok(());
            }
            48..=57 => {
                self.read_number()?;
                return Ok(());
            }
            61 => {
                if self.t.at(p + 1) == 61 {
                    self.lexer_finish(
                        if self.t.at(p + 2) == 61 {
                            tk::EqEqEq
                        } else {
                            tk::EqEq
                        },
                        if self.t.at(p + 2) == 61 { p + 3 } else { p + 2 },
                    );
                } else if self.t.at(p + 1) == 62 {
                    self.lexer_finish(tk::Arrow, p + 2);
                } else {
                    self.lexer_finish(tk::Eq, p + 1);
                }
                return Ok(());
            }
            33 => {
                if self.t.at(p + 1) == 61 {
                    self.lexer_finish(
                        if self.t.at(p + 2) == 61 {
                            tk::NotEqEq
                        } else {
                            tk::NotEq
                        },
                        if self.t.at(p + 2) == 61 { p + 3 } else { p + 2 },
                    );
                } else {
                    self.lexer_finish(tk::Not, p + 1);
                }
                return Ok(());
            }
            43 => {
                if self.t.at(p + 1) == 43 {
                    self.lexer_finish(tk::Inc, p + 2);
                } else if self.t.at(p + 1) == 61 {
                    self.lexer_finish(tk::AddEq, p + 2);
                } else {
                    self.lexer_finish(tk::Add, p + 1);
                }
                return Ok(());
            }
            45 => {
                if self.t.at(p + 1) == 45 {
                    // and so does `-->` at the start of a line
                    if self.t.at(p + 2) == 62 {
                        return Err(self.text_refuse());
                    }
                    self.lexer_finish(tk::Dec, p + 2);
                } else if self.t.at(p + 1) == 61 {
                    self.lexer_finish(tk::SubEq, p + 2);
                } else {
                    self.lexer_finish(tk::Sub, p + 1);
                }
                return Ok(());
            }
            42 => {
                if self.t.at(p + 1) == 42 {
                    if self.t.at(p + 2) == 61 {
                        self.lexer_finish(tk::PowEq, p + 3);
                    } else {
                        self.lexer_finish(tk::Pow, p + 2);
                    }
                } else if self.t.at(p + 1) == 61 {
                    self.lexer_finish(tk::MulEq, p + 2);
                } else if p == self.lexer.flow_comment_end {
                    self.next_behind_flow_comment(p)?;
                } else {
                    self.lexer_finish(tk::Mul, p + 1);
                }
                return Ok(());
            }
            47 => {
                if self.t.at(p + 1) == 61 {
                    self.lexer_finish(tk::DivEq, p + 2);
                } else {
                    self.lexer_finish(tk::Div, p + 1);
                }
                return Ok(());
            }
            37 => {
                if self.t.at(p + 1) == 61 {
                    self.lexer_finish(tk::ModEq, p + 2);
                } else {
                    self.lexer_finish(tk::Mod, p + 1);
                }
                return Ok(());
            }
            60 => {
                if self.t.at(p + 1) == 60 {
                    if self.t.at(p + 2) == 61 {
                        self.lexer_finish(tk::ShlEq, p + 3);
                    } else {
                        self.lexer_finish(tk::Shl, p + 2);
                    }
                } else if self.t.at(p + 1) == 61 {
                    self.lexer_finish(tk::LtEq, p + 2);
                } else {
                    // `<!--` starts a comment in a script
                    if self.t.at(p + 1) == 33 && self.t.at(p + 2) == 45 && self.t.at(p + 3) == 45 {
                        return Err(self.text_refuse());
                    }
                    if self.t.at(p + 1) == 47
                        && self.t.at(p + 2) != 42
                        && self.parse.jsx_enabled
                        && self.parse.typed == TYPED_TS
                    {
                        // `<// comment`: one token, `</`, for TypeScript in a file with JSX
                        return Err(self.text_refuse());
                    }
                    self.lexer_finish(tk::Lt, p + 1);
                }
                return Ok(());
            }
            62 => {
                if self.t.at(p + 1) == 62 {
                    if self.t.at(p + 2) == 62 {
                        if self.t.at(p + 3) == 61 {
                            self.lexer_finish(tk::UShrEq, p + 4);
                        } else {
                            self.lexer_finish(tk::UShr, p + 3);
                        }
                    } else if self.t.at(p + 2) == 61 {
                        self.lexer_finish(tk::ShrEq, p + 3);
                    } else {
                        self.lexer_finish(tk::Shr, p + 2);
                    }
                } else if self.t.at(p + 1) == 61 {
                    self.lexer_finish(tk::GtEq, p + 2);
                } else {
                    self.lexer_finish(tk::Gt, p + 1);
                }
                return Ok(());
            }
            38 => {
                if self.t.at(p + 1) == 38 {
                    if self.t.at(p + 2) == 61 {
                        self.lexer_finish(tk::LAndEq, p + 3);
                    } else {
                        self.lexer_finish(tk::LAnd, p + 2);
                    }
                } else if self.t.at(p + 1) == 61 {
                    self.lexer_finish(tk::AndEq, p + 2);
                } else {
                    self.lexer_finish(tk::BitAnd, p + 1);
                }
                return Ok(());
            }
            124 => {
                if self.t.at(p + 1) == 124 {
                    if self.t.at(p + 2) == 61 {
                        self.lexer_finish(tk::LOrEq, p + 3);
                    } else {
                        self.lexer_finish(tk::LOr, p + 2);
                    }
                } else if self.t.at(p + 1) == 61 {
                    self.lexer_finish(tk::OrEq, p + 2);
                } else if self.t.at(p + 1) == 62 {
                    self.lexer_finish(tk::Pipeline, p + 2);
                } else {
                    self.lexer_finish(tk::BitOr, p + 1);
                }
                return Ok(());
            }
            94 => {
                if self.t.at(p + 1) == 61 {
                    self.lexer_finish(tk::XorEq, p + 2);
                } else {
                    self.lexer_finish(tk::BitXor, p + 1);
                }
                return Ok(());
            }
            63 => {
                {
                    // ?
                    let d = self.t.at(p + 1);
                    if d == 63 {
                        if self.t.at(p + 2) == 61 {
                            self.lexer_finish(tk::NullishEq, p + 3);
                        } else {
                            self.lexer_finish(tk::Nullish, p + 2);
                        }
                    } else if d == 46 && !(self.t.at(p + 2) >= 48 && self.t.at(p + 2) <= 57) {
                        self.lexer_finish(tk::QuestionDot, p + 2);
                    } else {
                        self.lexer_finish(tk::Question, p + 1);
                    }
                    return Ok(());
                }
            }
            35 => {
                {
                    // #name
                    self.lexer.pos = p + 1;
                    let d = self.t.at(self.lexer.pos);
                    if (CT.at(d) & C_ID_START) == 0 && d != 92 {
                        return Err(self.fail(p));
                    }
                    self.read_name()?;
                    self.lexer.tok = tk::PrivateName;
                    self.lexer.tok_kw = kw::None;
                    return Ok(());
                }
            }
            _ => {
                if (CT.at(c) & C_ID_START) != 0 || c == 92 {
                    self.read_name()?;
                    return Ok(());
                }
                return Err(self.fail(p));
            }
        }
    }

    /// The parser saw `/` or `/=` where an expression starts: read it again as a regular expression.
    pub(crate) fn rescan_regex(&mut self) -> R<()> {
        let start = self.lexer.tok_start;
        let mut p = start + 1;
        let mut in_class = false;
        let mut flags: i32 = 0;
        loop {
            let c = self.t.at(p);
            if c == 10 || c == 13 || (c == 0 && p >= self.text.src_end) {
                return Err(self.fail(start));
            }
            if c == 92 {
                if self.t.at(p + 1) == 10 || self.is_line_separator(p + 1) {
                    return Err(self.fail(start));
                }
                p += escape_length(self.t.at(p + 1));
                continue;
            }
            if c == 91 {
                in_class = true;
            } else if c == 93 {
                in_class = false;
            } else if c == 47 && !in_class {
                break;
            } else if c < 32 || c >= 127 {
                if c != 9 && self.is_odd_in_text(p) {
                    return Err(self.rare(rare::ODD_BYTES));
                }
                flags |= F_SLOW_TEXT;
                if c >= 128 {
                    let length = self.character_length(p);
                    if length == 0 {
                        return Err(self.text_refuse());
                    }
                    p += length;
                    continue;
                }
            }
            p += 1;
        }
        p += 1;
        // d g i m s u v y, each once, and not both u and v. TypeScript's parser leaves that to others.
        let mut seen: i32 = 0;
        while (CT.at(self.t.at(p)) & C_ID_PART) != 0 && self.t.at(p) < 128 {
            let bit = 1_i32.wrapping_shl((self.t.at(p) - 97) as u32);
            if self.t.at(p) < 97 || (bit & REGEX_FLAGS) == 0 || (seen & bit) != 0 {
                seen = -1;
            }
            seen |= bit;
            p += 1;
        }
        if self.parse.typed != TYPED_TS && (seen == -1 || (seen & REGEX_U_AND_V) == REGEX_U_AND_V) {
            return Err(self.fail(start));
        }
        self.lexer.tok_flags = flags;
        self.lexer_finish(tk::Regex, p);
        Ok(())
    }

    /// Reads the characters of a template from `from` up to "`" or "${". tok_start..tok_end become the raw text, tok_flags says
    /// whether it is the tail, and `pos` stands behind the delimiter.
    pub(crate) fn scan_template_chunk(&mut self, from: i32) -> R<()> {
        let mut p = from;
        let mut flags: i32 = 0;
        loop {
            // To the next "`", "$", "\\" or byte that is not printable ASCII, which most often is on this line.
            let near = p + 64;
            loop {
                let v = self.t.u128_at(p);
                let stops = where_not_printable(v)
                    | where_byte_is(v, b'`')
                    | where_byte_is(v, b'$')
                    | where_byte_is(v, b'\\');
                if stops != 0 {
                    p += bytes_before(stops);
                    break;
                }
                p += 16;
                if p == near {
                    p += match strings::index_of_needs_escape_for_java_script_string(
                        self.t.sub(p, self.text.src_end),
                        b'`',
                    ) {
                        Some(plain) => plain as i32,
                        None => self.text.src_end - p,
                    };
                    break;
                }
            }
            let c = self.t.at(p);
            if c == 96 {
                flags |= F_TAIL;
                break;
            }
            if c == 36 && self.t.at(p + 1) == 123 {
                break;
            }
            if c == 92 {
                flags |= F_ESCAPE;
                // (with a tag in front of the template it would not mind)
                if self.lang.lang == lang::Flow {
                    let e = self.t.at(p + 1);
                    if (e == 117 || e == 120 || (CT.at(e) & C_DIGIT) != 0)
                        && !self.is_valid_escape(p, false)
                    {
                        return Err(self.text_refuse());
                    }
                }
                p += escape_length(self.t.at(p + 1));
                continue;
            }
            if c < 32 || c >= 127 {
                if c == 0 && p >= self.text.src_end {
                    return Err(self.fail(from));
                }
                if c != 9 && c != 10 {
                    if self.is_odd_in_text(p) {
                        return Err(self.rare(rare::ODD_BYTES));
                    }
                }
                flags |= F_SLOW_TEXT;
                if c >= 128 {
                    let length = self.character_length(p);
                    if length == 0 {
                        return Err(self.text_refuse());
                    }
                    p += length;
                    continue;
                }
            }
            p += 1;
        }
        self.lexer.tok_start = from;
        self.lexer.tok_end = p;
        self.lexer.tok_flags = flags;
        self.lexer.pos = if (flags & F_TAIL) != 0 { p + 1 } else { p + 2 };
        Ok(())
    }

    // ---- JSX
    /// A token inside a tag: a name with dashes, a string without escapes, or punctuation.
    pub(crate) fn next_jsx_tag(&mut self) -> R<()> {
        self.lexer.prev_end = self.lexer.tok_end;
        self.skip_space()?;
        let p = self.lexer.pos;
        self.lexer.tok_start = p;
        self.lexer.tok_flags = 0;
        let c = self.t.at(p);
        if (CT.at(c) & C_ID_START) != 0 {
            let mut q = p;
            let mut has_hyphen = false;
            loop {
                let d = self.t.at(q);
                if (CT.at(d) & C_ID_PART) != 0 || d == 45 {
                    if d >= 128 {
                        if self.unicode_space(q) != 0 {
                            break;
                        }
                        self.lexer.tok_flags |= F_SLOW_TEXT;
                        let length = self.character_length(q);
                        // (behind a `-` one of the long way's parsers reads ASCII only: the one for Flow, and for what the other one rejects)
                        if length == 0 || !self.is_in_name(q, q == p) || has_hyphen {
                            return Err(self.text_refuse());
                        }
                        q += length;
                        continue;
                    }
                    has_hyphen |= d == 45;
                    q += 1;
                } else {
                    break;
                }
            }
            self.lexer_finish(tk::JSXName, q);
            return Ok(());
        }
        match c {
            34 | 39 => {
                {
                    let mut q = p + 1;
                    let mut flags: i32 = 0;
                    loop {
                        let d = self.t.at(q);
                        if d == c {
                            break;
                        }
                        if d == 34 || d == 39 {
                            flags |= F_QUOTE;
                        } else if d < 32 || d >= 127 {
                            if d == 0 && q >= self.text.src_end {
                                return Err(self.fail(p));
                            }
                            if d != 9 && d != 10 {
                                if self.is_odd_in_text(q) {
                                    return Err(self.rare(rare::ODD_BYTES));
                                }
                            }
                            flags |= F_SLOW_TEXT;
                            if d >= 128 {
                                let length = self.character_length(q);
                                if length == 0 {
                                    return Err(self.text_refuse());
                                }
                                q += length;
                                continue;
                            }
                        } else if d == 38 {
                            // an entity
                            flags |= F_ESCAPE;
                        }
                        q += 1;
                    }
                    self.lexer.tok_flags = flags;
                    self.lexer_finish(tk::String, q + 1);
                    return Ok(());
                }
            }
            60 => {
                self.lexer_finish(tk::Lt, p + 1);
                return Ok(());
            }
            62 => {
                self.lexer_finish(tk::Gt, p + 1);
                return Ok(());
            }
            47 => {
                self.lexer_finish(tk::Div, p + 1);
                return Ok(());
            }
            61 => {
                self.lexer_finish(tk::Eq, p + 1);
                return Ok(());
            }
            123 => {
                self.lexer_finish(tk::BraceL, p + 1);
                return Ok(());
            }
            125 => {
                self.lexer_finish(tk::BraceR, p + 1);
                return Ok(());
            }
            46 => {
                self.lexer_finish(tk::Dot, p + 1);
                return Ok(());
            }
            58 => {
                self.lexer_finish(tk::Colon, p + 1);
                return Ok(());
            }
            _ => {}
        }
        return Err(self.fail(p));
    }

    /// A token between tags: text up to `{` or `<`, or one of those two.
    pub(crate) fn next_jsx_child(&mut self) -> R<()> {
        self.lexer.prev_end = self.lexer.tok_end;
        let p = self.lexer.pos;
        self.lexer.tok_start = p;
        self.lexer.tok_flags = 0;
        self.lexer.tok_nl = 0;
        let c = self.t.at(p);
        if c == 123 {
            self.lexer_finish(tk::BraceL, p + 1);
            return Ok(());
        }
        if c == 60 {
            self.lexer_finish(tk::Lt, p + 1);
            return Ok(());
        }
        let mut q = p;
        let mut flags: i32 = 0;
        if c == 10 {
            // the end of a line and the indentation of the next one: most of what stands between tags
            let mut lines: i32 = 0;
            loop {
                let d = self.t.at(q);
                if d == 10 {
                    lines += 1;
                } else if d != 32 {
                    break;
                }
                q += 1;
            }
            flags = F_SLOW_TEXT;
            if self.t.at(q) == 60 || self.t.at(q) == 123 {
                self.lexer.tok_flags = if lines > 1 {
                    F_SLOW_TEXT | F_BLANK | F_BLANK_LINE
                } else {
                    F_SLOW_TEXT | F_BLANK
                };
                self.lexer_finish(tk::JSXText, q);
                return Ok(());
            }
        }
        loop {
            let d = self.t.at(q);
            if d == 123 || d == 60 {
                break;
            }
            if d < 32 || d >= 127 {
                if d == 0 {
                    return Err(self.fail(p));
                }
                if d != 9 && d != 10 {
                    if self.is_odd_in_text(q) {
                        return Err(self.rare(rare::ODD_BYTES));
                    }
                }
                flags |= F_SLOW_TEXT;
                if d >= 128 {
                    // (no white space for JSX, but the long way trims it, also what only TypeScript takes for white space)
                    if self.unicode_space(q) != 0
                        || (d == 0xc2 && self.t.at(q + 1) == 0x85)
                        || (d == 0xe2 && self.t.at(q + 1) == 0x80 && self.t.at(q + 2) == 0x8b)
                    {
                        return Err(self.rare(rare::ODD_BYTES));
                    }
                    let length = self.character_length(q);
                    if length == 0 {
                        return Err(self.text_refuse());
                    }
                    q += length;
                    continue;
                }
            } else if (d == 62 || d == 125) && !self.lexer.lenient_jsx_text {
                return Err(self.fail(q));
            }
            q += 1;
        }
        self.lexer.tok_flags = flags;
        self.lexer_finish(tk::JSXText, q);
        Ok(())
    }

    pub(crate) fn set_pos(&mut self, p: i32) {
        self.lexer.pos = p;
        self.lexer.tok_end = p;
    }

    /// The token at p, the first of its line, behind something that ended at `behind`; between the two there may be comments, which have been read.
    pub(crate) fn next_at(&mut self, p: i32, behind: i32) -> R<()> {
        self.lexer.pos = p;
        self.lexer.tok_end = behind;
        self.next()?;
        self.lexer.tok_nl = 1;
        Ok(())
    }

    /// The current token is the `{` at p: somebody else has found it.
    pub(crate) fn at_brace(&mut self, p: i32) {
        self.lexer.tok = tk::BraceL;
        self.lexer.tok_start = p;
        self.lexer.tok_end = p + 1;
        self.lexer.pos = p + 1;
        self.lexer.tok_nl = 0;
        self.lexer.tok_flags = 0;
    }
}
