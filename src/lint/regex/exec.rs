//! The machine that runs a [`Program`]: it tries the alternatives in the order that the
//! specification gives, and goes back to the last choice when it fails.
//!
//! There is no recursion. Choices, and the values of slots to restore when going back, are on an
//! explicit stack.

use super::program::{Inst, NONE, Prefilter, Program, Repeat, Single};
use super::{unicode, wtf8};
use bun_core::strings;
use smallvec::SmallVec;

/// How many instructions and characters one search may take. A search that needs more is
/// given up: in JavaScript it would take seconds, or forever.
pub(super) const STEP_LIMIT: u64 = 1 << 27;

/// How many entries the stack may have.
const STACK_LIMIT: usize = 1 << 22;

/// The search was given up: see [`STEP_LIMIT`].
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct LimitExceeded;

#[derive(Copy, Clone)]
enum Frame {
    /// Continue at `pc` from `pos`.
    Branch { pc: u32, pos: u32 },
    /// A slot had this value.
    Restore { slot: u32, value: u32 },
    /// A greedy `Repeat` has matched up to `pos`. It can give characters back up to `bound`.
    Greedy { pc: u32, bound: u32, pos: u32 },
    /// A lazy `Repeat` has matched `count` characters, up to `pos`.
    Lazy { pc: u32, pos: u32, count: u32 },
    /// The start of a lookaround, which was at `pos`. If it is negative and what is in it fails,
    /// continue at `pc`.
    Look { pc: u32, pos: u32, negate: bool },
}

pub(super) type Slots = SmallVec<[u32; 16]>;

pub(super) struct Machine<'p, 't> {
    program: &'p Program,
    text: &'t [u8],
    pub(super) slots: Slots,
    stack: SmallVec<[Frame; 16]>,
    steps: u64,
    /// Whether the positions of groups are wanted, or needed by backreferences.
    captures: bool,
}

#[inline]
fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

impl<'p, 't> Machine<'p, 't> {
    pub(super) fn new(program: &'p Program, text: &'t [u8], captures: bool) -> Self {
        Machine {
            program,
            text,
            slots: SmallVec::new(),
            stack: SmallVec::new(),
            steps: 0,
            captures: captures || program.has_backreferences,
        }
    }

    /// The character at `pos` and the position after it.
    #[inline]
    fn next(&self, pos: u32) -> Option<(u32, u32)> {
        let byte = *self.text.get(pos as usize)?;
        if byte < 0x80 {
            return Some((u32::from(byte), pos + 1));
        }
        let (c, len) = if self.program.unicode {
            wtf8::code_point_at(self.text, pos as usize)
        } else {
            wtf8::unit_at(self.text, pos as usize)
        };
        Some((c, pos + len as u32))
    }

    /// The character before `pos` and the position before it.
    #[inline]
    fn previous(&self, pos: u32) -> Option<(u32, u32)> {
        let byte = *self.text.get(pos.checked_sub(1)? as usize)?;
        if byte < 0x80 {
            return Some((u32::from(byte), pos - 1));
        }
        let (c, len) = if self.program.unicode {
            wtf8::code_point_before(self.text, pos as usize)
        } else {
            wtf8::unit_before(self.text, pos as usize)
        };
        Some((c, pos - len as u32))
    }

    #[inline]
    fn step(&self, pos: u32, back: bool) -> Option<(u32, u32)> {
        if back { self.previous(pos) } else { self.next(pos) }
    }

    #[inline]
    fn matches(&self, what: Single, c: u32) -> bool {
        match what {
            Single::Char(wanted) => c == wanted,
            Single::Set(set) => self.program.sets.get(set as usize).is_some_and(|set| set.contains(c)),
        }
    }

    #[inline]
    fn set_slot(&mut self, slot: u32, value: u32) {
        if let Some(place) = self.slots.get_mut(slot as usize) {
            self.stack.push(Frame::Restore { slot, value: *place });
            *place = value;
        }
    }

    #[inline]
    fn slot(&self, slot: u32) -> u32 {
        self.slots.get(slot as usize).copied().unwrap_or(NONE)
    }

    fn is_line_terminator_before(&self, pos: u32) -> bool {
        let head = self.text.get(..pos as usize).unwrap_or_default();
        matches!(head, [.., b'\n' | b'\r'] | [.., 0xE2, 0x80, 0xA8 | 0xA9])
    }

    fn is_line_terminator_at(&self, pos: u32) -> bool {
        let tail = self.text.get(pos as usize..).unwrap_or_default();
        matches!(tail, [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..])
    }

    fn is_word(&self, c: Option<(u32, u32)>, folded: bool) -> bool {
        match c {
            Some((c, _)) if c < 0x80 => is_word_byte(c as u8),
            Some((c, _)) => folded && (c == 0x17F || c == 0x212A),
            None => false,
        }
    }

    /// The position after what `start..end` of the text matches again at `pos`.
    fn backreference(
        &self,
        (start, end): (u32, u32),
        mut pos: u32,
        ignore_case: bool,
        back: bool,
    ) -> Option<u32> {
        let unicode = self.program.unicode;
        let (mut from, to) = if back { (end, start) } else { (start, end) };
        while from != to {
            let (wanted, next_from) = self.step(from, back)?;
            let (c, next_pos) = self.step(pos, back)?;
            if c != wanted
                && !(ignore_case
                    && unicode::canonicalize(c, unicode) == unicode::canonicalize(wanted, unicode))
            {
                return None;
            }
            // A group never ends in the middle of a character, but do not run past its end.
            if if back { next_from < to } else { next_from > to } {
                return None;
            }
            from = next_from;
            pos = next_pos;
        }
        Some(pos)
    }

    /// Matches `repeat` as often as it must and, if it is greedy, as it can. The position after
    /// that, and after the least number of characters, and the number of characters.
    fn repeat(&mut self, repeat: &Repeat, mut pos: u32) -> Option<(u32, u32, u32)> {
        let limit = if repeat.greedy { repeat.max } else { repeat.min };
        let mut count = 0;
        let mut bound = pos;
        if !repeat.back
            && let Single::Set(set) = repeat.what
            && let Some(set) = self.program.sets.get(set as usize)
        {
            let ascii = set.ascii();
            let tail = self.text.get(pos as usize..).unwrap_or_default();
            let run = tail.iter().take(limit as usize);
            count = run.take_while(|byte| **byte < 0x80 && (ascii >> **byte) & 1 != 0).count() as u32;
            pos += count;
            bound += count.min(repeat.min);
        }
        while count < limit {
            match self.step(pos, repeat.back) {
                Some((c, next)) if self.matches(repeat.what, c) => pos = next,
                _ => break,
            }
            count += 1;
            if count == repeat.min {
                bound = pos;
            }
        }
        self.steps += u64::from(count);
        (count >= repeat.min).then_some((pos, bound, count))
    }

    /// The last position in `from..to` where `byte` is.
    fn last_before(&self, byte: u8, from: u32, to: u32) -> Option<u32> {
        let text = self.text.get(from as usize..(to as usize).min(self.text.len()))?;
        strings::last_index_of_char(text, byte).map(|found| from + found as u32)
    }

    /// For a lazy `repeat` that has matched `count` characters, up to `pos`: the next position where
    /// what follows could match, after `pos` if `more`, and the number of characters up to there.
    fn longer(
        &mut self,
        repeat: &Repeat,
        mut pos: u32,
        mut count: u32,
        mut more: bool,
    ) -> Option<(u32, u32)> {
        loop {
            if !more && repeat.then.is_none_or(|byte| self.text.get(pos as usize) == Some(&byte)) {
                return Some((pos, count));
            }
            more = false;
            if count >= repeat.max {
                return None;
            }
            match self.step(pos, repeat.back) {
                Some((c, next)) if self.matches(repeat.what, c) => pos = next,
                _ => return None,
            }
            count += 1;
            self.steps += 1;
        }
    }

    /// Whether the pattern matches from `start`. If so, the end of the match.
    fn run(&mut self, start: u32) -> Result<Option<u32>, LimitExceeded> {
        let program = self.program;
        let mut pc = 0u32;
        let mut pos = start;

        'run: loop {
            self.steps += 1;
            if self.steps > STEP_LIMIT || self.stack.len() > STACK_LIMIT {
                return Err(LimitExceeded);
            }
            let Some(inst) = program.insts.get(pc as usize) else { return Ok(None) };
            let ok = match *inst {
                Inst::Match => return Ok(Some(pos)),
                Inst::Char { c, back } => match self.step(pos, back) {
                    Some((found, next)) if found == c => {
                        pos = next;
                        true
                    }
                    _ => false,
                },
                Inst::Set { set, back } => match self.step(pos, back) {
                    Some((found, next)) if self.matches(Single::Set(set), found) => {
                        pos = next;
                        true
                    }
                    _ => false,
                },
                Inst::Literal { start, len, back } => {
                    let literal = program.literals.get(start as usize..(start + len) as usize);
                    let literal = literal.unwrap_or_default();
                    if back {
                        let found =
                            self.text.get(..pos as usize).is_some_and(|head| head.ends_with(literal));
                        if found {
                            pos -= len;
                        }
                        found
                    } else {
                        let found = (self.text.get(pos as usize..))
                            .is_some_and(|tail| tail.starts_with(literal));
                        if found {
                            pos += len;
                        }
                        found
                    }
                }
                Inst::Jump(target) => {
                    pc = target;
                    continue 'run;
                }
                Inst::Split { first, second } => {
                    self.stack.push(Frame::Branch { pc: second, pos });
                    pc = first;
                    continue 'run;
                }
                Inst::Save(slot) => {
                    if self.captures || slot >= program.group_count * 2 {
                        self.set_slot(slot, pos);
                    }
                    true
                }
                Inst::Clear { from, to } => {
                    if self.captures {
                        for slot in from..to {
                            if self.slot(slot) != NONE {
                                self.set_slot(slot, NONE);
                            }
                        }
                    }
                    true
                }
                Inst::Zero(slot) => {
                    self.set_slot(slot, 0);
                    true
                }
                Inst::Progress(slot) => self.slot(slot) != pos,
                Inst::LoopHead(index) => {
                    let Some(it) = program.loops.get(index as usize) else { return Ok(None) };
                    let count = self.slot(it.counter);
                    if count >= it.min {
                        if count >= it.max {
                            pc = it.exit;
                            continue 'run;
                        }
                        if it.greedy {
                            self.stack.push(Frame::Branch { pc: it.exit, pos });
                        } else {
                            self.stack.push(Frame::Branch { pc: pc + 1, pos });
                            pc = it.exit;
                            continue 'run;
                        }
                    }
                    true
                }
                Inst::LoopTail(index) => {
                    let Some(it) = program.loops.get(index as usize) else { return Ok(None) };
                    let count = self.slot(it.counter);
                    if it.mark != NONE && count >= it.min && self.slot(it.mark) == pos {
                        false
                    } else {
                        self.set_slot(it.counter, count.saturating_add(1));
                        pc = it.head;
                        continue 'run;
                    }
                }
                Inst::Repeat(index) => {
                    let Some(it) = program.repeats.get(index as usize) else { return Ok(None) };
                    let stop = self.repeat(it, pos).and_then(|(end, bound, count)| {
                        if !it.greedy {
                            return self.longer(it, end, count, false);
                        }
                        let end = match it.then {
                            Some(byte) => self.last_before(byte, bound, end + 1)?,
                            None => end,
                        };
                        Some((end, bound))
                    });
                    match stop {
                        Some((end, bound)) if it.greedy => {
                            if end != bound {
                                self.stack.push(Frame::Greedy { pc, bound, pos: end });
                            }
                            pos = end;
                            true
                        }
                        Some((end, count)) => {
                            if count < it.max {
                                self.stack.push(Frame::Lazy { pc, pos: end, count });
                            }
                            pos = end;
                            true
                        }
                        None => false,
                    }
                }
                Inst::Start { multiline } => {
                    pos == 0 || (multiline && self.is_line_terminator_before(pos))
                }
                Inst::End { multiline } => {
                    pos as usize == self.text.len() || (multiline && self.is_line_terminator_at(pos))
                }
                Inst::WordBoundary { negate, folded } => {
                    let before = self.is_word(self.previous(pos), folded);
                    let after = self.is_word(self.next(pos), folded);
                    (before != after) != negate
                }
                Inst::Look(index) => {
                    let Some(it) = program.looks.get(index as usize) else { return Ok(None) };
                    if let Some(height) = self.slots.get_mut(it.height as usize) {
                        *height = self.stack.len() as u32;
                    }
                    self.stack.push(Frame::Look { pc: it.next, pos, negate: it.negate });
                    true
                }
                Inst::LookEnd(index) => {
                    let Some(it) = program.looks.get(index as usize) else { return Ok(None) };
                    let height = self.slot(it.height) as usize;
                    let Some(Frame::Look { pos: before, .. }) = self.stack.get(height).copied() else {
                        return Ok(None);
                    };
                    if it.negate {
                        self.unwind(height);
                        false
                    } else {
                        // There is no going back into it, but what it captured is undone further back.
                        let mut kept = height;
                        for i in height + 1..self.stack.len() {
                            if let Frame::Restore { .. } = self.stack[i] {
                                self.stack[kept] = self.stack[i];
                                kept += 1;
                            }
                        }
                        self.stack.truncate(kept);
                        pos = before;
                        true
                    }
                }
                Inst::Backreference { start, len, ignore_case, back } => {
                    let groups = program.groups.get(start as usize..start as usize + usize::from(len));
                    let captured = groups.unwrap_or_default().iter().find_map(|slot| {
                        let range = (self.slot(*slot), self.slot(*slot + 1));
                        (range.0 != NONE && range.1 != NONE).then_some(range)
                    });
                    match captured {
                        None => true,
                        Some(range) => {
                            self.steps += u64::from(range.1 - range.0);
                            match self.backreference(range, pos, ignore_case, back) {
                                Some(end) => {
                                    pos = end;
                                    true
                                }
                                None => false,
                            }
                        }
                    }
                }
            };
            if ok {
                pc += 1;
                continue 'run;
            }

            // Back to the last choice.
            loop {
                let Some(frame) = self.stack.pop() else { return Ok(None) };
                match frame {
                    Frame::Restore { slot, value } => {
                        if let Some(place) = self.slots.get_mut(slot as usize) {
                            *place = value;
                        }
                    }
                    Frame::Branch { pc: to, pos: at } => {
                        (pc, pos) = (to, at);
                        continue 'run;
                    }
                    Frame::Greedy { pc: at, bound, pos: end } => {
                        let Some(it) = program.repeats.get(repeat_index(program, at)) else {
                            return Ok(None);
                        };
                        let shorter = match it.then {
                            Some(byte) => self.last_before(byte, bound, end),
                            None => self.step(end, !it.back).map(|(_, shorter)| shorter),
                        };
                        let Some(shorter) = shorter else { continue };
                        if shorter != bound {
                            self.stack.push(Frame::Greedy { pc: at, bound, pos: shorter });
                        }
                        (pc, pos) = (at + 1, shorter);
                        continue 'run;
                    }
                    Frame::Lazy { pc: at, pos: end, count } => {
                        let Some(it) = program.repeats.get(repeat_index(program, at)) else {
                            return Ok(None);
                        };
                        if let Some((longer, count)) = self.longer(it, end, count, true) {
                            if count < it.max {
                                self.stack.push(Frame::Lazy { pc: at, pos: longer, count });
                            }
                            (pc, pos) = (at + 1, longer);
                            continue 'run;
                        }
                    }
                    Frame::Look { negate: false, .. } => {}
                    Frame::Look { pc: to, pos: at, negate: true } => {
                        (pc, pos) = (to, at);
                        continue 'run;
                    }
                }
            }
        }
    }

    /// Removes what is on the stack from `height`, and restores the slots.
    fn unwind(&mut self, height: usize) {
        while self.stack.len() > height {
            if let Some(Frame::Restore { slot, value }) = self.stack.pop()
                && let Some(place) = self.slots.get_mut(slot as usize)
            {
                *place = value;
            }
        }
    }

    /// The first position from `pos` where a match could start.
    fn candidate(&self, pos: u32) -> Option<u32> {
        let tail = self.text.get(pos as usize..)?;
        let skipped = match &self.program.prefilter {
            Prefilter::None => 0,
            Prefilter::Anchored => return (pos == 0).then_some(0),
            Prefilter::Prefix(prefix) => strings::index_of(tail, prefix)?,
            Prefilter::Bytes(bytes) if tail.len() < 256 => {
                tail.iter().position(|byte| bytes.contains(byte))?
            }
            Prefilter::Bytes(bytes) => strings::index_of_any(tail, bytes)?,
            Prefilter::ByteSet(set) => tail
                .iter()
                .position(|byte| set[usize::from(byte >> 6)] & (1 << (byte & 63)) != 0)?,
        };
        Some(pos + skipped as u32)
    }

    /// The first match that starts at `start` or after it, or only at `start` if `sticky`. The
    /// slots of the first group are set, and those of the others if they were asked for.
    pub(super) fn search(&mut self, start: u32, sticky: bool) -> Result<bool, LimitExceeded> {
        if self.text.len() >= NONE as usize {
            return Err(LimitExceeded);
        }
        // A failed attempt leaves the slots as they were.
        self.slots.clear();
        self.slots.resize(self.program.slot_count as usize, NONE);
        self.stack.clear();
        let mut pos = start;
        if self.program.unicode {
            // A position in the middle of a character stands for its start.
            let is_inside =
                |pos: u32| self.text.get(pos as usize).is_some_and(|byte| byte & 0xC0 == 0x80);
            for _ in 0..3 {
                if pos > 0 && is_inside(pos) {
                    pos -= 1;
                }
            }
        }
        loop {
            match self.candidate(pos) {
                Some(candidate) if !sticky || candidate == pos => pos = candidate,
                _ => return Ok(false),
            }
            if let Some(end) = self.run(pos)? {
                if let [first, second, ..] = &mut self.slots[..] {
                    (*first, *second) = (pos, end);
                }
                return Ok(true);
            }
            if sticky {
                return Ok(false);
            }
            match self.next(pos) {
                Some((_, next)) => pos = next,
                None => return Ok(false),
            }
        }
    }
}

/// The index in `Program::repeats` of the `Repeat` at `pc`.
fn repeat_index(program: &Program, pc: u32) -> usize {
    match program.insts.get(pc as usize) {
        Some(Inst::Repeat(index)) => *index as usize,
        _ => usize::MAX,
    }
}
