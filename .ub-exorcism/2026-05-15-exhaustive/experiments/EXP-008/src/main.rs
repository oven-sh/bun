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

    fn slice<'a>(&'a self, buf: &'a [u8]) -> &'a [u8] {
        let ptr = self.ptr();
        let (off, len) = (ptr.off as usize, ptr.len as usize);
        debug_assert!(off + len <= buf.len());
        unsafe { buf.get_unchecked(off..off + len) }
    }
}

fn main() {
    let s = SemverString::forged(100, 4);
    let backing = b"x";
    let _ = s.slice(backing);
}
