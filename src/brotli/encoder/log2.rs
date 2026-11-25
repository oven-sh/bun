/// For tables. `value` is not zero.
pub(super) const fn const_log2(value: u32) -> f32 {
    let exponent = value.ilog2();
    let mantissa = value as f64 / (1u32 << exponent) as f64;
    // ln(m) = 2 * atanh((m - 1) / (m + 1))
    let z = (mantissa - 1.0) / (mantissa + 1.0);
    let (mut sum, mut power, mut k) = (0.0, z, 1);
    while k < 64 {
        sum += power / k as f64;
        power *= z * z;
        k += 2;
    }
    (exponent as f64 + 2.0 * sum * core::f64::consts::LOG2_E) as f32
}

/// With the precision of an `f32`, which the output of the encoder depends on.
static SMALL: [f64; 256] = {
    let (mut table, mut i) = ([0.0; 256], 1);
    while i < 256 {
        table[i as usize] = const_log2(i) as f64;
        i += 1;
    }
    table
};

pub(super) const FRACTION_BITS: u32 = f32::MANTISSA_DIGITS - 1;

#[inline(always)]
pub(super) fn fixed_point_log2(value: u8) -> u32 {
    static FIXED: [u32; 256] = {
        let (mut table, mut i) = ([0; 256], 0);
        while i < 256 {
            let scaled = SMALL[i] * (1 << FRACTION_BITS) as f64;
            table[i] = scaled as u32;
            assert!(table[i] as f64 == scaled);
            i += 1;
        }
        table
    };
    FIXED[usize::from(value)]
}

/// Zero for zero.
#[inline(always)]
pub(super) fn fast_log2(value: usize) -> f64 {
    match SMALL.get(value) {
        Some(&log) => log,
        None => {
            // Keeps the sums of the callers in registers.
            core::hint::cold_path();
            (value as f64).log2()
        }
    }
}

/// Of the low 32 bits. Zero for zero.
#[inline(always)]
pub(super) fn log2_floor(value: usize) -> u32 {
    (value as u32 | 1).ilog2()
}
