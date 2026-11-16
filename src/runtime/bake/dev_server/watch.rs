//! The dev server's part of the watcher thread.

use super::*;

pub(super) struct WatchContext {
    pub(super) pending_reload_event: Arc<PendingReloadEvent>,
    pub(super) vm_handle: bun_jsc::VmHandle,
}

impl bun_watcher::WatcherContext for WatchContext {
    fn on_file_update(
        &mut self,
        events: &[bun_watcher::Event],
        changed_files: &[&[u8]],
        watchlist: &bun_watcher::WatchList,
        evictions: &mut bun_watcher::Evictions,
    ) {
        debug_log!("onFileUpdate start");
        scopeguard::defer! { debug_log!("onFileUpdate end") };

        let file_paths = watchlist.items_file_path();
        let kinds = watchlist.items_kind();

        let mut pending = self.pending_reload_event.state.lock();
        if pending.event.is_empty() {
            pending.timer = Instant::now();
        }

        for event in events {
            // TODO: why does this out of bounds when you delete every file in the directory?
            if event.index as usize >= file_paths.len() {
                continue;
            }

            let file_path = &file_paths[event.index as usize];
            let kind = kinds[event.index as usize];

            debug_log!(
                "{} change: {} {}",
                match kind {
                    bun_watcher::Kind::File => "file",
                    bun_watcher::Kind::Directory => "directory",
                },
                bstr::BStr::new(file_path),
                event.op
            );

            match kind {
                bun_watcher::Kind::File => {
                    if event.op.contains(bun_watcher::Op::DELETE)
                        || event.op.contains(bun_watcher::Op::RENAME)
                    {
                        // TODO: audit this line heavily
                        evictions.append_assume_capacity(event.index);
                    }

                    pending.event.append_file(file_path);
                }
                bun_watcher::Kind::Directory => {
                    let names = event.names(changed_files);
                    if names.is_empty() {
                        pending.event.append_dir(file_path, None);
                    }
                    for &sub_path in names {
                        pending.event.append_dir(file_path, Some(sub_path));
                    }
                }
            }
        }

        if !pending.event.is_empty() && !core::mem::replace(&mut pending.scheduled, true) {
            drop(pending);
            self.pending_reload_event.post(&self.vm_handle);
        }
    }

    fn on_error(&mut self, err: sys::Error) {
        if !err.path.is_empty() {
            // Note: split out path before moving `err` into `Output::err`.
            let path = err.path.clone();
            Output::err(
                err,
                "failed to watch {} for hot-reloading",
                (bun_core::fmt::quote(&path),),
            );
        } else {
            Output::err(err, "failed to watch files for hot-reloading", ());
        }
        bun_core::warn!(
            "The development server is still running, but hot-reloading is disabled until a restart.",
        );
        // TODO: attempt to automatically restart the watcher thread, perhaps wait for next request.
    }
}
