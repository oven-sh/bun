use std::io::{self, BufRead};

const MAX_SAFE: f64 = 9007199254740991.0;

fn number_to_string(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n.is_infinite() {
        return if n < 0.0 { "-Infinity".into() } else { "Infinity".into() };
    }
    if -MAX_SAFE <= n && n <= MAX_SAFE {
        let i = n as i64;
        if i as f64 == n {
            return i.to_string();
        }
    }
    let abs = n.abs();
    let e = format!("{:e}", n);
    let (mant, exp) = e.split_once('e').unwrap();
    let exp: i32 = exp.parse().unwrap();
    let neg = mant.starts_with('-');
    let mant = mant.trim_start_matches('-');
    let mut digits: String = mant.chars().filter(|c| *c != '.').collect();
    fix_tie(abs, &mut digits, exp);
    let mut out = String::new();
    if neg {
        out.push('-');
    }
    if abs < 1e-6 || abs >= 1e21 {
        out.push_str(&digits[..1]);
        if digits.len() > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if exp < 0 { '-' } else { '+' });
        out.push_str(&exp.abs().to_string());
    } else {
        let k = digits.len() as i32;
        let n10 = exp + 1;
        if n10 <= 0 {
            out.push_str("0.");
            for _ in 0..(-n10) {
                out.push('0');
            }
            out.push_str(&digits);
        } else if n10 >= k {
            out.push_str(&digits);
            for _ in 0..(n10 - k) {
                out.push('0');
            }
        } else {
            out.push_str(&digits[..n10 as usize]);
            out.push('.');
            out.push_str(&digits[n10 as usize..]);
        }
    }
    out
}

// Rounds an exact decimal tie to the even digit when both neighbours read back as the same number.
fn fix_tie(abs: f64, digits: &mut String, exp: i32) {
    let last = digits.as_bytes()[digits.len() - 1];
    if (last - b'0') % 2 == 0 {
        return;
    }
    let bits = abs.to_bits();
    let biased = ((bits >> 52) & 0x7FF) as i32;
    let frac = bits & ((1u64 << 52) - 1);
    let (m, e) = if biased == 0 { (frac, -1074) } else { (frac | (1u64 << 52), biased - 1075) };
    if m == 0 {
        return;
    }
    let k = digits.len() as i32;
    let p = exp - (k - 1);
    let s: u128 = digits.parse::<u128>().unwrap();
    let tz = m.trailing_zeros() as i32;
    let m_odd = (m >> tz) as u128;
    let two = tz + e + 1;
    // 2v = m_odd * 2^two. A tie is 2v == (2s - 1) * 10^p (std rounded up) or 2v == (2s + 1) * 10^p (std rounded down).
    let is_tie = |odd: u128| -> bool {
        if p >= 0 {
            two == p && p <= 27 && odd.checked_mul(5u128.pow(p as u32)) == Some(m_odd)
        } else {
            two - p == 0 && -p <= 27 && m_odd.checked_mul(5u128.pow((-p) as u32)) == Some(odd)
        }
    };
    let other = if is_tie(2 * s - 1) {
        s - 1
    } else if is_tie(2 * s + 1) {
        s + 1
    } else {
        return;
    };
    let text = other.to_string();
    if text.len() != digits.len() {
        return;
    }
    if format!("{}e{}", text, p).parse::<f64>().ok() == Some(abs) {
        *digits = text;
    }
}

// Go utf8.DecodeRune semantics.
fn decode_rune(s: &[u8]) -> (u32, usize) {
    let n = s.len();
    if n < 1 {
        return (0xFFFD, 0);
    }
    let b0 = s[0];
    if b0 < 0x80 {
        return (b0 as u32, 1);
    }
    let (size, lo, hi): (usize, u8, u8) = match b0 {
        0xC2..=0xDF => (2, 0x80, 0xBF),
        0xE0 => (3, 0xA0, 0xBF),
        0xE1..=0xEC => (3, 0x80, 0xBF),
        0xED => (3, 0x80, 0x9F),
        0xEE..=0xEF => (3, 0x80, 0xBF),
        0xF0 => (4, 0x90, 0xBF),
        0xF1..=0xF3 => (4, 0x80, 0xBF),
        0xF4 => (4, 0x80, 0x8F),
        _ => return (0xFFFD, 1),
    };
    if n < size {
        return (0xFFFD, 1);
    }
    let b1 = s[1];
    if b1 < lo || hi < b1 {
        return (0xFFFD, 1);
    }
    if size == 2 {
        return (((b0 & 0x1F) as u32) << 6 | (b1 & 0x3F) as u32, 2);
    }
    let b2 = s[2];
    if !(0x80..=0xBF).contains(&b2) {
        return (0xFFFD, 1);
    }
    if size == 3 {
        return (((b0 & 0x0F) as u32) << 12 | ((b1 & 0x3F) as u32) << 6 | (b2 & 0x3F) as u32, 3);
    }
    let b3 = s[3];
    if !(0x80..=0xBF).contains(&b3) {
        return (0xFFFD, 1);
    }
    (((b0 & 0x07) as u32) << 18 | ((b1 & 0x3F) as u32) << 12 | ((b2 & 0x3F) as u32) << 6 | (b3 & 0x3F) as u32, 4)
}

fn decode_last_rune(s: &[u8]) -> (u32, usize) {
    let end = s.len();
    if end == 0 {
        return (0xFFFD, 0);
    }
    let mut start = end - 1;
    let r = s[start];
    if r < 0x80 {
        return (r as u32, 1);
    }
    let lim = if end > 4 { end - 4 } else { 0 };
    loop {
        if s[start] & 0xC0 != 0x80 {
            break;
        }
        if start == lim {
            break;
        }
        start -= 1;
    }
    let (r, size) = decode_rune(&s[start..end]);
    if start + size != end {
        return (0xFFFD, 1);
    }
    (r, size)
}

fn is_zs(r: u32) -> bool {
    matches!(r, 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x202F | 0x205F | 0x3000)
}

fn is_str_white_space(r: u32) -> bool {
    matches!(r, 0x0A | 0x0D | 0x2028 | 0x2029 | 0x09 | 0x0B | 0x0C | 0xFEFF) || is_zs(r)
}

fn trim_func(mut s: &[u8], f: impl Fn(u32) -> bool) -> &[u8] {
    while !s.is_empty() {
        let (r, n) = decode_rune(s);
        if !f(r) {
            break;
        }
        s = &s[n..];
    }
    while !s.is_empty() {
        let (r, n) = decode_last_rune(s);
        if !f(r) {
            break;
        }
        s = &s[..s.len() - n];
    }
    s
}

fn is_digit(r: u32) -> bool {
    (0x30..=0x39).contains(&r)
}

fn is_number_rune(r: u32) -> bool {
    if is_digit(r) {
        return true;
    }
    if (0x61..=0x66).contains(&r) || (0x41..=0x46).contains(&r) {
        return true;
    }
    matches!(r as u8 as char, '.' | '-' | '+' | 'x' | 'X' | 'o' | 'O') && r < 0x80
}

fn all(s: &[u8], f: impl Fn(u8) -> bool) -> bool {
    s.iter().all(|&b| f(b))
}

fn trim_leading_zeros(s: &[u8]) -> &[u8] {
    if s.first() == Some(&b'0') {
        let mut i = 0;
        while i < s.len() && s[i] == b'0' {
            i += 1;
        }
        if i == s.len() {
            return b"0";
        }
        return &s[i..];
    }
    s
}

fn trim_trailing_zeros(s: &[u8]) -> &[u8] {
    if s.last() == Some(&b'0') {
        let mut j = s.len();
        while j > 0 && s[j - 1] == b'0' {
            j -= 1;
        }
        if j == 0 {
            return b"0";
        }
        return &s[..j];
    }
    s
}

// Exact value of a digit string in a power-of-two radix, rounded to nearest even.
fn pow2_radix_to_f64(digits: &[u8], bits_per_digit: u32) -> f64 {
    let mut bits: Vec<u8> = Vec::new();
    for &d in digits {
        let v = match d {
            b'0'..=b'9' => d - b'0',
            b'a'..=b'f' => d - b'a' + 10,
            b'A'..=b'F' => d - b'A' + 10,
            _ => 0,
        };
        for k in (0..bits_per_digit).rev() {
            bits.push((v >> k) & 1);
        }
    }
    let first = match bits.iter().position(|&b| b == 1) {
        Some(p) => p,
        None => return 0.0,
    };
    let bits = &bits[first..];
    let nbits = bits.len();
    let mut mant: u64 = 0;
    for i in 0..53.min(nbits) {
        mant = (mant << 1) | bits[i] as u64;
    }
    if nbits <= 53 {
        return mant as f64;
    }
    let round_bit = bits[53];
    let sticky = bits[54..].iter().any(|&b| b == 1);
    let mut exp = (nbits - 53) as i32;
    if round_bit == 1 && (sticky || (mant & 1) == 1) {
        mant += 1;
        if mant == (1u64 << 53) {
            mant >>= 1;
            exp += 1;
        }
    }
    if exp + 52 > 1023 {
        return f64::INFINITY;
    }
    f64::from_bits((((exp + 52 + 1023) as u64) << 52) | (mant & ((1u64 << 52) - 1)))
}

fn try_parse_int(s: &[u8]) -> Option<f64> {
    let mut parsed: Option<Result<i64, ()>> = None;
    let mut s = s;
    let mut big_radix_bits = 0u32;
    if s.len() > 2 {
        let (prefix, rest) = (&s[..2], &s[2..]);
        let radix = match prefix {
            b"0b" | b"0B" => 2,
            b"0o" | b"0O" => 8,
            b"0x" | b"0X" => 16,
            _ => 0,
        };
        if radix != 0 {
            let ok = match radix {
                2 => all(rest, |b| b == b'0' || b == b'1'),
                8 => all(rest, |b| (b'0'..=b'7').contains(&b)),
                _ => all(rest, |b| b.is_ascii_hexdigit()),
            };
            if !ok {
                return Some(f64::NAN);
            }
            let txt = std::str::from_utf8(rest).unwrap();
            parsed = Some(i64::from_str_radix(txt, radix).map_err(|_| ()));
            big_radix_bits = match radix {
                2 => 1,
                8 => 3,
                _ => 4,
            };
        }
    }
    if parsed.is_none() {
        s = trim_leading_zeros(s);
        if !all(s, |b| b.is_ascii_digit()) {
            return None;
        }
        let txt = std::str::from_utf8(s).unwrap();
        parsed = Some(txt.parse::<i64>().map_err(|_| ()));
    }
    if let Some(Ok(i)) = parsed {
        return Some(i as f64);
    }
    if big_radix_bits != 0 {
        return Some(pow2_radix_to_f64(&s[2..], big_radix_bits));
    }
    if s.is_empty() {
        return Some(f64::NAN);
    }
    Some(std::str::from_utf8(s).unwrap().parse::<f64>().unwrap_or(f64::NAN))
}

fn cut_any<'a>(s: &'a [u8], set: &[u8]) -> (&'a [u8], &'a [u8], bool) {
    if let Some(i) = s.iter().position(|b| set.contains(b)) {
        return (&s[..i], &s[i + 1..], true);
    }
    (s, b"", false)
}

fn parse_float_string(s: &[u8]) -> f64 {
    let (mut a, b, mut c): (&[u8], &[u8], &[u8]);
    let has_exp;
    let dot = s.iter().position(|&x| x == b'.');
    let has_dot = dot.is_some();
    let mut bb: &[u8] = b"";
    if let Some(i) = dot {
        a = &s[..i];
        let rest = &s[i + 1..];
        let r = cut_any(rest, b"eE");
        bb = r.0;
        c = r.1;
        has_exp = r.2;
    } else {
        let r = cut_any(s, b"eE");
        a = r.0;
        c = r.1;
        has_exp = r.2;
    }
    b = bb;
    let mut sb: Vec<u8> = Vec::new();
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
        if !all(a, |x| x.is_ascii_digit()) {
            return f64::NAN;
        }
        sb.extend_from_slice(a);
    }
    if has_dot {
        sb.push(b'.');
        if b.is_empty() {
            sb.push(b'0');
        } else {
            let b2 = trim_trailing_zeros(b);
            if !all(b2, |x| x.is_ascii_digit()) {
                return f64::NAN;
            }
            sb.extend_from_slice(b2);
        }
    }
    if has_exp {
        sb.push(b'e');
        let negative = c.first() == Some(&b'-');
        if negative {
            sb.push(b'-');
            c = &c[1..];
        } else if c.first() == Some(&b'+') {
            c = &c[1..];
        }
        let c2 = trim_leading_zeros(c);
        if !all(c2, |x| x.is_ascii_digit()) {
            return f64::NAN;
        }
        sb.extend_from_slice(c2);
    }
    string_to_float64(&sb)
}

// strconv.ParseFloat on text of the form digits[.digits][e[-]digits]; a syntax error is NaN.
fn string_to_float64(s: &[u8]) -> f64 {
    let t = std::str::from_utf8(s).unwrap();
    let ok_syntax = {
        let (m, e) = match t.split_once('e') {
            Some((m, e)) => (m, Some(e)),
            None => (t, None),
        };
        let m_ok = {
            let (i, f) = match m.split_once('.') {
                Some((i, f)) => (i, Some(f)),
                None => (m, None),
            };
            let digits = i.len() + f.map_or(0, |f| f.len());
            digits > 0 && i.bytes().all(|b| b.is_ascii_digit()) && f.map_or(true, |f| f.bytes().all(|b| b.is_ascii_digit()))
        };
        let e_ok = match e {
            None => true,
            Some(e) => {
                let d = e.strip_prefix('-').unwrap_or(e);
                !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit())
            }
        };
        m_ok && e_ok
    };
    if !ok_syntax {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

fn from_string(s: &[u8]) -> f64 {
    let s = trim_func(s, is_str_white_space);
    match s {
        b"" => return 0.0,
        b"Infinity" | b"+Infinity" => return f64::INFINITY,
        b"-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let mut i = 0;
    while i < s.len() {
        let (r, n) = decode_rune(&s[i..]);
        if !is_number_rune(r) {
            return f64::NAN;
        }
        i += n;
    }
    if let Some(n) = try_parse_int(s) {
        return n;
    }
    let mut s = s;
    let negative = s.first() == Some(&b'-');
    if negative {
        s = &s[1..];
    } else if s.first() == Some(&b'+') {
        s = &s[1..];
    }
    let (first, _) = decode_rune(s);
    if !is_digit(first) && first != '.' as u32 {
        return f64::NAN;
    }
    let f = parse_float_string(s);
    if f.is_nan() {
        return f64::NAN;
    }
    if negative { -f.abs() } else { f.abs() }
}

fn is_non_finite(x: f64) -> bool {
    const MASK: u64 = 0x7FF0_0000_0000_0000;
    x.to_bits() & MASK == MASK
}

fn to_int32(x: f64) -> i32 {
    let smi = x as i32;
    if smi as f64 == x {
        return smi;
    }
    if is_non_finite(x) {
        return 0;
    }
    let x = x.trunc();
    let x = x % 4294967296.0;
    (x as i64) as i32
}

fn to_uint32(x: f64) -> u32 {
    to_int32(x) as u32
}

fn shift_count(x: f64) -> u32 {
    to_uint32(x) & 31
}

fn remainder(n: f64, d: f64) -> f64 {
    if n.is_nan() || d.is_nan() {
        return f64::NAN;
    }
    if n.is_infinite() {
        return f64::NAN;
    }
    if d.is_infinite() {
        return n;
    }
    if d == 0.0 {
        return f64::NAN;
    }
    if n == 0.0 {
        return n;
    }
    n % d
}

fn normalize(x: f64) -> (f64, i32) {
    if x.abs() < 2.2250738585072014e-308 {
        return (x * (1u64 << 52) as f64, -52);
    }
    (x, 0)
}

fn frexp(f: f64) -> (f64, i32) {
    if f == 0.0 || f.is_infinite() || f.is_nan() {
        return (f, 0);
    }
    let (f, mut exp) = normalize(f);
    let mut x = f.to_bits();
    exp += ((x >> 52) & 0x7FF) as i32 - 1023 + 1;
    x &= !(0x7FFu64 << 52);
    x |= 1022u64 << 52;
    (f64::from_bits(x), exp)
}

fn ldexp(frac: f64, exp: i64) -> f64 {
    if frac == 0.0 || frac.is_infinite() || frac.is_nan() {
        return frac;
    }
    let (frac, e) = normalize(frac);
    let mut exp = exp + e as i64;
    let mut x = frac.to_bits();
    exp += ((x >> 52) as i64 & 0x7FF) - 1023;
    if exp < -1075 {
        return 0.0f64.copysign(frac);
    }
    if exp > 1023 {
        return if frac < 0.0 { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    let mut m = 1.0f64;
    if exp < -1022 {
        exp += 53;
        m = 1.0 / (1u64 << 53) as f64;
    }
    x &= !(0x7FFu64 << 52);
    x |= ((exp + 1023) as u64) << 52;
    m * f64::from_bits(x)
}

fn modf(f: f64) -> (f64, f64) {
    if f < 1.0 {
        if f < 0.0 {
            let (i, fr) = modf(-f);
            return (-i, -fr);
        }
        if f == 0.0 {
            return (f, f);
        }
        return (0.0, f);
    }
    let mut x = f.to_bits();
    let e = ((x >> 52) & 0x7FF) as u32 - 1023;
    if e < 64 - 12 {
        x &= !((1u64 << (64 - 12 - e)) - 1);
    }
    let i = f64::from_bits(x);
    (i, f - i)
}

fn is_odd_int(x: f64) -> bool {
    if x.abs() >= (1u64 << 53) as f64 {
        return false;
    }
    let (xi, xf) = modf(x);
    xf == 0.0 && (xi as i64) & 1 == 1
}

fn go_pow(x: f64, y: f64) -> f64 {
    if y == 0.0 || x == 1.0 {
        return 1.0;
    }
    if y == 1.0 {
        return x;
    }
    if x.is_nan() || y.is_nan() {
        return f64::NAN;
    }
    if x == 0.0 {
        if y < 0.0 {
            if x.is_sign_negative() && is_odd_int(y) {
                return f64::NEG_INFINITY;
            }
            return f64::INFINITY;
        } else if y > 0.0 {
            if x.is_sign_negative() && is_odd_int(y) {
                return x;
            }
            return 0.0;
        }
    } else if y.is_infinite() {
        if x == -1.0 {
            return 1.0;
        }
        if (x.abs() < 1.0) == (y > 0.0) {
            return 0.0;
        }
        return f64::INFINITY;
    } else if x.is_infinite() {
        if x < 0.0 {
            return go_pow(1.0 / x, -y);
        }
        if y < 0.0 {
            return 0.0;
        } else if y > 0.0 {
            return f64::INFINITY;
        }
    } else if y == 0.5 {
        return x.sqrt();
    } else if y == -0.5 {
        return 1.0 / x.sqrt();
    }
    let (mut yi, mut yf) = modf(y.abs());
    if yf != 0.0 && x < 0.0 {
        return f64::NAN;
    }
    if yi >= 9223372036854775808.0 {
        if x == -1.0 {
            return 1.0;
        }
        if (x.abs() < 1.0) == (y > 0.0) {
            return 0.0;
        }
        return f64::INFINITY;
    }
    let mut a1 = 1.0f64;
    let mut ae: i64 = 0;
    if yf != 0.0 {
        if yf > 0.5 {
            yf -= 1.0;
            yi += 1.0;
        }
        a1 = (yf * x.ln()).exp();
    }
    let (mut x1, xe0) = frexp(x);
    let mut xe = xe0 as i64;
    let mut i = yi as i64;
    while i != 0 {
        if xe < -(1 << 12) || (1 << 12) < xe {
            ae += xe;
            break;
        }
        if i & 1 == 1 {
            a1 *= x1;
            ae += xe;
        }
        x1 *= x1;
        xe <<= 1;
        if x1 < 0.5 {
            x1 += x1;
            xe -= 1;
        }
        i >>= 1;
    }
    if y < 0.0 {
        a1 = 1.0 / a1;
        ae = -ae;
    }
    ldexp(a1, ae)
}

// Little-endian base 2^32 magnitude.
fn big_mul(a: &[u32], b: &[u32]) -> Vec<u32> {
    let mut r = vec![0u32; a.len() + b.len()];
    for (i, &x) in a.iter().enumerate() {
        let mut carry = 0u64;
        for (j, &y) in b.iter().enumerate() {
            let t = r[i + j] as u64 + x as u64 * y as u64 + carry;
            r[i + j] = t as u32;
            carry = t >> 32;
        }
        let mut k = i + b.len();
        while carry != 0 {
            let t = r[k] as u64 + carry;
            r[k] = t as u32;
            carry = t >> 32;
            k += 1;
        }
    }
    while r.len() > 1 && *r.last().unwrap() == 0 {
        r.pop();
    }
    r
}

fn big_bit_len(a: &[u32]) -> usize {
    let top = *a.last().unwrap();
    if top == 0 {
        return 0;
    }
    (a.len() - 1) * 32 + (32 - top.leading_zeros() as usize)
}

fn big_bit(a: &[u32], i: usize) -> u32 {
    (a[i / 32] >> (i % 32)) & 1
}

// Rounds the top `prec` bits to nearest even; returns the bits (msb first) and the exponent of the lowest kept bit.
fn big_round(a: &[u32], prec: usize) -> (Vec<u8>, usize) {
    let n = big_bit_len(a);
    let mut bits: Vec<u8> = (0..n).rev().map(|i| big_bit(a, i) as u8).collect();
    if n <= prec {
        return (bits, 0);
    }
    let round = bits[prec];
    let sticky = bits[prec + 1..].iter().any(|&b| b == 1);
    let mut low = n - prec;
    bits.truncate(prec);
    if round == 1 && (sticky || bits[prec - 1] == 1) {
        let mut i = prec;
        loop {
            if i == 0 {
                bits.insert(0, 1);
                bits.truncate(prec);
                low += 1;
                break;
            }
            i -= 1;
            if bits[i] == 0 {
                bits[i] = 1;
                break;
            }
            bits[i] = 0;
        }
    }
    (bits, low)
}

fn big_to_f64_via_256(a: &[u32], negative: bool) -> f64 {
    if big_bit_len(a) == 0 {
        return 0.0;
    }
    let (bits256, low256) = big_round(a, 256);
    let n = bits256.len();
    let mut mant: u64 = 0;
    for i in 0..53.min(n) {
        mant = (mant << 1) | bits256[i] as u64;
    }
    let mut exp = low256 as i64;
    if n > 53 {
        let round = bits256[53];
        let sticky = bits256[54..].iter().any(|&b| b == 1);
        exp += (n - 53) as i64;
        if round == 1 && (sticky || mant & 1 == 1) {
            mant += 1;
            if mant == 1u64 << 53 {
                mant >>= 1;
                exp += 1;
            }
        }
    }
    let v = if n <= 53 && low256 == 0 {
        mant as f64
    } else if exp + 52 > 1023 {
        f64::INFINITY
    } else {
        let lz = mant.leading_zeros() as i64 - 11;
        let m = mant << lz;
        let e = exp - lz;
        f64::from_bits((((e + 52 + 1023) as u64) << 52) | (m & ((1u64 << 52) - 1)))
    };
    if negative { -v } else { v }
}

fn go_log2(x: f64) -> f64 {
    let (frac, exp) = frexp(x);
    if frac == 0.5 {
        return (exp - 1) as f64;
    }
    frac.ln() * (1.0 / std::f64::consts::LN_2) + exp as f64
}

fn exponentiate(base: f64, exponent: f64) -> f64 {
    if (base == 1.0 || base == -1.0) && exponent.is_infinite() {
        return f64::NAN;
    }
    if base == 1.0 && exponent.is_nan() {
        return f64::NAN;
    }
    let (b, e) = (base, exponent);
    if b >= -9223372036854775808.0 && b <= 9223372036854775807.0 && b == b.trunc() && e >= 0.0 && e <= 9223372036854775807.0 && e == e.trunc() && !e.is_infinite() {
        let magnitude = e * go_log2(b.abs());
        if magnitude > 53.0 && magnitude <= go_log2(f64::MAX) {
            let bi = b as i64;
            let negative = bi < 0 && ((e as i64) & 1 == 1);
            let mag = bi.unsigned_abs();
            let mut basev: Vec<u32> = vec![mag as u32, (mag >> 32) as u32];
            while basev.len() > 1 && *basev.last().unwrap() == 0 {
                basev.pop();
            }
            let mut result: Vec<u32> = vec![1];
            let mut k = e as i64;
            while k != 0 {
                if k & 1 == 1 {
                    result = big_mul(&result, &basev);
                }
                k >>= 1;
                if k != 0 {
                    basev = big_mul(&basev, &basev);
                }
            }
            return big_to_f64_via_256(&result, negative);
        }
    }
    go_pow(b, e)
}

fn big_to_decimal(mut a: Vec<u32>) -> String {
    let mut chunks: Vec<u32> = Vec::new();
    loop {
        let mut rem = 0u64;
        for limb in a.iter_mut().rev() {
            let cur = (rem << 32) | *limb as u64;
            *limb = (cur / 1_000_000_000) as u32;
            rem = cur % 1_000_000_000;
        }
        chunks.push(rem as u32);
        while a.len() > 1 && *a.last().unwrap() == 0 {
            a.pop();
        }
        if a.len() == 1 && a[0] == 0 {
            break;
        }
    }
    let mut s = chunks.last().unwrap().to_string();
    for c in chunks.iter().rev().skip(1) {
        s.push_str(&format!("{:09}", c));
    }
    s
}

// big.Int.SetString(s, 0) for a prefixed literal; None is upstream's panic.
fn parse_prefixed_big(s: &[u8]) -> Option<Vec<u32>> {
    if s.len() < 2 || s[0] != b'0' {
        return None;
    }
    let radix: u32 = match s[1] {
        b'b' | b'B' => 2,
        b'o' | b'O' => 8,
        b'x' | b'X' => 16,
        _ => return None,
    };
    let mut value: Vec<u32> = vec![0];
    let mut digits = 0;
    let mut prev_underscore = false;
    let mut prev_digit_or_prefix = true;
    for &c in &s[2..] {
        if c == b'_' {
            if !prev_digit_or_prefix || prev_underscore {
                return None;
            }
            prev_underscore = true;
            prev_digit_or_prefix = false;
            continue;
        }
        let d = match c {
            b'0'..=b'9' => (c - b'0') as u32,
            b'a'..=b'z' => (c - b'a') as u32 + 10,
            b'A'..=b'Z' => (c - b'A') as u32 + 10,
            _ => return None,
        };
        if d >= radix {
            return None;
        }
        let mut carry = d as u64;
        for limb in value.iter_mut() {
            let t = *limb as u64 * radix as u64 + carry;
            *limb = t as u32;
            carry = t >> 32;
        }
        if carry != 0 {
            value.push(carry as u32);
        }
        digits += 1;
        prev_underscore = false;
        prev_digit_or_prefix = true;
    }
    if digits == 0 || prev_underscore {
        return None;
    }
    Some(value)
}

fn parse_pseudo_bigint(s: &[u8]) -> Option<String> {
    let s = s.strip_suffix(b"n").unwrap_or(s);
    let b1 = if s.len() > 1 { s[1] } else { 0 };
    match b1 {
        b'b' | b'B' | b'o' | b'O' | b'x' | b'X' => {}
        _ => {
            let mut i = 0;
            while i < s.len() && s[i] == b'0' {
                i += 1;
            }
            if i == s.len() {
                return Some("0".into());
            }
            return Some(String::from_utf8_lossy(&s[i..]).into_owned());
        }
    }
    parse_prefixed_big(s).map(big_to_decimal)
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
}

fn same(a: f64, b: u64) -> bool {
    if a.is_nan() {
        return f64::from_bits(b).is_nan();
    }
    a.to_bits() == b
}

fn main() {
    let stdin = io::stdin();
    let mut counts = std::collections::BTreeMap::<String, (u64, u64)>::new();
    let mut shown = 0;
    let mut seen = std::collections::HashSet::<String>::new();
    let mut case_mismatch_lower = 0u64;
    let mut case_mismatch_upper = 0u64;
    let mut case_examples: Vec<String> = Vec::new();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let f: Vec<&str> = line.split('\t').collect();
        let kind = f[0].to_string();
        let mut ok = true;
        match f[0] {
            "F" => {
                let s = unhex(f[1]);
                let want = u64::from_str_radix(f[2], 16).unwrap();
                let got = from_string(&s);
                ok = same(got, want);
                if !ok && shown < 40 {
                    shown += 1;
                    println!("F mismatch {:?} got {:e} want {:e}", String::from_utf8_lossy(&s), got, f64::from_bits(want));
                }
            }
            "S" => {
                let bits = u64::from_str_radix(f[1], 16).unwrap();
                let got = number_to_string(f64::from_bits(bits));
                ok = got == f[2];
                if !ok {
                    let key = format!("S mismatch {:016x} got {} want {}", bits & 0x7fff_ffff_ffff_ffff, got.trim_start_matches('-'), f[2].trim_start_matches('-'));
                    if seen.insert(key.clone()) && shown < 60 {
                        shown += 1;
                        println!("{}", key);
                    }
                }
            }
            "B" => {
                let v: Vec<u64> = f[1..].iter().map(|x| u64::from_str_radix(x, 16).unwrap()).collect();
                let (a, b) = (f64::from_bits(v[0]), f64::from_bits(v[1]));
                let r = [
                    (to_int32(a) | to_int32(b)) as f64,
                    (to_int32(a) & to_int32(b)) as f64,
                    (to_int32(a) ^ to_int32(b)) as f64,
                    (to_int32(a) >> shift_count(b)) as f64,
                    (to_uint32(a) >> shift_count(b)) as f64,
                    (to_int32(a).wrapping_shl(shift_count(b))) as f64,
                    remainder(a, b),
                ];
                for i in 0..7 {
                    if !same(r[i], v[2 + i]) {
                        ok = false;
                        if shown < 40 {
                            shown += 1;
                            println!("B mismatch op{} a={:e} b={:e} got {:e} want {:e}", i, a, b, r[i], f64::from_bits(v[2 + i]));
                        }
                    }
                }
            }
            "N" => {
                let a = f64::from_bits(u64::from_str_radix(f[1], 16).unwrap());
                let want = u64::from_str_radix(f[2], 16).unwrap();
                ok = same((!to_int32(a)) as f64, want);
            }
            "P" => {
                let a = f64::from_bits(u64::from_str_radix(f[1], 16).unwrap());
                let b = f64::from_bits(u64::from_str_radix(f[2], 16).unwrap());
                let want = u64::from_str_radix(f[3], 16).unwrap();
                let got = exponentiate(a, b);
                ok = same(got, want);
                if !ok && shown < 40 {
                    shown += 1;
                    println!("P mismatch {:e} ** {:e} got {:e} ({:016x}) want {:e} ({:016x}) libm {:e}", a, b, got, got.to_bits(), f64::from_bits(want), want, a.powf(b));
                }
                let libm = a.powf(b);
                let e = counts.entry("P-libm-powf".into()).or_insert((0, 0));
                e.0 += 1;
                if !same(libm, want) {
                    e.1 += 1;
                }
            }
            "G" => {
                let s = unhex(f[1]);
                let got = parse_pseudo_bigint(&s).unwrap_or_else(|| "PANIC".into());
                ok = got == f[2];
                if !ok {
                    println!("G mismatch {:?} got {} want {}", String::from_utf8_lossy(&s), got, f[2]);
                }
            }
            "C" => {
                let cp = u32::from_str_radix(f[1], 16).unwrap();
                let c = char::from_u32(cp).unwrap();
                let lo: String = c.to_lowercase().collect();
                let up: String = c.to_uppercase().collect();
                let wl = String::from_utf8(unhex(f[2])).unwrap();
                let wu = String::from_utf8(unhex(f[3])).unwrap();
                if lo != wl {
                    case_mismatch_lower += 1;
                    if case_examples.len() < 12 {
                        case_examples.push(format!("lower U+{:04X}: std {:?} upstream {:?}", cp, lo, wl));
                    }
                }
                if up != wu {
                    case_mismatch_upper += 1;
                    if case_examples.len() < 24 {
                        case_examples.push(format!("upper U+{:04X}: std {:?} upstream {:?}", cp, up, wu));
                    }
                }
            }
            _ => {}
        }
        let e = counts.entry(kind).or_insert((0, 0));
        e.0 += 1;
        if !ok {
            e.1 += 1;
        }
    }
    for (k, (n, bad)) in &counts {
        println!("{} total={} mismatches={}", k, n, bad);
    }
    println!("std case tables vs upstream tables: lower mismatches={} upper mismatches={}", case_mismatch_lower, case_mismatch_upper);
    for e in case_examples {
        println!("  {}", e);
    }
}
