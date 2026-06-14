// EXP-002: linux_errno::impl GetErrno for usize transmute hits invalid enum tag
// Mirror of src/errno/linux_errno.rs:175-188 in Bun.

#[repr(u16)]
#[allow(dead_code)]
enum SystemErrno {
    Success = 0,
    Ehwpoison = 133,
}

fn get_errno(raw: usize) -> SystemErrno {
    // Mirror of impl GetErrno for usize:
    // signed = raw as isize; if signed in (-4096, 0) -> negate; else 0;
    // then transmute to enum.
    let signed = raw as isize;
    let int = if signed > -4096 && signed < 0 { -signed } else { 0 };
    unsafe { std::mem::transmute::<u16, SystemErrno>(int as u16) }
}

fn main() {
    let raw_minus_134: usize = usize::MAX - 133; // casts to isize = -134
    let e = get_errno(raw_minus_134);
    let _tag = e as u16; // UB: invalid enum tag 0x86
}
