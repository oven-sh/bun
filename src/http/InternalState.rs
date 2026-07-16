use core::ptr::NonNull;

use crate::Error;
use bun_core::MutableString;
use bun_core::Output;

use crate::{CertificateInfo, Decompressor, Encoding, HTTPRequestBody, HTTPResponseMetadata};

bun_core::define_scoped_log!(log, HTTPInternalState, hidden);

// TODO: reduce the size of this struct
// Many of these fields can be moved to a packed struct and use less space

pub struct InternalState<'a> {
    pub response_message_buffer: MutableString,
    /// pending response is the temporary storage for the response headers, url and status code
    /// this uses shared_response_headers_buf to store the headers
    /// this will be turned None once the metadata is cloned
    pub pending_response: Option<bun_picohttp::Response<'static>>,

    /// This is the cloned metadata containing the response headers, url and status code after the .headers phase are received
    /// will be turned None once returned to the user (the ownership is transferred to the user)
    /// this can happen after await fetch(...) and the body can continue streaming when this is already None
    /// the user will receive only chunks of the body stored in body_out_str
    pub cloned_metadata: Option<HTTPResponseMetadata>,
    pub flags: InternalStateFlags,

    pub transfer_encoding: Encoding,
    pub encoding: Encoding,
    pub content_encoding_i: u8,
    pub chunked_decoder: bun_picohttp::phr_chunked_decoder,
    pub decompressor: Decompressor,
    pub stage: Stage,
    /// This is owned by the user and should not be freed here.
    /// Non-owning back-reference, kept as a raw `NonNull` (BACKREF per PORTING.md).
    pub body_out_str: Option<NonNull<MutableString>>,
    pub compressed_body: MutableString,
    pub content_length: Option<usize>,
    pub total_body_received: usize,
    // Self-borrow into `original_request_body.bytes`; `RawSlice` carries the
    // outlives-holder invariant (the backing `original_request_body` is a
    // sibling field, so it lives exactly as long as this struct).
    pub request_body: bun_ptr::RawSlice<u8>,
    pub original_request_body: HTTPRequestBody<'a>,
    pub request_sent_len: usize,
    pub fail: Option<Error>,
    /// Raw `getaddrinfo(3)` return code when `fail` is `DNSResolveFailed`;
    /// 0 otherwise. The JS side turns it into the resolver error
    /// (`ENOTFOUND`, ...) with `syscall`/`hostname`, matching `node:dns`.
    pub dns_error: i32,
    /// Owned copy of the hostname the failed lookup was for
    /// (`connected_url.hostname`: the proxy's when one is configured, else
    /// the post-redirect target). Captured on the HTTP thread at the failure
    /// so the JS side never dereferences the client's borrowed URL buffers.
    pub dns_hostname: Option<Box<[u8]>>,
    pub request_stage: HTTPStage,
    pub response_stage: HTTPStage,
    pub certificate_info: Option<CertificateInfo>,
}

// Struct-of-bools so the
// HTTPClient state machine in lib.rs can use field syntax (`flags.allow_keepalive
// = true`) directly; pack into a bitfield if size ever matters.
#[derive(Clone, Copy)]
pub struct InternalStateFlags {
    pub allow_keepalive: bool,
    pub received_last_chunk: bool,
    pub did_set_content_encoding: bool,
    pub is_redirect_pending: bool,
    pub is_libdeflate_fast_path_disabled: bool,
    pub resend_request_body_on_redirect: bool,
    /// Cross-origin redirect: the per-request Host override must be dropped so
    /// the follow-up connection re-derives SNI/Host from the redirect target.
    /// The actual clear is deferred to `do_redirect`, after the old socket's
    /// pool/close decision — that decision needs `hostname` still set to know
    /// the handshake was verified against an override.
    pub clear_hostname_on_redirect: bool,
    /// Set when the TLS handshake completed but the user-supplied JS
    /// `checkServerIdentity` callback has not yet approved the peer
    /// certificate. While set, `on_writable` must not write any HTTP
    /// application data to the socket and `on_data` must treat incoming
    /// application data as unexpected. Cleared by
    /// `HTTPClient::resume_after_cert_check` once the JS thread reports the
    /// check passed (and implicitly by `InternalState::reset()` on every
    /// redirect hop / failure, so each hop re-parks independently).
    pub is_waiting_for_cert_check: bool,
    pub receive_paused: bool,
    /// Set once `HTTPClient::compress_body_for_send` has run for this attempt.
    /// Guards header-retry re-entries from compressing again. Cleared by
    /// `reset()`/`init()` so each redirect/retry hop re-compresses from the
    /// original uncompressed `original_request_body`.
    pub body_compressed: bool,
}

impl InternalStateFlags {
    /// Field defaults: `allow_keepalive = true`, rest false.
    pub(crate) const fn new() -> Self {
        Self {
            allow_keepalive: true,
            received_last_chunk: false,
            did_set_content_encoding: false,
            is_redirect_pending: false,
            is_libdeflate_fast_path_disabled: false,
            resend_request_body_on_redirect: false,
            clear_hostname_on_redirect: false,
            is_waiting_for_cert_check: false,
            receive_paused: false,
            body_compressed: false,
        }
    }
}

impl Default for InternalStateFlags {
    /// `allow_keepalive` defaults to true.
    fn default() -> Self {
        Self::new()
    }
}

impl Default for InternalState<'_> {
    fn default() -> Self {
        Self {
            response_message_buffer: MutableString::init_empty(),
            pending_response: None,
            cloned_metadata: None,
            flags: InternalStateFlags::new(),
            transfer_encoding: Encoding::Identity,
            encoding: Encoding::Identity,
            content_encoding_i: u8::MAX,
            chunked_decoder: bun_picohttp::phr_chunked_decoder::default(),
            decompressor: Decompressor::None,
            stage: Stage::Pending,
            body_out_str: None,
            compressed_body: MutableString::init_empty(),
            content_length: None,
            total_body_received: 0,
            request_body: bun_ptr::RawSlice::EMPTY,
            original_request_body: HTTPRequestBody::Bytes(b""),
            request_sent_len: 0,
            fail: None,
            dns_error: 0,
            dns_hostname: None,
            request_stage: HTTPStage::Pending,
            response_stage: HTTPStage::Pending,
            certificate_info: None,
        }
    }
}

impl<'a> InternalState<'a> {
    pub fn init(body: HTTPRequestBody<'a>, body_out_str: &mut MutableString) -> InternalState<'a> {
        let request_body = bun_ptr::RawSlice::new(body.slice());
        InternalState {
            original_request_body: body,
            request_body,
            compressed_body: MutableString::init_empty(),
            response_message_buffer: MutableString::init_empty(),
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
        // allocator param dropped (global mimalloc).
        self.compressed_body = MutableString::init_empty();
        self.response_message_buffer = MutableString::init_empty();

        let body_msg = self.body_out_str;
        if let Some(body) = body_msg {
            crate::body_out::as_mut(body).reset();
        }
        // The boxed
        // Zlib/Brotli/Zstd readers all impl Drop calling end()/destroy_instance
        // (see the note in Decompressor.rs), so the `*self = ...` assignment below
        // frees the FFI handle via drop glue — no explicit reset needed.

        // just in case we check and free to avoid leaks
        // (Option<HTTPResponseMetadata> drops on assignment; allocator param removed)
        self.cloned_metadata = None;

        // if exists we own this info
        // (Option<CertificateInfo> drops on assignment; allocator param removed)
        self.certificate_info = None;

        self.original_request_body.deinit();
        *self = InternalState {
            body_out_str: body_msg,
            compressed_body: MutableString::init_empty(),
            response_message_buffer: MutableString::init_empty(),
            original_request_body: HTTPRequestBody::Bytes(b""),
            request_body: bun_ptr::RawSlice::EMPTY,
            certificate_info: None,
            flags: InternalStateFlags::new(),
            total_body_received: 0,
            ..Default::default()
        };
    }

    /// The buffer response body bytes accumulate into. For compressed
    /// responses this is the intermediate `compressed_body`; otherwise it is
    /// the caller-owned `body_out_str`. When `body_out_str` is `None` (the
    /// request is in a transitional/terminal state where no owner buffer is
    /// attached) fall back to `compressed_body` so the chunked decoder can
    /// still run without panicking; those bytes are discarded on the next
    /// `reset()`.
    pub fn get_body_buffer(&mut self) -> &mut MutableString {
        if self.encoding.is_compressed() {
            return &mut self.compressed_body;
        }
        match self.body_out_str {
            Some(p) => crate::body_out::as_mut(p),
            None => &mut self.compressed_body,
        }
    }

    /// Split-borrow `chunked_decoder` and the body buffer (which is either
    /// `compressed_body` or the caller-owned `body_out_str`). Both targets are
    /// disjoint from each other and from every other field touched by
    /// `phr_decode_chunked` callers, so this lets the chunked-decode hot path
    /// in `lib.rs` operate on safe references instead of repeated raw-ptr
    /// place expressions.
    #[inline]
    pub fn chunked_decoder_and_body_buffer(
        &mut self,
    ) -> (&mut bun_picohttp::phr_chunked_decoder, &mut MutableString) {
        match self.body_out_str {
            _ if self.encoding.is_compressed() => {
                (&mut self.chunked_decoder, &mut self.compressed_body)
            }
            // body_out_str is a separate heap allocation, never aliasing
            // `chunked_decoder` (a value field of `self`).
            Some(p) => (&mut self.chunked_decoder, crate::body_out::as_mut(p)),
            // See `get_body_buffer`: fall back to `compressed_body` rather
            // than panic when no owner buffer is attached.
            None => (&mut self.chunked_decoder, &mut self.compressed_body),
        }
    }

    pub fn is_done(&self) -> bool {
        if self.is_chunked_encoding() {
            return self.flags.received_last_chunk;
        }

        if let Some(content_length) = self.content_length {
            return self.total_body_received >= content_length;
        }

        // Content-Type: text/event-stream we should be done only when Close/End/Timeout connection
        self.flags.received_last_chunk
    }

    pub fn decompress_bytes(
        &mut self,
        buffer: &[u8],
        body_out_str: &mut MutableString,
        is_final_chunk: bool,
    ) -> Result<(), Error> {
        // A response that declared a Content-Encoding but sent zero body bytes
        // (e.g. an empty chunked gzip response) has nothing to decompress.
        // Running the decompressor anyway makes it report a truncated stream
        // (ZlibError); Node treats this as an empty body.
        if buffer.is_empty() && self.total_body_received == 0 {
            self.compressed_body.reset();
            return Ok(());
        }

        // `self.compressed_body.reset()` must run on every exit. scopeguard would
        // hold &mut self.compressed_body across the body and conflict with &mut self.decompressor,
        // so each early-return below calls it explicitly.
        let mut still_needs_to_decompress = true;

        if bun_core::feature_flags::is_libdeflate_enabled() {
            // Fast-path: use libdeflate

            'libdeflate: {
                use bun_libdeflate_sys::libdeflate as bun_libdeflate;
                if !(is_final_chunk
                    && !self.flags.is_libdeflate_fast_path_disabled
                    && self.encoding.can_use_lib_deflate()
                    && self.is_done())
                {
                    break 'libdeflate;
                }
                self.flags.is_libdeflate_fast_path_disabled = true;

                log!("Decompressing {} bytes with libdeflate\n", buffer.len());
                let deflater = crate::http_thread().deflater();

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
                        buffer[buffer.len() - 4..][..4]
                            .try_into()
                            .expect("infallible: size matches"),
                    );
                    // Since this is arbtirary input from the internet, let's set an upper bound of 32 MB for the allocation size.
                    if (estimated_size as usize) > deflater.shared_buffer.len()
                        && estimated_size < 32 * 1024 * 1024
                    {
                        body_out_str.list.reserve_exact(
                            (estimated_size as usize).saturating_sub(body_out_str.list.len()),
                        );
                        body_out_str.list.clear();
                        let result = deflater.decompressor_mut().decompress_to_vec(
                            buffer,
                            &mut body_out_str.list,
                            bun_libdeflate::Encoding::Gzip,
                        );
                        // libdeflate decodes a single gzip member; unconsumed
                        // input means this is a multi-member stream (RFC 1952
                        // §2.2). Let the zlib path handle it.
                        if result.status == bun_libdeflate::Status::Success
                            && result.read == buffer.len()
                        {
                            still_needs_to_decompress = false;
                        } else {
                            body_out_str.list.clear();
                        }

                        break 'libdeflate;
                    }
                }

                let decompressor = deflater
                    .decompressor
                    .as_deref_mut()
                    .expect("set in HttpThread::deflater()");
                let result = decompressor.decompress(
                    buffer,
                    &mut deflater.shared_buffer,
                    match self.encoding {
                        Encoding::Gzip => bun_libdeflate::Encoding::Gzip,
                        Encoding::Deflate => bun_libdeflate::Encoding::Deflate,
                        _ => unreachable!(),
                    },
                );

                // libdeflate decodes a single member; unconsumed input means
                // a multi-member gzip stream. Let the zlib path handle it.
                if result.status == bun_libdeflate::Status::Success && result.read == buffer.len() {
                    body_out_str
                        .list
                        .reserve_exact(result.written.saturating_sub(body_out_str.list.len()));
                    body_out_str
                        .list
                        .extend_from_slice(&deflater.shared_buffer[0..result.written]);
                    still_needs_to_decompress = false;
                }
            }
            let _ = is_final_chunk;
        }

        // Slow path, or brotli: use the .decompressor
        if still_needs_to_decompress {
            log!("Decompressing {} bytes\n", buffer.len());
            if body_out_str.list.capacity() == 0 {
                let min = ((buffer.len() as f64) * 1.5)
                    .ceil()
                    .min(1024.0 * 1024.0 * 2.0);
                if let Err(err) = body_out_str.grow_by((min as usize).max(32)) {
                    self.compressed_body.reset();
                    return Err(err.into());
                }
            }

            let is_done = self.is_done();
            if let Err(err) =
                self.decompressor
                    .decompress_chunk(self.encoding, buffer, body_out_str, is_done)
            {
                if is_done || err != crate::Error::ShortRead {
                    bun_core::pretty_errorln!(
                        "<r><red>Decompression error: {}<r>",
                        bstr::BStr::new(err.name()),
                    );
                    Output::flush();
                    self.compressed_body.reset();
                    return Err(err);
                }
            }
        }

        self.compressed_body.reset();
        Ok(())
    }

    pub fn decompress(
        &mut self,
        buffer: &MutableString,
        body_out_str: &mut MutableString,
        is_final_chunk: bool,
    ) -> Result<(), Error> {
        self.decompress_bytes(buffer.list.as_slice(), body_out_str, is_final_chunk)
    }

    // `buffer` is always the current body buffer's bytes. To avoid aliased &mut/& under
    // Stacked Borrows (decompress_bytes mutates `self.compressed_body`; the uncompressed
    // path materialises `&mut *body_out_str`), callers `mem::take` the body buffer's `list`
    // and pass it here as an owned Vec — no `&` into `self` survives across `&mut self`.
    pub fn process_body_buffer(
        &mut self,
        mut buffer: Vec<u8>,
        is_final_chunk: bool,
    ) -> Result<bool, Error> {
        if self.flags.is_redirect_pending {
            // Caller moved the bytes out of the body buffer; put them back so the
            // take is a no-op.
            self.get_body_buffer().list = buffer;
            return Ok(false);
        }

        // `decompress_bytes` below takes `&mut self` alongside `body_out_str`,
        // so a `&mut self` accessor would tie the borrow to `self`. The free
        // `body_out::as_mut` yields an unbounded `&mut` to the disjoint
        // caller-owned allocation.
        let Some(body_out_ptr) = self.body_out_str else {
            // No owner buffer attached (see `get_body_buffer`). There is
            // nowhere to deliver decoded bytes; put the buffer back so the
            // caller's take is a no-op and report no progress. The request
            // is already in a transitional/terminal state.
            self.get_body_buffer().list = buffer;
            return Ok(false);
        };
        let body_out_str = crate::body_out::as_mut(body_out_ptr);

        match self.encoding {
            Encoding::Brotli | Encoding::Gzip | Encoding::Deflate | Encoding::Zstd => {
                self.decompress_bytes(&buffer, body_out_str, is_final_chunk)?;
                // Retain capacity by
                // returning the (cleared) allocation to compressed_body instead of dropping it.
                buffer.clear();
                self.compressed_body.list = buffer;
            }
            _ => {
                // Uncompressed: caller took `buffer` from `body_out_str.list`, leaving it
                // empty — move the bytes back. If body_out_str is
                // somehow non-empty, fall back to append.
                if body_out_str.list.is_empty() {
                    body_out_str.list = buffer;
                } else if !body_out_str.owns(&buffer) {
                    if let Err(err) = body_out_str.append(&buffer) {
                        let err: Error = err.into();
                        bun_core::pretty_errorln!(
                            "<r><red>Failed to append to body buffer: {}<r>",
                            bstr::BStr::new(err.name()),
                        );
                        Output::flush();
                        return Err(err);
                    }
                }
            }
        }

        Ok(!body_out_str.list.is_empty())
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

// Aliases used by the HTTPClient state machine: `request_stage` /
// `response_stage` are separate fields but share one HTTPStage enum.
pub(crate) type RequestStage = HTTPStage;
pub(crate) type ResponseStage = HTTPStage;
