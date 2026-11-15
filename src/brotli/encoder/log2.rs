/// With the precision of an `f32`, which the output of the encoder depends on.
static SMALL: [f64; 256] = {
    let mut table = [0.0; 256];
    let mut i: u32 = 2;
    while i < 256 {
        let exponent = i.ilog2();
        let mantissa = i as f64 / (1 << exponent) as f64;
        // ln(m) = 2 * atanh((m - 1) / (m + 1))
        let z = (mantissa - 1.0) / (mantissa + 1.0);
        let (mut sum, mut power, mut k) = (0.0, z, 1);
        while k < 64 {
            sum += power / k as f64;
            power *= z * z;
            k += 2;
        }
        table[i as usize] = (exponent as f64 + 2.0 * sum * core::f64::consts::LOG2_E) as f32 as f64;
        i += 1;
    }
    table
};

/// Zero for zero.
#[inline(always)]
pub(super) fn fast_log2(value: usize) -> f64 {
    match SMALL.get(value) {
        Some(&log) => log,
        None => (value as f64).log2(),
    }
}

/// Of the low 32 bits. Zero for zero.
#[inline(always)]
pub(super) fn log2_floor(value: usize) -> u32 {
    (value as u32 | 1).ilog2()
}
