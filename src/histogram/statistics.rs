//! Confidence intervals, and comparisons of two histograms. Every value counts as the middle of its slot, as it does for
//! the mean.
//! - https://github.com/nodejs/node/blob/v26.12.1/src/histogram.cc#L1291

use crate::Histogram;
use crate::distributions::{binomial_cdf, normal_cdf, student_t_cdf, student_t_upper_quantile};

pub struct Interval<T> {
    pub estimate: T,
    pub lower: T,
    pub upper: T,
}

pub struct Welch {
    pub t_statistic: f64,
    pub degrees_of_freedom: f64,
    pub p_value: f64,
    /// Of the difference of the means.
    pub lower: f64,
    pub upper: f64,
}

impl Welch {
    /// What a histogram compared to itself gives.
    pub const NO_DIFFERENCE: Self = Self {
        t_statistic: 0.0,
        degrees_of_freedom: 0.0,
        p_value: 1.0,
        lower: 0.0,
        upper: 0.0,
    };
}

pub struct MannWhitney {
    pub u_statistic: f64,
    pub z_score: f64,
    pub p_value: f64,
}

impl MannWhitney {
    /// What a histogram compared to itself gives.
    pub const NO_DIFFERENCE: Self = Self::no_difference(0.0);

    const fn no_difference(u_statistic: f64) -> Self {
        Self {
            u_statistic,
            z_score: 0.0,
            p_value: 1.0,
        }
    }
}

/// The pairs of a value of one histogram and a value of another.
struct Pairs {
    /// Those in which the first is the higher one.
    concordant: f64,
    tied: f64,
    /// The sum of `t^3 - t` over the values, where `t` is how many times the two have that value.
    tie_correction: f64,
    /// The largest difference between the shares of the two that are at or below a value.
    largest_distance: f64,
}

impl Histogram {
    /// The variance that the values are a sample of. There are at least 2.
    fn sample_variance(&self) -> f64 {
        let stddev = self.stddev();
        stddev * stddev * self.count as f64 / (self.count - 1) as f64
    }

    /// Where the mean of what the values are a sample of is, with a probability of `confidence`, which is above 0 and
    /// below 1. NaN with fewer than 2 values.
    pub fn mean_ci(&self, confidence: f64) -> Interval<f64> {
        let mean = self.mean();
        let around = |margin: f64| Interval {
            estimate: mean,
            lower: mean - margin,
            upper: mean + margin,
        };
        if self.count < 2 {
            return around(f64::NAN);
        }
        if self.stddev() == 0.0 {
            return around(0.0);
        }
        let standard_error = (self.sample_variance() / self.count as f64).sqrt();
        let alpha = 1.0 - confidence;
        around(student_t_upper_quantile(alpha / 2.0, (self.count - 1) as f64) * standard_error)
    }

    /// The same for the value at `percentile`, by the exact binomial method.
    pub fn percentile_ci(&self, percentile: f64, confidence: f64) -> Interval<u64> {
        let estimate = self.value_at_percentile(percentile);
        if self.count < 2 {
            return Interval {
                estimate,
                lower: estimate,
                upper: estimate,
            };
        }
        let n = self.count.min(i64::MAX as u64) as i64;
        let p = percentile / 100.0;
        let alpha = 1.0 - confidence;

        // The largest rank below which there are too few values with a probability of at most `alpha / 2`.
        let (mut low, mut high) = (0, n);
        while low < high {
            let middle = high - (high - low) / 2;
            if binomial_cdf(middle - 1, n, p) <= alpha / 2.0 {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        let lower = low as f64 / n as f64 * 100.0;

        // The smallest rank below which there are enough with a probability of at least `1 - alpha / 2`.
        let (mut low, mut high) = (0, n);
        while low < high {
            let middle = low + (high - low) / 2;
            if binomial_cdf(middle - 1, n, p) >= 1.0 - alpha / 2.0 {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        let upper = low as f64 / n as f64 * 100.0;

        Interval {
            estimate,
            lower: self.value_at_percentile(lower),
            upper: self.value_at_percentile(upper),
        }
    }

    /// Whether the two have the same mean, without assuming that they have the same variance.
    pub fn welch_test(&self, other: &Self, confidence: f64) -> Welch {
        if self.count < 2 || other.count < 2 {
            return Welch::NO_DIFFERENCE;
        }
        let (n1, n2) = (self.count as f64, other.count as f64);
        let error1 = self.sample_variance() / n1;
        let error2 = other.sample_variance() / n2;
        let error = error1 + error2;
        if error == 0.0 {
            return Welch::NO_DIFFERENCE;
        }
        let difference = self.mean() - other.mean();
        let t_statistic = difference / error.sqrt();
        // By the equation of Welch and Satterthwaite.
        let degrees_of_freedom = (error * error)
            / (error1 * error1 / (self.count - 1) as f64
                + error2 * error2 / (other.count - 1) as f64);
        let alpha = 1.0 - confidence;
        let margin = student_t_upper_quantile(alpha / 2.0, degrees_of_freedom) * error.sqrt();
        Welch {
            t_statistic,
            degrees_of_freedom,
            p_value: 2.0 * student_t_cdf(-t_statistic.abs(), degrees_of_freedom),
            lower: difference - margin,
            upper: difference + margin,
        }
    }

    /// The difference of the means, in standard deviations of the two together. 0 unless both have 2 values.
    pub fn cohens_d(&self, other: &Self) -> f64 {
        if self.count < 2 || other.count < 2 {
            return 0.0;
        }
        let (free1, free2) = ((self.count - 1) as f64, (other.count - 1) as f64);
        let pooled = ((free1 * self.sample_variance() + free2 * other.sample_variance())
            / (self.count - 1).saturating_add(other.count - 1) as f64)
            .sqrt();
        if pooled == 0.0 {
            return 0.0;
        }
        (self.mean() - other.mean()) / pooled
    }

    /// Neither is empty.
    ///
    /// Node.js: slot by slot, whatever values the slots of the two stand for.
    fn pairs(&self, other: &Self) -> Pairs {
        let mut pairs = Pairs {
            concordant: 0.0,
            tied: 0.0,
            tie_correction: 0.0,
            largest_distance: 0.0,
        };
        let mut these = self.slots().map(|(slot, n)| (slot.median(), n)).peekable();
        let mut those = other.slots().map(|(slot, n)| (slot.median(), n)).peekable();
        let (mut seen1, mut seen2) = (0u64, 0u64);
        loop {
            let value = match (these.peek(), those.peek()) {
                (Some(&(a, _)), Some(&(b, _))) => a.min(b),
                (Some(&(value, _)), None) | (None, Some(&(value, _))) => value,
                (None, None) => return pairs,
            };
            let n1 = these.next_if(|&(at, _)| at == value).map_or(0, |(_, n)| n);
            let n2 = those.next_if(|&(at, _)| at == value).map_or(0, |(_, n)| n);
            pairs.concordant += n1 as f64 * seen2 as f64;
            pairs.tied += n1 as f64 * n2 as f64;
            let ties = n1.saturating_add(n2) as f64;
            if ties > 1.0 {
                pairs.tie_correction += ties * ties * ties - ties;
            }
            seen1 += n1;
            seen2 += n2;
            let distance = seen1 as f64 / self.count as f64 - seen2 as f64 / other.count as f64;
            pairs.largest_distance = pairs.largest_distance.max(distance.abs());
        }
    }

    /// The statistic of Kolmogorov and Smirnov: from 0, for the same distribution, to 1, for no value in common.
    pub fn ks_test(&self, other: &Self) -> f64 {
        if self.count == 0 || other.count == 0 {
            return 0.0;
        }
        self.pairs(other).largest_distance
    }

    /// How much more likely a value of this one is to be the higher one than the lower one: from -1 to 1.
    pub fn cliffs_d(&self, other: &Self) -> f64 {
        if self.count == 0 || other.count == 0 {
            return 0.0;
        }
        let pairs = self.pairs(other);
        let all = self.count as f64 * other.count as f64;
        let discordant = all - pairs.concordant - pairs.tied;
        (pairs.concordant - discordant) / all
    }

    /// Whether the values of one tend to be higher, whatever the shapes of the two distributions are.
    pub fn mann_whitney_test(&self, other: &Self) -> MannWhitney {
        if self.count == 0 || other.count == 0 {
            return MannWhitney::NO_DIFFERENCE;
        }
        let pairs = self.pairs(other);
        let u_statistic = pairs.concordant + 0.5 * pairs.tied;
        let (n1, n2) = (self.count as f64, other.count as f64);
        let n = n1 + n2;
        let variance = (n1 * n2 / 12.0) * (n + 1.0 - pairs.tie_correction / (n * (n - 1.0)));
        if variance <= 0.0 {
            return MannWhitney::no_difference(u_statistic);
        }
        let z_score = (u_statistic - n1 * n2 / 2.0) / variance.sqrt();
        MannWhitney {
            u_statistic,
            z_score,
            p_value: 2.0 * normal_cdf(-z_score.abs()),
        }
    }
}
