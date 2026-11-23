use bun_simd::prelude::*;

/// A set of bytes, to be built at compile time.
pub struct ByteSet {
    classes: ByteClasses,
    /// For texts that are too short for the kernel: one load instead of two.
    is_member: [bool; 256],
}

impl ByteSet {
    /// Panics if the 16 rows of 16 bytes have more than 8 patterns of members.
    pub const fn new(ranges: &[core::ops::RangeInclusive<u8>]) -> Self {
        let mut is_member = [false; 256];
        let mut rest = ranges;
        while let [range, tail @ ..] = rest {
            let mut byte = *range.start() as usize;
            while byte <= *range.end() as usize {
                is_member[byte] = true;
                byte += 1;
            }
            rest = tail;
        }
        Self {
            classes: ByteClasses::new(ranges),
            is_member,
        }
    }

    #[inline(always)]
    pub fn contains(&self, byte: u8) -> bool {
        self.is_member[usize::from(byte)]
    }

    /// How many members `text` starts with.
    #[cfg_attr(not(debug_assertions), inline(always))]
    pub fn prefix_len(&self, text: &[u8]) -> usize {
        if text.len() < 16 {
            return text.iter().take_while(|&&byte| self.contains(byte)).count();
        }
        prefix_len(text, &self.classes)
    }

    /// [`Self::prefix_len`] for a loop over many short runs, each of which would pay for a call.
    #[inline]
    pub fn short_prefix_len(&self, text: &[u8]) -> usize {
        let (head, rest) = text.split_at(text.len().min(15));
        match self.prefix_len(head) {
            len if len < head.len() => len,
            len => len + self.prefix_len(rest),
        }
    }
}

/// How far the target that the build is compiled for looks. A call takes as long as a short run.
const SHORT: usize = 64;

/// `text` has at least 16 bytes.
#[inline(always)]
pub(super) fn prefix_len(text: &[u8], set: &ByteClasses) -> usize {
    for at in [0, 16, 32, 48, SHORT] {
        if text.len() < at + 16 {
            break;
        }
        if at == SHORT {
            return long_prefix_len(text, set);
        }
        if let Some(lane) = (!set.contains(u8x16::<Baseline>::load_at(text, at))).first_set() {
            return at | lane;
        }
    }
    let outside = !set.contains(u8x16::<Baseline>::load_last(text));
    match outside.first_set() {
        Some(lane) => text.len() - 16 + lane,
        None => text.len(),
    }
}

/// Few runs are long, and 512-bit vectors slow down the code around them.
/// With one target only there is no dispatch to keep it out of line.
#[kernel(Upto<B32>)]
#[inline(never)]
fn long_prefix_len(text: &[u8], set: &ByteClasses) -> usize {
    assert!(text.len() >= SHORT);
    let (mut at, last) = (SHORT, text.len() - u8xN::LANES);
    while at < last {
        if let Some(lane) = (!set.contains(u8xN::load_at(text, at))).first_set() {
            return at + lane;
        }
        at += u8xN::LANES;
    }
    last + (!set.contains(u8xN::load_last(text))).count_before_first()
}
