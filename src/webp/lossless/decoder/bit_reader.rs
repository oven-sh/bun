//! Bits, the lowest of a byte first.

/// Behind the end of the data are zeros, and `is_past_end()` says whether any were used.
#[derive(Clone, Copy)]
pub(super) struct BitReader<'a> {
    unread: &'a [u8],
    /// The lowest `len` bits count. Those above are zero or the bits that come next.
    buffer: u64,
    len: u32,
    /// How many of the bits put in `buffer` so far were made up.
    made_up: u32,
}

impl<'a> BitReader<'a> {
    /// What `refill()` leaves at least.
    pub(super) const REFILLED: u32 = 56;

    pub(super) fn new(bytes: &'a [u8]) -> Self {
        let mut reader = Self {
            unread: bytes,
            buffer: 0,
            len: 0,
            made_up: 0,
        };
        // Fewer than 8 bytes are read as 8.
        // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/utils/bit_reader_utils.h#L175
        if bytes.len() < 8 {
            reader.buffer = bytes
                .iter()
                .rfold(0, |bits, &byte| bits << 8 | u64::from(byte));
            reader.len = 64;
            reader.unread = &[];
        }
        reader
    }

    #[inline(always)]
    pub(super) fn refill(&mut self) {
        match self.unread.first_chunk() {
            Some(&bytes) => {
                self.buffer |= u64::from_le_bytes(bytes) << (self.len % 64);
                let whole_bytes = (63 - self.len % 64) / 8;
                self.unread = self.unread.get(whole_bytes as usize..).unwrap_or_default();
                self.len |= Self::REFILLED;
            }
            None => {
                core::hint::cold_path();
                if self.len < Self::REFILLED {
                    *self = self.refilled_near_end();
                }
            }
        }
    }

    // By value, so that the callers' loops can keep the reader in registers.
    #[cold]
    #[inline(never)]
    fn refilled_near_end(mut self) -> Self {
        while self.len < Self::REFILLED {
            match self.unread.split_first() {
                Some((&byte, unread)) => {
                    self.buffer |= u64::from(byte) << self.len;
                    self.unread = unread;
                }
                None => self.made_up = self.made_up.saturating_add(8),
            }
            self.len += 8;
        }
        self
    }

    #[inline(always)]
    pub(super) fn ensure(&mut self, count: u32) {
        if self.len < count {
            self.refill();
        }
    }

    #[inline(always)]
    pub(super) fn peek(&self) -> usize {
        self.buffer as usize
    }

    /// No more than there are since the last `refill()`, and fewer than 64.
    #[inline(always)]
    pub(super) fn skip(&mut self, count: u32) {
        self.buffer >>= count % 64;
        self.len -= count;
    }

    /// As `skip()`.
    #[inline(always)]
    pub(super) fn take(&mut self, count: u32) -> u32 {
        let bits = self.buffer & ((1 << (count % 64)) - 1);
        self.skip(count);
        bits as u32
    }

    /// Up to 32 bits.
    pub(super) fn read(&mut self, count: u32) -> u32 {
        self.ensure(count);
        self.take(count)
    }

    pub(super) fn read_flag(&mut self) -> bool {
        self.read(1) != 0
    }

    #[inline(always)]
    pub(super) fn is_past_end(&self) -> bool {
        self.len < self.made_up
    }
}
