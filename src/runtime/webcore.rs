//! Web APIs implemented in Rust live here

// ─── submodules under ./webcore/ ─────────────────────────────────────────────
// `#[path]` is relative to the dir containing this file (`src/runtime/`).

#[path = "webcore/ArrayBufferSink.rs"]
pub(crate) mod array_buffer_sink;
#[path = "webcore/ByteBlobLoader.rs"]
pub(crate) mod byte_blob_loader;
#[path = "webcore/ByteStream.rs"]
pub(crate) mod byte_stream;
#[path = "webcore/CompressionStreamCoder.rs"]
pub(crate) mod compression_stream_coder;
#[path = "webcore/CookieMap.rs"]
pub(crate) mod cookie_map;
#[path = "webcore/Crypto.rs"]
pub(crate) mod crypto;
#[path = "webcore/S3Client.rs"]
pub(crate) mod s3_client;
#[path = "webcore/S3File.rs"]
pub(crate) mod s3_file;
#[path = "webcore/S3Stat.rs"]
pub(crate) mod s3_stat;
#[path = "webcore/TextEncoder.rs"]
pub(crate) mod text_encoder;
#[path = "webcore/TextEncoderStreamEncoder.rs"]
pub(crate) mod text_encoder_stream_encoder;

// ─── flat re-exports ─────────────────────────────────────────────────────────
pub(crate) use cookie_map::{CookieMap, CookieMapRef};
pub(crate) use s3_client::S3Client;

#[path = "webcore/ObjectURLRegistry.rs"]
pub(crate) mod object_url_registry;
pub(crate) use object_url_registry::ObjectURLRegistry;

// ─── webcore-local jsc re-export ─────────────────────────────────────────────
pub(crate) mod jsc {
    pub(crate) use crate::jsc::*;
    pub(crate) use bun_jsc::virtual_machine::VirtualMachine;
}

// Forward the real enums so `webcore::node_types::X` and
// `crate::node::types::X` are the same type.
pub(crate) mod node_types {
    pub(crate) use crate::node::types::{PathLike, PathOrBlob, PathOrFileDescriptor};
}

pub(crate) use crate::jsc::AbortSignal;

#[path = "webcore/headers_ref.rs"]
pub(crate) mod headers_ref;

#[path = "webcore/Blob.rs"]
pub(crate) mod blob;
pub(crate) use blob::Any as AnyBlob;
pub(crate) use blob::Internal as InternalBlob;
pub(crate) use blob::{Blob, BlobExt, SizeType as BlobSizeType};

#[path = "webcore/Body.rs"]
pub(crate) mod body;
pub(crate) use body::Body;

#[path = "webcore/Response.rs"]
pub(crate) mod response;
pub(crate) use response::Response;

#[path = "webcore/Request.rs"]
pub(crate) mod request;
pub(crate) use request::Request;

#[path = "webcore/ReadableStream.rs"]
pub(crate) mod readable_stream;
pub(crate) use readable_stream::ReadableStream;

#[path = "webcore/FileReader.rs"]
pub(crate) mod file_reader;
pub(crate) use file_reader::FileReader;

#[path = "webcore/Sink.rs"]
pub(crate) mod sink;

#[path = "webcore/FileSink.rs"]
pub(crate) mod file_sink;
pub(crate) use file_sink::FileSink;

// ByteStream/ByteBlobLoader: real bodies now live in webcore/ByteStream.rs and
// webcore/ByteBlobLoader.rs (declared above). Re-export the struct types here.
pub(crate) use byte_blob_loader::ByteBlobLoader;
pub(crate) use byte_stream::ByteStream;

// TODO: make this pool per-JSGlobalObject so recycled buffers are not shared
// across realms (the pool is process-global).
// `object_pool!` wires the per-monomorphization
// thread-local storage; the bare `ObjectPool<Vec<u8>, true, 8>` alias used to
// default to `UnwiredStorage` and panic on first `get_if_exists()`/`full()`
// from `streams::HTTPSServerWritable::send`.
bun_collections::object_pool!(pub ByteListPool: Vec<u8>, threadsafe, 8);

// ─── compiling submodules ────────────────────────────────────────────────────
// Re-export the crate-local jsc shim's opaque type until `bun_jsc::fetch_headers`
// is green; the shim's `#[repr(transparent)] struct FetchHeaders(usize)` matches the
// opaque-handle ABI used by the `WebCore__FetchHeaders__*` extern fns.
pub(crate) use crate::jsc::FetchHeaders;

#[path = "webcore/EncodingLabel.rs"]
pub(crate) mod encoding_label;
pub(crate) use encoding_label::EncodingLabel;

#[path = "webcore/encoding.rs"]
pub(crate) mod encoding;

#[path = "webcore/wasm_streaming.rs"]
pub(crate) mod wasm_streaming;

#[path = "webcore/TextDecoder.rs"]
pub(crate) mod text_decoder;
pub(crate) use text_decoder::TextDecoder;

#[path = "webcore/URLPattern.rs"]
pub(crate) mod url_pattern;
pub(crate) use url_pattern::URLPattern;

#[path = "webcore/fetch.rs"]
pub(crate) mod fetch;

#[path = "webcore/prompt.rs"]
pub(crate) mod prompt;

#[path = "webcore/FormData.rs"]
pub(crate) mod form_data;

#[path = "webcore/ScriptExecutionContext.rs"]
pub(crate) mod script_execution_context;

// Note: inner `#[path]` inside an inline `mod s3 { }` resolves relative to
// `<this-file's-dir>/s3/`, which would point at `src/runtime/s3/...` (does not
// exist). Declare the file mods at this level (where `#[path]` is relative to
// `src/runtime/`) and re-export them under `s3`.
#[doc(hidden)]
#[path = "webcore/s3/client.rs"]
pub(crate) mod __s3_client;
#[doc(hidden)]
#[path = "webcore/s3/credentials_jsc.rs"]
pub(crate) mod __s3_credentials_jsc;
#[doc(hidden)]
#[path = "webcore/s3/download_stream.rs"]
pub(crate) mod __s3_download_stream;
#[doc(hidden)]
#[path = "webcore/s3/list_objects.rs"]
pub(crate) mod __s3_list_objects;
#[doc(hidden)]
#[path = "webcore/s3/multipart.rs"]
pub(crate) mod __s3_multipart;
#[doc(hidden)]
#[path = "webcore/s3/simple_request.rs"]
pub(crate) mod __s3_simple_request;
#[doc(hidden)]
#[path = "webcore/s3/xml_response.rs"]
pub(crate) mod __s3_xml_response;
pub(crate) mod s3 {
    pub(crate) use bun_s3_signing::MultiPartUploadOptions;

    // Note: `client` is the umbrella re-export hub. It pulls in `simple_request`
    // / `download_stream` / `list_objects` / `multipart` transitively.
    pub(crate) use super::__s3_client as client;
    pub(crate) use super::__s3_credentials_jsc as credentials_jsc;
    pub(crate) use super::__s3_download_stream as download_stream;
    pub(crate) use super::__s3_list_objects as list_objects;
    pub(crate) use super::__s3_multipart as multipart;
    pub(crate) use super::__s3_simple_request as simple_request;
    pub(crate) use super::__s3_xml_response as xml_response;
}

#[path = "webcore/streams.rs"]
pub(crate) mod streams;

pub(crate) enum PathOrFileDescriptor {
    Path(bun_core::Utf8Bytes<'static>),
    Fd(bun_sys::Fd),
}

// ─── SinkHandle ──────────────────────────────────────────────────────────────
// Held by ByteStream; dispatches write()/end() to the native sink.

#[derive(Copy, Clone, Default)]
pub enum SinkHandle {
    #[default]
    None,
    ServerResponse(crate::server::AnyRequestContext),
    FetchRequestBody(bun_ptr::BackRef<fetch::FetchRequestBodySink, bun_ptr::Mut>),
    S3Upload(bun_ptr::BackRef<s3::multipart::NetworkSink>),
    FileSink(bun_ptr::BackRef<file_sink::FileSink>),
    HTMLRewriter(bun_ptr::BackRef<crate::api::html_rewriter::RewriterPipe>),
    HttpResponse(bun_ptr::BackRef<streams::HTTPResponseSink, bun_ptr::Mut>),
    HttpsResponse(bun_ptr::BackRef<streams::HTTPSResponseSink, bun_ptr::Mut>),
}

use bun_removable_features::{removable_body, removable_body_of_either};

impl SinkHandle {
    #[inline]
    pub fn is_none(&self) -> bool {
        matches!(self, SinkHandle::None)
    }

    #[inline]
    pub fn is_some(&self) -> bool {
        !self.is_none()
    }

    /// SAFETY: every non-None variant's pointee is alive for as long as this handle is installed.
    pub fn write(&self, data: &streams::Result<'_>) -> streams::Writable {
        match *self {
            SinkHandle::None => streams::Writable::Done,
            SinkHandle::ServerResponse(any) => {
                removable_body!(Serve, Abort, { any.write_chunk(data) })
            }
            SinkHandle::FetchRequestBody(mut p) => removable_body!(Fetch, Abort, {
                // SAFETY: live backref; ByteStream clears sink before free.
                unsafe { p.get_mut() }.write(data)
            }),
            SinkHandle::S3Upload(p) => removable_body!(S3Client, Abort, { p.write(data) }),
            SinkHandle::FileSink(p) => p.ref_guard().write(data),
            SinkHandle::HTMLRewriter(p) => removable_body!(HtmlRewriter, Abort, { p.write(data) }),
            SinkHandle::HttpResponse(mut p) => removable_body_of_either!(Serve, WebStreams, {
                // SAFETY: live backref; transform detaches before the JSSink is finalized.
                unsafe { p.get_mut() }.write(data)
            }),
            SinkHandle::HttpsResponse(mut p) => removable_body_of_either!(Serve, WebStreams, {
                // SAFETY: live backref; transform detaches before the JSSink is finalized.
                unsafe { p.get_mut() }.write(data)
            }),
        }
    }

    /// Signal end-of-stream (or terminal error) to the attached sink.
    ///
    /// SAFETY: same pointee-liveness invariant as [`Self::write`].
    pub fn end(&self, err: Option<streams::StreamError>) {
        match *self {
            SinkHandle::None => {}
            SinkHandle::ServerResponse(any) => {
                removable_body!(Serve, Abort, { any.end_chunk(err.as_ref()) })
            }
            SinkHandle::FetchRequestBody(mut p) => removable_body!(Fetch, Abort, {
                // SAFETY: live backref; ByteStream clears sink before free.
                unsafe { p.get_mut() }.end_from_stream(err)
            }),
            SinkHandle::S3Upload(p) => removable_body!(S3Client, Abort, {
                if let Some(sink) = p.self_ref() {
                    sink.end_from_stream(err)
                }
            }),
            SinkHandle::FileSink(p) => p.ref_guard().end_from_stream(err),
            SinkHandle::HTMLRewriter(p) => {
                removable_body!(HtmlRewriter, Abort, { p.end_from_stream(err) })
            }
            SinkHandle::HttpResponse(_) => {}
            SinkHandle::HttpsResponse(_) => {}
        }
    }
}

pub(crate) enum DrainResult {
    Owned { list: Vec<u8>, size_hint: usize },
    EstimatedSize(usize),
    Aborted,
}

#[derive(Copy, Clone, Eq, PartialEq, core::marker::ConstParamTy)]
pub(crate) enum Lifetime {
    Clone,
    Transfer,
}
