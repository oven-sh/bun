//! A quantile-respectful density estimate, from the quantile estimator of Harrell and Davis:
//! - https://github.com/nodejs/node/blob/v26.12.1/src/histogram.cc#L680

use crate::distributions::{Beta, clamp};

/// The slots in use, as the estimate reads them.
pub struct RecordedSlots {
    pub(crate) slots: Vec<RecordedSlot>,
    pub(crate) count: u64,
}

pub(crate) struct RecordedSlot {
    /// The middle of the slot.
    pub(crate) value: f64,
    pub(crate) width: f64,
    pub(crate) count: u64,
    /// With those of the slots before it.
    pub(crate) cumulative_count: u64,
}

/// Which of the slots that hold more than one value have them spread evenly over the slot, instead of all in its middle.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Dequantize {
    None,
    /// Those wider than 1.
    Hdr,
    All,
}

pub struct Qrde {
    /// One for each probability, or none if the histogram is empty.
    pub quantiles: Vec<f64>,
    /// One for each interval between two quantiles.
    pub densities: Vec<f64>,
    /// How many quantiles came out below the one before, and were raised to it.
    pub corrections: usize,
}

/// The first index from `low` to `high` that is not `before`, or `high`. `None` as soon as `before` is.
fn bisect(
    mut low: usize,
    mut high: usize,
    mut before: impl FnMut(usize) -> Option<bool>,
) -> Option<usize> {
    while low < high {
        let middle = low + (high - low) / 2;
        if before(middle)? {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    Some(low)
}

impl Dequantize {
    fn applies_to(self, slot: &RecordedSlot) -> bool {
        slot.count > 1 && (self == Self::All || (self == Self::Hdr && slot.width > 1.0))
    }
}

impl RecordedSlots {
    pub fn count(&self) -> u64 {
        self.count
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// What the values of `slot`, which is at `index`, are spread over.
    fn range(&self, index: usize, slot: &RecordedSlot, dequantize: Dequantize) -> (f64, f64) {
        if !dequantize.applies_to(slot) {
            return (slot.value, slot.value);
        }
        let half = slot.width / 2.0;
        let only = self.slots.len() == 1;
        let lower = if index == 0 && !only { 0.0 } else { half };
        let upper = if index + 1 == self.slots.len() && !only {
            0.0
        } else {
            half
        };
        (slot.value - lower, slot.value + upper)
    }

    /// The lowest and the highest value there is.
    fn endpoints(&self, dequantize: Dequantize) -> Option<(f64, f64)> {
        let (first, last) = (self.slots.first()?, self.slots.last()?);
        let lowest = self.range(0, first, dequantize).0;
        let highest = self.range(self.slots.len() - 1, last, dequantize).1;
        Some((lowest, highest))
    }

    /// The slots outside of which `beta` has a mass of less than 2^-80 on each side: leaving them out moves a quantile
    /// by less than 2^-16.
    fn exact_support(&self, beta: &Beta, reflected: &Beta) -> Option<(usize, usize)> {
        const TAIL_MASS: f64 = 1.0 / (1u128 << 80) as f64;
        let count = self.count as f64;
        let len = self.slots.len();
        let first = bisect(0, len, |index| {
            let cdf = beta.cdf(self.slots.get(index)?.cumulative_count as f64 / count);
            cdf.is_finite().then_some(cdf < TAIL_MASS)
        })?;
        let last = bisect(first, len, |index| {
            let remaining = self.count - self.slots.get(index)?.cumulative_count;
            let survival = reflected.cdf(remaining as f64 / count);
            survival.is_finite().then_some(survival > TAIL_MASS)
        })?;
        (last < len).then_some((first, last + 1))
    }

    fn quantile(&self, p: f64, dequantize: Dequantize, endpoints: (f64, f64)) -> f64 {
        let count = self.count as f64;
        let a = (count + 1.0) * p;
        let b = (count + 1.0) * (1.0 - p);
        let beta = Beta::new(a, b, true);
        let reflected = beta.reflected();

        let mut begin = 0;
        let mut end = self.slots.len();
        if beta.asymptotic_cdf {
            // The mass of a normal distribution further out is below 2e-33.
            let reach = 12.0 * beta.standard_deviation;
            let lower_rank = 0.0f64.max(beta.mean - reach);
            let upper_rank = 1.0f64.min(beta.mean + reach);
            let reaches = |rank: f64| {
                move |slot: &RecordedSlot| (slot.cumulative_count as f64) < rank * count
            };
            begin = self.slots.partition_point(reaches(lower_rank));
            let rest = self.slots.get(begin..).unwrap_or_default();
            let last = begin + rest.partition_point(reaches(upper_rank));
            if last != self.slots.len() {
                end = last + 1;
            }
        } else if self.slots.len() >= 512
            && let Some(support) = self.exact_support(&beta, &reflected)
        {
            (begin, end) = support;
        }

        let spread = dequantize != Dequantize::None;
        let mut previous_cdf = 0.0;
        let mut previous_survival = 0.0;
        let mut previous_front = 0.0;
        let mut previous_count = match begin.checked_sub(1).and_then(|i| self.slots.get(i)) {
            Some(slot) => slot.cumulative_count,
            None => 0,
        };
        if previous_count != 0 {
            let (cdf, front) = beta.cdf_and_front(previous_count as f64 / count);
            if !cdf.is_finite() || (spread && !front.is_finite()) {
                begin = 0;
                end = self.slots.len();
                previous_count = 0;
            } else {
                previous_cdf = clamp(cdf, 0.0, 1.0);
                if spread {
                    previous_front = front;
                }
            }
        }

        let mut quantile = endpoints.0 * previous_cdf;
        let mut using_survival = false;
        for (index, slot) in self.slots.iter().enumerate().take(end).skip(begin) {
            let u0 = previous_count as f64 / count;
            let u1 = slot.cumulative_count as f64 / count;
            let front;
            let mass;
            // Above the symmetry point, the small weights of the upper tail would be lost in a subtraction from one.
            if u1 <= beta.symmetry_point {
                let at = beta.cdf_and_front(u1);
                let cdf = clamp(at.0, previous_cdf, 1.0);
                front = at.1;
                mass = cdf - previous_cdf;
                previous_cdf = cdf;
            } else {
                let remaining_rank = (self.count - slot.cumulative_count) as f64 / count;
                let at = reflected.cdf_and_front(remaining_rank);
                front = at.1;
                let survival;
                if using_survival {
                    survival = clamp(at.0, 0.0, previous_survival);
                    mass = previous_survival - survival;
                } else {
                    survival = clamp(at.0, 0.0, 1.0 - previous_cdf);
                    mass = 1.0 - previous_cdf - survival;
                    using_survival = true;
                }
                previous_survival = survival;
            }
            let front = if spread { front } else { 0.0 };

            if dequantize.applies_to(slot) {
                // I_x(a + 1, b) = I_x(a, b) - front / a, so the first moment takes no second beta function.
                let sum = a + b;
                let rank_width = slot.count as f64 / count;
                let local_moment = clamp(
                    (a / sum - u0) * mass - (front - previous_front) / sum,
                    0.0,
                    rank_width * mass,
                );
                let (lower, upper) = self.range(index, slot, dequantize);
                quantile += lower * mass + (upper - lower) * local_moment / rank_width;
            } else {
                quantile += slot.value * mass;
            }
            previous_front = front;
            previous_count = slot.cumulative_count;
        }

        let remaining_mass = if using_survival {
            previous_survival
        } else {
            1.0 - previous_cdf
        };
        quantile + endpoints.1 * clamp(remaining_mass, 0.0, 1.0)
    }

    /// `probabilities` are at least two, from 0 to 1 and strictly increasing.
    pub fn qrde(&self, probabilities: &[f64], dequantize: Dequantize) -> Qrde {
        let mut qrde = Qrde {
            quantiles: Vec::new(),
            densities: Vec::new(),
            corrections: 0,
        };
        let (Some(endpoints), [_, inner @ .., _]) = (self.endpoints(dequantize), probabilities)
        else {
            return qrde;
        };
        qrde.quantiles.reserve_exact(probabilities.len());
        let mut previous = endpoints.0;
        qrde.quantiles.push(previous);
        for &p in inner {
            let mut value = clamp(
                self.quantile(p, dequantize, endpoints),
                endpoints.0,
                endpoints.1,
            );
            if value < previous {
                value = previous;
                qrde.corrections += 1;
            }
            qrde.quantiles.push(value);
            previous = value;
        }
        qrde.quantiles.push(endpoints.1);

        let steps = |values: &[f64]| -> Vec<f64> {
            let next = values.iter().skip(1);
            values
                .iter()
                .zip(next)
                .map(|(from, to)| to - from)
                .collect()
        };
        let widths = steps(&qrde.quantiles).into_iter();
        let masses = steps(probabilities);
        qrde.densities = widths
            .zip(masses)
            .map(|(width, mass)| {
                if width == 0.0 {
                    f64::INFINITY
                } else {
                    mass / width
                }
            })
            .collect();
        qrde
    }
}
