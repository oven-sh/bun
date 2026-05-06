//! `to_js`/`to_blob` bridges for `bundler/OutputFile.zig`. Exposed as an
//! extension trait so call sites stay `output.to_js(global)`.

use crate::{JSGlobalObject, JSValue};

pub struct SavedFile;

impl SavedFile {
    
    pub fn to_js(
        global_this: &JSGlobalObject,
        path: &[u8],
        byte_size: usize,
    ) -> JSValue {
        // TODO(b2-blocked): bun_jsc::webcore::Blob
        // TODO(b2-blocked): bun_jsc::webcore::blob::Store::init_file
        // TODO(b2-blocked): bun_jsc::node::PathOrFileDescriptor
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::bun_vm
        use bun_jsc::node::{PathLike, PathOrFileDescriptor};
        use bun_jsc::webcore::blob::{SizeType as BlobSizeType, Store as BlobStore};
        use bun_jsc::webcore::Blob;
        use bun_string::PathString;

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

// ──────────────────────────────────────────────────────────────────────────
// `OutputFileJsc` extension trait — fully gated.
//
// The trait method bodies depend on:
//   - bun_jsc::api::BuildArtifact         (module not in stub surface)
//   - bun_jsc::webcore::Blob / blob::Store (module not in stub surface)
//   - bun_jsc::node::{PathLike, PathOrFileDescriptor} (module not in stub surface)
//   - bun_bundler::output_file::{OutputFile, OutputFileValue}
//     (`OutputFile` is a `struct(())` stub; `OutputFileValue` not exported)
//
// With the impl-target type itself a unit stub, body-gating per-method is not
// meaningful; the whole trait+impl is gated and the blockers are reported.
// ──────────────────────────────────────────────────────────────────────────

mod _output_file_jsc_impl {
    use super::*;
    use bun_bundler::output_file::{OutputFile, OutputFileValue};
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

                    let _ = build_output;
                    break 'brk todo!("blocked_on: bun_jsc::api::BuildArtifact::to_js");
                }
                OutputFileValue::Buffer { bytes } => {
                    // TODO(port): @constCast(buffer.bytes) — ownership transfer of bytes into Blob;
                    // Rust side likely takes Box<[u8]> directly.
                    //
                    // `bun_jsc::webcore::Blob` is an opaque shim at this tier (real
                    // type lives in `bun_runtime::webcore::Blob`, a forward-dep), so
                    // `Blob::init`, `.store`, `.content_type`, `.size` are unavailable.
                    // `bun_jsc::api::BuildArtifact` is likewise a `stub_ty!` placeholder
                    // with no fields/`to_js`. Body deferred until those land.
                    let _ = (
                        bytes,
                        global_object,
                        owned_pathname,
                        self.hash,
                        self.input_loader,
                        self.output_kind,
                    );
                    todo!("blocked_on: bun_jsc::webcore::Blob::init, bun_jsc::api::BuildArtifact")
                }
            }
        }

        // TODO(port): narrow error set
        fn to_blob(
            &mut self,
            global_this: &JSGlobalObject,
        ) -> Result<Blob, bun_core::Error> {
            // `bun_jsc::node::{PathOrFileDescriptor, PathLike}` are `stub_ty!`
            // placeholders (no variants), and `bun_jsc::webcore::Blob` is an
            // opaque shim with no `init`/`init_with_store`/fields at this tier.
            // Arm bodies deferred until those forward-dep types land.
            let _ = global_this;
            match &mut self.value {
                OutputFileValue::Move(_) | OutputFileValue::Pending(_) => {
                    panic!("Unexpected pending output file")
                }
                OutputFileValue::Noop => panic!("Cannot convert noop output file to blob"),
                OutputFileValue::Copy(copy) => {
                    let _ = (copy.fd, copy.pathname.as_ref());
                    let _ = self
                        .loader
                        .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()]);
                    todo!(
                        "blocked_on: bun_jsc::node::PathOrFileDescriptor, bun_jsc::webcore::Blob::init_with_store"
                    )
                }
                OutputFileValue::Saved(_) => {
                    let _ = self
                        .loader
                        .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()]);
                    todo!(
                        "blocked_on: bun_jsc::node::PathOrFileDescriptor, bun_jsc::webcore::Blob::init_with_store"
                    )
                }
                OutputFileValue::Buffer { bytes } => {
                    // TODO(port): @constCast(buffer.bytes) — ownership transfer of bytes into Blob.
                    let _ = bytes;
                    let _ = self
                        .loader
                        .to_mime_type(&[self.dest_path.as_ref(), self.src_path.text.as_ref()]);
                    todo!("blocked_on: bun_jsc::webcore::Blob::init")
                }
            }
        }
    }
}
// TODO(b2-blocked): bun_jsc::api::BuildArtifact
// TODO(b2-blocked): bun_jsc::webcore::Blob
// TODO(b2-blocked): bun_jsc::node::PathOrFileDescriptor
// TODO(b2-blocked): bun_bundler::output_file::OutputFileValue

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/output_file_jsc.zig (214 lines)
//   confidence: medium
//   todos:      4
//   notes:      OutputFileValue variant shapes guessed; borrowck reshape needed for self.value reassign inside match arms; allocator params dropped.
// ──────────────────────────────────────────────────────────────────────────
