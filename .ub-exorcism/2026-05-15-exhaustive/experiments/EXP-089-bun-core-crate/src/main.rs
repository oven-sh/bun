fn main() {
    // Direct Bun-crate witness for EXP-089.
    //
    // The UB occurs at construction: `PathBuffer::uninit()` returns an
    // initialized `PathBuffer([u8; N])` whose integer elements were never
    // initialized.
    let path = bun_core::PathBuffer::uninit();
    core::hint::black_box(path.0[0]);
}
