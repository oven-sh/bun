//! HTTP/2 connection engine core (RFC 9113). Generic over a `Sink` (no JSC) so the protocol logic
//! is pure and the JSC binding implements the Sink. Part of the from-scratch rewrite — composes
//! wire/settings/flow_control/hpack/stream with a SINGLE inbound dispatch and centralized
//! §4.2/§6 validation. Connection-level framing lives here; stream-level (HEADERS/DATA/RST) and the
//! outbound request/respond paths build on top of this.

#![allow(dead_code)]

use super::flow_control::{RecvWindow, SendWindow};
use super::hpack;
use super::settings::{self, Settings};
use super::stream::{self, State};
use super::wire::{self, ErrorCode, FrameHeader, FrameType, SettingId};
use bun_collections::HashMap;

/// Pseudo-header presence bits shared by the per-field decode loop and the RFC 9113 §8.3.1
/// request checks in `finish_header_block` (nghttp2's NGHTTP2_HTTP_FLAG__* equivalents).
mod pseudo {
    pub(super) const METHOD: u8 = 1;
    pub(super) const SCHEME: u8 = 2;
    pub(super) const AUTHORITY: u8 = 4;
    pub(super) const PATH: u8 = 8;
    pub(super) const STATUS: u8 = 16;
    pub(super) const PROTOCOL: u8 = 32;
    pub(super) const UNKNOWN: u8 = 64;
}

/// Snapshot of the local-settings values carried by one sent-but-unACKed SETTINGS frame, so an
/// inbound ACK is attributed to the submission it actually acknowledges (RFC 9113 §6.5.3) rather
/// than to the latest submission.
#[derive(Clone, Copy)]
pub struct PendingLocalSettings {
    pub settings: Settings,
}

/// Per-stream protocol state tracked by the engine.
pub struct Stream {
    pub state: State,
    pub send_window: SendWindow,
    pub recv_window: RecvWindow,
    /// A non-informational inbound header block was delivered: the next inbound HEADERS on this
    /// stream is a trailer section (RFC 9113 §8.1).
    pub recv_final_headers: bool,
    /// Declared `content-length` of the inbound message, if any (RFC 9113 §8.1.1).
    pub content_length: Option<u64>,
    /// DATA payload bytes (padding excluded) received so far.
    pub recv_body_bytes: u64,
}

impl Stream {
    fn new(initial_send: u32, initial_recv: u32) -> Self {
        Stream {
            state: State::Idle,
            send_window: SendWindow::new(initial_send),
            recv_window: RecvWindow::new(initial_recv),
            recv_final_headers: false,
            content_length: None,
            recv_body_bytes: 0,
        }
    }
}

/// RFC 9110 §8.6: `content-length` is 1*DIGIT. Anything else, or a value that does not fit
/// in a u64, is rejected.
fn parse_content_length(value: &[u8]) -> Option<u64> {
    if value.is_empty() {
        return None;
    }
    let mut n: u64 = 0;
    for &c in value {
        if !c.is_ascii_digit() {
            return None;
        }
        n = n.checked_mul(10)?.checked_add(u64::from(c - b'0'))?;
    }
    Some(n)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WriteResult {
    Dropped = -1,
    Queued = 0,
    Sent = 1,
}

/// Outcome of feeding bytes: how many were consumed, and whether the connection is now closing.
#[derive(Clone, Copy, Debug)]
enum StreamedDataStart {
    Fatal,
    Consumed(usize),
}

struct DataInFlight {
    stream_id: u32,
    /// Payload bytes (incl. trailing padding) not yet received.
    payload_remaining: u32,
    /// Leading portion of the remaining payload that is data; the rest is padding.
    data_remaining: u32,
    end_stream: bool,
    /// Frame was addressed to an invalid/closed stream (already RST): swallow, don't deliver.
    discard: bool,
}

pub struct Feed {
    pub consumed: usize,
    pub fatal: bool,
}

/// nghttp2's NGHTTP2_DEFAULT_MAX_OBQ_FLOOD_ITEM: outbound PING/SETTINGS ACKs that may pile up
/// behind a non-reading peer before the session is treated as flooded (NGHTTP2_ERR_FLOODED).
const MAX_OUTBOUND_ACK_QUEUE: u32 = 1000;

/// What the connection engine calls back into the embedder (the JSC binding) for. Methods take
/// `&self`: the JSC binding (H2FrameParser) is fully interior-mutable (Cell/JsCell) and its host
/// functions receive `&Self`, so it can own the `Connection` and pass itself as the sink without an
/// ownership cycle.
pub trait Sink {
    fn write(&self, bytes: &[u8]) -> WriteResult;
    /// A locally-detected connection error: the GOAWAY (when one applies) is already on the wire.
    /// `lib_error_code` is the negative nghttp2-style library error code (`wire::lib_error`) the
    /// embedder maps to node's NghttpError.
    fn on_error(&self, lib_error_code: i32, last_stream_id: u32, debug: &[u8]);
    fn on_local_settings(&self, settings: &Settings);
    fn on_remote_settings(&self, settings: &Settings);
    fn on_ping(&self, payload: &[u8], is_ack: bool);
    /// `code` is the raw u32 from the wire so unknown error codes survive to JS (node parity).
    fn on_go_away(&self, code: u32, last_stream_id: u32, debug: &[u8]);
    /// After a WINDOW_UPDATE has been applied (for resuming sends).
    fn on_window_update(&self, stream_id: u32, increment: u32);

    // ---- Stream-level (default no-op so simple sinks can ignore them) ----

    /// A new stream was created by an inbound HEADERS (the embedder allocates its JS wrapper).
    fn on_stream_open(&self, _stream_id: u32) {}
    /// Whether the embedder can afford the state for a new peer-initiated stream (the session
    /// memory budget, node's maxSessionMemory). `false` refuses the HEADERS with RST_STREAM
    /// (ENHANCE_YOUR_CALM, node's Http2Session::OnBeginHeadersCallback) before any stream state
    /// is allocated; the header block is still decoded for HPACK-table sync (§4.3).
    fn can_open_stream(&self) -> bool {
        true
    }
    /// A SETTINGS entry with an id outside the standard registry (node's remoteCustomSettings).
    fn on_remote_custom_setting(&self, _id: u16, _value: u32) {}
    /// One decoded header field. `name`/`value` alias a shared buffer — copy before returning.
    fn on_header(&self, _stream_id: u32, _name: &[u8], _value: &[u8], _never_index: bool) {}
    /// The header block for `stream_id` is complete. `end_stream` = the HEADERS carried END_STREAM.
    fn on_headers_complete(&self, _stream_id: u32, _end_stream: bool, _flags: u8) {}
    /// A DATA payload (padding already stripped).
    fn on_data(&self, _stream_id: u32, _data: &[u8]) {}
    /// The stream half/fully closed; `state` is the `stream::State` integer.
    fn on_stream_end(&self, _stream_id: u32, _state: u8) {}
    /// The stream was reset (inbound RST_STREAM or a local stream error). `code` is the raw
    /// u32 from the wire so unknown error codes survive to JS (node parity).
    fn on_stream_reset(&self, _stream_id: u32, _code: u32) {}
    /// A locally-initiated stream rejection (oversized/malformed header block) - distinct from
    /// peer-sent resets so the embedder can budget rejections (maxSessionRejectedStreams).
    fn on_stream_rejected(&self, _stream_id: u32) {}
    /// A server PUSH_PROMISE reserved `promised_id` on behalf of `parent_id`. Fires before the
    /// promised request's on_header/on_headers_complete (which use `promised_id`).
    fn on_push_promise(&self, _parent_id: u32, _promised_id: u32) {}
    /// RFC 7838 ALTSVC.
    fn on_altsvc(&self, _stream_id: u32, _origin: &[u8], _value: &[u8]) {}
    /// RFC 8336 ORIGIN — the full frame payload (a sequence of 2-byte-length-prefixed origins),
    /// delivered once per frame so the embedder can surface them as a single event.
    fn on_origin(&self, _payload: &[u8]) {}
    /// The peer exceeded the session's invalid-frame allowance (node's maxSessionInvalidFrames):
    /// the embedder should destroy the session with ERR_HTTP2_TOO_MANY_INVALID_FRAMES.
    fn on_too_many_invalid_frames(&self) {}
    /// Frame-counter update (perf_hooks http2 session stats). Called whenever either
    /// counter moves, while the connection is mutably borrowed — the embedder must only
    /// store the values.
    fn on_frame_counters(&self, _received: u64, _sent: u64) {}
    /// Transition shim while the outbound path still flows through the embedder's legacy encoder:
    /// returns true if `stream_id` was initiated locally (HEADERS already sent by the embedder), so
    /// inbound frames for it are not treated as frames on an idle stream.
    fn is_local_stream(&self, _stream_id: u32) -> bool {
        false
    }
    /// Highest stream id the embedder has ever registered, in either direction. Monotonic across
    /// stream eviction: ids at or below it have existed (closed at worst, never idle), which the
    /// engine cannot tell on its own for locally-initiated streams whose HEADERS it never sent
    /// (nghttp2's session_detect_idle_stream uses the same allocation high-water marks).
    fn highest_started_stream_id(&self) -> u32 {
        0
    }
    /// Whether the embedder's reader for `stream_id` is currently consuming data. While it is
    /// paused, the stream's receive window is not replenished (mirrors node, where
    /// nghttp2_session_consume_stream is only called while the JS readable is flowing) so the
    /// peer is backpressured instead of buffering unboundedly. Connection-level replenishment is
    /// unaffected.
    fn is_stream_reading(&self, _stream_id: u32) -> bool {
        true
    }
}

pub struct Connection {
    pub is_server: bool,
    /// Wire frames fully accepted from the peer (perf_hooks http2 session stats).
    pub frames_received: u64,
    /// Wire frames this engine itself has written (the embedder counts its own).
    pub frames_sent: u64,

    pub local_settings: Settings,
    pub remote_settings: Settings,
    /// Whether our initial SETTINGS has been ACKed (affects §6.9.2 window grace).
    pub local_settings_acked: bool,
    /// Maximum decoded header fields per block (node's maxHeaderListPairs session option; not a
    /// SETTINGS parameter). Blocks exceeding it are refused like an oversized header list.
    pub max_header_list_pairs: u32,
    /// Invalid frames tolerated before the session is torn down (node's maxSessionInvalidFrames
    /// session option; not a SETTINGS parameter). An empty DATA frame without END_STREAM counts
    /// as an invalid frame.
    pub max_invalid_frames: u32,
    /// The initial window size the peer has ACKed (RFC 9113 6.5.3): until our SETTINGS is ACKed,
    /// the peer may legitimately send according to the previous value - enforce the larger.
    acked_local_initial_window: u32,
    /// SETTINGS_MAX_HEADER_LIST_SIZE value enforced on received header blocks. nghttp2 only
    /// applies a submitted local SETTINGS value once the peer ACKs it, so a header block that was
    /// already in flight when we lowered the limit must not be rejected (node's
    /// test-http2-session-settings submits maxHeaderListSize=1 mid-request and still receives the
    /// response). Starts at the creation-time value the connection preface advertises and is
    /// updated on each SETTINGS ACK.
    pub enforced_max_header_list_size: u32,
    /// Local-settings snapshots of sent-but-unACKed SETTINGS frames, in send order. §6.5.3:
    /// ACKs apply to outstanding SETTINGS in order, so each inbound ACK pops the front - the
    /// values the peer actually acknowledged - rather than assuming the latest submission.
    pub pending_local_settings_acks: std::collections::VecDeque<PendingLocalSettings>,
    invalid_frame_count: u32,
    /// Maximum number of entries accepted in a single inbound SETTINGS frame (node's maxSettings
    /// session option, nghttp2's max_settings; not a SETTINGS parameter). Frames carrying more
    /// entries are a connection error (ENHANCE_YOUR_CALM, like nghttp2's flood guard).
    pub max_settings: u32,

    /// Connection-level flow control (§6.9.1). The connection window is fixed at 65535 initially
    /// and is NOT affected by SETTINGS_INITIAL_WINDOW_SIZE (that governs streams only).
    pub send_window: SendWindow,
    pub recv_window: RecvWindow,

    pub hpack: hpack::Coder,

    pub streams: HashMap<u32, Stream>,

    /// Header-block reassembly across CONTINUATION (RFC 9113 §4.3). 0 = not assembling; otherwise
    /// the stream id whose header block is mid-flight and which the next frame MUST continue.
    continuation_stream: u32,
    header_block: Vec<u8>,
    /// In-progress partial DATA frame streamed incrementally. nghttp2 delivers DATA in
    /// chunks as bytes arrive (node emits 'data' for a partial frame); buffering until the
    /// frame completes would stall consumers behind a peer that trickles one large frame.
    data_in_flight: Option<DataInFlight>,
    header_end_stream: bool,
    /// The original HEADERS frame flags (passed to on_headers_complete; 0 for PUSH_PROMISE).
    header_flags: u8,
    /// The stream id the assembling header block belongs to (the promised id for a PUSH_PROMISE).
    header_target: u32,
    /// 0 for a normal HEADERS block; the parent stream id when assembling a PUSH_PROMISE block.
    header_push_parent: u32,
    /// The assembling block opens a new inbound stream (a request block on the server, a
    /// PUSH_PROMISE request block on the client). False for a later HEADERS on the same stream
    /// (a trailer section), which RFC 9113 §8.1 forbids from carrying pseudo-headers and which
    /// must not be held to the request pseudo-header requirements of §8.3.1.
    header_is_request: bool,
    /// HEADERS arrived on a closed/half-closed-remote stream: the block is still decoded so the
    /// connection-scoped HPACK table stays in sync (§4.3), then refused with RST_STREAM
    /// (STREAM_CLOSED) instead of being dispatched.
    header_stream_closed: bool,
    /// The embedder refused the stream (can_open_stream = false, node's maxSessionMemory): the
    /// block is decoded for HPACK sync (§4.3), then answered with RST_STREAM(ENHANCE_YOUR_CALM).
    header_stream_refused: bool,
    /// A locally-detected connection error already tore the session down: ignore further input.
    terminated: bool,
    /// PING/SETTINGS ACKs queued behind a non-reading peer (nghttp2's
    /// obq_flood_counter_). Reset only via note_outbound_drained() when the
    /// embedder confirms its outbound buffer emptied — never per receive().
    obq_ack_pending: u32,

    /// Scratch buffer for the outbound HPACK-encoded header block.
    enc_buf: Vec<u8>,
    /// Reusable scratch for end-of-batch window replenishment (stream id, increment).
    replenish_buf: Vec<(u32, u32)>,
    /// Reused buffer for evicting closed streams after each receive pass (no per-call allocation).
    evict_buf: Vec<u32>,

    preface_received: usize,
    pub last_stream_id: u32,
    pub going_away: bool,
}

impl Connection {
    pub fn new(is_server: bool, local: Settings) -> Self {
        Connection {
            is_server,
            local_settings: local,
            remote_settings: Settings::default(),
            local_settings_acked: false,
            max_header_list_pairs: 128,
            frames_received: 0,
            frames_sent: 0,
            max_invalid_frames: 1000,
            acked_local_initial_window: 65_535,
            enforced_max_header_list_size: local.max_header_list_size,
            pending_local_settings_acks: std::collections::VecDeque::new(),
            invalid_frame_count: 0,
            max_settings: 32,
            send_window: SendWindow::new(wire::DEFAULT_WINDOW_SIZE),
            recv_window: RecvWindow::new(wire::DEFAULT_WINDOW_SIZE),
            hpack: hpack::Coder::new(local.header_table_size),
            streams: HashMap::new(),
            continuation_stream: 0,
            header_block: Vec::new(),
            data_in_flight: None,
            header_end_stream: false,
            header_flags: 0,
            header_target: 0,
            header_push_parent: 0,
            header_is_request: false,
            header_stream_closed: false,
            header_stream_refused: false,
            terminated: false,
            obq_ack_pending: 0,
            enc_buf: Vec::new(),
            replenish_buf: Vec::new(),
            evict_buf: Vec::new(),
            preface_received: 0,
            last_stream_id: 0,
            going_away: false,
        }
    }

    // ---- Outbound -------------------------------------------------------

    fn write_frame(
        &mut self,
        sink: &impl Sink,
        ftype: FrameType,
        flags: u8,
        stream_id: u32,
        payload: &[u8],
    ) {
        self.frames_sent += 1;
        sink.on_frame_counters(self.frames_received, self.frames_sent);
        let mut hdr_buf = [0u8; wire::FRAME_HEADER_SIZE];
        let hdr = FrameHeader {
            length: payload.len() as u32,
            frame_type: ftype as u8,
            flags,
            stream_id,
        };
        hdr.write(&mut hdr_buf);
        sink.write(&hdr_buf);
        if !payload.is_empty() {
            sink.write(payload);
        }
    }

    fn send_settings_ack(&mut self, sink: &impl Sink) {
        self.write_frame(sink, FrameType::Settings, wire::flags::ACK, 0, &[]);
    }

    fn send_ping_ack(&mut self, sink: &impl Sink, payload: &[u8]) {
        self.write_frame(sink, FrameType::Ping, wire::flags::ACK, 0, payload);
    }

    /// Locally-detected connection error: send GOAWAY, mark the session terminated (further input
    /// is ignored, like nghttp2 after terminate_session), and surface it to the embedder with the
    /// nghttp2-style `lib_code` so JS can build node's NghttpError.
    fn local_connection_error(
        &mut self,
        sink: &impl Sink,
        code: ErrorCode,
        lib_code: i32,
        debug: &[u8],
    ) {
        self.going_away = true;
        self.terminated = true;
        let mut payload = Vec::with_capacity(8 + debug.len());
        payload.extend_from_slice(&self.last_stream_id.to_be_bytes());
        payload.extend_from_slice(&code.as_u32().to_be_bytes());
        payload.extend_from_slice(debug);
        self.write_frame(sink, FrameType::GoAway, 0, 0, &payload);
        let last = self.last_stream_id;
        sink.on_error(lib_code, last, debug);
    }

    /// Connection error with the generic NGHTTP2_ERR_PROTO library code — the same thing node
    /// reports ("Protocol error") whenever nghttp2 terminates a session internally without a more
    /// specific callback (node's `internal_goaway_sent_` path in OnFrameSent/SendPendingData).
    pub fn send_go_away(&mut self, sink: &impl Sink, code: ErrorCode, debug: &[u8]) {
        self.local_connection_error(sink, code, wire::lib_error::PROTO, debug);
    }

    fn send_window_update(&mut self, sink: &impl Sink, stream_id: u32, increment: u32) {
        self.write_frame(
            sink,
            FrameType::WindowUpdate,
            0,
            stream_id,
            &increment.to_be_bytes(),
        );
    }

    fn send_rst_stream(&mut self, sink: &impl Sink, stream_id: u32, code: ErrorCode) {
        self.write_frame(
            sink,
            FrameType::RstStream,
            0,
            stream_id,
            &code.as_u32().to_be_bytes(),
        );
    }

    // ---- Inbound --------------------------------------------------------

    /// Feed received bytes. Processes every complete frame and returns `consumed` = the offset of
    /// the first incomplete frame (the caller keeps `bytes[consumed..]` and re-presents it prepended
    /// to the next chunk — the engine holds no reassembly buffer).
    pub fn receive(&mut self, sink: &impl Sink, bytes: &[u8]) -> Feed {
        let mut offset = 0usize;

        // A locally-detected connection error already tore the session down (GOAWAY sent, error
        // surfaced): everything after it is discarded so no further streams/frames reach JS.
        if self.terminated {
            return Feed {
                consumed: bytes.len(),
                fatal: true,
            };
        }

        // §3.4: server validates the 24-octet client preface before any frame.
        if self.is_server && self.preface_received < wire::CONNECTION_PREFACE.len() {
            let need = wire::CONNECTION_PREFACE.len() - self.preface_received;
            let avail = need.min(bytes.len());
            let expect =
                &wire::CONNECTION_PREFACE[self.preface_received..self.preface_received + avail];
            if &bytes[..avail] != expect {
                // node: nghttp2_session_mem_recv returns NGHTTP2_ERR_BAD_CLIENT_MAGIC and the
                // session errors with "Received bad client magic byte string".
                self.local_connection_error(
                    sink,
                    ErrorCode::ProtocolError,
                    wire::lib_error::BAD_CLIENT_MAGIC,
                    b"invalid connection preface",
                );
                return Feed {
                    consumed: avail,
                    fatal: true,
                };
            }
            self.preface_received += avail;
            offset += avail;
            if self.preface_received < wire::CONNECTION_PREFACE.len() {
                return Feed {
                    consumed: offset,
                    fatal: false,
                };
            }
        }

        if let Some(mut inflight) = self.data_in_flight.take() {
            let avail = (bytes.len() - offset).min(inflight.payload_remaining as usize);
            let data_now = avail.min(inflight.data_remaining as usize);
            if data_now > 0 && !inflight.discard {
                sink.on_data(inflight.stream_id, &bytes[offset..offset + data_now]);
            }
            inflight.data_remaining -= data_now as u32;
            inflight.payload_remaining -= avail as u32;
            offset += avail;
            if inflight.payload_remaining == 0 {
                self.finish_streamed_data(sink, &inflight);
            } else {
                self.data_in_flight = Some(inflight);
                self.replenish_windows(sink);
                return Feed {
                    consumed: offset,
                    fatal: false,
                };
            }
        }

        loop {
            let remaining = &bytes[offset..];
            if remaining.len() < wire::FRAME_HEADER_SIZE {
                break;
            }
            let hdr = FrameHeader::parse(remaining);
            // RFC 9113 4.2: refuse a frame whose declared length exceeds SETTINGS_MAX_FRAME_SIZE
            // before buffering its payload - waiting for the full frame first would let a peer
            // make us hold up to 16 MiB per connection on a 9-byte header.
            if hdr.length > self.local_settings.max_frame_size {
                self.send_go_away(
                    sink,
                    ErrorCode::FrameSizeError,
                    b"frame exceeds SETTINGS_MAX_FRAME_SIZE",
                );
                return Feed {
                    consumed: offset,
                    fatal: true,
                };
            }
            let total = wire::FRAME_HEADER_SIZE + hdr.length as usize;
            if remaining.len() < total {
                // Incomplete DATA frames stream incrementally (see DataInFlight); everything
                // else waits for the full frame.
                if matches!(hdr.typ(), Some(FrameType::Data))
                    && self.continuation_stream == 0
                    && hdr.stream_id != 0
                    && hdr.length > 0
                {
                    let padded = wire::flags::has(hdr.flags, wire::flags::PADDED);
                    let avail_payload = remaining.len() - wire::FRAME_HEADER_SIZE;
                    // With PADDED set the first payload octet is Pad Length; wait for it.
                    if !padded || avail_payload >= 1 {
                        match self.begin_streamed_data(sink, &hdr, remaining, padded) {
                            StreamedDataStart::Fatal => {
                                return Feed {
                                    consumed: offset,
                                    fatal: true,
                                };
                            }
                            StreamedDataStart::Consumed(n) => {
                                offset += n;
                            }
                        }
                    }
                }
                break;
            }
            let payload = &remaining[wire::FRAME_HEADER_SIZE..total];
            if self.dispatch(sink, &hdr, payload) {
                return Feed {
                    consumed: offset + total,
                    fatal: true,
                };
            }
            offset += total;
        }
        // Re-open consumed receive windows once per batch (RFC 9113 §6.9; mirrors how the
        // application-consumption-driven update works in node) — doing it per frame would both spam
        // WINDOW_UPDATE and make burst flow-control violations undetectable.
        self.replenish_windows(sink);
        Feed {
            consumed: offset,
            fatal: false,
        }
    }

    /// Send WINDOW_UPDATE for every receive window that has consumed at least half its size.
    fn replenish_windows(&mut self, sink: &impl Sink) {
        if self.recv_window.needs_update() {
            let inc = self.recv_window.take_update();
            if inc > 0 {
                self.send_window_update(sink, 0, inc);
            }
        }
        let mut buf = std::mem::take(&mut self.replenish_buf);
        buf.clear();
        for (id, s) in self.streams.iter_mut() {
            if s.state != State::Closed
                && s.recv_window.needs_update()
                && sink.is_stream_reading(*id)
            {
                let inc = s.recv_window.take_update();
                if inc > 0 {
                    buf.push((*id, inc));
                }
            }
        }
        for (id, inc) in buf.iter() {
            self.send_window_update(sink, *id, *inc);
        }
        self.replenish_buf = buf;
        // Evict closed streams so the map (and this scan) stay bounded on long-lived connections.
        // A late DATA/RST/WINDOW_UPDATE for an evicted id takes the unknown-stream path, which
        // answers RST_STREAM(STREAM_CLOSED) - the 5.1 closed-state behavior. A late HEADERS for an
        // evicted id re-opens a fresh entry (the parity check still applies); that matches how
        // trailers-after-close are treated as a new block by the legacy parser as well.
        let mut evict = std::mem::take(&mut self.evict_buf);
        evict.clear();
        for (id, s) in self.streams.iter() {
            if s.state == State::Closed {
                evict.push(*id);
            }
        }
        for id in evict.iter() {
            self.streams.remove(id);
        }
        self.evict_buf = evict;
    }

    /// Dispatch one fully-buffered frame. Returns true if the connection is now fatally closing.
    fn dispatch(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        // GOAWAY is excluded: it terminates the session, so node's statistics — which are
        // read off a session that stopped processing at that frame — never include it.
        if !matches!(hdr.typ(), Some(FrameType::GoAway)) {
            self.frames_received += 1;
            sink.on_frame_counters(self.frames_received, self.frames_sent);
        }
        // RFC 9113 §4.3 / §6.10: once a HEADERS/PUSH_PROMISE without END_HEADERS is received, the
        // ONLY permitted frame is a CONTINUATION for that same stream until the block completes.
        // Checked before structural validation: a malformed non-CONTINUATION frame mid-block is a
        // connection error (§6.2), not the stream error its own size rule would produce.
        if self.continuation_stream != 0 {
            let is_continuation = matches!(hdr.typ(), Some(FrameType::Continuation));
            if !is_continuation || hdr.stream_id != self.continuation_stream {
                self.send_go_away(
                    sink,
                    ErrorCode::ProtocolError,
                    b"expected CONTINUATION frame",
                );
                return true;
            }
        }

        // §4.2/§6 structural validation (length bounds, stream-id rule, fixed sizes).
        match wire::validate_header(hdr, self.local_settings.max_frame_size) {
            wire::HeaderValidation::Ok => {}
            wire::HeaderValidation::ConnectionError(code) => {
                self.send_go_away(sink, code, b"frame validation failed");
                return true;
            }
            wire::HeaderValidation::StreamError { id, code } => {
                self.send_rst_stream(sink, id, code);
                return false;
            }
        }

        if matches!(hdr.typ(), Some(FrameType::Continuation)) && self.continuation_stream == 0 {
            // §6.10: a CONTINUATION with no header block in progress is a connection PROTOCOL_ERROR.
            self.send_go_away(
                sink,
                ErrorCode::ProtocolError,
                b"unexpected CONTINUATION frame",
            );
            return true;
        }

        match hdr.typ() {
            Some(FrameType::Settings) => self.handle_settings(sink, hdr, payload),
            Some(FrameType::Ping) => self.handle_ping(sink, hdr, payload),
            Some(FrameType::GoAway) => self.handle_go_away(sink, payload),
            Some(FrameType::WindowUpdate) => self.handle_window_update(sink, hdr, payload),
            Some(FrameType::Headers) => self.handle_headers(sink, hdr, payload),
            Some(FrameType::Continuation) => self.handle_continuation(sink, hdr, payload),
            Some(FrameType::Data) => self.handle_data(sink, hdr, payload),
            Some(FrameType::RstStream) => self.handle_rst_stream(sink, hdr, payload),
            Some(FrameType::PushPromise) => self.handle_push_promise(sink, hdr, payload),
            Some(FrameType::AltSvc) => self.handle_altsvc(sink, hdr, payload),
            Some(FrameType::Origin) => self.handle_origin(sink, hdr, payload),
            // PRIORITY has no scheduling effect here; structurally validated above, otherwise ignored.
            Some(FrameType::Priority) => false,
            // §4.1: unknown frame types are silently discarded.
            _ => false,
        }
    }

    fn handle_settings(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        if wire::flags::has(hdr.flags, wire::flags::ACK) {
            if hdr.length != 0 {
                self.send_go_away(
                    sink,
                    ErrorCode::FrameSizeError,
                    b"SETTINGS ACK with payload",
                );
                return true;
            }
            // An ACK with no outstanding SETTINGS submission is unsolicited; nghttp2 silently
            // ignores it (it never reaches node's HandleSettingsFrame defensive branch). The
            // queue can also be empty during the legacy-parser bridge handoff (its
            // pending_settings_window_submissions is drained into this queue between batches),
            // so the first ACK falls back to local_settings rather than being dropped.
            if self.local_settings_acked && self.pending_local_settings_acks.is_empty() {
                return false;
            }
            self.local_settings_acked = true;
            // §6.5.3: this ACK acknowledges the oldest outstanding SETTINGS, whose values may
            // differ from the latest submission when several SETTINGS are in flight.
            let acked =
                self.pending_local_settings_acks
                    .pop_front()
                    .unwrap_or(PendingLocalSettings {
                        settings: self.local_settings,
                    });
            self.acked_local_initial_window = acked.settings.initial_window_size;
            // The peer has acknowledged this submission: header-list enforcement may now use the
            // limit it carried.
            self.enforced_max_header_list_size = acked.settings.max_header_list_size;
            sink.on_local_settings(&acked.settings);
            return false;
        }
        // node's maxSettings (nghttp2 max_settings): refuse SETTINGS frames carrying more entries
        // than the session allows before applying or surfacing any of them.
        if (payload.len() / 6) as u32 > self.max_settings {
            self.send_go_away(
                sink,
                ErrorCode::EnhanceYourCalm,
                b"SETTINGS: too many settings entries",
            );
            return true;
        }
        // §6.5.2: validate value ranges before applying.
        if let Some(code) = settings::validate_payload(payload) {
            self.send_go_away(sink, code, b"SETTINGS value out of range");
            return true;
        }
        let old_table = self.remote_settings.header_table_size;
        let old_initial_window = self.remote_settings.initial_window_size;
        let mut i = 0;
        while i + 6 <= payload.len() {
            let id = u16::from_be_bytes([payload[i], payload[i + 1]]);
            let value = u32::from_be_bytes([
                payload[i + 2],
                payload[i + 3],
                payload[i + 4],
                payload[i + 5],
            ]);
            if let Some(sid) = SettingId::from_u16(id) {
                // RFC 8441 §3 (and nghttp2): once SETTINGS_ENABLE_CONNECT_PROTOCOL has been
                // enabled, the peer must not disable it again — doing so is a connection error.
                if sid == SettingId::EnableConnectProtocol
                    && value == 0
                    && self.remote_settings.enable_connect_protocol == 1
                {
                    self.send_go_away(
                        sink,
                        ErrorCode::ProtocolError,
                        b"SETTINGS: server attempted to disable enableConnectProtocol",
                    );
                    return true;
                }
                self.remote_settings.apply(sid, value);
            } else {
                sink.on_remote_custom_setting(id, value);
            }
            i += 6;
        }
        // The peer's HEADER_TABLE_SIZE governs OUR encoder; queue a 6.3 size update.
        if self.remote_settings.header_table_size != old_table {
            self.hpack
                .queue_encoder_capacity(self.remote_settings.header_table_size);
        }
        // 6.9.2: a change to SETTINGS_INITIAL_WINDOW_SIZE adjusts every non-closed stream's send
        // window by the delta (the connection window is not affected).
        if self.remote_settings.initial_window_size != old_initial_window {
            let delta = self.remote_settings.initial_window_size as i64 - old_initial_window as i64;
            for (_, s) in self.streams.iter_mut() {
                if s.state != State::Closed {
                    s.send_window.apply_initial_delta(delta);
                }
            }
        }
        let snapshot = self.remote_settings;
        sink.on_remote_settings(&snapshot);
        self.send_settings_ack(sink);
        if self.note_outbound_ack(sink) {
            return true;
        }
        false
    }

    /// The embedder confirms its outbound buffer is fully drained to the
    /// transport: reset the outbound-ACK-queue counter (mirrors nghttp2's
    /// per-send decrement, coarsened to whole-buffer drains). Never called
    /// from receive() itself so a peer that never reads cannot reset it.
    pub fn note_outbound_drained(&mut self) {
        self.obq_ack_pending = 0;
    }

    /// Bound queued PING/SETTINGS ACKs behind a non-reading peer — nghttp2's
    /// obq_flood_counter_ / NGHTTP2_ERR_FLOODED. The counter is only reset by
    /// note_outbound_drained() when the transport actually drains, so detection
    /// is independent of recv() chunk size. Returns true when the session was
    /// torn down.
    fn note_outbound_ack(&mut self, sink: &impl Sink) -> bool {
        self.obq_ack_pending = self.obq_ack_pending.saturating_add(1);
        if self.obq_ack_pending < MAX_OUTBOUND_ACK_QUEUE {
            return false;
        }
        self.local_connection_error(
            sink,
            ErrorCode::EnhanceYourCalm,
            wire::lib_error::FLOODED,
            b"too many outbound control frames queued",
        );
        true
    }

    fn handle_ping(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        if wire::flags::has(hdr.flags, wire::flags::ACK) {
            sink.on_ping(payload, true);
            return false;
        }
        // copy the 8-byte payload before echoing (sink.write may reuse buffers).
        let mut echo = [0u8; 8];
        echo.copy_from_slice(&payload[..8]);
        self.send_ping_ack(sink, &echo);
        sink.on_ping(&echo, false);
        if self.note_outbound_ack(sink) {
            return true;
        }
        false
    }

    fn handle_go_away(&mut self, sink: &impl Sink, payload: &[u8]) -> bool {
        // §6.8: GOAWAY carries at least an 8-octet last-stream-id + error-code prefix.
        if payload.len() < 8 {
            self.send_go_away(sink, ErrorCode::FrameSizeError, b"GOAWAY too short");
            return true;
        }
        let last_stream_id =
            u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]) & 0x7fff_ffff;
        let code_raw = u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]);
        // nghttp2 (nghttp2_session_on_goaway_received): the Last-Stream-ID must refer to a stream
        // the *receiver* initiated (or 0) — for a server that means an even id, for a client an
        // odd id. Anything else is a connection PROTOCOL_ERROR.
        let initiated_locally = if self.is_server {
            last_stream_id.is_multiple_of(2)
        } else {
            !last_stream_id.is_multiple_of(2)
        };
        if last_stream_id > 0 && !initiated_locally {
            self.send_go_away(
                sink,
                ErrorCode::ProtocolError,
                b"GOAWAY: invalid last_stream_id",
            );
            return true;
        }
        self.going_away = true;
        sink.on_go_away(code_raw, last_stream_id, &payload[8..]);
        false
    }

    fn handle_window_update(
        &mut self,
        sink: &impl Sink,
        hdr: &FrameHeader,
        payload: &[u8],
    ) -> bool {
        let increment =
            u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]) & 0x7fff_ffff;
        // §6.9.1: a 0 increment is an error (connection error on stream 0).
        if increment == 0 {
            if hdr.stream_id == 0 {
                self.send_go_away(
                    sink,
                    ErrorCode::ProtocolError,
                    b"WINDOW_UPDATE with 0 increment",
                );
                return true;
            }
            // Locally-initiated stream RST: close the engine entry and tell the embedder, the
            // same as handle_data's Rst path, so the JS stream learns it was reset and the
            // entry is evicted.
            self.send_rst_stream(sink, hdr.stream_id, ErrorCode::ProtocolError);
            if let Some(s) = self.streams.get_mut(&hdr.stream_id) {
                s.state = State::Closed;
            }
            sink.on_stream_reset(hdr.stream_id, ErrorCode::ProtocolError.as_u32());
            return false;
        }
        if hdr.stream_id == 0 {
            // 6.9.1: the connection window must not exceed 2^31-1.
            if self.send_window.increase(increment).is_err() {
                self.send_go_away(
                    sink,
                    ErrorCode::FlowControlError,
                    b"connection flow-control window overflow",
                );
                return true;
            }
        } else if let Some(s) = self.streams.get_mut(&hdr.stream_id) {
            // 6.9.1: a per-stream overflow is a stream error, not a connection error.
            if s.send_window.increase(increment).is_err() {
                s.state = State::Closed;
                self.send_rst_stream(sink, hdr.stream_id, ErrorCode::FlowControlError);
                sink.on_stream_reset(hdr.stream_id, ErrorCode::FlowControlError.as_u32());
                return false;
            }
        }
        sink.on_window_update(hdr.stream_id, increment);
        false
    }

    // ---- Stream-level inbound ------------------------------------------

    /// RFC 9113 §6.2 HEADERS: strip padding/priority, then begin (or complete) the header block.
    fn handle_headers(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        let mut off = 0usize;
        let mut end = payload.len();

        if wire::flags::has(hdr.flags, wire::flags::PADDED) {
            if payload.is_empty() {
                self.send_go_away(sink, ErrorCode::FrameSizeError, b"HEADERS padded but empty");
                return true;
            }
            let pad = payload[0] as usize;
            off = 1;
            // §6.1: padding that spans the whole frame is a PROTOCOL_ERROR.
            if off + pad > end {
                self.send_go_away(sink, ErrorCode::ProtocolError, b"HEADERS padding too large");
                return true;
            }
            end -= pad;
        }
        if wire::flags::has(hdr.flags, wire::flags::PRIORITY) {
            // 4-byte stream dependency + 1-byte weight; ignored (no RFC 7540 prioritization).
            if off + 5 > end {
                self.send_go_away(
                    sink,
                    ErrorCode::FrameSizeError,
                    b"HEADERS priority truncated",
                );
                return true;
            }
            off += 5;
        }

        let end_stream = wire::flags::has(hdr.flags, wire::flags::END_STREAM);
        let end_headers = wire::flags::has(hdr.flags, wire::flags::END_HEADERS);

        // §5.1.1: a server's inbound HEADERS opens (or continues) a client-initiated odd stream.
        // Our receive window is sized by OUR advertised SETTINGS_INITIAL_WINDOW_SIZE; our send
        // window by the PEER's (§6.9.2).
        let send_init = self.remote_settings.initial_window_size;
        let recv_init = self.local_settings.initial_window_size;
        let is_new = !self.streams.contains_key(&hdr.stream_id);
        // RFC 9113 5.1.1: client-initiated streams use odd ids - a server receiving HEADERS that
        // would open an even-id stream is a connection PROTOCOL_ERROR. (Monotonicity is not
        // checked here: a client legitimately receives HEADERS on even promised ids that are
        // numerically below its own latest odd id.)
        if is_new && self.is_server && hdr.stream_id.is_multiple_of(2) {
            self.send_go_away(
                sink,
                ErrorCode::ProtocolError,
                b"invalid stream id for HEADERS",
            );
            return true;
        }
        let refused = is_new && self.is_server && !sink.can_open_stream();
        let mut stream_closed = false;
        if !refused {
            let cur_state = self
                .streams
                .entry(hdr.stream_id)
                .or_insert_with(|| Stream::new(send_init, recv_init))
                .state;
            let ev = if end_stream {
                stream::Event::RecvHeadersEndStream
            } else {
                stream::Event::RecvHeaders
            };
            match stream::transition(cur_state, ev) {
                Ok(next) => {
                    if let Some(s) = self.streams.get_mut(&hdr.stream_id) {
                        s.state = next;
                    }
                }
                Err(stream::TransitionError::Protocol) => {
                    self.send_go_away(
                        sink,
                        ErrorCode::ProtocolError,
                        b"HEADERS in invalid stream state",
                    );
                    return true;
                }
                Err(stream::TransitionError::StreamClosed) => {
                    // nghttp2 (session_on_*_headers_received): HEADERS for a stream whose remote
                    // half already ended (half-closed (remote)) is escalated to a CONNECTION error
                    // of type STREAM_CLOSED — node surfaces it as NghttpError "Stream was already
                    // closed or invalid" and tears the session down. A stream that closed for any
                    // other reason (e.g. we reset it and the peer's trailers were already in
                    // flight) keeps the conservative stream-level handling: the block is still
                    // decoded for HPACK sync (§4.3), then refused with RST_STREAM(STREAM_CLOSED)
                    // by finish_header_block.
                    if cur_state == State::HalfClosedRemote {
                        self.local_connection_error(
                            sink,
                            ErrorCode::StreamClosed,
                            wire::lib_error::STREAM_CLOSED,
                            b"HEADERS: stream closed",
                        );
                        return true;
                    }
                    stream_closed = true;
                }
            }
        }
        if is_new {
            // Must advance even for refused streams: §5.1 treats anything at or below the
            // high-water mark as having existed, so frames a client pipelined behind the
            // refused HEADERS (RST_STREAM especially) are tolerated instead of GOAWAY'd.
            if hdr.stream_id > self.last_stream_id {
                self.last_stream_id = hdr.stream_id;
            }
            if !refused {
                sink.on_stream_open(hdr.stream_id);
            }
        }

        self.header_block.clear();
        self.header_block.extend_from_slice(&payload[off..end]);
        self.header_end_stream = end_stream;
        self.header_flags = hdr.flags;
        self.header_target = hdr.stream_id;
        self.header_push_parent = 0;
        // Only a server receives request blocks via HEADERS; on a client every response block
        // looks "new" (the engine only tracks inbound-created streams), so without this gate it
        // would be misclassified as a request. PUSH_PROMISE sets the flag itself.
        self.header_is_request = self.is_server && is_new;
        self.header_stream_closed = stream_closed;
        self.header_stream_refused = refused;
        if !end_headers {
            self.continuation_stream = hdr.stream_id;
            return false;
        }
        self.finish_header_block(sink)
    }

    /// RFC 9113 §6.10 CONTINUATION: append the fragment; complete the block on END_HEADERS.
    fn handle_continuation(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        // dispatch() already enforced that we are assembling this exact stream.
        // Cap the reassembled block at the header-list limit (floored so tiny custom settings
        // don't reject normal blocks): HPACK output is never smaller than its input, so a
        // compressed block already past max_header_list_size can only decode past it too —
        // tearing down here is safe for every legitimate block and bounds memory against
        // CONTINUATION floods. node itself never errors on this (nghttp2 tolerates far more,
        // verified on node v26.3.0) — this is deliberate hardening, covered by the
        // maxHeaderListSize test in node-http2.test.js.
        let cap = (self.enforced_max_header_list_size as usize).max(65536);
        if self.header_block.len().saturating_add(payload.len()) > cap {
            // nghttp2's NGHTTP2_MAX_HEADERSLEN (65536) overflow returns NGHTTP2_ERR_HEADER_COMP,
            // which node surfaces as a session COMPRESSION_ERROR.
            self.send_go_away(sink, ErrorCode::CompressionError, b"header block too large");
            return true;
        }
        self.header_block.extend_from_slice(payload);
        if !wire::flags::has(hdr.flags, wire::flags::END_HEADERS) {
            return false;
        }
        self.finish_header_block(sink)
    }

    /// Decode the assembled header block (HPACK) and dispatch each field, then finalize. The whole
    /// block is always decoded so the connection-scoped HPACK table stays in sync (§4.3). Works for
    /// both a normal HEADERS block and a PUSH_PROMISE block (header_push_parent != 0).
    fn finish_header_block(&mut self, sink: &impl Sink) -> bool {
        self.continuation_stream = 0;
        let target = self.header_target;
        let push_parent = self.header_push_parent;
        // Surface the push reservation before its request headers so the embedder can create the
        // pushed stream object that the on_header calls populate.
        if push_parent != 0 {
            sink.on_push_promise(push_parent, target);
        }
        let block = std::mem::take(&mut self.header_block);
        let stream_closed = std::mem::take(&mut self.header_stream_closed);
        let stream_refused = std::mem::take(&mut self.header_stream_refused);
        let mut off = 0usize;
        let mut fatal = false;
        // RFC 9113 §10.5.1: enforce SETTINGS_MAX_HEADER_LIST_SIZE (uncompressed size: name + value
        // + 32 per field). The whole block is still decoded so the HPACK table stays in sync; the
        // stream is then refused without surfacing the oversized list. The peer-acknowledged
        // limit is used, never a still-in-flight submission (see enforced_max_header_list_size).
        let max_list_size = self.enforced_max_header_list_size as usize;
        let max_pairs = self.max_header_list_pairs as usize;
        let mut list_size: usize = 0;
        let mut field_count: usize = 0;
        // RFC 9113 §8.1: a trailer section is the final header block on the stream — it must
        // carry END_STREAM and must not contain pseudo-header fields.
        let is_trailer = push_parent == 0
            && !stream_closed
            && self
                .streams
                .get(&target)
                .is_some_and(|s| s.recv_final_headers);
        let mut rejected = false;
        let mut malformed = is_trailer && !self.header_end_stream;
        let mut seen_regular = false;
        let mut seen_pseudo: u8 = 0;
        // Request-block state for the RFC 9113 §8.3.1 checks below (nghttp2's
        // nghttp2_http_on_request_headers): only an initial HEADERS block (or a PUSH_PROMISE
        // block) is a request; a later HEADERS on the same stream is a trailer section.
        let is_request = self.header_is_request;
        let mut saw_connect = false;
        let mut saw_host = false;
        let mut informational = false;
        let mut content_length: Option<u64> = None;
        while off < block.len() {
            match self.hpack.decode(&block[off..]) {
                Ok(h) => {
                    off += h.next;
                    list_size += h.name.len() + h.value.len() + 32;
                    field_count += 1;
                    if rejected || list_size > max_list_size || field_count > max_pairs {
                        rejected = true;
                        continue;
                    }
                    // HEADERS on a closed stream: decode for HPACK-table sync only (§4.3); the
                    // fields are never surfaced.
                    if stream_closed || stream_refused {
                        continue;
                    }
                    // RFC 9113 §8.2.1/§8.2.2: connection-specific fields, a pseudo-header following a
                    // regular field, a repeated or unknown pseudo-header, or `te` with a value other
                    // than "trailers" make the header block malformed.
                    if !malformed {
                        let name_b: &[u8] = h.name;
                        let value_b: &[u8] = h.value;
                        // RFC 9113 §8.2.1: field names must be lowercase token characters and
                        // values must not contain NUL/CR/LF — otherwise the block is malformed
                        // (CR/LF in a surfaced value is a request-smuggling vector when the
                        // application proxies to HTTP/1).
                        if crate::api::h2_frame_parser_body::is_malformed_field_name(name_b)
                            || crate::api::h2_frame_parser_body::is_malformed_field_value(value_b)
                        {
                            malformed = true;
                        } else if let Some(rest) = name_b.strip_prefix(b":") {
                            let bit: u8 = match rest {
                                b"method" => pseudo::METHOD,
                                b"scheme" => pseudo::SCHEME,
                                b"authority" => pseudo::AUTHORITY,
                                b"path" => pseudo::PATH,
                                b"status" => pseudo::STATUS,
                                b"protocol" => pseudo::PROTOCOL,
                                _ => pseudo::UNKNOWN,
                            };
                            // 8.3.1: requests never carry :status - a server seeing it inbound is
                            // a malformed block. (The client direction also constrains pseudo
                            // headers, but inbound PUSH_PROMISE blocks legitimately carry request
                            // pseudo-headers, so that check needs the push context first.)
                            let wrong_direction = self.is_server && rest == b"status";
                            // RFC 8441 §4: :protocol is only valid when SETTINGS_ENABLE_CONNECT_PROTOCOL
                            // has been enabled by this endpoint. nghttp2 (and so node) checks the
                            // submitted local value here, not the ACKed one — so a request that arrives
                            // after a server has set enableConnectProtocol back to false is rejected at
                            // the protocol level and never reaches the JS 'stream' handler
                            // (test-http2-connect-method-extended-cant-turn-off).
                            let protocol_disabled = self.is_server
                                && rest == b"protocol"
                                && self.local_settings.enable_connect_protocol == 0;
                            // nghttp2 (check_pseudo_header) treats an empty pseudo-header value as
                            // malformed, so `:path: ""` never counts as a present :path (§8.3.1:
                            // `:path` "MUST NOT be empty" for http/https).
                            if seen_regular
                                || bit == pseudo::UNKNOWN
                                || (seen_pseudo & bit) != 0
                                || wrong_direction
                                || protocol_disabled
                                || is_trailer
                                || value_b.is_empty()
                            {
                                malformed = true;
                            }
                            if rest == b"status" && value_b.len() == 3 && value_b[0] == b'1' {
                                informational = true;
                            }
                            seen_pseudo |= bit;
                            if rest == b"method" && value_b == b"CONNECT" {
                                saw_connect = true;
                            }
                        } else {
                            seen_regular = true;
                            match name_b {
                                b"connection" | b"keep-alive" | b"proxy-connection"
                                | b"transfer-encoding" | b"upgrade" => malformed = true,
                                b"host" if is_request => saw_host = true,
                                b"te" => {
                                    // RFC 9110 10.1.4: field values are case-insensitive.
                                    if !value_b.eq_ignore_ascii_case(b"trailers") {
                                        malformed = true;
                                    }
                                }
                                b"content-length" => match parse_content_length(value_b) {
                                    Some(n) if content_length.is_none() => {
                                        content_length = Some(n);
                                    }
                                    _ => malformed = true,
                                },
                                _ => {}
                            }
                        }
                    }
                    if malformed {
                        continue;
                    }
                    sink.on_header(target, h.name, h.value, h.never_index);
                }
                Err(_) => {
                    // §4.3: a header-block decoding error is a connection COMPRESSION_ERROR.
                    self.send_go_away(sink, ErrorCode::CompressionError, b"HPACK decode error");
                    fatal = true;
                    break;
                }
            }
        }
        // restore the buffer's capacity for reuse
        self.header_block = block;
        self.header_block.clear();
        if fatal {
            return true;
        }
        if stream_refused {
            // node (node_http2.cc, Http2Session::OnBeginHeadersCallback): a stream refused for
            // the session memory budget is answered with RST_STREAM(ENHANCE_YOUR_CALM), which is
            // what node's own test-http2-max-session-memory asserts.
            self.send_rst_stream(sink, target, ErrorCode::EnhanceYourCalm);
            sink.on_stream_rejected(target);
            return false;
        }
        if stream_closed {
            // §5.1: HEADERS on a closed/half-closed-remote stream is a stream error of type
            // STREAM_CLOSED. The block was decoded above purely for HPACK-table sync.
            self.send_rst_stream(sink, target, ErrorCode::StreamClosed);
            if let Some(s) = self.streams.get_mut(&target) {
                s.state = State::Closed;
            }
            sink.on_stream_reset(target, ErrorCode::StreamClosed.as_u32());
            return false;
        }
        // RFC 9113 §8.3.1 (nghttp2_http_on_request_headers): a request block needs exactly one
        // non-empty :method, :scheme and :path plus an :authority or Host; plain CONNECT omits
        // :scheme/:path and carries :authority; extended CONNECT (:protocol, RFC 8441) requires
        // :method CONNECT and :authority. Without this a block with an empty or missing :path
        // reaches JS as a request with an empty url (no compliant peer can produce that shape).
        if is_request && !rejected && !malformed {
            use pseudo::{AUTHORITY, METHOD, PATH, PROTOCOL, SCHEME};
            let extended_connect = (seen_pseudo & PROTOCOL) != 0;
            malformed = if saw_connect && !extended_connect {
                (seen_pseudo & (SCHEME | PATH)) != 0 || (seen_pseudo & AUTHORITY) == 0
            } else {
                (seen_pseudo & (METHOD | SCHEME | PATH)) != (METHOD | SCHEME | PATH)
                    || ((seen_pseudo & AUTHORITY) == 0 && !saw_host)
                    || (extended_connect && (!saw_connect || (seen_pseudo & AUTHORITY) == 0))
            };
        }
        if push_parent == 0 && self.is_server && !malformed && !rejected {
            if let Some(s) = self.streams.get_mut(&target) {
                if !saw_connect && s.content_length.is_none() {
                    s.content_length = content_length;
                }
                if self.header_end_stream
                    && s.content_length
                        .is_some_and(|declared| declared != s.recv_body_bytes)
                {
                    malformed = true;
                }
            }
        }
        if malformed && !rejected {
            // node (Http2Session::OnInvalidFrame): every locally-rejected invalid frame counts
            // against maxSessionInvalidFrames; exceeding it tears the session down with
            // ERR_HTTP2_TOO_MANY_INVALID_FRAMES (same post-increment comparison as node).
            let count = self.invalid_frame_count;
            self.invalid_frame_count = count.saturating_add(1);
            if count > self.max_invalid_frames {
                self.terminated = true;
                sink.on_too_many_invalid_frames();
                return true;
            }
            // RFC 9113 §8.2: a malformed header block gets a stream error of type PROTOCOL_ERROR and
            // is not delivered to the application.
            self.send_rst_stream(sink, target, ErrorCode::ProtocolError);
            if let Some(s) = self.streams.get_mut(&target) {
                s.state = State::Closed;
            }
            sink.on_stream_reset(target, ErrorCode::ProtocolError.as_u32());
            sink.on_stream_rejected(target);
            return false;
        }
        if rejected {
            // Refuse the oversized header list with a stream error (matches the legacy engine and
            // node's ENHANCE_YOUR_CALM behavior).
            self.send_rst_stream(sink, target, ErrorCode::EnhanceYourCalm);
            if let Some(s) = self.streams.get_mut(&target) {
                s.state = State::Closed;
            }
            sink.on_stream_reset(target, ErrorCode::EnhanceYourCalm.as_u32());
            sink.on_stream_rejected(target);
            return false;
        }
        let end_stream = self.header_end_stream;
        if push_parent == 0
            && !informational
            && let Some(s) = self.streams.get_mut(&target)
        {
            s.recv_final_headers = true;
        }
        sink.on_headers_complete(target, end_stream, self.header_flags);
        if end_stream {
            let state = self.streams.get(&target).map(|s| s.state as u8);
            if let Some(state) = state {
                sink.on_stream_end(target, state);
            }
        }
        false
    }

    /// RFC 9113 §6.1 DATA: strip padding, enforce flow control, deliver, replenish windows.
    /// Start streaming a DATA frame whose payload is only partially available. Performs the
    /// same up-front validation and flow-control accounting as `handle_data` (the FULL declared
    /// frame length counts against the windows on receipt), delivers the available data bytes,
    /// and parks the remainder in `data_in_flight`.
    fn begin_streamed_data(
        &mut self,
        sink: &impl Sink,
        hdr: &FrameHeader,
        remaining: &[u8],
        padded: bool,
    ) -> StreamedDataStart {
        let payload_avail = &remaining[wire::FRAME_HEADER_SIZE..];
        let mut pad = 0usize;
        let mut off = 0usize;
        if padded {
            pad = payload_avail[0] as usize;
            off = 1;
            if 1 + pad > hdr.length as usize {
                self.send_go_away(sink, ErrorCode::ProtocolError, b"DATA padding too large");
                return StreamedDataStart::Fatal;
            }
        }
        let data_total = hdr.length as usize - off - pad;

        // §6.9: the whole declared frame counts against the connection recv window on receipt.
        self.recv_window.on_data(hdr.length as i64);
        if self.recv_window.is_overflowed() {
            self.send_go_away(
                sink,
                ErrorCode::FlowControlError,
                b"connection flow-control window exceeded",
            );
            return StreamedDataStart::Fatal;
        }

        if !self.streams.contains_key(&hdr.stream_id) && sink.is_local_stream(hdr.stream_id) {
            let send_init = self.remote_settings.initial_window_size;
            let recv_init = self.local_settings.initial_window_size;
            let mut s = Stream::new(send_init, recv_init);
            s.state = State::Open;
            self.streams.insert(hdr.stream_id, s);
        }
        let recv_limit = self
            .acked_local_initial_window
            .max(self.local_settings.initial_window_size) as i64;
        let mut discard = false;
        match self.streams.get_mut(&hdr.stream_id) {
            None => {
                self.send_rst_stream(sink, hdr.stream_id, ErrorCode::StreamClosed);
                sink.on_stream_reset(hdr.stream_id, ErrorCode::StreamClosed.as_u32());
                discard = true;
            }
            Some(st) => {
                if !stream::can_receive_data(st.state) {
                    self.send_rst_stream(sink, hdr.stream_id, ErrorCode::StreamClosed);
                    if let Some(st2) = self.streams.get_mut(&hdr.stream_id) {
                        st2.state = State::Closed;
                    }
                    sink.on_stream_reset(hdr.stream_id, ErrorCode::StreamClosed.as_u32());
                    discard = true;
                } else {
                    st.recv_window.on_data(hdr.length as i64);
                    if st.recv_window.is_overflowed_with(recv_limit) {
                        // nghttp2 (nghttp2_session_update_recv_stream_window_size): a peer that
                        // violates a stream's flow-control window terminates the whole session
                        // with FLOW_CONTROL_ERROR; node surfaces it as NghttpError "Protocol
                        // error" via its internal-GOAWAY path.
                        self.send_go_away(
                            sink,
                            ErrorCode::FlowControlError,
                            b"stream flow-control window exceeded",
                        );
                        return StreamedDataStart::Fatal;
                    } else {
                        st.recv_body_bytes = st.recv_body_bytes.saturating_add(data_total as u64);
                    }
                }
            }
        }

        let body_avail = &payload_avail[off..];
        let data_now = body_avail.len().min(data_total);
        if data_now > 0 && !discard {
            sink.on_data(hdr.stream_id, &body_avail[..data_now]);
        }
        let consumed_payload = off + body_avail.len();
        let inflight = DataInFlight {
            stream_id: hdr.stream_id,
            payload_remaining: (hdr.length as usize - consumed_payload) as u32,
            data_remaining: (data_total - data_now) as u32,
            end_stream: wire::flags::has(hdr.flags, wire::flags::END_STREAM),
            discard,
        };
        debug_assert!(inflight.payload_remaining > 0);
        self.data_in_flight = Some(inflight);
        // An incrementally-streamed DATA frame never reaches dispatch(); count it here,
        // once, when its header is accepted.
        self.frames_received += 1;
        sink.on_frame_counters(self.frames_received, self.frames_sent);
        StreamedDataStart::Consumed(wire::FRAME_HEADER_SIZE + consumed_payload)
    }

    /// Complete a streamed DATA frame: END_STREAM transition + notification, as the tail of
    /// `handle_data` does for whole frames.
    fn finish_streamed_data(&mut self, sink: &impl Sink, inflight: &DataInFlight) {
        if inflight.end_stream && !inflight.discard {
            if self.enforce_content_length(sink, inflight.stream_id) {
                return;
            }
            let state = match self.streams.get_mut(&inflight.stream_id) {
                Some(s) => {
                    if let Ok(next) = stream::transition(s.state, stream::Event::RecvEndStream) {
                        s.state = next;
                    }
                    Some(s.state as u8)
                }
                None => None,
            };
            if let Some(state) = state {
                sink.on_stream_end(inflight.stream_id, state);
            }
        }
    }

    fn handle_data(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        let mut off = 0usize;
        let mut end = payload.len();
        if wire::flags::has(hdr.flags, wire::flags::PADDED) {
            if payload.is_empty() {
                self.send_go_away(sink, ErrorCode::FrameSizeError, b"DATA padded but empty");
                return true;
            }
            let pad = payload[0] as usize;
            off = 1;
            if off + pad > end {
                self.send_go_away(sink, ErrorCode::ProtocolError, b"DATA padding too large");
                return true;
            }
            end -= pad;
        }
        let consumed = payload.len() as i64; // full frame counts against flow control, incl. padding

        // §6.9: the whole frame counts against the connection recv window.
        self.recv_window.on_data(consumed);
        if self.recv_window.is_overflowed() {
            self.send_go_away(
                sink,
                ErrorCode::FlowControlError,
                b"connection flow-control window exceeded",
            );
            return true;
        }

        // An empty DATA frame that does not end the stream carries no information and is only
        // useful for flooding: count it against the session's invalid-frame allowance (node's
        // maxSessionInvalidFrames; same post-increment comparison as node).
        if payload.is_empty() && !wire::flags::has(hdr.flags, wire::flags::END_STREAM) {
            let count = self.invalid_frame_count;
            self.invalid_frame_count = count.saturating_add(1);
            if count > self.max_invalid_frames {
                self.terminated = true;
                sink.on_too_many_invalid_frames();
                return true;
            }
        }

        // Per-stream flow control + state check, decided under a scoped borrow so the self.* calls
        // below don't alias the streams map.
        enum DataDecision {
            Rst(ErrorCode),
            FlowControlViolation,
            Deliver(u32),
        }
        // Transition shim: DATA for a stream the embedder opened locally (legacy outbound) — open it
        // here so it isn't mistaken for a closed/idle stream.
        if !self.streams.contains_key(&hdr.stream_id) && sink.is_local_stream(hdr.stream_id) {
            let send_init = self.remote_settings.initial_window_size;
            let recv_init = self.local_settings.initial_window_size;
            let mut s = Stream::new(send_init, recv_init);
            s.state = State::Open;
            self.streams.insert(hdr.stream_id, s);
        }
        let recv_limit = self
            .acked_local_initial_window
            .max(self.local_settings.initial_window_size) as i64;
        let decision = match self.streams.get_mut(&hdr.stream_id) {
            // §5.1: DATA for an unknown/closed stream is a STREAM_CLOSED error.
            None => DataDecision::Rst(ErrorCode::StreamClosed),
            Some(s) => {
                if !stream::can_receive_data(s.state) {
                    DataDecision::Rst(ErrorCode::StreamClosed)
                } else {
                    s.recv_window.on_data(consumed);
                    if s.recv_window.is_overflowed_with(recv_limit) {
                        DataDecision::FlowControlViolation
                    } else {
                        s.recv_body_bytes = s.recv_body_bytes.saturating_add((end - off) as u64);
                        DataDecision::Deliver(0)
                    }
                }
            }
        };
        let stream_inc = match decision {
            DataDecision::Rst(code) => {
                self.send_rst_stream(sink, hdr.stream_id, code);
                if let Some(s) = self.streams.get_mut(&hdr.stream_id) {
                    s.state = State::Closed;
                }
                // Surface the stream error (e.g. a peer protocol violation) to the embedder.
                sink.on_stream_reset(hdr.stream_id, code.as_u32());
                return false;
            }
            DataDecision::FlowControlViolation => {
                // nghttp2 (nghttp2_session_update_recv_stream_window_size): a stream flow-control
                // violation terminates the whole session with FLOW_CONTROL_ERROR; node surfaces
                // it as NghttpError "Protocol error" via its internal-GOAWAY path.
                self.send_go_away(
                    sink,
                    ErrorCode::FlowControlError,
                    b"stream flow-control window exceeded",
                );
                return true;
            }
            DataDecision::Deliver(inc) => inc,
        };
        let _ = stream_inc;

        let end_stream = wire::flags::has(hdr.flags, wire::flags::END_STREAM);
        if end != off {
            sink.on_data(hdr.stream_id, &payload[off..end]);
        }

        // Window replenishment is deferred to the end of the receive() batch (replenish_windows):
        // re-opening the window per frame would both spam WINDOW_UPDATE and make a peer that
        // ignores flow control (sending a whole burst past the window in one batch) undetectable.

        if end_stream {
            if self.enforce_content_length(sink, hdr.stream_id) {
                return false;
            }
            let state = match self.streams.get_mut(&hdr.stream_id) {
                Some(s) => {
                    if let Ok(next) = stream::transition(s.state, stream::Event::RecvEndStream) {
                        s.state = next;
                    }
                    Some(s.state as u8)
                }
                None => None,
            };
            if let Some(state) = state {
                sink.on_stream_end(hdr.stream_id, state);
            }
        }
        false
    }

    /// RFC 9113 §8.1.1: once END_STREAM arrives, a request whose received DATA total contradicts
    /// its declared `content-length` is malformed. Resets the stream with PROTOCOL_ERROR instead
    /// of signalling end-of-stream and returns true if it did so.
    fn enforce_content_length(&mut self, sink: &impl Sink, stream_id: u32) -> bool {
        if !self.is_server {
            return false;
        }
        let mismatch = self.streams.get(&stream_id).is_some_and(|s| {
            s.content_length
                .is_some_and(|declared| declared != s.recv_body_bytes)
        });
        if !mismatch {
            return false;
        }
        self.send_rst_stream(sink, stream_id, ErrorCode::ProtocolError);
        if let Some(s) = self.streams.get_mut(&stream_id) {
            s.state = State::Closed;
        }
        sink.on_stream_reset(stream_id, ErrorCode::ProtocolError.as_u32());
        true
    }

    /// RFC 9113 §6.4 RST_STREAM.
    fn handle_rst_stream(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        let code_raw = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]);
        // §5.1: RST_STREAM on an idle (or never-seen) stream is a connection PROTOCOL_ERROR.
        let mut on_idle = match self.streams.get_mut(&hdr.stream_id) {
            Some(s) if s.state != State::Idle => {
                s.state = State::Closed;
                false
            }
            _ => true,
        };
        // Transition shim: a stream the embedder opened locally (legacy outbound) is not idle even
        // though this engine never saw its HEADERS go out.
        if on_idle && sink.is_local_stream(hdr.stream_id) {
            let send_init = self.remote_settings.initial_window_size;
            let recv_init = self.local_settings.initial_window_size;
            let s = self
                .streams
                .entry(hdr.stream_id)
                .or_insert_with(|| Stream::new(send_init, recv_init));
            s.state = State::Closed;
            on_idle = false;
        }
        // §5.1: a stream evicted after full close (per-request memory release) is
        // closed, not idle — a late RST_STREAM on it MUST be tolerated. Anything at or
        // below the highest stream id either layer has started has existed; the embedder's
        // mark covers locally-initiated streams this engine never saw HEADERS for.
        if on_idle
            && (hdr.stream_id <= self.last_stream_id
                || hdr.stream_id <= sink.highest_started_stream_id())
        {
            return false;
        }
        if on_idle {
            self.send_go_away(sink, ErrorCode::ProtocolError, b"RST_STREAM on idle stream");
            return true;
        }
        sink.on_stream_reset(hdr.stream_id, code_raw);
        false
    }

    /// RFC 9113 §6.6 PUSH_PROMISE (clients only, §8.4): reserve the promised stream and assemble its
    /// request header block (decoded in finish_header_block, which fires on_push_promise first).
    fn handle_push_promise(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        // 8.4: a server must never receive PUSH_PROMISE.
        if self.is_server {
            self.send_go_away(
                sink,
                ErrorCode::ProtocolError,
                b"server received PUSH_PROMISE",
            );
            return true;
        }
        // 6.6: a client that disabled push (SETTINGS_ENABLE_PUSH=0) must treat the receipt of a
        // PUSH_PROMISE as a connection error of type PROTOCOL_ERROR.
        if self.local_settings.enable_push == 0 {
            self.send_go_away(
                sink,
                ErrorCode::ProtocolError,
                b"PUSH_PROMISE with push disabled",
            );
            return true;
        }
        let mut off = 0usize;
        let mut end = payload.len();
        if wire::flags::has(hdr.flags, wire::flags::PADDED) {
            if payload.is_empty() {
                self.send_go_away(
                    sink,
                    ErrorCode::FrameSizeError,
                    b"PUSH_PROMISE padded but empty",
                );
                return true;
            }
            let pad = payload[0] as usize;
            off = 1;
            if off + pad > end {
                self.send_go_away(
                    sink,
                    ErrorCode::ProtocolError,
                    b"PUSH_PROMISE padding too large",
                );
                return true;
            }
            end -= pad;
        }
        if off + 4 > end {
            self.send_go_away(
                sink,
                ErrorCode::FrameSizeError,
                b"PUSH_PROMISE missing promised id",
            );
            return true;
        }
        let promised = u32::from_be_bytes([
            payload[off],
            payload[off + 1],
            payload[off + 2],
            payload[off + 3],
        ]) & 0x7fff_ffff;
        off += 4;
        // §5.1.1 / §8.4: server-initiated streams use even ids, never 0, and
        // cannot be reused.
        if promised == 0 || promised & 1 == 1 || self.streams.contains_key(&promised) {
            self.send_go_away(
                sink,
                ErrorCode::ProtocolError,
                b"PUSH_PROMISE invalid promised stream id",
            );
            return true;
        }

        // Reserve the promised (even) stream.
        let send_init = self.remote_settings.initial_window_size;
        let recv_init = self.local_settings.initial_window_size;
        let entry = self
            .streams
            .entry(promised)
            .or_insert_with(|| Stream::new(send_init, recv_init));
        entry.state = State::ReservedRemote;
        if promised > self.last_stream_id {
            self.last_stream_id = promised;
        }

        let end_headers = wire::flags::has(hdr.flags, wire::flags::END_HEADERS);
        self.header_block.clear();
        self.header_block.extend_from_slice(&payload[off..end]);
        self.header_end_stream = false; // PUSH_PROMISE carries a request; it never ends the stream
        self.header_flags = 0;
        self.header_target = promised;
        self.header_push_parent = hdr.stream_id;
        self.header_is_request = true;
        self.header_stream_closed = false;
        self.header_stream_refused = false;
        if !end_headers {
            self.continuation_stream = hdr.stream_id;
            return false;
        }
        self.finish_header_block(sink)
    }

    /// RFC 7838 §4 ALTSVC: optional 2-byte origin-length + origin, then the Alt-Svc field value.
    fn handle_altsvc(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        if payload.len() < 2 {
            return false; // malformed ALTSVC is ignored (§4)
        }
        let origin_len = u16::from_be_bytes([payload[0], payload[1]]) as usize;
        if 2 + origin_len > payload.len() {
            return false;
        }
        let origin = &payload[2..2 + origin_len];
        let value = &payload[2 + origin_len..];
        // RFC 7838 4 MUST-ignore rules: a server never accepts ALTSVC; on stream 0 the origin
        // must be present; on a request stream it must be empty (the stream's own origin applies).
        if self.is_server
            || (hdr.stream_id == 0 && origin.is_empty())
            || (hdr.stream_id != 0 && !origin.is_empty())
        {
            return false;
        }
        sink.on_altsvc(hdr.stream_id, origin, value);
        false
    }

    /// RFC 8336 §2 ORIGIN: a sequence of (2-byte length + origin) entries on stream 0.
    fn handle_origin(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        // §2.1: ORIGIN on a non-zero stream is ignored, and like ALTSVC it is server-to-client
        // only - a server receiving it must ignore it. The whole payload is delivered once; the
        // embedder iterates the (2-byte length, origin) entries and surfaces a single event.
        if hdr.stream_id != 0 || self.is_server {
            return false;
        }
        sink.on_origin(payload);
        false
    }

    // ---- Outbound stream API (called by the embedder) ------------------

    /// Begin a new outbound header block. Emits any pending §6.3 dynamic-table size update first.
    pub fn begin_header_block(&mut self) {
        self.enc_buf.clear();
        let mut tmp = [0u8; hpack::MAX_SIZE_UPDATE_BYTES];
        let n = self.hpack.take_pending_size_update(&mut tmp, 0);
        self.enc_buf.extend_from_slice(&tmp[..n]);
    }

    /// HPACK-encode one header field into the current block. Returns false on encode failure.
    pub fn encode_header(&mut self, name: &[u8], value: &[u8], never_index: bool) -> bool {
        let old = self.enc_buf.len();
        self.enc_buf.resize(old + name.len() + value.len() + 16, 0);
        match self
            .hpack
            .encode(name, value, never_index, &mut self.enc_buf, old)
        {
            Ok(n) => {
                self.enc_buf.truncate(old + n);
                true
            }
            Err(_) => {
                self.enc_buf.truncate(old);
                false
            }
        }
    }

    /// Emit the accumulated header block as a HEADERS frame, splitting into CONTINUATION frames when
    /// it exceeds the peer's max frame size (§4.3/§6.10), and advance the send-side stream state.
    pub fn send_header_block(&mut self, sink: &impl Sink, stream_id: u32, end_stream: bool) {
        let block = std::mem::take(&mut self.enc_buf);
        let max = (self.remote_settings.max_frame_size as usize).max(1);
        let total = block.len();

        let first_len = total.min(max);
        let mut flags = 0u8;
        if first_len == total {
            flags |= wire::flags::END_HEADERS;
        }
        if end_stream {
            flags |= wire::flags::END_STREAM;
        }
        self.write_frame(
            sink,
            FrameType::Headers,
            flags,
            stream_id,
            &block[..first_len],
        );
        let mut off = first_len;
        while off < total {
            let len = (total - off).min(max);
            let f = if off + len == total {
                wire::flags::END_HEADERS
            } else {
                0
            };
            self.write_frame(
                sink,
                FrameType::Continuation,
                f,
                stream_id,
                &block[off..off + len],
            );
            off += len;
        }
        self.enc_buf = block;
        self.enc_buf.clear();

        let send_init = self.remote_settings.initial_window_size;
        let recv_init = self.local_settings.initial_window_size;
        let s = self
            .streams
            .entry(stream_id)
            .or_insert_with(|| Stream::new(send_init, recv_init));
        let ev = if end_stream {
            stream::Event::SendHeadersEndStream
        } else {
            stream::Event::SendHeaders
        };
        if let Ok(next) = stream::transition(s.state, ev) {
            s.state = next;
        }
        if stream_id > self.last_stream_id {
            self.last_stream_id = stream_id;
        }
    }

    /// Send DATA honoring connection + stream send windows and the max frame size. Returns the
    /// number of bytes actually written; the caller queues and retries the remainder on
    /// WINDOW_UPDATE. END_STREAM is only set when the whole buffer is flushed in this call.
    pub fn send_data(
        &mut self,
        sink: &impl Sink,
        stream_id: u32,
        data: &[u8],
        end_stream: bool,
    ) -> usize {
        let conn_avail = self.send_window.available();
        let stream_avail = self
            .streams
            .get(&stream_id)
            .map(|s| s.send_window.available())
            .unwrap_or(0);
        let max_frame = self.remote_settings.max_frame_size as i64;
        let allowed = conn_avail.min(stream_avail).min(max_frame).max(0) as usize;
        let to_send = allowed.min(data.len());
        let send_all = to_send == data.len();

        // Nothing can move right now (and this isn't a bare END_STREAM): caller queues it.
        if to_send == 0 && !(data.is_empty() && end_stream) {
            return 0;
        }

        let flags = if end_stream && send_all {
            wire::flags::END_STREAM
        } else {
            0
        };
        self.write_frame(sink, FrameType::Data, flags, stream_id, &data[..to_send]);
        self.send_window.consume(to_send as i64);
        if let Some(s) = self.streams.get_mut(&stream_id) {
            s.send_window.consume(to_send as i64);
            if end_stream && send_all {
                if let Ok(next) = stream::transition(s.state, stream::Event::SendEndStream) {
                    s.state = next;
                }
            }
        }
        to_send
    }

    /// Drop a stream entry whose lifecycle completed on the legacy outbound encoder.
    /// The outbound half does not run through this engine yet, so without this hook a
    /// completed request's entry would linger as HalfClosedRemote forever — the map (and
    /// the per-batch replenish/evict scans) would grow by one entry per request. Removal
    /// has the same observable behavior as scan-eviction of a Closed stream: late frames
    /// for the id take the unknown-stream path (RST STREAM_CLOSED, the §5.1 closed-state
    /// answer) and a late HEADERS re-opens a fresh entry.
    pub fn close_stream(&mut self, stream_id: u32) {
        self.streams.remove(&stream_id);
    }

    /// Replenish a single stream's receive window now (the embedder's reader resumed after a
    /// pause). Without this, a peer stalled on a zero stream window would only be released by the
    /// next inbound batch — which may never come, since the peer is the one waiting.
    pub fn replenish_stream(&mut self, sink: &impl Sink, stream_id: u32) {
        let inc = match self.streams.get_mut(&stream_id) {
            Some(s) if s.state != State::Closed && s.recv_window.needs_update() => {
                s.recv_window.take_update()
            }
            _ => return,
        };
        if inc > 0 {
            self.send_window_update(sink, stream_id, inc);
        }
    }

    /// Server-side: emit a PUSH_PROMISE on `parent_id` reserving `promised_id`, carrying the
    /// promised request headers staged via begin_header_block/encode_header (RFC 9113 §6.6).
    pub fn send_push_promise(&mut self, sink: &impl Sink, parent_id: u32, promised_id: u32) {
        let block = std::mem::take(&mut self.enc_buf);
        let max = (self.remote_settings.max_frame_size as usize).max(5);

        // First frame: PUSH_PROMISE = 4-byte promised id + (head of) the header block.
        let first_cap = max - 4;
        let first_len = block.len().min(first_cap);
        let mut first = Vec::with_capacity(4 + first_len);
        first.extend_from_slice(&(promised_id & 0x7fff_ffff).to_be_bytes());
        first.extend_from_slice(&block[..first_len]);
        let flags = if first_len == block.len() {
            wire::flags::END_HEADERS
        } else {
            0
        };
        self.write_frame(sink, FrameType::PushPromise, flags, parent_id, &first);

        let mut o = first_len;
        while o < block.len() {
            let len = (block.len() - o).min(max);
            let f = if o + len == block.len() {
                wire::flags::END_HEADERS
            } else {
                0
            };
            self.write_frame(
                sink,
                FrameType::Continuation,
                f,
                parent_id,
                &block[o..o + len],
            );
            o += len;
        }
        self.enc_buf = block;
        self.enc_buf.clear();

        let send_init = self.remote_settings.initial_window_size;
        let recv_init = self.local_settings.initial_window_size;
        let s = self
            .streams
            .entry(promised_id)
            .or_insert_with(|| Stream::new(send_init, recv_init));
        s.state = State::ReservedLocal;
        if promised_id > self.last_stream_id {
            self.last_stream_id = promised_id;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::vec::Vec;

    use std::cell::{Cell, RefCell};

    #[derive(Default)]
    struct CaptureSink {
        out: RefCell<Vec<u8>>,
        pings: RefCell<Vec<(Vec<u8>, bool)>>,
        remote_settings: Cell<u32>,
        goaway: Cell<Option<(u32, u32)>>,
        /// nghttp2-style lib error code from on_error (locally-detected connection errors).
        local_error: Cell<Option<i32>>,
        opens: RefCell<Vec<u32>>,
        headers: RefCell<Vec<(u32, Vec<u8>, Vec<u8>)>>,
        headers_done: RefCell<Vec<(u32, bool)>>,
        data: RefCell<Vec<(u32, Vec<u8>)>>,
        ended: RefCell<Vec<u32>>,
        resets: RefCell<Vec<(u32, u32)>>,
        pushes: RefCell<Vec<(u32, u32)>>,
        altsvc: RefCell<Vec<(u32, Vec<u8>, Vec<u8>)>>,
        origins: RefCell<Vec<Vec<u8>>>,
    }
    impl Sink for CaptureSink {
        fn write(&self, bytes: &[u8]) -> WriteResult {
            self.out.borrow_mut().extend_from_slice(bytes);
            WriteResult::Sent
        }
        fn on_error(&self, lib_code: i32, _l: u32, _d: &[u8]) {
            // send_go_away() reports through on_error; record it so the _is_goaway tests can assert.
            self.local_error.set(Some(lib_code));
        }
        fn on_local_settings(&self, _s: &Settings) {}
        fn on_remote_settings(&self, _s: &Settings) {
            self.remote_settings.set(self.remote_settings.get() + 1);
        }
        fn on_ping(&self, payload: &[u8], is_ack: bool) {
            self.pings.borrow_mut().push((payload.to_vec(), is_ack));
        }
        fn on_go_away(&self, c: u32, l: u32, _d: &[u8]) {
            self.goaway.set(Some((c, l)));
        }
        fn on_window_update(&self, _id: u32, _inc: u32) {}
        fn on_stream_open(&self, id: u32) {
            self.opens.borrow_mut().push(id);
        }
        fn on_header(&self, id: u32, name: &[u8], value: &[u8], _never: bool) {
            self.headers
                .borrow_mut()
                .push((id, name.to_vec(), value.to_vec()));
        }
        fn on_headers_complete(&self, id: u32, end_stream: bool, _flags: u8) {
            self.headers_done.borrow_mut().push((id, end_stream));
        }
        fn on_data(&self, id: u32, data: &[u8]) {
            self.data.borrow_mut().push((id, data.to_vec()));
        }
        fn on_stream_end(&self, id: u32, _state: u8) {
            self.ended.borrow_mut().push(id);
        }
        fn on_stream_reset(&self, id: u32, code: u32) {
            self.resets.borrow_mut().push((id, code));
        }
        fn on_push_promise(&self, parent: u32, promised: u32) {
            self.pushes.borrow_mut().push((parent, promised));
        }
        fn on_altsvc(&self, id: u32, origin: &[u8], value: &[u8]) {
            self.altsvc
                .borrow_mut()
                .push((id, origin.to_vec(), value.to_vec()));
        }
        fn on_origin(&self, origin: &[u8]) {
            self.origins.borrow_mut().push(origin.to_vec());
        }
    }

    /// Encode a header block with a standalone coder (mirrors a real peer's encoder).
    fn encode_block(pairs: &[(&[u8], &[u8])]) -> Vec<u8> {
        let mut coder = hpack::Coder::new(4096);
        let mut buf = vec![0u8; 4096];
        let mut off = 0usize;
        for (name, value) in pairs {
            off += coder.encode(name, value, false, &mut buf, off).unwrap();
        }
        buf.truncate(off);
        buf
    }

    fn frame(ftype: FrameType, flags: u8, stream_id: u32, payload: &[u8]) -> Vec<u8> {
        let mut v = vec![0u8; wire::FRAME_HEADER_SIZE];
        let hdr = FrameHeader {
            length: payload.len() as u32,
            frame_type: ftype as u8,
            flags,
            stream_id,
        };
        let mut hb = [0u8; wire::FRAME_HEADER_SIZE];
        hdr.write(&mut hb);
        v.copy_from_slice(&hb);
        v.extend_from_slice(payload);
        v
    }

    #[test]
    fn ping_is_acked_with_echo() {
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len(); // skip preface
        let payload = [1u8, 2, 3, 4, 5, 6, 7, 8];
        let f = frame(FrameType::Ping, 0, 0, &payload);
        let fed = c.receive(&sink, &f);
        assert_eq!(fed.consumed, f.len());
        // emitted a PING ACK echoing the payload
        let out = sink.out.borrow();
        assert_eq!(out[3], FrameType::Ping as u8);
        assert_eq!(out[4] & wire::flags::ACK, wire::flags::ACK);
        assert_eq!(
            &out[wire::FRAME_HEADER_SIZE..wire::FRAME_HEADER_SIZE + 8],
            &payload
        );
        assert_eq!(sink.pings.borrow().len(), 1);
    }

    #[test]
    fn window_update_zero_increment_on_conn_is_goaway() {
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len();
        let f = frame(FrameType::WindowUpdate, 0, 0, &[0, 0, 0, 0]);
        let fed = c.receive(&sink, &f);
        assert!(fed.fatal);
        assert_eq!(sink.local_error.get(), Some(wire::lib_error::PROTO));
    }

    #[test]
    fn settings_value_out_of_range_is_goaway() {
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len();
        // ENABLE_PUSH = 2 (invalid)
        let payload = [0u8, 0x02, 0, 0, 0, 2];
        let f = frame(FrameType::Settings, 0, 0, &payload);
        let fed = c.receive(&sink, &f);
        assert!(fed.fatal);
        assert_eq!(sink.local_error.get(), Some(wire::lib_error::PROTO));
    }

    #[test]
    fn headers_decode_and_open_stream() {
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len();
        let block = encode_block(&[
            (b":method", b"GET"),
            (b":scheme", b"http"),
            (b":path", b"/"),
            (b":authority", b"localhost"),
        ]);
        let flags = wire::flags::END_HEADERS | wire::flags::END_STREAM;
        let f = frame(FrameType::Headers, flags, 1, &block);
        let fed = c.receive(&sink, &f);
        assert!(!fed.fatal);
        assert_eq!(fed.consumed, f.len());
        assert_eq!(*sink.opens.borrow(), vec![1]);
        assert!(
            sink.headers
                .borrow()
                .iter()
                .any(|(id, n, v)| *id == 1 && n == b":method" && v == b"GET")
        );
        assert!(
            sink.headers
                .borrow()
                .iter()
                .any(|(id, n, v)| *id == 1 && n == b":path" && v == b"/")
        );
        assert_eq!(*sink.headers_done.borrow(), vec![(1, true)]);
        assert_eq!(*sink.ended.borrow(), vec![1]);
        assert_eq!(
            c.streams.get(&1).map(|s| s.state),
            Some(State::HalfClosedRemote)
        );
    }

    #[test]
    fn data_after_headers_is_delivered() {
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len();
        let block = encode_block(&[
            (b":method", b"POST"),
            (b":scheme", b"http"),
            (b":path", b"/"),
            (b":authority", b"localhost"),
        ]);
        // HEADERS without END_STREAM -> stream stays open for DATA.
        let h = frame(FrameType::Headers, wire::flags::END_HEADERS, 1, &block);
        c.receive(&sink, &h);
        assert_eq!(c.streams.get(&1).map(|s| s.state), Some(State::Open));

        let d = frame(FrameType::Data, wire::flags::END_STREAM, 1, b"hello");
        let fed = c.receive(&sink, &d);
        assert!(!fed.fatal);
        assert_eq!(*sink.data.borrow(), vec![(1, b"hello".to_vec())]);
        assert_eq!(*sink.ended.borrow(), vec![1]);
        assert_eq!(
            c.streams.get(&1).map(|s| s.state),
            Some(State::HalfClosedRemote)
        );
    }

    #[test]
    fn rst_stream_on_idle_is_goaway() {
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len();
        let f = frame(
            FrameType::RstStream,
            0,
            1,
            &ErrorCode::Cancel.as_u32().to_be_bytes(),
        );
        let fed = c.receive(&sink, &f);
        assert!(fed.fatal);
        assert_eq!(sink.local_error.get(), Some(wire::lib_error::PROTO));
    }

    #[test]
    fn headers_roundtrip_client_to_server() {
        // Client engine encodes + emits a HEADERS frame...
        let csink = CaptureSink::default();
        let mut client = Connection::new(false, Settings::default());
        client.begin_header_block();
        assert!(client.encode_header(b":method", b"GET", false));
        assert!(client.encode_header(b":scheme", b"http", false));
        assert!(client.encode_header(b":path", b"/x", false));
        assert!(client.encode_header(b":authority", b"localhost", false));
        client.send_header_block(&csink, 1, true);
        let wire_bytes = csink.out.borrow().clone();
        assert_eq!(
            client.streams.get(&1).map(|s| s.state),
            Some(State::HalfClosedLocal)
        );

        // ...and a server engine decodes the exact same bytes back to the original fields.
        let ssink = CaptureSink::default();
        let mut server = Connection::new(true, Settings::default());
        server.preface_received = wire::CONNECTION_PREFACE.len();
        let fed = server.receive(&ssink, &wire_bytes);
        assert!(!fed.fatal);
        assert_eq!(fed.consumed, wire_bytes.len());
        assert!(
            ssink
                .headers
                .borrow()
                .iter()
                .any(|(id, n, v)| *id == 1 && n == b":method" && v == b"GET")
        );
        assert!(
            ssink
                .headers
                .borrow()
                .iter()
                .any(|(id, n, v)| *id == 1 && n == b":path" && v == b"/x")
        );
        assert_eq!(*ssink.ended.borrow(), vec![1]);
    }

    #[test]
    fn push_promise_roundtrip_server_to_client() {
        // Server stages the promised request headers and emits PUSH_PROMISE on parent stream 1.
        let ssink = CaptureSink::default();
        let mut server = Connection::new(true, Settings::default());
        server.begin_header_block();
        assert!(server.encode_header(b":method", b"GET", false));
        assert!(server.encode_header(b":scheme", b"http", false));
        assert!(server.encode_header(b":path", b"/pushed", false));
        assert!(server.encode_header(b":authority", b"localhost", false));
        server.send_push_promise(&ssink, 1, 2);
        let bytes = ssink.out.borrow().clone();
        assert_eq!(
            server.streams.get(&2).map(|s| s.state),
            Some(State::ReservedLocal)
        );

        // Client receives it: on_push_promise(parent=1, promised=2) then the request headers.
        let csink = CaptureSink::default();
        let mut client = Connection::new(false, Settings::default());
        client.preface_received = wire::CONNECTION_PREFACE.len();
        let fed = client.receive(&csink, &bytes);
        assert!(!fed.fatal);
        assert_eq!(fed.consumed, bytes.len());
        assert_eq!(*csink.pushes.borrow(), vec![(1, 2)]);
        assert!(
            csink
                .headers
                .borrow()
                .iter()
                .any(|(id, n, v)| *id == 2 && n == b":path" && v == b"/pushed")
        );
        assert_eq!(
            client.streams.get(&2).map(|s| s.state),
            Some(State::ReservedRemote)
        );
    }

    #[test]
    fn server_rejects_inbound_push_promise() {
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len();
        // promised id + empty block
        let f = frame(
            FrameType::PushPromise,
            wire::flags::END_HEADERS,
            1,
            &[0, 0, 0, 2],
        );
        let fed = c.receive(&sink, &f);
        assert!(fed.fatal);
        assert_eq!(sink.local_error.get(), Some(wire::lib_error::PROTO));
    }

    #[test]
    fn send_data_respects_flow_control_window() {
        let sink = CaptureSink::default();
        let mut c = Connection::new(false, Settings::default());
        // Open a stream (send side) with a tiny peer window.
        c.begin_header_block();
        assert!(c.encode_header(b":method", b"POST", false));
        c.send_header_block(&sink, 1, false);
        sink.out.borrow_mut().clear();
        if let Some(s) = c.streams.get_mut(&1) {
            s.send_window = SendWindow::new(4);
        }
        c.send_window = SendWindow::new(4);
        // Only 4 of 10 bytes fit in the window.
        let sent = c.send_data(&sink, 1, b"0123456789", true);
        assert_eq!(sent, 4);
    }
}
