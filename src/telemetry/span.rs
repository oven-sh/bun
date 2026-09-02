//! Span identity and the tiny inline record native integrations carry.

use core::fmt;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
#[repr(C)]
pub struct TraceId(pub [u8; 16]);

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
#[repr(C)]
pub struct SpanId(pub [u8; 8]);

/// Ids come from the per-VM PRNG (`Local::rng`, `bun_core::rand::DefaultPrng`
/// seeded per thread from OS entropy). Zero is re-drawn: an all-zero id is
/// invalid in W3C trace context.
pub type IdRng = Option<bun_core::rand::DefaultPrng>;

#[inline(always)]
fn next_ids(rng: &mut IdRng, out: &mut [u64]) {
    // Seeded per thread from the OS (not `fast_random`, whose per-thread
    // streams start from one process-wide seed): two workers must never
    // produce the same trace/span id sequence.
    let r = rng.get_or_insert_with(|| {
        let mut seed = [0u8; 8];
        bun_core::os_entropy(&mut seed);
        bun_core::rand::DefaultPrng::init(u64::from_ne_bytes(seed))
    });
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

impl TraceId {
    pub const INVALID: TraceId = TraceId([0; 16]);
    #[inline]
    pub fn is_valid(&self) -> bool {
        self.0 != [0; 16]
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
    pub fn to_hex(self, out: &mut [u8; 16]) {
        bun_core::fmt::bytes_to_hex_lower(&self.0, out);
    }
    pub fn from_hex(s: &[u8]) -> Option<SpanId> {
        let mut id = [0u8; 8];
        hex_decode(s, &mut id)?;
        let s = SpanId(id);
        if s.is_valid() { Some(s) } else { None }
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

/// W3C trace-flags (low nibble) plus Bun's own bits above it. The byte is
/// private: a foreign byte enters only through [`Flags::from_w3c`] /
/// [`Flags::from_link_byte`], which keep nothing Bun did not define.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
#[repr(transparent)]
pub struct Flags(u8);

impl Flags {
    // TelemetryABI.h `TelemetrySpanStub` and TelemetrySpan.ts (link isRemote = 0x10) mirror these.
    pub const SAMPLED: u8 = 0x01;
    /// Context arrived from a remote parent (traceparent header).
    pub const REMOTE: u8 = 0x10;
    /// This (local) span's parent was remote. Feeds OTLP `Span.flags` bit 9.
    pub const PARENT_REMOTE: u8 = 0x20;
    /// A propagation-only wrapper around a (usually remote) context: never
    /// exported, but keeps the sampled bit so children inherit the decision.
    pub const NON_RECORDING: u8 = 0x40;
    /// Marks the carrier that `context.with(suppressTracing(ctx))` makes
    /// active: nothing (root or child) starts under it.
    pub const SUPPRESSED: u8 = 0x80;

    pub const NONE: Flags = Flags(0);

    /// A `traceparent` flags byte or an api `traceFlags` number: only the
    /// sampled bit survives.
    #[inline]
    pub const fn from_w3c(byte: u8) -> Flags {
        Flags(byte & Self::SAMPLED)
    }
    /// TelemetrySpan.ts `telemetryAddOneLink`'s encoding: low nibble W3C,
    /// 0x10 = the linked context is remote.
    #[inline]
    pub const fn from_link_byte(byte: u8) -> Flags {
        Flags(byte & (Self::SAMPLED | Self::REMOTE))
    }
    #[inline]
    pub const fn sampled_only(sampled: bool) -> Flags {
        Flags(sampled as u8)
    }
    #[inline]
    pub const fn with_remote(self) -> Flags {
        Flags(self.0 | Self::REMOTE)
    }
    #[inline]
    pub const fn with_parent_remote(self) -> Flags {
        Flags(self.0 | Self::PARENT_REMOTE)
    }
    #[inline]
    pub const fn with_non_recording(self) -> Flags {
        Flags(self.0 | Self::NON_RECORDING)
    }
    #[inline]
    pub const fn with_suppressed(self) -> Flags {
        Flags(self.0 | Self::SUPPRESSED)
    }
    /// The whole byte (Bun's own serialisation in [`SpanStub::to_bytes`]).
    #[inline]
    pub const fn bits(self) -> u8 {
        self.0
    }
    #[inline]
    pub fn non_recording(self) -> bool {
        self.0 & Self::NON_RECORDING != 0
    }
    #[inline]
    pub fn sampled(self) -> bool {
        self.0 & Self::SAMPLED != 0
    }
    #[inline]
    pub fn remote(self) -> bool {
        self.0 & Self::REMOTE != 0
    }
    #[inline]
    pub fn suppressed(self) -> bool {
        self.0 & Self::SUPPRESSED != 0
    }
    #[inline]
    pub fn parent_remote(self) -> bool {
        self.0 & Self::PARENT_REMOTE != 0
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

impl StatusCode {
    /// From an `@opentelemetry/api` `SpanStatusCode` (UNSET 0, OK 1, ERROR 2);
    /// anything else is Unset.
    #[inline]
    pub const fn from_api(code: u8) -> StatusCode {
        match code {
            1 => StatusCode::Ok,
            2 => StatusCode::Error,
            _ => StatusCode::Unset,
        }
    }
}

/// What a native integration embeds inline in the struct that represents the
/// in-flight operation. 48 bytes; no heap, no Drop. `NONE` (all zero) means
/// "no span" so `Option<SpanStub>` isn't needed at integration sites; a
/// propagation-only carrier has ids and flags but no start time.
#[derive(Clone, Copy, Default, Debug)]
#[repr(C)]
pub struct SpanStub {
    pub ctx: SpanContext,
    pub parent: SpanId,
    pub start_ns: u64,
}

impl SpanStub {
    /// Byte form for carrying a stub through JS (node:http keeps it on the
    /// request between begin and end). Layout: trace_id, span_id, parent,
    /// flags, start_ns (LE).
    pub const BYTES: usize = 16 + 8 + 8 + 1 + 8;
    pub fn to_bytes(&self) -> [u8; Self::BYTES] {
        let mut b = [0u8; Self::BYTES];
        b[..16].copy_from_slice(&self.ctx.trace_id.0);
        b[16..24].copy_from_slice(&self.ctx.span_id.0);
        b[24..32].copy_from_slice(&self.parent.0);
        b[32] = self.ctx.flags.bits();
        b[33..41].copy_from_slice(&self.start_ns.to_le_bytes());
        b
    }
    pub fn from_bytes(b: &[u8]) -> Option<SpanStub> {
        if b.len() != Self::BYTES {
            return None;
        }
        let mut s = SpanStub::NONE;
        s.ctx.trace_id.0.copy_from_slice(&b[..16]);
        s.ctx.span_id.0.copy_from_slice(&b[16..24]);
        s.parent.0.copy_from_slice(&b[24..32]);
        s.ctx.flags = Flags(b[32]);
        s.start_ns = u64::from_le_bytes(b[33..41].try_into().ok()?);
        Some(s)
    }

    pub const NONE: SpanStub = SpanStub {
        ctx: SpanContext {
            trace_id: TraceId::INVALID,
            span_id: SpanId::INVALID,
            flags: Flags::NONE,
        },
        parent: SpanId::INVALID,
        start_ns: 0,
    };

    /// A propagation-only wrapper around `ctx` (`remote`: it arrived in a
    /// traceparent): never recorded or exported, keeps the sampled bit so
    /// children inherit the decision.
    pub fn carrier(ctx: SpanContext, remote: bool) -> SpanStub {
        let flags = Flags::sampled_only(ctx.flags.sampled()).with_non_recording();
        SpanStub {
            ctx: SpanContext {
                flags: if remote { flags.with_remote() } else { flags },
                ..ctx
            },
            parent: SpanId::INVALID,
            start_ns: 0,
        }
    }

    /// The carrier `context.with(suppressTracing(ctx), …)` activates: nothing
    /// (root or child) starts under it.
    pub fn suppressed() -> SpanStub {
        let mut s = SpanStub::carrier(SpanStub::NONE.ctx, false);
        s.ctx.flags = s.ctx.flags.with_suppressed();
        s
    }

    /// Not `NONE`: a started span or a carrier.
    #[inline]
    pub fn is_some(&self) -> bool {
        self.start_ns != 0 || self.ctx.flags.non_recording()
    }

    #[inline]
    pub fn is_recording(&self) -> bool {
        self.start_ns != 0 && self.ctx.flags.sampled() && !self.ctx.flags.non_recording()
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
        // The first span of a trace in this process (a root, or the child of a
        // remote parent) is where the epoch offset gets re-measured (see
        // clock.rs); this span keeps the time it was given.
        if parent_id == SpanId::INVALID || parent_remote {
            crate::clock::reanchor(now_ns);
        }
        let sampled = Flags::sampled_only(sampler.should_sample(parent, &trace_id));
        SpanStub {
            ctx: SpanContext {
                trace_id,
                span_id: SpanId(ids[0].to_be_bytes()),
                flags: if parent_remote {
                    sampled.with_parent_remote()
                } else {
                    sampled
                },
            },
            parent: parent_id,
            start_ns: now_ns,
        }
    }
}

const _: () = assert!(core::mem::size_of::<SpanStub>() == 48);
