//! `min`, `max` and `step`.

/// Numbers as integer multiples of one power of ten, so that 0.1 + 0.2 is 0.3.
struct Scale(i32);

const MAX_DIGITS: u32 = 36;

/// The shortest decimal that stands for `value`.
fn decimal(value: f64) -> (i128, i32) {
    let text = format!("{value:e}");
    let (mantissa, exponent) =
        bun_core::strings::split_once_char(text.as_bytes(), b'e').unwrap_or_default();
    let digits = mantissa.iter().filter(|it| it.is_ascii_digit());
    let exponent = bun_core::fmt::parse_ascii::<i32>(exponent).unwrap_or(0) + 1
        - digits.clone().count() as i32;
    (
        digits.fold(0, |all, it| all * 10 + i128::from(it - b'0'))
            * if value < 0.0 { -1 } else { 1 },
        exponent,
    )
}

impl Scale {
    /// The least digits are dropped from numbers that are too far apart.
    fn align<const N: usize>(values: [f64; N]) -> (Scale, [i128; N]) {
        let decimals = values.map(decimal);
        let set = || decimals.iter().filter(|it| it.0 != 0);
        let highest = set()
            .map(|it| it.1 + it.0.abs().ilog10() as i32 + 1)
            .max()
            .unwrap_or(0);
        let scale = set()
            .map(|it| it.1)
            .min()
            .unwrap_or(0)
            .max(highest - MAX_DIGITS as i32);
        let scaled =
            |(digits, exponent): (i128, i32)| match 10i128.checked_pow(exponent.abs_diff(scale)) {
                Some(power) if exponent >= scale => digits * power,
                Some(power) => digits / power,
                None => 0,
            };
        (Scale(scale), decimals.map(scaled))
    }

    fn value(&self, scaled: i128) -> f64 {
        bun_core::fmt::parse_ascii(format!("{scaled}e{}", self.0).as_bytes()).unwrap_or(0.0)
    }
}

#[derive(Clone, Copy)]
enum Round {
    Down,
    Nearest,
    Up,
}

#[derive(Clone, Copy)]
pub(crate) struct Steps {
    pub(crate) min: Option<f64>,
    pub(crate) max: Option<f64>,
    /// `None` for `any`.
    pub(crate) step: Option<f64>,
    pub(crate) base: f64,
    /// `min` may be after `max`, around midnight.
    pub(crate) is_periodic: bool,
}

impl Steps {
    fn is_reversed(&self) -> bool {
        self.is_periodic && self.min.zip(self.max).is_some_and(|(min, max)| min > max)
    }

    /// Whether `value` is under `min`, and whether it is over `max`.
    pub(crate) fn out_of_range(&self, value: f64) -> (bool, bool) {
        let (under, over) = (
            self.min.is_some_and(|it| value < it),
            self.max.is_some_and(|it| value > it),
        );
        if self.is_reversed() {
            (under && over, under && over)
        } else {
            (under, over)
        }
    }

    pub(crate) fn mismatches(&self, value: f64) -> bool {
        let Some(step) = self.step else { return false };
        let (_, [value, base, step]) = Scale::align([value, self.base, step]);
        if step == 0 || (value - base).abs() >> f64::MANTISSA_DIGITS > step {
            return false;
        }
        let (remainder, tolerance) = (
            (value - base).rem_euclid(step),
            step >> f32::MANTISSA_DIGITS,
        );
        remainder > tolerance && remainder < step - tolerance
    }

    /// An allowed value, `more` steps from the one that `value` rounds to.
    fn snap(&self, value: f64, round: Round, more: i32) -> f64 {
        let (scale, [scaled, base, step]) =
            Scale::align([value, self.base, self.step.unwrap_or(1.0)]);
        if step == 0 {
            return value;
        }
        let bias = match round {
            Round::Down => 0,
            Round::Nearest => step / 2,
            Round::Up => step - 1,
        };
        let count = (scaled - base + bias).div_euclid(step) + i128::from(more);
        count
            .checked_mul(step)
            .and_then(|it| it.checked_add(base))
            .map_or(value, |it| scale.value(it))
    }

    /// The value sanitization algorithm of a range, which has both limits.
    pub(crate) fn clamp(&self, value: Option<f64>) -> f64 {
        let (min, max) = (self.min.unwrap_or(0.0), self.max.unwrap_or(100.0));
        let value = value.unwrap_or_else(|| {
            let (scale, [min, max]) = Scale::align([min, max]);
            Scale(scale.0 - 1).value((min + max) * 5)
        });
        let value = value.min(max).max(min);
        if self.step.is_none() {
            return value;
        }
        match self.snap(value, Round::Nearest, 0) {
            near if near > max => Some(self.snap(max, Round::Down, 0))
                .filter(|it| *it >= min)
                .unwrap_or(value),
            near if near < min => Some(self.snap(min, Round::Up, 0))
                .filter(|it| *it <= max)
                .unwrap_or(value),
            near => near,
        }
    }

    /// https://html.spec.whatwg.org/#dom-input-stepup. `None` if the value stays.
    pub(crate) fn step_by(&self, old: Option<f64>, count: i32) -> Option<f64> {
        if self
            .min
            .zip(self.max)
            .is_some_and(|(min, max)| min > max || self.snap(min, Round::Up, 0) > max)
        {
            return None;
        }
        let from = old.unwrap_or(0.0);
        let mut value = match self.step.is_none() || self.mismatches(from) {
            true if self.snap(from, Round::Down, 0) != from => {
                self.snap(from, if count > 0 { Round::Up } else { Round::Down }, 0)
            }
            _ => self.snap(from, Round::Nearest, count),
        };
        if let Some(min) = self.min.filter(|it| value < *it) {
            value = self.snap(min, Round::Up, 0);
        }
        if let Some(max) = self.max.filter(|it| value > *it) {
            value = self.snap(max, Round::Down, 0);
        }
        (old.is_none() || (value - from) * f64::from(count) >= 0.0).then_some(value)
    }
}
