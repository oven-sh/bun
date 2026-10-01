//! Rust stand-ins for the C and C++ symbols that the `cargo test` binary of this crate links to: no build of bun holds them.

/// What the parse pass links to: the stand-ins of the parser.
#[path = "../js_parser/native_test_shims.rs"]
mod parse_pass;

/// `WTF::dtoa`: `number` as JavaScript writes it, and how many bytes of `buf` that took.
#[unsafe(no_mangle)]
extern "C" fn WTF__dtoa(buf: &mut [u8; 124], number: f64) -> usize {
    let text = number_to_string(number);
    buf[..text.len()].copy_from_slice(text.as_bytes());
    text.len()
}

/// `Number::toString` of ECMAScript in radix 10, from the shortest digits that read back as `number`.
fn number_to_string(number: f64) -> String {
    if number.is_nan() {
        return String::from("NaN");
    }
    if number == 0.0 {
        return String::from("0");
    }
    if number.is_infinite() {
        return String::from(if number < 0.0 {
            "-Infinity"
        } else {
            "Infinity"
        });
    }
    let mut digits = String::new();
    let mut exponent = 0i32;
    let mut exponent_is_negative = false;
    let mut in_exponent = false;
    for character in format!("{:e}", number.abs()).chars() {
        match character {
            'e' => in_exponent = true,
            '-' => exponent_is_negative = true,
            '.' => {}
            digit if in_exponent => {
                exponent = exponent * 10 + digit.to_digit(10).unwrap_or(0) as i32
            }
            digit => digits.push(digit),
        }
    }
    if exponent_is_negative {
        exponent = -exponent;
    }
    let count = digits.len() as i32;
    let point = exponent + 1;
    let mut text = String::from(if number < 0.0 { "-" } else { "" });
    if count <= point && point <= 21 {
        text.push_str(&digits);
        text.push_str(&"0".repeat((point - count) as usize));
    } else if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(point as usize);
        text.push_str(whole);
        text.push('.');
        text.push_str(fraction);
    } else if -6 < point && point <= 0 {
        text.push_str("0.");
        text.push_str(&"0".repeat((-point) as usize));
        text.push_str(&digits);
    } else {
        let (first, rest) = digits.split_at(1);
        text.push_str(first);
        if !rest.is_empty() {
            text.push('.');
            text.push_str(rest);
        }
        text.push('e');
        text.push(if point > 0 { '+' } else { '-' });
        text.push_str(&(point - 1).abs().to_string());
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_number_is_written_as_javascript_writes_it() {
        let written: [(f64, &str); 16] = [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.5, "-1.5"),
            (100.0, "100"),
            (0.1, "0.1"),
            (123456789012345680000.0, "123456789012345680000"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (5e-324, "5e-324"),
            (f64::MAX, "1.7976931348623157e+308"),
            (f64::NAN, "NaN"),
            (f64::NEG_INFINITY, "-Infinity"),
        ];
        for (number, text) in written {
            let mut buf = [0u8; 124];
            let len = WTF__dtoa(&mut buf, number);
            assert_eq!(
                bun_core::BStr::new(&buf[..len]),
                bun_core::BStr::new(text.as_bytes()),
                "{number:e}"
            );
        }
    }
}
