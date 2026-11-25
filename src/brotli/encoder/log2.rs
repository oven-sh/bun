/// For tables. `value` is not zero.
const fn const_log2(value: u32) -> f32 {
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

/// Plus 127, with 23 bits after the point. Off by up to 0.012. Many multiplications in a row make some CPUs lower their clock.
#[inline(always)]
pub(super) fn fixed_point_log2(value: f32) -> i32 {
    const ONE: i32 = 1 << (f32::MANTISSA_DIGITS - 1);
    let bits = value.to_bits() as i32;
    let quarter = (bits & (ONE - 1)) >> 2;
    bits + (quarter + ONE / 100)
        .min(ONE / 4 - quarter)
        .min(ONE * 2 / 25)
}

#[cfg(test)]
mod tests {
    #[test]
    fn fixed_point_log2_is_close() {
        for value in (1..5000).map(|i| i as f32 * 0.37) {
            let found = f64::from(super::fixed_point_log2(value)) / f64::from(1 << 23) - 127.0;
            assert!((found - f64::from(value).log2()).abs() < 0.012, "{value}");
        }
    }
}
