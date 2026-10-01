// Research scratch, not in the tree: `losesPrecision` of ESLint lib/rules/no-loss-of-precision.js on the raw text and the value of a literal.
// rustc -O lop.rs -o /tmp/lop; one literal per line on stdin, "1" (reported) or "0" per line on stdout.
use std::io::{BufRead, Write};

/// The value as Bun's lexer computes it (`parse_numeric_literal_or_dot`): a radix literal is summed digit by digit.
fn value_of(raw: &[u8]) -> f64 {
    let text: Vec<u8> = raw.iter().copied().filter(|&b| b != b'_').collect();
    let radix = match text.as_slice() {
        [b'0', b'x' | b'X', ..] => Some((16.0, 2)),
        [b'0', b'o' | b'O', ..] => Some((8.0, 2)),
        [b'0', b'b' | b'B', ..] => Some((2.0, 2)),
        [b'0', b'0'..=b'7', rest @ ..] if rest.iter().all(|b| (b'0'..=b'7').contains(b)) => Some((8.0, 1)),
        _ => None,
    };
    match radix {
        Some((base, skip)) => text[skip..].iter().fold(0.0, |n, &b| n * base + f64::from((b as char).to_digit(16).unwrap())),
        None => std::str::from_utf8(&text).unwrap().parse::<f64>().unwrap(),
    }
}

/// `ScientificNotation`: the digits of the coefficient and the order of magnitude.
#[derive(PartialEq, Debug)]
struct Scientific {
    coefficient: Vec<u8>,
    magnitude: i64,
}

/// `removeLeadingZeros`: a string of zeros only is returned as it is.
fn remove_leading_zeros(s: &[u8]) -> &[u8] {
    match s.iter().position(|&b| b != b'0') {
        Some(at) => &s[at..],
        None => s,
    }
}

/// `removeTrailingZeros`: a string of zeros only is returned as it is.
fn remove_trailing_zeros(s: &[u8]) -> &[u8] {
    match s.iter().rposition(|&b| b != b'0') {
        Some(at) => &s[..=at],
        None => s,
    }
}

/// `normalizeInteger`.
fn normalize_integer(s: &[u8]) -> Scientific {
    let trimmed = remove_leading_zeros(s);
    Scientific { coefficient: remove_trailing_zeros(trimmed).to_vec(), magnitude: trimmed.len() as i64 - 1 }
}

/// `normalizeFloat`.
fn normalize_float(s: &[u8]) -> Scientific {
    let trimmed = remove_leading_zeros(s);
    match trimmed.iter().position(|&b| b == b'.') {
        Some(0) => {
            let significant = remove_leading_zeros(&trimmed[1..]);
            Scientific { coefficient: significant.to_vec(), magnitude: significant.len() as i64 - trimmed.len() as i64 }
        }
        None => Scientific { coefficient: trimmed.to_vec(), magnitude: trimmed.len() as i64 - 1 },
        Some(point) => Scientific {
            coefficient: trimmed.iter().copied().filter(|&b| b != b'.').collect(),
            magnitude: point as i64 - 1,
        },
    }
}

/// `parseInt(text, 10)` of the digits after `e`, with their sign: what does not fit is the largest value.
fn parse_exponent(text: &[u8]) -> i64 {
    let (negative, digits) = match text {
        [b'-', rest @ ..] => (true, rest),
        [b'+', rest @ ..] => (false, rest),
        _ => (false, text),
    };
    let mut n: i64 = 0;
    for &b in digits {
        n = n.saturating_mul(10).saturating_add(i64::from(b - b'0'));
    }
    if negative { -n } else { n }
}

/// `convertNumberToScientificNotation` of the raw text, `parseAsFloat` false.
fn raw_to_scientific(number: &[u8]) -> Scientific {
    let (coefficient, exponent) = match number.iter().position(|&b| b == b'e') {
        Some(e) => (&number[..e], Some(&number[e + 1..])),
        None => (number, None),
    };
    let mut normalized = if number.contains(&b'.') { normalize_float(coefficient) } else { normalize_integer(coefficient) };
    if let Some(exponent) = exponent {
        normalized.magnitude = normalized.magnitude.saturating_add(parse_exponent(exponent));
    }
    normalized
}

/// What `convertNumberToScientificNotation(value.toPrecision(precision), true)` is for a finite value above zero:
/// the `precision` digits of the value, a tie rounded up, and its decimal exponent.
fn stored_to_scientific(value: f64, precision: usize) -> Scientific {
    // Every digit of the value: a double has at most 767 of them.
    let exact = format!("{value:.766e}");
    let (mantissa, exponent) = exact.split_once('e').unwrap();
    let mut magnitude: i64 = exponent.parse().unwrap();
    let digits: Vec<u8> = mantissa.bytes().filter(|&b| b != b'.').collect();
    let mut coefficient = digits[..precision].to_vec();
    if digits.get(precision).is_some_and(|&next| next >= b'5') {
        let mut at = precision;
        loop {
            if at == 0 {
                // 99.5 at two digits is 1.0e2.
                coefficient.insert(0, b'1');
                coefficient.pop();
                magnitude += 1;
                break;
            }
            at -= 1;
            if coefficient[at] == b'9' {
                coefficient[at] = b'0';
            } else {
                coefficient[at] += 1;
                break;
            }
        }
    }
    Scientific { coefficient, magnitude }
}

/// `baseTenLosesPrecision`.
fn base_ten_loses_precision(raw: &[u8], value: f64) -> bool {
    let mut number: Vec<u8> = raw.iter().filter(|&&b| b != b'_').map(u8::to_ascii_lowercase).collect();
    // `.replace(/\.(?=e|$)/u, "")`: a point with no digit after it.
    if let Some(point) = number.iter().position(|&b| b == b'.') {
        if matches!(number.get(point + 1), None | Some(b'e')) {
            number.remove(point);
        }
    }
    let normalized_raw = raw_to_scientific(&number);
    if value == 0.0 {
        return !normalized_raw.coefficient.iter().all(|&b| b == b'0');
    }
    let requested_precision = normalized_raw.coefficient.len();
    if requested_precision > 100 {
        return true;
    }
    // `Infinity.toPrecision()` is "Infinity", which is the coefficient of no literal.
    if value.is_infinite() {
        return true;
    }
    normalized_raw != stored_to_scientific(value, requested_precision)
}

/// `Number.prototype.toString(radix)` for a value that is a whole number and a radix of 2, 8 or 16, in upper case.
fn to_string_radix(value: f64, bits_per_digit: u32) -> Vec<u8> {
    if value.is_infinite() {
        return b"INFINITY".to_vec();
    }
    let bits = value.to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    if exponent == 0 {
        // Below 1: the whole number is zero.
        return b"0".to_vec();
    }
    let mantissa = (bits & ((1 << 52) - 1)) | (1 << 52);
    // The value is `mantissa << shift`; a shift below zero drops bits that are zero.
    let shift = exponent - 1075;
    let mask = (1u64 << bits_per_digit) - 1;
    let mut out = Vec::new();
    if shift < 0 {
        let mut n = if shift <= -64 { 0 } else { mantissa >> (-shift) };
        if n == 0 {
            return b"0".to_vec();
        }
        while n > 0 {
            out.push(b"0123456789ABCDEF"[(n & mask) as usize]);
            n >>= bits_per_digit;
        }
    } else {
        let shift = shift as u32;
        let total_bits = 53 + shift;
        let digits = total_bits.div_ceil(bits_per_digit);
        for digit in 0..digits {
            let low = digit * bits_per_digit;
            let part = if low + bits_per_digit <= shift {
                0
            } else if low >= shift {
                (mantissa >> (low - shift)) & mask
            } else {
                (mantissa << (shift - low)) & mask
            };
            out.push(b"0123456789ABCDEF"[part as usize]);
        }
        while out.len() > 1 && out.last() == Some(&b'0') {
            out.pop();
        }
    }
    out.reverse();
    out
}

/// `notBaseTenLosesPrecision`.
fn not_base_ten_loses_precision(raw: &[u8], value: f64) -> bool {
    let raw_string: Vec<u8> = raw.iter().filter(|&&b| b != b'_').map(u8::to_ascii_uppercase).collect();
    let bits_per_digit = if raw_string.starts_with(b"0B") {
        1
    } else if raw_string.starts_with(b"0X") {
        4
    } else {
        3
    };
    !raw_string.ends_with(&to_string_radix(value, bits_per_digit))
}

/// `isBaseTen`, on the raw text with its separators.
fn is_base_ten(raw: &[u8]) -> bool {
    let prefixed = matches!(raw, [b'0', b'x' | b'X' | b'b' | b'B' | b'o' | b'O', ..]);
    let legacy_octal = matches!(raw, [b'0', rest @ ..] if !rest.is_empty() && rest.iter().all(|b| (b'0'..=b'7').contains(b)));
    !prefixed && !legacy_octal
}

/// `losesPrecision`.
fn loses_precision(raw: &[u8], value: f64) -> bool {
    if is_base_ten(raw) { base_ten_loses_precision(raw, value) } else { not_base_ten_loses_precision(raw, value) }
}

fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let raw = line.as_bytes();
        let value = value_of(raw);
        writeln!(out, "{}", u8::from(loses_precision(raw, value))).unwrap();
    }
}
