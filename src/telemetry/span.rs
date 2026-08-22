//! Span identity and the tiny inline record native integrations carry.

use core::fmt;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
#[repr(C)]
pub struct TraceId(pub [u8; 16]);

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
#[repr(C)]
pub struct SpanId(pub [u8; 8]);

/// Ids come from the per-VM PRNG (`Local::rng`, `bun_core::rand::DefaultPrng`
/// seeded from the process CSPRNG-backed `fast_random`). Zero is re-drawn: an
/// all-zero id is invalid in W3C trace context.
pub type IdRng = Option<bun_core::rand::DefaultPrng>;

#[inline(always)]
fn next_ids(rng: &mut IdRng, out: &mut [u64]) {
    let r = rng.get_or_insert_with(|| bun_core::rand::DefaultPrng::init(bun_core::fast_random()));
    for o in out.iter_mut() {
        loop {
            let v = r.next_u64();
            if v != 0 {
                *o = v;
                break;
            }
        }
    }
}

#[inline(always)]
fn next_id_u64(rng: &mut IdRng) -> u64 {
    let mut v = [0u64; 1];
    next_ids(rng, &mut v);
    v[0]
}

impl TraceId {
    pub const INVALID: TraceId = TraceId([0; 16]);
    #[inline]
    pub fn is_valid(&self) -> bool {
        self.0 != [0; 16]
    }
    /// Random 128-bit id from `rng` (see [`crate::Local`]). The W3C/OTel spec
    /// only requires uniqueness with high probability; samplers read the low 8
    /// bytes as a uniform integer, which xoshiro256++ provides.
    #[inline]
    pub fn generate(rng: &mut IdRng) -> TraceId {
        let mut v = [0u64; 2];
        next_ids(rng, &mut v);
        let mut id = [0u8; 16];
        id[..8].copy_from_slice(&v[0].to_be_bytes());
        id[8..].copy_from_slice(&v[1].to_be_bytes());
        TraceId(id)
    }
    pub fn to_hex(&self, out: &mut [u8; 32]) {
        bun_core::fmt::bytes_to_hex_lower(&self.0, out);
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
    pub fn generate(rng: &mut IdRng) -> SpanId {
        SpanId(next_id_u64(rng).to_be_bytes())
    }
    pub fn to_hex(self, out: &mut [u8; 16]) {
        bun_core::fmt::bytes_to_hex_lower(&self.0, out);
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

fn hex_decode(src: &[u8], dst: &mut [u8]) -> Option<()> {
    // W3C traceparent is lowercase-only (checked by the caller); user input may be either.
    if src.len() != dst.len() * 2 {
        return None;
    }
    bun_core::strings::decode_hex_to_bytes(dst, src).ok()?;
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
    /// OTLP `Span.flags`: low byte = W3C flags, 0x100 = is-remote known,
    /// 0x200 = parent is remote.
    #[inline]
    pub fn otlp(self) -> u32 {
        self.otlp_with_remote(self.parent_remote())
    }
    /// OTLP `SpanFlags` with an explicit is-remote bit (links carry their own).
    #[inline]
    pub fn otlp_with_remote(self, remote: bool) -> u32 {
        (self.w3c() as u32) | 0x100 | if remote { 0x200 } else { 0 }
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

/// Discriminants are the OTLP `Span.SpanKind` values.
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

impl SpanKind {
    /// From an `@opentelemetry/api` `SpanKind` (INTERNAL = 0 … CONSUMER = 4).
    #[inline]
    pub const fn from_api(k: u8) -> SpanKind {
        match k {
            1 => SpanKind::Server,
            2 => SpanKind::Client,
            3 => SpanKind::Producer,
            4 => SpanKind::Consumer,
            _ => SpanKind::Internal,
        }
    }
    #[inline]
    pub const fn to_api(self) -> u8 {
        self as u8 - 1
    }
    /// From the OTLP wire value.
    #[inline]
    pub const fn from_otlp(k: u8) -> SpanKind {
        SpanKind::from_api(k.wrapping_sub(1))
    }
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
    pub fn start(
        rng: &mut IdRng,
        parent: Option<&SpanContext>,
        sampler: &crate::Sampler,
        now_ns: u64,
    ) -> SpanStub {
        let mut ids = [0u64; 3];
        let (trace_id, parent_id, parent_remote) = match parent {
            Some(p) if p.is_valid() => {
                next_ids(rng, &mut ids[..1]);
                (p.trace_id, p.span_id, p.flags.remote())
            }
            _ => {
                next_ids(rng, &mut ids);
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
