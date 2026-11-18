//! RFC 3492.

use bun_engine_text::AllocError;

use crate::buffer::Buffer;

const BASE: u32 = 36;
const T_MIN: u32 = 1;
const T_MAX: u32 = 26;
const SKEW: u32 = 38;
const DAMP: u32 = 700;
const INITIAL_BIAS: u32 = 72;
const INITIAL_N: u32 = 0x80;

/// The longest label that DNS has. It bounds the time, which is quadratic, and the deltas.
pub(crate) const MAX_LABEL_LENGTH: usize = 63;

fn adapt(delta: u32, count: u32, is_first: bool) -> u32 {
    let mut delta = delta / if is_first { DAMP } else { 2 };
    delta += delta / count;
    let mut k = 0;
    while delta > (BASE - T_MIN) * T_MAX / 2 {
        delta /= BASE - T_MIN;
        k += BASE;
    }
    k + (BASE - T_MIN + 1) * delta / (delta + SKEW)
}

fn digit_value(digit: u8) -> Option<u32> {
    match digit {
        b'a'..=b'z' => Some(u32::from(digit - b'a')),
        b'0'..=b'9' => Some(u32::from(digit - b'0') + 26),
        _ => None,
    }
}

fn threshold(k: u32, bias: u32) -> u32 {
    k.saturating_sub(bias).clamp(T_MIN, T_MAX)
}

/// `label` has no more than [`MAX_LABEL_LENGTH`] characters.
pub(crate) fn encode(label: &[char], out: &mut Buffer) -> Result<(), AllocError> {
    const DIGITS: &[u8; BASE as usize] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut handled = 0;
    for &character in label.iter().filter(|character| character.is_ascii()) {
        out.push(character as u8)?;
        handled += 1;
    }
    let basic_count = handled;
    if basic_count != 0 {
        out.push(b'-')?;
    }
    let (mut n, mut delta, mut bias) = (INITIAL_N, 0, INITIAL_BIAS);
    let code_points = || label.iter().map(|&character| u32::from(character));
    while let Some(next) = code_points().filter(|&it| it >= n).min() {
        delta += (next - n) * (handled + 1);
        for code_point in code_points() {
            if code_point < next {
                delta += 1;
            } else if code_point == next {
                let (mut q, mut k) = (delta, BASE);
                loop {
                    let threshold = threshold(k, bias);
                    if q < threshold {
                        break;
                    }
                    out.push(DIGITS[(threshold + (q - threshold) % (BASE - threshold)) as usize])?;
                    q = (q - threshold) / (BASE - threshold);
                    k += BASE;
                }
                out.push(DIGITS[q as usize])?;
                bias = adapt(delta, handled + 1, handled == basic_count);
                delta = 0;
                handled += 1;
            }
        }
        delta += 1;
        n = next + 1;
    }
    Ok(())
}

/// `encoded` is lowercase ASCII and fits in `storage`. No character takes less than a byte.
pub(crate) fn decode<'a>(
    encoded: &[u8],
    storage: &'a mut [char; MAX_LABEL_LENGTH],
) -> Option<&'a [char]> {
    let (basic, extended) = match bun_highway::last_index_of_char(encoded, b'-') {
        Some(delimiter @ 1..) => (&encoded[..delimiter], &encoded[delimiter + 1..]),
        _ => (&[][..], encoded),
    };
    for (character, &byte) in storage.iter_mut().zip(basic) {
        *character = char::from(byte);
    }
    let mut length = basic.len();
    let (mut n, mut i, mut bias) = (INITIAL_N, 0u32, INITIAL_BIAS);
    let mut digits = extended.iter().peekable();
    while digits.peek().is_some() {
        let previous = i;
        let (mut weight, mut k) = (1u32, BASE);
        loop {
            let digit = digit_value(*digits.next()?)?;
            i = i.checked_add(digit.checked_mul(weight)?)?;
            let threshold = threshold(k, bias);
            if digit < threshold {
                break;
            }
            weight = weight.checked_mul(BASE - threshold)?;
            k += BASE;
        }
        let count = length as u32 + 1;
        bias = adapt(i - previous, count, previous == 0);
        n = n.checked_add(i / count)?;
        i %= count;
        storage.copy_within(i as usize..length, i as usize + 1);
        storage[i as usize] = char::from_u32(n)?;
        length += 1;
        i += 1;
    }
    Some(&storage[..length])
}
