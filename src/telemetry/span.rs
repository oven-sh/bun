//! Span identity.

use core::fmt;

use crate::ScopeId;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct TraceId(pub [u8; 16]);

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct SpanId(pub [u8; 8]);

/// One per VM, seeded from the OS: two workers must never draw the same ids.
pub struct IdRng(bun_core::rand::DefaultPrng);

impl IdRng {
    pub fn new(seed: [u64; 4]) -> IdRng {
        IdRng(bun_core::rand::DefaultPrng::from_state(seed))
    }

    /// Never zero: W3C trace context reserves the all-zero id.
    #[inline(always)]
    fn next(&mut self) -> [u8; 8] {
        loop {
            let v = self.0.next_u64();
            if v != 0 {
                return v.to_be_bytes();
            }
        }
    }
}

impl TraceId {
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

/// The W3C sampled flag, and Bun's own bits above it.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct Flags(u8);

impl Flags {
    const SAMPLED: u8 = 0x01;
    const HANDED_TO_SCRIPT: u8 = 0x08;
    const REMOTE: u8 = 0x10;
    const PARENT_REMOTE: u8 = 0x20;
    /// Never exported, but keeps the sampled bit for its children.
    const NON_RECORDING: u8 = 0x40;
    const ENDED: u8 = 0x80;

    /// Of a `traceparent` flags byte or an api `traceFlags`, only the sampled bit survives.
    #[inline]
    pub const fn from_w3c(byte: u8) -> Flags {
        Flags(byte & Self::SAMPLED)
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
    pub const fn with_ended(self) -> Flags {
        Flags(self.0 | Self::ENDED)
    }
    #[inline]
    pub const fn with_handed_to_script(self) -> Flags {
        Flags(self.0 | Self::HANDED_TO_SCRIPT)
    }
    #[inline]
    pub fn handed_to_script(self) -> bool {
        self.0 & Self::HANDED_TO_SCRIPT != 0
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
    pub fn ended(self) -> bool {
        self.0 & Self::ENDED != 0
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
        self.0 & Self::SAMPLED
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
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

/// The fixed-size part of a span.
#[derive(Clone, Copy, Debug)]
pub struct SpanStub {
    pub ctx: SpanContext,
    pub parent: SpanId,
    pub start_ns: u64,
    pub kind: SpanKind,
    pub scope: ScopeId,
}

impl SpanStub {
    /// Carries `ctx` to its children and is never recorded.
    pub fn carrier(ctx: SpanContext, remote: bool) -> SpanStub {
        let flags = Flags::sampled_only(ctx.flags.sampled()).with_non_recording();
        SpanStub {
            ctx: SpanContext {
                flags: if remote { flags.with_remote() } else { flags },
                ..ctx
            },
            parent: SpanId::INVALID,
            start_ns: 0,
            kind: SpanKind::Internal,
            scope: ScopeId::USER,
        }
    }

    #[inline]
    pub fn is_recording(&self) -> bool {
        self.ctx.flags.0 & (Flags::SAMPLED | Flags::NON_RECORDING | Flags::ENDED) == Flags::SAMPLED
    }

    /// A child of `parent`, or a new root when it is `None` or invalid.
    #[inline]
    #[optimize(speed)]
    pub fn start(
        rng: &mut IdRng,
        parent: Option<&SpanContext>,
        sampler: &crate::Sampler,
        scope: ScopeId,
        kind: SpanKind,
        now_ns: u64,
    ) -> SpanStub {
        let parent = parent.filter(|p| p.is_valid());
        let (trace_id, parent_id, parent_remote) = match parent {
            Some(p) => (p.trace_id, p.span_id, p.flags.remote()),
            None => {
                let mut t = [0u8; 16];
                t[..8].copy_from_slice(&rng.next());
                t[8..].copy_from_slice(&rng.next());
                (TraceId(t), SpanId::INVALID, false)
            }
        };
        if parent.is_none() || parent_remote {
            crate::clock::reanchor(now_ns);
        }
        let sampled = Flags::sampled_only(sampler.should_sample(parent, &trace_id));
        SpanStub {
            ctx: SpanContext {
                trace_id,
                span_id: SpanId(rng.next()),
                flags: if parent_remote {
                    sampled.with_parent_remote()
                } else {
                    sampled
                },
            },
            parent: parent_id,
            start_ns: now_ns,
            kind,
            scope,
        }
    }
}

const _: () = assert!(core::mem::size_of::<SpanStub>() == 48);
