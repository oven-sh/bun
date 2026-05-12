//! `to_js`/`to_blob` bridges for `bundler/OutputFile.zig`. Exposed as an
//! extension trait so call sites stay `output.to_js(global)`.
//!
//! LAYERING: this file lives in `bun_runtime` (not `bun_bundler_jsc`) because
//! it constructs `webcore::Blob`, `webcore::blob::Store`, `api::BuildArtifact`
//! and `node::types::{PathLike, PathOrFileDescriptor}` — all `bun_runtime`
//! types. `bun_runtime` already depends on `bun_bundler`, so there is no cycle.

use bun_jsc::{JSGlobalObject, JSValue, StrongOptional};

use bun_bundler::options_impl::LoaderExt as _;
use bun_bundler::output_file::{OutputFile, Value as OutputFileValue};
use bun_core::Output;
use bun_core::{PathString, ZigStringSlice};
use bun_http_types::MimeType::MimeType;

use crate::api::js_bundler::BuildArtifact;
use crate::node::types::{PathLike, PathOrFileDescriptor};
use crate::webcore::Blob;
use crate::webcore::blob::BlobExt as _;
use crate::webcore::blob::store::StoreExt as _;
use crate::webcore::blob::{SizeType as BlobSizeType, Store as BlobStore};

/// Heap-dupe `path` into an owning `PathLike` so the resulting `Blob.Store`
/// outlives the borrowed source. Mirrors Zig's `allocator.dupe(u8, path)`.
#[inline]
fn dupe_path_like(path: &[u8]) -> PathLike {
    PathLike::EncodedSlice(
        ZigStringSlice::init_dupe(path).unwrap_or_else(|_| bun_core::out_of_memory()),
    )
}

/// Set the store's `mime_type` and point `blob.content_type` at it. The
/// pointer borrows from `blob.store` (held for the blob's lifetime), so it
/// stays valid without a separate allocation.
#[inline]
fn set_blob_mime(blob: &mut Blob, mime: MimeType) {
    if let Some(store) = blob.store.get().as_ref() {
        // SAFETY: `store` is the freshly-allocated backing store uniquely owned
        // by `blob`; no other borrow exists yet.
        let store_ptr = store.as_ptr();
        unsafe { (*store_ptr).mime_type = mime };
        blob.content_type.set(std::ptr::from_ref::<[u8]>(unsafe {
            (*store_ptr).mime_type.value.as_ref()
        }));
    } else {
        // No store (empty bytes). Zig still assigns `blob.content_type` from the
        // loader's mime so `contentTypeOrMimeType()` keeps returning a value.
        let owned: Box<[u8]> = Box::from(mime.value.as_ref());
        blob.content_type.set(bun_core::heap::into_raw(owned));
        blob.content_type_allocated.set(true);
    }
}

pub struct SavedFile;

impl SavedFile {
    pub fn to_js(global_this: &JSGlobalObject, path: &[u8], byte_size: usize) -> JSValue {
        // SAFETY: `bun_vm()` returns the live `*mut VirtualMachine` for a
        // Bun-owned global; we hold a unique `&mut` only for this call.
        let mime_type = global_this.bun_vm().as_mut().mime_type(path);
        // `Store::drop` frees `PathLike::String` via `deinit_owned`, so the
        // backing buffer must be owned by the store, not borrowed from `path`.
        let store = BlobStore::init_file(
            PathOrFileDescriptor::Path(PathLike::String(PathString::init_owned(path.to_vec()))),
            mime_type,
        )
        .expect("unreachable");

        let mut blob = Blob::init_with_store(store, global_this);
        // PORT NOTE: Zig overwrites `blob.content_type = mime.value` here;
        // `init_with_store` already populated it from the store's `File`
        // mime (which is the same value), so the overwrite is a no-op.
        blob.size.set(byte_size as BlobSizeType);
        let ptr = Blob::new(blob);
        // SAFETY: `ptr` is a freshly heap-allocated `*mut Blob` from
        // `Blob::new`; ownership transfers to the JS wrapper.
        unsafe { (*ptr).to_js(global_this) }
    }
}

/// Extension trait wiring `to_js` / `to_blob` onto `OutputFile` from the
/// `bun_bundler` crate (the base `bun_bundler` crate has no JSC dep).
pub trait OutputFileJsc {
    fn to_js(&mut self, owned_pathname: Option<&[u8]>, global_object: &JSGlobalObject) -> JSValue;
    fn to_blob(&mut self, global_this: &JSGlobalObject) -> Result<Blob, bun_core::Error>;
}

impl OutputFileJsc for OutputFile {
    fn to_js(&mut self, owned_pathname: Option<&[u8]>, global_object: &JSGlobalObject) -> JSValue {
        // Early-out arms that neither consume nor replace `self.value`.
        match &self.value {
            OutputFileValue::Move(_) | OutputFileValue::Pending(_) => {
                panic!("Unexpected pending output file")
            }
            OutputFileValue::Noop => return JSValue::UNDEFINED,
            _ => {}
        }

        // PORT NOTE: each Zig arm reassigns `this.value = .buffer{.{}}` after
        // consuming the payload. Taking the value out up-front avoids the
        // borrowck conflict between `&mut self.value` (match scrutinee) and
        // `self.{hash,loader,...}` reads inside the arms.
        let value = core::mem::replace(
            &mut self.value,
            OutputFileValue::Buffer {
                bytes: Box::default(),
            },
        );

        let mime_hint: &[u8] = owned_pathname.unwrap_or(b"");
        let mime = self.loader.to_mime_type(&[mime_hint]);

        match value {
            OutputFileValue::Copy(copy) => {
                let file_blob = match BlobStore::init_file(
                    if copy.fd.is_valid() {
                        PathOrFileDescriptor::Fd(copy.fd)
                    } else {
                        PathOrFileDescriptor::Path(dupe_path_like(copy.pathname.as_ref()))
                    },
                    Some(mime),
                ) {
                    Ok(b) => b,
                    Err(err) => Output::panic(format_args!(
                        "error: Unable to create file blob: \"{}\"",
                        err.name()
                    )),
                };

                let build_output = Box::new(BuildArtifact {
                    blob: Blob::init_with_store(file_blob, global_object),
                    hash: self.hash,
                    loader: self.input_loader,
                    output_kind: self.output_kind,
                    path: Box::<[u8]>::from(copy.pathname.as_ref()),
                    sourcemap: StrongOptional::empty(),
                });

                // Ownership transfers to the JS `BuildArtifact` wrapper
                // (`finalize` reclaims it). Typed `Box`-taking entry point —
                // the leak/from_raw pair lives once in the `#[js_class]` shim.
                BuildArtifact::to_js_boxed(build_output, global_object)
            }
            OutputFileValue::Saved(_) => {
                let path_to_use: &[u8] = owned_pathname.unwrap_or(self.src_path.text.as_ref());

                // `Store::drop` frees a `PathLike::String` payload via
                // `PathString::deinit_owned`, so the backing buffer must be
                // owned by the store. `owned_pathname` is a borrow here (the
                // caller drops its `Box<[u8]>` after this returns), so dupe it.
                let store_path = match owned_pathname {
                    Some(p) => PathLike::String(PathString::init_owned(p.to_vec())),
                    None => dupe_path_like(self.src_path.text.as_ref()),
                };
                let file_blob = match BlobStore::init_file(
                    PathOrFileDescriptor::Path(store_path),
                    Some(mime),
                ) {
                    Ok(b) => b,
                    Err(err) => Output::panic(format_args!(
                        "error: Unable to create file blob: \"{}\"",
                        err.name()
                    )),
                };

                let build_output = Box::new(BuildArtifact {
                    blob: Blob::init_with_store(file_blob, global_object),
                    hash: self.hash,
                    loader: self.input_loader,
                    output_kind: self.output_kind,
                    path: Box::<[u8]>::from(path_to_use),
                    sourcemap: StrongOptional::empty(),
                });

                // See `Copy` arm.
                BuildArtifact::to_js_boxed(build_output, global_object)
            }
            OutputFileValue::Buffer { bytes } => {
                let bytes_len = bytes.len();
                let mut blob = Blob::init(bytes.into_vec(), global_object);
                set_blob_mime(&mut blob, mime);
                blob.size.set(bytes_len as BlobSizeType);

                let path: Box<[u8]> = match owned_pathname {
                    Some(p) => Box::from(p),
                    None => Box::from(self.src_path.text.as_ref()),
                };

                let build_output = Box::new(BuildArtifact {
                    blob,
                    hash: self.hash,
                    loader: self.input_loader,
                    output_kind: self.output_kind,
                    path,
                    sourcemap: StrongOptional::empty(),
                });

                // See `Copy` arm.
                BuildArtifact::to_js_boxed(build_output, global_object)
            }
            OutputFileValue::Move(_) | OutputFileValue::Pending(_) | OutputFileValue::Noop => {
                // SAFETY: filtered out by the early-out match above.
                unreachable!()
            }
        }
    }

    fn to_blob(&mut self, global_this: &JSGlobalObject) -> Result<Blob, bun_core::Error> {
        match &self.value {
            OutputFileValue::Move(_) | OutputFileValue::Pending(_) => {
                panic!("Unexpected pending output file")
            }
            OutputFileValue::Noop => panic!("Cannot convert noop output file to blob"),
            _ => {}
        }

        let value = core::mem::replace(
            &mut self.value,
            OutputFileValue::Buffer {
                bytes: Box::default(),
            },
        );

        let mime = self
            .loader
            .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()]);

        match value {
            OutputFileValue::Copy(copy) => {
                let file_blob = BlobStore::init_file(
                    if copy.fd.is_valid() {
                        PathOrFileDescriptor::Fd(copy.fd)
                    } else {
                        PathOrFileDescriptor::Path(dupe_path_like(copy.pathname.as_ref()))
                    },
                    Some(mime),
                )?;
                Ok(Blob::init_with_store(file_blob, global_this))
            }
            OutputFileValue::Saved(_) => {
                let file_blob = BlobStore::init_file(
                    PathOrFileDescriptor::Path(dupe_path_like(self.src_path.text.as_ref())),
                    Some(mime),
                )?;
                Ok(Blob::init_with_store(file_blob, global_this))
            }
            OutputFileValue::Buffer { bytes } => {
                let bytes_len = bytes.len();
                let mut blob = Blob::init(bytes.into_vec(), global_this);
                set_blob_mime(&mut blob, mime);
                blob.size.set(bytes_len as BlobSizeType);
                Ok(blob)
            }
            OutputFileValue::Move(_) | OutputFileValue::Pending(_) | OutputFileValue::Noop => {
                // SAFETY: filtered out by the early-out match above.
                unreachable!()
            }
        }
    }
}

// ported from: src/bundler_jsc/output_file_jsc.zig
