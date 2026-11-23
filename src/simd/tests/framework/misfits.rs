//! Lists of what doesn't fit the types. It compiles in a dead branch, and panics with `--cfg bun_simd_misfits_panic`.
use core::cell::Cell;

/// What is wrong with the panic. A message also asks for the place of the caller.
#[inline(never)]
pub fn wrong(message: &str, code: &str, f: &mut dyn FnMut()) -> Option<String> {
    thread_local! { static HERE: Cell<bool> = const { Cell::new(false) }; }
    static HOOK: std::sync::Once = std::sync::Once::new();
    HOOK.call_once(|| {
        let print = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |it| {
            HERE.set(it.location().unwrap().file().rsplit(['/', '\\']).take(3).any(|it| it == "tests"));
            print(it)
        }))
    });
    let Err(error) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) else {
        return Some(format!("{code}: no panic"));
    };
    let got = error.downcast_ref::<&str>().copied().or(error.downcast_ref::<String>().map(|it| &**it)).unwrap();
    let through_a_closure =
        ["iter()", "load_3_of_4", "load_low_bytes", "widening_mul("].iter().any(|it| code.contains(it));
    let right = got.contains("bun_simd::") && got.contains(&message.replace(' ', "_"));
    let placed = HERE.get() || message.is_empty() || through_a_closure;
    (!right || !placed).then(|| format!("{code}: {got}, at the place of the caller: {placed}"))
}
macro_rules! misfits { ($($message:literal: $($e:expr),+;)*) => {
    if cfg!(all(panic = "unwind", any(miri, bun_simd_misfits_panic))) {
        let all: Vec<_> = [$($(misfits::wrong($message, stringify!($e), &mut || { let _ = $e; }),)+)*].into_iter().flatten().collect();
        assert!(all.is_empty(), "{all:#?}");
    }
}; }
macro_rules! d {
    ($s:ident $t:ident $w:ident) => {
        $s.of::<$t, $w>()
    };
}
macro_rules! v {
    ($s:ident $t:ident $w:ident) => {
        $s.of::<$t, $w>().zero()
    };
}
