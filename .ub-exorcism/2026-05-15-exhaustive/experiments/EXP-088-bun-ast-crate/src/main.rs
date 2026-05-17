fn main() {
    // Direct Bun-crate witness for EXP-088.
    //
    // `E::String::init_utf16` stores a `Str` with length in u16 elements but
    // byte provenance narrowed to that same count. `slice16()` then retags a
    // u16 slice whose byte range is twice as large.
    let utf16 = [0x1234_u16, 0x5678_u16];
    let s = bun_ast::E::String::init_utf16(&utf16);
    let first = s.slice16()[0];
    core::hint::black_box(first);
}
