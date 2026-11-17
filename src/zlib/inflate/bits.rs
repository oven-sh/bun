/// Bits that one call has read and the next one goes on with.
#[derive(Clone, Copy, Default)]
pub(super) struct HeldBits {
    buffer: u64,
    count: u32,
}

/// So many bits are there after a refill, unless the input has run out.
pub(super) const REFILLED_BITS: u32 = u64::BITS - 8;

pub(super) struct BitReader<'a> {
    input: &'a [u8],
    /// The end of `input` that `count` does not cover.
    pub(super) rest: &'a [u8],
    /// Above the first `count` bits it has zeros, or the bits that `rest` starts with.
    pub(super) buffer: u64,
    /// Below 64.
    pub(super) count: u32,
}

impl<'a> BitReader<'a> {
    pub(super) fn resume(held: HeldBits, input: &'a [u8]) -> Self {
        Self {
            input,
            rest: input,
            buffer: held.buffer,
            count: held.count,
        }
    }

    pub(super) fn suspend(self) -> (HeldBits, &'a [u8]) {
        let held = HeldBits {
            buffer: self.buffer,
            count: self.count,
        };
        (held, self.rest)
    }

    #[inline(always)]
    pub(super) fn refill(&mut self) {
        if let Some(&word) = self.rest.first_chunk() {
            self.buffer |= u64::from_le_bytes(word) << self.count;
            let taken = (u64::BITS - 1 - self.count) / 8;
            self.rest = self.rest.get(taken as usize..).unwrap_or_default();
            self.count |= REFILLED_BITS;
            return;
        }
        while self.count < REFILLED_BITS
            && let [byte, rest @ ..] = self.rest
        {
            self.buffer |= u64::from(*byte) << self.count;
            self.count += 8;
            self.rest = rest;
        }
    }

    /// If not, all of the input has been taken. `count` is at most `REFILLED_BITS`.
    #[inline(always)]
    pub(super) fn has(&mut self, count: u32) -> bool {
        if self.count < count {
            self.refill();
        }
        self.count >= count
    }

    #[inline(always)]
    pub(super) fn peek(&self, count: u32) -> u64 {
        self.buffer & ((1 << count) - 1)
    }

    #[inline(always)]
    pub(super) fn skip(&mut self, count: u32) {
        self.buffer >>= count;
        self.count -= count;
    }

    #[inline(always)]
    pub(super) fn take(&mut self, count: u32) -> Option<u64> {
        self.has(count).then(|| {
            let bits = self.peek(count);
            self.skip(count);
            bits
        })
    }

    pub(super) fn skip_to_byte_boundary(&mut self) {
        self.skip(self.count % 8);
    }

    /// Puts the whole bytes that were read ahead back in front of `rest`.
    pub(super) fn unread(&mut self) {
        let taken = self.input.len() - self.rest.len();
        let bytes = taken.min(self.count as usize / 8);
        self.rest = self.input.get(taken - bytes..).unwrap_or_default();
        self.count -= 8 * bytes as u32;
        self.buffer = self.peek(self.count);
    }

    /// At most `max` bytes. The stream has to be at a byte boundary.
    pub(super) fn take_bytes(&mut self, max: usize) -> &'a [u8] {
        if self.count != 0 {
            self.unread();
        }
        debug_assert_eq!(self.count, 0);
        self.buffer = 0;
        let bytes;
        (bytes, self.rest) = self.rest.split_at(max.min(self.rest.len()));
        bytes
    }
}
