//! One byte buffer holds every text the formatter can print:
//!
//!   [0, SRC_BASE)          fixed texts: keywords, punctuation, spaces (filled once, at start-up)
//!   [SRC_BASE, fileEnd)    the file, UTF-8
//!   [fileEnd, .. + PAD)    zeros
//!   [.., gen_pos)           texts made while formatting: requoted strings, normalized numbers, sources with placeholders
//!
//! So "a text" is (offset, length) everywhere, and every position in a tree is an offset into this buffer.
//!
//! The window [src_start, src_end) is what the running language takes for its whole input. At first that is the file. For
//! code in another language inside it (a <style>, a fenced block, an attribute) the window is narrowed to that range, in
//! place: enter_source() puts a 0 before and behind the range and leave_source() puts the two bytes back. A lexer stops at
//! a 0 and a scan to the left does too, so neither needs an "end of input" test, and nothing is copied.

use crate::{Quick, Stop, Words, why, zeros};

pub(crate) struct Text {
    pub(crate) t_cap: i32,
    pub(crate) src_start: i32,
    pub(crate) src_end: i32,
    pub(crate) gen_pos: i32,
    pub(crate) ws_pos: i32,
}
impl Text {
    pub(crate) fn new() -> Self {
        Self {
            t_cap: 131072,
            src_start: 32768,
            src_end: 32768,
            gen_pos: 32832,
            ws_pos: 0,
        }
    }
}

pub(crate) const SRC_BASE: i32 = 1 << 15;
pub(crate) const PAD: i32 = 64;
impl Quick {
    /// Something that this way does not print.
    pub(crate) fn text_refuse(&self) -> Stop {
        return self.stop(why::RARE);
    }
}
// A buffer that is too small gives way to one that is much larger: memory that is not written to costs nothing, and what was written to stays with the
// process until its end (nothing gives it back), where the system takes 0.2 us to take back each page of it, one thread for all.
pub(crate) fn much_larger(size: i32) -> i32 {
    return if size < (1 << 22) { size * 8 } else { size * 2 };
}

impl Quick {
    /// `used`: how much of the buffer is to be kept.
    pub(crate) fn grow_text(&mut self, need: i32, used: i32) {
        let mut cap = self.text.t_cap;
        while cap < need {
            cap = much_larger(cap);
        }
        let mut next = zeros::<u8>(cap);
        next.set_all(self.t.sub(0, used), 0);
        self.t = next;
        self.text.t_cap = cap;
    }

    /// Makes room for a file of `length` bytes and returns the buffer to fill from SRC_BASE on. The first `have` bytes of the file are there already.
    pub(crate) fn source_buffer(&mut self, length: i32, have: i32) {
        let need = SRC_BASE + length + PAD + (length >> 2) + 4096;
        if need > self.text.t_cap {
            self.grow_text(need, SRC_BASE + have);
        }
    }

    /// Says how many bytes of the file are in the buffer.
    pub(crate) fn set_source_length(&mut self, length: i32) {
        let end = SRC_BASE + length;
        self.text.src_start = SRC_BASE;
        self.text.src_end = end;
        self.t.fill_range(0, end, end + PAD);
        self.text.gen_pos = end + PAD;
        self.text.ws_pos = 0;
    }
}
// ---- windows
/// [src_start, src_end, the byte before the new window, the byte behind it]
pub(crate) static WS: [i32; 64] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
impl Quick {
    pub(crate) fn leave_source(&mut self) {
        self.text.ws_pos -= 4;
        self.t
            .put(self.text.src_start - 1, WS.at(self.text.ws_pos + 2));
        self.t.put(self.text.src_end, WS.at(self.text.ws_pos + 3));
        self.text.src_start = WS.at(self.text.ws_pos);
        self.text.src_end = WS.at(self.text.ws_pos + 1);
    }

    pub(crate) fn unwind_source(&mut self, depth: i32) {
        while self.text.ws_pos > depth {
            self.leave_source();
        }
    }

    // ---- generated texts
    /// After this, `bytes` bytes can be written at gen_pos. It may replace T: read T again.
    pub(crate) fn reserve_gen(&mut self, bytes: i32) {
        if self.text.gen_pos + bytes + PAD + 8 > self.text.t_cap {
            self.grow_text(self.text.gen_pos + bytes + PAD + 8, self.text.gen_pos);
        }
    }

    pub(crate) fn gen_byte(&mut self, c: i32) {
        self.t.put(self.text.gen_pos, c);
        self.text.gen_pos += 1;
    }

    pub(crate) fn set_gen_pos(&mut self, p: i32) {
        self.text.gen_pos = p;
    }

    /// Appends a copy of T[start, end) to the generated texts and returns where it stands.
    pub(crate) fn gen_copy(&mut self, start: i32, end: i32) -> i32 {
        let length = end - start;
        self.reserve_gen(length);
        let at = self.text.gen_pos;
        self.t.move_within(at, start, end);
        self.text.gen_pos = at + length;
        return at;
    }

    /// Appends an ASCII text. Only for rare paths.
    pub(crate) fn gen_string(&mut self, text: &[u8]) {
        let length = text.len() as i32;
        self.reserve_gen(length);
        let at = self.text.gen_pos;
        let mut i: i32 = 0;
        while i < length {
            self.t.put(at + i, text.at(i));
            i += 1;
        }
        self.text.gen_pos = at + length;
    }

    /// For a source that has to be put together (a template literal with placeholders, a block without its indentation):
    /// call this, write the bytes with gen_byte() .. and pass [the result, gen_pos) to enter_source(). Leaves a byte free in
    /// front for the 0.
    pub(crate) fn gen_source_start(&mut self, expected_bytes: i32) -> i32 {
        self.reserve_gen(expected_bytes + 1);
        self.t.put(self.text.gen_pos, 0);
        self.text.gen_pos += 1;
        return self.text.gen_pos;
    }

    /// Ends such a source: leaves room behind it, so that later texts do not stand where its 0 goes.
    pub(crate) fn gen_source_end(&mut self) {
        self.reserve_gen(8);
        self.t
            .fill_range(0, self.text.gen_pos, self.text.gen_pos + 8);
        self.text.gen_pos += 8;
    }

    /// Compares T[at, end) with an ASCII text. Only for rare paths.
    pub(crate) fn text_is(&self, at: i32, end: i32, text: &[u8]) -> bool {
        let length = text.len() as i32;
        if end - at != length {
            return false;
        }
        let mut i: i32 = 0;
        while i < length {
            if self.t.at(at + i) != text.at(i) {
                return false;
            }
            i += 1;
        }
        return true;
    }
}

impl Quick {
    /// A syntax error at `at`.
    #[cold]
    pub(crate) fn fail(&self, at: i32) -> Stop {
        self.failed_at.set(at - self.text.src_start);
        self.stop(why::SYNTAX)
    }
}
