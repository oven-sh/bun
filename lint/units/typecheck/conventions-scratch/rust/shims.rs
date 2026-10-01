// Stand-ins for workspace crates so that this file set compiles with rustc alone.
// hash_a is bun_wyhash::Wyhash::hash, hash_b is bun_wyhash::Wyhash11::hash, Bump is bun_alloc::Arena, StackCheck is bun_core::StackCheck.
pub fn hash_a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn hash_b(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0x9e37_79b9_7f4a_7c15;
    for &b in bytes {
        h = (h.rotate_left(5) ^ u64::from(b)).wrapping_mul(0xff51_afd7_ed55_8ccd);
    }
    h
}

#[derive(Default)]
pub struct Bump;

impl Bump {
    pub fn alloc_slice_copy<T: Copy>(&self, src: &[T]) -> &[T] {
        Box::leak(src.to_vec().into_boxed_slice())
    }
}

#[derive(Clone, Copy, Default)]
pub struct StackCheck {
    limit: usize,
}

impl StackCheck {
    pub fn init() -> Self {
        Self { limit: 0 }
    }
    pub fn is_safe_to_recurse(self) -> bool {
        let probe = 0u8;
        core::ptr::from_ref(&probe) as usize > self.limit
    }
}
