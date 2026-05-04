//! JSC bridges for `StandaloneModuleGraph.File`. The graph itself stays in
//! `standalone_graph/` (used by the bundler with no JS in the loop); only the
//! `Blob` accessor that needs a `&JSGlobalObject` lives here.

use core::ptr::NonNull;

use bun_http::MimeType;
use bun_jsc::JSGlobalObject;
use bun_str::{self as bstring, strings};

use crate::api::standalone_graph::{File, StandaloneModuleGraph};
use crate::webcore::Blob;
use crate::webcore::blob::Store;

/// Extension trait wiring JSC-dependent methods onto `standalone_graph::File`.
pub trait FileJsc {
    fn file_blob(&mut self, global: &JSGlobalObject) -> &mut Blob;
}

impl FileJsc for File {
    fn file_blob(&mut self, global: &JSGlobalObject) -> &mut Blob {
        if self.cached_blob.is_none() {
            // TODO(port): Store::init in Zig takes a mutable slice via @constCast and the
            // default allocator. Ownership model for `Store` (intrusive refcount) needs
            // confirming in Phase B — treating `store` as `&mut Store` here.
            let store = Store::init(&mut self.contents);
            // make it never free
            store.ref_(); // PORT NOTE: Zig `.ref()`; `ref` is a Rust keyword

            let mut b = Box::new(Blob::init_with_store(store, global));

            if let Some(mime) = MimeType::by_extension_no_default(strings::trim_leading_char(
                bun_paths::extension(&self.name),
                b'.',
            )) {
                store.mime_type = mime;
                b.content_type = mime.value;
                b.content_type_was_set = true;
                b.content_type_allocated = false;
            }

            // The real name goes here:
            store.data.bytes.stored_name = bun_paths::PathString::init(&self.name);

            // The pretty name goes here:
            if self
                .name
                .starts_with(StandaloneModuleGraph::BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX)
            {
                b.name = bstring::String::clone_utf8(
                    &self.name[StandaloneModuleGraph::BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.len()..],
                );
            } else if !self.name.is_empty() {
                b.name = bstring::String::clone_utf8(&self.name);
            }

            // TODO(port): lifetime — LIFETIMES.tsv classifies File.cached_blob as UNKNOWN
            // (Option<NonNull<Blob>>); leaking the Box matches Zig's `.new()` + raw-ptr field.
            self.cached_blob = Some(NonNull::from(Box::leak(b)));
        }

        // SAFETY: populated above; pointer originates from Box::leak and is never freed
        // for the graph's lifetime (store is intentionally leaked via .ref()).
        unsafe { self.cached_blob.unwrap().as_mut() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/standalone_graph_jsc.zig (40 lines)
//   confidence: medium
//   todos:      2
//   notes:      cached_blob written as Option<NonNull<Blob>> per LIFETIMES.tsv (UNKNOWN); Store intrusive-rc ownership to confirm in Phase B.
// ──────────────────────────────────────────────────────────────────────────
