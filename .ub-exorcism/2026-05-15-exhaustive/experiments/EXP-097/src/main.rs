#[repr(u16)]
#[derive(Clone, Copy, Debug)]
enum SparseErrno {
    Success = 0,
    Known = 137,
    UvTail = 4095,
}

impl SparseErrno {
    const fn from_repr(n: u16) -> Option<Self> {
        match n {
            0 => Some(Self::Success),
            137 => Some(Self::Known),
            4095 => Some(Self::UvTail),
            _ => None,
        }
    }

    // Mirrors the source shape of `src/errno/windows_errno.rs:E::from_raw`:
    // a safe public function, a debug-only validity check, then unchecked
    // `transmute::<u16, E>`. Safe Rust can call it with an invalid tag in a
    // release build, where `debug_assert!` is compiled out.
    pub const fn from_raw(n: u16) -> Self {
        debug_assert!(Self::from_repr(n).is_some(), "invalid errno discriminant");
        unsafe { core::mem::transmute::<u16, SparseErrno>(n) }
    }
}

fn main() {
    // 138 is in the dense-looking gap immediately after the non-UV POSIX errno
    // range, and is not one of the declared sparse UV-tail discriminants.
    let e = SparseErrno::from_raw(138);
    core::hint::black_box(e);
}
