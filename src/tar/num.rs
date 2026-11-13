//! Number fields. Overflow saturates, and a field ends at the first byte that is not a digit.

fn parse_base_n(field: &[u8], base: u8) -> i64 {
    let mut bytes = field.iter().copied().peekable();
    while bytes.next_if(|c| matches!(c, b' ' | b'\t')).is_some() {}
    let negative = bytes.next_if_eq(&b'-').is_some();
    let mut value: i64 = 0;
    for c in bytes {
        let digit = c.wrapping_sub(b'0');
        if digit >= base {
            break;
        }
        let digit = if negative {
            -i64::from(digit)
        } else {
            i64::from(digit)
        };
        let Some(next) = value
            .checked_mul(i64::from(base))
            .and_then(|v| v.checked_add(digit))
        else {
            return if negative { i64::MIN } else { i64::MAX };
        };
        value = next;
    }
    value
}

pub(crate) fn parse_decimal(field: &[u8]) -> i64 {
    parse_base_n(field, 10)
}

/// Big-endian two's complement whose top bit is the base-256 marker.
fn parse_base_256(field: &[u8]) -> i64 {
    let Some((&first, mut rest)) = field.split_first() else {
        return 0;
    };
    let negative = first & 0x40 != 0;
    let fill: u8 = if negative { 0xff } else { 0 };
    let saturated = if negative { i64::MIN } else { i64::MAX };
    let mut c = if negative { first | 0x80 } else { first & 0x7f };
    while rest.len() >= size_of::<i64>() {
        if c != fill {
            return saturated;
        }
        let Some((&next, tail)) = rest.split_first() else {
            break;
        };
        c = next;
        rest = tail;
    }
    if (c ^ fill) & 0x80 != 0 {
        return saturated;
    }
    let mut value: u64 = if negative { u64::MAX } else { 0 };
    value = (value << 8) | u64::from(c);
    for &b in rest {
        value = (value << 8) | u64::from(b);
    }
    value.cast_signed()
}

/// A header field: octal, or base-256 when the top bit of the first byte is set.
pub(crate) fn parse_field(field: &[u8]) -> i64 {
    match field.first() {
        Some(first) if first & 0x80 != 0 => parse_base_256(field),
        _ => parse_base_n(field, 8),
    }
}

/// `seconds[.fraction]`. `None` for anything else, or for seconds outside `i64`.
pub(crate) fn parse_pax_time(value: &[u8]) -> Option<i64> {
    if value.is_empty() {
        return Some(0);
    }
    let (negative, digits) = match value.split_first() {
        Some((b'-', rest)) => (true, rest),
        _ => (false, value),
    };
    let int_len = digits
        .iter()
        .position(|c| !c.is_ascii_digit())
        .unwrap_or(digits.len());
    let (int, fraction) = digits.split_at(int_len);
    let mut seconds: i64 = 0;
    for c in int {
        seconds = seconds
            .checked_mul(10)?
            .checked_add(i64::from(c.wrapping_sub(b'0')))?;
    }
    match fraction.split_first() {
        None => {}
        Some((b'.', rest)) if rest.iter().all(u8::is_ascii_digit) => {}
        Some(_) => return None,
    }
    Some(if negative { -seconds } else { seconds })
}
