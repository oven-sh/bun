fn main() {
    // Direct Bun-crate witness for EXP-002 on non-Windows targets.
    //
    // Linux raw syscalls return negative errno values encoded in usize. The
    // public `GetErrno for usize` impl decodes that shape, then transmutes the
    // resulting u16 into the platform errno enum without checking that the
    // discriminant exists.
    let raw_syscall_ret = usize::MAX - 133; // bit-pattern for isize -134
    let e = bun_errno::GetErrno::get_errno(raw_syscall_ret);
    core::hint::black_box(e);
}
