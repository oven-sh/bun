fn main() {
    // Direct Bun-crate witness for EXP-097 on non-Windows targets.
    //
    // `SystemErrno::from_raw` is a safe public function. In debug builds it has
    // a `debug_assert!`; in release builds the assert is removed and the body
    // performs an unchecked enum transmute. Safe Rust can therefore construct
    // an invalid enum value.
    let e = bun_errno::SystemErrno::from_raw(138);
    core::hint::black_box(e);
}
