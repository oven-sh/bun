//! What a regular expression is compiled to: instructions for the backtracking machine in `exec.rs`.

use super::charset::CharSet;

/// A position that is not set, in a slot.
pub(super) const NONE: u32 = u32::MAX;

/// An instruction. `back` is the direction in a lookbehind: the character before the position is
/// read and the position moves to the left.
///
/// A slot is a `u32` of the state of a match that is restored when the machine backtracks: first the
/// start and the end of each group, then registers.
#[derive(Copy, Clone, Debug)]
pub(super) enum Inst {
    /// The whole pattern has matched.
    Match,
    /// One character: a code point with the `u` or `v` flag, otherwise a code unit.
    Char {
        c: u32,
        back: bool,
    },
    /// One character that is in `Program::sets[set]`.
    Set {
        set: u32,
        back: bool,
    },
    /// The bytes `Program::literals[start..start + len]`.
    Literal {
        start: u32,
        len: u32,
        back: bool,
    },
    Jump(u32),
    /// Continues at `first`, and at `second` if that fails.
    Split {
        first: u32,
        second: u32,
    },
    /// Stores the position in a slot.
    Save(u32),
    /// Sets the slots `from..to` to `NONE`.
    Clear {
        from: u32,
        to: u32,
    },
    /// Sets a slot to 0.
    Zero(u32),
    /// Fails if the position is the one in the slot: an iteration that may be left out matched
    /// the empty string.
    Progress(u32),
    /// The start and the end of an iteration of `Program::loops[..]`.
    LoopHead(u32),
    LoopTail(u32),
    /// All iterations of `Program::repeats[..]`.
    Repeat(u32),
    /// `^`
    Start {
        multiline: bool,
    },
    /// `$`
    End {
        multiline: bool,
    },
    /// `\b`, `\B`. `folded`: with the flags `iu` or `iv`, when U+017F and U+212A are word characters.
    WordBoundary {
        negate: bool,
        folded: bool,
    },
    /// The start and the end of `Program::looks[..]`.
    Look(u32),
    LookEnd(u32),
    /// What one of the groups `Program::groups[start..start + len]` matched.
    Backreference {
        start: u32,
        len: u16,
        ignore_case: bool,
        back: bool,
    },
}

/// A quantifier whose iterations are counted.
#[derive(Copy, Clone, Debug)]
pub(super) struct Loop {
    /// The slot with the number of iterations that are done.
    pub(super) counter: u32,
    /// The slot with the position at the start of the iteration, or `NONE` if an iteration cannot
    /// match the empty string.
    pub(super) mark: u32,
    pub(super) min: u32,
    pub(super) max: u32,
    pub(super) greedy: bool,
    pub(super) head: u32,
    pub(super) exit: u32,
}

/// A quantifier of one character.
#[derive(Copy, Clone, Debug)]
pub(super) struct Repeat {
    pub(super) what: Single,
    pub(super) min: u32,
    pub(super) max: u32,
    pub(super) greedy: bool,
    pub(super) back: bool,
    /// The byte that what follows starts with, if that is known: there is no point in stopping
    /// anywhere else.
    pub(super) then: Option<u8>,
}

#[derive(Copy, Clone, Debug)]
pub(super) enum Single {
    Char(u32),
    Set(u32),
}

/// A lookahead or a lookbehind.
#[derive(Copy, Clone, Debug)]
pub(super) struct Look {
    pub(super) negate: bool,
    /// The slot with the height of the stack at the start.
    pub(super) height: u32,
    /// The instruction after `LookEnd`.
    pub(super) next: u32,
}

/// A set of characters, made for `contains`.
#[derive(Debug)]
pub(super) struct Set {
    ascii: u128,
    /// From U+0080.
    ranges: Box<[(u32, u32)]>,
}

impl Set {
    pub(super) fn new(set: &CharSet) -> Self {
        let mut ascii = 0u128;
        let mut ranges = Vec::new();
        for &(lo, hi) in set.ranges() {
            for c in lo..=hi.min(0x7F) {
                ascii |= 1 << c;
            }
            if hi >= 0x80 {
                ranges.push((lo.max(0x80), hi));
            }
        }
        Set {
            ascii,
            ranges: ranges.into_boxed_slice(),
        }
    }

    #[inline]
    pub(super) fn contains(&self, c: u32) -> bool {
        if c < 0x80 {
            return (self.ascii >> c) & 1 != 0;
        }
        self.contains_non_ascii(c)
    }

    fn contains_non_ascii(&self, c: u32) -> bool {
        let after = self.ranges.partition_point(|(lo, _)| *lo <= c);
        after
            .checked_sub(1)
            .and_then(|i| self.ranges.get(i))
            .is_some_and(|(_, hi)| c <= *hi)
    }

    #[inline]
    pub(super) fn ascii(&self) -> u128 {
        self.ascii
    }

    #[inline]
    pub(super) fn non_ascii(&self) -> &[(u32, u32)] {
        &self.ranges
    }
}

/// Where a match can start, found without running the machine.
#[derive(Debug)]
pub(super) enum Prefilter {
    /// Anywhere.
    None,
    /// Only at the start of the text.
    Anchored,
    /// Where these bytes are.
    Prefix(Box<[u8]>),
    /// Where one of these bytes is: at most 3.
    Bytes(Box<[u8]>),
    /// Where a byte of this set is.
    ByteSet(Box<[u64; 4]>),
}

#[derive(Debug)]
pub(super) struct Program {
    pub(super) insts: Vec<Inst>,
    pub(super) sets: Vec<Set>,
    pub(super) literals: Vec<u8>,
    pub(super) loops: Vec<Loop>,
    pub(super) repeats: Vec<Repeat>,
    pub(super) looks: Vec<Look>,
    pub(super) groups: Vec<u32>,
    /// Groups, with the whole match as the first.
    pub(super) group_count: u32,
    pub(super) slot_count: u32,
    /// Whether a character is a code point: the `u` or the `v` flag.
    pub(super) unicode: bool,
    pub(super) has_backreferences: bool,
    pub(super) prefilter: Prefilter,
}
