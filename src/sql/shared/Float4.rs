//! Binary-protocol `FLOAT` (MySQL) and `float4` (PostgreSQL) cells are f32.

use bun_core::fmt::{buf_print, parse_f64};

/// The shortest decimal that identifies `value` among its f32 neighbours, read
/// as an f64: `0.1f32` gives `0.1`, not the `0.10000000149011612` of `value as
/// f64`. A decimal exactly halfway to a neighbour is not used even though it
/// parses back to `value`, so `61885352f32` stays `61885352` rather than
/// `61885350`; this is the number PostgreSQL's `float4out` prints.
pub fn to_f64(value: f32) -> f64 {
    let wide = value as f64;
    if !value.is_finite() {
        return wide;
    }
    let mut buf = [0u8; 32];
    let Ok(text) = buf_print(&mut buf, format_args!("{:e}", value)) else {
        return wide;
    };
    let digits = text
        .iter()
        .take_while(|&&b| b != b'e')
        .filter(|b| b.is_ascii_digit())
        .count();
    if let Some(shortest) = parse_f64(text) {
        if !is_midpoint(value, shortest) {
            return shortest;
        }
    }
    // `{:e}` accepts a halfway decimal (round-half-even parses it back), so
    // add digits until the correctly rounded form is strictly inside.
    for precision in digits..9 {
        let Ok(text) = buf_print(&mut buf, format_args!("{:.*e}", precision, value)) else {
            break;
        };
        if let Some(longer) = parse_f64(text) {
            if longer as f32 == value && !is_midpoint(value, longer) {
                return longer;
            }
        }
    }
    wide
}

/// Whether `candidate` lies exactly halfway between `value` and an f32
/// neighbour (both midpoints are exact in f64).
fn is_midpoint(value: f32, candidate: f64) -> bool {
    let wide = value as f64;
    candidate == (wide + value.next_down() as f64) / 2.0
        || candidate == (wide + value.next_up() as f64) / 2.0
}
