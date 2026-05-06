//! `to_js`/`to_blob` bridges for `bundler/OutputFile.zig`. Exposed as an
//! extension trait so call sites stay `output.to_js(global)`.

use crate::{JSGlobalObject, JSValue};

pub use self::output_file_jsc_impl::OutputFileJsc;

pub struct SavedFile;

impl SavedFile {
    pub fn to_js(
        global_this: &JSGlobalObject,
        path: &[u8],
        byte_size: usize,
    ) -> JSValue {
        use bun_jsc::node::{PathLike, PathOrFileDescriptor};
        use bun_jsc::webcore::blob::{SizeType as BlobSizeType, Store as BlobStore};
        use bun_jsc::webcore::Blob;
        use bun_string::PathString;

        // SAFETY: `bunVM()` never returns null for a Bun-owned global.
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

// ──────────────────────────────────────────────────────────────────────────
// `OutputFileJsc` extension trait — wires `to_js` / `to_blob` onto `OutputFile`
// from the `bun_bundler_jsc` crate (the base `bun_bundler` crate has no JSC dep).
// ──────────────────────────────────────────────────────────────────────────

mod output_file_jsc_impl {
    use super::*;
    use bun_bundler::options::{OutputFile, OutputFileValue};
    #[allow(unused_imports)]
    use bun_bundler::options_impl::LoaderExt;
    use bun_core::Output;
    use bun_jsc::api::BuildArtifact;
    use bun_jsc::node::{PathLike, PathOrFileDescriptor};
    use bun_jsc::webcore::blob::{SizeType as BlobSizeType, Store as BlobStore};
    use bun_jsc::webcore::Blob;
    use bun_string::PathString;

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
            // reassigning self.value inside arms is done via a `mem::replace`-style
            // late write after the borrow ends (each arm copies what it needs out
            // of the payload before the reassignment).
            match &mut self.value {
                OutputFileValue::Move(_) | OutputFileValue::Pending(_) => {
                    panic!("Unexpected pending output file")
                }
                OutputFileValue::Noop => JSValue::UNDEFINED,
                OutputFileValue::Copy(copy) => 'brk: {
                    let mime = self.loader.to_mime_type(&[owned_pathname.unwrap_or(b"")]);
                    let pathname: Box<[u8]> = Box::from(copy.pathname.as_ref());
                    let pathlike = if copy.fd.is_valid() {
                        PathOrFileDescriptor::Fd(copy.fd)
                    } else {
                        // PORT NOTE: `globalObject.allocator().dupe(u8, copy.pathname)` —
                        // Store takes ownership of the path slice; leak a heap copy.
                        let owned: &'static [u8] =
                            Box::leak(Box::<[u8]>::from(copy.pathname.as_ref()));
                        PathOrFileDescriptor::Path(PathLike::String(PathString::init(owned)))
                    };
                    let file_blob = match BlobStore::init_file(pathlike, Some(&mime)) {
                        Ok(b) => b,
                        Err(_) => {
                            Output::panic(format_args!(
                                "error: Unable to create file blob: \"{}\"",
                                "OutOfMemory"
                            ));
                        }
                    };

                    let build_output = Box::new(BuildArtifact {
                        blob: Blob::init_with_store(file_blob, global_object),
                        hash: self.hash,
                        loader: self.input_loader,
                        output_kind: self.output_kind,
                        path: pathname,
                        ..Default::default()
                    });

                    self.value = OutputFileValue::Buffer {
                        bytes: Box::default(),
                    };

                    break 'brk build_output.to_js(global_object);
                }
                OutputFileValue::Saved(_) => 'brk: {
                    let path_to_use: Box<[u8]> =
                        Box::from(owned_pathname.unwrap_or(self.src_path.text.as_ref()));
                    let mime = self.loader.to_mime_type(&[owned_pathname.unwrap_or(b"")]);

                    // PORT NOTE: `owned_pathname orelse allocator.dupe(u8, this.src_path.text)`.
                    let owned: &'static [u8] = Box::leak(path_to_use.clone());
                    let file_blob = match BlobStore::init_file(
                        PathOrFileDescriptor::Path(PathLike::String(PathString::init(owned))),
                        Some(&mime),
                    ) {
                        Ok(b) => b,
                        Err(_) => {
                            Output::panic(format_args!(
                                "error: Unable to create file blob: \"{}\"",
                                "OutOfMemory"
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
                        path: path_to_use,
                        ..Default::default()
                    });

                    break 'brk build_output.to_js(global_object);
                }
                OutputFileValue::Buffer { bytes } => 'brk: {
                    // TODO(port): @constCast(buffer.bytes) — ownership transfer of
                    // bytes into Blob. `core::mem::take` moves the boxed slice out.
                    let bytes = core::mem::take(bytes);
                    let len = bytes.len();
                    let mime = self.loader.to_mime_type(&[owned_pathname.unwrap_or(b"")]);
                    let mut blob = Blob::init(bytes, global_object);
                    if let Some(store) = blob.store {
                        // SAFETY: `store` is a freshly-allocated heap `Store`
                        // returned from `Blob::init`; exclusive at this point.
                        unsafe { (*store.as_ptr()).set_mime_type(&mime) };
                    }
                    blob.content_type = mime.value;
                    blob.size = len as BlobSizeType;

                    let build_output = Box::new(BuildArtifact {
                        blob,
                        hash: self.hash,
                        loader: self.input_loader,
                        output_kind: self.output_kind,
                        path: Box::from(
                            owned_pathname.unwrap_or(self.src_path.text.as_ref()),
                        ),
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
                OutputFileValue::Move(_) | OutputFileValue::Pending(_) => {
                    panic!("Unexpected pending output file")
                }
                OutputFileValue::Noop => panic!("Cannot convert noop output file to blob"),
                OutputFileValue::Copy(copy) => {
                    let mime = self
                        .loader
                        .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()]);
                    let pathlike = if copy.fd.is_valid() {
                        PathOrFileDescriptor::Fd(copy.fd)
                    } else {
                        // PORT NOTE: `allocator.dupe(u8, copy.pathname)`.
                        let owned: &'static [u8] =
                            Box::leak(Box::<[u8]>::from(copy.pathname.as_ref()));
                        PathOrFileDescriptor::Path(PathLike::String(PathString::init(owned)))
                    };
                    let file_blob = BlobStore::init_file(pathlike, Some(&mime))?;

                    self.value = OutputFileValue::Buffer {
                        bytes: Box::default(),
                    };

                    Ok(Blob::init_with_store(file_blob, global_this))
                }
                OutputFileValue::Saved(_) => {
                    let mime = self
                        .loader
                        .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()]);
                    // PORT NOTE: `allocator.dupe(u8, this.src_path.text)`.
                    let owned: &'static [u8] =
                        Box::leak(Box::<[u8]>::from(self.src_path.text.as_ref()));
                    let file_blob = BlobStore::init_file(
                        PathOrFileDescriptor::Path(PathLike::String(PathString::init(owned))),
                        Some(&mime),
                    )?;

                    self.value = OutputFileValue::Buffer {
                        bytes: Box::default(),
                    };

                    Ok(Blob::init_with_store(file_blob, global_this))
                }
                OutputFileValue::Buffer { bytes } => {
                    // TODO(port): @constCast(buffer.bytes) — ownership transfer of bytes into Blob.
                    let bytes = core::mem::take(bytes);
                    let len = bytes.len();
                    let mime = self
                        .loader
                        .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()]);
                    let mut blob = Blob::init(bytes, global_this);
                    if let Some(store) = blob.store {
                        // SAFETY: `store` is a freshly-allocated heap `Store`
                        // returned from `Blob::init`; exclusive at this point.
                        unsafe { (*store.as_ptr()).set_mime_type(&mime) };
                    }
                    blob.content_type = mime.value;

                    self.value = OutputFileValue::Buffer {
                        bytes: Box::default(),
                    };

                    blob.size = len as BlobSizeType;
                    Ok(blob)
                }
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/output_file_jsc.zig (214 lines)
//   confidence: medium
//   todos:      2
//   notes:      borrowck reshape via early field copies before self.value
//               reassignment; allocator params dropped; Store mime_type set
//               via C-ABI trampoline.
// ──────────────────────────────────────────────────────────────────────────
