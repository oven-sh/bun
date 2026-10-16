//! `--no-macros`, and `macros = false` in bunfig.toml: raised where either is read, never lowered, and read by the parser at each macro call.

use core::sync::atomic::{AtomicBool, Ordering};

static DISABLED: AtomicBool = AtomicBool::new(false);

// `Relaxed` in both: the flag only goes from false to true, and nothing else is published through it.

/// There is no way to enable macros again.
pub fn disable_js_macros() {
    DISABLED.store(true, Ordering::Relaxed);
}

#[inline]
pub fn js_macros_disabled() -> bool {
    DISABLED.load(Ordering::Relaxed)
}
