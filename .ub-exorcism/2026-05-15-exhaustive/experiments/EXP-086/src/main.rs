#[inline(always)]
pub fn unsafe_assert(condition: bool) {
    if !condition {
        // Mirrors src/bun.rs:1582-1586.
        unsafe { core::hint::unreachable_unchecked() };
    }
}

fn main() {
    unsafe_assert(std::hint::black_box(false));
}
