//! The distribution functions behind the tests, the confidence intervals and the density estimate. Each follows
//! Node.js operation by operation, so that the results are the same to the last bit wherever the platform's `libm` is:
//! - https://github.com/nodejs/node/blob/v26.12.1/src/histogram.cc#L438

use core::f64::consts::{PI, SQRT_2};

/// `std::clamp`: unlike `f64::clamp`, it takes bounds in the wrong order, and a NaN.
pub(crate) fn clamp(value: f64, low: f64, high: f64) -> f64 {
    if value < low {
        low
    } else if high < value {
        high
    } else {
        value
    }
}

/// The continued fraction of the incomplete beta function, by the modified method of Lentz (Numerical Recipes in C,
/// 2nd edition, section 6.4).
fn beta_continued_fraction(a: f64, b: f64, x: f64) -> f64 {
    const TINY: f64 = 1e-30;
    const EPSILON: f64 = 3e-12;
    let not_zero = |value: f64| if value.abs() < TINY { TINY } else { value };

    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;
    let mut c = 1.0;
    let mut d = 1.0 / not_zero(1.0 - qab * x / qap);
    let mut h = d;
    for m in 1..=200 {
        let m = f64::from(m);
        let m2 = 2.0 * m;
        let even = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 / not_zero(1.0 + even * d);
        c = not_zero(1.0 + even / c);
        h *= d * c;
        let odd = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 / not_zero(1.0 + odd * d);
        c = not_zero(1.0 + odd / c);
        let delta = d * c;
        h *= delta;
        if (delta - 1.0).abs() <= EPSILON {
            break;
        }
    }
    h
}

/// A beta distribution, with what does not depend on where it is evaluated.
#[derive(Clone, Copy)]
pub(crate) struct Beta {
    pub(crate) a: f64,
    pub(crate) b: f64,
    log_normalization: f64,
    pub(crate) mean: f64,
    pub(crate) standard_deviation: f64,
    skewness: f64,
    excess_kurtosis: f64,
    log_scale: f64,
    pub(crate) symmetry_point: f64,
    asymptotic_front: bool,
    pub(crate) asymptotic_cdf: bool,
}

fn stirling_correction(x: f64) -> f64 {
    let inverse = 1.0 / x;
    let squared = inverse * inverse;
    inverse
        * (1.0 / 12.0
            + squared
                * (-1.0 / 360.0
                    + squared * (1.0 / 1260.0 + squared * (-1.0 / 1680.0 + squared / 1188.0))))
}

impl Beta {
    /// With `approximate_large_shapes`, a distribution that is concentrated enough is approximated: the continued
    /// fraction needs more and more iterations as both shapes grow.
    pub(crate) fn new(a: f64, b: f64, approximate_large_shapes: bool) -> Self {
        let sum = a + b;
        let mean = a / sum;
        let asymptotic_front = approximate_large_shapes && a >= 8.0 && b >= 8.0;
        let asymptotic_cdf = approximate_large_shapes && a * b / sum >= 25_000.0;
        let variance = mean * (1.0 - mean) / (sum + 1.0);
        Self {
            a,
            b,
            log_normalization: if asymptotic_front {
                0.0
            } else {
                sum.ln_gamma().0 - a.ln_gamma().0 - b.ln_gamma().0
            },
            mean,
            standard_deviation: variance.sqrt(),
            skewness: 2.0 * (b - a) * (sum + 1.0).sqrt() / ((sum + 2.0) * (a * b).sqrt()),
            excess_kurtosis: 6.0 * ((a - b) * (a - b) * (sum + 1.0) - a * b * (sum + 2.0))
                / (a * b * (sum + 2.0) * (sum + 3.0)),
            log_scale: if asymptotic_front {
                0.5 * (sum * mean * (1.0 - mean) / (2.0 * PI)).ln() + stirling_correction(sum)
                    - stirling_correction(a)
                    - stirling_correction(b)
            } else {
                0.0
            },
            symmetry_point: (a + 1.0) / (sum + 2.0),
            asymptotic_front,
            asymptotic_cdf,
        }
    }

    /// The distribution of one minus the variable.
    pub(crate) fn reflected(&self) -> Self {
        Self {
            a: self.b,
            b: self.a,
            mean: 1.0 - self.mean,
            skewness: -self.skewness,
            symmetry_point: 1.0 - self.symmetry_point,
            ..*self
        }
    }

    /// `x^a * (1 - x)^b / B(a, b)`
    fn front(&self, x: f64) -> f64 {
        if x <= 0.0 || x >= 1.0 {
            return 0.0;
        }
        let log_front = if self.asymptotic_front {
            self.a * ((x - self.mean) / self.mean).ln_1p()
                + self.b * ((self.mean - x) / (1.0 - self.mean)).ln_1p()
                + self.log_scale
        } else {
            self.log_normalization + self.a * x.ln() + self.b * (1.0 - x).ln()
        };
        log_front.exp()
    }

    /// An Edgeworth expansion around the normal distribution.
    fn asymptotic_cdf_and_front(&self, x: f64) -> (f64, f64) {
        let z = (x - self.mean) / self.standard_deviation;
        let normal_cdf = 0.5 * (-z / SQRT_2).erfc();
        if z.abs() >= 8.0 {
            return (normal_cdf, 0.0);
        }
        let z2 = z * z;
        let z3 = z2 * z;
        let z4 = z2 * z2;
        let z6 = z3 * z3;
        let normal_pdf = (-0.5 * z2).exp() / (2.0 * PI).sqrt();
        let density_correction = 1.0
            + self.skewness / 6.0 * (z3 - 3.0 * z)
            + self.excess_kurtosis / 24.0 * (z4 - 6.0 * z2 + 3.0)
            + self.skewness * self.skewness / 72.0 * (z6 - 15.0 * z4 + 45.0 * z2 - 15.0);
        let front =
            x * (1.0 - x) * normal_pdf / self.standard_deviation * 0.0f64.max(density_correction);
        let correction = self.skewness / 6.0 * (1.0 - z2)
            - self.excess_kurtosis / 24.0 * (z3 - 3.0 * z)
            - self.skewness * self.skewness / 72.0 * (z3 * z2 - 10.0 * z3 + 15.0 * z);
        (clamp(normal_cdf + normal_pdf * correction, 0.0, 1.0), front)
    }

    /// The probability of a value of at most `x`, which is the regularized incomplete beta function, and
    /// [`Self::front`] there.
    pub(crate) fn cdf_and_front(&self, x: f64) -> (f64, f64) {
        if x <= 0.0 {
            return (0.0, 0.0);
        }
        if x >= 1.0 {
            return (1.0, 0.0);
        }
        if self.asymptotic_cdf {
            return self.asymptotic_cdf_and_front(x);
        }
        let front = self.front(x);
        // On the side where the continued fraction converges fast.
        let cdf = if x < self.symmetry_point {
            front * beta_continued_fraction(self.a, self.b, x) / self.a
        } else {
            1.0 - front * beta_continued_fraction(self.b, self.a, 1.0 - x) / self.b
        };
        (cdf, front)
    }

    pub(crate) fn cdf(&self, x: f64) -> f64 {
        self.cdf_and_front(x).0
    }
}

fn regularized_incomplete_beta(a: f64, b: f64, x: f64) -> f64 {
    Beta::new(a, b, false).cdf(x)
}

pub(crate) fn normal_cdf(x: f64) -> f64 {
    0.5 * (-x * SQRT_2 / 2.0).erfc()
}

pub(crate) fn student_t_cdf(t: f64, degrees_of_freedom: f64) -> f64 {
    let squared = t * t;
    let denominator = degrees_of_freedom + squared;
    if squared < degrees_of_freedom {
        let beta =
            regularized_incomplete_beta(0.5, degrees_of_freedom / 2.0, squared / denominator);
        return if t >= 0.0 {
            0.5 + 0.5 * beta
        } else {
            0.5 - 0.5 * beta
        };
    }
    let beta = regularized_incomplete_beta(
        degrees_of_freedom / 2.0,
        0.5,
        degrees_of_freedom / denominator,
    );
    if t >= 0.0 {
        1.0 - 0.5 * beta
    } else {
        0.5 * beta
    }
}

/// The positive `t` that is exceeded with probability `p`, which is above 0 and below one half.
pub(crate) fn student_t_upper_quantile(p: f64, degrees_of_freedom: f64) -> f64 {
    let mut low = 0.0;
    let mut high = 1.0;
    // The lower tail keeps its precision where the upper one is near 1.
    while student_t_cdf(-high, degrees_of_freedom) > p {
        high *= 2.0;
    }
    for _ in 0..100 {
        let middle = (low + high) / 2.0;
        if student_t_cdf(-middle, degrees_of_freedom) > p {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low + high) / 2.0
}

/// The probability of at most `k` successes in `n` trials that each succeed with probability `p`.
pub(crate) fn binomial_cdf(k: i64, n: i64, p: f64) -> f64 {
    if k < 0 {
        return 0.0;
    }
    if k >= n {
        return 1.0;
    }
    regularized_incomplete_beta((n - k) as f64, (k + 1) as f64, 1.0 - p)
}
