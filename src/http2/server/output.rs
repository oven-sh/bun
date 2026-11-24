use bun_hpack::{Encoder, Indexing};
use bun_http_types::h2::{
    DEFAULT_MAX_FRAME_SIZE, DEFAULT_WINDOW_SIZE, ErrorCode, FrameHeader, FrameType,
};
use bun_http1::queue::Queue;

use super::{HIGH_WATER_MARK, MAX_CONCURRENT_STREAMS};

pub(super) const END_STREAM: u8 = 0x1;
pub(super) const ACK: u8 = 0x1;
pub(super) const END_HEADERS: u8 = 0x4;

fn frame_header(
    kind: FrameType,
    flags: u8,
    stream: u32,
    len: usize,
) -> [u8; FrameHeader::BYTE_SIZE] {
    let [_, a, b, c] = (len as u32).to_be_bytes();
    let [d, e, f, g] = stream.to_be_bytes();
    [a, b, c, kind as u8, flags, d, e, f, g]
}

/// The length of the name and of the value, then both, for each field.
#[derive(Default)]
pub(super) struct Fields(Vec<u8>);

impl Fields {
    /// A response that waits for its body holds it, whatever it needs.
    const USUAL_CAPACITY: usize = 512;

    pub(super) fn with_room(mut self) -> Self {
        self.0.reserve(Self::USUAL_CAPACITY);
        self
    }

    pub(super) fn recycled(mut self) -> Option<Self> {
        self.0.clear();
        (self.0.capacity() <= Self::USUAL_CAPACITY).then_some(self)
    }

    /// Returns the copy of `name`.
    #[inline]
    pub(super) fn push(&mut self, name: &[u8], value: &[u8]) -> &mut [u8] {
        let lens = [name.len(), value.len()].map(|len| (len as u32).to_ne_bytes());
        self.0.extend_from_slice(lens.as_flattened());
        let start = self.0.len();
        self.0.extend_from_slice(name);
        self.0.extend_from_slice(value);
        (self.0.get_mut(start..start + name.len())).unwrap_or_default()
    }

    fn iter(&self) -> impl Iterator<Item = (&[u8], &[u8])> {
        let mut rest = self.0.as_slice();
        core::iter::from_fn(move || {
            let (&[name_len, value_len], _) = rest.split_off(..8)?.as_chunks() else {
                return None;
            };
            Some((
                rest.split_off(..u32::from_ne_bytes(name_len) as usize)?,
                rest.split_off(..u32::from_ne_bytes(value_len) as usize)?,
            ))
        })
    }
}

#[derive(Default)]
pub(super) struct RecentStreams {
    ids: Vec<u32>,
    oldest: usize,
}

impl RecentStreams {
    pub(super) fn add(&mut self, id: u32) {
        if self.ids.len() < MAX_CONCURRENT_STREAMS {
            self.ids.push(id);
        } else if let Some(oldest) = self.ids.get_mut(self.oldest) {
            *oldest = id;
            self.oldest = (self.oldest + 1) % MAX_CONCURRENT_STREAMS;
        }
    }

    pub(super) fn contains(&self, id: u32) -> bool {
        self.ids.contains(&id)
    }
}

/// What a connection sends.
pub(super) struct Output {
    pub(super) queue: Queue,
    /// It is the one of the server.
    pub(super) is_queue_shared: bool,
    /// Bytes that the frames of the peer made us queue.
    pub(super) queued_control: usize,
    /// In `queue`, of the last of them.
    control_end: usize,
    pub(super) has_stream_bytes: bool,
    pub(super) max_frame_size: u32,
    pub(super) window: i64,
    /// What one stream may send in a pass over those that wait. 0 outside of one.
    pub(super) slice: usize,
    pub(super) encoder: Encoder,
    /// Frames for these may still be in flight.
    pub(super) reset_streams: RecentStreams,
}

impl Output {
    pub(super) fn new() -> Self {
        Self {
            queue: Queue::default(),
            is_queue_shared: false,
            queued_control: 0,
            control_end: 0,
            has_stream_bytes: false,
            max_frame_size: DEFAULT_MAX_FRAME_SIZE,
            window: DEFAULT_WINDOW_SIZE.into(),
            slice: 0,
            encoder: Encoder::with_history(),
            reset_streams: RecentStreams::default(),
        }
    }

    pub(super) fn frame(&mut self, kind: FrameType, flags: u8, stream: u32, payload: &[u8]) {
        let bytes = self.queue.reserve(FrameHeader::BYTE_SIZE + payload.len());
        bytes.extend_from_slice(&frame_header(kind, flags, stream, payload.len()));
        bytes.extend_from_slice(payload);
    }

    pub(super) fn control_frame(
        &mut self,
        kind: FrameType,
        flags: u8,
        stream: u32,
        payload: &[u8],
    ) {
        self.queued_control += FrameHeader::BYTE_SIZE + payload.len();
        self.frame(kind, flags, stream, payload);
        self.control_end = self.queue.len();
    }

    pub(super) fn window_update(&mut self, stream: u32, increment: u32) {
        let payload = increment.to_be_bytes();
        self.control_frame(FrameType::HTTP_FRAME_WINDOW_UPDATE, 0, stream, &payload);
    }

    pub(super) fn rst_stream(&mut self, stream: u32, code: ErrorCode) {
        self.reset_streams.add(stream);
        let payload = code.0.to_be_bytes();
        self.control_frame(FrameType::HTTP_FRAME_RST_STREAM, 0, stream, &payload);
    }

    pub(super) fn header_block(
        &mut self,
        stream: u32,
        fields: &Fields,
        indexing: Indexing,
        ends_stream: bool,
    ) {
        // If the encoder had to grow it, it would keep what was sent.
        let bytes = self.queue.reserve(fields.0.len() + 128);
        let header_start = bytes.len();
        bytes.extend_from_slice(&[0; FrameHeader::BYTE_SIZE]);
        let start = bytes.len();
        let mut block = self.encoder.block(bytes);
        for (name, value) in fields.iter() {
            block.field(name, value, indexing);
        }

        let max_len = self.max_frame_size as usize;
        let len = max_len.min(bytes.len() - start);
        let rest = bytes.split_off(start + len);
        let end_headers = |is_last| if is_last { END_HEADERS } else { 0 };
        let flags = end_headers(rest.is_empty()) | if ends_stream { END_STREAM } else { 0 };
        if let Some(header) = bytes.get_mut(header_start..start) {
            let kind = FrameType::HTTP_FRAME_HEADERS;
            header.copy_from_slice(&frame_header(kind, flags, stream, len));
        }

        let mut fragments = rest.chunks(max_len);
        while let Some(fragment) = fragments.next() {
            let flags = end_headers(fragments.len() == 0);
            self.frame(FrameType::HTTP_FRAME_CONTINUATION, flags, stream, fragment);
        }
    }

    pub(super) fn room_below_high_water_mark(&self) -> usize {
        HIGH_WATER_MARK.saturating_sub(self.queue.len())
    }

    pub(super) fn can_send_data(&self) -> bool {
        self.window > 0 && self.queue.len() < HIGH_WATER_MARK
    }

    /// As much of `body` as may go now. Returns how much that is.
    pub(super) fn data(
        &mut self,
        stream: u32,
        stream_window: i32,
        body: &[u8],
        ends_stream: bool,
    ) -> usize {
        let window = self.window.min(stream_window.into()).max(0) as usize;
        let slice = if self.slice == 0 {
            usize::MAX
        } else {
            self.slice
        };
        let allowed = (body.len().min(window))
            .min(self.room_below_high_water_mark())
            .min(slice);
        if allowed == 0 && !body.is_empty() {
            return 0;
        }
        let max_frame_size = self.max_frame_size as usize;
        (self.queue).reserve(allowed + FrameHeader::BYTE_SIZE * (allowed / max_frame_size + 1));
        let ends_stream = ends_stream && allowed == body.len();
        let mut rest = body.get(..allowed).unwrap_or_default();
        loop {
            let payload;
            (payload, rest) = rest.split_at(rest.len().min(max_frame_size));
            let is_last = ends_stream && rest.is_empty();
            let flags = if is_last { END_STREAM } else { 0 };
            self.frame(FrameType::HTTP_FRAME_DATA, flags, stream, payload);
            if rest.is_empty() {
                break;
            }
        }
        self.window -= allowed as i64;
        self.has_stream_bytes |= allowed != 0;
        allowed
    }

    pub(super) fn wrote(&mut self, len: usize) {
        if self.is_queue_shared {
            self.queue.consume(len);
        } else {
            self.queue.erase(len);
        }
        self.control_end = self.control_end.saturating_sub(len);
        if self.control_end == 0 {
            self.queued_control = 0;
        }
    }
}
