fn main() {
    // Direct Bun-crate witness for EXP-085.
    //
    // `bun_core::fmt::s` is safe and returns a Display adapter over caller
    // bytes. Passing invalid UTF-8 should not be able to create an invalid
    // `&str` in safe code.
    let attacker_bytes = [0xff_u8];
    let rendered = format!("{}", bun_core::fmt::s(&attacker_bytes));
    let _ = core::hint::black_box(rendered.chars().next());
}
