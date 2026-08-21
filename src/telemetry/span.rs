//! Span identity and the tiny inline record native integrations carry.

use core::fmt;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
#[repr(C)]
pub struct TraceId(pub [u8; 16]);

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
#[repr(C)]
pub struct SpanId(pub [u8; 8]);

/// Per-thread xoshiro256++ for span/trace ids, seeded from the process PRNG.
/// Fills `out` with non-zero values in one thread-local access.
#[inline(always)]
fn next_ids(out: &mut [u64]) {
    use core::cell::Cell;
    thread_local! {
        static S: Cell<[u64; 4]> = const { Cell::new([0; 4]) };
    }
    S.with(|c| {
        let mut s = c.get();
        if s[0] | s[1] | s[2] | s[3] == 0 {
            s = [
                bun_core::fast_random() | 1,
                bun_core::fast_random(),
                bun_core::fast_random(),
                bun_core::fast_random(),
            ];
        }
        for o in out.iter_mut() {
            loop {
                let result = (s[0].wrapping_add(s[3])).rotate_left(23).wrapping_add(s[0]);
                let t = s[1] << 17;
                s[2] ^= s[0];
                s[3] ^= s[1];
                s[1] ^= s[2];
                s[0] ^= s[3];
                s[2] ^= t;
                s[3] = s[3].rotate_left(45);
                if result != 0 {
                    *o = result;
                    break;
                }
            }
        }
        c.set(s);
    })
}

#[inline(always)]
fn next_id_u64() -> u64 {
    let mut v = [0u64; 1];
    next_ids(&mut v);
    v[0]
}

impl TraceId {
    pub const INVALID: TraceId = TraceId([0; 16]);
    #[inline]
    pub fn is_valid(&self) -> bool {
        self.0 != [0; 16]
    }
    /// Random 128-bit id from the thread-local PRNG. The W3C/OTel spec only
    /// requires uniqueness with high probability; samplers read the low 8
    /// bytes as a uniform integer, which xoshiro provides.
    #[inline]
    pub fn generate() -> TraceId {
        let mut v = [0u64; 2];
        next_ids(&mut v);
        let mut id = [0u8; 16];
        id[..8].copy_from_slice(&v[0].to_be_bytes());
        id[8..].copy_from_slice(&v[1].to_be_bytes());
        TraceId(id)
    }
    pub fn to_hex(&self, out: &mut [u8; 32]) {
        hex_encode(&self.0, out);
    }
    pub fn from_hex(s: &[u8]) -> Option<TraceId> {
        let mut id = [0u8; 16];
        hex_decode(s, &mut id)?;
        let t = TraceId(id);
        if t.is_valid() { Some(t) } else { None }
    }
    /// Low 8 bytes, big-endian — what TraceIdRatioBased samplers compare.
    #[inline]
    pub fn low_u64(&self) -> u64 {
        u64::from_be_bytes(self.0[8..16].try_into().unwrap())
    }
}

impl SpanId {
    pub const INVALID: SpanId = SpanId([0; 8]);
    #[inline]
    pub fn is_valid(self) -> bool {
        self.0 != [0; 8]
    }
    #[inline]
    pub fn generate() -> SpanId {
        SpanId(next_id_u64().to_be_bytes())
    }
    pub fn to_hex(self, out: &mut [u8; 16]) {
        hex_encode(&self.0, out);
    }
    pub fn from_hex(s: &[u8]) -> Option<SpanId> {
        let mut id = [0u8; 8];
        hex_decode(s, &mut id)?;
        let s = SpanId(id);
        if s.is_valid() { Some(s) } else { None }
    }
    #[inline]
    pub fn as_u64(self) -> u64 {
        u64::from_be_bytes(self.0)
    }
    #[inline]
    pub fn from_u64(v: u64) -> SpanId {
        SpanId(v.to_be_bytes())
    }
}

const HEX: &[u8; 16] = b"0123456789abcdef";

fn hex_encode(src: &[u8], dst: &mut [u8]) {
    debug_assert!(dst.len() >= src.len() * 2);
    for (i, b) in src.iter().enumerate() {
        dst[i * 2] = HEX[(b >> 4) as usize];
        dst[i * 2 + 1] = HEX[(b & 0xf) as usize];
    }
}

#[inline]
fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        // W3C traceparent is lowercase-only; accept uppercase for user input.
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn hex_decode(src: &[u8], dst: &mut [u8]) -> Option<()> {
    if src.len() != dst.len() * 2 {
        return None;
    }
    for i in 0..dst.len() {
        dst[i] = (hex_val(src[i * 2])? << 4) | hex_val(src[i * 2 + 1])?;
    }
    Some(())
}

impl fmt::Debug for TraceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut b = [0u8; 32];
        self.to_hex(&mut b);
        f.write_str(core::str::from_utf8(&b).unwrap())
    }
}
impl fmt::Debug for SpanId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut b = [0u8; 16];
        self.to_hex(&mut b);
        f.write_str(core::str::from_utf8(&b).unwrap())
    }
}

/// W3C trace-flags byte plus our own bits above it.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
#[repr(transparent)]
pub struct Flags(pub u8);

impl Flags {
    pub const SAMPLED: u8 = 0x01;
    /// Context arrived from a remote parent (traceparent header).
    pub const REMOTE: u8 = 0x10;
    /// This (local) span's parent was remote. Feeds OTLP `Span.flags` bit 9.
    pub const PARENT_REMOTE: u8 = 0x20;
    /// A propagation-only wrapper around a (usually remote) context: never
    /// exported, but keeps the sampled bit so children inherit the decision.
    pub const NON_RECORDING: u8 = 0x40;
    #[inline]
    pub fn sampled(self) -> bool {
        self.0 & Self::SAMPLED != 0
    }
    #[inline]
    pub fn remote(self) -> bool {
        self.0 & Self::REMOTE != 0
    }
    #[inline]
    pub fn parent_remote(self) -> bool {
        self.0 & Self::PARENT_REMOTE != 0
    }
    #[inline]
    pub fn non_recording(self) -> bool {
        self.0 & Self::NON_RECORDING != 0
    }
    /// OTLP `SpanFlags`: low byte = W3C flags, 0x100 = has-is-remote, 0x200 = is-remote.
    #[inline]
    pub fn otlp(self) -> u32 {
        (self.w3c() as u32) | 0x100 | if self.parent_remote() { 0x200 } else { 0 }
    }
    /// The byte that goes on the wire in `traceparent` / OTLP `Span.flags`.
    #[inline]
    pub fn w3c(self) -> u8 {
        self.0 & 0x0f
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
#[repr(C)]
pub struct SpanContext {
    pub trace_id: TraceId,
    pub span_id: SpanId,
    pub flags: Flags,
}

impl SpanContext {
    #[inline]
    pub fn is_valid(&self) -> bool {
        self.trace_id.is_valid() && self.span_id.is_valid()
    }
    #[inline]
    pub fn sampled(&self) -> bool {
        self.flags.sampled()
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
#[repr(u8)]
pub enum SpanKind {
    #[default]
    Internal = 1,
    Server = 2,
    Client = 3,
    Producer = 4,
    Consumer = 5,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
#[repr(u8)]
pub enum StatusCode {
    #[default]
    Unset = 0,
    Ok = 1,
    Error = 2,
}

/// What a native integration embeds inline in the struct that represents the
/// in-flight operation. 48 bytes; no heap, no Drop. `start_ns == 0` means
/// "no span" so `Option<SpanStub>` isn't needed at integration sites.
#[derive(Clone, Copy, Default, Debug)]
#[repr(C)]
pub struct SpanStub {
    pub ctx: SpanContext,
    pub parent: SpanId,
    pub start_ns: u64,
}

impl SpanStub {
    pub const NONE: SpanStub = SpanStub {
        ctx: SpanContext {
            trace_id: TraceId::INVALID,
            span_id: SpanId::INVALID,
            flags: Flags(0),
        },
        parent: SpanId::INVALID,
        start_ns: 0,
    };

    #[inline]
    pub fn is_some(&self) -> bool {
        self.start_ns != 0
    }

    #[inline]
    pub fn is_recording(&self) -> bool {
        self.start_ns != 0
            && (self.ctx.flags.0 & (Flags::SAMPLED | Flags::NON_RECORDING)) == Flags::SAMPLED
    }

    /// Start a child of `parent` (or a new root when `parent` is None/invalid).
    #[inline]
    pub fn start(parent: Option<&SpanContext>, sampler: &crate::Sampler, now_ns: u64) -> SpanStub {
        let mut ids = [0u64; 3];
        let (trace_id, parent_id, parent_remote) = match parent {
            Some(p) if p.is_valid() => {
                next_ids(&mut ids[..1]);
                (p.trace_id, p.span_id, p.flags.remote())
            }
            _ => {
                next_ids(&mut ids);
                let mut t = [0u8; 16];
                t[..8].copy_from_slice(&ids[1].to_be_bytes());
                t[8..].copy_from_slice(&ids[2].to_be_bytes());
                (TraceId(t), SpanId::INVALID, false)
            }
        };
        let sampled = sampler.should_sample(parent, &trace_id);
        SpanStub {
            ctx: SpanContext {
                trace_id,
                span_id: SpanId(ids[0].to_be_bytes()),
                flags: Flags(
                    (sampled as u8)
                        | if parent_remote {
                            Flags::PARENT_REMOTE
                        } else {
                            0
                        },
                ),
            },
            parent: parent_id,
            start_ns: now_ns,
        }
    }
}

const _: () = assert!(core::mem::size_of::<SpanStub>() == 48);
