//! The `DevServerHandle` vtable the bundler calls back through.

use super::*;

// ══════════════════════════════════════════════════════════════════════════
// CYCLEBREAK §Dispatch — DevServerVTable impl (high tier provides static)
// ══════════════════════════════════════════════════════════════════════════

bun_bundler::link_impl_DevServerHandle! {
    Bake for DevServer => |this| {
        tracked_barrels() => &raw mut (*this).tracked_barrels,
        log_for_resolution_failures(abs_path, graph) => {
            match (*this).get_log_for_resolution_failures(abs_path, graph) {
                Ok(log) => log,
                Err(_) => bun_alloc::out_of_memory(),
            }
        },
        finalize_bundle(bv2, result) => {
            // `bv2` borrows the three `Transpiler`s stored inline in `DevServer`
            // (stable heap address); the `'static` is a stand-in for the
            // DevServer-self lifetime — see the comment on `CurrentBundle.bv2`.
            super::finalize::finalize_bundle(&mut *this, &mut *bv2.cast(), &mut *result)
                .map_err(|e| bun_bundler::Error::from(crate::Error::from(e)))
        },
        handle_parse_task_failure(err, graph, abs_path, log, bv2) => {
            (*this)
                .handle_parse_task_failure(&err.into(), graph, abs_path, &*log, &mut *bv2)
                .map_err(Into::into)
        },
        put_or_overwrite_asset(path, contents, content_hash) => {
            // `path` was erased from `&bun_resolver::fs::Path<'_>` at the
            // `DevServerHandle::put_or_overwrite_asset_erased` call site. Re-wrap
            // bytes as an owned blob (ownership is transferred).
            let path = &*path.cast::<bun_resolver::fs::Path<'_>>();
            let blob = crate::webcore::blob::Any::from_owned_slice(contents.to_vec());
            (*this).put_or_overwrite_asset(path, blob, content_hash).map_err(Into::into)
        },
        track_resolution_failure(import_source, specifier, renderer, loader) => {
            (*this)
                .directory_watchers
                .track_resolution_failure(import_source, specifier, renderer, loader)
                .map_err(Into::into)
        },
        is_file_cached(abs_path, side) => {
            (*this).is_file_cached(abs_path, side).map(|e| {
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
        has_file(abs_path, side) => (*this).has_file(abs_path, side),
        asset_hash(abs_path) => (*this).assets.get_hash(abs_path),
        current_bundle_start_data() => {
            (*this)
                .current_bundle
                .as_mut()
                .map(|c| (&raw mut c.start_data).cast::<()>())
                .unwrap_or(core::ptr::null_mut())
        },
    }
}

impl DevServer {
    /// Length of `configuration_hash_key`.
    pub(crate) const CONFIGURATION_HASH_KEY_LEN: usize = 16;

    /// Construct the erased handle the bundler stores in
    /// `Transpiler.options.dev_server` / `LinkerContext.dev_server`.
    #[inline]
    pub(crate) fn bundler_handle(&mut self) -> bun_bundler::dispatch::DevServerHandle {
        // SAFETY: `self` is the single per-process DevServer; outlives all dispatch.
        unsafe {
            bun_bundler::dispatch::DevServerHandle::new(
                bun_bundler::dispatch::DevServerHandleKind::Bake,
                self,
            )
        }
    }
}
