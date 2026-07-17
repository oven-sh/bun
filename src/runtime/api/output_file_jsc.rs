//! `to_js`/`to_blob` bridges for the bundler's `OutputFile`. Exposed as an
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
use bun_core::ZigStringSlice;
use bun_http_types::MimeType::MimeType;

use crate::api::js_bundler::BuildArtifact;
use crate::node::types::{PathLike, PathOrFileDescriptor};
use crate::webcore::Blob;
use crate::webcore::blob::BlobExt as _;
use crate::webcore::blob::store::StoreExt as _;
use crate::webcore::blob::{SizeType as BlobSizeType, Store as BlobStore};

/// Heap-dupe `path` into an owning `PathLike` so the resulting `Blob.Store`
/// outlives the borrowed source.
#[inline]
fn dupe_path_like(path: &[u8]) -> PathLike {
    PathLike::EncodedSlice(
        ZigStringSlice::init_dupe(path).unwrap_or_else(|_| bun_core::out_of_memory()),
    )
}

#[inline]
fn set_blob_mime(blob: &mut Blob, mime: MimeType) {
    blob.content_type
        .set(crate::webcore::blob::BlobContentType::from_mime(&mime));
    if let Some(store) = blob.store.get().as_ref() {
        // SAFETY: `store` is the freshly-allocated backing store uniquely owned
        // by `blob`; no other borrow exists yet.
        unsafe { (*store.as_ptr()).mime_type = mime };
    }
}

pub struct SavedFile;

impl SavedFile {
    pub fn to_js(global_this: &JSGlobalObject, path: &[u8], byte_size: usize) -> JSValue {
        // SAFETY: `bun_vm()` returns the live `*mut VirtualMachine` for a
        // Bun-owned global; we hold a unique `&mut` only for this call.
        let mime_type = global_this.bun_vm().as_mut().mime_type(path);
        // An owned `PathLike::String` (a `CowSlice`) frees its buffer in
        // `PathLike::drop`, so the backing buffer must be owned by the store,
        // not borrowed from `path`.
        let store = BlobStore::init_file(
            PathOrFileDescriptor::Path(PathLike::String(bun_ptr::cow_slice::CowSlice::init_owned(
                path.to_vec().into_boxed_slice(),
            ))),
            mime_type,
        )
        .expect("unreachable");

        let blob = Blob::init_with_store(store, global_this);
        // `init_with_store` already populated `blob.content_type` from the
        // store's `File` mime, so no separate assignment is needed.
        blob.size.set(byte_size as BlobSizeType);
        let ptr = Blob::new(blob);
        // SAFETY: `ptr` is a freshly heap-allocated `*mut Blob` from
        // `Blob::new`; ownership transfers to the JS wrapper.
        unsafe { (*ptr).to_js(global_this) }
    }
}

/// Extension trait wiring `to_js` / `to_blob` onto `OutputFile` from the
/// `bun_bundler` crate (the base `bun_bundler` crate has no JSC dep).
pub(crate) trait OutputFileJsc {
    fn to_js(&mut self, owned_pathname: Option<&[u8]>, global_object: &JSGlobalObject) -> JSValue;
    fn to_blob(&mut self, global_this: &JSGlobalObject) -> Result<Blob, crate::Error>;
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

        // Taking the value out up-front avoids the borrowck conflict between
        // `&mut self.value` (match scrutinee) and `self.{hash,loader,...}`
        // reads inside the arms.
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
                let path_to_use: &[u8] = owned_pathname.unwrap_or(self.src_path.text);

                // An owned `PathLike::String` (a `CowSlice`) frees its buffer in
                // `PathLike::drop`, so the backing buffer must be owned by the
                // store. `owned_pathname` is a borrow here (the caller drops its
                // `Box<[u8]>` after this returns), so dupe it.
                let store_path = match owned_pathname {
                    Some(p) => PathLike::String(bun_ptr::cow_slice::CowSlice::init_owned(
                        p.to_vec().into_boxed_slice(),
                    )),
                    None => dupe_path_like(self.src_path.text),
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
                    None => Box::from(self.src_path.text),
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

    fn to_blob(&mut self, global_this: &JSGlobalObject) -> Result<Blob, crate::Error> {
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
            .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text]);

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
                    PathOrFileDescriptor::Path(dupe_path_like(self.src_path.text)),
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
