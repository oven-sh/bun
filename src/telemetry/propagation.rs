//! W3C Trace Context (`traceparent` / `tracestate`) and Baggage header
//! handling. https://www.w3.org/TR/trace-context/

use crate::span::{Flags, SpanContext, SpanId, TraceId};

pub const TRACEPARENT_LEN: usize = 55;

/// Parse `00-<32 hex>-<16 hex>-<2 hex>`. Future versions (`!= 00`) are parsed
/// per the spec's forward-compat rule: same layout, extra trailing fields
/// allowed. Version `ff` is invalid.
pub fn parse_traceparent(h: &[u8]) -> Option<SpanContext> {
    let h = trim(h);
    if h.len() < TRACEPARENT_LEN {
        return None;
    }
    let version = hex_byte(h[0], h[1])?;
    if version == 0xff {
        return None;
    }
    if h[2] != b'-' || h[35] != b'-' || h[52] != b'-' {
        return None;
    }
    if version == 0 && h.len() != TRACEPARENT_LEN {
        return None;
    }
    if version != 0 && h.len() > TRACEPARENT_LEN && h[55] != b'-' {
        return None;
    }
    // Spec: lowercase hex only.
    if h[..TRACEPARENT_LEN].iter().any(|c| matches!(c, b'A'..=b'F')) {
        return None;
    }
    let trace_id = TraceId::from_hex(&h[3..35])?;
    let span_id = SpanId::from_hex(&h[36..52])?;
    let flags = hex_byte(h[53], h[54])?;
    Some(SpanContext { trace_id, span_id, flags: Flags((flags & Flags::SAMPLED) | Flags::REMOTE) })
}

pub fn format_traceparent(ctx: &SpanContext, out: &mut [u8; TRACEPARENT_LEN]) {
    out[0] = b'0';
    out[1] = b'0';
    out[2] = b'-';
    let mut t = [0u8; 32];
    ctx.trace_id.to_hex(&mut t);
    out[3..35].copy_from_slice(&t);
    out[35] = b'-';
    let mut s = [0u8; 16];
    ctx.span_id.to_hex(&mut s);
    out[36..52].copy_from_slice(&s);
    out[52] = b'-';
    let f = ctx.flags.w3c();
    out[53] = b"0123456789abcdef"[(f >> 4) as usize];
    out[54] = b"0123456789abcdef"[(f & 0xf) as usize];
}

#[inline]
fn hex_byte(a: u8, b: u8) -> Option<u8> {
    fn v(c: u8) -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            _ => None,
        }
    }
    Some((v(a)? << 4) | v(b)?)
}

#[inline]
fn trim(mut s: &[u8]) -> &[u8] {
    while let [b' ' | b'\t', rest @ ..] = s {
        s = rest;
    }
    while let [rest @ .., b' ' | b'\t'] = s {
        s = rest;
    }
    s
}

/// Validate a `tracestate` header enough to decide whether to forward it.
/// We don't interpret entries; we only refuse to propagate garbage. The spec
/// caps the list at 32 members and 512 bytes is the recommended budget.
pub fn tracestate_is_reasonable(h: &[u8]) -> bool {
    let h = trim(h);
    !h.is_empty() && h.len() <= 512 && h.iter().all(|&c| c >= 0x20 && c < 0x7f) && h.split(|&c| c == b',').count() <= 32
}

/// Same idea for `baggage` (W3C Baggage): forward opaque, bounded, printable.
pub fn baggage_is_reasonable(h: &[u8]) -> bool {
    let h = trim(h);
    !h.is_empty() && h.len() <= 8192 && h.iter().all(|&c| c >= 0x20 && c < 0x7f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let h = b"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        let ctx = parse_traceparent(h).unwrap();
        assert!(ctx.flags.sampled());
        assert!(ctx.flags.remote());
        let mut out = [0u8; TRACEPARENT_LEN];
        format_traceparent(&ctx, &mut out);
        assert_eq!(&out[..], &h[..]);
    }

    #[test]
    fn rejects() {
        assert!(parse_traceparent(b"00-00000000000000000000000000000000-00f067aa0ba902b7-01").is_none());
        assert!(parse_traceparent(b"00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01").is_none());
        assert!(parse_traceparent(b"ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01").is_none());
        assert!(parse_traceparent(b"00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01").is_none());
        assert!(parse_traceparent(b"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra").is_none());
        assert!(parse_traceparent(b"01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra").is_some());
        assert!(parse_traceparent(b"01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01.extra").is_none());
    }
}
