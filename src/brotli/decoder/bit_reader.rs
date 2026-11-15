use super::Stop;

/// What a refill leaves in [`Bits`] while there is input, and so the most that one step of decoding may take.
pub(super) const REFILLED: u32 = 56;

/// Bits that left the input and that nothing took yet. A step works on a copy, and stores it back if they were enough.
#[derive(Clone, Copy, Default)]
pub(super) struct Bits {
    /// Above `count` is zero, or the start of the input.
    value: u64,
    count: u32,
}

impl Bits {
    #[inline(always)]
    pub(super) fn peek(&self) -> u64 {
        self.value
    }

    /// The caller knows that there are `n` bits.
    #[inline(always)]
    pub(super) fn skip_known(&mut self, n: u32) {
        debug_assert!(n <= self.count);
        self.value >>= n % u64::BITS;
        self.count = self.count.wrapping_sub(n);
    }

    #[inline(always)]
    pub(super) fn skip(&mut self, n: u32) -> Result<(), Stop> {
        if n > self.count {
            return Err(Stop::NeedsInput);
        }
        self.skip_known(n);
        Ok(())
    }

    /// `n` is below 32.
    #[inline]
    pub(super) fn read(&mut self, n: u32) -> Result<u32, Stop> {
        let value = self.value as u32 & ((1 << (n % u32::BITS)) - 1);
        self.skip(n)?;
        Ok(value)
    }

    #[inline]
    pub(super) fn read_flag(&mut self) -> Result<bool, Stop> {
        Ok(self.read(1)? != 0)
    }

    #[inline(always)]
    pub(super) fn count(&self) -> u32 {
        self.count
    }
}

const WORD: usize = size_of::<u64>();

#[inline(never)]
fn short_word(bytes: &[u8]) -> u64 {
    (bytes.iter()).rfold(0, |word, &byte| (word << 8) | u64::from(byte))
}

/// With positions of 32 bits, checking one takes a single comparison.
pub(super) struct FastReader<'a> {
    pub(super) bits: Bits,
    input: &'a [u8],
    used: u32,
}

impl FastReader<'_> {
    /// All 64 bits come from the input then. Fails, and changes nothing, near the end of it.
    #[inline(always)]
    pub(super) fn refill(&mut self) -> bool {
        let at = self.used as usize;
        let Some(word) = self.input.get(at..at + WORD).and_then(<[u8]>::as_array) else {
            return false;
        };
        self.bits.value |= u64::from_le_bytes(*word) << (self.bits.count % u64::BITS);
        self.used += (self.bits.count ^ 63) / 8;
        self.bits.count |= REFILLED;
        true
    }
}

#[derive(Clone, Copy)]
pub(super) struct BitReader<'a> {
    pub(super) bits: Bits,
    input: &'a [u8],
}

impl<'a> BitReader<'a> {
    pub(super) fn new(bits: Bits, input: &'a [u8]) -> Self {
        Self { bits, input }
    }

    /// For a loop that refills as long as there are eight bytes left.
    #[inline(always)]
    pub(super) fn begin_fast(&self) -> Option<FastReader<'a>> {
        let last = self.input.len().checked_sub(WORD)?.min(1 << 30) as u32;
        Some(FastReader {
            bits: self.bits,
            input: self.input.get(..last as usize + WORD)?,
            used: 0,
        })
    }

    #[inline(always)]
    pub(super) fn end_fast(&mut self, fast: &FastReader<'a>) {
        self.bits = fast.bits;
        self.input = self.input.get(fast.used as usize..).unwrap_or_default();
    }

    #[inline(always)]
    pub(super) fn refill(&mut self) {
        let word = match self.input.first_chunk() {
            Some(word) => u64::from_le_bytes(*word),
            None if self.input.is_empty() => return,
            None => short_word(self.input),
        };
        let count = self.bits.count % u64::BITS;
        let (taken, rest) = (self.input).split_at(self.input.len().min((63 - count as usize) / 8));
        self.bits.value |= word << count;
        self.bits.count = count + 8 * taken.len() as u32;
        self.input = rest;
    }

    /// Runs `step`, which takes up to [`REFILLED`] bits, and forgets what it took if it fails.
    #[inline(always)]
    pub(super) fn step<T>(
        &mut self,
        step: impl FnOnce(&mut Bits) -> Result<T, Stop>,
    ) -> Result<T, Stop> {
        self.refill();
        let mut bits = self.bits;
        let value = step(&mut bits)?;
        self.bits = bits;
        Ok(value)
    }

    #[inline]
    pub(super) fn read(&mut self, n: u32) -> Result<u32, Stop> {
        self.step(|bits| bits.read(n))
    }

    /// Returns whether the bits up to there were zero.
    pub(super) fn skip_to_byte_boundary(&mut self) -> bool {
        matches!(self.bits.read(self.bits.count % 8), Ok(0))
    }

    /// At a byte boundary: the next byte, if a refill took it from the input.
    pub(super) fn take_buffered_byte(&mut self) -> Option<u8> {
        self.bits.read(8).ok().map(|byte| byte as u8)
    }

    /// With no buffered byte left: up to `n` bytes of the input.
    pub(super) fn take_bytes(&mut self, n: usize) -> &'a [u8] {
        debug_assert_eq!(self.bits.count, 0);
        self.bits.value = 0;
        let (bytes, rest) = self.input.split_at(n.min(self.input.len()));
        self.input = rest;
        bytes
    }

    /// Returns the bits to keep and how much of the input, which was `input_len` long, is used up.
    pub(super) fn finish(self, input_len: usize, give_back_bytes: bool) -> (Bits, usize) {
        let Bits { value, mut count } = self.bits;
        let mut used = input_len - self.input.len();
        if give_back_bytes {
            let unused = ((count / 8) as usize).min(used);
            used -= unused;
            count -= unused as u32 * 8;
        }
        let value = value & ((1 << count) - 1);
        (Bits { value, count }, used)
    }
}
