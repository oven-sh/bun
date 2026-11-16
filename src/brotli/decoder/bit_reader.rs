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

/// For a loop that goes on as long as there are eight bytes left. With positions of 32 bits, that is one comparison.
pub(super) trait FastReader {
    fn peek(&self) -> u64;

    fn skip(&mut self, n: u32);

    /// Shows [`REFILLED`] bits or more to `step`, which says how many it took. Fails, and changes nothing, near the end.
    fn step<T>(&mut self, step: impl FnOnce(u64) -> (T, u32)) -> Option<T>;
}

/// Has the next bits sooner than [`Reloading`].
pub(super) struct Refilling<'a> {
    bits: Bits,
    input: &'a [u8],
    used: u32,
}

impl Refilling<'_> {
    /// All 64 bits come from the input then.
    #[inline(always)]
    fn refill(&mut self) -> bool {
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

impl FastReader for Refilling<'_> {
    #[inline(always)]
    fn peek(&self) -> u64 {
        self.bits.peek()
    }

    #[inline(always)]
    fn skip(&mut self, n: u32) {
        self.bits.skip_known(n);
    }

    #[inline(always)]
    fn step<T>(&mut self, step: impl FnOnce(u64) -> (T, u32)) -> Option<T> {
        self.refill().then(|| {
            let (value, n) = step(self.peek());
            self.skip(n);
            value
        })
    }
}

/// Takes fewer instructions than [`Refilling`].
pub(super) struct Reloading<'a> {
    input: &'a [u8],
    /// Where the last word came from.
    at: u32,
    /// How many of its bits are gone.
    used: u32,
    /// The others.
    rest: u64,
}

impl Reloading<'_> {
    #[inline(always)]
    pub(super) fn used(&self) -> u32 {
        self.used
    }

    /// The word from the byte that has the next bit, for [`skip_in`](Self::skip_in).
    #[inline(always)]
    pub(super) fn reload(&mut self) -> Option<u64> {
        let at = self.at + self.used / 8;
        let word = self.input.get(at as usize..at as usize + WORD)?;
        let word = u64::from_le_bytes(*word.as_array()?);
        (self.at, self.used) = (at, self.used % 8);
        Some(word)
    }

    #[inline(always)]
    pub(super) fn skip_in(&mut self, word: u64, n: u32) {
        self.used += n;
        debug_assert!(self.used < u64::BITS);
        self.rest = word >> (self.used % u64::BITS);
    }
}

impl FastReader for Reloading<'_> {
    #[inline(always)]
    fn peek(&self) -> u64 {
        self.rest
    }

    #[inline(always)]
    fn skip(&mut self, n: u32) {
        self.used += n;
        debug_assert!(self.used < u64::BITS);
        self.rest >>= n % u64::BITS;
    }

    #[inline(always)]
    fn step<T>(&mut self, step: impl FnOnce(u64) -> (T, u32)) -> Option<T> {
        let word = self.reload()?;
        let (value, n) = step(word >> self.used);
        self.skip_in(word, n);
        Some(value)
    }
}

#[derive(Clone, Copy)]
pub(super) struct BitReader<'a> {
    pub(super) bits: Bits,
    input: &'a [u8],
    /// With what refills took.
    whole_input: &'a [u8],
    /// The end of the input, in the high bits.
    last_word: u64,
}

#[inline(always)]
fn within_32_bits(input: &[u8]) -> Option<&[u8]> {
    let last = input.len().checked_sub(WORD)?.min(1 << 30) as u32;
    input.get(..last as usize + WORD)
}

impl<'a> BitReader<'a> {
    pub(super) fn new(bits: Bits, input: &'a [u8]) -> Self {
        let last_word = match input.last_chunk() {
            Some(word) => u64::from_le_bytes(*word),
            None => (input.iter()).fold(0, |word, &byte| (word >> 8) | (u64::from(byte) << 56)),
        };
        Self {
            bits,
            input,
            whole_input: input,
            last_word,
        }
    }

    #[inline(always)]
    pub(super) fn input_len(&self) -> usize {
        self.input.len()
    }

    #[inline(always)]
    pub(super) fn begin_refilling(&self) -> Option<Refilling<'a>> {
        let mut fast = Refilling {
            bits: self.bits,
            input: within_32_bits(self.input)?,
            used: 0,
        };
        fast.refill().then_some(fast)
    }

    #[inline(always)]
    pub(super) fn end_refilling(&mut self, fast: &Refilling<'a>) {
        self.bits = fast.bits;
        self.input = self.input.get(fast.used as usize..).unwrap_or_default();
    }

    /// Not while there are bits of earlier input.
    #[inline(always)]
    pub(super) fn begin_reloading(&self) -> Option<Reloading<'a>> {
        let mut fast = Reloading {
            input: within_32_bits(self.whole_input.get(self.byte_of_next_bit()?..)?)?,
            at: 0,
            used: self.bits.count.wrapping_neg() % 8,
            rest: 0,
        };
        fast.step(|_| ((), 0))?;
        Some(fast)
    }

    #[inline(always)]
    pub(super) fn end_reloading(&mut self, fast: &Reloading<'a>) {
        let taken = (fast.at + fast.used.div_ceil(8)) as usize;
        self.input = (self.byte_of_next_bit())
            .and_then(|start| self.whole_input.get(start + taken..))
            .unwrap_or_default();
        self.bits = Bits {
            value: fast.rest,
            count: fast.used.wrapping_neg() % 8,
        };
    }

    #[inline(always)]
    fn byte_of_next_bit(&self) -> Option<usize> {
        let taken = self.whole_input.len() - self.input.len();
        taken.checked_sub(self.bits.count.div_ceil(8) as usize)
    }

    #[inline(always)]
    pub(super) fn refill(&mut self) {
        let word = match self.input.first_chunk() {
            Some(word) => u64::from_le_bytes(*word),
            None if self.input.is_empty() => return,
            None => self.last_word >> (8 * (WORD - self.input.len())),
        };
        let count = self.bits.count % u64::BITS;
        let (taken, rest) = (self.input).split_at(self.input.len().min((63 - count as usize) / 8));
        self.bits.value |= word << count;
        self.bits.count = count + 8 * taken.len() as u32;
        self.input = rest;
    }

    #[inline(always)]
    pub(super) fn refill_for(&mut self, bits: u32) {
        if self.bits.count < bits {
            core::hint::cold_path();
            self.refill();
        }
    }

    /// After a refill: up to 63 bits, which may reach into the next byte of the input.
    #[inline(always)]
    pub(super) fn skip_peeked(&mut self, mut n: u32) -> Result<(), Stop> {
        if n > self.bits.count {
            if self.input.is_empty() {
                return Err(Stop::NeedsInput);
            }
            core::hint::cold_path();
            debug_assert!(self.bits.count >= REFILLED && n < u64::BITS);
            n -= self.bits.count;
            self.bits = Bits::default();
            self.refill();
        }
        self.bits.skip_known(n);
        Ok(())
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

    /// At a byte boundary: what refills took from the input, and how many bytes of it count, which is up to `n`.
    pub(super) fn take_buffered_bytes(&mut self, n: usize) -> ([u8; WORD], usize) {
        let (bytes, count) = (
            self.bits.value.to_le_bytes(),
            n.min(self.bits.count as usize / 8),
        );
        self.bits.skip_known(8 * count as u32);
        (bytes, count)
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
