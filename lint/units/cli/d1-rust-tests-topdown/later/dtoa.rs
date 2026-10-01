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
