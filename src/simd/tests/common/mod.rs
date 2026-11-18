use bun_simd::{Target, limit_to_with};

/// Runs `test` on each supported target, in a thread of that name.
pub(crate) fn on_each_target(test: impl Fn() + Sync) {
    // Miri lacks some of the intrinsics.
    let is_skipped = |target: Target| cfg!(miri) && target.arch() == Some("aarch64");
    let all = Target::ALL.into_iter();
    std::thread::scope(|scope| {
        for target in all.filter(|&it| it.is_supported() && !is_skipped(it)) {
            let test = &test;
            let thread = std::thread::Builder::new().name(target.name().into());
            let run = move || {
                limit_to_with(target, ["pclmulqdq", "vpclmulqdq", "aes", "crc", "dotprod"]);
                test();
            };
            thread.spawn_scoped(scope, run).unwrap();
        }
    });
}
