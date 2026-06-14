use bun_core::util::ArrayLike;

fn main() {
    // Calls the real safe ArrayLike implementation for Vec<T> in
    // src/bun_core/util.rs:284-301. For T = bool, safe callers receive an
    // ordinary &mut [bool] whose element has not been initialized.
    let mut values: Vec<bool> = Vec::with_capacity(1);
    let live: &mut [bool] = values.set_len_and_slice(1);

    std::hint::black_box(live[0]);
}
