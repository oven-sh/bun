//! Prettier's little text scanners (src/utilities/skip*.js and friends), over the byte buffer.
//! The bytes around the source are zeros, so running off either end stops every loop by itself.

use crate::lexer::{C_END, C_START, C_STRIDE};
use crate::{Bytes, ONES, Quick, Words, bytes_before, where_byte_is};
use bun_core::strings;

// What is white space, where a line ends and which line is empty has one answer here, for everybody who looks at the bytes: that of the
// lexer and of the long way. The ends of the lines are "\n" when a text gets here. The lexer takes blanks, tabs and "\n" between tokens, and
// refuses a text with any other white space between tokens or in a comment, with a control character, U+2028 or U+2029 (rare::ODD_BYTES).
// Who reads without it (fast.rs, stands.rs) stops at what is none of the three, or asks is_odd_space() and ends_in_space().

/// A blank or a tab: what skipSpaces() skips. A line with nothing else on it is empty.
#[inline(always)]
pub(crate) fn is_blank(c: i32) -> bool {
    c == 32 || c == 9
}

/// A blank, a tab or the end of a line.
#[inline(always)]
pub(crate) fn is_white(c: i32) -> bool {
    c == 32 || c == 9 || c == 10
}

/// The white space of ASCII, as `\s` and trim() have it.
#[inline(always)]
pub(crate) fn is_space(c: i32) -> bool {
    c == 32 || (c >= 9 && c <= 13)
}

impl Quick {
    /// Where the blanks and tabs in front of p start.
    pub(crate) fn blanks_back(&self, mut p: i32) -> i32 {
        while is_blank(self.t.at(p - 1)) {
            p -= 1;
        }
        return p;
    }

    /// Where the blanks and tabs from p on end.
    pub(crate) fn blanks(&self, mut p: i32) -> i32 {
        while is_blank(self.t.at(p)) {
            p += 1;
        }
        return p;
    }

    /// Where the blanks, tabs and ends of lines from p on end.
    pub(crate) fn white(&self, mut p: i32) -> i32 {
        while is_white(self.t.at(p)) {
            p += 1;
        }
        return p;
    }

    /// Where the blanks from `p` on end: U+0020 and nothing else. Whoever asks looks at what follows, which can be a tab.
    #[inline(always)]
    pub(crate) fn blanks_end(&self, mut p: i32) -> i32 {
        loop {
            let others = self.t.u64_at(p) ^ ONES.wrapping_mul(32);
            if others != 0 {
                return p + (others.trailing_zeros() >> 3) as i32;
            }
            p += 8;
        }
    }

    /// Where the blanks and tabs from `p`, the start of a line, on end. The line is empty if it ends there.
    #[inline(always)]
    pub(crate) fn indentation_end(&self, p: i32) -> i32 {
        let q = self.blanks_end(p);
        if self.t.at(q) == 9 { self.blanks(q) } else { q }
    }

    /// Where the blanks that end at `p` start: U+0020 and nothing else.
    #[inline(always)]
    pub(crate) fn blanks_start(&self, mut p: i32) -> i32 {
        loop {
            let others = self.t.u64_at(p - 8) ^ ONES.wrapping_mul(32);
            if others != 0 {
                return p - (others.leading_zeros() >> 3) as i32;
            }
            p -= 8;
        }
    }

    /// Where the blanks (U+0020 and nothing else) and ends of lines from `p` on end.
    #[inline(always)]
    pub(crate) fn blank_lines_end(&self, mut p: i32) -> i32 {
        loop {
            p = self.blanks_end(p);
            if self.t.at(p) != 10 {
                return p;
            }
            p += 1;
        }
    }

    /// Does the line of a comment that ends at `q` end in something that is trimmed? Control characters count as such.
    #[inline(always)]
    pub(crate) fn ends_in_space(&self, q: i32) -> bool {
        let c = self.t.at(q - 1);
        c <= 32 || (c >= 127 && self.ends_in_space_beyond_ascii(q))
    }

    /// Does white space start at `p` that is no blank? Control characters count as such.
    #[inline(always)]
    pub(crate) fn is_odd_space(&self, p: i32) -> bool {
        let c = self.t.at(p);
        (c < 32 || c >= 127) && (c <= 127 || self.unicode_space(p) != 0)
    }

    #[cold]
    fn ends_in_space_beyond_ascii(&self, q: i32) -> bool {
        self.t.at(q - 1) == 127
            || self.unicode_space(q - 2) == 2
            || (self.unicode_space(q - 3) & 15) == 3
    }

    /// blanks(), where there may be many of them.
    pub(crate) fn skip_spaces(&self, mut p: i32) -> i32 {
        if !is_blank(self.t.at(p)) {
            return p;
        }
        // mostly the indentation of a line
        loop {
            p = self.blanks_end(p);
            if self.t.at(p) != 9 {
                return p;
            }
            p += 1;
        }
    }

    pub(crate) fn skip_spaces_back(&self, mut p: i32) -> i32 {
        while is_blank(self.t.at(p)) {
            p -= 1;
        }
        return p;
    }

    pub(crate) fn skip_newline(&self, p: i32) -> i32 {
        let c = self.t.at(p);
        if c == 10 {
            return p + 1;
        }
        if c == 13 {
            return if self.t.at(p + 1) == 10 { p + 2 } else { p + 1 };
        }
        if c == 0xe2
            && self.t.at(p + 1) == 0x80
            && (self.t.at(p + 2) == 0xa8 || self.t.at(p + 2) == 0xa9)
        {
            return p + 3;
        }
        return p;
    }

    pub(crate) fn skip_newline_back(&self, p: i32) -> i32 {
        let c = self.t.at(p);
        if c == 10 {
            return if self.t.at(p - 1) == 13 { p - 2 } else { p - 1 };
        }
        if c == 13 {
            return p - 1;
        }
        if (c == 0xa8 || c == 0xa9) && self.t.at(p - 1) == 0x80 && self.t.at(p - 2) == 0xe2 {
            return p - 3;
        }
        return p;
    }

    pub(crate) fn has_newline(&self, p: i32) -> bool {
        let c = self.t.at(p);
        if c == 10 {
            return true;
        }
        if c > 32 && c < 0xe2 {
            return false;
        }
        let q = self.skip_spaces(p);
        return self.skip_newline(q) != q;
    }

    pub(crate) fn has_newline_before(&self, p: i32) -> bool {
        let q = self.skip_spaces_back(p - 1);
        return self.skip_newline_back(q) != q;
    }

    pub(crate) fn has_newline_in_range(&self, start: i32, end: i32) -> bool {
        self.has_byte_in_range(10, start, end)
    }

    #[inline]
    pub(crate) fn has_byte_in_range(&self, byte: u8, start: i32, end: i32) -> bool {
        let mut p = start;
        while p < end {
            let found = where_byte_is(self.t.u128_at(p), byte);
            if found != 0 {
                return p + bytes_before(found) < end;
            }
            p += 16;
        }
        return false;
    }

    /// Where `byte` is in T[start, end); `end` if it is not. Most often it is near.
    pub(crate) fn index_of_byte_in_range(&self, byte: u8, start: i32, end: i32) -> i32 {
        let mut p = start;
        while p < end {
            let found = where_byte_is(self.t.u128_at(p), byte);
            if found != 0 {
                return end.min(p + bytes_before(found));
            }
            p += 16;
            if p == start + 64 {
                return match strings::index_of_char(self.t.sub(p, end), byte) {
                    Some(more) => p + more as i32,
                    None => end,
                };
            }
        }
        return end;
    }

    pub(crate) fn skip_inline_comment(&self, p: i32) -> i32 {
        if self.t.at(p) == 47 && self.t.at(p + 1) == 42 {
            let mut i = p + 2;
            while i < self.text.src_end {
                if self.t.at(i) == 42 && self.t.at(i + 1) == 47 {
                    return i + 2;
                }
                i += 1;
            }
        }
        return p;
    }

    pub(crate) fn skip_trailing_comment(&self, mut p: i32) -> i32 {
        if self.t.at(p) == 47 && self.t.at(p + 1) == 47 {
            while p < self.text.src_end && self.t.at(p) != 10 && self.t.at(p) != 13 {
                p += 1;
            }
        }
        return p;
    }

    pub(crate) fn is_next_line_empty_after(&self, mut p: i32) -> bool {
        let mut c = self.t.at(p);
        loop {
            while c == 44 || c == 59 || c == 32 || c == 9 {
                p += 1;
                c = self.t.at(p);
            }
            if c != 47 {
                break;
            }
            let q = self.skip_inline_comment(p);
            if q == p {
                break;
            }
            p = q;
            c = self.t.at(p);
        }
        if c == 10 {
            return self.has_newline(p + 1);
        }
        p = self.skip_trailing_comment(p);
        p = self.skip_newline(p);
        return self.has_newline(p);
    }

    pub(crate) fn is_previous_line_empty_before(&self, p: i32) -> bool {
        let mut q = p - 1;
        q = self.skip_spaces_back(q);
        q = self.skip_newline_back(q);
        q = self.skip_spaces_back(q);
        return self.skip_newline_back(q) != q;
    }

    /// getNextNonSpaceNonCommentCharacterIndex
    pub(crate) fn next_char_index(&self, mut p: i32) -> i32 {
        let c = self.t.at(p);
        if c > 32 && c != 47 && c < 0xe2 {
            return p;
        }
        let mut old: i32 = -1;
        while p != old {
            old = p;
            p = self.skip_spaces(p);
            p = self.skip_inline_comment(p);
            p = self.skip_trailing_comment(p);
            p = self.skip_newline(p);
        }
        return p;
    }

    /// getNextNonSpaceNonCommentCharacter, as a byte; 0 at the end.
    pub(crate) fn next_char(&self, p: i32) -> i32 {
        return self.t.at(self.next_char_index(p));
    }

    // ---- the text with its comments blanked out (stripComments)
    /// If `p` lies in a comment, the index of that comment, else -1.
    pub(crate) fn comment_at(&self, p: i32) -> i32 {
        let mut lo = self.lexer.c_base;
        let mut hi = self.lexer.c_count - 1;
        while lo <= hi {
            let mid = (lo + hi) >> 1;
            let at = mid * C_STRIDE;
            if p < self.lexer.c.at(at + C_START) {
                hi = mid - 1;
            } else if p >= self.lexer.c.at(at + C_END) {
                lo = mid + 1;
            } else {
                return mid;
            }
        }
        return -1;
    }
}
impl Quick {
    /// The first byte at or behind `p` that is neither white space nor in a comment; 0 at the end.
    pub(crate) fn next_significant_char(&self, mut p: i32) -> i32 {
        loop {
            let c = self.t.at(p);
            if is_space(c) {
                p += 1;
                continue;
            }
            if c == 0 {
                return 0;
            }
            let comment = self.comment_at(p);
            if comment < 0 {
                return c;
            }
            p = self.lexer.c.at(comment * C_STRIDE + C_END);
        }
    }

    /// Where the first byte at or behind `p` stands that is neither white space nor in a comment; the end of the text if there is none.
    pub(crate) fn next_significant_index(&self, mut p: i32) -> i32 {
        loop {
            let c = self.t.at(p);
            if is_space(c) {
                p += 1;
                continue;
            }
            if c == 0 {
                return p;
            }
            let comment = self.comment_at(p);
            if comment < 0 {
                return p;
            }
            p = self.lexer.c.at(comment * C_STRIDE + C_END);
        }
    }

    /// stripComments(text).indexOf(byte, from); -1 if there is none.
    pub(crate) fn index_of_outside_comments(&self, byte: i32, from: i32) -> i32 {
        let mut p = from;
        while p < self.text.src_end {
            if self.t.at(p) == byte {
                let comment = self.comment_at(p);
                if comment < 0 {
                    return p;
                }
                p = self.lexer.c.at(comment * C_STRIDE + C_END);
            } else {
                p += 1;
            }
        }
        return -1;
    }

    /// stripComments(text).lastIndexOf(byte, from); -1 if there is none.
    pub(crate) fn last_index_of_outside_comments(&self, byte: i32, from: i32) -> i32 {
        let mut p = from;
        loop {
            let c = self.t.at(p);
            if c == 0 {
                return -1;
            }
            if c == byte {
                let comment = self.comment_at(p);
                if comment < 0 {
                    return p;
                }
                p = self.lexer.c.at(comment * C_STRIDE + C_START) - 1;
            } else {
                p -= 1;
            }
        }
    }
}
