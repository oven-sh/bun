// internal/jsnum/string.go: Number to string and string to Number, as JavaScript converts them.
use crate::jsnum::jsnum::{MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, Number, big, inf, nan};
use crate::stringutil::util::{is_digit, is_hex_digit, is_octal_digit, strings, unicode, utf8};

impl Number {
    // https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-tostring
    pub fn string(self) -> Vec<u8> {
        let n = self;
        if n.is_nan() {
            return b"NaN".to_vec();
        }
        if n.is_inf() {
            if n.0 < 0.0 {
                return b"-Infinity".to_vec();
            }
            return b"Infinity".to_vec();
        }

        // Fast path: for safe integers, directly convert to string.
        if MIN_SAFE_INTEGER <= n && n <= MAX_SAFE_INTEGER {
            let i = n.0 as i64;
            if i as f64 == n.0 {
                return strconv::format_int(i);
            }
        }

        // Otherwise, the Go json package handles this correctly.
        json_marshal_float64(n.0)
    }
}

// https://tc39.es/ecma262/2024/multipage/abstract-operations.html#sec-stringtonumber
pub fn from_string(s: &[u8]) -> Number {
    // The strategy below is to break the number apart and fix it up such that the library's own parsing functionality can handle it, which saves writing the full parser and conversion logic of StringToNumber.
    let s = strings::trim_func(s, is_str_white_space);

    match s {
        b"" => return Number(0.0),
        b"Infinity" | b"+Infinity" => return inf(1),
        b"-Infinity" => return inf(-1),
        _ => {}
    }

    for (_, r) in utf8::range(s) {
        if !is_number_rune(r) {
            return nan();
        }
    }

    if let Some(n) = try_parse_int(s) {
        return n;
    }

    // Cut this off first so we can ensure -0 is returned as -0.
    let (mut s, negative) = strings::cut_prefix(s, b"-");

    if !negative {
        (s, _) = strings::cut_prefix(s, b"+");
    }

    let (first, _) = utf8::decode_rune_in_string(s);
    if !is_digit(first) && first != b'.' as u32 {
        return nan();
    }

    let f = parse_float_string(s);
    if f.is_nan() {
        return nan();
    }

    let sign: f64 = if negative { -1.0 } else { 1.0 };
    Number(f.copysign(sign))
}

fn is_str_white_space(r: u32) -> bool {
    // This is different than stringutil.IsWhiteSpaceLike: LineTerminator and WhiteSpace of the ECMAScript lexical grammar.
    if matches!(
        r,
        0x0A | 0x0D | 0x2028 | 0x2029 | 0x09 | 0x0B | 0x0C | 0xFEFF
    ) {
        return true;
    }

    // WhiteSpace
    unicode::is(&unicode::ZS, r)
}

// None is upstream's `false`: the string is not an integer literal. An integer literal that is not valid gives NaN.
fn try_parse_int(s: &[u8]) -> Option<Number> {
    let mut i: Option<i64> = None;
    let mut has_int_result = false;
    let mut s = s;

    if s.len() > 2 {
        let (prefix, rest) = (strings::slice_to(s, 2), strings::slice_from(s, 2));
        match prefix {
            b"0b" | b"0B" => {
                if !is_all_binary_digits(rest) {
                    return Some(nan());
                }
                i = strconv::parse_int(rest, 2);
                has_int_result = true;
            }
            b"0o" | b"0O" => {
                if !is_all_octal_digits(rest) {
                    return Some(nan());
                }
                i = strconv::parse_int(rest, 8);
                has_int_result = true;
            }
            b"0x" | b"0X" => {
                if !is_all_hex_digits(rest) {
                    return Some(nan());
                }
                i = strconv::parse_int(rest, 16);
                has_int_result = true;
            }
            _ => {}
        }
    }

    if !has_int_result {
        // StringToNumber does not parse leading zeros as octal.
        s = trim_leading_zeros(s);
        if !is_all_digits(s) {
            return None;
        }
        i = strconv::parse_int(s, 10);
    }

    if let Some(i) = i {
        return Some(Number(i as f64));
    }

    // Using this to parse large integers.
    let Some(bi) = big::Int::set_string(s) else {
        return Some(nan());
    };

    Some(Number(bi.float64()))
}

fn parse_float_string(s: &[u8]) -> f64 {
    // <a>, <a>.<b>, <a>.<b>e<c> or <a>e<c>
    let (mut a, rest, has_dot) = strings::cut(s, b".");
    let mut b: &[u8] = b"";
    let c: &[u8];
    let has_exp: bool;
    if has_dot {
        (b, c, has_exp) = cut_any(rest, b"eE");
    } else {
        (a, c, has_exp) = cut_any(s, b"eE");
    }

    let mut sb: Vec<u8> = Vec::with_capacity(a.len() + b.len() + c.len() + 3);

    if a.is_empty() {
        if has_dot && b.is_empty() {
            return f64::NAN;
        }
        if has_exp && c.is_empty() {
            return f64::NAN;
        }
        sb.push(b'0');
    } else {
        a = trim_leading_zeros(a);
        if !is_all_digits(a) {
            return f64::NAN;
        }
        sb.extend_from_slice(a);
    }

    if has_dot {
        sb.push(b'.');
        if b.is_empty() {
            sb.push(b'0');
        } else {
            b = trim_trailing_zeros(b);
            if !is_all_digits(b) {
                return f64::NAN;
            }
            sb.extend_from_slice(b);
        }
    }

    if has_exp {
        sb.push(b'e');

        let (mut c, negative) = strings::cut_prefix(c, b"-");
        if negative {
            sb.push(b'-');
        } else {
            (c, _) = strings::cut_prefix(c, b"+");
        }
        c = trim_leading_zeros(c);
        if !is_all_digits(c) {
            return f64::NAN;
        }
        sb.extend_from_slice(c);
    }

    string_to_float64(&sb)
}

fn cut_any<'a>(s: &'a [u8], cutset: &[u8]) -> (&'a [u8], &'a [u8], bool) {
    let i = strings::index_any(s, cutset);
    if i >= 0 {
        let before = strings::slice_to(s, i);
        let after_and_found = strings::slice_from(s, i);
        let (_, size) = utf8::decode_rune_in_string(after_and_found);
        let after = after_and_found.get(size..).unwrap_or(&[]);
        return (before, after, true);
    }
    (s, b"", false)
}

fn trim_leading_zeros(s: &[u8]) -> &[u8] {
    if s.starts_with(b"0") {
        let s = strings::trim_left(s, b"0");
        if s.is_empty() {
            return b"0";
        }
        return s;
    }
    s
}

fn trim_trailing_zeros(s: &[u8]) -> &[u8] {
    if s.ends_with(b"0") {
        let s = strings::trim_right(s, b"0");
        if s.is_empty() {
            return b"0";
        }
        return s;
    }
    s
}

fn string_to_float64(s: &[u8]) -> f64 {
    // A value out of the range of a float64 is the infinity that strconv.ParseFloat returns beside its range error.
    strconv::parse_float(s).unwrap_or(f64::NAN)
}

fn is_all_digits(s: &[u8]) -> bool {
    utf8::range(s).all(|(_, r)| is_digit(r))
}

fn is_all_binary_digits(s: &[u8]) -> bool {
    utf8::range(s).all(|(_, r)| r == b'0' as u32 || r == b'1' as u32)
}

fn is_all_octal_digits(s: &[u8]) -> bool {
    utf8::range(s).all(|(_, r)| is_octal_digit(r))
}

fn is_all_hex_digits(s: &[u8]) -> bool {
    utf8::range(s).all(|(_, r)| is_hex_digit(r))
}

fn is_number_rune(r: u32) -> bool {
    if is_digit(r) {
        return true;
    }

    if (b'a' as u32..=b'f' as u32).contains(&r) {
        return true;
    }

    if (b'A' as u32..=b'F' as u32).contains(&r) {
        return true;
    }

    matches!(
        u8::try_from(r),
        Ok(b'.' | b'-' | b'+' | b'x' | b'X' | b'o' | b'O')
    )
}

// `json.Marshal(float64)`: the ES6 number-to-string conversion, 'f' format unless the exponent is below -6 or at least 21.
fn json_marshal_float64(f: f64) -> Vec<u8> {
    let abs = f.abs();
    let mut fmt = b'f';
    if abs != 0.0 && (abs < 1e-6 || abs >= 1e21) {
        fmt = b'e';
    }
    let mut b: Vec<u8> = Vec::new();
    strconv::append_float(&mut b, f, fmt);
    if fmt == b'e' {
        // clean up e-09 to e-9
        let n = b.len();
        if n >= 4 {
            if let [b'e', b'-' | b'+', b'0', last] = *b.get(n - 4..).unwrap_or(&[]) {
                b.truncate(n - 2);
                b.push(last);
            }
        }
    }
    b
}

// Go's strconv: the conversions the functions above call.
pub mod strconv {
    // strconv.FormatInt(i, 10)
    pub fn format_int(i: i64) -> Vec<u8> {
        i.to_string().into_bytes()
    }

    // strconv.ParseInt(s, base, 64) for a base from 2 to 36: None where Go returns an error, for syntax or for range.
    pub fn parse_int(s: &[u8], base: u32) -> Option<i64> {
        let (digits, negative) = match s.split_first() {
            Some((b'-', rest)) => (rest, true),
            Some((b'+', rest)) => (rest, false),
            _ => (s, false),
        };
        if digits.is_empty() {
            return None;
        }
        let mut magnitude: u64 = 0;
        for &ch in digits {
            let digit = u64::from((ch as char).to_digit(base)?);
            magnitude = magnitude.checked_mul(u64::from(base))?.checked_add(digit)?;
        }
        if negative {
            return 0i64.checked_sub_unsigned(magnitude);
        }
        i64::try_from(magnitude).ok()
    }

    // strconv.ParseFloat(s, 64) for decimal text: None for a syntax error, an infinity for a value that is out of range.
    pub fn parse_float(s: &[u8]) -> Option<f64> {
        let mut i: usize = 0;
        if matches!(s.first(), Some(b'+' | b'-')) {
            i = 1;
        }
        let mut saw_dot = false;
        let mut saw_digits = false;
        while let Some(&ch) = s.get(i) {
            if ch == b'.' && !saw_dot {
                saw_dot = true;
            } else if ch.is_ascii_digit() {
                saw_digits = true;
            } else {
                break;
            }
            i += 1;
        }
        if !saw_digits {
            return None;
        }
        if matches!(s.get(i), Some(b'e' | b'E')) {
            i += 1;
            if matches!(s.get(i), Some(b'+' | b'-')) {
                i += 1;
            }
            if !s.get(i).is_some_and(u8::is_ascii_digit) {
                return None;
            }
            while s.get(i).is_some_and(u8::is_ascii_digit) {
                i += 1;
            }
        }
        if i != s.len() {
            return None;
        }
        std::str::from_utf8(s).ok()?.parse::<f64>().ok()
    }

    // A magnitude of any size, least significant 32 bits first, for the exact arithmetic of the shortest conversion.
    #[derive(Clone)]
    struct Nat(Vec<u32>);

    impl Nat {
        fn from_u64(x: u64) -> Nat {
            Nat(vec![x as u32, (x >> 32) as u32])
        }

        fn shl(&mut self, bits: u32) {
            let words = (bits / 32) as usize;
            let shift = bits % 32;
            if shift != 0 {
                let mut carry: u32 = 0;
                for word in self.0.iter_mut() {
                    let next = *word >> (32 - shift);
                    *word = (*word << shift) | carry;
                    carry = next;
                }
                self.0.push(carry);
            }
            if words != 0 {
                self.0.splice(0..0, std::iter::repeat_n(0, words));
            }
        }

        fn mul_small(&mut self, factor: u32) {
            let mut carry: u64 = 0;
            for word in self.0.iter_mut() {
                let t = u64::from(*word) * u64::from(factor) + carry;
                *word = t as u32;
                carry = t >> 32;
            }
            self.0.push(carry as u32);
        }

        fn mul_pow10(&mut self, mut n: u32) {
            while n >= 9 {
                self.mul_small(1_000_000_000);
                n -= 9;
            }
            if n > 0 {
                self.mul_small(10u32.pow(n));
            }
        }

        fn word(&self, i: usize) -> u32 {
            self.0.get(i).copied().unwrap_or(0)
        }

        fn cmp(&self, other: &Nat) -> std::cmp::Ordering {
            let mut i = self.0.len().max(other.0.len());
            while i > 0 {
                i -= 1;
                let ordering = self.word(i).cmp(&other.word(i));
                if ordering != std::cmp::Ordering::Equal {
                    return ordering;
                }
            }
            std::cmp::Ordering::Equal
        }

        fn add(&self, other: &Nat) -> Nat {
            let n = self.0.len().max(other.0.len());
            let mut out: Vec<u32> = Vec::with_capacity(n + 1);
            let mut carry: u64 = 0;
            for i in 0..n {
                let t = u64::from(self.word(i)) + u64::from(other.word(i)) + carry;
                out.push(t as u32);
                carry = t >> 32;
            }
            out.push(carry as u32);
            Nat(out)
        }

        // self -= other, for other <= self
        fn sub_assign(&mut self, other: &Nat) {
            let mut borrow: i64 = 0;
            for (i, word) in self.0.iter_mut().enumerate() {
                let t = i64::from(*word) - i64::from(other.word(i)) - borrow;
                *word = t as u32;
                borrow = i64::from(t < 0);
            }
        }
    }

    // The shortest decimal digits that read back as the positive finite `f`, the closest such digits to `f`, an even last digit when two are equally close. Returns the digits and the exponent `dp` with f = 0.digits × 10**dp.
    fn shortest_decimal(f: f64) -> (Vec<u8>, i32) {
        use std::cmp::Ordering;
        let bits = f.to_bits();
        let biased = ((bits >> 52) & 0x7FF) as i32;
        let fraction = bits & ((1 << 52) - 1);
        let (mant, exp) = if biased == 0 {
            (fraction, -1074)
        } else {
            (fraction | (1 << 52), biased - 1075)
        };
        // The neighbour below is half as far away when the mantissa is a power of two above the denormals.
        let narrow = fraction == 0 && biased > 1;
        let inclusive = mant & 1 == 0;

        // f = r / s; the halves of the distances to the neighbours are m_plus / s and m_minus / s.
        let mut r = Nat::from_u64(mant);
        let mut s = Nat::from_u64(1);
        let mut m_plus = Nat::from_u64(1);
        let mut m_minus = Nat::from_u64(1);
        let scale = if narrow { 2 } else { 1 };
        if exp >= 0 {
            r.shl(exp as u32 + scale);
            s.shl(scale);
            m_plus.shl(exp as u32 + scale - 1);
            m_minus.shl(exp as u32);
        } else {
            r.shl(scale);
            s.shl((-exp) as u32 + scale);
            m_plus.shl(scale - 1);
        }

        // floor(log10(2**e2)) + 1 is the decimal exponent or one less than it.
        let e2 = i64::from(exp) + 63 - i64::from(mant.leading_zeros());
        let mut dp = ((e2 * 1_292_913_986) >> 32) as i32 + 1;
        if dp >= 0 {
            s.mul_pow10(dp as u32);
        } else {
            r.mul_pow10(dp.unsigned_abs());
            m_plus.mul_pow10(dp.unsigned_abs());
            m_minus.mul_pow10(dp.unsigned_abs());
        }
        let high = r.add(&m_plus).cmp(&s);
        if high == Ordering::Greater || (inclusive && high == Ordering::Equal) {
            dp += 1;
        } else {
            r.mul_small(10);
            m_plus.mul_small(10);
            m_minus.mul_small(10);
        }

        let mut digits: Vec<u8> = Vec::with_capacity(17);
        loop {
            let mut digit: u8 = 0;
            while digit < 9 && r.cmp(&s) != Ordering::Less {
                r.sub_assign(&s);
                digit += 1;
            }
            let low = r.cmp(&m_minus);
            let high = r.add(&m_plus).cmp(&s);
            let low_ok = low == Ordering::Less || (inclusive && low == Ordering::Equal);
            let high_ok = high == Ordering::Greater || (inclusive && high == Ordering::Equal);
            if !low_ok && !high_ok && digits.len() < 17 {
                digits.push(b'0' + digit);
                r.mul_small(10);
                m_plus.mul_small(10);
                m_minus.mul_small(10);
                continue;
            }
            let round_up = if low_ok && high_ok {
                let mut twice = r.clone();
                twice.shl(1);
                match twice.cmp(&s) {
                    Ordering::Less => false,
                    Ordering::Greater => true,
                    Ordering::Equal => digit & 1 == 1,
                }
            } else {
                high_ok
            };
            digits.push(b'0' + digit + u8::from(round_up));
            break;
        }
        // A carry out of the last digit: 9 became 10.
        let mut i = digits.len();
        while i > 0 && digits.get(i - 1) == Some(&(b'0' + 10)) {
            digits.truncate(i - 1);
            i -= 1;
            match digits.last_mut() {
                Some(previous) => *previous += 1,
                None => {
                    digits.push(b'1');
                    dp += 1;
                    break;
                }
            }
        }
        (digits, dp)
    }

    // strconv.AppendFloat(b, f, fmt, -1, 64) for the formats 'e' and 'f': the shortest digits that read back as `f`.
    pub fn append_float(b: &mut Vec<u8>, f: f64, fmt: u8) {
        if f.is_nan() {
            b.extend_from_slice(b"NaN");
            return;
        }
        if f.is_infinite() {
            b.extend_from_slice(if f < 0.0 { b"-Inf" } else { b"+Inf" });
            return;
        }
        if f.is_sign_negative() {
            b.push(b'-');
        }
        let (digits, dp) = if f == 0.0 {
            (Vec::new(), 0)
        } else {
            shortest_decimal(f.abs())
        };
        if fmt == b'e' {
            // %e is d.ddddde±dd
            b.push(digits.first().copied().unwrap_or(b'0'));
            if digits.len() > 1 {
                b.push(b'.');
                b.extend_from_slice(digits.get(1..).unwrap_or(&[]));
            }
            b.push(b'e');
            let exp = if digits.is_empty() { 0 } else { dp - 1 };
            b.push(if exp < 0 { b'-' } else { b'+' });
            let exp = exp.unsigned_abs();
            if exp < 10 {
                b.push(b'0');
            }
            b.extend_from_slice(exp.to_string().as_bytes());
            return;
        }
        // %f is ddddddd.ddddd
        if dp > 0 {
            let integer = (dp as usize).min(digits.len());
            b.extend_from_slice(digits.get(..integer).unwrap_or(&[]));
            b.extend(std::iter::repeat_n(b'0', dp as usize - integer));
        } else {
            b.push(b'0');
        }
        let fraction = digits.len() as i64 - i64::from(dp);
        if fraction > 0 {
            b.push(b'.');
            if dp < 0 {
                b.extend(std::iter::repeat_n(b'0', dp.unsigned_abs() as usize));
            }
            b.extend_from_slice(digits.get(dp.max(0) as usize..).unwrap_or(&[]));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stringutil::util::strings::split;

    fn unhex(s: &[u8]) -> Vec<u8> {
        let digit = |b: u8| (b as char).to_digit(16).unwrap() as u8;
        s.as_chunks::<2>()
            .0
            .iter()
            .map(|pair| (digit(pair[0]) << 4) | digit(pair[1]))
            .collect()
    }

    fn bits(field: &[u8]) -> u64 {
        u64::from_str_radix(std::str::from_utf8(field).unwrap(), 16).unwrap()
    }

    // Replays what upstream's Go code answered: F is a string and the bits of FromString, S the bits of a number and its String.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn conversions_match_upstream_vectors() {
        let text = include_bytes!("testdata/string.tsv");
        let (mut from, mut to) = (0, 0);
        for line in split(text, b"\n") {
            if line.is_empty() {
                continue;
            }
            let f = split(line, b"\t");
            let shown = std::str::from_utf8(line).unwrap();
            match f[0] {
                b"F" => {
                    let got = from_string(&unhex(f[1]));
                    let want = f64::from_bits(bits(f[2]));
                    assert!(
                        if want.is_nan() {
                            got.is_nan()
                        } else {
                            got.0.to_bits() == want.to_bits()
                        },
                        "{shown} gives {:016x}",
                        got.0.to_bits()
                    );
                    from += 1;
                }
                b"S" => {
                    let got = Number(f64::from_bits(bits(f[1]))).string();
                    assert_eq!(
                        std::str::from_utf8(&got).unwrap(),
                        std::str::from_utf8(f[2]).unwrap(),
                        "{shown}"
                    );
                    to += 1;
                }
                other => panic!("unknown vector {other:?}"),
            }
        }
        assert_eq!((from, to), (381, 4310));
    }

    #[test]
    fn strconv_follows_go() {
        assert_eq!(strconv::parse_int(b"7fffffffffffffff", 16), Some(i64::MAX));
        assert_eq!(strconv::parse_int(b"8000000000000000", 16), None);
        assert_eq!(
            strconv::parse_int(b"-9223372036854775808", 10),
            Some(i64::MIN)
        );
        assert_eq!(strconv::parse_int(b"", 10), None);
        assert_eq!(strconv::parse_int(b"12a", 10), None);
        assert_eq!(strconv::parse_float(b"1e"), None);
        assert_eq!(strconv::parse_float(b"."), None);
        assert_eq!(strconv::parse_float(b"1e400"), Some(f64::INFINITY));
        assert_eq!(strconv::parse_float(b"1e-400"), Some(0.0));
        assert_eq!(strconv::parse_float(b"0.5e1"), Some(5.0));
        let mut b = Vec::new();
        strconv::append_float(&mut b, -0.0, b'e');
        assert_eq!(b, b"-0e+00");
        b.clear();
        strconv::append_float(&mut b, 123456789.0, b'e');
        assert_eq!(b, b"1.23456789e+08");
        b.clear();
        strconv::append_float(&mut b, 0.000123, b'f');
        assert_eq!(b, b"0.000123");
        b.clear();
        strconv::append_float(&mut b, 1e21, b'f');
        assert_eq!(b, b"1000000000000000000000");
    }
}
