//! The protocol state of one `node:http2` session. Methods take `&self`, because JS run by a callback or a write can call back in.

use super::field_checks::{BlockKind, FieldChecks};
use super::stream::{PaddingStrategy, RequestMethod, ResetBy, Stream, StreamTable, update};
use bun_http::lshpack;
use bun_http_types::h2::flow_control::{DEFAULT_WINDOW_SIZE, RecvWindow, SendWindow};
use bun_http_types::h2::frame::{
    self, CONNECTION_PREFACE, ErrorCode, FRAME_HEADER_SIZE, Frame, FrameHeader, FrameType,
    NextFrame, flags,
};
use bun_http_types::h2::header_block::{HeaderBlockAssembler, HeaderBlockError};
use bun_http_types::h2::settings::{Entries, SettingId, Settings};
use bun_http_types::h2::stream::{self, State};
use bun_ptr::JsCell;
use std::cell::Cell;
use std::collections::VecDeque;
use std::num::NonZeroU32;
use std::rc::Rc;

/// nghttp2's negative library error codes. JS builds node's `NghttpError` from them.
pub(crate) mod lib_error {
    pub(crate) const PROTO: i32 = -505;
    pub(crate) const STREAM_CLOSED: i32 = -510;
    pub(crate) const BAD_CLIENT_MAGIC: i32 = -903;
    pub(crate) const FLOODED: i32 = -904;
    pub(crate) const TOO_MANY_CONTINUATIONS: i32 = -905;
}

/// Outcome of feeding bytes: how many were consumed, and whether the connection is now closing.
#[derive(Clone, Copy, Debug)]
enum StreamedDataStart {
    Fatal,
    Consumed(usize),
}

enum DataAdmission {
    Fatal,
    /// The frame is for a closed stream, or was just answered with RST_STREAM.
    Discard,
    Deliver,
}

#[derive(Clone, Copy)]
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

/// Everything `finish_header_block` needs to know about a header block besides its bytes, fixed
/// by the HEADERS/PUSH_PROMISE frame that opened it.
#[derive(Clone, Copy)]
struct HeaderBlockMeta {
    /// The stream id the block belongs to (the promised id for a PUSH_PROMISE).
    target: u32,
    /// The parent stream id when the block arrived in a PUSH_PROMISE; `None` for a HEADERS block.
    push_parent: Option<NonZeroU32>,
    /// The original HEADERS frame flags (passed to on_headers_complete; 0 for PUSH_PROMISE).
    flags: u8,
    end_stream: bool,
    /// The block opens a new inbound stream (a request block on the server, a PUSH_PROMISE request
    /// block on the client). False for a later HEADERS on the same stream (a trailer section),
    /// which RFC 9113 §8.1 forbids from carrying pseudo-headers and which must not be held to the
    /// request pseudo-header requirements of §8.3.1.
    is_request: bool,
    disposition: BlockDisposition,
}

/// What becomes of a header block once it is complete. Every variant still decodes the whole
/// block so the connection-scoped HPACK table stays in sync (§4.3); only `Deliver` surfaces it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum BlockDisposition {
    Deliver,
    /// HEADERS arrived on a closed stream: dropped without a reply (nghttp2's IGN_HEADER_BLOCK).
    StreamClosed,
    /// The stream would go over SETTINGS_MAX_CONCURRENT_STREAMS. RST_STREAM(REFUSED_STREAM) has been sent.
    OverStreamLimit,
    /// The session is over node's maxSessionMemory. RST_STREAM(ENHANCE_YOUR_CALM) follows the block.
    OverMemoryLimit,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum FeedEnd {
    /// Every complete frame of the input was handled.
    Drained,
    /// `Sink::should_stop()` ended the call between frames, before any window was replenished.
    Yielded,
    Fatal,
}

pub(crate) struct Feed {
    pub consumed: usize,
    pub end: FeedEnd,
}

/// nghttp2's NGHTTP2_DEFAULT_MAX_OBQ_FLOOD_ITEM: outbound PING/SETTINGS ACKs that may pile up
/// behind a non-reading peer before the session is treated as flooded (NGHTTP2_ERR_FLOODED).
const MAX_OUTBOUND_ACK_QUEUE: u32 = 1000;

/// What a stream counts toward maxSessionMemory, for its table entry and its `Http2Stream`. Node counts as much: its 10 MB hold 13,866 streams.
const STREAM_MEMORY_COST: usize = 756;

/// nghttp2's NGHTTP2_DEFAULT_MAX_CONTINUATIONS: CONTINUATION frames allowed per header block.
const MAX_CONTINUATIONS: u32 = 8;

/// nghttp2's NGHTTP2_DEFAULT_STREAM_RESET_BURST / _RATE (node's streamResetBurst / streamResetRate).
const DEFAULT_STREAM_RESET_BURST: u32 = 1000;
const DEFAULT_STREAM_RESET_RATE: u32 = 33;

/// nghttp2's NGHTTP2_DEFAULT_GLITCH_BURST / _RATE.
const GLITCH_BURST: u32 = 10_000;
const GLITCH_RATE: u32 = 330;

/// nghttp2_ratelim: `rate` tokens per whole elapsed second, capped at `burst`.
#[derive(Clone, Copy)]
struct RateLimit {
    burst: u32,
    rate: u32,
    tokens: u32,
    last_refill: std::time::Instant,
}

impl RateLimit {
    fn new(burst: u32, rate: u32) -> Self {
        RateLimit {
            burst,
            rate,
            tokens: burst,
            last_refill: std::time::Instant::now(),
        }
    }

    /// Returns false once the bucket is empty.
    fn drain(&mut self) -> bool {
        let elapsed = self.last_refill.elapsed().as_secs();
        if elapsed > 0 {
            let gain = u32::try_from(elapsed)
                .unwrap_or(u32::MAX)
                .saturating_mul(self.rate);
            self.tokens = self.tokens.saturating_add(gain).min(self.burst);
            self.last_refill += std::time::Duration::from_secs(elapsed);
        }
        if self.tokens == 0 {
            return false;
        }
        self.tokens -= 1;
        true
    }
}

/// What the engine needs from its owner: a way to write frames, and a listener for what the peer's frames mean.
pub(crate) trait Sink {
    /// Writes one frame, whose payload is `payload` joined. Returns false under backpressure.
    fn write_frame(
        &self,
        frame_type: FrameType,
        flags: u8,
        stream_id: u32,
        payload: &[&[u8]],
    ) -> bool;
    /// The bytes that wait to be written, which count toward node's maxSessionMemory.
    fn buffered_output(&self) -> usize;
    /// The owner wants control back before the next frame. `receive` returns `FeedEnd::Yielded`.
    fn should_stop(&self) -> bool;

    /// This engine detected a connection error and has written the GOAWAY. `lib_error_code` is one of `lib_error`.
    fn on_error(&self, lib_error_code: i32, debug: &[u8]);
    /// The peer went over node's maxSessionInvalidFrames, which ends the session with ERR_HTTP2_TOO_MANY_INVALID_FRAMES.
    fn on_too_many_invalid_frames(&self);
    fn on_local_settings(&self, settings: &Settings);
    fn on_remote_settings(&self, settings: &Settings);
    /// A SETTINGS entry with an id outside the standard registry (node's remoteCustomSettings).
    fn on_remote_custom_setting(&self, id: u16, value: u32);
    fn on_ping(&self, payload: &[u8], is_ack: bool);
    /// `code` is the raw value from the wire, so that JS sees unknown codes like node does.
    fn on_go_away(&self, code: u32, last_stream_id: u32, debug: &[u8]);
    /// A send window grew, so queued DATA may fit now.
    fn on_send_window_increased(&self);
    /// RFC 7838 ALTSVC.
    fn on_altsvc(&self, stream_id: u32, origin: &[u8], value: &[u8]);
    /// RFC 8336 ORIGIN. `payload` is the whole frame's, so that its origins make one event.
    fn on_origin(&self, payload: &[u8]);

    /// An inbound HEADERS opened a stream.
    fn on_stream_open(&self, stream: &Stream);
    /// A PUSH_PROMISE on `parent_id` reserved `promised_id`. The promised request's fields follow under that id.
    fn on_push_promise(&self, parent_id: u32, promised_id: u32);
    /// One decoded header field. `name` and `value` point into a shared buffer, so copy them before returning.
    fn on_header(&self, stream_id: u32, name: &[u8], value: &[u8], never_index: bool);
    /// The block is refused, so the fields `on_header` got for it are dropped.
    fn on_headers_refused(&self);
    /// The header block for `stream_id` is complete. `flags` are those of its HEADERS frame.
    fn on_headers_complete(&self, stream_id: u32, flags: u8);
    /// The payload of a DATA frame, or a part of it, without padding.
    fn on_data(&self, stream_id: u32, data: &[u8]);
    /// The peer's END_STREAM arrived. The owner applies it to the table once JS has seen what came before it.
    fn on_stream_end(&self, stream: &Rc<Stream>);
    /// The peer's RST_STREAM or a stream error this engine detected closed the stream.
    fn on_stream_reset(&self, stream: &Rc<Stream>, code: u32);
    /// This engine refused a request, which counts toward node's maxSessionRejectedStreams.
    fn on_stream_rejected(&self);
}

pub(crate) struct Connection {
    pub is_server: Cell<bool>,
    /// Frames accepted from the peer, for the perf_hooks session entry.
    pub frames_received: Cell<u64>,

    pub local_settings: Cell<Settings>,
    pub remote_settings: Cell<Settings>,
    /// node's maxHeaderListPairs. A block with more fields is refused like an oversized header list.
    pub max_header_list_pairs: Cell<u32>,
    /// node's maxSessionMemory, in bytes.
    pub max_session_memory: Cell<usize>,
    /// node's maxSessionInvalidFrames.
    pub max_invalid_frames: Cell<u32>,
    /// node's strictFieldWhitespaceValidation.
    pub strict_field_whitespace: Cell<bool>,
    /// The SETTINGS_INITIAL_WINDOW_SIZE the peer has ACKed. Until it ACKs a smaller one it may go by this one (§6.5.3).
    acked_local_initial_window: Cell<u32>,
    /// The SETTINGS_MAX_FRAME_SIZE the peer has ACKed. Until it ACKs a smaller one it may go by this one (§6.5.3).
    acked_max_frame_size: Cell<u32>,
    /// The SETTINGS_MAX_HEADER_LIST_SIZE the peer has ACKed. Like nghttp2, a submitted value applies from its ACK on.
    pub enforced_max_header_list_size: Cell<u32>,
    /// The values of each SETTINGS frame the peer hasn't ACKed yet, in send order (§6.5.3).
    pub pending_local_settings_acks: JsCell<VecDeque<Settings>>,
    invalid_frame_count: Cell<u32>,
    /// node's maxSettings: the entries accepted in one SETTINGS frame.
    pub max_settings: Cell<u32>,

    /// SETTINGS_INITIAL_WINDOW_SIZE doesn't move the connection windows (§6.9.2).
    pub send_window: Cell<SendWindow>,
    pub recv_window: Cell<RecvWindow>,

    pub hpack: JsCell<lshpack::Coder>,
    /// node's paddingStrategy, which every new stream starts with.
    pub padding_strategy: Cell<PaddingStrategy>,

    pub streams: StreamTable,

    header_block: JsCell<HeaderBlockAssembler>,
    /// What to do with the open header block once its last CONTINUATION arrives.
    open_block_meta: Cell<Option<HeaderBlockMeta>>,
    /// A DATA frame whose payload is still arriving. Like nghttp2, its data is delivered as it comes.
    data_in_flight: Cell<Option<DataInFlight>>,
    /// A connection error this side detected ended the session, so further input is ignored.
    terminated: Cell<bool>,
    /// PING and SETTINGS ACKs queued behind a peer that doesn't read (nghttp2's obq_flood_counter_).
    obq_ack_pending: Cell<u32>,
    /// Inbound RST_STREAM (nghttp2's stream_reset_ratelim; node's streamResetBurst/Rate).
    stream_reset_limit: Cell<RateLimit>,
    /// RST_STREAM this engine sends that cancels a delivered request (cf. nghttp2's glitch_ratelim).
    sent_reset_limit: Cell<RateLimit>,
    /// A bucket ran dry mid-frame; receive() tears the session down between frames.
    reset_flood: Cell<bool>,
    /// Frames and header blocks dropped without a reply (nghttp2's glitch_ratelim).
    glitch_limit: Cell<RateLimit>,

    /// Scratch for `replenish_windows`: (stream id, increment).
    replenish_buf: JsCell<Vec<(u32, u32)>>,

    preface_received: Cell<usize>,
    /// The id the next stream we open follows: the highest we have opened, or that a server has accepted.
    pub last_stream_id: Cell<u32>,
    /// Highest stream id the peer has opened or promised (§5.1.1). Our GOAWAY names it.
    pub last_peer_id: Cell<u32>,
    /// We sent a GOAWAY.
    pub goaway_sent: Cell<bool>,
}

impl Default for Connection {
    fn default() -> Self {
        let reset_limit = RateLimit::new(DEFAULT_STREAM_RESET_BURST, DEFAULT_STREAM_RESET_RATE);
        Connection {
            is_server: Cell::new(false),
            local_settings: Cell::new(Settings::default()),
            remote_settings: Cell::new(Settings::default()),
            max_header_list_pairs: Cell::new(128),
            frames_received: Cell::new(0),
            max_session_memory: Cell::new(10 * 1024 * 1024),
            max_invalid_frames: Cell::new(1000),
            strict_field_whitespace: Cell::new(true),
            acked_local_initial_window: Cell::new(DEFAULT_WINDOW_SIZE),
            acked_max_frame_size: Cell::new(Settings::default().max_frame_size),
            enforced_max_header_list_size: Cell::new(Settings::default().max_header_list_size),
            pending_local_settings_acks: JsCell::new(VecDeque::new()),
            invalid_frame_count: Cell::new(0),
            max_settings: Cell::new(32),
            send_window: Cell::new(SendWindow::new(DEFAULT_WINDOW_SIZE)),
            recv_window: Cell::new(RecvWindow::new(DEFAULT_WINDOW_SIZE)),
            hpack: JsCell::new(lshpack::Coder::default()),
            padding_strategy: Cell::new(PaddingStrategy::None),
            streams: StreamTable::default(),
            header_block: JsCell::new(HeaderBlockAssembler::default()),
            open_block_meta: Cell::new(None),
            data_in_flight: Cell::new(None),
            terminated: Cell::new(false),
            obq_ack_pending: Cell::new(0),
            stream_reset_limit: Cell::new(reset_limit),
            sent_reset_limit: Cell::new(reset_limit),
            reset_flood: Cell::new(false),
            glitch_limit: Cell::new(RateLimit::new(GLITCH_BURST, GLITCH_RATE)),
            replenish_buf: JsCell::new(Vec::new()),
            preface_received: Cell::new(0),
            last_stream_id: Cell::new(0),
            last_peer_id: Cell::new(0),
            goaway_sent: Cell::new(false),
        }
    }
}

impl Connection {
    /// A new entry with the windows both sides currently go by (§6.9.2).
    pub(crate) fn insert_stream(&self, stream_id: u32, state: State) -> Rc<Stream> {
        let stream = Stream::new(
            stream_id,
            stream_id.is_multiple_of(2) == self.is_server.get(),
            state,
            self.remote_settings.get().initial_window_size,
            self.acked_local_initial_window.get(),
        );
        stream.padding_strategy.set(self.padding_strategy.get());
        self.streams.insert(stream)
    }

    pub(crate) fn header_block_capacity(&self) -> usize {
        self.header_block.get().capacity()
    }

    /// node's IsAvailableSessionMemory. New streams are refused while this returns true.
    pub(crate) fn is_over_memory_limit(&self, sink: &impl Sink) -> bool {
        sink.buffered_output() + self.streams.len() * STREAM_MEMORY_COST
            > self.max_session_memory.get()
    }

    // ---- Outbound -------------------------------------------------------

    fn send_settings_ack(&self, sink: &impl Sink) {
        sink.write_frame(FrameType::Settings, flags::ACK, 0, &[]);
    }

    fn send_ping_ack(&self, sink: &impl Sink, payload: &[u8]) {
        sink.write_frame(FrameType::Ping, flags::ACK, 0, &[payload]);
    }

    /// RFC 9113 §6.8: GOAWAY goes out on stream 0 and names the last stream of the peer's that we may have acted on.
    pub(crate) fn write_go_away(
        &self,
        sink: &impl Sink,
        last_stream_id: u32,
        code: ErrorCode,
        debug: &[u8],
    ) {
        self.goaway_sent.set(true);
        sink.write_frame(
            FrameType::GoAway,
            0,
            0,
            &[
                &(last_stream_id & frame::MAX_STREAM_ID).to_be_bytes(),
                &code.0.to_be_bytes(),
                debug,
            ],
        );
    }

    /// Locally-detected connection error: send GOAWAY, mark the session terminated (further input
    /// is ignored, like nghttp2 after terminate_session), and surface it to the embedder with the
    /// nghttp2-style `lib_code` so JS can build node's NghttpError.
    fn local_connection_error(
        &self,
        sink: &impl Sink,
        code: ErrorCode,
        lib_code: i32,
        debug: &[u8],
    ) {
        self.terminated.set(true);
        self.write_go_away(sink, self.last_peer_id.get(), code, debug);
        sink.on_error(lib_code, debug);
    }

    /// Connection error with the generic NGHTTP2_ERR_PROTO library code — the same thing node
    /// reports ("Protocol error") whenever nghttp2 terminates a session internally without a more
    /// specific callback (node's `internal_goaway_sent_` path in OnFrameSent/SendPendingData).
    pub(crate) fn send_go_away(&self, sink: &impl Sink, code: ErrorCode, debug: &[u8]) {
        self.local_connection_error(sink, code, lib_error::PROTO, debug);
    }

    pub(crate) fn send_window_update(&self, sink: &impl Sink, stream_id: u32, increment: u32) {
        sink.write_frame(
            FrameType::WindowUpdate,
            0,
            stream_id,
            &[&increment.to_be_bytes()],
        );
    }

    fn send_rst_stream(&self, sink: &impl Sink, stream_id: u32, code: ErrorCode) {
        sink.write_frame(FrameType::RstStream, 0, stream_id, &[&code.0.to_be_bytes()]);
        // MadeYouReset makes us cancel a request the handler was given. A second reset cancels nothing.
        if self
            .streams
            .inbound(stream_id)
            .is_some_and(|s| s.recv_final_headers.get() && !s.was_reset())
        {
            self.note_reset(ResetBy::Us);
        }
    }

    /// A stream error this engine detected: RST_STREAM, then the stream is closed and the embedder hears about it.
    fn reset_stream(&self, sink: &impl Sink, stream_id: u32, code: ErrorCode) {
        self.send_rst_stream(sink, stream_id, code);
        if let Some(s) = self.streams.inbound(stream_id) {
            s.reset.set(s.reset.get().or(Some(ResetBy::Us)));
            if self.streams.close(&s) {
                sink.on_stream_reset(&s, code.0);
            }
        }
    }

    // ---- Inbound --------------------------------------------------------

    /// Feed received bytes. Processes every complete frame and returns `consumed` = the offset of
    /// the first incomplete frame (the caller keeps `bytes[consumed..]` and re-presents it prepended
    /// to the next chunk — the engine holds no reassembly buffer).
    pub(crate) fn receive(&self, sink: &impl Sink, bytes: &[u8]) -> Feed {
        let mut offset = 0usize;

        // A locally-detected connection error already tore the session down (GOAWAY sent, error
        // surfaced): everything after it is discarded so no further streams/frames reach JS.
        if self.terminated.get() {
            return Feed {
                consumed: bytes.len(),
                end: FeedEnd::Fatal,
            };
        }

        // §3.4: server validates the 24-octet client preface before any frame.
        let preface_received = self.preface_received.get();
        if self.is_server.get() && preface_received < CONNECTION_PREFACE.len() {
            let need = CONNECTION_PREFACE.len() - preface_received;
            let avail = need.min(bytes.len());
            let expect = &CONNECTION_PREFACE[preface_received..preface_received + avail];
            if &bytes[..avail] != expect {
                // node: nghttp2_session_mem_recv returns NGHTTP2_ERR_BAD_CLIENT_MAGIC and the
                // session errors with "Received bad client magic byte string".
                self.local_connection_error(
                    sink,
                    ErrorCode::PROTOCOL_ERROR,
                    lib_error::BAD_CLIENT_MAGIC,
                    b"invalid connection preface",
                );
                return Feed {
                    consumed: avail,
                    end: FeedEnd::Fatal,
                };
            }
            self.preface_received.set(preface_received + avail);
            offset += avail;
            if preface_received + avail < CONNECTION_PREFACE.len() {
                return Feed {
                    consumed: offset,
                    end: FeedEnd::Drained,
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
                if inflight.end_stream && !inflight.discard {
                    self.end_inbound_data(sink, inflight.stream_id);
                }
            } else {
                self.data_in_flight.set(Some(inflight));
                if sink.should_stop() {
                    return Feed {
                        consumed: offset,
                        end: FeedEnd::Yielded,
                    };
                }
                self.replenish_windows(sink);
                return Feed {
                    consumed: offset,
                    end: FeedEnd::Drained,
                };
            }
        }

        loop {
            // Check before looking at the input, so a stop the last frame requested still yields when no bytes follow it.
            if sink.should_stop() {
                return Feed {
                    consumed: offset,
                    end: FeedEnd::Yielded,
                };
            }
            let max_frame_size = self
                .acked_max_frame_size
                .get()
                .max(self.local_settings.get().max_frame_size);
            let (hdr, payload) = match frame::next_frame(&bytes[offset..], max_frame_size) {
                Ok(NextFrame::Complete { header, payload }) => (header, payload),
                Ok(NextFrame::NeedHeader) => break,
                Ok(NextFrame::Partial { header, payload }) => {
                    // A DATA frame is delivered as it arrives. A PADDED one waits for its Pad Length octet.
                    if header.frame_type == FrameType::Data as u8
                        && self.header_block.get().admits(&header)
                        && header.stream_id != 0
                        && (!header.has(flags::PADDED) || !payload.is_empty())
                    {
                        match self.begin_streamed_data(sink, &header, payload) {
                            StreamedDataStart::Fatal => {
                                return Feed {
                                    consumed: offset,
                                    end: FeedEnd::Fatal,
                                };
                            }
                            StreamedDataStart::Consumed(n) => {
                                offset += n;
                            }
                        }
                    }
                    break;
                }
                Err(e) => {
                    self.send_go_away(sink, e.code, e.reason.as_bytes());
                    return Feed {
                        consumed: offset,
                        end: FeedEnd::Fatal,
                    };
                }
            };
            let total = FRAME_HEADER_SIZE + payload.len();
            if self.dispatch(sink, &hdr, payload) {
                return Feed {
                    consumed: offset + total,
                    end: FeedEnd::Fatal,
                };
            }
            offset += total;
            if self.check_reset_flood(sink) {
                return Feed {
                    consumed: offset,
                    end: FeedEnd::Fatal,
                };
            }
        }
        if self.check_reset_flood(sink) {
            return Feed {
                consumed: offset,
                end: FeedEnd::Fatal,
            };
        }
        if sink.should_stop() {
            return Feed {
                consumed: offset,
                end: FeedEnd::Yielded,
            };
        }
        // Re-open consumed receive windows once per batch (RFC 9113 §6.9; mirrors how the
        // application-consumption-driven update works in node) — doing it per frame would both spam
        // WINDOW_UPDATE and make burst flow-control violations undetectable.
        self.replenish_windows(sink);
        Feed {
            consumed: offset,
            end: FeedEnd::Drained,
        }
    }

    /// Send WINDOW_UPDATE for every receive window that has consumed at least half its size.
    fn replenish_windows(&self, sink: &impl Sink) {
        if self.recv_window.get().needs_update() {
            let inc = update(&self.recv_window, RecvWindow::take_update);
            if inc > 0 {
                self.send_window_update(sink, 0, inc);
            }
        }
        let mut buf = self.replenish_buf.take();
        buf.clear();
        self.streams.for_each(|s| {
            if !s.is_closed() && !s.reading_paused.get() && s.recv_window.get().needs_update() {
                let inc = update(&s.recv_window, RecvWindow::take_update);
                if inc > 0 {
                    buf.push((s.id, inc));
                }
            }
        });
        for (id, inc) in buf.iter() {
            self.send_window_update(sink, *id, *inc);
        }
        self.replenish_buf.set(buf);
    }

    /// Dispatch one fully-buffered frame. Returns true if the connection is now fatally closing.
    fn dispatch(&self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        // GOAWAY is excluded: it terminates the session, so node's statistics — which are
        // read off a session that stopped processing at that frame — never include it.
        if hdr.frame_type != FrameType::GoAway as u8 {
            self.frames_received.set(self.frames_received.get() + 1);
        }
        // Checked first: a malformed frame inside a header block is still a connection error (§6.2).
        if !self.header_block.get().admits(hdr) {
            self.send_go_away(
                sink,
                ErrorCode::PROTOCOL_ERROR,
                b"CONTINUATION frame out of sequence",
            );
            return true;
        }
        let frame = match Frame::parse(hdr, payload, self.max_settings.get() as usize) {
            Ok(frame) => frame,
            Err(e) if e.stream_id == 0 => {
                self.send_go_away(sink, e.code, e.reason.as_bytes());
                return true;
            }
            Err(e) => {
                self.reset_stream(sink, e.stream_id, e.code);
                return false;
            }
        };
        match frame {
            Frame::Settings(entries) => self.handle_settings(sink, entries),
            Frame::SettingsAck => self.handle_settings_ack(sink),
            Frame::Ping { ack, payload } => self.handle_ping(sink, ack, payload),
            Frame::GoAway {
                last_stream_id,
                code,
                debug,
            } => self.handle_go_away(sink, last_stream_id, code, debug),
            Frame::WindowUpdate { increment } => {
                self.handle_window_update(sink, hdr.stream_id, increment)
            }
            Frame::Headers {
                fragment,
                end_stream,
                end_headers,
            } => self.handle_headers(sink, hdr, fragment, end_stream, end_headers),
            Frame::Continuation {
                fragment,
                end_headers,
            } => self.handle_continuation(sink, fragment, end_headers),
            Frame::Data { data, end_stream } => self.handle_data(sink, hdr, data, end_stream),
            Frame::RstStream { code } => self.handle_rst_stream(sink, hdr.stream_id, code),
            Frame::PushPromise {
                promised_id,
                fragment,
                end_headers,
            } => self.handle_push_promise(sink, hdr, promised_id, fragment, end_headers),
            Frame::AltSvc => self.handle_altsvc(sink, hdr, payload),
            Frame::Origin => self.handle_origin(sink, hdr, payload),
            // Both are ignored (§4.1 for unknown types). nghttp2 charges each one as a glitch.
            Frame::Priority | Frame::Unknown => self.note_glitch(sink),
        }
    }

    fn handle_settings_ack(&self, sink: &impl Sink) -> bool {
        // §6.5.3: an ACK is for the oldest outstanding SETTINGS, not the latest submission.
        let Some(acked) = self
            .pending_local_settings_acks
            .with_mut(VecDeque::pop_front)
        else {
            self.send_go_away(sink, ErrorCode::PROTOCOL_ERROR, b"SETTINGS: unexpected ACK");
            return true;
        };
        // §6.9.2: the peer shifted its send window for every stream by this delta.
        let delta = acked.initial_window_size as i64 - self.acked_local_initial_window.get() as i64;
        if delta != 0 {
            self.streams
                .for_each(|s| update(&s.recv_window, |w| w.grow(delta)));
        }
        self.acked_local_initial_window
            .set(acked.initial_window_size);
        self.acked_max_frame_size.set(acked.max_frame_size);
        self.enforced_max_header_list_size
            .set(acked.max_header_list_size);
        self.hpack
            .with_mut(|h| h.set_acked_header_table_size(acked.header_table_size));
        sink.on_local_settings(&acked);
        false
    }

    fn handle_settings(&self, sink: &impl Sink, entries: Entries<'_>) -> bool {
        let old_initial_window = self.remote_settings.get().initial_window_size;
        for (id, value) in entries {
            if let Some(sid) = SettingId::from_u16(id) {
                // RFC 8441 §3 (and nghttp2): once SETTINGS_ENABLE_CONNECT_PROTOCOL has been
                // enabled, the peer must not disable it again — doing so is a connection error.
                if sid == SettingId::EnableConnectProtocol
                    && value == 0
                    && self.remote_settings.get().enable_connect_protocol
                {
                    self.send_go_away(
                        sink,
                        ErrorCode::PROTOCOL_ERROR,
                        b"SETTINGS: server attempted to disable enableConnectProtocol",
                    );
                    return true;
                }
                update(&self.remote_settings, |r| r.apply(sid, value));
                // Per entry, because the peer's decoder evicts at each one (RFC 7541 §4.2).
                if sid == SettingId::HeaderTableSize {
                    self.hpack.with_mut(|h| h.set_peer_header_table_size(value));
                }
            } else {
                sink.on_remote_custom_setting(id, value);
            }
        }
        // §6.9.2: the change shifts every stream's send window, but not the connection's.
        let snapshot = self.remote_settings.get();
        let delta = snapshot.initial_window_size as i64 - old_initial_window as i64;
        if delta != 0 {
            // nghttp2 ends the session if a window passes 2^31-1 here. Such a window stays as it was instead.
            self.streams.for_each(|s| {
                let _ = update(&s.send_window, |w| w.shift(delta));
            });
        }
        // §6.5.3: ACK first. The peer goes by its old receive window until it sees the ACK.
        self.send_settings_ack(sink);
        if self.note_outbound_ack(sink) {
            return true;
        }
        if delta > 0 {
            sink.on_send_window_increased();
        }
        sink.on_remote_settings(&snapshot);
        false
    }

    /// The embedder confirms its outbound buffer is fully drained to the
    /// transport: reset the outbound-ACK-queue counter (mirrors nghttp2's
    /// per-send decrement, coarsened to whole-buffer drains). Never called
    /// from receive() itself so a peer that never reads cannot reset it.
    pub(crate) fn note_outbound_drained(&self) {
        self.obq_ack_pending.set(0);
    }

    pub(crate) fn set_stream_reset_limit(&self, burst: u32, rate: u32) {
        self.stream_reset_limit.set(RateLimit::new(burst, rate));
    }

    /// Servers only. The callers charge a reset only when it cancels a live stream.
    fn note_reset(&self, by: ResetBy) {
        if !self.is_server.get() || self.reset_flood.get() {
            return;
        }
        let limit = match by {
            ResetBy::Peer => &self.stream_reset_limit,
            ResetBy::Us => &self.sent_reset_limit,
        };
        if !update(limit, RateLimit::drain) {
            self.reset_flood.set(true);
        }
    }

    /// nghttp2 sends INTERNAL_ERROR here; ENHANCE_YOUR_CALM matches note_outbound_ack.
    fn check_reset_flood(&self, sink: &impl Sink) -> bool {
        if !self.reset_flood.get() || self.terminated.get() {
            return false;
        }
        self.local_connection_error(
            sink,
            ErrorCode::ENHANCE_YOUR_CALM,
            lib_error::FLOODED,
            b"too many stream resets",
        );
        true
    }

    /// node's Http2Session::OnInvalidFrame, `count++ > max`. Returns true when the session was torn down.
    fn count_invalid_frame(&self, sink: &impl Sink) -> bool {
        let count = self.invalid_frame_count.get();
        self.invalid_frame_count.set(count.saturating_add(1));
        if count <= self.max_invalid_frames.get() {
            return false;
        }
        self.terminated.set(true);
        sink.on_too_many_invalid_frames();
        true
    }

    /// nghttp2's session_update_glitch_ratelim. Returns true when the session was torn down.
    fn note_glitch(&self, sink: &impl Sink) -> bool {
        if update(&self.glitch_limit, RateLimit::drain) {
            return false;
        }
        self.send_go_away(
            sink,
            ErrorCode::ENHANCE_YOUR_CALM,
            b"too many ignored frames",
        );
        true
    }

    /// Bound queued PING/SETTINGS ACKs behind a non-reading peer — nghttp2's
    /// obq_flood_counter_ / NGHTTP2_ERR_FLOODED. The counter is only reset by
    /// note_outbound_drained() when the transport actually drains, so detection
    /// is independent of recv() chunk size. Returns true when the session was
    /// torn down.
    fn note_outbound_ack(&self, sink: &impl Sink) -> bool {
        let pending = self.obq_ack_pending.get().saturating_add(1);
        self.obq_ack_pending.set(pending);
        if pending < MAX_OUTBOUND_ACK_QUEUE {
            return false;
        }
        self.local_connection_error(
            sink,
            ErrorCode::ENHANCE_YOUR_CALM,
            lib_error::FLOODED,
            b"too many outbound control frames queued",
        );
        true
    }

    fn handle_ping(&self, sink: &impl Sink, ack: bool, payload: [u8; 8]) -> bool {
        if ack {
            sink.on_ping(&payload, true);
            return false;
        }
        self.send_ping_ack(sink, &payload);
        sink.on_ping(&payload, false);
        self.note_outbound_ack(sink)
    }

    fn handle_go_away(
        &self,
        sink: &impl Sink,
        last_stream_id: u32,
        code: ErrorCode,
        debug: &[u8],
    ) -> bool {
        // nghttp2 (nghttp2_session_on_goaway_received): the Last-Stream-ID must refer to a stream
        // the *receiver* initiated (or 0) — for a server that means an even id, for a client an
        // odd id. Anything else is a connection PROTOCOL_ERROR.
        let initiated_locally = if self.is_server.get() {
            last_stream_id.is_multiple_of(2)
        } else {
            !last_stream_id.is_multiple_of(2)
        };
        if last_stream_id > 0 && !initiated_locally {
            self.send_go_away(
                sink,
                ErrorCode::PROTOCOL_ERROR,
                b"GOAWAY: invalid last_stream_id",
            );
            return true;
        }
        sink.on_go_away(code.0, last_stream_id, debug);
        false
    }

    fn handle_window_update(&self, sink: &impl Sink, stream_id: u32, increment: u32) -> bool {
        // §6.9.1: past 2^31-1 is a connection error on stream 0 and a stream error elsewhere.
        if stream_id == 0 {
            if update(&self.send_window, |w| w.increase(increment)).is_err() {
                self.send_go_away(
                    sink,
                    ErrorCode::FLOW_CONTROL_ERROR,
                    b"connection flow-control window overflow",
                );
                return true;
            }
        } else {
            // A frame in flight when the stream was reset or forgotten is ignored (§5.1).
            let Some(s) = self.streams.inbound(stream_id).filter(|s| !s.was_reset()) else {
                return false;
            };
            if update(&s.send_window, |w| w.increase(increment)).is_err() {
                self.reset_stream(sink, stream_id, ErrorCode::FLOW_CONTROL_ERROR);
                return false;
            }
        }
        sink.on_send_window_increased();
        false
    }

    // ---- Stream-level inbound ------------------------------------------

    /// RFC 9113 §6.2 HEADERS: begin (or complete) the header block.
    fn handle_headers(
        &self,
        sink: &impl Sink,
        hdr: &FrameHeader,
        fragment: &[u8],
        end_stream: bool,
        end_headers: bool,
    ) -> bool {
        let is_server = self.is_server.get();
        let existing = self.streams.inbound(hdr.stream_id);
        let is_new = existing.is_none();
        // §5.1.1: a client opens odd ids, and it never sends HEADERS on a stream we pushed.
        if is_server && hdr.stream_id.is_multiple_of(2) {
            self.send_go_away(
                sink,
                ErrorCode::PROTOCOL_ERROR,
                b"invalid stream id for HEADERS",
            );
            return true;
        }
        // An id with no entry is a new request if it's above the peer's last one. Otherwise it's closed or idle.
        let opens_stream = is_new && is_server && hdr.stream_id > self.last_peer_id.get();
        let closed = is_new && !opens_stream;
        if closed && !self.has_existed(hdr.stream_id) {
            self.send_go_away(sink, ErrorCode::PROTOCOL_ERROR, b"HEADERS on idle stream");
            return true;
        }
        let mut disposition = if closed {
            BlockDisposition::StreamClosed
        } else if !opens_stream {
            BlockDisposition::Deliver
        } else if self.is_over_memory_limit(sink) {
            // Like node's OnBeginHeadersCallback.
            BlockDisposition::OverMemoryLimit
        } else if self.streams.open_peer() >= self.local_settings.get().max_concurrent_streams {
            // §5.1.2. The limit applies from the moment it's submitted, like nghttp2's pending local settings.
            BlockDisposition::OverStreamLimit
        } else {
            BlockDisposition::Deliver
        };
        if opens_stream {
            // Also for a refused stream, so that what the client pipelined behind its HEADERS is a frame on a closed stream (§5.1).
            self.last_peer_id.set(hdr.stream_id);
            if disposition != BlockDisposition::OverMemoryLimit {
                self.last_stream_id
                    .set(self.last_stream_id.get().max(hdr.stream_id));
            }
            if disposition == BlockDisposition::OverStreamLimit {
                self.send_rst_stream(sink, hdr.stream_id, ErrorCode::REFUSED_STREAM);
                // nghttp2 reports a stream over the limit to node as an invalid frame.
                if self.count_invalid_frame(sink) {
                    return true;
                }
            }
        }
        if disposition == BlockDisposition::Deliver {
            let s = existing.unwrap_or_else(|| self.insert_stream(hdr.stream_id, State::Idle));
            // Like nghttp2, HEADERS after the peer's END_STREAM end the session. Node reports "Stream was already closed or invalid".
            if s.inbound_state() == State::HalfClosedRemote {
                self.local_connection_error(
                    sink,
                    ErrorCode::STREAM_CLOSED,
                    lib_error::STREAM_CLOSED,
                    b"HEADERS: stream closed",
                );
                return true;
            }
            // END_STREAM is applied once the block is complete.
            match self.streams.apply(&s, stream::Event::RecvHeaders) {
                Ok(_) => {}
                Err(stream::TransitionError::Protocol) => {
                    self.send_go_away(
                        sink,
                        ErrorCode::PROTOCOL_ERROR,
                        b"HEADERS in invalid stream state",
                    );
                    return true;
                }
                // The stream was reset with the peer's trailers in flight.
                Err(stream::TransitionError::StreamClosed) => {
                    disposition = BlockDisposition::StreamClosed;
                }
            }
            if opens_stream {
                s.opened_after_goaway.set(self.goaway_sent.get());
                sink.on_stream_open(&s);
            }
        }

        let meta = HeaderBlockMeta {
            target: hdr.stream_id,
            push_parent: None,
            flags: hdr.flags,
            end_stream,
            is_request: opens_stream,
            disposition,
        };
        self.begin_header_block(sink, hdr.stream_id, fragment, end_headers, meta)
    }

    /// Tail of HEADERS and PUSH_PROMISE. CONTINUATION frames follow on the frame's own stream (§6.10).
    fn begin_header_block(
        &self,
        sink: &impl Sink,
        stream_id: u32,
        fragment: &[u8],
        end_headers: bool,
        meta: HeaderBlockMeta,
    ) -> bool {
        if self
            .header_block
            .with_mut(|b| b.begin(stream_id, fragment, end_headers))
        {
            return self.finish_header_block(sink, &meta);
        }
        self.open_block_meta.set(Some(meta));
        false
    }

    fn handle_continuation(&self, sink: &impl Sink, fragment: &[u8], end_headers: bool) -> bool {
        // HPACK output is never smaller than its input. The floor keeps a tiny maxHeaderListSize from refusing normal blocks.
        let max_len = (self.enforced_max_header_list_size.get() as usize).max(65536);
        match self
            .header_block
            .with_mut(|b| b.push(fragment, end_headers, MAX_CONTINUATIONS, max_len))
        {
            Ok(false) => false,
            Ok(true) => match self.open_block_meta.take() {
                Some(meta) => self.finish_header_block(sink, &meta),
                None => false,
            },
            Err(HeaderBlockError::TooManyContinuations) => {
                // nghttp2 sends GOAWAY(INTERNAL_ERROR) here.
                self.local_connection_error(
                    sink,
                    ErrorCode::INTERNAL_ERROR,
                    lib_error::TOO_MANY_CONTINUATIONS,
                    b"too many CONTINUATION frames",
                );
                true
            }
            Err(HeaderBlockError::TooLarge) => {
                // nghttp2 fails a block over NGHTTP2_MAX_HEADERSLEN with NGHTTP2_ERR_HEADER_COMP.
                self.send_go_away(
                    sink,
                    ErrorCode::COMPRESSION_ERROR,
                    b"header block too large",
                );
                true
            }
        }
    }

    /// Decodes a complete header block and delivers it. Every block is decoded whole, so the HPACK table stays in sync (§4.3).
    fn finish_header_block(&self, sink: &impl Sink, meta: &HeaderBlockMeta) -> bool {
        let HeaderBlockMeta {
            target,
            push_parent,
            flags,
            end_stream,
            is_request,
            disposition,
        } = *meta;
        let deliver = disposition == BlockDisposition::Deliver;
        // The embedder creates the pushed stream before it gets the promised request's fields.
        if let Some(parent) = push_parent
            && deliver
        {
            sink.on_push_promise(parent.get(), target);
        }
        let is_server = self.is_server.get();
        let stream = self.streams.inbound(target);
        // §8.1: a trailer section ends the stream and has no pseudo-header fields.
        let is_trailer = push_parent.is_none()
            && deliver
            && stream.as_ref().is_some_and(|s| s.recv_final_headers.get());
        let mut checks = FieldChecks::new(
            BlockKind {
                is_server,
                is_push: push_parent.is_some(),
                is_request,
                is_trailer,
                connect_protocol_enabled: self.local_settings.get().enable_connect_protocol,
                strict_whitespace: self.strict_field_whitespace.get(),
                max_list_size: self.enforced_max_header_list_size.get() as usize,
                max_fields: self.max_header_list_pairs.get() as usize,
            },
            stream.as_ref().is_some_and(|s| s.recv_host.get()),
            is_trailer && !end_stream,
        );
        let block = self.header_block.with_mut(HeaderBlockAssembler::take);
        let decoded = self.hpack.with_mut(|hpack| {
            let mut rest = block.as_slice();
            while !rest.is_empty() {
                let Ok(field) = hpack.decode(rest) else {
                    return false;
                };
                rest = &rest[field.next..];
                if deliver && checks.accept(field.name, field.value) {
                    sink.on_header(target, field.name, field.value, field.never_index);
                }
            }
            true
        });
        self.header_block.with_mut(|b| b.recycle(block));
        if !decoded {
            self.send_go_away(sink, ErrorCode::COMPRESSION_ERROR, b"HPACK decode error");
            return true;
        }
        match disposition {
            BlockDisposition::OverStreamLimit => return false,
            BlockDisposition::OverMemoryLimit => {
                self.send_rst_stream(sink, target, ErrorCode::ENHANCE_YOUR_CALM);
                sink.on_stream_rejected();
                return false;
            }
            BlockDisposition::StreamClosed => return self.note_glitch(sink),
            BlockDisposition::Deliver => {}
        }
        checks.finish();
        if push_parent.is_none()
            && !checks.malformed
            && !checks.rejected
            && let Some(s) = stream.as_ref()
        {
            if is_server {
                s.recv_host.set(checks.saw_host);
                if !checks.saw_connect && s.content_length.get().is_none() {
                    s.content_length.set(checks.content_length);
                }
            } else if !checks.informational && s.content_length.get().is_none() {
                // nghttp2_http_on_response_headers: HEAD, 204 and 304 have no body, and CONNECT's DATA is a tunnel.
                s.content_length.set(match s.request_method.get() {
                    None => None,
                    Some(RequestMethod::Head) => Some(0),
                    Some(_) if checks.no_body_status => Some(0),
                    Some(RequestMethod::Connect) => None,
                    Some(RequestMethod::Other) => checks.content_length,
                });
            }
            if end_stream && s.body_contradicts_content_length() {
                checks.malformed = true;
            }
        }
        // §8.1: a 1xx block isn't the final response, so it can't end the stream.
        if checks.informational && end_stream {
            checks.malformed = true;
        }
        if checks.rejected || checks.malformed {
            sink.on_headers_refused();
            if !checks.rejected && self.count_invalid_frame(sink) {
                return true;
            }
            let code = if checks.rejected {
                ErrorCode::ENHANCE_YOUR_CALM
            } else {
                ErrorCode::PROTOCOL_ERROR
            };
            self.reset_stream(sink, target, code);
            sink.on_stream_rejected();
            return false;
        }
        if let Some(s) = stream.as_ref() {
            if push_parent.is_some() {
                s.request_method.set(Some(checks.method));
            } else if !checks.informational {
                s.recv_final_headers.set(true);
            }
        }
        sink.on_headers_complete(target, flags);
        if end_stream && let Some(s) = stream.as_ref() {
            sink.on_stream_end(s);
        }
        false
    }

    /// Everything a DATA frame's header decides: flow control, stream state and the declared content-length.
    fn admit_data(&self, sink: &impl Sink, hdr: &FrameHeader, data_len: usize) -> DataAdmission {
        let frame_len = hdr.length as usize;
        // §6.9: the whole frame, padding included, counts against both windows.
        update(&self.recv_window, |w| w.on_data(frame_len));
        if self.recv_window.get().is_overflowed(0) {
            self.send_go_away(
                sink,
                ErrorCode::FLOW_CONTROL_ERROR,
                b"connection flow-control window exceeded",
            );
            return DataAdmission::Fatal;
        }
        // Like node's HandleDataFrame, an empty DATA frame that doesn't end the stream counts as invalid.
        if frame_len == 0 && !hdr.has(flags::END_STREAM) && self.count_invalid_frame(sink) {
            return DataAdmission::Fatal;
        }
        let stream = self.streams.inbound(hdr.stream_id);
        // Like nghttp2, drop DATA for a stream that was reset or forgotten (§5.1).
        if match stream.as_ref() {
            Some(s) => s.was_reset(),
            None => self.has_existed(hdr.stream_id),
        } {
            return DataAdmission::Discard;
        }
        enum Verdict {
            Reset(ErrorCode),
            WindowExceeded,
            Deliver,
        }
        let recv_floor = self
            .acked_local_initial_window
            .get()
            .max(self.local_settings.get().initial_window_size);
        let verdict = match stream {
            // §5.1: DATA for a stream nobody opened is a STREAM_CLOSED error.
            None => Verdict::Reset(ErrorCode::STREAM_CLOSED),
            Some(s) => {
                if let Some(code) = s.data_refusal(self.is_server.get()) {
                    Verdict::Reset(code)
                } else {
                    update(&s.recv_window, |w| w.on_data(frame_len));
                    // §6.9.1: an empty frame takes no window, even one a SETTINGS change left negative.
                    if frame_len > 0 && s.recv_window.get().is_overflowed(recv_floor) {
                        Verdict::WindowExceeded
                    } else {
                        s.recv_body_bytes
                            .set(s.recv_body_bytes.get().saturating_add(data_len as u64));
                        if s.body_exceeds_content_length() {
                            Verdict::Reset(ErrorCode::PROTOCOL_ERROR)
                        } else {
                            Verdict::Deliver
                        }
                    }
                }
            }
        };
        match verdict {
            Verdict::Reset(code) => {
                self.reset_stream(sink, hdr.stream_id, code);
                DataAdmission::Discard
            }
            Verdict::WindowExceeded => {
                // Like nghttp2, a stream window violation ends the whole session.
                self.send_go_away(
                    sink,
                    ErrorCode::FLOW_CONTROL_ERROR,
                    b"stream flow-control window exceeded",
                );
                DataAdmission::Fatal
            }
            Verdict::Deliver => DataAdmission::Deliver,
        }
    }

    /// Starts a DATA frame whose payload has only partly arrived and parks the rest in `data_in_flight`.
    fn begin_streamed_data(
        &self,
        sink: &impl Sink,
        hdr: &FrameHeader,
        payload: &[u8],
    ) -> StreamedDataStart {
        let data = match frame::unpadded_range(hdr, payload.first().copied()) {
            Ok(range) => range,
            Err(e) => {
                self.send_go_away(sink, e.code, e.reason.as_bytes());
                return StreamedDataStart::Fatal;
            }
        };
        let discard = match self.admit_data(sink, hdr, data.len()) {
            DataAdmission::Fatal => return StreamedDataStart::Fatal,
            DataAdmission::Discard => true,
            DataAdmission::Deliver => false,
        };
        let arrived = &payload[data.start.min(payload.len())..];
        let data_now = arrived.len().min(data.len());
        if data_now > 0 && !discard {
            sink.on_data(hdr.stream_id, &arrived[..data_now]);
        }
        self.data_in_flight.set(Some(DataInFlight {
            stream_id: hdr.stream_id,
            payload_remaining: hdr.length - payload.len() as u32,
            data_remaining: (data.len() - data_now) as u32,
            end_stream: hdr.has(flags::END_STREAM),
            discard,
        }));
        // A streamed frame never reaches dispatch(), so count it here.
        self.frames_received.set(self.frames_received.get() + 1);
        StreamedDataStart::Consumed(FRAME_HEADER_SIZE + payload.len())
    }

    /// END_STREAM on a DATA frame. A body that contradicts the declared `content-length` is malformed (§8.1.1).
    fn end_inbound_data(&self, sink: &impl Sink, stream_id: u32) {
        let Some(s) = self.streams.inbound(stream_id) else {
            return;
        };
        if s.body_contradicts_content_length() {
            self.reset_stream(sink, stream_id, ErrorCode::PROTOCOL_ERROR);
        } else {
            sink.on_stream_end(&s);
        }
    }

    /// An id without an entry is closed if it has been used, and idle otherwise (§5.1.1).
    fn has_existed(&self, stream_id: u32) -> bool {
        stream_id <= self.last_peer_id.get() || stream_id <= self.last_stream_id.get()
    }

    fn handle_data(
        &self,
        sink: &impl Sink,
        hdr: &FrameHeader,
        data: &[u8],
        end_stream: bool,
    ) -> bool {
        match self.admit_data(sink, hdr, data.len()) {
            DataAdmission::Fatal => return true,
            DataAdmission::Discard => return false,
            DataAdmission::Deliver => {}
        }
        if !data.is_empty() {
            sink.on_data(hdr.stream_id, data);
        }
        if end_stream {
            self.end_inbound_data(sink, hdr.stream_id);
        }
        false
    }

    /// RFC 9113 §6.4 RST_STREAM.
    fn handle_rst_stream(&self, sink: &impl Sink, stream_id: u32, code: ErrorCode) -> bool {
        let Some(s) = self.streams.inbound(stream_id) else {
            // §5.1: tolerated on a closed stream, a connection error on an idle one.
            if self.has_existed(stream_id) {
                return false;
            }
            self.send_go_away(
                sink,
                ErrorCode::PROTOCOL_ERROR,
                b"RST_STREAM on idle stream",
            );
            return true;
        };
        // Only the peer's first reset of a stream counts. Bun's own client answers each late DATA frame with another one.
        if s.reset.replace(Some(ResetBy::Peer)) == Some(ResetBy::Peer) {
            return false;
        }
        // JS has already seen a stream close that both sides ended.
        if self.streams.close(&s) {
            sink.on_stream_reset(&s, code.0);
        }
        // nghttp2 exempts every reset after its GOAWAY, but it opens no stream after it. A refused push isn't an attack.
        let exempt = self.goaway_sent.get() && !s.opened_after_goaway.get();
        if !exempt && !stream_id.is_multiple_of(2) {
            self.note_reset(ResetBy::Peer);
        }
        false
    }

    /// RFC 9113 §6.6 PUSH_PROMISE (clients only, §8.4): reserve the promised stream and assemble its
    /// request header block (decoded in finish_header_block, which fires on_push_promise first).
    fn handle_push_promise(
        &self,
        sink: &impl Sink,
        hdr: &FrameHeader,
        promised: u32,
        fragment: &[u8],
        end_headers: bool,
    ) -> bool {
        // 8.4: a server must never receive PUSH_PROMISE.
        if self.is_server.get() {
            self.send_go_away(
                sink,
                ErrorCode::PROTOCOL_ERROR,
                b"server received PUSH_PROMISE",
            );
            return true;
        }
        // 6.6: a client that disabled push (SETTINGS_ENABLE_PUSH=0) must treat the receipt of a
        // PUSH_PROMISE as a connection error of type PROTOCOL_ERROR.
        if !self.local_settings.get().enable_push {
            self.send_go_away(
                sink,
                ErrorCode::PROTOCOL_ERROR,
                b"PUSH_PROMISE with push disabled",
            );
            return true;
        }
        // §5.1.1 / §8.4: server-initiated streams use even ids, each above the last.
        if promised & 1 == 1 || promised <= self.last_peer_id.get() {
            self.send_go_away(
                sink,
                ErrorCode::PROTOCOL_ERROR,
                b"PUSH_PROMISE invalid promised stream id",
            );
            return true;
        }

        // Like nghttp2, don't reserve the stream after our GOAWAY. Later frames on its id are dropped as frames on a closed stream.
        let discard = self.goaway_sent.get();
        if !discard {
            self.insert_stream(promised, State::ReservedRemote);
        }
        self.last_peer_id.set(promised);

        let meta = HeaderBlockMeta {
            target: promised,
            // Always Some: Frame::parse refuses PUSH_PROMISE on stream 0.
            push_parent: NonZeroU32::new(hdr.stream_id),
            flags: 0,
            end_stream: false, // PUSH_PROMISE carries a request; it never ends the stream
            is_request: true,
            disposition: if discard {
                BlockDisposition::StreamClosed
            } else {
                BlockDisposition::Deliver
            },
        };
        self.begin_header_block(sink, hdr.stream_id, fragment, end_headers, meta)
    }

    /// RFC 7838 §4 ALTSVC: optional 2-byte origin-length + origin, then the Alt-Svc field value.
    fn handle_altsvc(&self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        if self.is_server.get() {
            return self.note_glitch(sink);
        }
        if payload.len() < 2 {
            return false; // malformed ALTSVC is ignored (§4)
        }
        let origin_len = u16::from_be_bytes([payload[0], payload[1]]) as usize;
        if 2 + origin_len > payload.len() {
            return false;
        }
        let origin = &payload[2..2 + origin_len];
        let value = &payload[2 + origin_len..];
        // RFC 7838 §4: the origin must be present on stream 0 and empty on a request stream.
        if (hdr.stream_id == 0 && origin.is_empty()) || (hdr.stream_id != 0 && !origin.is_empty()) {
            return false;
        }
        sink.on_altsvc(hdr.stream_id, origin, value);
        false
    }

    /// RFC 8336 §2 ORIGIN: a sequence of (2-byte length + origin) entries on stream 0.
    fn handle_origin(&self, sink: &impl Sink, hdr: &FrameHeader, payload: &[u8]) -> bool {
        // §2.1: ORIGIN on a non-zero stream is ignored, and like ALTSVC it is server-to-client
        // only - a server receiving it must ignore it. The whole payload is delivered once; the
        // embedder iterates the (2-byte length, origin) entries and surfaces a single event.
        if hdr.stream_id != 0 || self.is_server.get() || hdr.flags & 0xf0 != 0 {
            return self.note_glitch(sink);
        }
        sink.on_origin(payload);
        false
    }

    /// The JS reader resumed. The peer may be stalled on this window, so don't wait for the next read to reopen it.
    pub(crate) fn replenish_stream(&self, sink: &impl Sink, s: &Stream) {
        if s.is_closed() || !s.recv_window.get().needs_update() {
            return;
        }
        let inc = update(&s.recv_window, RecvWindow::take_update);
        if inc > 0 {
            self.send_window_update(sink, s.id, inc);
        }
    }
}
