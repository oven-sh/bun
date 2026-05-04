use core::ptr::NonNull;

use bun_core::{Error, FeatureFlags, Output};
use bun_str::MutableString;

use crate::{
    CertificateInfo, Decompressor, Encoding, HTTPRequestBody, HTTPResponseMetadata,
    extremely_verbose, http_thread,
};

bun_output::declare_scope!(HTTPInternalState, hidden);

// TODO: reduce the size of this struct
// Many of these fields can be moved to a packed struct and use less space

pub struct InternalState {
    pub response_message_buffer: MutableString,
    /// pending response is the temporary storage for the response headers, url and status code
    /// this uses shared_response_headers_buf to store the headers
    /// this will be turned None once the metadata is cloned
    pub pending_response: Option<bun_picohttp::Response>,

    /// This is the cloned metadata containing the response headers, url and status code after the .headers phase are received
    /// will be turned None once returned to the user (the ownership is transferred to the user)
    /// this can happen after await fetch(...) and the body can continue streaming when this is already None
    /// the user will receive only chunks of the body stored in body_out_str
    pub cloned_metadata: Option<HTTPResponseMetadata>,
    pub flags: InternalStateFlags,

    pub transfer_encoding: Encoding,
    pub encoding: Encoding,
    pub content_encoding_i: u8,
    pub chunked_decoder: bun_picohttp::PhrChunkedDecoder,
    pub decompressor: Decompressor,
    pub stage: Stage,
    /// This is owned by the user and should not be freed here
    // TODO(port): lifetime — user-owned back-reference; no LIFETIMES.tsv row, kept as raw NonNull
    pub body_out_str: Option<NonNull<MutableString>>,
    pub compressed_body: MutableString,
    pub content_length: Option<usize>,
    pub total_body_received: usize,
    // TODO(port): self-borrow into `original_request_body.bytes`; raw slice ptr to avoid lifetime on struct
    pub request_body: *const [u8],
    pub original_request_body: HTTPRequestBody,
    pub request_sent_len: usize,
    pub fail: Option<Error>,
    pub request_stage: HTTPStage,
    pub response_stage: HTTPStage,
    pub certificate_info: Option<CertificateInfo>,
}

bitflags::bitflags! {
    #[derive(Clone, Copy)]
    #[repr(transparent)]
    pub struct InternalStateFlags: u8 {
        const ALLOW_KEEPALIVE                   = 1 << 0;
        const RECEIVED_LAST_CHUNK               = 1 << 1;
        const DID_SET_CONTENT_ENCODING          = 1 << 2;
        const IS_REDIRECT_PENDING               = 1 << 3;
        const IS_LIBDEFLATE_FAST_PATH_DISABLED  = 1 << 4;
        const RESEND_REQUEST_BODY_ON_REDIRECT   = 1 << 5;
        // _padding: u2 in Zig fills bits 6..7
    }
}

impl InternalStateFlags {
    /// Zig's field defaults: `allow_keepalive = true`, rest false.
    pub const fn new() -> Self {
        Self::ALLOW_KEEPALIVE
    }
}

impl Default for InternalStateFlags {
    /// Matches Zig `InternalStateFlags{}` (allow_keepalive defaults to true).
    fn default() -> Self {
        Self::new()
    }
}

impl Default for InternalState {
    fn default() -> Self {
        Self {
            response_message_buffer: MutableString::default(),
            pending_response: None,
            cloned_metadata: None,
            flags: InternalStateFlags::new(),
            transfer_encoding: Encoding::Identity,
            encoding: Encoding::Identity,
            content_encoding_i: u8::MAX,
            chunked_decoder: bun_picohttp::PhrChunkedDecoder::default(),
            decompressor: Decompressor::None,
            stage: Stage::Pending,
            body_out_str: None,
            compressed_body: MutableString::default(),
            content_length: None,
            total_body_received: 0,
            request_body: b"" as *const [u8],
            original_request_body: HTTPRequestBody::Bytes(Box::default()),
            request_sent_len: 0,
            fail: None,
            request_stage: HTTPStage::Pending,
            response_stage: HTTPStage::Pending,
            certificate_info: None,
        }
    }
}

impl InternalState {
    pub fn init(body: HTTPRequestBody, body_out_str: &mut MutableString) -> InternalState {
        let request_body: *const [u8] = match &body {
            HTTPRequestBody::Bytes(bytes) => bytes.as_ref() as *const [u8],
            _ => b"" as *const [u8],
        };
        InternalState {
            original_request_body: body,
            request_body,
            compressed_body: MutableString::default(),
            response_message_buffer: MutableString::default(),
            body_out_str: Some(NonNull::from(body_out_str)),
            stage: Stage::Pending,
            pending_response: None,
            ..Default::default()
        }
    }

    pub fn is_chunked_encoding(&self) -> bool {
        self.transfer_encoding == Encoding::Chunked
    }

    pub fn reset(&mut self) {
        // PORT NOTE: allocator param dropped (global mimalloc).
        self.compressed_body = MutableString::default();
        self.response_message_buffer = MutableString::default();

        let body_msg = self.body_out_str;
        if let Some(body) = body_msg {
            // SAFETY: body_out_str is a live user-owned buffer for the lifetime of this state
            unsafe { (*body.as_ptr()).reset() };
        }
        // Decompressor::deinit → handled by Drop on assignment below
        // TODO(port): Decompressor may need explicit deinit if it holds FFI handles not freed by Drop

        // just in case we check and free to avoid leaks
        // (Option<HTTPResponseMetadata> drops on assignment; allocator param removed)
        self.cloned_metadata = None;

        // if exists we own this info
        // (Option<CertificateInfo> drops on assignment; allocator param removed)
        self.certificate_info = None;

        // original_request_body.deinit() → drops on assignment below
        *self = InternalState {
            body_out_str: body_msg,
            compressed_body: MutableString::default(),
            response_message_buffer: MutableString::default(),
            original_request_body: HTTPRequestBody::Bytes(Box::default()),
            request_body: b"" as *const [u8],
            certificate_info: None,
            flags: InternalStateFlags::new(),
            total_body_received: 0,
            ..Default::default()
        };
    }

    pub fn get_body_buffer(&mut self) -> &mut MutableString {
        if self.encoding.is_compressed() {
            return &mut self.compressed_body;
        }

        // SAFETY: body_out_str is a live user-owned buffer for the lifetime of this state
        unsafe { &mut *self.body_out_str.unwrap().as_ptr() }
    }

    pub fn is_done(&self) -> bool {
        if self.is_chunked_encoding() {
            return self.flags.contains(InternalStateFlags::RECEIVED_LAST_CHUNK);
        }

        if let Some(content_length) = self.content_length {
            return self.total_body_received >= content_length;
        }

        // Content-Type: text/event-stream we should be done only when Close/End/Timeout connection
        self.flags.contains(InternalStateFlags::RECEIVED_LAST_CHUNK)
    }

    // TODO(port): narrow error set
    pub fn decompress_bytes(
        &mut self,
        buffer: &[u8],
        body_out_str: &mut MutableString,
        is_final_chunk: bool,
    ) -> Result<(), Error> {
        // PORT NOTE: Zig `defer this.compressed_body.reset()` runs on every exit. scopeguard would
        // hold &mut self.compressed_body across the body and conflict with &mut self.decompressor,
        // so each early-return below calls `self.compressed_body.reset()` explicitly.
        let mut gzip_timer: Option<std::time::Instant> = None;

        if extremely_verbose() {
            gzip_timer = Some(std::time::Instant::now());
        }

        let mut still_needs_to_decompress = true;

        if FeatureFlags::is_libdeflate_enabled() {
            // Fast-path: use libdeflate
            'libdeflate: {
                if !(is_final_chunk
                    && !self
                        .flags
                        .contains(InternalStateFlags::IS_LIBDEFLATE_FAST_PATH_DISABLED)
                    && self.encoding.can_use_lib_deflate()
                    && self.is_done())
                {
                    break 'libdeflate;
                }
                self.flags
                    .insert(InternalStateFlags::IS_LIBDEFLATE_FAST_PATH_DISABLED);

                bun_output::scoped_log!(
                    HTTPInternalState,
                    "Decompressing {} bytes with libdeflate\n",
                    buffer.len()
                );
                let deflater = http_thread().deflater();

                // gzip stores the size of the uncompressed data in the last 4 bytes of the stream
                // But it's only valid if the stream is less than 4.7 GB, since it's 4 bytes.
                // If we know that the stream is going to be larger than our
                // pre-allocated buffer, then let's dynamically allocate the exact
                // size.
                if self.encoding == Encoding::Gzip
                    && buffer.len() > 16
                    && buffer.len() < 1024 * 1024 * 1024
                {
                    let estimated_size: u32 = u32::from_ne_bytes(
                        buffer[buffer.len() - 4..][..4].try_into().unwrap(),
                    );
                    // Since this is arbtirary input from the internet, let's set an upper bound of 32 MB for the allocation size.
                    if (estimated_size as usize) > deflater.shared_buffer.len()
                        && estimated_size < 32 * 1024 * 1024
                    {
                        body_out_str
                            .list
                            .reserve_exact((estimated_size as usize).saturating_sub(body_out_str.list.len()));
                        // TODO(port): need spare-capacity slice access on MutableString.list (allocatedSlice equivalent)
                        let result = deflater
                            .decompressor
                            .decompress(buffer, body_out_str.list.allocated_slice_mut(), bun_libdeflate::Encoding::Gzip);

                        if result.status == bun_libdeflate::Status::Success {
                            // SAFETY: decompress wrote `result.written` initialized bytes into the allocated slice
                            unsafe { body_out_str.list.set_len(result.written) };
                            still_needs_to_decompress = false;
                        }

                        break 'libdeflate;
                    }
                }

                let result = deflater.decompressor.decompress(
                    buffer,
                    &mut deflater.shared_buffer,
                    match self.encoding {
                        Encoding::Gzip => bun_libdeflate::Encoding::Gzip,
                        Encoding::Deflate => bun_libdeflate::Encoding::Deflate,
                        _ => unreachable!(),
                    },
                );

                if result.status == bun_libdeflate::Status::Success {
                    body_out_str
                        .list
                        .reserve_exact(result.written.saturating_sub(body_out_str.list.len()));
                    // PERF(port): was appendSliceAssumeCapacity
                    body_out_str
                        .list
                        .extend_from_slice(&deflater.shared_buffer[0..result.written]);
                    still_needs_to_decompress = false;
                }
            }
        }

        // Slow path, or brotli: use the .decompressor
        if still_needs_to_decompress {
            bun_output::scoped_log!(HTTPInternalState, "Decompressing {} bytes\n", buffer.len());
            if body_out_str.list.capacity() == 0 {
                let min = ((buffer.len() as f64) * 1.5).ceil().min(1024.0 * 1024.0 * 2.0);
                if let Err(err) = body_out_str.grow_by((min as usize).max(32)) {
                    self.compressed_body.reset();
                    return Err(err.into());
                }
            }

            if let Err(err) = self
                .decompressor
                .update_buffers(self.encoding, buffer, body_out_str)
            {
                self.compressed_body.reset();
                return Err(err.into());
            }

            if let Err(err) = self.decompressor.read_all(self.is_done()) {
                if self.is_done() || err != bun_core::err!("ShortRead") {
                    Output::pretty_errorln(format_args!(
                        "<r><red>Decompression error: {}<r>",
                        bstr::BStr::new(err.name().as_bytes())
                    ));
                    Output::flush();
                    self.compressed_body.reset();
                    return Err(err);
                }
            }
        }

        if extremely_verbose() {
            // TODO(port): `gzip_elapsed` is not a field on InternalState in the Zig source either —
            // this looks like dead code referencing a removed field. Preserved as a no-op read.
            let _ = gzip_timer.map(|t| t.elapsed());
        }

        self.compressed_body.reset();
        Ok(())
    }

    // TODO(port): narrow error set
    pub fn decompress(
        &mut self,
        buffer: &MutableString,
        body_out_str: &mut MutableString,
        is_final_chunk: bool,
    ) -> Result<(), Error> {
        // PORT NOTE: reshaped for borrowck — Zig passed MutableString by value; we borrow the inner slice.
        // TODO(port): if `buffer` aliases `self.compressed_body`, caller must restructure (see process_body_buffer).
        self.decompress_bytes(buffer.list.as_slice(), body_out_str, is_final_chunk)
    }

    // TODO(port): narrow error set
    pub fn process_body_buffer(
        &mut self,
        buffer: &MutableString,
        is_final_chunk: bool,
    ) -> Result<bool, Error> {
        if self.flags.contains(InternalStateFlags::IS_REDIRECT_PENDING) {
            return Ok(false);
        }

        // SAFETY: body_out_str is a live user-owned buffer for the lifetime of this state
        let body_out_str = unsafe { &mut *self.body_out_str.unwrap().as_ptr() };

        match self.encoding {
            Encoding::Brotli | Encoding::Gzip | Encoding::Deflate | Encoding::Zstd => {
                self.decompress(buffer, body_out_str, is_final_chunk)?;
            }
            _ => {
                if !body_out_str.owns(buffer.list.as_slice()) {
                    if let Err(err) = body_out_str.append(buffer.list.as_slice()) {
                        Output::pretty_errorln(format_args!(
                            "<r><red>Failed to append to body buffer: {}<r>",
                            bstr::BStr::new(err.name().as_bytes())
                        ));
                        Output::flush();
                        return Err(err.into());
                    }
                }
            }
        }

        // SAFETY: same invariant as above
        Ok(unsafe { (*self.body_out_str.unwrap().as_ptr()).list.len() } > 0)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HTTPStage {
    Pending,

    /// The `onOpen` callback has been called for the first time.
    Opened,

    Headers,
    Body,
    BodyChunk,
    Fail,
    Done,
    ProxyHandshake,
    ProxyHeaders,
    ProxyBody,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    Pending,
    Connect,
    Done,
    Fail,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/InternalState.zig (258 lines)
//   confidence: medium
//   todos:      9
//   notes:      body_out_str is user-owned raw ptr (no TSV row); request_body self-borrows original_request_body; defer compressed_body.reset() expanded inline at every error return; gzip_elapsed field missing in Zig source too
// ──────────────────────────────────────────────────────────────────────────
