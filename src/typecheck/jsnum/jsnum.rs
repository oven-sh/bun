// internal/jsnum/jsnum.go: JS-like number handling.

pub const MAX_SAFE_INTEGER: Number = Number(9007199254740991.0);
pub const MIN_SAFE_INTEGER: Number = Number(-9007199254740991.0);

// Number represents a JS-like number. All operations that can be performed directly on this type (conversion, arithmetic) behave as they would in JavaScript, but any other operation should use this type's methods.
#[derive(Clone, Copy, PartialEq, PartialOrd, Default, Debug)]
pub struct Number(pub f64);

impl std::ops::Add for Number {
    type Output = Number;
    fn add(self, rhs: Number) -> Number {
        Number(self.0 + rhs.0)
    }
}

impl std::ops::Sub for Number {
    type Output = Number;
    fn sub(self, rhs: Number) -> Number {
        Number(self.0 - rhs.0)
    }
}

impl std::ops::Mul for Number {
    type Output = Number;
    fn mul(self, rhs: Number) -> Number {
        Number(self.0 * rhs.0)
    }
}

impl std::ops::Div for Number {
    type Output = Number;
    fn div(self, rhs: Number) -> Number {
        Number(self.0 / rhs.0)
    }
}

impl std::ops::Neg for Number {
    type Output = Number;
    fn neg(self) -> Number {
        Number(-self.0)
    }
}

pub fn nan() -> Number {
    Number(f64::NAN)
}

impl Number {
    pub fn is_nan(self) -> bool {
        self.0.is_nan()
    }
}

pub fn inf(sign: isize) -> Number {
    Number(if sign >= 0 {
        f64::INFINITY
    } else {
        f64::NEG_INFINITY
    })
}

impl Number {
    pub fn is_inf(self) -> bool {
        self.0.is_infinite()
    }
}

fn is_non_finite(x: f64) -> bool {
    // This is equivalent to checking `math.IsNaN(x) || math.IsInf(x, 0)` in one operation.
    const MASK: u64 = 0x7FF0000000000000;
    x.to_bits() & MASK == MASK
}

impl Number {
    // https://tc39.es/ecma262/2024/multipage/abstract-operations.html#sec-touint32
    fn to_uint32(self) -> u32 {
        // The only difference between ToUint32 and ToInt32 is the interpretation of the bits.
        self.to_int32() as u32
    }

    // https://tc39.es/ecma262/2024/multipage/abstract-operations.html#sec-toint32
    fn to_int32(self) -> i32 {
        let mut x = self.0;

        // Fast path: if the number is in the range (-2^31, 2^32), i.e. an SMI, then we don't need to do any special mapping.
        let smi = x as i32;
        if f64::from(smi) == x {
            return smi;
        }

        // 2. If number is not finite or number is either +0𝔽 or -0𝔽, return +0𝔽. Zero was covered by the test above.
        if is_non_finite(x) {
            return 0;
        }

        // Let int be truncate(ℝ(number)).
        x = x.trunc();
        // Let int32bit be int modulo 2**32.
        x %= 4294967296.0;
        // If int32bit ≥ 2**31, return 𝔽(int32bit - 2**32); otherwise return 𝔽(int32bit).
        (x as i64) as i32
    }

    fn to_shift_count(self) -> u32 {
        self.to_uint32() & 31
    }

    // https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-signedRightShift
    pub fn signed_right_shift(self, y: Number) -> Number {
        Number(f64::from(self.to_int32() >> y.to_shift_count()))
    }

    // https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-unsignedRightShift
    pub fn unsigned_right_shift(self, y: Number) -> Number {
        Number(f64::from(self.to_uint32() >> y.to_shift_count()))
    }

    // https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-leftShift
    pub fn left_shift(self, y: Number) -> Number {
        Number(f64::from(self.to_int32() << y.to_shift_count()))
    }

    // https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-bitwiseNOT
    pub fn bitwise_not(self) -> Number {
        Number(f64::from(!self.to_int32()))
    }

    // https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-bitwiseOR
    pub fn bitwise_or(self, y: Number) -> Number {
        Number(f64::from(self.to_int32() | y.to_int32()))
    }

    // https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-bitwiseAND
    pub fn bitwise_and(self, y: Number) -> Number {
        Number(f64::from(self.to_int32() & y.to_int32()))
    }

    // https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-bitwiseXOR
    pub fn bitwise_xor(self, y: Number) -> Number {
        Number(f64::from(self.to_int32() ^ y.to_int32()))
    }

    pub fn floor(self) -> Number {
        Number(self.0.floor())
    }

    pub fn abs(self) -> Number {
        Number(self.0.abs())
    }

    // https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-remainder
    pub fn remainder(self, d: Number) -> Number {
        let n = self;
        if n.is_nan() || d.is_nan() {
            return nan();
        }
        if n.is_inf() {
            return nan();
        }
        if d.is_inf() {
            return n;
        }
        if d.0 == 0.0 {
            return nan();
        }
        if n.0 == 0.0 {
            return n;
        }
        Number(n.0 % d.0)
    }

    // https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-exponentiate
    pub fn exponentiate(self, exponent: Number) -> Number {
        let base = self;
        if (base.0 == 1.0 || base.0 == -1.0) && exponent.is_inf() {
            return nan();
        }
        if base.0 == 1.0 && exponent.is_nan() {
            return nan();
        }

        let b = base.0;
        let e = exponent.0;

        // For integer base ** integer exponent where the result exceeds 53 bits, math.Pow can be off by multiple ULPs vs JS engines. Use exact big.Int arithmetic and IEEE 754 round-to-nearest-even conversion instead: the result is always within 1 ULP of every engine.
        if b >= math::MIN_INT64
            && b <= math::MAX_INT64
            && b == b.trunc()
            && e >= 0.0
            && e <= math::MAX_INT64
            && e == e.trunc()
            && !e.is_infinite()
        {
            let magnitude = e * math::log2(b.abs());
            if magnitude > 53.0 && magnitude <= math::log2(f64::MAX) {
                let ri = big::Int::new(b as i64).exp(e as i64);
                return Number(ri.float64_with_prec(256));
            }
        }

        Number(math::pow(b, e))
    }
}

// Go's math: the functions above call these, and their results are Go's on amd64 with FMA, bit for bit.
pub mod math {
    // math.MinInt64 and math.MaxInt64 as float64 constants.
    pub const MIN_INT64: f64 = -9223372036854775808.0;
    pub const MAX_INT64: f64 = 9223372036854775808.0;

    const SMALLEST_NORMAL: f64 = 2.2250738585072014e-308;
    const SHIFT: u32 = 52;
    const MASK: u64 = 0x7FF;
    const BIAS: i64 = 1023;

    fn normalize(x: f64) -> (f64, i64) {
        if x.abs() < SMALLEST_NORMAL {
            return (x * 4503599627370496.0, -52);
        }
        (x, 0)
    }

    // math.Frexp: frac in [0.5, 1) and the power of two, with f == frac × 2**exp.
    pub fn frexp(f: f64) -> (f64, i64) {
        if f == 0.0 || f.is_infinite() || f.is_nan() {
            return (f, 0);
        }
        let (f, mut exp) = normalize(f);
        let mut x = f.to_bits();
        exp += ((x >> SHIFT) & MASK) as i64 - BIAS + 1;
        x &= !(MASK << SHIFT);
        x |= ((BIAS - 1) as u64) << SHIFT;
        (f64::from_bits(x), exp)
    }

    // math.Ldexp: frac × 2**exp.
    pub fn ldexp(frac: f64, exp: i64) -> f64 {
        if frac == 0.0 || frac.is_infinite() || frac.is_nan() {
            return frac;
        }
        let (frac, e) = normalize(frac);
        let mut exp = exp.saturating_add(e);
        let mut x = frac.to_bits();
        exp = exp.saturating_add(((x >> SHIFT) & MASK) as i64 - BIAS);
        if exp < -1075 {
            return 0.0f64.copysign(frac);
        }
        if exp > 1023 {
            if frac < 0.0 {
                return f64::NEG_INFINITY;
            }
            return f64::INFINITY;
        }
        let mut m: f64 = 1.0;
        if exp < -1022 {
            exp += 53;
            m = 1.0 / 9007199254740992.0;
        }
        x &= !(MASK << SHIFT);
        x |= ((exp + BIAS) as u64) << SHIFT;
        m * f64::from_bits(x)
    }

    // math.Modf: the integer and the fractional part, both with the sign of f.
    pub fn modf(f: f64) -> (f64, f64) {
        let integer = f.trunc();
        (integer, (f - integer).copysign(f))
    }

    // math.Log as Go's amd64 assembly computes it.
    pub fn log(x: f64) -> f64 {
        const H_SQRT2: f64 = 7.07106781186547524401e-01;
        const LN2_HI: f64 = 6.93147180369123816490e-01;
        const LN2_LO: f64 = 1.90821492927058770002e-10;
        const L1: f64 = 6.666666666666735130e-01;
        const L2: f64 = 3.999999999940941908e-01;
        const L3: f64 = 2.857142874366239149e-01;
        const L4: f64 = 2.222219843214978396e-01;
        const L5: f64 = 1.818357216161805012e-01;
        const L6: f64 = 1.531383769920937332e-01;
        const L7: f64 = 1.479819860511658591e-01;

        let bits = x.to_bits();
        if bits & !(1 << 63) == 0 {
            return f64::NEG_INFINITY;
        }
        if (bits as i64) < 0 {
            return f64::NAN;
        }
        if bits >= 0x7FF0000000000000 {
            return x;
        }
        // f1, ki := math.Frexp(x); k := float64(ki)
        let mut f1 = f64::from_bits((bits & 0x000FFFFFFFFFFFFF) | 0x3FE0000000000000);
        let mut k = (((bits >> 52) & 0x7FF) as i64 - 0x3FE) as f64;
        if f1 <= H_SQRT2 {
            k -= 1.0;
            f1 *= 2.0;
        }
        let f = f1 - 1.0;
        let s = f / (2.0 + f);
        let s2 = s * s;
        let s4 = s2 * s2;
        let t1 = s2 * (((L7 * s4 + L5) * s4 + L3) * s4 + L1);
        let t2 = s4 * ((L6 * s4 + L4) * s4 + L2);
        let r = t1 + t2;
        let hfsq = 0.5 * f * f;
        k * LN2_HI - ((hfsq - (s * (hfsq + r) + k * LN2_LO)) - f)
    }

    // math.Exp as Go's amd64 assembly computes it on a processor with FMA.
    pub fn exp(x: f64) -> f64 {
        const LOG2E: f64 = 1.4426950408889634073599246810018920;
        const LN2U: f64 = 0.69314718055966295651160180568695068359375;
        const LN2L: f64 = 0.28235290563031577122588448175013436025525412068e-12;
        const OVERFLOW: f64 = 7.09782712893384e+02;

        let bits = x.to_bits();
        if bits & !(1 << 63) >= 0x7FF0000000000000 {
            if bits == 0xFFF0000000000000 {
                return 0.0;
            }
            return x;
        }
        if x > OVERFLOW {
            return f64::INFINITY;
        }
        // CVTSD2SL: the nearest int32, ties to even, and the smallest int32 when the value has none.
        let rounded = (LOG2E * x).round_ties_even();
        let mut exponent: i32 = if (-2147483648.0..=2147483647.0).contains(&rounded) {
            rounded as i32
        } else {
            i32::MIN
        };
        let k = f64::from(exponent);
        let mut r = (-k).mul_add(LN2U, x);
        r = (-k).mul_add(LN2L, r);
        // reduce argument
        r *= 0.0625;
        // Taylor series evaluation
        let mut t: f64 = 2.4801587301587301587e-5;
        t = t.mul_add(r, 1.9841269841269841270e-4);
        t = t.mul_add(r, 1.3888888888888888889e-3);
        t = t.mul_add(r, 8.3333333333333333333e-3);
        t = t.mul_add(r, 4.1666666666666666667e-2);
        t = t.mul_add(r, 1.6666666666666666667e-1);
        t = t.mul_add(r, 0.5);
        t = t.mul_add(r, 1.0);
        r *= t;
        r *= r + 2.0;
        r *= r + 2.0;
        r *= r + 2.0;
        let fr = r.mul_add(r + 2.0, 1.0);
        // return fr * 2**exponent
        exponent = exponent.wrapping_add(0x3FF);
        if exponent <= 0 {
            if exponent < -52 {
                return 0.0;
            }
            let scaled = fr * f64::from_bits(((exponent + 0x3FE) as u64) << 52);
            return scaled * f64::from_bits(1 << 52);
        }
        if exponent >= 0x7FF {
            return f64::INFINITY;
        }
        fr * f64::from_bits((exponent as u64) << 52)
    }

    // math.Log2
    pub fn log2(x: f64) -> f64 {
        let (frac, exp) = frexp(x);
        // Make sure exact powers of two give an exact answer. Don't depend on Log(0.5)*(1/Ln2)+exp being exactly exp-1.
        if frac == 0.5 {
            return (exp - 1) as f64;
        }
        log(frac) * std::f64::consts::LOG2_E + exp as f64
    }

    fn is_odd_int(x: f64) -> bool {
        if x.abs() >= 9007199254740992.0 {
            // 1 << 53 is the largest exact integer in the float64 format. Any number outside this range will be truncated before the decimal point and therefore will always be an even integer.
            return false;
        }
        let (xi, xf) = modf(x);
        xf == 0.0 && (xi as i64) & 1 == 1
    }

    // math.Pow: x**y with the special cases of IEEE Std. 754-2008 "Section 9.2.1 Special values".
    pub fn pow(x: f64, y: f64) -> f64 {
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
            }
            if y > 0.0 {
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
                // Pow(-0, -y)
                return pow(1.0 / x, -y);
            }
            if y < 0.0 {
                return 0.0;
            }
            if y > 0.0 {
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
            // yi is a large even int that will lead to overflow (or underflow to 0) for all x except -1 (x == 1 was handled earlier)
            if x == -1.0 {
                return 1.0;
            }
            if (x.abs() < 1.0) == (y > 0.0) {
                return 0.0;
            }
            return f64::INFINITY;
        }

        // ans = a1 * 2**ae (= 1 for now).
        let mut a1: f64 = 1.0;
        let mut ae: i64 = 0;

        // ans *= x**yf
        if yf != 0.0 {
            if yf > 0.5 {
                yf -= 1.0;
                yi += 1.0;
            }
            a1 = exp(yf * log(x));
        }

        // ans *= x**yi by multiplying in successive squarings of x according to bits of yi. accumulate powers of two into exp.
        let (mut x1, mut xe) = frexp(x);
        let mut i = yi as i64;
        while i != 0 {
            if !(-(1 << 12)..=(1 << 12)).contains(&xe) {
                // catch xe before it overflows the left shift below: ae += xe is a lower bound on ae that already exceeds the size of a float64 exp, so the final call to Ldexp will produce under/overflow (0/Inf)
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

        // ans = a1*2**ae; if y < 0 { ans = 1 / ans } but in the opposite order
        if y < 0.0 {
            a1 = 1.0 / a1;
            ae = -ae;
        }
        ldexp(a1, ae)
    }
}

// Go's math/big: the integer operations the ported functions use.
pub mod big {
    // An integer of any size: the sign and the magnitude, least significant 32 bits first, without leading zero words.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct Int {
        neg: bool,
        abs: Vec<u32>,
    }

    fn trim(abs: &mut Vec<u32>) {
        while abs.last() == Some(&0) {
            abs.pop();
        }
    }

    fn mul(a: &[u32], b: &[u32]) -> Vec<u32> {
        let mut r = vec![0u32; a.len() + b.len()];
        for (i, &x) in a.iter().enumerate() {
            let mut carry: u64 = 0;
            for (j, &y) in b.iter().enumerate() {
                if let Some(slot) = r.get_mut(i + j) {
                    let t = u64::from(*slot) + u64::from(x) * u64::from(y) + carry;
                    *slot = t as u32;
                    carry = t >> 32;
                }
            }
            if let Some(slot) = r.get_mut(i + b.len()) {
                *slot = carry as u32;
            }
        }
        trim(&mut r);
        r
    }

    // abs = abs × factor + addend
    fn mul_add_small(abs: &mut Vec<u32>, factor: u32, addend: u32) {
        let mut carry = u64::from(addend);
        for word in abs.iter_mut() {
            let t = u64::from(*word) * u64::from(factor) + carry;
            *word = t as u32;
            carry = t >> 32;
        }
        if carry != 0 {
            abs.push(carry as u32);
        }
    }

    // abs = abs / divisor, returns the remainder
    fn div_rem_small(abs: &mut Vec<u32>, divisor: u32) -> u32 {
        let mut rem: u64 = 0;
        for word in abs.iter_mut().rev() {
            let cur = (rem << 32) | u64::from(*word);
            *word = (cur / u64::from(divisor)) as u32;
            rem = cur % u64::from(divisor);
        }
        trim(abs);
        rem as u32
    }

    fn bit_len(abs: &[u32]) -> usize {
        match abs.last() {
            Some(&top) => (abs.len() - 1) * 32 + (32 - top.leading_zeros() as usize),
            None => 0,
        }
    }

    fn bit(abs: &[u32], i: usize) -> bool {
        abs.get(i / 32)
            .is_some_and(|word| (word >> (i % 32)) & 1 == 1)
    }

    // The bits of a magnitude, most significant first, with the power of two that the last one stands for.
    struct Mantissa {
        bits: Vec<bool>,
        exp: usize,
    }

    impl Mantissa {
        // Rounds to at most `prec` bits, to nearest and to even on a tie.
        fn round(&mut self, prec: usize) {
            let n = self.bits.len();
            if n <= prec || prec == 0 {
                return;
            }
            let round_up = self.bits.get(prec).copied().unwrap_or(false)
                && (self.bits.iter().skip(prec + 1).any(|&b| b)
                    || self.bits.get(prec - 1).copied().unwrap_or(false));
            self.bits.truncate(prec);
            self.exp += n - prec;
            if round_up {
                let mut carried = true;
                for b in self.bits.iter_mut().rev() {
                    if *b {
                        *b = false;
                    } else {
                        *b = true;
                        carried = false;
                        break;
                    }
                }
                if carried {
                    // every bit was set: the value is now a one and `prec` zeros, of which the last is dropped
                    if let Some(first) = self.bits.first_mut() {
                        *first = true;
                    }
                    self.exp += 1;
                }
            }
        }
    }

    impl Int {
        // big.NewInt
        pub fn new(x: i64) -> Int {
            let magnitude = x.unsigned_abs();
            let mut abs = vec![magnitude as u32, (magnitude >> 32) as u32];
            trim(&mut abs);
            Int { neg: x < 0, abs }
        }

        // `z.Exp(x, y, nil)`: x**y, and 1 for y <= 0. The result has y times the bits of x: the caller bounds them.
        pub fn exp(&self, y: i64) -> Int {
            let mut result: Vec<u32> = vec![1];
            if y <= 0 {
                return Int {
                    neg: false,
                    abs: result,
                };
            }
            let mut base = self.abs.clone();
            let mut k = y;
            while k != 0 {
                if k & 1 == 1 {
                    result = mul(&result, &base);
                }
                k >>= 1;
                if k != 0 {
                    base = mul(&base, &base);
                }
            }
            let neg = self.neg && y & 1 == 1 && !result.is_empty();
            Int { neg, abs: result }
        }

        // `new(big.Int).SetString(s, 0)`: a sign, a prefix 0b, 0o or 0x or a leading 0 for octal, and digits with single underscores between them. None where Go reports failure.
        pub fn set_string(s: &[u8]) -> Option<Int> {
            let mut i: usize = 0;
            let mut neg = false;
            match s.first() {
                Some(b'-') => {
                    neg = true;
                    i = 1;
                }
                Some(b'+') => i = 1,
                _ => {}
            }
            let mut base: u32 = 10;
            let mut prefix: u8 = 0;
            let mut prev = b'.';
            let mut count: usize = 0;
            let mut inval_sep = false;
            if s.get(i) == Some(&b'0') {
                prev = b'0';
                count = 1;
                i += 1;
                if let Some(&ch) = s.get(i) {
                    (base, prefix) = match ch {
                        b'b' | b'B' => (2, b'b'),
                        b'o' | b'O' => (8, b'o'),
                        b'x' | b'X' => (16, b'x'),
                        _ => (8, b'0'),
                    };
                    // prefix is not counted
                    count = 0;
                    if prefix != b'0' {
                        i += 1;
                    }
                }
            }
            let mut abs: Vec<u32> = Vec::new();
            while let Some(&ch) = s.get(i) {
                if ch == b'_' {
                    if prev != b'0' {
                        inval_sep = true;
                    }
                    prev = b'_';
                } else {
                    let d1 = match ch {
                        b'0'..=b'9' => u32::from(ch - b'0'),
                        b'a'..=b'z' => u32::from(ch - b'a') + 10,
                        b'A'..=b'Z' => u32::from(ch - b'A') + 10,
                        _ => u32::MAX,
                    };
                    if d1 >= base {
                        // ch does not belong to number anymore
                        break;
                    }
                    prev = b'0';
                    count += 1;
                    mul_add_small(&mut abs, base, d1);
                }
                i += 1;
            }
            if prev == b'_' {
                inval_sep = true;
            }
            if count == 0 {
                if prefix != b'0' {
                    return None;
                }
                // there was only the octal prefix 0 (possibly followed by separators and digits > 7); interpret as decimal 0
                abs.clear();
            }
            // entire content must have been consumed
            if inval_sep || i != s.len() {
                return None;
            }
            trim(&mut abs);
            let neg = neg && !abs.is_empty();
            Some(Int { neg, abs })
        }

        // `x.Float64()`: the nearest float64, an infinity when the magnitude is too large.
        pub fn float64(&self) -> f64 {
            self.float64_with_prec(usize::MAX)
        }

        // `new(big.Float).SetPrec(prec).SetInt(x).Float64()`: rounded to `prec` bits first, then to a float64, each time to nearest even.
        pub fn float64_with_prec(&self, prec: usize) -> f64 {
            let n = bit_len(&self.abs);
            let mut mantissa = Mantissa {
                bits: (0..n).rev().map(|i| bit(&self.abs, i)).collect(),
                exp: 0,
            };
            mantissa.round(prec);
            mantissa.round(53);
            let mut mant: u64 = 0;
            for &b in &mantissa.bits {
                mant = (mant << 1) | u64::from(b);
            }
            if mant == 0 {
                return 0.0;
            }
            let top = mantissa.bits.len() - 1 + mantissa.exp;
            let value = if top > 1023 {
                f64::INFINITY
            } else {
                mant as f64 * f64::from_bits((mantissa.exp as u64 + 1023) << 52)
            };
            if self.neg { -value } else { value }
        }

        // `x.String()`: the decimal digits, with a minus sign for a negative value.
        pub fn string(&self) -> Vec<u8> {
            let mut abs = self.abs.clone();
            let mut chunks: Vec<u32> = Vec::new();
            while !abs.is_empty() {
                chunks.push(div_rem_small(&mut abs, 1_000_000_000));
            }
            let mut out: Vec<u8> = Vec::new();
            if self.neg {
                out.push(b'-');
            }
            match chunks.pop() {
                Some(first) => out.extend_from_slice(first.to_string().as_bytes()),
                None => out.push(b'0'),
            }
            while let Some(chunk) = chunks.pop() {
                out.extend_from_slice(format!("{chunk:09}").as_bytes());
            }
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stringutil::util::strings::split;

    fn bits(field: &[u8]) -> f64 {
        f64::from_bits(u64::from_str_radix(std::str::from_utf8(field).unwrap(), 16).unwrap())
    }

    fn same(a: Number, b: f64) -> bool {
        if a.0.is_nan() {
            return b.is_nan();
        }
        a.0.to_bits() == b.to_bits()
    }

    // Replays what upstream's Go code answered: B is the two operands and the six bitwise results and the remainder, N the operand and its bitwise NOT, P the base, the exponent and the power.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn arithmetic_matches_upstream_vectors() {
        let text = include_bytes!("testdata/arithmetic.tsv");
        let (mut binary, mut not, mut power) = (0, 0, 0);
        for line in split(text, b"\n") {
            if line.is_empty() {
                continue;
            }
            let f = split(line, b"\t");
            let shown = std::str::from_utf8(line).unwrap();
            match f[0] {
                b"B" => {
                    let (a, b) = (Number(bits(f[1])), Number(bits(f[2])));
                    let got = [
                        a.bitwise_or(b),
                        a.bitwise_and(b),
                        a.bitwise_xor(b),
                        a.signed_right_shift(b),
                        a.unsigned_right_shift(b),
                        a.left_shift(b),
                        a.remainder(b),
                    ];
                    for (i, value) in got.iter().enumerate() {
                        assert!(same(*value, bits(f[3 + i])), "operation {i} of {shown}");
                    }
                    binary += 1;
                }
                b"N" => {
                    assert!(
                        same(Number(bits(f[1])).bitwise_not(), bits(f[2])),
                        "{shown}"
                    );
                    not += 1;
                }
                b"P" => {
                    let got = Number(bits(f[1])).exponentiate(Number(bits(f[2])));
                    assert!(
                        same(got, bits(f[3])),
                        "{shown} gives {:016x}",
                        got.0.to_bits()
                    );
                    power += 1;
                }
                other => panic!("unknown vector {other:?}"),
            }
        }
        assert_eq!((binary, not, power), (400, 400, 1242));
    }

    #[test]
    fn number_is_a_float64() {
        assert!(nan().is_nan());
        assert!(inf(1).is_inf() && inf(1).0 > 0.0);
        assert!(inf(-1).is_inf() && inf(-1).0 < 0.0);
        assert_eq!(Number(1.5) + Number(2.0), Number(3.5));
        assert_eq!(
            Number(7.0) - Number(2.0) * Number(3.0) / Number(4.0),
            Number(5.5)
        );
        assert_eq!(-Number(2.0), Number(-2.0));
        assert_eq!(Number(-2.5).abs(), Number(2.5));
        assert_eq!(Number(-2.5).floor(), Number(-3.0));
        assert!(MIN_SAFE_INTEGER < Number(0.0) && Number(0.0) < MAX_SAFE_INTEGER);
        assert_eq!(Number::default(), Number(0.0));
    }

    #[test]
    fn big_integers_follow_go() {
        assert_eq!(
            big::Int::set_string(b"0x_F").map(|i| i.string()),
            Some(b"15".to_vec())
        );
        assert_eq!(big::Int::set_string(b"0x"), None);
        assert_eq!(big::Int::set_string(b"1__0"), None);
        assert_eq!(big::Int::set_string(b"10_"), None);
        assert_eq!(big::Int::set_string(b"_10"), None);
        assert_eq!(
            big::Int::set_string(b"017").map(|i| i.string()),
            Some(b"15".to_vec())
        );
        assert_eq!(big::Int::set_string(b"08"), None);
        assert_eq!(
            big::Int::set_string(b"-12").map(|i| i.string()),
            Some(b"-12".to_vec())
        );
        assert_eq!(
            big::Int::set_string(b"-0").map(|i| i.string()),
            Some(b"0".to_vec())
        );
        assert_eq!(big::Int::new(-3).exp(3).string(), b"-27");
        assert_eq!(
            big::Int::new(10).exp(30).string(),
            b"1000000000000000000000000000000"
        );
        assert_eq!(big::Int::new(2).exp(1024).float64(), f64::INFINITY);
        assert_eq!(big::Int::new(2).exp(1023).float64(), 8.98846567431158e307);
        let odd = big::Int::set_string(b"9007199254740993").map(|i| i.float64());
        assert_eq!(odd, Some(9007199254740992.0));
    }
}
