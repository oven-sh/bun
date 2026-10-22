//! The body of watchlist_testing.bind.ts.

use std::borrow::Cow;

use bun_jsc::ImportWatcher;
use bun_jsc::bindgen::{self, JsHeap};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::Fd;
use bun_watcher::Watcher;
use bun_watcher::watcher_impl::WatchItem;

/// Appends entries that no event reaches until the watchlist has `length` entries. Returns its length.
pub(crate) fn pad_watchlist_for_testing<'a>(
    heap: &JsHeap<'a>,
    length: u32,
) -> bindgen::Result<'a, usize> {
    // Outside of every project root, so the Windows watcher matches no event to it.
    const PATH: &[u8] = b"/bun-watchlist-padding";

    let vm = VirtualMachine::get();
    // SAFETY: `bun_watcher` is null, or the `ImportWatcher` that
    // `enable_hot_module_reloading` leaked for the process. The watcher thread
    // shares its `Watcher`, and `mutex` guards the watchlist below.
    let watcher = match unsafe { vm.bun_watcher.as_mut() } {
        Some(ImportWatcher::Hot(watcher) | ImportWatcher::Watch(watcher)) => watcher,
        Some(ImportWatcher::None) | None => {
            return Err(heap.error(format_args!(
                "padWatchlistForTesting needs --hot or --watch"
            )));
        }
    };
    let _guard = watcher.mutex.lock_guard();
    let count = (length as usize).saturating_sub(watcher.watchlist.len());
    bun_core::handle_oom(watcher.watchlist.ensure_unused_capacity(count));
    let hash = Watcher::get_hash(PATH);
    let parent_hash = Watcher::get_hash(b"/");
    for _ in 0..count {
        watcher.watchlist.append_assume_capacity(WatchItem {
            file_path: Cow::Borrowed(PATH),
            hash,
            fd: Fd::INVALID,
            count: 0,
            parent_hash,
            kind: bun_watcher::Kind::File,
            package_json: None,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            eventlist_index: -1,
        });
    }
    Ok(watcher.watchlist.len())
}
