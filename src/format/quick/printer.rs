//! Turns the command stream into bytes. The algorithm is Prettier's printDocToString, on another data structure:
//!
//! - The stream is read front to back. Where Prettier pushes the children of a doc on a stack of commands, here the only
//!   stack holds what a closing command has to restore: the mode for a group, the indentation for an indent, the return
//!   address for a call.
//! - "The rest of the commands", which fits() needs, is simply what follows in the stream. fits() reads on past the end
//!   of the group and takes the modes of the enclosing groups from that stack, without popping.
//! - A group whose contents are "pure" carries its flat width, so whether it fits is one comparison plus a look at
//!   the few commands up to the next possible line break.

use crate::doc::{
    ALIGN_BIAS, ALIGN_MARK_ROOT, ALIGN_TO_ROOT, G_BREAK, G_END_PENDING, G_FORCE_FLAT, G_GIVES_UP,
    G_HAS_FILL, G_PURE, LINE_HARD, LINE_LITERAL, LINE_NORMAL, LINE_SOFT, STANDING_BELOW, op,
};
use crate::options::{EOL_CR, EOL_CRLF, EOL_LF};
use crate::{Bytes, Quick, R, Stop, Words, copy_block, grow, rare, why, zeros};

pub(crate) struct Printer {
    pub(crate) out: Vec<u8>,
    pub(crate) out_length: i32,
    pub(crate) out_cap: i32,
    /// the stack
    pub(crate) st: Vec<i32>,
    /// the stack of fits()
    pub(crate) fs: Vec<i32>,
    pub(crate) group_mode: Vec<u8>,
    /// line suffixes that wait: pc, mode, indentation
    pub(crate) sx: Vec<i32>,
    pub(crate) sx_start: i32,
    pub(crate) sx_end: i32,
    pub(crate) it: Vec<i32>,
    pub(crate) it_pos: i32,
    pub(crate) ib: Vec<u8>,
    pub(crate) ib_pos: i32,
    // ---- the state of the printer, where print_doc() and slow_step() hand it to each other
    /// the command to read next
    pub(crate) x_pc: i32,
    /// bytes written
    pub(crate) x_o: i32,
    /// the column
    pub(crate) x_pos: i32,
    pub(crate) x_mode: i32,
    /// the indentation record
    pub(crate) x_ind: i32,
    pub(crate) x_sp: i32,
    pub(crate) x_remeasure: i32,
    /// WAIT_SUFFIX: line suffixes wait for the end of the line; WAIT_CURSOR: see Op.Cursor
    pub(crate) x_waiting: i32,
    /// Where the output stood at each `cursor` command.
    pub(crate) cursor_positions: Vec<i32>,
    pub(crate) cursor_count: i32,
    pub(crate) x_stub: i32,
    /// slow_step() is called from inside a group that is printed flat without a look at the column
    pub(crate) x_all_flat: bool,
    pub(crate) words_pos: i32,
    // ---- printDocToString() in the middle of the work
    pub(crate) printed_start: i32,
    pub(crate) printed_end: i32,
}
impl Printer {
    pub(crate) fn new() -> Self {
        Self {
            out: zeros(65536),
            out_length: 0,
            out_cap: 65536,
            st: zeros(4096),
            fs: zeros(4096),
            group_mode: zeros(1024),
            sx: zeros(192),
            sx_start: 0,
            sx_end: 0,
            it: zeros(1024),
            it_pos: 0,
            ib: zeros(256),
            ib_pos: 0,
            x_pc: 0,
            x_o: 0,
            x_pos: 0,
            x_mode: 0,
            x_ind: 0,
            x_sp: 0,
            x_remeasure: 0,
            x_waiting: 0,
            cursor_positions: zeros(2),
            cursor_count: 0,
            x_stub: 0,
            x_all_flat: false,
            words_pos: 0,
            printed_start: 0,
            printed_end: 0,
        }
    }
}

/// So many bytes at the end of the output stay free: texts are copied in blocks, and what follows overwrites what was copied too much.
const OUT_MARGIN: i32 = 128;
pub(crate) const FLAT: i32 = 1;
pub(crate) const BREAK: i32 = 2;
// ---- indentation: records of IT_STRIDE words
pub(crate) const IT_STRIDE: i32 = 16;
pub(crate) const IT_WIDTH: i32 = 0;
pub(crate) const IT_TABS: i32 = 1;
pub(crate) const IT_SPACES: i32 = 2;
pub(crate) const IT_FLUSHED: i32 = 3;
pub(crate) const IT_LAST_TABS: i32 = 4;
pub(crate) const IT_LAST_SPACES: i32 = 5;
pub(crate) const IT_PARENT: i32 = 6;
pub(crate) const IT_ROOT: i32 = 7;
pub(crate) const IT_CHILD: i32 = 8;
pub(crate) const IT_ALIGN_N: i32 = 9;
pub(crate) const IT_ALIGN_CHILD: i32 = 10;
// With align("> ", ..) around, the indentation starts with the bytes IB[prefix, prefix + length); the tabs and spaces
// follow. IT_SPACES is then HUGE, which sends print_doc() to slow_step(), and IT_REAL_SPACES has the number.
pub(crate) const IT_PREFIX: i32 = 11;
pub(crate) const IT_PREFIX_LEN: i32 = 12;
pub(crate) const IT_PREFIX_WIDTH: i32 = 13;
pub(crate) const IT_REAL_SPACES: i32 = 14;
// More than the output buffer ever holds (see grow_out()): "is there room for the indentation?" is what sends print_doc() there.
pub(crate) const HUGE: i32 = 1 << 30;
impl Quick {
    /// `from`: the record whose prefix the new one starts with; -1 for none.
    pub(crate) fn new_indent(
        &mut self,
        parent: i32,
        flushed: i32,
        last_tabs: i32,
        last_spaces: i32,
        root: i32,
        from: i32,
    ) -> i32 {
        if self.printer.it_pos + IT_STRIDE > (self.printer.it.len() as i32) {
            self.make_room(|q| &mut q.printer.it, self.printer.it_pos + IT_STRIDE);
        }
        let r = self.printer.it_pos;
        self.printer.it_pos = r + IT_STRIDE;
        let mut width: i32;
        let spaces: i32;
        if self.options.use_tabs {
            width = flushed * self.options.tab_width + last_spaces;
            self.printer.it.put(r + IT_TABS, flushed);
            spaces = last_spaces;
        } else {
            width = flushed + last_spaces;
            self.printer.it.put(r + IT_TABS, 0);
            spaces = flushed + last_spaces;
        }
        let prefix_length = if from < 0 {
            0
        } else {
            self.printer.it.at(from + IT_PREFIX_LEN)
        };
        if prefix_length != 0 {
            self.printer
                .it
                .put(r + IT_PREFIX, self.printer.it.at(from + IT_PREFIX));
            self.printer.it.put(
                r + IT_PREFIX_WIDTH,
                self.printer.it.at(from + IT_PREFIX_WIDTH),
            );
            width += self.printer.it.at(from + IT_PREFIX_WIDTH);
        } else {
            self.printer.it.put(r + IT_PREFIX, 0);
            self.printer.it.put(r + IT_PREFIX_WIDTH, 0);
        }
        self.printer.it.put(r + IT_PREFIX_LEN, prefix_length);
        self.printer.it.put(r + IT_WIDTH, width);
        self.printer.it.put(
            r + IT_SPACES,
            if prefix_length != 0 { HUGE } else { spaces },
        );
        self.printer.it.put(r + IT_REAL_SPACES, spaces);
        self.printer.it.put(r + IT_FLUSHED, flushed);
        self.printer.it.put(r + IT_LAST_TABS, last_tabs);
        self.printer.it.put(r + IT_LAST_SPACES, last_spaces);
        self.printer.it.put(r + IT_PARENT, parent);
        self.printer.it.put(r + IT_ROOT, root);
        self.printer.it.put(r + IT_CHILD, 0);
        self.printer.it.put(r + IT_ALIGN_N, 0);
        self.printer.it.put(r + IT_ALIGN_CHILD, 0);
        return r;
    }

    /// align(text, ..): the indentation so far, flushed, and the text are the prefix of the new record.
    pub(crate) fn make_align_text(&mut self, r: i32, start: i32, length: i32) -> i32 {
        let old_length = self.printer.it.at(r + IT_PREFIX_LEN);
        let tabs = if self.options.use_tabs {
            self.printer.it.at(r + IT_FLUSHED) + self.printer.it.at(r + IT_LAST_TABS)
        } else {
            0
        };
        let spaces = if self.options.use_tabs {
            0
        } else {
            self.printer.it.at(r + IT_FLUSHED) + self.printer.it.at(r + IT_LAST_SPACES)
        };
        let total = old_length + tabs + spaces + length;
        if self.printer.ib_pos + total > (self.printer.ib.len() as i32) {
            self.make_room(|q| &mut q.printer.ib, self.printer.ib_pos + total);
        }
        let at = self.printer.ib_pos;
        let old = self.printer.it.at(r + IT_PREFIX);
        self.printer.ib.move_within(at, old, old + old_length);
        let mut p = at + old_length;
        let mut i: i32 = 0;
        while i < tabs {
            self.printer.ib.put(p + i, 9);
            i += 1;
        }
        p += tabs;
        let mut i: i32 = 0;
        while i < spaces {
            self.printer.ib.put(p + i, 32);
            i += 1;
        }
        p += spaces;
        let mut i: i32 = 0;
        while i < length {
            self.printer.ib.put(p + i, self.t.at(start + i));
            i += 1;
        }
        self.printer.ib_pos = at + total;
        let width = self.printer.it.at(r + IT_PREFIX_WIDTH)
            + tabs * self.options.tab_width
            + spaces
            + length;
        let child = self.new_indent(r, 0, 0, 0, self.printer.it.at(r + IT_ROOT), -1);
        self.printer.it.put(child + IT_PREFIX, at);
        self.printer.it.put(child + IT_PREFIX_LEN, total);
        self.printer.it.put(child + IT_PREFIX_WIDTH, width);
        self.printer.it.put(child + IT_WIDTH, width);
        self.printer.it.put(child + IT_SPACES, HUGE);
        return child;
    }

    pub(crate) fn make_indent(&mut self, r: i32) -> i32 {
        let cached = self.printer.it.at(r + IT_CHILD);
        if cached != 0 {
            return cached;
        }
        let flushed = if self.options.use_tabs {
            self.printer.it.at(r + IT_FLUSHED) + self.printer.it.at(r + IT_LAST_TABS) + 1
        } else {
            self.printer.it.at(r + IT_FLUSHED)
                + self.printer.it.at(r + IT_LAST_SPACES)
                + self.options.tab_width
        };
        let child = self.new_indent(r, flushed, 0, 0, self.printer.it.at(r + IT_ROOT), r);
        self.printer.it.put(r + IT_CHILD, child);
        return child;
    }

    pub(crate) fn make_align(&mut self, r: i32, n: i32) -> i32 {
        if n == 0 {
            return r;
        }
        if n == ALIGN_TO_ROOT {
            return self.printer.it.at(r + IT_ROOT);
        }
        if n == ALIGN_MARK_ROOT {
            let copy = self.new_indent(
                self.printer.it.at(r + IT_PARENT),
                self.printer.it.at(r + IT_FLUSHED),
                self.printer.it.at(r + IT_LAST_TABS),
                self.printer.it.at(r + IT_LAST_SPACES),
                0,
                r,
            );
            self.printer.it.put(copy + IT_ROOT, r);
            return copy;
        }
        if n < 0 {
            return self.printer.it.at(r + IT_PARENT);
        }
        if self.printer.it.at(r + IT_ALIGN_N) == n {
            return self.printer.it.at(r + IT_ALIGN_CHILD);
        }
        let child = self.new_indent(
            r,
            self.printer.it.at(r + IT_FLUSHED),
            self.printer.it.at(r + IT_LAST_TABS) + 1,
            self.printer.it.at(r + IT_LAST_SPACES) + n,
            self.printer.it.at(r + IT_ROOT),
            r,
        );
        self.printer.it.put(r + IT_ALIGN_N, n);
        self.printer.it.put(r + IT_ALIGN_CHILD, child);
        return child;
    }

    pub(crate) fn grow_out(&mut self, need: i32) -> R<()> {
        // (a tab width of 5000 and a file of 200 KB on one line give 420 MB, a nest of 10,000 levels 200 MB)
        let used = self.printer.out.len() as i32;
        if !grow(
            &mut self.printer.out,
            used,
            need.saturating_add(2 * OUT_MARGIN),
            0,
        ) {
            return Err(self.stop(why::TOO_LARGE));
        }
        self.printer.out_cap = self.printer.out.len() as i32;
        Ok(())
    }

    /// (Whoever finds the stack full comes back with the same command until there is room.)
    pub(crate) fn grow_stack(&mut self) -> R<()> {
        let used = self.printer.st.len() as i32;
        if !grow(&mut self.printer.st, used, used + 1, 0) {
            return Err(self.stop(why::TOO_LARGE));
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn grow_stack_of_fits(&mut self) {
        self.make_room(|q| &mut q.printer.fs, self.printer.fs.len() as i32 + 1);
    }

    /// Does what starts at `pc` fit into `rem` columns, up to the first possible line break?
    ///
    /// `depth0` is 1 if `pc` stands inside a construct that the printer has not entered yet (the group that is being
    /// measured); `outer_mode` is then the mode behind its end. With `limit` >= 0 nothing behind `limit` counts.
    pub(crate) fn fits(
        &mut self,
        mut pc: i32,
        mut mode: i32,
        mut rem: i32,
        mut pending_space: i32,
        limit: i32,
        must_be_flat: bool,
        depth0: i32,
        outer_mode: i32,
        mut msp: i32,
        mut has_suffix: bool,
    ) -> bool {
        let mut fsp: i32 = 0;
        let mut sep_seen_at: i32 = -1;
        if depth0 != 0 {
            self.printer.fs.put(0, outer_mode);
            fsp = 1;
        }
        // Prettier's loop is `while (width >= 0)`: where the line is full already, not even nothing fits
        if rem < 0 {
            return false;
        }
        loop {
            if pc == limit && fsp == 0 {
                return true;
            }
            let w = self.d.at(pc);
            match w & 31 {
                op::Short | op::Static => {
                    rem = rem - ((w >> 5) & 255) - pending_space;
                    pending_space = 0;
                    if rem < 0 {
                        return false;
                    }
                    pc += 1;
                    continue;
                }
                op::Text => {
                    rem = rem - ((w as u32) >> 5) as i32 - pending_space;
                    pending_space = 0;
                    if rem < 0 {
                        return false;
                    }
                    pc += 2;
                    continue;
                }
                op::TextW => {
                    if self.d.at(pc + 2) < STANDING_BELOW {
                        // standing(): more than one line
                        return true;
                    }
                    rem = rem - self.d.at(pc + 2) - pending_space;
                    pending_space = 0;
                    if rem < 0 {
                        return false;
                    }
                    pc += 3;
                    continue;
                }
                op::BreakText => {
                    if mode == BREAK {
                        rem = rem - ((w >> 5) & 255) - pending_space;
                        pending_space = 0;
                        if rem < 0 {
                            return false;
                        }
                    }
                    pc += 1;
                    continue;
                }
                op::IndentLine | op::DedentLine | op::Line => {
                    let kind = w >> 5;
                    if mode == BREAK || kind >= LINE_HARD {
                        return true;
                    }
                    if kind == LINE_NORMAL {
                        pending_space = 1;
                    }
                    if (w & 31) == op::IndentLine {
                        if fsp + 2 > (self.printer.fs.len() as i32) {
                            self.grow_stack_of_fits();
                        }
                        fsp += 1;
                    } else if (w & 31) == op::DedentLine {
                        if fsp > 0 {
                            fsp -= 1;
                        } else {
                            msp -= 1;
                        }
                    }
                    pc += 1;
                    continue;
                }
                op::GroupOpen => {
                    {
                        let flags = w >> 5;
                        if (flags & G_BREAK) != 0 {
                            if must_be_flat {
                                return false;
                            }
                        } else if (mode == FLAT || (flags & G_FORCE_FLAT) != 0)
                            && (flags & G_PURE) != 0
                            && !has_suffix
                        {
                            // the whole group in one step
                            let width = self.d.at(pc + 2);
                            if width != 0 {
                                rem = rem - width - pending_space;
                                if rem < 0 {
                                    return false;
                                }
                                pending_space = if (flags & G_END_PENDING) != 0 { 1 } else { 0 };
                            } else if (flags & G_END_PENDING) != 0 {
                                pending_space = 1;
                            }
                            pc += self.d.at(pc + 1);
                            continue;
                        }
                        if fsp + 2 > (self.printer.fs.len() as i32) {
                            self.grow_stack_of_fits();
                        }
                        self.printer.fs.put(fsp, mode);
                        fsp += 1;
                        if (flags & G_BREAK) != 0 {
                            mode = BREAK;
                        } else if (flags & G_FORCE_FLAT) != 0 {
                            mode = FLAT;
                        }
                        pc += 4;
                        continue;
                    }
                }
                op::GroupClose => {
                    if fsp > 0 {
                        fsp -= 1;
                        mode = self.printer.fs.at(fsp);
                    } else {
                        msp -= 1;
                        mode = self.printer.st.at(msp);
                    }
                    pc += 1;
                    continue;
                }
                op::CondOpen => {
                    let flags = w >> 5;
                    if must_be_flat && (flags & G_BREAK) != 0 {
                        return false;
                    }
                    if fsp + 2 > (self.printer.fs.len() as i32) {
                        self.grow_stack_of_fits();
                    }
                    self.printer.fs.put(fsp, mode);
                    fsp += 1;
                    if (flags & G_BREAK) != 0 {
                        mode = BREAK;
                    }
                    pc = if mode == BREAK {
                        pc + self.d.at(pc + 2) + 3
                    } else {
                        pc + 4 + 3
                    };
                    continue;
                }
                op::StateClose => {
                    if fsp > 0 {
                        fsp -= 1;
                        mode = self.printer.fs.at(fsp);
                    } else {
                        msp -= 1;
                        mode = self.printer.st.at(msp);
                    }
                    pc += ((w as u32) >> 5) as i32;
                    continue;
                }
                op::IndentOpen | op::AlignOpen | op::AlignTextOpen | op::IndentIfBreakOpen => {
                    if fsp + 2 > (self.printer.fs.len() as i32) {
                        self.grow_stack_of_fits();
                    }
                    fsp += 1;
                    pc += if (w & 31) == op::AlignTextOpen { 2 } else { 1 };
                    continue;
                }
                op::IndentClose => {
                    if fsp > 0 {
                        fsp -= 1;
                    } else {
                        msp -= 1;
                    }
                    pc += 1;
                    continue;
                }
                op::IfBreak => {
                    let id = ((w as u32) >> 5) as i32;
                    let m = if id != 0 {
                        self.printer.group_mode.at(id)
                    } else {
                        mode
                    };
                    pc = if m == BREAK {
                        pc + 2
                    } else {
                        pc + 3 + self.d.at(pc + 1)
                    };
                    continue;
                }
                op::Skip => {
                    pc = pc + 1 + ((w as u32) >> 5) as i32;
                    continue;
                }
                op::SuffixOpen => {
                    has_suffix = true;
                    pc = pc + 1 + ((w as u32) >> 5) as i32;
                    continue;
                }
                op::SuffixBoundary => {
                    if has_suffix && (w >> 5) == 0 {
                        return false;
                    }
                    pc += 1;
                    continue;
                }
                op::Call => {
                    if fsp + 2 > (self.printer.fs.len() as i32) {
                        self.grow_stack_of_fits();
                    }
                    self.printer.fs.put(fsp, pc + 1);
                    fsp += 1;
                    pc = ((w as u32) >> 5) as i32 + 3;
                    continue;
                }
                op::Ret => {
                    if fsp > 0 {
                        fsp -= 1;
                        pc = self.printer.fs.at(fsp);
                    } else {
                        msp -= 1;
                        pc = self.printer.st.at(msp);
                    }
                    continue;
                }
                op::FillOpen => {
                    if ((w as u32) >> 5) as i32 != 0 {
                        // words: all of them on this line, or the first one and the end of the line
                        rem =
                            rem - (if mode == BREAK {
                                self.first_word_length(self.d.at(pc + 1))
                            } else {
                                ((w as u32) >> 5) as i32
                            }) - pending_space;
                        if rem < 0 {
                            return false;
                        }
                        if mode == BREAK {
                            return true;
                        }
                        pending_space = 0;
                        pc += 3;
                        continue;
                    }
                    fsp += 1;
                    pc += 1;
                    continue;
                }
                op::FillItem => {
                    if fsp == 0 && limit < 0 {
                        mode = self.printer.st.at(msp - 2);
                    }
                    pc += 1;
                    continue;
                }
                op::FillSep => {
                    // The mode that was chosen for the separator behind the current item; the ones after it have that of the fill.
                    if fsp == 0 && limit < 0 {
                        mode = self
                            .printer
                            .st
                            .at(msp - (if sep_seen_at == msp { 2 } else { 1 }));
                        sep_seen_at = msp;
                    }
                    pc += 1;
                    continue;
                }
                op::FillClose => {
                    if fsp > 0 {
                        fsp -= 1;
                    } else {
                        msp -= 2;
                        mode = self.printer.st.at(msp);
                    }
                    pc += 1;
                    continue;
                }
                op::Nop => {
                    if ((w as u32) >> 6) as i32 != 0 {
                        rem = rem - ((w as u32) >> 6) as i32 - pending_space;
                        pending_space = 0;
                        if rem < 0 {
                            return false;
                        }
                        pc += 1;
                    }
                    pc += 1;
                    continue;
                }
                op::Cursor => {
                    pc += 1;
                    continue;
                }
                op::SuffixClose | op::End => {
                    return true;
                }
                _ => {
                    return true;
                }
            }
        }
    }
}
pub(crate) const WAIT_SUFFIX: i32 = 1;
pub(crate) const WAIT_CURSOR: i32 = 2;
impl Quick {
    /// For whoever finds out in another way that a short cut should not have been taken.
    pub(crate) fn redo(&self) -> Stop {
        return self.stop(why::REDO);
    }

    pub(crate) fn grow_out_to(&mut self, need: i32) -> R<()> {
        self.grow_out(need)?;
        Ok(())
    }

    /// Prints the stream from `start` to the next End. `stub` is where `Line(hard) Ret` stands.
    ///
    /// This function handles the commands that need no call: texts, lines, closings, groups whose fate is clear. Whatever
    /// needs more (measuring with fits(), growing a buffer, comments at the end of a line, fill) goes to slow_step(), through
    /// the variables above. That call is the only one in here, so that the variables of the loop can stay in registers.
    pub(crate) fn print_doc(&mut self, start: i32, stub: i32) -> R<()> {
        let width = self.options.print_width;
        let eol = self.options.end_of_line;
        if self.doc.group_ids + 1 > (self.printer.group_mode.len() as i32) {
            // (this is also what keeps the number of a group within the bits that a command has for it)
            if !grow(&mut self.printer.group_mode, 0, self.doc.group_ids + 1, 0) {
                return Err(self.stop(why::TOO_LARGE));
            }
        } else {
            self.printer
                .group_mode
                .fill_range(0, 0, self.doc.group_ids + 1);
        }
        self.printer.it_pos = 0;
        self.printer.ib_pos = 0;
        let root_indent = self.new_indent(0, 0, 0, 0, 0, -1);
        self.printer.sx_end = 0;
        self.printer.sx_start = 0;
        self.printer.cursor_count = 0;
        self.printer.x_stub = stub;
        let sixteen_spaces = u128::from_le_bytes([32; 16]);
        let mut st_limit = self.printer.st.len() as i32 - 16;
        let mut cap = self.printer.out_cap - OUT_MARGIN;
        let mut sp: i32 = 0;
        let mut pc = start;
        let mut o: i32 = 0;
        let mut pos: i32 = 0;
        let mut mode = BREAK;
        let mut ind = root_indent;
        if self.options.indentation != 0 {
            let mut levels = self.options.indentation;
            while levels > 0 {
                ind = self.make_indent(ind);
                levels -= 1;
            }
            pos = self.printer.it.at(ind + IT_WIDTH);
        }
        let mut remeasure: i32 = 0;
        let mut waiting: i32 = 0;
        loop {
            'l1: loop {
                let w = self.d.at(pc);
                's2: {
                    match w & 31 {
                        op::BreakText | op::Short => {
                            if o > cap {
                                break 's2;
                            }
                            // (what is written and does not count is overwritten)
                            let len = if (w & 31) == op::BreakText && mode != BREAK {
                                0
                            } else {
                                (w >> 5) & 255
                            };
                            self.printer.out.put_u16(o, ((w as u32) >> 13) as i32);
                            o += len;
                            pos += len;
                            pc += 1;
                            continue 'l1;
                        }
                        op::Static => {
                            {
                                let len = (w >> 5) & 255;
                                if o + len > cap {
                                    break 's2;
                                }
                                let s = ((w as u32) >> 13) as i32;
                                // Sixteen bytes at a time, and up to fifteen too many: what follows overwrites them.
                                self.printer.out.put_u128(o, self.t.u128_at(s));
                                let mut k: i32 = 16;
                                while k < len {
                                    self.printer.out.put_u128(o + k, self.t.u128_at(s + k));
                                    k += 16;
                                }
                                o += len;
                                pos += len;
                                pc += 1;
                                continue 'l1;
                            }
                        }
                        op::Text => {
                            let len = ((w as u32) >> 5) as i32;
                            if o + len > cap {
                                break 's2;
                            }
                            let s = self.d.at(pc + 1);
                            self.printer.out.put_u128(o, self.t.u128_at(s));
                            let mut k: i32 = 16;
                            while k < len {
                                self.printer.out.put_u128(o + k, self.t.u128_at(s + k));
                                k += 16;
                            }
                            o += len;
                            pos += len;
                            pc += 2;
                            continue 'l1;
                        }
                        op::IndentLine | op::DedentLine => {
                            {
                                // Whatever could send the line to slow_step() is looked at first: there the command starts from the beginning.
                                let target: i32;
                                if (w & 31) == op::IndentLine {
                                    target = self.printer.it.at(ind + IT_CHILD);
                                    if target == 0 || sp >= st_limit {
                                        break 's2;
                                    }
                                } else {
                                    target = self.printer.st.at(sp - 1);
                                }
                                if mode != FLAT || (w >> 5) >= LINE_HARD {
                                    if waiting != 0
                                        || eol != 0
                                        || o + self.printer.it.at(target + IT_TABS)
                                            + self.printer.it.at(target + IT_SPACES)
                                            > cap
                                    {
                                        break 's2;
                                    }
                                }
                                if (w & 31) == op::IndentLine {
                                    self.printer.st.put(sp, ind);
                                    sp += 1;
                                } else {
                                    sp -= 1;
                                }
                                ind = target;
                            }
                            {
                                let kind = w >> 5;
                                if mode == FLAT && kind < LINE_HARD {
                                    self.printer.out.put(o, 32);
                                    o += (kind == LINE_NORMAL) as i32;
                                    pos += (kind == LINE_NORMAL) as i32;
                                    pc += 1;
                                    continue 'l1;
                                }
                                if waiting != 0 || eol != 0 || kind == LINE_LITERAL {
                                    break 's2;
                                }
                                let tabs = self.printer.it.at(ind + IT_TABS);
                                let spaces = self.printer.it.at(ind + IT_SPACES);
                                if o + tabs + spaces > cap {
                                    break 's2;
                                }
                                if mode == FLAT {
                                    remeasure = 1;
                                }
                                while o > 0 {
                                    let last = self.printer.out.at(o - 1);
                                    if last != 32 && last != 9 {
                                        // see slow_step()
                                        if last == 10 && kind < LINE_HARD {
                                            return Err(self.rare(rare::BROKEN));
                                        }
                                        break;
                                    }
                                    o -= 1;
                                }
                                self.printer.out.put(o, 10);
                                o += 1;
                                let mut i: i32 = 0;
                                while i < tabs {
                                    self.printer.out.put(o + i, 9);
                                    i += 1;
                                }
                                o += tabs;
                                self.printer.out.put_u128(o, sixteen_spaces);
                                self.printer.out.put_u128(o + 16, sixteen_spaces);
                                let mut k: i32 = 32;
                                while k < spaces {
                                    self.printer.out.put_u128(o + k, sixteen_spaces);
                                    k += 16;
                                }
                                o += spaces;
                                pos = self.printer.it.at(ind + IT_WIDTH);
                                pc += 1;
                                continue 'l1;
                            }
                        }
                        // falls through
                        op::Line => {
                            let kind = w >> 5;
                            if mode == FLAT && kind < LINE_HARD {
                                self.printer.out.put(o, 32);
                                o += (kind == LINE_NORMAL) as i32;
                                pos += (kind == LINE_NORMAL) as i32;
                                pc += 1;
                                continue 'l1;
                            }
                            if waiting != 0 || eol != 0 || kind == LINE_LITERAL {
                                // a text of many lines: nothing but the end of a line, if the next one starts at the margin
                                if waiting == 0
                                    && eol == 0
                                    && o <= cap
                                    && self.printer.it.at(ind + IT_ROOT) == root_indent
                                    && !self.options.marks_line_breaks_in_texts
                                {
                                    if mode == FLAT {
                                        remeasure = 1;
                                    }
                                    self.printer.out.put(o, 10);
                                    o += 1;
                                    pos = 0;
                                    pc += 1;
                                    continue 'l1;
                                }
                                break 's2;
                            }
                            let tabs = self.printer.it.at(ind + IT_TABS);
                            let spaces = self.printer.it.at(ind + IT_SPACES);
                            if o + tabs + spaces > cap {
                                break 's2;
                            }
                            if mode == FLAT {
                                remeasure = 1;
                            }
                            while o > 0 {
                                let last = self.printer.out.at(o - 1);
                                if last != 32 && last != 9 {
                                    // see slow_step()
                                    if last == 10
                                        && kind < LINE_HARD
                                        && self.d.at(pc - 1) != (op::Line | (LINE_NORMAL << 5))
                                    {
                                        return Err(self.rare(rare::BROKEN));
                                    }
                                    break;
                                }
                                o -= 1;
                            }
                            self.printer.out.put(o, 10);
                            o += 1;
                            let mut i: i32 = 0;
                            while i < tabs {
                                self.printer.out.put(o + i, 9);
                                i += 1;
                            }
                            o += tabs;
                            self.printer.out.put_u128(o, sixteen_spaces);
                            self.printer.out.put_u128(o + 16, sixteen_spaces);
                            let mut k: i32 = 32;
                            while k < spaces {
                                self.printer.out.put_u128(o + k, sixteen_spaces);
                                k += 16;
                            }
                            o += spaces;
                            pos = self.printer.it.at(ind + IT_WIDTH);
                            pc += 1;
                            continue 'l1;
                        }
                        op::GroupOpen => {
                            {
                                if sp >= st_limit {
                                    break 's2;
                                }
                                let flags = w >> 5;
                                let mut next = FLAT;
                                if (flags & G_FORCE_FLAT) == 0 {
                                    if mode == FLAT && remeasure == 0 {
                                        if (flags & G_BREAK) != 0 {
                                            next = BREAK;
                                        }
                                    } else if (flags & G_BREAK) != 0 {
                                        remeasure = 0;
                                        next = BREAK;
                                    } else {
                                        if (flags & G_PURE) == 0 || waiting != 0 {
                                            break 's2;
                                        }
                                        let mut rem = width - pos - self.d.at(pc + 2);
                                        if rem < 0 {
                                            next = BREAK;
                                        } else {
                                            // It fits by itself. Does what follows, up to the next place where the line can end?
                                            let mut q = pc + self.d.at(pc + 1);
                                            let mut space =
                                                if (flags & G_END_PENDING) != 0 { 1 } else { 0 };
                                            let mut rest_mode = mode;
                                            let mut msp = sp;
                                            let mut verdict: i32 = 0;
                                            while verdict == 0 {
                                                let v = self.d.at(q);
                                                match v & 31 {
                                                    op::Short | op::Static => {
                                                        rem = rem - ((v >> 5) & 255) - space;
                                                        space = 0;
                                                        if rem < 0 {
                                                            verdict = BREAK;
                                                        }
                                                        q += 1;
                                                    }
                                                    op::Text => {
                                                        rem =
                                                            rem - ((v as u32) >> 5) as i32 - space;
                                                        space = 0;
                                                        if rem < 0 {
                                                            verdict = BREAK;
                                                        }
                                                        q += 2;
                                                    }
                                                    op::BreakText => {
                                                        if rest_mode == BREAK {
                                                            rem = rem - ((v >> 5) & 255) - space;
                                                            space = 0;
                                                            if rem < 0 {
                                                                verdict = BREAK;
                                                            }
                                                        }
                                                        q += 1;
                                                    }
                                                    op::IndentLine => {
                                                        verdict = if rest_mode == BREAK
                                                            || (v >> 5) >= LINE_HARD
                                                        {
                                                            FLAT
                                                        } else {
                                                            3
                                                        };
                                                    }
                                                    op::DedentLine => {
                                                        msp -= 1;
                                                        if rest_mode == BREAK
                                                            || (v >> 5) >= LINE_HARD
                                                        {
                                                            verdict = FLAT;
                                                        } else if (v >> 5) == LINE_NORMAL {
                                                            space = 1;
                                                        }
                                                        q += 1;
                                                    }
                                                    // falls through
                                                    op::Line => {
                                                        if rest_mode == BREAK
                                                            || (v >> 5) >= LINE_HARD
                                                        {
                                                            verdict = FLAT;
                                                        } else if (v >> 5) == LINE_NORMAL {
                                                            space = 1;
                                                        }
                                                        q += 1;
                                                    }
                                                    op::GroupClose => {
                                                        msp -= 1;
                                                        rest_mode = self.printer.st.at(msp);
                                                        q += 1;
                                                    }
                                                    op::IndentClose => {
                                                        msp -= 1;
                                                        q += 1;
                                                    }
                                                    op::Nop => {
                                                        if ((v as u32) >> 6) as i32 != 0 {
                                                            rem = rem
                                                                - ((v as u32) >> 6) as i32
                                                                - space;
                                                            space = 0;
                                                            if rem < 0 {
                                                                verdict = BREAK;
                                                            }
                                                            q += 1;
                                                        }
                                                        q += 1;
                                                    }
                                                    op::SuffixBoundary => {
                                                        q += 1;
                                                    }
                                                    op::IfBreak => {
                                                        if ((v as u32) >> 5) as i32 != 0 {
                                                            verdict = 3;
                                                        } else {
                                                            q = if rest_mode == BREAK {
                                                                q + 2
                                                            } else {
                                                                q + 3 + self.d.at(q + 1)
                                                            };
                                                        }
                                                    }
                                                    op::Skip => {
                                                        q = q + 1 + ((v as u32) >> 5) as i32;
                                                    }
                                                    op::End => {
                                                        verdict = FLAT;
                                                    }
                                                    _ => {
                                                        // ask fits()
                                                        verdict = 3;
                                                    }
                                                }
                                            }
                                            if verdict == 3 {
                                                break 's2;
                                            }
                                            next = verdict;
                                        }
                                        remeasure = 0;
                                    }
                                }
                                let id = self.d.at(pc + 3);
                                if id != 0 {
                                    self.printer.group_mode.put(id, next);
                                }
                                if next == FLAT
                                    && (flags & G_PURE) != 0
                                    && (remeasure == 0 || (flags & G_FORCE_FLAT) != 0)
                                    && waiting == 0
                                    && o + self.d.at(pc + 2) < cap
                                    && ((flags & G_HAS_FILL) == 0
                                        || mode != FLAT
                                        || (flags & G_FORCE_FLAT) != 0)
                                {
                                    // Nothing in a pure group that is printed flat depends on the mode, the indentation or the stack: run through it.
                                    let end = pc + self.d.at(pc + 1);
                                    let from = o;
                                    // bytes that take no column
                                    let mut extra: i32 = 0;
                                    pc += 4;
                                    'l13: while pc != end {
                                        let v = self.d.at(pc);
                                        's14: {
                                            match v & 31 {
                                                op::Short => {
                                                    self.printer
                                                        .out
                                                        .put_u16(o, ((v as u32) >> 13) as i32);
                                                    o += (v >> 5) & 255;
                                                    pc += 1;
                                                    continue 'l13;
                                                }
                                                op::Static => {
                                                    let len = (v >> 5) & 255;
                                                    let s = ((v as u32) >> 13) as i32;
                                                    self.printer.out.put_u128(o, self.t.u128_at(s));
                                                    let mut k: i32 = 16;
                                                    while k < len {
                                                        self.printer
                                                            .out
                                                            .put_u128(o + k, self.t.u128_at(s + k));
                                                        k += 16;
                                                    }
                                                    o += len;
                                                    pc += 1;
                                                    continue 'l13;
                                                }
                                                op::Text => {
                                                    let len = ((v as u32) >> 5) as i32;
                                                    let s = self.d.at(pc + 1);
                                                    self.printer.out.put_u128(o, self.t.u128_at(s));
                                                    let mut k: i32 = 16;
                                                    while k < len {
                                                        self.printer
                                                            .out
                                                            .put_u128(o + k, self.t.u128_at(s + k));
                                                        k += 16;
                                                    }
                                                    o += len;
                                                    pc += 2;
                                                    continue 'l13;
                                                }
                                                op::Nop => {
                                                    let len = ((v as u32) >> 6) as i32;
                                                    if len != 0 {
                                                        let s = self.d.at(pc + 1);
                                                        let mut k: i32 = 0;
                                                        while k < len {
                                                            self.printer.out.put_u128(
                                                                o + k,
                                                                self.t.u128_at(s + k),
                                                            );
                                                            k += 16;
                                                        }
                                                        o += len;
                                                        pc += 1;
                                                    }
                                                    pc += 1;
                                                    continue 'l13;
                                                }
                                                op::IndentLine | op::DedentLine | op::Line => {
                                                    self.printer.out.put(o, 32);
                                                    o += ((v >> 5) == LINE_NORMAL) as i32;
                                                    pc += 1;
                                                    continue 'l13;
                                                }
                                                op::GroupOpen => {
                                                    let inner = self.d.at(pc + 3);
                                                    if inner != 0 {
                                                        self.printer.group_mode.put(inner, FLAT);
                                                    }
                                                    pc += 4;
                                                    continue 'l13;
                                                }
                                                op::IfBreak => {
                                                    pc = pc + 3 + self.d.at(pc + 1);
                                                    continue 'l13;
                                                }
                                                op::Skip => {
                                                    pc = pc + 1 + ((v as u32) >> 5) as i32;
                                                    continue 'l13;
                                                }
                                                op::CondOpen => {
                                                    // into its first state
                                                    pc += 7;
                                                    continue 'l13;
                                                }
                                                op::AlignTextOpen => {
                                                    pc += 2;
                                                    continue 'l13;
                                                }
                                                op::StateClose => {
                                                    pc += ((v as u32) >> 5) as i32;
                                                    continue 'l13;
                                                }
                                                op::Call => {
                                                    if sp >= st_limit + 8 {
                                                        break 's14;
                                                    }
                                                    self.printer.st.put(sp, pc + 1);
                                                    sp += 1;
                                                    pc = ((v as u32) >> 5) as i32 + 3;
                                                    continue 'l13;
                                                }
                                                op::Ret => {
                                                    sp -= 1;
                                                    pc = self.printer.st.at(sp);
                                                    continue 'l13;
                                                }
                                                op::TextW => {
                                                    let len = ((v as u32) >> 5) as i32;
                                                    let s = self.d.at(pc + 1);
                                                    if o + len > cap || eol != 0 {
                                                        break 's14;
                                                    }
                                                    let mut k: i32 = 0;
                                                    while k < len {
                                                        self.printer
                                                            .out
                                                            .put_u128(o + k, self.t.u128_at(s + k));
                                                        k += 16;
                                                    }
                                                    o += len;
                                                    extra = extra + len - self.d.at(pc + 2);
                                                    pc += 3;
                                                    continue 'l13;
                                                }
                                                op::FillOpen => {
                                                    if ((v as u32) >> 5) as i32 != 0 {
                                                        break 's14;
                                                    }
                                                    pc += 1;
                                                    continue 'l13;
                                                }
                                                _ => {
                                                    // closings, indentation, marks: nothing to do
                                                    pc += 1;
                                                    continue 'l13;
                                                }
                                            }
                                        }
                                        // a text that needs room or other line ends, a call that needs a larger stack
                                        self.printer.x_o = o;
                                        self.printer.x_pc = pc;
                                        self.printer.x_pos = 0;
                                        self.printer.x_sp = sp;
                                        self.printer.x_mode = FLAT;
                                        self.printer.x_ind = ind;
                                        self.printer.x_remeasure = 0;
                                        self.printer.x_waiting = 0;
                                        self.printer.x_all_flat = true;
                                        self.slow_step()?;
                                        self.printer.x_all_flat = false;
                                        st_limit = self.printer.st.len() as i32 - 16;
                                        cap = self.printer.out_cap - OUT_MARGIN;
                                        extra = extra + (self.printer.x_o - o) - self.printer.x_pos;
                                        o = self.printer.x_o;
                                        pc = self.printer.x_pc;
                                    }
                                    pos = pos + (o - from) - extra;
                                    continue 'l1;
                                }
                                if remeasure != 0 && (flags & G_FORCE_FLAT) != 0 {
                                    // Nothing in this group is to be measured, and the next group behind it is.
                                    return Err(self.stop(why::RARE));
                                }
                                self.printer.st.put(sp, mode);
                                sp += 1;
                                mode = next;
                                pc += 4;
                                continue 'l1;
                            }
                        }
                        op::GroupClose => {
                            sp -= 1;
                            mode = self.printer.st.at(sp);
                            pc += 1;
                            continue 'l1;
                        }
                        op::StateClose => {
                            sp -= 1;
                            mode = self.printer.st.at(sp);
                            pc += ((w as u32) >> 5) as i32;
                            continue 'l1;
                        }
                        op::IndentOpen => {
                            let child = self.printer.it.at(ind + IT_CHILD);
                            if child == 0 || sp >= st_limit {
                                break 's2;
                            }
                            self.printer.st.put(sp, ind);
                            sp += 1;
                            ind = child;
                            pc += 1;
                            continue 'l1;
                        }
                        op::IndentIfBreakOpen => {
                            let child = self.printer.it.at(ind + IT_CHILD);
                            if child == 0 || sp >= st_limit {
                                break 's2;
                            }
                            self.printer.st.put(sp, ind);
                            sp += 1;
                            if (self.printer.group_mode.at(((w as u32) >> 6) as i32) == BREAK)
                                != ((w & 32) != 0)
                            {
                                ind = child;
                            }
                            pc += 1;
                            continue 'l1;
                        }
                        op::AlignOpen => {
                            let n = (w >> 5) - ALIGN_BIAS;
                            if n <= 0 || self.printer.it.at(ind + IT_ALIGN_N) != n || sp >= st_limit
                            {
                                break 's2;
                            }
                            self.printer.st.put(sp, ind);
                            sp += 1;
                            ind = self.printer.it.at(ind + IT_ALIGN_CHILD);
                            pc += 1;
                            continue 'l1;
                        }
                        op::IndentClose => {
                            sp -= 1;
                            ind = self.printer.st.at(sp);
                            pc += 1;
                            continue 'l1;
                        }
                        op::IfBreak => {
                            let id = ((w as u32) >> 5) as i32;
                            let m = if id != 0 {
                                self.printer.group_mode.at(id)
                            } else {
                                mode
                            };
                            if m == BREAK {
                                pc += 2;
                            } else if m == FLAT {
                                pc = pc + 3 + self.d.at(pc + 1);
                            } else {
                                pc = pc + 2 + self.d.at(pc + 1);
                            }
                            continue 'l1;
                        }
                        op::Skip => {
                            pc = pc + 1 + ((w as u32) >> 5) as i32;
                            continue 'l1;
                        }
                        op::Call => {
                            if sp >= st_limit {
                                break 's2;
                            }
                            self.printer.st.put(sp, pc + 1);
                            sp += 1;
                            pc = ((w as u32) >> 5) as i32 + 3;
                            continue 'l1;
                        }
                        op::Ret => {
                            sp -= 1;
                            pc = self.printer.st.at(sp);
                            continue 'l1;
                        }
                        op::SuffixBoundary => {
                            if waiting != 0 {
                                break 's2;
                            }
                            pc += 1;
                            continue 'l1;
                        }
                        op::Nop => {
                            let len = ((w as u32) >> 6) as i32;
                            if len == 0 {
                                pc += 1;
                                continue 'l1;
                            }
                            if pos + len + ((w >> 5) & 1) > width
                                || o + len > cap
                                || (waiting & WAIT_SUFFIX) != 0
                            {
                                break 's2;
                            }
                            // It stands for a group, and the first group behind a forced line break in something flat is the one that
                            // is measured anew.
                            remeasure = 0;
                            let s = self.d.at(pc + 1);
                            // (a statement on its line)
                            if len > 96 || !copy_block::<96>(&mut self.printer.out, o, &self.t, s) {
                                let mut k: i32 = 0;
                                while k < len {
                                    self.printer.out.put_u128(o + k, self.t.u128_at(s + k));
                                    k += 16;
                                }
                            }
                            o += len;
                            pos += len;
                            pc += 2;
                            continue 'l1;
                        }
                        op::FillOpen => {
                            if sp >= st_limit || ((w as u32) >> 5) as i32 != 0 {
                                break 's2;
                            }
                            self.printer.st.put(sp, mode);
                            self.printer.st.put(sp + 1, mode);
                            sp += 2;
                            pc += 1;
                            continue 'l1;
                        }
                        op::FillItem => {
                            {
                                // Prose: a word, and behind it a line and a word, or the end. What fits() would find comes to two sums.
                                let word = self.d.at(pc + 1);
                                let rem = width - pos;
                                if w != (op::FillItem | (2 << 5))
                                    || (word & 31) != op::Text
                                    || rem < 0
                                {
                                    break 's2;
                                }
                                let behind = self.d.at(pc + 3);
                                if behind == (op::FillSep | (1 << 5)) {
                                    let second = self.d.at(pc + 6);
                                    if self.d.at(pc + 4) != (op::Line | (LINE_NORMAL << 5))
                                        || self.d.at(pc + 5) != (op::FillItem | (2 << 5))
                                        || (second & 31) != op::Text
                                    {
                                        break 's2;
                                    }
                                    self.printer.st.put(
                                        sp - 1,
                                        if ((word as u32) >> 5) as i32
                                            + 1
                                            + ((second as u32) >> 5) as i32
                                            <= rem
                                        {
                                            FLAT
                                        } else {
                                            BREAK
                                        },
                                    );
                                } else if behind != op::FillClose {
                                    break 's2;
                                }
                                mode = if (((word as u32) >> 5) as i32) <= rem {
                                    FLAT
                                } else {
                                    BREAK
                                };
                                pc += 1;
                                continue 'l1;
                            }
                        }
                        op::FillSep => {
                            mode = self.printer.st.at(sp - 1);
                            if mode == BREAK && self.printer.st.at(sp - 2) == FLAT {
                                break 's2;
                            }
                            pc += 1;
                            continue 'l1;
                        }
                        op::FillClose => {
                            sp -= 2;
                            mode = self.printer.st.at(sp);
                            pc += 1;
                            continue 'l1;
                        }
                        _ => {}
                    }
                }
                break;
            }
            self.printer.x_pc = pc;
            self.printer.x_o = o;
            self.printer.x_pos = pos;
            self.printer.x_mode = mode;
            self.printer.x_ind = ind;
            self.printer.x_sp = sp;
            self.printer.x_remeasure = remeasure;
            self.printer.x_waiting = waiting;
            if self.slow_step()? {
                return Ok(());
            }
            pc = self.printer.x_pc;
            o = self.printer.x_o;
            pos = self.printer.x_pos;
            mode = self.printer.x_mode;
            ind = self.printer.x_ind;
            sp = self.printer.x_sp;
            remeasure = self.printer.x_remeasure;
            waiting = self.printer.x_waiting;
            st_limit = self.printer.st.len() as i32 - 16;
            cap = self.printer.out_cap - OUT_MARGIN;
        }
    }

    // ---- words(): a fill of words, which measures for itself whatever the mode is
    pub(crate) fn first_word_length(&self, start: i32) -> i32 {
        let mut p = start;
        while self.t.at(p) != 32 {
            p += 1;
        }
        return p - start;
    }

    /// Prints the words of the command at pc. Returns how far the output has come; the column is in words_pos.
    /// A fill puts [line, word] on the line if it fits, so a line takes all the words up to the last blank that is not behind its edge.
    pub(crate) fn print_words(&mut self, pc: i32, mut o: i32, mut pos: i32, ind: i32) -> R<i32> {
        let length = ((self.d.at(pc) as u32) >> 5) as i32;
        let mut p = self.d.at(pc + 1);
        let end = p + length;
        let behind = self.d.at(pc + 2);
        let tabs = self.printer.it.at(ind + IT_TABS);
        let spaces = self.printer.it.at(ind + IT_SPACES);
        if spaces == HUGE {
            return Err(self.stop(why::REDO));
        }
        // at worst every word stands on a line of its own
        let need = ((length + 1) >> 1)
            .saturating_mul(tabs + spaces + 1)
            .saturating_add(o + length + 64);
        if need > self.printer.out_cap - OUT_MARGIN {
            self.grow_out_to(need)?;
        }
        if !self.printer.x_all_flat {
            let width = self.options.print_width;
            let indentation = self.printer.it.at(ind + IT_WIDTH);
            loop {
                let rem = width - pos;
                if end - p + behind <= rem {
                    break;
                }
                let mut b = p + rem;
                if b >= end {
                    b = end - 1;
                }
                while b > p && self.t.at(b) != 32 {
                    b -= 1;
                }
                if b <= p {
                    // the first word on a line is printed whether it fits or not
                    b = p;
                    while b < end && self.t.at(b) != 32 {
                        b += 1;
                    }
                    if b == end {
                        break;
                    }
                }
                let n = b - p;
                let mut k: i32 = 0;
                while k < n {
                    self.printer.out.put_u64(o + k, self.t.u64_at(p + k));
                    k += 8;
                }
                o += n;
                self.printer.out.put(o, 10);
                o += 1;
                let mut i: i32 = 0;
                while i < tabs {
                    self.printer.out.put(o + i, 9);
                    i += 1;
                }
                o += tabs;
                let mut i: i32 = 0;
                while i < spaces {
                    self.printer.out.put(o + i, 32);
                    i += 1;
                }
                o += spaces;
                pos = indentation;
                p = b + 1;
            }
        }
        let n = end - p;
        let mut k: i32 = 0;
        while k < n {
            self.printer.out.put_u64(o + k, self.t.u64_at(p + k));
            k += 8;
        }
        self.printer.words_pos = pos + n;
        return Ok(o + n);
    }

    /// The lines T[s, s + length) of standing(), each `delta` columns further to the right than it stands in the source (to the left, if that is negative): they were read in a place that is
    /// indented otherwise than the lists around it told, the body of a function among arguments that are broken, say. Returns how far the output has come. Like a text of fitted(), a line
    /// that does not fit now ends the run.
    pub(crate) fn print_shifted(&mut self, s: i32, length: i32, mut o: i32, delta: i32) -> R<i32> {
        let end = s + length;
        let mut lines: i32 = 0;
        {
            let mut p = s;
            while p < end {
                if self.t.at(p) == 10 {
                    lines += 1;
                }
                p += 1;
            }
        }
        let need = lines
            .saturating_mul(delta.max(0))
            .saturating_add(o + length + 64);
        if need > self.printer.out_cap - OUT_MARGIN {
            self.grow_out_to(need)?;
        }
        let width = self.options.print_width;
        let mut p = s;
        // of the byte at p, in the output
        let mut column = self.printer.x_pos;
        let mut is_comment = self.t.at(p) == 47;
        loop {
            while p < end && self.t.at(p) != 10 {
                self.printer.out.put(o, self.t.at(p));
                o += 1;
                p += 1;
                column += 1;
            }
            if column > width && !is_comment {
                return Err(self.stop(why::REDO));
            }
            if p == end {
                return Ok(o);
            }
            self.printer.out.put(o, 10);
            o += 1;
            p += 1;
            if self.t.at(p) == 10 {
                column = 0;
                continue;
            }
            let mut blanks = delta;
            while self.t.at(p) == 32 {
                blanks += 1;
                p += 1;
            }
            if blanks < 0 {
                return Err(self.stop(why::REDO));
            }
            let mut i: i32 = 0;
            while i < blanks {
                self.printer.out.put(o + i, 32);
                i += 1;
            }
            o += blanks;
            column = blanks;
            // no statement starts like that
            is_comment = self.t.at(p) == 47 || self.t.at(p) == 42;
        }
    }

    /// One command, with all that it takes. Returns true at the end of the stream.
    pub(crate) fn slow_step(&mut self) -> R<bool> {
        let width = self.options.print_width;
        let eol = self.options.end_of_line;
        let mut pc = self.printer.x_pc;
        let mut o = self.printer.x_o;
        let mut pos = self.printer.x_pos;
        let mut mode = self.printer.x_mode;
        let mut ind = self.printer.x_ind;
        let mut sp = self.printer.x_sp;
        let mut remeasure = self.printer.x_remeasure;
        let mut waiting = self.printer.x_waiting;
        if sp >= self.printer.st.len() as i32 - 16 {
            self.grow_stack()?;
        }
        let w = self.d.at(pc);
        's0: {
            match w & 31 {
                op::IndentLine => {
                    // the two commands one after the other: the line stands in front of the doc, with a Ret behind it
                    self.printer.st.put(sp, ind);
                    self.printer.st.put(sp + 1, pc + 1);
                    sp += 2;
                    ind = self.make_indent(ind);
                    pc = w >> 5 << 1;
                }
                op::DedentLine => {
                    ind = self.printer.st.at(sp - 1);
                    self.printer.st.put(sp - 1, pc + 1);
                    pc = w >> 5 << 1;
                }
                op::BreakText | op::Short | op::Static | op::Text => {
                    // the buffer is full
                    self.grow_out_to(
                        o + (if (w & 31) == op::Text {
                            ((w as u32) >> 5) as i32
                        } else {
                            (w >> 5) & 255
                        }) + 64,
                    )?;
                }
                op::TextW => {
                    let len = ((w as u32) >> 5) as i32;
                    let s = self.d.at(pc + 1);
                    if self.d.at(pc + 2) < STANDING_BELOW && pos != (self.d.at(pc + 2) & 4095) {
                        // standing(), and the lines do not stand where they were expected, or do not start their line
                        if (self.d.at(pc + 2) & (1 << 24)) != 0
                            || pos != self.printer.it.at(ind + IT_WIDTH)
                        {
                            return Err(self.stop(why::REDO));
                        }
                        o = self.print_shifted(s, len, o, pos - (self.d.at(pc + 2) & 4095))?;
                        pos += (self.d.at(pc + 2) >> 12) & 4095;
                        pc += 3;
                        break 's0;
                    }
                    if o + len * 2 > self.printer.out_cap - OUT_MARGIN {
                        self.grow_out_to(o + len * 2 + 64)?;
                    }
                    if eol == 0 {
                        if len > 256 {
                            self.printer.out.set_all(self.t.sub(s, s + len), o);
                        } else {
                            let mut k: i32 = 0;
                            while k < len {
                                if !copy_block::<64>(&mut self.printer.out, o + k, &self.t, s + k) {
                                    self.printer.out.set_all(self.t.sub(s + k, s + len), o + k);
                                    break;
                                }
                                k += 64;
                            }
                        }
                        o += len;
                    } else {
                        let mut i: i32 = 0;
                        while i < len {
                            let c = self.t.at(s + i);
                            if c == 10 {
                                if eol == EOL_CRLF {
                                    self.printer.out.put(o, 13);
                                    self.printer.out.put(o + 1, 10);
                                    o += 2;
                                } else {
                                    self.printer.out.put(o, 13);
                                    o += 1;
                                }
                            } else {
                                self.printer.out.put(o, c);
                                o += 1;
                            }
                            i += 1;
                        }
                    }
                    let text_width = self.d.at(pc + 2);
                    if text_width < STANDING_BELOW {
                        // standing(): the indentation is in the text
                        pos += (text_width >> 12) & 4095;
                    } else {
                        pos += text_width;
                    }
                    pc += 3;
                }
                op::Line => {
                    let kind = w >> 5;
                    if mode == FLAT {
                        remeasure = 1;
                    }
                    if (waiting & WAIT_SUFFIX) != 0 {
                        // the comments that wait for the end of the line go first, then this command runs again
                        // (behind a blank Prettier writes another one before them, the long way does not; at a line break in a string, a
                        // template or a comment Prettier writes them into that text)
                        if self.printer.out.at(o - 1) == 32 || kind == LINE_LITERAL {
                            return Err(self.rare(rare::COMMENT));
                        }
                        self.printer.st.put(sp, pc);
                        self.printer.st.put(sp + 1, mode);
                        self.printer.st.put(sp + 2, ind);
                        self.printer.st.put(sp + 3, self.printer.sx_start);
                        self.printer.st.put(sp + 4, self.printer.sx_end);
                        sp += 5;
                        pc = self.printer.sx.at(self.printer.sx_start);
                        mode = self.printer.sx.at(self.printer.sx_start + 1);
                        ind = self.printer.sx.at(self.printer.sx_start + 2);
                        self.printer.sx_start = self.printer.sx_end;
                        waiting &= !WAIT_SUFFIX;
                        break 's0;
                    }
                    let r = if kind == LINE_LITERAL {
                        self.printer.it.at(ind + IT_ROOT)
                    } else {
                        ind
                    };
                    if kind != LINE_LITERAL {
                        while o > 0
                            && (self.printer.out.at(o - 1) == 32 || self.printer.out.at(o - 1) == 9)
                        {
                            o -= 1;
                        }
                    }
                    // A line that can be a blank or nothing is broken on a line with nothing on it: Prettier leaves that line empty, the long
                    // way skips the line break. Right behind another line it is meant to: an empty line between two elements of an array.
                    if kind < LINE_HARD
                        && matches!(self.printer.out.at(o - 1), 10 | 13)
                        && self.d.at(pc - 1) != (op::Line | (LINE_NORMAL << 5))
                    {
                        return Err(self.rare(rare::BROKEN));
                    }
                    if (waiting & WAIT_CURSOR) != 0 {
                        // the white space at the end of the line is gone, and a cursor that stood in it stands at the end of the line
                        let mut i: i32 = 0;
                        while i < self.printer.cursor_count {
                            if self.printer.cursor_positions.at(i) > o {
                                self.printer.cursor_positions.put(i, o);
                            }
                            i += 1;
                        }
                        waiting &= !WAIT_CURSOR;
                    }
                    let tabs = self.printer.it.at(r + IT_TABS);
                    let spaces = self.printer.it.at(r + IT_REAL_SPACES);
                    let prefix_length = self.printer.it.at(r + IT_PREFIX_LEN);
                    if o + prefix_length + tabs + spaces + 3 > self.printer.out_cap - OUT_MARGIN {
                        self.grow_out_to(o + prefix_length + tabs + spaces + 64)?;
                    }
                    if kind == LINE_LITERAL && self.options.marks_line_breaks_in_texts {
                        self.printer.out.put(o, 13);
                        o += 1;
                    }
                    if eol == EOL_CRLF {
                        self.printer.out.put(o, 13);
                        self.printer.out.put(o + 1, 10);
                        o += 2;
                    } else {
                        self.printer.out.put(o, if eol == EOL_CR { 13 } else { 10 });
                        o += 1;
                    }
                    if prefix_length != 0 {
                        let prefix = self.printer.it.at(r + IT_PREFIX);
                        let mut i: i32 = 0;
                        while i < prefix_length {
                            self.printer.out.put(o + i, self.printer.ib.at(prefix + i));
                            i += 1;
                        }
                        o += prefix_length;
                    }
                    let mut i: i32 = 0;
                    while i < tabs {
                        self.printer.out.put(o + i, 9);
                        i += 1;
                    }
                    o += tabs;
                    let mut i: i32 = 0;
                    while i < spaces {
                        self.printer.out.put(o + i, 32);
                        i += 1;
                    }
                    o += spaces;
                    pos = self.printer.it.at(r + IT_WIDTH);
                    pc += 1;
                }
                op::GroupOpen => {
                    // a group that has to be measured, or the stack was full
                    let flags = w >> 5;
                    if (flags & (G_FORCE_FLAT | G_BREAK)) != 0 || (mode == FLAT && remeasure == 0) {
                        break 's0;
                    }
                    remeasure = 0;
                    let rem = width - pos;
                    let ok: bool;
                    if (flags & G_PURE) != 0 && (waiting & WAIT_SUFFIX) == 0 {
                        let gw = self.d.at(pc + 2);
                        ok = gw <= rem
                            && self.fits(
                                pc + self.d.at(pc + 1),
                                mode,
                                rem - gw,
                                if (flags & G_END_PENDING) != 0 { 1 } else { 0 },
                                -1,
                                false,
                                0,
                                0,
                                sp,
                                false,
                            );
                    } else {
                        ok = self.fits(
                            pc + 4,
                            FLAT,
                            rem,
                            0,
                            -1,
                            false,
                            1,
                            mode,
                            sp,
                            (waiting & WAIT_SUFFIX) != 0,
                        );
                    }
                    if !ok && (flags & G_GIVES_UP) != 0 {
                        return Err(self.rare(rare::BROKEN));
                    }
                    self.printer.st.put(sp, mode);
                    sp += 1;
                    mode = if ok { FLAT } else { BREAK };
                    let id = self.d.at(pc + 3);
                    if id != 0 {
                        self.printer.group_mode.put(id, mode);
                    }
                    pc += 4;
                }
                op::CondOpen => {
                    let flags = w >> 5;
                    let mut target = pc + 4;
                    let mut next = FLAT;
                    if mode == FLAT && remeasure == 0 {
                        if (flags & G_BREAK) != 0 {
                            next = BREAK;
                        }
                    } else {
                        remeasure = 0;
                        let last = pc + self.d.at(pc + 2);
                        if (flags & G_BREAK) != 0 {
                            target = last;
                            next = BREAK;
                        } else {
                            let rem = width - pos;
                            let behind = pc + self.d.at(pc + 1);
                            loop {
                                if target >= last {
                                    target = last;
                                    next = BREAK;
                                    break;
                                }
                                let sf = self.d.at(target) >> 5;
                                let ok: bool;
                                if (sf & G_PURE) != 0 && (waiting & WAIT_SUFFIX) == 0 {
                                    let sw = self.d.at(target + 2);
                                    ok = sw <= rem
                                        && self.fits(
                                            behind,
                                            mode,
                                            rem - sw,
                                            if (sf & G_END_PENDING) != 0 { 1 } else { 0 },
                                            -1,
                                            false,
                                            0,
                                            0,
                                            sp,
                                            false,
                                        );
                                } else {
                                    ok = self.fits(
                                        target + 3,
                                        FLAT,
                                        rem,
                                        0,
                                        -1,
                                        false,
                                        1,
                                        mode,
                                        sp,
                                        (waiting & WAIT_SUFFIX) != 0,
                                    );
                                }
                                if ok {
                                    break;
                                }
                                target += self.d.at(target + 1);
                            }
                        }
                    }
                    self.printer.st.put(sp, mode);
                    sp += 1;
                    mode = next;
                    pc = target + 3;
                }
                op::IndentOpen => {
                    self.printer.st.put(sp, ind);
                    sp += 1;
                    ind = self.make_indent(ind);
                    pc += 1;
                }
                op::AlignOpen => {
                    self.printer.st.put(sp, ind);
                    sp += 1;
                    ind = self.make_align(ind, (w >> 5) - ALIGN_BIAS);
                    pc += 1;
                }
                op::AlignTextOpen => {
                    self.printer.st.put(sp, ind);
                    sp += 1;
                    ind = self.make_align_text(ind, self.d.at(pc + 1), ((w as u32) >> 5) as i32);
                    pc += 2;
                }
                op::IndentIfBreakOpen => {
                    // make the indentation; print_doc() takes it from there
                    self.make_indent(ind);
                }
                op::SuffixOpen => {
                    if self.printer.sx_end + 3 > (self.printer.sx.len() as i32) {
                        self.make_room(|q| &mut q.printer.sx, self.printer.sx_end + 3);
                    }
                    self.printer.sx.put(self.printer.sx_end, pc + 1);
                    self.printer.sx.put(self.printer.sx_end + 1, mode);
                    self.printer.sx.put(self.printer.sx_end + 2, ind);
                    self.printer.sx_end += 3;
                    waiting |= WAIT_SUFFIX;
                    pc = pc + 1 + ((w as u32) >> 5) as i32;
                }
                op::SuffixClose => {
                    let current = self.printer.st.at(sp - 2) + 3;
                    if current < self.printer.st.at(sp - 1) {
                        self.printer.st.put(sp - 2, current);
                        pc = self.printer.sx.at(current);
                        mode = self.printer.sx.at(current + 1);
                        ind = self.printer.sx.at(current + 2);
                    } else {
                        sp -= 5;
                        pc = self.printer.st.at(sp);
                        mode = self.printer.st.at(sp + 1);
                        ind = self.printer.st.at(sp + 2);
                        if self.printer.sx_start == self.printer.sx_end {
                            let v0 = self.printer.st.at(sp + 3);
                            self.printer.sx_end = v0;
                            self.printer.sx_start = v0;
                        }
                    }
                    waiting = (waiting & WAIT_CURSOR)
                        | (if self.printer.sx_start != self.printer.sx_end {
                            WAIT_SUFFIX
                        } else {
                            0
                        });
                }
                op::Cursor => {
                    if self.printer.cursor_count < 2 {
                        self.printer
                            .cursor_positions
                            .put(self.printer.cursor_count, o);
                        self.printer.cursor_count += 1;
                    }
                    waiting |= WAIT_CURSOR;
                    pc += 1;
                }
                op::SuffixBoundary => {
                    if (waiting & WAIT_SUFFIX) == 0 {
                        pc += 1;
                        break 's0;
                    }
                    if (w >> 5) != 0 {
                        return Err(self.rare(rare::COMMENT));
                    }
                    // comments wait: end the line here
                    self.printer.st.put(sp, pc + 1);
                    sp += 1;
                    pc = self.printer.x_stub;
                }
                op::FillOpen => {
                    if ((w as u32) >> 5) as i32 != 0 {
                        if waiting != 0 || eol != 0 {
                            return Err(self.stop(why::REDO));
                        }
                        o = self.print_words(pc, o, pos, ind)?;
                        pos = self.printer.words_pos;
                        pc += 3;
                        break 's0;
                    }
                    self.printer.st.put(sp, mode);
                    self.printer.st.put(sp + 1, mode);
                    sp += 2;
                    pc += 1;
                }
                op::FillItem => {
                    let rem = width - pos;
                    let has_suffix = (waiting & WAIT_SUFFIX) != 0;
                    let content_start = pc + 1;
                    let sep = content_start + ((w as u32) >> 5) as i32;
                    // Nothing between two soft lines (JSX: an element, a line break, text), and the first of them is a line break. Where the text does not fit either,
                    // Prettier breaks the second too, which leaves a line with nothing on it. The long way writes one line break for the two.
                    if w == op::FillItem
                        && self.printer.st.at(sp - 1) == BREAK
                        && self.d.at(pc - 2) == (op::FillSep | (1 << 5))
                        && self.d.at(pc - 1) == (op::Line | (LINE_SOFT << 5))
                        && self.d.at(sep) == (op::FillSep | (1 << 5))
                        && self.d.at(sep + 1) == (op::Line | (LINE_SOFT << 5))
                    {
                        self.printer.st.put(sp - 1, FLAT);
                        mode = FLAT;
                        pc = content_start;
                        break 's0;
                    }
                    // prose: a word, a line, a word. The two calls of fits() come to two sums.
                    if w == (op::FillItem | (2 << 5))
                        && rem >= 0
                        && (self.d.at(content_start) & 31) == op::Text
                        && self.d.at(sep) == (op::FillSep | (1 << 5))
                        && self.d.at(sep + 1) == (op::Line | (LINE_NORMAL << 5))
                        && self.d.at(sep + 2) == (op::FillItem | (2 << 5))
                        && (self.d.at(sep + 3) & 31) == op::Text
                    {
                        let word_width = ((self.d.at(content_start) as u32) >> 5) as i32;
                        self.printer.st.put(
                            sp - 1,
                            if word_width + 1 + ((self.d.at(sep + 3) as u32) >> 5) as i32 <= rem {
                                FLAT
                            } else {
                                BREAK
                            },
                        );
                        mode = if word_width <= rem { FLAT } else { BREAK };
                        pc = content_start;
                        break 's0;
                    }
                    let content_fits =
                        self.fits(content_start, FLAT, rem, 0, sep, true, 0, 0, sp, has_suffix);
                    let sep_word = self.d.at(sep);
                    if (sep_word & 31) == op::FillSep {
                        let second = sep + 1 + ((sep_word as u32) >> 5) as i32;
                        let second_word = self.d.at(second);
                        if (second_word & 31) == op::FillItem {
                            let second_end = second + 1 + ((second_word as u32) >> 5) as i32;
                            let v1 = sp - 1;
                            let v2 = if self.fits(
                                content_start,
                                FLAT,
                                rem,
                                0,
                                second_end,
                                true,
                                0,
                                0,
                                sp,
                                has_suffix,
                            ) {
                                FLAT
                            } else {
                                BREAK
                            };
                            self.printer.st.put(v1, v2);
                        } else {
                            self.printer
                                .st
                                .put(sp - 1, if content_fits { FLAT } else { BREAK });
                        }
                    }
                    mode = if content_fits { FLAT } else { BREAK };
                    pc = content_start;
                }
                op::FillSep => {
                    mode = self.printer.st.at(sp - 1);
                    // What is filled breaks where it is full, also in something that is printed flat: a state of a conditional group but the
                    // last. The long way prints all of that flat.
                    if mode == BREAK && self.printer.st.at(sp - 2) == FLAT {
                        return Err(self.rare(rare::BROKEN));
                    }
                    pc += 1;
                }
                op::FillClose => {
                    sp -= 2;
                    mode = self.printer.st.at(sp);
                    pc += 1;
                }
                op::Call => {}
                op::End => {
                    if (waiting & WAIT_SUFFIX) != 0 {
                        self.printer.st.put(sp, pc);
                        self.printer.st.put(sp + 1, mode);
                        self.printer.st.put(sp + 2, ind);
                        self.printer.st.put(sp + 3, self.printer.sx_start);
                        self.printer.st.put(sp + 4, self.printer.sx_end);
                        sp += 5;
                        pc = self.printer.sx.at(self.printer.sx_start);
                        mode = self.printer.sx.at(self.printer.sx_start + 1);
                        ind = self.printer.sx.at(self.printer.sx_start + 2);
                        self.printer.sx_start = self.printer.sx_end;
                        waiting &= !WAIT_SUFFIX;
                        break 's0;
                    }
                    self.printer.out_length = o;
                    return Ok(true);
                }
                op::Nop => {
                    // The text was written on the guess that it fits, and that it starts its line. Behind a comment that waits for the end of
                    // the line it does not, and whether there is something in it that ends the line for the comment cannot be seen.
                    if pos + ((w as u32) >> 6) as i32 + ((w >> 5) & 1) > width
                        || (waiting & WAIT_SUFFIX) != 0
                    {
                        return Err(self.stop(why::REDO));
                    }
                    // the buffer is full
                    self.grow_out_to(o + ((w as u32) >> 6) as i32 + 64)?;
                }
                _ => {
                    return Err(self.stop(why::BUG));
                }
            }
        }
        self.printer.x_pc = pc;
        self.printer.x_o = o;
        self.printer.x_pos = pos;
        self.printer.x_mode = mode;
        self.printer.x_ind = ind;
        self.printer.x_sp = sp;
        self.printer.x_remeasure = remeasure;
        self.printer.x_waiting = waiting;
        return Ok(false);
    }

    pub(crate) fn print_nothing(&mut self) {
        self.printer.out_length = 0;
    }

    /// Prints a detached doc (detach_open() .. detach_close()) for a line of `width` columns, while the stream is still being
    /// written. The result is the generated text T[printed_start, printed_end). It may replace T: read T again.
    pub(crate) fn print_to_text(&mut self, doc: i32, width: i32) -> R<()> {
        self.reserve();
        let p = self.doc.d_pos;
        self.d.put(p, op::Call | (doc << 5));
        self.d.put(p + 1, op::End);
        self.d.put(p + 2, op::Line | (LINE_HARD << 5));
        self.d.put(p + 3, op::Ret);
        let saved_width = self.options.print_width;
        let saved_end_of_line = self.options.end_of_line;
        let saved_marks = self.options.marks_line_breaks_in_texts;
        let saved_indentation = self.options.indentation;
        self.set_print_width(width);
        // the text goes through the printer once more
        self.set_end_of_line(EOL_LF);
        self.options.marks_line_breaks_in_texts = false;
        self.options.indentation = 0;
        let v0 = (|| -> R<Option<()>> {
            self.print_doc(p, p + 2)?;
            Ok(None)
        })();
        self.set_print_width(saved_width);
        self.set_end_of_line(saved_end_of_line);
        self.options.marks_line_breaks_in_texts = saved_marks;
        self.options.indentation = saved_indentation;
        if let Some(v) = v0? {
            return Ok(v);
        }
        let length = self.printer.out_length;
        self.reserve_gen(length);
        self.t
            .set_all(self.printer.out.sub(0, length), self.text.gen_pos);
        self.printer.printed_start = self.text.gen_pos;
        self.printer.printed_end = self.text.gen_pos + length;
        self.set_gen_pos(self.printer.printed_end);
        Ok(())
    }
}
