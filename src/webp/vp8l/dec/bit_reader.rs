//! `bit_reader_utils.c`: `VP8LBitReader`, which reads bits from the least significant one on.

/// Bits that are prefetched.
const LBITS: u32 = u64::BITS;
/// Bits that are ready after `fill_bit_window`, at least.
const WBITS: u32 = 32;
/// The most bits that `read_bits` reads.
const MAX_NUM_BIT_READ: u32 = 24;

pub(super) struct BitReader<'a> {
    /// The 8 bytes before `pos`.
    val: u64,
    buf: &'a [u8],
    /// The next byte to go into `val`.
    pos: usize,
    /// How many bits of `val` are used up. More than `LBITS` if some were past the end, until `eos` is set.
    bit_pos: u32,
    /// Whether a bit past the end was read. It lags behind `is_end_of_stream`.
    pub(super) eos: bool,
}

impl<'a> BitReader<'a> {
    pub(super) fn new(buf: &'a [u8]) -> Self {
        let mut bytes = [0; 8];
        for (to, &from) in bytes.iter_mut().zip(buf) {
            *to = from;
        }
        Self {
            val: u64::from_le_bytes(bytes),
            buf,
            pos: buf.len().min(bytes.len()),
            bit_pos: 0,
            eos: false,
        }
    }

    /// The next 32 bits. Past the end they are what `val` holds: an alpha plane's last symbol may be made of them.
    #[inline(always)]
    pub(super) fn prefetch_bits(&self) -> u32 {
        (self.val >> (self.bit_pos & (LBITS - 1))) as u32
    }

    /// No more bits than this are left to read.
    pub(super) fn max_bits_left(&self) -> u64 {
        (self.buf.len() - self.pos) as u64 * 8 + u64::from(LBITS)
    }

    /// Whether a bit past the end was read.
    #[inline(always)]
    pub(super) fn is_end_of_stream(&self) -> bool {
        self.eos || (self.pos == self.buf.len() && self.bit_pos > LBITS)
    }

    /// `VP8LSetBitPos(br, br->bit_pos + num_bits)`. At most `WBITS` bits between two calls of `fill_bit_window`.
    #[inline(always)]
    pub(super) fn skip_bits(&mut self, num_bits: u32) {
        self.bit_pos += num_bits;
    }

    fn set_end_of_stream(&mut self) {
        self.eos = true;
        self.bit_pos = 0;
    }

    fn shift_bytes(&mut self) {
        while self.bit_pos >= 8
            && let Some(&byte) = self.buf.get(self.pos)
        {
            self.val >>= 8;
            self.val |= u64::from(byte) << (LBITS - 8);
            self.pos += 1;
            self.bit_pos -= 8;
        }
        if self.is_end_of_stream() {
            self.set_end_of_stream();
        }
    }

    #[inline(always)]
    pub(super) fn fill_bit_window(&mut self) {
        if self.bit_pos >= WBITS {
            self.do_fill_bit_window();
        }
    }

    #[inline]
    fn do_fill_bit_window(&mut self) {
        // Like libwebp, only while more than 8 bytes are left.
        if let Some(&[b0, b1, b2, b3, ..]) =
            self.buf.get(self.pos..).and_then(<[u8]>::first_chunk::<9>)
        {
            self.val >>= WBITS;
            self.bit_pos -= WBITS;
            self.val |= u64::from(u32::from_le_bytes([b0, b1, b2, b3])) << (LBITS - WBITS);
            self.pos += 4;
            return;
        }
        self.shift_bytes();
    }

    /// The next `num_bits` bits, at most `MAX_NUM_BIT_READ`, or 0 past the end.
    #[inline]
    pub(super) fn read_bits(&mut self, num_bits: u32) -> u32 {
        debug_assert!(num_bits <= MAX_NUM_BIT_READ);
        if self.eos {
            self.set_end_of_stream();
            return 0;
        }
        let val = self.prefetch_bits() & ((1 << num_bits) - 1);
        self.bit_pos += num_bits;
        self.shift_bytes();
        val
    }
}
