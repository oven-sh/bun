const MAX_ADDRESSABLE_SPACE_MASK: u64 = 0x7fff_ffff_ffff_ffff;

#[derive(Copy, Clone)]
struct SemverString {
    bytes: [u8; 8],
}

#[derive(Copy, Clone)]
struct Pointer {
    off: u32,
    len: u32,
}

impl Pointer {
    fn to_bits(self) -> u64 {
        let mut b = [0_u8; 8];
        b[..4].copy_from_slice(&self.off.to_ne_bytes());
        b[4..].copy_from_slice(&self.len.to_ne_bytes());
        u64::from_ne_bytes(b)
    }

    fn from_bits(bits: u64) -> Self {
        let b = bits.to_ne_bytes();
        Pointer {
            off: u32::from_ne_bytes([b[0], b[1], b[2], b[3]]),
            len: u32::from_ne_bytes([b[4], b[5], b[6], b[7]]),
        }
    }
}

impl SemverString {
    fn forged(off: u32, len: u32) -> Self {
        let ptr_bits = Pointer { off, len }.to_bits();
        let packed = (ptr_bits & MAX_ADDRESSABLE_SPACE_MASK) | (1_u64 << 63);
        SemverString {
            bytes: packed.to_ne_bytes(),
        }
    }

    fn ptr(self) -> Pointer {
        Pointer::from_bits(u64::from_ne_bytes(self.bytes) & MAX_ADDRESSABLE_SPACE_MASK)
    }

    fn eql(self, that: SemverString, this_buf: &[u8], that_buf: &[u8]) -> bool {
        let a = self.ptr();
        let b = that.ptr();
        let (a_off, a_len) = (a.off as usize, a.len as usize);
        let (b_off, b_len) = (b.off as usize, b.len as usize);
        debug_assert!(a_off + a_len <= this_buf.len());
        debug_assert!(b_off + b_len <= that_buf.len());
        let lhs = unsafe { this_buf.get_unchecked(a_off..a_off + a_len) };
        let rhs = unsafe { that_buf.get_unchecked(b_off..b_off + b_len) };
        lhs == rhs
    }
}

fn main() {
    let a = SemverString::forged(100, 4);
    let b = SemverString::forged(0, 1);
    let _ = a.eql(b, b"x", b"x");
}
