//! For `bun check`, `bun lint` and `bun fmt`, which start many threads and end soon.

/// The executable allocates with mimalloc, but glibc allocates a few bytes for each new thread, and by default maps a
/// heap for the thread to take them from. The page faults of all threads wait for that.
pub(crate) fn share_heaps_of_libc() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    // SAFETY: it has no preconditions.
    unsafe {
        libc::mallopt(libc::M_ARENA_MAX, 4);
    }
}
