//! The threads that only read files: one pool for the process, shared by the bundler and the type
//! checker. The field `io_pool` of the bundler's `ThreadPool` says why they exist.

use std::sync::OnceLock;

use bun_core::env_var;

use crate::thread_pool as ThreadPoolLib;

static THREAD_POOL: OnceLock<ThreadPoolLib::ThreadPool> = OnceLock::new();

pub fn get() -> &'static ThreadPoolLib::ThreadPool {
    THREAD_POOL.get_or_init(|| {
        ThreadPoolLib::ThreadPool::init(ThreadPoolLib::Config {
            max_threads: u32::from(bun_core::get_thread_count().clamp(2, 4)),
            // Use a much smaller stack size for the IO thread pool
            stack_size: 512 * 1024,
        })
    })
}

pub fn uses_io_pool() -> bool {
    if env_var::feature_flag::BUN_FEATURE_FLAG_FORCE_IO_POOL.get() == Some(true) {
        // For testing.
        return true;
    }

    if env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_IO_POOL.get() == Some(true) {
        // For testing.
        return false;
    }

    // 4 was the sweet spot on macOS. Didn't check the sweet spot on Windows.
    #[cfg(any(target_os = "macos", windows))]
    return bun_core::get_thread_count() > 3;
    #[cfg(not(any(target_os = "macos", windows)))]
    return false;
}
