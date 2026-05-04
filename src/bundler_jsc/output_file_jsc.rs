//! `to_js`/`to_blob` bridges for `bundler/OutputFile.zig`. Exposed as an
//! extension trait so call sites stay `output.to_js(global)`.

use bun_bundler::output_file::{OutputFile, OutputFileValue};
use bun_core::Output;
use bun_jsc::api::BuildArtifact;
use bun_jsc::node::{PathLike, PathOrFileDescriptor};
use bun_jsc::webcore::Blob;
use bun_jsc::webcore::blob::{SizeType as BlobSizeType, Store as BlobStore};
use bun_jsc::{JSGlobalObject, JSValue};
use bun_str::PathString;

pub struct SavedFile;

impl SavedFile {
    pub fn to_js(
        global_this: &JSGlobalObject,
        path: &[u8],
        byte_size: usize,
    ) -> JSValue {
        let mime_type = global_this.bun_vm().mime_type(path);
        let store = BlobStore::init_file(
            PathOrFileDescriptor::Path(PathLike::String(PathString::init(path))),
            mime_type,
        )
        .expect("unreachable");

        let mut blob = Box::new(Blob::init_with_store(store, global_this));
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
    fn to_blob(&mut self, global_this: &JSGlobalObject) -> Result<Blob, bun_core::Error>;
}

impl OutputFileJsc for OutputFile {
    fn to_js(
        &mut self,
        owned_pathname: Option<&[u8]>,
        global_object: &JSGlobalObject,
    ) -> JSValue {
        // PORT NOTE: reshaped for borrowck — match on &mut self.value while also
        // reassigning self.value inside arms; Phase B may need mem::replace.
        match &mut self.value {
            OutputFileValue::Move | OutputFileValue::Pending => {
                panic!("Unexpected pending output file")
            }
            OutputFileValue::Noop => JSValue::UNDEFINED,
            OutputFileValue::Copy(copy) => 'brk: {
                let file_blob = match BlobStore::init_file(
                    if copy.fd.is_valid() {
                        PathOrFileDescriptor::Fd(copy.fd)
                    } else {
                        PathOrFileDescriptor::Path(PathLike::String(PathString::init(
                            Box::<[u8]>::from(copy.pathname.as_ref()),
                        )))
                    },
                    self.loader.to_mime_type(&[owned_pathname.unwrap_or(b"")]),
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

                self.value = OutputFileValue::Buffer {
                    bytes: Box::default(),
                };

                break 'brk build_output.to_js(global_object);
            }
            OutputFileValue::Saved => 'brk: {
                let path_to_use = owned_pathname.unwrap_or(self.src_path.text.as_ref());

                let file_blob = match BlobStore::init_file(
                    PathOrFileDescriptor::Path(PathLike::String(PathString::init(
                        owned_pathname
                            .map(Box::<[u8]>::from)
                            .unwrap_or_else(|| Box::<[u8]>::from(self.src_path.text.as_ref())),
                    ))),
                    self.loader.to_mime_type(&[owned_pathname.unwrap_or(b"")]),
                ) {
                    Ok(b) => b,
                    Err(err) => {
                        Output::panic(format_args!(
                            "error: Unable to create file blob: \"{}\"",
                            err.name()
                        ));
                    }
                };

                self.value = OutputFileValue::Buffer {
                    bytes: Box::default(),
                };

                let build_output = Box::new(BuildArtifact {
                    blob: Blob::init_with_store(file_blob, global_object),
                    hash: self.hash,
                    loader: self.input_loader,
                    output_kind: self.output_kind,
                    path: Box::<[u8]>::from(path_to_use),
                    ..Default::default()
                });

                break 'brk build_output.to_js(global_object);
            }
            OutputFileValue::Buffer(buffer) => 'brk: {
                // TODO(port): @constCast(buffer.bytes) — ownership transfer of bytes into Blob;
                // Rust side likely takes Box<[u8]> directly.
                let mut blob = Blob::init(buffer.bytes, global_object);
                if let Some(store) = &mut blob.store {
                    store.mime_type =
                        self.loader.to_mime_type(&[owned_pathname.unwrap_or(b"")]);
                    blob.content_type = store.mime_type.value;
                } else {
                    blob.content_type = self
                        .loader
                        .to_mime_type(&[owned_pathname.unwrap_or(b"")])
                        .value;
                }

                blob.size = buffer.bytes.len() as BlobSizeType;

                let build_output = Box::new(BuildArtifact {
                    blob,
                    hash: self.hash,
                    loader: self.input_loader,
                    output_kind: self.output_kind,
                    path: owned_pathname
                        .map(Box::<[u8]>::from)
                        .unwrap_or_else(|| Box::<[u8]>::from(self.src_path.text.as_ref())),
                    ..Default::default()
                });

                self.value = OutputFileValue::Buffer {
                    bytes: Box::default(),
                };

                break 'brk build_output.to_js(global_object);
            }
        }
    }

    // TODO(port): narrow error set
    fn to_blob(
        &mut self,
        global_this: &JSGlobalObject,
    ) -> Result<Blob, bun_core::Error> {
        match &mut self.value {
            OutputFileValue::Move | OutputFileValue::Pending => {
                panic!("Unexpected pending output file")
            }
            OutputFileValue::Noop => panic!("Cannot convert noop output file to blob"),
            OutputFileValue::Copy(copy) => 'brk: {
                let file_blob = BlobStore::init_file(
                    if copy.fd.is_valid() {
                        PathOrFileDescriptor::Fd(copy.fd)
                    } else {
                        PathOrFileDescriptor::Path(PathLike::String(PathString::init(
                            Box::<[u8]>::from(copy.pathname.as_ref()),
                        )))
                    },
                    self.loader
                        .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()]),
                )?;

                self.value = OutputFileValue::Buffer {
                    bytes: Box::default(),
                };

                break 'brk Ok(Blob::init_with_store(file_blob, global_this));
            }
            OutputFileValue::Saved => 'brk: {
                let file_blob = BlobStore::init_file(
                    PathOrFileDescriptor::Path(PathLike::String(PathString::init(
                        Box::<[u8]>::from(self.src_path.text.as_ref()),
                    ))),
                    self.loader
                        .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()]),
                )?;

                self.value = OutputFileValue::Buffer {
                    bytes: Box::default(),
                };

                break 'brk Ok(Blob::init_with_store(file_blob, global_this));
            }
            OutputFileValue::Buffer(buffer) => 'brk: {
                // TODO(port): @constCast(buffer.bytes) — ownership transfer of bytes into Blob.
                let mut blob = Blob::init(buffer.bytes, global_this);
                if let Some(store) = &mut blob.store {
                    store.mime_type = self
                        .loader
                        .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()]);
                    blob.content_type = store.mime_type.value;
                } else {
                    blob.content_type = self
                        .loader
                        .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()])
                        .value;
                }

                self.value = OutputFileValue::Buffer {
                    bytes: Box::default(),
                };

                blob.size = buffer.bytes.len() as BlobSizeType;
                break 'brk Ok(blob);
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/output_file_jsc.zig (214 lines)
//   confidence: medium
//   todos:      4
//   notes:      OutputFileValue variant shapes guessed; borrowck reshape needed for self.value reassign inside match arms; allocator params dropped.
// ──────────────────────────────────────────────────────────────────────────
