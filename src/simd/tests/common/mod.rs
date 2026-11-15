use bun_simd::{Target, limit_to};

/// Runs `test` on each supported target, in a thread of that name.
pub(crate) fn on_each_target(test: impl Fn() + Sync) {
    std::thread::scope(|scope| {
        for target in Target::ALL.into_iter().filter(|it| it.is_supported()) {
            let test = &test;
            let thread = std::thread::Builder::new().name(target.name().into());
            let run = move || {
                limit_to(target);
                test();
            };
            thread.spawn_scoped(scope, run).unwrap();
        }
    });
}
