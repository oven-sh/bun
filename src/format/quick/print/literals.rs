//! Strings, numbers and regular expressions. The common case prints a slice of the source; only a literal that has to
//! change is written anew, into the generated part of the text buffer.

use crate::ast::{F_ESCAPE, F_QUOTE, F_SLOW_TEXT};
use crate::print::statics::{DQUOTE, SQUOTE};
use crate::{Quick, Words};

impl Quick {
    /// Prints T[start, end) with a literal line break for every "\n" in it.
    pub(crate) fn slice_with_newlines(&mut self, start: i32, end: i32) {
        let mut from = start;
        loop {
            let line_end = self.index_of_byte_in_range(b'\n', from, end);
            self.slice_any(from, line_end);
            if line_end == end {
                return;
            }
            self.literalline();
            from = line_end + 1;
        }
    }

    /// getPreferredQuote over T[start, end). Returns the quote character.
    pub(crate) fn preferred_quote(&self, start: i32, end: i32, prefer_single: bool) -> i32 {
        let preferred = if prefer_single { 39 } else { 34 };
        let alternate = if prefer_single { 34 } else { 39 };
        let mut preferred_count: i32 = 0;
        let mut alternate_count: i32 = 0;
        let mut p = start;
        while p < end {
            let c = self.t.at(p);
            if c == preferred {
                preferred_count += 1;
            } else if c == alternate {
                alternate_count += 1;
            }
            p += 1;
        }
        return if preferred_count > alternate_count {
            alternate
        } else {
            preferred
        };
    }

    /// makeString: writes the content between new quotes into the generated area and prints it.
    pub(crate) fn requote(&mut self, start: i32, end: i32, quote: i32) {
        self.reserve_gen((end - start) * 2 + 2);
        let from = self.text.gen_pos;
        let other = if quote == 34 { 39 } else { 34 };
        self.gen_byte(quote);
        let mut has_newline = false;
        let mut p = start;
        while p < end {
            let c = self.t.at(p);
            if c == 92 {
                let d = self.t.at(p + 1);
                if d == other {
                    self.gen_byte(other);
                    p += 1;
                } else if d == quote || d == 92 {
                    self.gen_byte(92);
                    self.gen_byte(d);
                    p += 1;
                } else {
                    self.gen_byte(92);
                }
            } else if c == quote {
                self.gen_byte(92);
                self.gen_byte(c);
            } else {
                if c == 10 {
                    has_newline = true;
                }
                self.gen_byte(c);
            }
            p += 1;
        }
        self.gen_byte(quote);
        if has_newline {
            self.slice_with_newlines(from, self.text.gen_pos);
        } else {
            self.slice_any(from, self.text.gen_pos);
        }
    }

    /// printString for the literal T[start, end) whose node flags are `flags`.
    pub(crate) fn print_string_range(
        &mut self,
        start: i32,
        end: i32,
        flags: i32,
        prefer_single: bool,
    ) {
        let original = self.t.at(start);
        if (flags & (F_ESCAPE | F_QUOTE)) == 0 {
            let preferred = if prefer_single { 39 } else { 34 };
            if original == preferred {
                if (flags & F_SLOW_TEXT) == 0 {
                    self.slice(start, end);
                } else {
                    self.slice_any(start, end);
                }
                return;
            }
            // The other quotes go into the source itself, and the literal is one text.
            self.t.put(start, preferred);
            self.t.put(end - 1, preferred);
            if (flags & F_SLOW_TEXT) == 0 {
                self.slice(start, end);
            } else {
                self.slice_any(start, end);
            }
            return;
        }
        let quote = self.preferred_quote(start + 1, end - 1, prefer_single);
        if quote == original {
            if (flags & F_ESCAPE) != 0 {
                self.slice_with_newlines(start, end);
            } else {
                self.slice_any(start, end);
            }
            return;
        }
        self.requote(start + 1, end - 1, quote);
    }

    pub(crate) fn print_string_literal(&mut self, n: i32) {
        self.print_string_range(
            self.n.at(n + 1),
            self.n.at(n + 2),
            self.n.at(n),
            self.options.single_quote,
        );
    }

    pub(crate) fn print_directive_literal(&mut self, n: i32) {
        let start = self.n.at(n + 1);
        let end = self.n.at(n + 2);
        let mut has_quote = false;
        let mut p = start + 1;
        while p < end - 1 {
            if self.t.at(p) == 34 || self.t.at(p) == 39 {
                has_quote = true;
            }
            p += 1;
        }
        if has_quote {
            self.slice_any(start, end);
            return;
        }
        let quote = if self.options.single_quote_as_set {
            SQUOTE
        } else {
            DQUOTE
        };
        self.text(quote);
        self.slice_any(start + 1, end - 1);
        self.text(quote);
    }
}
pub(crate) fn print_literals_is_digit(c: i32) -> bool {
    return c >= 48 && c <= 57;
}

impl Quick {
    /// printNumber
    pub(crate) fn print_number_range(&mut self, start: i32, end: i32) {
        let len = end - start;
        let mut simple = true;
        let mut p = start;
        while p < end {
            if !print_literals_is_digit(self.t.at(p)) {
                simple = false;
                break;
            }
            p += 1;
        }
        if simple || len == 1 {
            self.slice(start, end);
            return;
        }
        // work on a lower case copy, with room for a "0" in front
        self.reserve_gen(len + 2);
        let base = self.text.gen_pos + 1;
        let mut i: i32 = 0;
        while i < len {
            let c = self.t.at(start + i);
            self.t
                .put(base + i, if c >= 65 && c <= 90 { c | 32 } else { c });
            i += 1;
        }
        let mut s = base;
        let mut e = base + len;
        // the run of digits and dots at the start
        let mut m = s;
        while m < e && (print_literals_is_digit(self.t.at(m)) || self.t.at(m) == 46) {
            m += 1;
        }
        if m > s && m < e && self.t.at(m) == 101 {
            // Remove unnecessary plus and zeroes from scientific notation.
            let mut j = m + 1;
            let mut keep_minus = false;
            if self.t.at(j) == 43 {
                j += 1;
            } else if self.t.at(j) == 45 {
                keep_minus = true;
                j += 1;
            }
            let mut z = j;
            while z < e && self.t.at(z) == 48 {
                z += 1;
            }
            // 0*(?=\d): leave one digit
            if z < e && print_literals_is_digit(self.t.at(z)) {
            } else if z > j {
                z -= 1;
            }
            if z < e && print_literals_is_digit(self.t.at(z)) {
                let mut w = m + 1;
                if keep_minus {
                    self.t.put(
                        {
                            let v0 = w;
                            w += 1;
                            v0
                        },
                        45,
                    );
                }
                while z < e {
                    self.t.put(
                        {
                            let v1 = w;
                            w += 1;
                            v1
                        },
                        self.t.at({
                            let v2 = z;
                            z += 1;
                            v2
                        }),
                    );
                }
                e = w;
            }
            // Remove unnecessary scientific notation (1e0).
            let mut q = m + 1;
            if self.t.at(q) == 43 || self.t.at(q) == 45 {
                q += 1;
            }
            let mut zeros = q;
            while zeros < e && self.t.at(zeros) == 48 {
                zeros += 1;
            }
            if zeros == e && zeros > q {
                e = m;
            }
        }
        // Make sure numbers always start with a digit.
        if self.t.at(s) == 46 {
            s -= 1;
            self.t.put(s, 48);
        }
        // Remove extraneous trailing decimal zeroes.
        let mut p = s;
        'l6: while p < e {
            'c7: {
                if self.t.at(p) != 46 {
                    break 'c7;
                }
                let mut f = p + 1;
                while f < e && print_literals_is_digit(self.t.at(f)) {
                    f += 1;
                }
                if (f == e || self.t.at(f) == 101) && f - p > 2 && self.t.at(f - 1) == 48 {
                    let mut keep = f;
                    while keep - 1 > p + 1 && self.t.at(keep - 1) == 48 {
                        keep -= 1;
                    }
                    let mut w = keep;
                    let mut r = f;
                    while r < e {
                        self.t.put(
                            {
                                let v3 = w;
                                w += 1;
                                v3
                            },
                            self.t.at({
                                let v4 = r;
                                r += 1;
                                v4
                            }),
                        );
                    }
                    e = w;
                    break 'l6;
                }
            }
            p += 1;
        }
        // Remove trailing dot.
        let mut p = s;
        while p < e {
            if self.t.at(p) == 46 && (p + 1 == e || self.t.at(p + 1) == 101) {
                let mut r = p + 1;
                while r < e {
                    self.t.put(r - 1, self.t.at(r));
                    r += 1;
                }
                e -= 1;
                break;
            }
            p += 1;
        }
        self.set_gen_pos(e);
        self.slice(s, e);
    }

    pub(crate) fn print_numeric_literal(&mut self, n: i32) {
        self.print_number_range(self.n.at(n + 1), self.n.at(n + 2));
    }

    pub(crate) fn print_big_int_literal(&mut self, n: i32) {
        let start = self.n.at(n + 1);
        let end = self.n.at(n + 2);
        let mut lower = true;
        let mut p = start;
        while p < end {
            let c = self.t.at(p);
            if c >= 65 && c <= 90 {
                lower = false;
            }
            p += 1;
        }
        if lower {
            self.slice(start, end);
            return;
        }
        self.reserve_gen(end - start);
        let from = self.text.gen_pos;
        let mut p = start;
        while p < end {
            let c = self.t.at(p);
            self.gen_byte(if c >= 65 && c <= 90 { c | 32 } else { c });
            p += 1;
        }
        self.slice(from, self.text.gen_pos);
    }

    pub(crate) fn print_reg_exp_literal(&mut self, n: i32) {
        let start = self.n.at(n + 1);
        let end = self.n.at(n + 2);
        let mut flags_start = end;
        while self.t.at(flags_start - 1) != 47 {
            flags_start -= 1;
        }
        let mut sorted = true;
        let mut p = flags_start + 1;
        while p < end {
            if self.t.at(p) < self.t.at(p - 1) {
                sorted = false;
            }
            p += 1;
        }
        let slow = (self.n.at(n) & F_SLOW_TEXT) != 0;
        if sorted {
            if slow {
                self.slice_any(start, end);
            } else {
                self.slice(start, end);
            }
            return;
        }
        if slow {
            self.slice_any(start, flags_start);
        } else {
            self.slice(start, flags_start);
        }
        let count = end - flags_start;
        self.reserve_gen(count);
        let from = self.text.gen_pos;
        let mut how_many = [0i32; 256];
        for &c in self.t.sub(flags_start, end) {
            how_many[c as usize] += 1;
        }
        let mut to = from;
        for (c, &times) in how_many.iter().enumerate() {
            self.t.fill_range(c as i32, to, to + times);
            to += times;
        }
        self.set_gen_pos(to);
        self.slice(from, to);
    }
}
