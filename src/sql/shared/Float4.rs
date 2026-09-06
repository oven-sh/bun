//! MySQL `FLOAT` and PostgreSQL `float4`/`real` columns are 4-byte floats on
//! the wire in the binary protocol, while a JS number is an 8-byte float.

/// The f64 that JS gets for a 4-byte float column: the shortest decimal that
/// identifies `value` among f32s, read as an f64. `0.1f32` gives `0.1`, where
/// `value as f64` gives `0.10000000149011612` (the f32's exact binary value).
/// The shortest decimal is what the server prints for the column in the text
/// protocol, so a column reads the same whether its row arrived as text or
/// binary, and a stored literal with 7 or fewer significant digits reads back
/// as itself.
pub fn to_f64(value: f32) -> f64 {
    if !value.is_finite() {
        return value as f64;
    }
    // `{:e}` writes the shortest digits that parse back to the same f32: at
    // most 9 significant digits plus sign, point and exponent.
    let mut buf = [0u8; 24];
    match bun_core::fmt::buf_print(&mut buf, format_args!("{:e}", value)) {
        Ok(text) => bun_core::fmt::parse_f64(text).unwrap_or(value as f64),
        Err(_) => value as f64,
    }
}
