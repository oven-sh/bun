//! What the process has for all engines together.

use std::sync::OnceLock;

pub struct Resources {
    /// In bytes.
    pub ram_size: u64,
    /// The most. There is at least one.
    pub background_threads: usize,
    /// Called on such a thread when it has had nothing to do for a while.
    pub release_free_memory: fn(),
}

static RESOURCES: OnceLock<Resources> = OnceLock::new();

/// Counts only before the first engine is used.
pub fn set_resources(resources: Resources) {
    let _ = RESOURCES.set(resources);
}

pub(crate) fn resources() -> &'static Resources {
    RESOURCES.get_or_init(|| Resources {
        ram_size: 16 << 30,
        background_threads: 8,
        release_free_memory: || {},
    })
}
