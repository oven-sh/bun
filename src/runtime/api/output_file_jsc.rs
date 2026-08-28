//! `to_js`/`to_blob` bridges for the bundler's `OutputFile`. Exposed as an
//! extension trait so call sites stay `output.to_js(global)`.
//!
//! LAYERING: this file lives in `bun_runtime` (not `bun_bundler_jsc`) because
//! it constructs `webcore::Blob`, `webcore::blob::Store`, `api::BuildArtifact`
//! and `node::types::{PathLike, PathOrFileDescriptor}` — all `bun_runtime`
//! types. `bun_runtime` already depends on `bun_bundler`, so there is no cycle.

use bun_jsc::{JSGlobalObject, JSValue};

use bun_alloc::OwnedBytes;
use bun_bundler::options_impl::LoaderExt as _;
use bun_bundler::output_file::{OutputFile, Value as OutputFileValue};
use bun_core::Output;
use bun_http_types::MimeType::MimeType;

use crate::api::js_bundler::BuildArtifact;
use crate::node::types::{PathLike, PathOrFileDescriptor};
use crate::webcore::Blob;
use crate::webcore::blob::Store as BlobStore;
use crate::webcore::blob::store::Bytes as BlobBytes;
use crate::webcore::blob::store::StoreExt as _;

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

/// The bytes move into the blob's store with their allocator (no copy).
fn blob_from_output_bytes(bytes: OwnedBytes, global_this: &JSGlobalObject) -> Blob {
    if bytes.is_empty() {
        return Blob::init_empty(global_this);
    }
    Blob::init_with_store(
        BlobStore::init_bytes(BlobBytes::from_owned_bytes(bytes)),
        global_this,
    )
}

/// Extension trait wiring `to_js` / `to_blob` onto `OutputFile` from the
/// `bun_bundler` crate (the base `bun_bundler` crate has no JSC dep).
pub(crate) trait OutputFileJsc {
    fn to_js(&mut self, owned_pathname: Option<&[u8]>, global_object: &JSGlobalObject) -> JSValue;
    fn to_blob(&mut self, global_this: &JSGlobalObject) -> Result<Blob, crate::Error>;
}

impl OutputFileJsc for OutputFile {
    fn to_js(&mut self, owned_pathname: Option<&[u8]>, global_object: &JSGlobalObject) -> JSValue {
        if let OutputFileValue::Noop = &self.value {
            return JSValue::UNDEFINED;
        }

        // Taking the value out up-front avoids the borrowck conflict between
        // `&mut self.value` (match scrutinee) and `self.{hash,loader,...}`
        // reads inside the arms.
        let value = core::mem::replace(
            &mut self.value,
            OutputFileValue::Buffer {
                bytes: OwnedBytes::new(),
            },
        );

        let mime_hint: &[u8] = owned_pathname.unwrap_or(b"");
        let mime = self.loader.to_mime_type(&[mime_hint]);

        match value {
            OutputFileValue::Copy(copy) => {
                let file_blob = match BlobStore::init_file(
                    PathOrFileDescriptor::Path(PathLike::owned(copy.pathname.to_vec())),
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
                });

                // Ownership transfers to the JS `BuildArtifact` wrapper
                // (`finalize` reclaims it). Typed `Box`-taking entry point —
                // the leak/from_raw pair lives once in the `#[js_class]` shim.
                BuildArtifact::to_js_boxed(build_output, global_object)
            }
            OutputFileValue::Saved(_) => {
                let path_to_use: &[u8] = owned_pathname.unwrap_or(self.src_path.text);

                let file_blob = match BlobStore::init_file(
                    PathOrFileDescriptor::Path(PathLike::owned(path_to_use.to_vec())),
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
                });

                // See `Copy` arm.
                BuildArtifact::to_js_boxed(build_output, global_object)
            }
            OutputFileValue::Buffer { bytes } => {
                let mut blob = blob_from_output_bytes(bytes, global_object);
                set_blob_mime(&mut blob, mime);

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
                });

                // See `Copy` arm.
                BuildArtifact::to_js_boxed(build_output, global_object)
            }
            OutputFileValue::Noop => {
                // SAFETY: filtered out by the early-out match above.
                unreachable!()
            }
        }
    }

    fn to_blob(&mut self, global_this: &JSGlobalObject) -> Result<Blob, crate::Error> {
        if let OutputFileValue::Noop = &self.value {
            panic!("Cannot convert noop output file to blob");
        }

        let value = core::mem::replace(
            &mut self.value,
            OutputFileValue::Buffer {
                bytes: OwnedBytes::new(),
            },
        );

        let mime = self
            .loader
            .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text]);

        match value {
            OutputFileValue::Copy(copy) => {
                let file_blob = BlobStore::init_file(
                    PathOrFileDescriptor::Path(PathLike::owned(copy.pathname.to_vec())),
                    Some(mime),
                )?;
                Ok(Blob::init_with_store(file_blob, global_this))
            }
            OutputFileValue::Saved(_) => {
                let file_blob = BlobStore::init_file(
                    PathOrFileDescriptor::Path(PathLike::owned(self.src_path.text.to_vec())),
                    Some(mime),
                )?;
                Ok(Blob::init_with_store(file_blob, global_this))
            }
            OutputFileValue::Buffer { bytes } => {
                let mut blob = blob_from_output_bytes(bytes, global_this);
                set_blob_mime(&mut blob, mime);
                Ok(blob)
            }
            OutputFileValue::Noop => {
                // SAFETY: filtered out by the early-out match above.
                unreachable!()
            }
        }
    }
}
