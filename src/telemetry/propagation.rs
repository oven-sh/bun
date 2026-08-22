//! W3C Trace Context (`traceparent` / `tracestate`) and Baggage header
//! handling. https://www.w3.org/TR/trace-context/

use crate::span::{Flags, SpanContext, SpanId, TraceId};

pub const TRACEPARENT_LEN: usize = 55;

/// Parse `00-<32 hex>-<16 hex>-<2 hex>`. Future versions (`!= 00`) are parsed
/// per the spec's forward-compat rule: same layout, extra trailing fields
/// allowed. Version `ff` is invalid.
pub fn parse_traceparent(h: &[u8]) -> Option<SpanContext> {
    let h = bun_core::strings::trim(h, b" \t");
    if h.len() < TRACEPARENT_LEN {
        return None;
    }
    let hex_byte = |pair: &[u8]| -> Option<u8> {
        let mut b = [0u8; 1];
        bun_core::strings::decode_hex_to_bytes(&mut b, pair).ok()?;
        Some(b[0])
    };
    let version = hex_byte(&h[0..2])?;
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
    if h[..TRACEPARENT_LEN]
        .iter()
        .any(|c| matches!(c, b'A'..=b'F'))
    {
        return None;
    }
    let trace_id = TraceId::from_hex(&h[3..35])?;
    let span_id = SpanId::from_hex(&h[36..52])?;
    let flags = hex_byte(&h[53..55])?;
    Some(SpanContext {
        trace_id,
        span_id,
        flags: Flags((flags & Flags::SAMPLED) | Flags::REMOTE),
    })
}

pub fn format_traceparent(ctx: &SpanContext, out: &mut [u8; TRACEPARENT_LEN]) {
    out[..3].copy_from_slice(b"00-");
    bun_core::fmt::bytes_to_hex_lower(&ctx.trace_id.0, &mut out[3..35]);
    out[35] = b'-';
    bun_core::fmt::bytes_to_hex_lower(&ctx.span_id.0, &mut out[36..52]);
    out[52] = b'-';
    bun_core::fmt::bytes_to_hex_lower(&[ctx.flags.w3c()], &mut out[53..55]);
}

/// Validate a `tracestate` header enough to decide whether to forward it.
/// We don't interpret entries; we only refuse to propagate garbage. The spec
/// caps the list at 32 members and 512 bytes is the recommended budget.
pub fn tracestate_is_reasonable(h: &[u8]) -> bool {
    let h = bun_core::strings::trim(h, b" \t");
    !h.is_empty()
        && h.len() <= 512
        && h.iter().all(|&c| c == b'\t' || (c >= 0x20 && c < 0x7f))
        && bun_core::strings::split(h, b",").count() <= 32
}

/// Same idea for `baggage` (W3C Baggage): forward opaque, bounded, printable.
pub fn baggage_is_reasonable(h: &[u8]) -> bool {
    let h = bun_core::strings::trim(h, b" \t");
    !h.is_empty() && h.len() <= 8192 && h.iter().all(|&c| c == b'\t' || (c >= 0x20 && c < 0x7f))
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
        assert!(
            parse_traceparent(b"00-00000000000000000000000000000000-00f067aa0ba902b7-01").is_none()
        );
        assert!(
            parse_traceparent(b"00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01").is_none()
        );
        assert!(
            parse_traceparent(b"ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01").is_none()
        );
        assert!(
            parse_traceparent(b"00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01").is_none()
        );
        assert!(
            parse_traceparent(b"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra")
                .is_none()
        );
        assert!(
            parse_traceparent(b"01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra")
                .is_some()
        );
        assert!(
            parse_traceparent(b"01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01.extra")
                .is_none()
        );
    }
}
