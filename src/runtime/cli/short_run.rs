//! For `bun check`, `bun lint` and `bun fmt`, which start many threads and end soon.

pub(crate) fn expect_many_threads() {
    bun_threading::mutex::spin_before_sleeping();
    share_heaps_of_libc();
}

/// The executable allocates with mimalloc, but glibc allocates a few bytes for each new thread, and by default maps a
/// heap for the thread to take them from. The page faults of all threads wait for that.
fn share_heaps_of_libc() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    // SAFETY: it has no preconditions.
    unsafe {
        libc::mallopt(libc::M_ARENA_MAX, 4);
    }
}
