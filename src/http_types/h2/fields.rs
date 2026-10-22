//! Checks on the fields of an inbound HTTP/2 header block (RFC 9113 §8.2).

/// Returns true unless `name` is lowercase token characters, after the ":" of a pseudo-header (§8.2.1).
pub fn is_malformed_name(name: &[u8]) -> bool {
    let rest = name.strip_prefix(b":").unwrap_or(name);
    rest.is_empty()
        || !rest
            .iter()
            .all(|&c| crate::is_token_char(c) && !c.is_ascii_uppercase())
}

/// Returns true if `value` has a NUL, CR or LF (§8.2.1).
#[inline]
pub fn is_malformed_value(value: &[u8]) -> bool {
    value.iter().any(|c| matches!(c, 0 | b'\r' | b'\n'))
}

/// Returns true if `value` has a control byte other than HTAB (RFC 9110 §5.5).
#[inline]
pub fn has_control_byte(value: &[u8]) -> bool {
    value.iter().any(|&c| (c < b' ' && c != b'\t') || c == 0x7f)
}

/// Returns true if `value` starts or ends with SP or HTAB (§8.2.1).
#[inline]
pub fn has_edge_whitespace(value: &[u8]) -> bool {
    matches!(value.first(), Some(b' ' | b'\t')) || matches!(value.last(), Some(b' ' | b'\t'))
}

/// Returns true for the connection-specific fields that make a block malformed (§8.2.2). `te` depends on its value.
#[inline]
pub fn is_connection_specific(name: &[u8]) -> bool {
    matches!(
        name,
        b"connection" | b"keep-alive" | b"proxy-connection" | b"transfer-encoding" | b"upgrade"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        for name in [&b"accept"[..], b":path", b"x-1_2", b"a"] {
            assert!(!is_malformed_name(name), "{name:?}");
        }
        for name in [&b""[..], b":", b"Accept", b"a b", b"a:b", b"::a", b"a\0"] {
            assert!(is_malformed_name(name), "{name:?}");
        }
    }

    #[test]
    fn values() {
        assert!(!is_malformed_value(b"a\tb \x7f"));
        assert!(is_malformed_value(b"a\r"));
        assert!(is_malformed_value(b"\n"));
        assert!(is_malformed_value(b"a\0b"));
        assert!(has_control_byte(b"a\x7f"));
        assert!(has_control_byte(b"\x01"));
        assert!(!has_control_byte(b"a\tb"));
        assert!(has_edge_whitespace(b" a"));
        assert!(has_edge_whitespace(b"a\t"));
        assert!(!has_edge_whitespace(b"a b"));
        assert!(!has_edge_whitespace(b""));
    }
}
