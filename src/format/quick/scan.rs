//! Prettier's little text scanners (src/utilities/skip*.js and friends), over the byte buffer.
//! The bytes around the source are zeros, so running off either end stops every loop by itself.

use crate::lexer::{C_END, C_START, C_STRIDE};
use crate::{Bytes, Quick, Words, bytes_before, where_byte_is};

impl Quick {
    pub(crate) fn skip_spaces(&self, mut p: i32) -> i32 {
        let c = self.t.at(p);
        if c != 32 && c != 9 {
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
        while self.t.at(p) == 32 || self.t.at(p) == 9 {
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
        let mut p = start;
        while p < end {
            let found = where_byte_is(self.t.u128_at(p), 10);
            if found != 0 {
                return p + bytes_before(found) < end;
            }
            p += 16;
        }
        return false;
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
pub(crate) fn scan_is_space_byte(c: i32) -> bool {
    return c == 32 || c == 9 || c == 10 || c == 13 || c == 11 || c == 12;
}

impl Quick {
    /// The last byte before `p` that is neither white space nor in a comment; 0 at the start.
    pub(crate) fn previous_significant_char(&self, mut p: i32) -> i32 {
        p -= 1;
        loop {
            let c = self.t.at(p);
            if scan_is_space_byte(c) {
                p -= 1;
                continue;
            }
            if c == 0 {
                return 0;
            }
            let comment = self.comment_at(p);
            if comment < 0 {
                return c;
            }
            p = self.lexer.c.at(comment * C_STRIDE + C_START) - 1;
        }
    }

    /// The first byte at or behind `p` that is neither white space nor in a comment; 0 at the end.
    pub(crate) fn next_significant_char(&self, mut p: i32) -> i32 {
        loop {
            let c = self.t.at(p);
            if scan_is_space_byte(c) {
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
            if scan_is_space_byte(c) {
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
