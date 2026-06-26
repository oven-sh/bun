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

/// Per-stream protocol state tracked by the engine.
pub struct Stream {
    pub state: State,
    pub send_window: SendWindow,
    pub recv_window: RecvWindow,
}

impl Stream {
    fn new(initial_send: u32, initial_recv: u32) -> Self {
        Stream {
            state: State::Idle,
            send_window: SendWindow::new(initial_send),
            recv_window: RecvWindow::new(initial_recv),
        }
    }
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

/// nghttp2's NGHTTP2_DEFAULT_STREAM_RESET_BURST / NGHTTP2_DEFAULT_STREAM_RESET_RATE: the
/// rapid-reset bucket holds `burst` tokens and regenerates `rate` per second.
pub const DEFAULT_RESET_BURST: u32 = 1000;
pub const DEFAULT_RESET_RATE: u32 = 33;

/// nghttp2's NGHTTP2_DEFAULT_MAX_INCOMING_RESERVED_STREAMS. Reserved streams are exempt from
/// SETTINGS_MAX_CONCURRENT_STREAMS (§5.1.2), so inbound PUSH_PROMISE reservations need their
/// own bound or a server can hold unbounded reserved state on a client.
pub const DEFAULT_MAX_RESERVED_REMOTE_STREAMS: u32 = 200;

/// Token bucket mirroring nghttp2's `nghttp2_ratelim`: `val` tokens available, regenerated at
/// `rate` per second (second-resolution monotonic timestamps) up to `burst`.
#[derive(Clone, Copy, Debug)]
struct RateLim {
    burst: u64,
    rate: u64,
    val: u64,
    tstamp: u64,
}

impl RateLim {
    fn new(burst: u64, rate: u64) -> Self {
        RateLim {
            burst,
            rate,
            val: burst,
            tstamp: 0,
        }
    }

    /// Regenerate tokens for the whole seconds elapsed since the last update. A timestamp that
    /// did not advance (or went backwards) regenerates nothing.
    fn update(&mut self, tstamp: u64) {
        if tstamp <= self.tstamp {
            self.tstamp = tstamp;
            return;
        }
        let elapsed = tstamp - self.tstamp;
        self.tstamp = tstamp;
        if self.val >= self.burst {
            return;
        }
        self.val = self
            .val
            .saturating_add(self.rate.saturating_mul(elapsed))
            .min(self.burst);
    }

    /// Take one token; false when the bucket is empty.
    fn drain(&mut self) -> bool {
        if self.val == 0 {
            return false;
        }
        self.val -= 1;
        true
    }
}

/// What the connection engine calls back into the embedder (the JSC binding) for. Methods take
/// `&self`: the JSC binding (H2FrameParser) is fully interior-mutable (Cell/JsCell) and its host
/// functions receive `&Self`, so it can own the `Connection` and pass itself as the sink without an
/// ownership cycle.
pub trait Sink {
    fn write(&self, bytes: &[u8]) -> WriteResult;
    /// `code` is the raw u32 from the wire so unknown error codes survive to JS (node parity).
    fn on_error(&self, code: u32, last_stream_id: u32, debug: &[u8]);
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
    /// Transition shim while the outbound path still flows through the embedder's legacy encoder:
    /// returns true if `stream_id` was initiated locally (HEADERS already sent by the embedder), so
    /// inbound frames for it are not treated as frames on an idle stream.
    fn is_local_stream(&self, _stream_id: u32) -> bool {
        false
    }
}

pub struct Connection {
    pub is_server: bool,

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
    /// INITIAL_WINDOW_SIZE values of sent-but-unACKed SETTINGS frames, in send order. §6.5.3:
    /// ACKs apply to outstanding SETTINGS in order, so each inbound ACK pops the front - the
    /// value the peer actually acknowledged - rather than assuming the latest submission.
    pub pending_local_window_acks: std::collections::VecDeque<u32>,
    invalid_frame_count: u32,
    /// Maximum number of entries accepted in a single inbound SETTINGS frame (node's maxSettings
    /// session option, nghttp2's max_settings; not a SETTINGS parameter). Frames carrying more
    /// entries are a connection error (ENHANCE_YOUR_CALM, like nghttp2's flood guard).
    pub max_settings: u32,
    /// Rapid-reset guard (CVE-2023-44487): a token bucket drained by each inbound RST_STREAM
    /// on a known stream, mirroring nghttp2's `stream_reset_rate_limit`. Running dry answers
    /// GOAWAY(ENHANCE_YOUR_CALM). Configured via `set_reset_rate_limit`.
    reset_ratelim: RateLim,
    /// Monotonic base for the rate limiter's second-resolution clock.
    epoch: std::time::Instant,
    /// Peer-initiated streams currently open or half-closed — the set that
    /// SETTINGS_MAX_CONCURRENT_STREAMS bounds (§5.1.2). Maintained incrementally by
    /// `set_stream_state`/`insert_stream`/`remove_stream` so the per-HEADERS check is O(1).
    peer_active_count: u32,
    /// Peer-initiated streams in reserved (remote): inbound PUSH_PROMISE reservations, which
    /// §5.1.2 exempts from the concurrency limit (bounded by `max_reserved_remote_streams`).
    peer_reserved_count: u32,
    /// Bound on `peer_reserved_count` (node's `maxReservedRemoteStreams` client option,
    /// nghttp2's max_incoming_reserved_streams). A PUSH_PROMISE past it is refused.
    pub max_reserved_remote_streams: u32,

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
    /// HEADERS arrived on a closed/half-closed-remote stream: the block is still decoded so the
    /// connection-scoped HPACK table stays in sync (§4.3), then refused with RST_STREAM
    /// (STREAM_CLOSED) instead of being dispatched.
    header_stream_closed: bool,
    /// `Some(code)` when the block's stream was refused before any state was allocated: still
    /// decoded for HPACK sync (§4.3), then answered with RST_STREAM(code), and
    /// on_stream_open/on_push_promise never fire. REFUSED_STREAM for a HEADERS past
    /// SETTINGS_MAX_CONCURRENT_STREAMS (§5.1.2); CANCEL for a PUSH_PROMISE past
    /// maxReservedRemoteStreams (the code node/nghttp2 answer, which the JS layer treats as
    /// a clean abort rather than a stream error).
    header_refused: Option<ErrorCode>,

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
            max_invalid_frames: 1000,
            acked_local_initial_window: 65_535,
            pending_local_window_acks: std::collections::VecDeque::new(),
            invalid_frame_count: 0,
            max_settings: 32,
            reset_ratelim: RateLim::new(DEFAULT_RESET_BURST as u64, DEFAULT_RESET_RATE as u64),
            epoch: std::time::Instant::now(),
            peer_active_count: 0,
            peer_reserved_count: 0,
            max_reserved_remote_streams: DEFAULT_MAX_RESERVED_REMOTE_STREAMS,
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
            header_stream_closed: false,
            header_refused: None,
            enc_buf: Vec::new(),
            replenish_buf: Vec::new(),
            evict_buf: Vec::new(),
            preface_received: 0,
            last_stream_id: 0,
            going_away: false,
        }
    }

    /// Configure the rapid-reset token bucket (node's `streamResetBurst` / `streamResetRate`
    /// session options). Idempotent: re-applying unchanged limits between read batches must
    /// not refill the bucket.
    pub fn set_reset_rate_limit(&mut self, burst: u32, rate: u32) {
        if self.reset_ratelim.burst == burst as u64 && self.reset_ratelim.rate == rate as u64 {
            return;
        }
        self.reset_ratelim = RateLim::new(burst as u64, rate as u64);
    }

    // ---- Stream accounting ---------------------------------------------

    /// §5.1.2: whether `state` counts toward SETTINGS_MAX_CONCURRENT_STREAMS. Open and both
    /// half-closed states count; idle, reserved, and closed do not.
    fn counts_active(state: State) -> bool {
        matches!(
            state,
            State::Open | State::HalfClosedLocal | State::HalfClosedRemote
        )
    }

    /// Streams the peer initiated: odd ids inbound to a server, even ids (pushes) to a client.
    fn is_peer_initiated(&self, stream_id: u32) -> bool {
        (stream_id & 1 == 1) == self.is_server
    }

    /// Keep the incremental peer-stream gauges exact across a state change (`State::Closed`
    /// doubles as "removed"). Every state write and removal routes through here, which is what
    /// lets the §5.1.2 check be O(1) instead of an O(streams) scan per HEADERS.
    fn account_peer_transition(&mut self, stream_id: u32, prev: State, next: State) {
        if prev == next || !self.is_peer_initiated(stream_id) {
            return;
        }
        if Self::counts_active(prev) {
            self.peer_active_count = self.peer_active_count.saturating_sub(1);
        } else if prev == State::ReservedRemote {
            self.peer_reserved_count = self.peer_reserved_count.saturating_sub(1);
        }
        if Self::counts_active(next) {
            self.peer_active_count += 1;
        } else if next == State::ReservedRemote {
            self.peer_reserved_count += 1;
        }
    }

    /// Set a stream's state through the gauge accounting. No-op for an unknown id.
    fn set_stream_state(&mut self, stream_id: u32, next: State) {
        let Some(s) = self.streams.get_mut(&stream_id) else {
            return;
        };
        let prev = s.state;
        s.state = next;
        self.account_peer_transition(stream_id, prev, next);
    }

    /// Insert a stream entry through the gauge accounting (a replaced entry counts as removed).
    fn insert_stream(&mut self, stream_id: u32, stream: Stream) {
        let next = stream.state;
        let prev = self
            .streams
            .insert(stream_id, stream)
            .map_or(State::Idle, |old| old.state);
        self.account_peer_transition(stream_id, prev, next);
    }

    /// Remove a stream entry through the gauge accounting.
    fn remove_stream(&mut self, stream_id: u32) {
        if let Some(s) = self.streams.remove(&stream_id) {
            self.account_peer_transition(stream_id, s.state, State::Closed);
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

    /// §3.4 client preface (24-octet magic), sent before our first SETTINGS.
    pub fn send_client_preface(&mut self, sink: &impl Sink) {
        sink.write(wire::CONNECTION_PREFACE);
    }

    pub fn send_settings(&mut self, sink: &impl Sink) {
        let mut buf = [0u8; Settings::STANDARD_COUNT * 6];
        let n = self.local_settings.pack_standard(&mut buf);
        self.pending_local_window_acks
            .push_back(self.local_settings.initial_window_size);
        self.write_frame(sink, FrameType::Settings, 0, 0, &buf[..n]);
    }

    fn send_settings_ack(&mut self, sink: &impl Sink) {
        self.write_frame(sink, FrameType::Settings, wire::flags::ACK, 0, &[]);
    }

    pub fn send_ping(&mut self, sink: &impl Sink, payload: [u8; 8]) {
        self.write_frame(sink, FrameType::Ping, 0, 0, &payload);
    }

    fn send_ping_ack(&mut self, sink: &impl Sink, payload: &[u8]) {
        self.write_frame(sink, FrameType::Ping, wire::flags::ACK, 0, payload);
    }

    pub fn send_go_away(&mut self, sink: &impl Sink, code: ErrorCode, debug: &[u8]) {
        self.going_away = true;
        let mut payload = Vec::with_capacity(8 + debug.len());
        payload.extend_from_slice(&self.last_stream_id.to_be_bytes());
        payload.extend_from_slice(&code.as_u32().to_be_bytes());
        payload.extend_from_slice(debug);
        self.write_frame(sink, FrameType::GoAway, 0, 0, &payload);
        let last = self.last_stream_id;
        sink.on_error(code.as_u32(), last, debug);
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

        // §3.4: server validates the 24-octet client preface before any frame.
        if self.is_server && self.preface_received < wire::CONNECTION_PREFACE.len() {
            let need = wire::CONNECTION_PREFACE.len() - self.preface_received;
            let avail = need.min(bytes.len());
            let expect =
                &wire::CONNECTION_PREFACE[self.preface_received..self.preface_received + avail];
            if &bytes[..avail] != expect {
                self.send_go_away(
                    sink,
                    ErrorCode::ProtocolError,
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
            if s.state != State::Closed && s.recv_window.needs_update() {
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
            self.remove_stream(*id);
        }
        self.evict_buf = evict;
    }

    /// Dispatch one fully-buffered frame. Returns true if the connection is now fatally closing.
    fn dispatch(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
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
            self.local_settings_acked = true;
            // §6.5.3: this ACK acknowledges the oldest outstanding SETTINGS, whose window size
            // may differ from the latest submission when several SETTINGS are in flight.
            self.acked_local_initial_window = self
                .pending_local_window_acks
                .pop_front()
                .unwrap_or(self.local_settings.initial_window_size);
            let snapshot = self.local_settings;
            sink.on_local_settings(&snapshot);
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
                self.remote_settings.apply(sid, value);
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
        false
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
            self.set_stream_state(hdr.stream_id, State::Closed);
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
                self.set_stream_state(hdr.stream_id, State::Closed);
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
        let existing_state = self.streams.get(&hdr.stream_id).map(|s| s.state);
        let is_new = existing_state.is_none();
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
        // §5.1.1 mirror for clients: a server only opens an even-id stream by RESERVING it
        // with PUSH_PROMISE, never with HEADERS. A new even id at a client is either one we
        // already released (a refused push whose response the server raced onto the wire —
        // closed per §5.1, answer RST(STREAM_CLOSED) without allocating) or one the server
        // never reserved at all (connection PROTOCOL_ERROR).
        let late_push = is_new && !self.is_server && hdr.stream_id.is_multiple_of(2);
        if late_push && hdr.stream_id > self.last_stream_id {
            self.send_go_away(
                sink,
                ErrorCode::ProtocolError,
                b"HEADERS on unreserved pushed stream",
            );
            return true;
        }
        // §5.1.2: a HEADERS that would move a peer-initiated stream into the active set (a new
        // request, or a push response promoting a reserved-remote stream) is refused once
        // `peer_active_count` reaches our SETTINGS_MAX_CONCURRENT_STREAMS; see header_refused.
        let opens_peer_stream = self.is_peer_initiated(hdr.stream_id)
            && matches!(existing_state, None | Some(State::ReservedRemote));
        let refused = if late_push {
            Some(ErrorCode::StreamClosed)
        } else if opens_peer_stream
            && self.peer_active_count >= self.local_settings.max_concurrent_streams
        {
            Some(ErrorCode::RefusedStream)
        } else {
            None
        };
        let mut stream_closed = false;
        if refused.is_some() {
            if hdr.stream_id > self.last_stream_id {
                self.last_stream_id = hdr.stream_id;
            }
        } else {
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
                Ok(next) => self.set_stream_state(hdr.stream_id, next),
                Err(stream::TransitionError::Protocol) => {
                    self.send_go_away(
                        sink,
                        ErrorCode::ProtocolError,
                        b"HEADERS in invalid stream state",
                    );
                    return true;
                }
                Err(stream::TransitionError::StreamClosed) => {
                    // §4.3: the field block must still be decompressed even though the frames are
                    // discarded - skipping it would desync the connection-scoped HPACK table and
                    // corrupt the next valid stream's headers. Buffer/decode the block, then
                    // finish_header_block refuses it with RST_STREAM(STREAM_CLOSED).
                    stream_closed = true;
                }
            }
            if is_new {
                if hdr.stream_id > self.last_stream_id {
                    self.last_stream_id = hdr.stream_id;
                }
                sink.on_stream_open(hdr.stream_id);
            }
        }

        self.header_block.clear();
        self.header_block.extend_from_slice(&payload[off..end]);
        self.header_end_stream = end_stream;
        self.header_flags = hdr.flags;
        self.header_target = hdr.stream_id;
        self.header_push_parent = 0;
        self.header_stream_closed = stream_closed;
        self.header_refused = refused;
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
        let cap = (self.local_settings.max_header_list_size as usize).max(65536);
        if self.header_block.len().saturating_add(payload.len()) > cap {
            self.send_go_away(sink, ErrorCode::EnhanceYourCalm, b"header block too large");
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
        let refused = std::mem::take(&mut self.header_refused);
        let mut off = 0usize;
        let mut fatal = false;
        // RFC 9113 §10.5.1: enforce SETTINGS_MAX_HEADER_LIST_SIZE (uncompressed size: name + value
        // + 32 per field). The whole block is still decoded so the HPACK table stays in sync; the
        // stream is then refused without surfacing the oversized list.
        let max_list_size = self.local_settings.max_header_list_size as usize;
        let max_pairs = self.max_header_list_pairs as usize;
        let mut list_size: usize = 0;
        let mut field_count: usize = 0;
        let mut rejected = false;
        let mut malformed = false;
        let mut seen_regular = false;
        let mut seen_pseudo: u8 = 0;
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
                    if stream_closed || refused.is_some() {
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
                                b"method" => 1,
                                b"scheme" => 2,
                                b"authority" => 4,
                                b"path" => 8,
                                b"status" => 16,
                                b"protocol" => 32,
                                _ => 64,
                            };
                            // 8.3.1: requests never carry :status - a server seeing it inbound is
                            // a malformed block. (The client direction also constrains pseudo
                            // headers, but inbound PUSH_PROMISE blocks legitimately carry request
                            // pseudo-headers, so that check needs the push context first.)
                            let wrong_direction = self.is_server && rest == b"status";
                            if seen_regular
                                || bit == 64
                                || (seen_pseudo & bit) != 0
                                || wrong_direction
                            {
                                malformed = true;
                            }
                            seen_pseudo |= bit;
                        } else {
                            seen_regular = true;
                            match name_b {
                                b"connection" | b"keep-alive" | b"proxy-connection"
                                | b"transfer-encoding" | b"upgrade" => malformed = true,
                                b"te" => {
                                    // RFC 9110 10.1.4: field values are case-insensitive.
                                    if !value_b.eq_ignore_ascii_case(b"trailers") {
                                        malformed = true;
                                    }
                                }
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
        if let Some(code) = refused {
            // The stream was refused before any state was allocated; answer with the code the
            // admission path chose. A refused push response still has its reserved-remote
            // entry; set_stream_state closes it.
            self.send_rst_stream(sink, target, code);
            self.set_stream_state(target, State::Closed);
            if code == ErrorCode::RefusedStream {
                // §5.1.2: past our concurrent-stream limit. Budgeted by on_stream_rejected
                // (maxSessionRejectedStreams) like the legacy JS-layer refusal.
                sink.on_stream_reset(target, code.as_u32());
                sink.on_stream_rejected(target);
            }
            return false;
        }
        if stream_closed {
            // §5.1: HEADERS on a closed/half-closed-remote stream is a stream error of type
            // STREAM_CLOSED. The block was decoded above purely for HPACK-table sync.
            self.send_rst_stream(sink, target, ErrorCode::StreamClosed);
            self.set_stream_state(target, State::Closed);
            sink.on_stream_reset(target, ErrorCode::StreamClosed.as_u32());
            return false;
        }
        if malformed && !rejected {
            // RFC 9113 §8.2: a malformed header block gets a stream error of type PROTOCOL_ERROR and
            // is not delivered to the application.
            self.send_rst_stream(sink, target, ErrorCode::ProtocolError);
            self.set_stream_state(target, State::Closed);
            sink.on_stream_reset(target, ErrorCode::ProtocolError.as_u32());
            sink.on_stream_rejected(target);
            return false;
        }
        if rejected {
            // Refuse the oversized header list with a stream error (matches the legacy engine and
            // node's ENHANCE_YOUR_CALM behavior).
            self.send_rst_stream(sink, target, ErrorCode::EnhanceYourCalm);
            self.set_stream_state(target, State::Closed);
            sink.on_stream_reset(target, ErrorCode::EnhanceYourCalm.as_u32());
            sink.on_stream_rejected(target);
            return false;
        }
        let end_stream = self.header_end_stream;
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
            self.insert_stream(hdr.stream_id, s);
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
                    self.set_stream_state(hdr.stream_id, State::Closed);
                    sink.on_stream_reset(hdr.stream_id, ErrorCode::StreamClosed.as_u32());
                    discard = true;
                } else {
                    st.recv_window.on_data(hdr.length as i64);
                    if st.recv_window.is_overflowed_with(recv_limit) {
                        self.send_rst_stream(sink, hdr.stream_id, ErrorCode::FlowControlError);
                        self.set_stream_state(hdr.stream_id, State::Closed);
                        sink.on_stream_reset(hdr.stream_id, ErrorCode::FlowControlError.as_u32());
                        discard = true;
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
        StreamedDataStart::Consumed(wire::FRAME_HEADER_SIZE + consumed_payload)
    }

    /// Complete a streamed DATA frame: END_STREAM transition + notification, as the tail of
    /// `handle_data` does for whole frames.
    fn finish_streamed_data(&mut self, sink: &impl Sink, inflight: &DataInFlight) {
        if inflight.end_stream && !inflight.discard {
            if let Some(cur) = self.streams.get(&inflight.stream_id).map(|s| s.state) {
                let next = stream::transition(cur, stream::Event::RecvEndStream).unwrap_or(cur);
                self.set_stream_state(inflight.stream_id, next);
                sink.on_stream_end(inflight.stream_id, next as u8);
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
                sink.on_too_many_invalid_frames();
                return true;
            }
        }

        // Per-stream flow control + state check, decided under a scoped borrow so the self.* calls
        // below don't alias the streams map.
        enum DataDecision {
            Rst(ErrorCode),
            Deliver(u32),
        }
        // Transition shim: DATA for a stream the embedder opened locally (legacy outbound) — open it
        // here so it isn't mistaken for a closed/idle stream.
        if !self.streams.contains_key(&hdr.stream_id) && sink.is_local_stream(hdr.stream_id) {
            let send_init = self.remote_settings.initial_window_size;
            let recv_init = self.local_settings.initial_window_size;
            let mut s = Stream::new(send_init, recv_init);
            s.state = State::Open;
            self.insert_stream(hdr.stream_id, s);
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
                        DataDecision::Rst(ErrorCode::FlowControlError)
                    } else {
                        DataDecision::Deliver(0)
                    }
                }
            }
        };
        let stream_inc = match decision {
            DataDecision::Rst(code) => {
                self.send_rst_stream(sink, hdr.stream_id, code);
                self.set_stream_state(hdr.stream_id, State::Closed);
                // Surface the stream error (e.g. a peer flow-control violation) to the embedder.
                sink.on_stream_reset(hdr.stream_id, code.as_u32());
                return false;
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
            if let Some(cur) = self.streams.get(&hdr.stream_id).map(|s| s.state) {
                let next = stream::transition(cur, stream::Event::RecvEndStream).unwrap_or(cur);
                self.set_stream_state(hdr.stream_id, next);
                sink.on_stream_end(hdr.stream_id, next as u8);
            }
        }
        false
    }

    /// RFC 9113 §6.4 RST_STREAM.
    fn handle_rst_stream(&mut self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        let code_raw = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]);
        // §5.1: RST_STREAM on an idle (or never-seen) stream is a connection PROTOCOL_ERROR.
        let mut on_idle = match self.streams.get(&hdr.stream_id).map(|s| s.state) {
            Some(state) if state != State::Idle => {
                self.set_stream_state(hdr.stream_id, State::Closed);
                false
            }
            _ => true,
        };
        // Transition shim: a stream the embedder opened locally (legacy outbound) is not idle even
        // though this engine never saw its HEADERS go out.
        if on_idle && sink.is_local_stream(hdr.stream_id) {
            let send_init = self.remote_settings.initial_window_size;
            let recv_init = self.local_settings.initial_window_size;
            self.streams
                .entry(hdr.stream_id)
                .or_insert_with(|| Stream::new(send_init, recv_init));
            self.set_stream_state(hdr.stream_id, State::Closed);
            on_idle = false;
        }
        // §5.1: a stream evicted after full close (per-request memory release) is
        // closed, not idle — a late RST_STREAM on it MUST be tolerated. Anything at or
        // below the highest stream id this connection has processed has existed.
        if on_idle && hdr.stream_id <= self.last_stream_id {
            return false;
        }
        if on_idle {
            self.send_go_away(sink, ErrorCode::ProtocolError, b"RST_STREAM on idle stream");
            return true;
        }
        // Rapid-reset guard (CVE-2023-44487): every inbound RST_STREAM on a known stream drains
        // one token from a bucket refilled at `streamResetRate`/s up to `streamResetBurst`, like
        // nghttp2's stream_reset_rate_limit. An empty bucket answers GOAWAY(ENHANCE_YOUR_CALM).
        if self.is_server {
            self.reset_ratelim.update(self.epoch.elapsed().as_secs());
            if !self.reset_ratelim.drain() {
                self.send_go_away(sink, ErrorCode::EnhanceYourCalm, b"stream reset flood");
                return true;
            }
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

        // Reserved-remote streams are exempt from SETTINGS_MAX_CONCURRENT_STREAMS (§5.1.2), so
        // inbound reservations are bounded separately (nghttp2's max_incoming_reserved_streams).
        // A refused push reserves nothing and never fires on_push_promise; see header_refused.
        let refused = self.peer_reserved_count >= self.max_reserved_remote_streams;
        if !refused {
            // Reserve the promised (even) stream.
            let send_init = self.remote_settings.initial_window_size;
            let recv_init = self.local_settings.initial_window_size;
            self.streams
                .entry(promised)
                .or_insert_with(|| Stream::new(send_init, recv_init));
            self.set_stream_state(promised, State::ReservedRemote);
        }
        if promised > self.last_stream_id {
            self.last_stream_id = promised;
        }

        let end_headers = wire::flags::has(hdr.flags, wire::flags::END_HEADERS);
        self.header_block.clear();
        self.header_block.extend_from_slice(&payload[off..end]);
        self.header_end_stream = false; // PUSH_PROMISE carries a request; it never ends the stream
        self.header_flags = 0;
        self.header_target = promised;
        self.header_push_parent = if refused { 0 } else { hdr.stream_id };
        self.header_stream_closed = false;
        // node/nghttp2 answer an excess PUSH_PROMISE with CANCEL, not REFUSED_STREAM: the
        // server's pushed stream must see a clean abort (rstCode 8), never a stream error.
        self.header_refused = refused.then_some(ErrorCode::Cancel);
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
        let cur = self
            .streams
            .entry(stream_id)
            .or_insert_with(|| Stream::new(send_init, recv_init))
            .state;
        let ev = if end_stream {
            stream::Event::SendHeadersEndStream
        } else {
            stream::Event::SendHeaders
        };
        if let Ok(next) = stream::transition(cur, ev) {
            self.set_stream_state(stream_id, next);
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
            let cur = s.state;
            if end_stream && send_all {
                if let Ok(next) = stream::transition(cur, stream::Event::SendEndStream) {
                    self.set_stream_state(stream_id, next);
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
        self.remove_stream(stream_id);
    }

    /// Locally reset a stream (RST_STREAM) and mark it closed.
    pub fn send_reset(&mut self, sink: &impl Sink, stream_id: u32, code: ErrorCode) {
        self.send_rst_stream(sink, stream_id, code);
        self.set_stream_state(stream_id, State::Closed);
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
        self.streams
            .entry(promised_id)
            .or_insert_with(|| Stream::new(send_init, recv_init));
        self.set_stream_state(promised_id, State::ReservedLocal);
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
        opens: RefCell<Vec<u32>>,
        rejected: RefCell<Vec<u32>>,
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
        fn on_error(&self, c: u32, l: u32, _d: &[u8]) {
            // send_go_away() reports through on_error; record it so the _is_goaway tests can assert.
            self.goaway.set(Some((c, l)));
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
        fn on_stream_rejected(&self, id: u32) {
            self.rejected.borrow_mut().push(id);
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

    /// Error codes of every RST_STREAM addressed to `stream_id` in the captured wire output.
    fn rst_codes_for(out: &[u8], stream_id: u32) -> Vec<u32> {
        let mut codes = Vec::new();
        let mut i = 0usize;
        while i + wire::FRAME_HEADER_SIZE <= out.len() {
            let h = FrameHeader::parse(&out[i..]);
            let total = wire::FRAME_HEADER_SIZE + h.length as usize;
            if h.frame_type == FrameType::RstStream as u8 && h.stream_id == stream_id {
                codes.push(u32::from_be_bytes([
                    out[i + 9],
                    out[i + 10],
                    out[i + 11],
                    out[i + 12],
                ]));
            }
            i += total;
        }
        codes
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
        assert_eq!(
            sink.goaway.get().map(|(code, _)| code),
            Some(ErrorCode::ProtocolError.as_u32())
        );
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
        assert_eq!(
            sink.goaway.get().map(|(code, _)| code),
            Some(ErrorCode::ProtocolError.as_u32())
        );
    }

    #[test]
    fn headers_decode_and_open_stream() {
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len();
        let block = encode_block(&[(b":method", b"GET"), (b":path", b"/")]);
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
        let block = encode_block(&[(b":method", b"POST"), (b":path", b"/")]);
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
        assert_eq!(
            sink.goaway.get().map(|(code, _)| code),
            Some(ErrorCode::ProtocolError.as_u32())
        );
    }

    #[test]
    fn headers_roundtrip_client_to_server() {
        // Client engine encodes + emits a HEADERS frame...
        let csink = CaptureSink::default();
        let mut client = Connection::new(false, Settings::default());
        client.begin_header_block();
        assert!(client.encode_header(b":method", b"GET", false));
        assert!(client.encode_header(b":path", b"/x", false));
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
        assert!(server.encode_header(b":path", b"/pushed", false));
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
        assert_eq!(
            sink.goaway.get().map(|(code, _)| code),
            Some(ErrorCode::ProtocolError.as_u32())
        );
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

    #[test]
    fn max_concurrent_streams_refuses_without_allocating() {
        let sink = CaptureSink::default();
        let mut local = Settings::default();
        local.max_concurrent_streams = 2;
        let mut c = Connection::new(true, local);
        c.preface_received = wire::CONNECTION_PREFACE.len();
        let block = encode_block(&[(b":method", b"GET"), (b":path", b"/")]);
        let flags = wire::flags::END_HEADERS; // leave open so streams count
        let mut bytes = Vec::new();
        for id in [1u32, 3, 5] {
            bytes.extend_from_slice(&frame(FrameType::Headers, flags, id, &block));
        }
        let fed = c.receive(&sink, &bytes);
        assert!(!fed.fatal);
        // Streams 1 and 3 opened; 5 was refused — never opened, never entered the map.
        assert_eq!(*sink.opens.borrow(), vec![1, 3]);
        assert_eq!(*sink.rejected.borrow(), vec![5]);
        assert!(
            sink.resets
                .borrow()
                .iter()
                .any(|(id, code)| *id == 5 && *code == ErrorCode::RefusedStream.as_u32())
        );
        assert!(c.streams.contains_key(&1));
        assert!(c.streams.contains_key(&3));
        assert!(!c.streams.contains_key(&5));
        // Refused stream's fields were not surfaced.
        assert!(!sink.headers.borrow().iter().any(|(id, _, _)| *id == 5));
        assert!(!sink.headers_done.borrow().iter().any(|(id, _)| *id == 5));
        // last_stream_id advanced past the refused id so a follow-up RST on 5 is closed, not idle.
        assert_eq!(c.last_stream_id, 5);
        // The §5.1.2 check reads the incremental gauge, not a map scan.
        assert_eq!(c.peer_active_count, 2);
        // Closing stream 1 releases a slot: stream 7 is admitted where 5 was refused.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&frame(
            FrameType::RstStream,
            0,
            1,
            &ErrorCode::Cancel.as_u32().to_be_bytes(),
        ));
        bytes.extend_from_slice(&frame(FrameType::Headers, flags, 7, &block));
        let fed = c.receive(&sink, &bytes);
        assert!(!fed.fatal);
        assert_eq!(*sink.opens.borrow(), vec![1, 3, 7]);
        assert_eq!(c.peer_active_count, 2);
        // An RST_STREAM echoed out for stream 5 with REFUSED_STREAM.
        assert_eq!(
            rst_codes_for(&sink.out.borrow(), 5),
            vec![ErrorCode::RefusedStream.as_u32()]
        );
    }

    #[test]
    fn refused_stream_keeps_hpack_in_sync() {
        // The refused block must still advance the decoder's dynamic table: a subsequent
        // accepted stream that depends on that state would otherwise fail to decode.
        let sink = CaptureSink::default();
        let mut local = Settings::default();
        local.max_concurrent_streams = 1;
        let mut c = Connection::new(true, local);
        c.preface_received = wire::CONNECTION_PREFACE.len();

        // One encoder for the whole connection (dynamic table is connection-scoped).
        let mut enc = hpack::Coder::new(4096);
        let mut buf = vec![0u8; 4096];
        let mut encode = |enc: &mut hpack::Coder, pairs: &[(&[u8], &[u8])]| -> Vec<u8> {
            let mut off = 0usize;
            for (n, v) in pairs {
                off += enc.encode(n, v, false, &mut buf, off).unwrap();
            }
            buf[..off].to_vec()
        };

        let b1 = encode(&mut enc, &[(b":method", b"GET"), (b":path", b"/")]);
        // Stream 3 introduces a dynamic-table entry (x-k: v) the decoder must record even
        // though the stream is refused; stream 5 references it.
        let b3 = encode(
            &mut enc,
            &[(b":method", b"GET"), (b":path", b"/"), (b"x-k", b"v")],
        );
        let b5 = encode(
            &mut enc,
            &[(b":method", b"GET"), (b":path", b"/"), (b"x-k", b"v")],
        );

        let mut bytes = Vec::new();
        bytes.extend_from_slice(&frame(FrameType::Headers, wire::flags::END_HEADERS, 1, &b1));
        bytes.extend_from_slice(&frame(FrameType::Headers, wire::flags::END_HEADERS, 3, &b3));
        // Close stream 1 so 5 fits under the cap again.
        bytes.extend_from_slice(&frame(
            FrameType::RstStream,
            0,
            1,
            &ErrorCode::Cancel.as_u32().to_be_bytes(),
        ));
        let fed = c.receive(&sink, &bytes);
        assert!(!fed.fatal);
        assert_eq!(*sink.rejected.borrow(), vec![3]);

        let fed = c.receive(
            &sink,
            &frame(FrameType::Headers, wire::flags::END_HEADERS, 5, &b5),
        );
        assert!(!fed.fatal);
        // Stream 5 decoded correctly (x-k: v surfaced), proving the refused block advanced HPACK.
        assert!(
            sink.headers
                .borrow()
                .iter()
                .any(|(id, n, v)| *id == 5 && n == b"x-k" && v == b"v")
        );
        assert!(sink.goaway.get().is_none());
    }

    /// Pin a connection's rate-limiter clock in the future so a real wall-clock second tick
    /// cannot regenerate tokens mid-test (`Instant::elapsed` saturates to zero until then).
    /// The time-based refill is covered by its own tests.
    fn freeze_reset_clock(c: &mut Connection) {
        c.epoch = std::time::Instant::now() + std::time::Duration::from_secs(3600);
    }

    #[test]
    fn reset_rate_limiter_regenerates_per_second() {
        let mut rl = RateLim::new(4, 2);
        for _ in 0..4 {
            assert!(rl.drain());
        }
        assert!(!rl.drain());
        // The same timestamp regenerates nothing.
        rl.update(0);
        assert!(!rl.drain());
        // One elapsed second regenerates `rate` tokens.
        rl.update(1);
        assert!(rl.drain());
        assert!(rl.drain());
        assert!(!rl.drain());
        // Regeneration is capped at the burst.
        rl.update(1000);
        assert_eq!(rl.val, 4);
        // A clock regression regenerates nothing.
        rl.update(500);
        assert_eq!(rl.val, 4);
        for _ in 0..4 {
            assert!(rl.drain());
        }
        rl.update(400);
        assert!(!rl.drain());
    }

    #[test]
    fn rapid_reset_flood_trips_reset_burst() {
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len();
        c.set_reset_rate_limit(4, DEFAULT_RESET_RATE);
        freeze_reset_clock(&mut c);
        let block = encode_block(&[(b":method", b"GET"), (b":path", b"/")]);
        let cancel = ErrorCode::Cancel.as_u32().to_be_bytes();
        let mut bytes = Vec::new();
        // 8 HEADERS→RST cycles stay under the (default, huge) concurrency cap but exceed
        // the reset-burst budget of 4 in a single read.
        for i in 0..8u32 {
            let id = 1 + 2 * i;
            bytes.extend_from_slice(&frame(
                FrameType::Headers,
                wire::flags::END_HEADERS,
                id,
                &block,
            ));
            bytes.extend_from_slice(&frame(FrameType::RstStream, 0, id, &cancel));
        }
        let fed = c.receive(&sink, &bytes);
        assert!(fed.fatal);
        assert_eq!(
            sink.goaway.get().map(|(code, _)| code),
            Some(ErrorCode::EnhanceYourCalm.as_u32())
        );
        // invalid_frame_count is not touched by valid RST_STREAM frames.
        assert_eq!(c.invalid_frame_count, 0);
    }

    #[test]
    fn rapid_reset_paced_across_batches_still_trips() {
        // CVE-2023-44487: each HEADERS→RST cycle costs the server a full stream open and
        // teardown while never leaving a stream outstanding, so only a rate bound catches it.
        // Pacing the cycles one per read batch — with the embedder completing an unrelated
        // legitimate request (close_stream) between each — must not pay the budget down.
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len();
        c.set_reset_rate_limit(4, DEFAULT_RESET_RATE);
        freeze_reset_clock(&mut c);
        let block = encode_block(&[(b":method", b"GET"), (b":path", b"/")]);
        let cancel = ErrorCode::Cancel.as_u32().to_be_bytes();
        let mut tripped_at = None;
        for i in 0..64u32 {
            let attack = 1 + 4 * i;
            let legit = 3 + 4 * i;
            let mut bytes = Vec::new();
            bytes.extend_from_slice(&frame(
                FrameType::Headers,
                wire::flags::END_HEADERS,
                attack,
                &block,
            ));
            bytes.extend_from_slice(&frame(FrameType::RstStream, 0, attack, &cancel));
            bytes.extend_from_slice(&frame(
                FrameType::Headers,
                wire::flags::END_HEADERS | wire::flags::END_STREAM,
                legit,
                &block,
            ));
            let fed = c.receive(&sink, &bytes);
            if fed.fatal {
                tripped_at = Some(i);
                break;
            }
            // The embedder's handler-complete signal for the finished legitimate request,
            // drained before the next read batch. It must not regenerate a reset token.
            c.close_stream(legit);
        }
        // 4 tokens: the resets in batches 0..=3 are allowed, batch 4's answers the GOAWAY
        // (and aborts the rest of that batch, so only batches 0..=3 opened a legit stream).
        assert_eq!(tripped_at, Some(4));
        assert_eq!(
            sink.goaway.get().map(|(code, _)| code),
            Some(ErrorCode::EnhanceYourCalm.as_u32())
        );
        // The legitimate requests were opened normally and never refused or reset.
        assert_eq!(
            sink.opens.borrow().iter().filter(|id| *id % 4 == 3).count(),
            4
        );
        assert!(sink.rejected.borrow().is_empty());
        assert!(!sink.resets.borrow().iter().any(|(id, _)| id % 4 == 3));
    }

    #[test]
    fn reset_tokens_regenerate_between_batches() {
        // The bucket handle_rst_stream drains is the one `update` regenerates: exhaust the
        // burst, advance the limiter's clock one second, and the regenerated tokens admit
        // exactly `rate` more resets before the next one trips.
        let sink = CaptureSink::default();
        let mut c = Connection::new(true, Settings::default());
        c.preface_received = wire::CONNECTION_PREFACE.len();
        c.set_reset_rate_limit(4, 2);
        freeze_reset_clock(&mut c);
        let block = encode_block(&[(b":method", b"GET"), (b":path", b"/")]);
        let cancel = ErrorCode::Cancel.as_u32().to_be_bytes();
        let reset = |c: &mut Connection, id: u32| -> bool {
            let mut bytes = Vec::new();
            bytes.extend_from_slice(&frame(
                FrameType::Headers,
                wire::flags::END_HEADERS,
                id,
                &block,
            ));
            bytes.extend_from_slice(&frame(FrameType::RstStream, 0, id, &cancel));
            c.receive(&sink, &bytes).fatal
        };
        for i in 0..4u32 {
            assert!(!reset(&mut c, 1 + 2 * i));
        }
        assert_eq!(c.reset_ratelim.val, 0);
        c.reset_ratelim.update(c.reset_ratelim.tstamp + 1);
        assert_eq!(c.reset_ratelim.val, 2);
        assert!(!reset(&mut c, 9));
        assert!(!reset(&mut c, 11));
        assert!(reset(&mut c, 13));
        assert_eq!(
            sink.goaway.get().map(|(code, _)| code),
            Some(ErrorCode::EnhanceYourCalm.as_u32())
        );
    }

    #[test]
    fn push_promise_past_reserved_cap_is_refused() {
        // §5.1.2 exempts reserved streams from SETTINGS_MAX_CONCURRENT_STREAMS, so without a
        // separate cap a server could hold unbounded reserved state and pushed-stream objects
        // on a client (nghttp2 bounds this with max_incoming_reserved_streams). The bound is
        // the configurable `max_reserved_remote_streams` field (node's maxReservedRemoteStreams),
        // not a hardcoded constant.
        let sink = CaptureSink::default();
        let mut c = Connection::new(false, Settings::default());
        assert_eq!(
            c.max_reserved_remote_streams,
            DEFAULT_MAX_RESERVED_REMOTE_STREAMS
        );
        let cap = 3u32;
        c.max_reserved_remote_streams = cap;
        let block = encode_block(&[(b":method", b"GET"), (b":path", b"/")]);
        let mut bytes = Vec::new();
        for i in 0..=cap {
            let promised = 2 + 2 * i;
            let mut payload = Vec::with_capacity(4 + block.len());
            payload.extend_from_slice(&promised.to_be_bytes());
            payload.extend_from_slice(&block);
            bytes.extend_from_slice(&frame(
                FrameType::PushPromise,
                wire::flags::END_HEADERS,
                1,
                &payload,
            ));
        }
        let fed = c.receive(&sink, &bytes);
        assert!(!fed.fatal);
        let over = 2 + 2 * cap;
        // Exactly the cap was reserved; the one past it never entered the map, never fired
        // on_push_promise, never surfaced fields. node/nghttp2 answer the excess reservation
        // with RST_STREAM(CANCEL) - a clean abort, not a stream error - and it does NOT
        // consume the maxSessionRejectedStreams budget or reach the embedder at all.
        assert_eq!(c.peer_reserved_count, cap);
        assert_eq!(sink.pushes.borrow().len(), cap as usize);
        assert!(!sink.pushes.borrow().iter().any(|(_, p)| *p == over));
        assert!(!c.streams.contains_key(&over));
        assert!(!sink.headers.borrow().iter().any(|(id, _, _)| *id == over));
        assert!(sink.rejected.borrow().is_empty());
        assert!(sink.resets.borrow().is_empty());
        assert_eq!(
            rst_codes_for(&sink.out.borrow(), over),
            vec![ErrorCode::Cancel.as_u32()]
        );
        assert!(sink.goaway.get().is_none());
    }

    #[test]
    fn late_push_response_on_refused_reservation_is_stream_closed_not_a_new_stream() {
        // After a client refuses a PUSH_PROMISE (reserved-stream cap), the server may have
        // already raced a push-response HEADERS onto the wire for the promised id. That id was
        // released, never allocated: the response is §5.1 closed (RST STREAM_CLOSED, decoded
        // for HPACK sync only), never a brand-new inbound stream / on_stream_open.
        let sink = CaptureSink::default();
        let mut c = Connection::new(false, Settings::default());
        c.max_reserved_remote_streams = 1;
        let req = encode_block(&[(b":method", b"GET"), (b":path", b"/")]);
        let resp = encode_block(&[(b":status", b"200")]);
        let mut bytes = Vec::new();
        for promised in [2u32, 4] {
            let mut payload = Vec::with_capacity(4 + req.len());
            payload.extend_from_slice(&promised.to_be_bytes());
            payload.extend_from_slice(&req);
            bytes.extend_from_slice(&frame(
                FrameType::PushPromise,
                wire::flags::END_HEADERS,
                1,
                &payload,
            ));
        }
        // Push 4 was refused; its response still arrives from the server.
        bytes.extend_from_slice(&frame(
            FrameType::Headers,
            wire::flags::END_HEADERS,
            4,
            &resp,
        ));
        let fed = c.receive(&sink, &bytes);
        assert!(!fed.fatal);
        assert_eq!(*sink.pushes.borrow(), vec![(1, 2)]);
        assert!(sink.opens.borrow().is_empty());
        assert!(!c.streams.contains_key(&4));
        assert!(!sink.headers_done.borrow().iter().any(|(id, _)| *id == 4));
        // The refused reservation answered CANCEL, the raced response STREAM_CLOSED.
        assert_eq!(
            rst_codes_for(&sink.out.borrow(), 4),
            vec![ErrorCode::Cancel.as_u32(), ErrorCode::StreamClosed.as_u32()]
        );
        assert!(sink.goaway.get().is_none());
    }

    #[test]
    fn headers_on_unreserved_even_stream_at_client_is_protocol_error() {
        // §5.1.1: a server only opens even-id streams via PUSH_PROMISE. A HEADERS opening an
        // even id the client never saw reserved is a connection PROTOCOL_ERROR, not a new stream.
        let sink = CaptureSink::default();
        let mut c = Connection::new(false, Settings::default());
        let resp = encode_block(&[(b":status", b"200")]);
        let fed = c.receive(
            &sink,
            &frame(FrameType::Headers, wire::flags::END_HEADERS, 2, &resp),
        );
        assert!(fed.fatal);
        assert!(sink.opens.borrow().is_empty());
        assert_eq!(
            sink.goaway.get().map(|(code, _)| code),
            Some(ErrorCode::ProtocolError.as_u32())
        );
    }

    #[test]
    fn reserved_cap_raised_above_default_admits_more() {
        // Regression for the Node compat gap: maxReservedRemoteStreams set above the default
        // must actually raise the engine's bound (it was a hardcoded constant).
        let sink = CaptureSink::default();
        let mut c = Connection::new(false, Settings::default());
        c.max_reserved_remote_streams = DEFAULT_MAX_RESERVED_REMOTE_STREAMS + 1;
        let block = encode_block(&[(b":method", b"GET"), (b":path", b"/")]);
        let mut bytes = Vec::new();
        // One past the DEFAULT, but within the raised limit: every reservation is admitted.
        for i in 0..=DEFAULT_MAX_RESERVED_REMOTE_STREAMS {
            let promised = 2 + 2 * i;
            let mut payload = Vec::with_capacity(4 + block.len());
            payload.extend_from_slice(&promised.to_be_bytes());
            payload.extend_from_slice(&block);
            bytes.extend_from_slice(&frame(
                FrameType::PushPromise,
                wire::flags::END_HEADERS,
                1,
                &payload,
            ));
        }
        let fed = c.receive(&sink, &bytes);
        assert!(!fed.fatal);
        assert_eq!(
            c.peer_reserved_count,
            DEFAULT_MAX_RESERVED_REMOTE_STREAMS + 1
        );
        assert!(sink.rejected.borrow().is_empty());
        assert!(sink.resets.borrow().is_empty());
    }

    #[test]
    fn client_push_response_past_max_concurrent_is_refused() {
        // §5.1.2 applies to both roles: a push response promoting a reserved-remote stream to
        // half-closed enters the active set the client's SETTINGS_MAX_CONCURRENT_STREAMS bounds.
        let sink = CaptureSink::default();
        let mut local = Settings::default();
        local.max_concurrent_streams = 1;
        let mut c = Connection::new(false, local);
        let req = encode_block(&[(b":method", b"GET"), (b":path", b"/")]);
        let resp = encode_block(&[(b":status", b"200")]);
        let mut bytes = Vec::new();
        for promised in [2u32, 4] {
            let mut payload = Vec::with_capacity(4 + req.len());
            payload.extend_from_slice(&promised.to_be_bytes());
            payload.extend_from_slice(&req);
            bytes.extend_from_slice(&frame(
                FrameType::PushPromise,
                wire::flags::END_HEADERS,
                1,
                &payload,
            ));
        }
        // Both reservations are admitted: reserved streams are exempt from the limit.
        let fed = c.receive(&sink, &bytes);
        assert!(!fed.fatal);
        assert_eq!(c.peer_reserved_count, 2);
        assert_eq!(c.peer_active_count, 0);
        // The push response on stream 2 promotes it into the active set.
        let fed = c.receive(
            &sink,
            &frame(FrameType::Headers, wire::flags::END_HEADERS, 2, &resp),
        );
        assert!(!fed.fatal);
        assert_eq!((c.peer_active_count, c.peer_reserved_count), (1, 1));
        assert_eq!(
            c.streams.get(&2).map(|s| s.state),
            Some(State::HalfClosedLocal)
        );
        // The response on stream 4 would exceed maxConcurrentStreams=1: refused, and the
        // reserved entry it had is closed and evicted.
        let fed = c.receive(
            &sink,
            &frame(FrameType::Headers, wire::flags::END_HEADERS, 4, &resp),
        );
        assert!(!fed.fatal);
        assert_eq!((c.peer_active_count, c.peer_reserved_count), (1, 0));
        assert!(!c.streams.contains_key(&4));
        assert!(!sink.headers_done.borrow().iter().any(|(id, _)| *id == 4));
        assert_eq!(*sink.rejected.borrow(), vec![4]);
        assert!(
            sink.resets
                .borrow()
                .iter()
                .any(|(id, code)| *id == 4 && *code == ErrorCode::RefusedStream.as_u32())
        );
        assert!(sink.goaway.get().is_none());
    }
}
