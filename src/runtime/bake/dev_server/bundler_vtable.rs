//! The `DevServerHandle` vtable the bundler calls back through.

use super::*;

// ══════════════════════════════════════════════════════════════════════════
// CYCLEBREAK §Dispatch — DevServerVTable impl (high tier provides static)
// ══════════════════════════════════════════════════════════════════════════

bun_bundler::link_impl_DevServerHandle! {
    Bake for DevServer => |this| {
        insert_stale_owner(abs_path, graph) => {
            bun_core::handle_oom((*this).state_mut().insert_stale_owner(abs_path, graph))
        },
        handle_parse_task_failure(err, graph, abs_path, log, bv2) => {
            (*this)
                .state_mut()
                .handle_parse_task_failure(&err.into(), graph, abs_path, log, bv2)
                .map_err(Into::into)
        },
        put_or_overwrite_asset(path, contents, content_hash) => {
            let blob = crate::webcore::blob::Any::from_owned_slice(contents.to_vec());
            (*this)
                .state_mut()
                .put_or_overwrite_asset(path, blob, content_hash)
                .map_err(Into::into)
        },
        track_resolution_failure(import_source, specifier, renderer, loader) => {
            (*this)
                .state_mut()
                .track_resolution_failure(import_source, specifier, renderer, loader)
                .map_err(Into::into)
        },
        is_file_cached(abs_path, side) => {
            (*this).state_mut().is_file_cached(abs_path, side).map(|e| {
                use bun_bundler::bake_types::CacheKind;
                bun_bundler::bake_types::CacheEntry {
                    kind: match e.kind {
                        FileKind::Unknown => CacheKind::Unknown,
                        FileKind::Js => CacheKind::Js,
                        FileKind::Asset => CacheKind::Asset,
                        FileKind::Css => CacheKind::Css,
                    },
                }
            })
        },
        asset_hash(abs_path) => (*this).state_mut().graphs.assets.get_hash(abs_path),
        increment_parse_task_counter() => {
            if (*this).pending_parse_tasks.replace((*this).pending_parse_tasks.get() + 1) == 0 {
                (*this).parse_tasks_ticket.set(Some((*this).server.vm().ticket()));
            }
        },
        decrement_parse_task_counter() => {
            if (*this).pending_parse_tasks.replace((*this).pending_parse_tasks.get() - 1) == 1 {
                (*this).parse_tasks_ticket.set(None);
            }
        },
        on_scan_complete() => (*this).server.vm().enqueue_task(jsc::Task::init(this)),
    }
}

impl DevServer {
    /// Length of `configuration_hash_key`.
    pub(crate) const CONFIGURATION_HASH_KEY_LEN: usize = 16;

    /// Construct the erased handle the bundler stores in `BundleV2.dev_server`.
    #[inline]
    pub(super) fn bundler_handle(&self) -> bun_bundler::dispatch::DevServerHandle {
        // SAFETY: the bundle's `pending_request` keeps `self`, which the arms above borrow shared.
        // The bundle runs on this thread, and its tasks cannot read the handle.
        unsafe {
            bun_bundler::dispatch::DevServerHandle::new(
                bun_bundler::dispatch::DevServerHandleKind::Bake,
                ::core::ptr::from_ref(self).cast_mut(),
            )
        }
    }
}
