//! Binary-protocol `FLOAT` (MySQL) and `float4` (PostgreSQL) cells are f32.

/// The shortest decimal that round-trips to `value`, read as an f64: `0.1f32`
/// gives `0.1`, not the `0.10000000149011612` of `value as f64`. This is the
/// number the server prints for the column in the text protocol.
pub fn to_f64(value: f32) -> f64 {
    if !value.is_finite() {
        return value as f64;
    }
    // `{:e}` prints the shortest round-trip digits (at most 9) plus exponent.
    let mut buf = [0u8; 24];
    match bun_core::fmt::buf_print(&mut buf, format_args!("{:e}", value)) {
        Ok(text) => bun_core::fmt::parse_f64(text).unwrap_or(value as f64),
        Err(_) => value as f64,
    }
}
