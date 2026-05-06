//! `to_js`/`to_blob` bridges for `bundler/OutputFile.zig`. Exposed as an
//! extension trait so call sites stay `output.to_js(global)`.

use crate::{JSGlobalObject, JSValue};

use bun_bundler::output_file::{OutputFile, Value as OutputFileValue};
#[allow(unused_imports)]
use bun_bundler::options_impl::LoaderExt;
use bun_core::Output;
use bun_jsc::api::BuildArtifact;
use bun_jsc::node::{PathLike, PathOrFileDescriptor};
use bun_jsc::webcore::blob::{SizeType as BlobSizeType, Store as BlobStore};
use bun_jsc::webcore::Blob;
use bun_string::PathString;

/// Heap-dupe a path slice and return a borrowed view suitable for
/// `PathString::init`. Mirrors Zig's `allocator.dupe(u8, path)` — the
/// allocation is owned by the consuming `Blob.Store` (freed via the store's
/// `deinit`), so it is intentionally not dropped here.
#[inline]
fn dupe_path(path: &[u8]) -> &'static [u8] {
    // PORT NOTE: Zig hands the duped slice to `PathString.init` and the store
    // takes ownership; in Rust we leak the `Box` to obtain a `'static` borrow
    // for `PathString` (which only stores ptr+len). The store frees it via the
    // FFI-side allocator on drop.
    Box::leak(Box::<[u8]>::from(path))
}

pub struct SavedFile;

impl SavedFile {
    pub fn to_js(
        global_this: &JSGlobalObject,
        path: &[u8],
        byte_size: usize,
    ) -> JSValue {
        // SAFETY: `bun_vm()` returns the live `*mut VirtualMachine` for a
        // Bun-owned global; we hold a unique `&mut` only for this call.
        let mime_type = unsafe { &mut *global_this.bun_vm() }.mime_type(path);
        let store = BlobStore::init_file(
            PathOrFileDescriptor::Path(PathLike::String(PathString::init(path))),
            mime_type.as_ref(),
        )
        .expect("unreachable");

        let mut blob = Blob::init_with_store(store, global_this);
        if let Some(mime) = mime_type {
            blob.content_type = mime.value;
        }
        blob.size = byte_size as BlobSizeType;
        // TODO(port): blob.allocator = bun.default_allocator — allocator field dropped in Rust
        blob.to_js(global_this)
    }
}

/// Extension trait wiring `to_js` / `to_blob` onto `OutputFile` from the
/// `bun_bundler_jsc` crate (the base `bun_bundler` crate has no JSC dep).
pub trait OutputFileJsc {
    fn to_js(&mut self, owned_pathname: Option<&[u8]>, global_object: &JSGlobalObject) -> JSValue;
    fn to_blob(&mut self, global_this: &JSGlobalObject) -> Result<Blob, bun_core::AllocError>;
}

impl OutputFileJsc for OutputFile {
    fn to_js(
        &mut self,
        owned_pathname: Option<&[u8]>,
        global_object: &JSGlobalObject,
    ) -> JSValue {
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
            OutputFileValue::Buffer { bytes: Box::default() },
        );

        let mime_hint: &[u8] = owned_pathname.unwrap_or(b"");
        let mime = self.loader.to_mime_type(&[mime_hint]);

        match value {
            OutputFileValue::Copy(copy) => {
                let file_blob = match BlobStore::init_file(
                    if copy.fd.is_valid() {
                        PathOrFileDescriptor::Fd(copy.fd)
                    } else {
                        PathOrFileDescriptor::Path(PathLike::String(PathString::init(
                            dupe_path(copy.pathname.as_ref()),
                        )))
                    },
                    Some(&mime),
                ) {
                    Ok(b) => b,
                    Err(err) => {
                        Output::panic(format_args!(
                            "error: Unable to create file blob: \"{}\"",
                            err.name()
                        ));
                    }
                };

                let build_output = Box::new(BuildArtifact {
                    blob: Blob::init_with_store(file_blob, global_object),
                    hash: self.hash,
                    loader: self.input_loader,
                    output_kind: self.output_kind,
                    path: Box::<[u8]>::from(copy.pathname.as_ref()),
                    ..Default::default()
                });

                build_output.to_js(global_object)
            }
            OutputFileValue::Saved(_) => {
                let path_to_use: &[u8] = owned_pathname.unwrap_or(self.src_path.text.as_ref());

                let store_path: &[u8] = match owned_pathname {
                    Some(p) => p,
                    None => dupe_path(self.src_path.text.as_ref()),
                };
                let file_blob = match BlobStore::init_file(
                    PathOrFileDescriptor::Path(PathLike::String(PathString::init(store_path))),
                    Some(&mime),
                ) {
                    Ok(b) => b,
                    Err(err) => {
                        Output::panic(format_args!(
                            "error: Unable to create file blob: \"{}\"",
                            err.name()
                        ));
                    }
                };

                let build_output = Box::new(BuildArtifact {
                    blob: Blob::init_with_store(file_blob, global_object),
                    hash: self.hash,
                    loader: self.input_loader,
                    output_kind: self.output_kind,
                    path: Box::<[u8]>::from(path_to_use),
                    ..Default::default()
                });

                build_output.to_js(global_object)
            }
            OutputFileValue::Buffer { bytes } => {
                let bytes_len = bytes.len();
                // TODO(port): @constCast(buffer.bytes) — ownership transfer of bytes into Blob.
                let mut blob = Blob::init(bytes, global_object);
                if let Some(store) = blob.store {
                    // SAFETY: `store` is the freshly-allocated backing store
                    // returned by `Blob::init`; uniquely owned by `blob` here.
                    unsafe { &mut *store.as_ptr() }.set_mime_type(&mime);
                    blob.content_type = mime.value;
                } else {
                    blob.content_type = mime.value;
                }
                blob.size = bytes_len as BlobSizeType;

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
                    ..Default::default()
                });

                build_output.to_js(global_object)
            }
            OutputFileValue::Move(_) | OutputFileValue::Pending(_) | OutputFileValue::Noop => {
                // SAFETY: filtered out by the early-out match above.
                unreachable!()
            }
        }
    }

    // TODO(port): narrow error set
    fn to_blob(
        &mut self,
        global_this: &JSGlobalObject,
    ) -> Result<Blob, bun_core::AllocError> {
        match &self.value {
            OutputFileValue::Move(_) | OutputFileValue::Pending(_) => {
                panic!("Unexpected pending output file")
            }
            OutputFileValue::Noop => panic!("Cannot convert noop output file to blob"),
            _ => {}
        }

        let value = core::mem::replace(
            &mut self.value,
            OutputFileValue::Buffer { bytes: Box::default() },
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
                        PathOrFileDescriptor::Path(PathLike::String(PathString::init(
                            dupe_path(copy.pathname.as_ref()),
                        )))
                    },
                    Some(&mime),
                )?;
                Ok(Blob::init_with_store(file_blob, global_this))
            }
            OutputFileValue::Saved(_) => {
                let file_blob = BlobStore::init_file(
                    PathOrFileDescriptor::Path(PathLike::String(PathString::init(
                        dupe_path(self.src_path.text.as_ref()),
                    ))),
                    Some(&mime),
                )?;
                Ok(Blob::init_with_store(file_blob, global_this))
            }
            OutputFileValue::Buffer { bytes } => {
                let bytes_len = bytes.len();
                // TODO(port): @constCast(buffer.bytes) — ownership transfer of bytes into Blob.
                let mut blob = Blob::init(bytes, global_this);
                if let Some(store) = blob.store {
                    // SAFETY: freshly-allocated store, uniquely owned by `blob`.
                    unsafe { &mut *store.as_ptr() }.set_mime_type(&mime);
                    blob.content_type = mime.value;
                } else {
                    blob.content_type = mime.value;
                }
                blob.size = bytes_len as BlobSizeType;
                Ok(blob)
            }
            OutputFileValue::Move(_) | OutputFileValue::Pending(_) | OutputFileValue::Noop => {
                // SAFETY: filtered out by the early-out match above.
                unreachable!()
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/output_file_jsc.zig (214 lines)
//   confidence: medium
//   todos:      2
//   notes:      mem::replace reshape for borrowck; allocator params dropped; PathString borrows leak-duped slices (store frees on drop, FFI side).
// ──────────────────────────────────────────────────────────────────────────
