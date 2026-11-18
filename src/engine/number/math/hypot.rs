/// Math.hypot of two, where an infinite argument wins over a NaN one.
pub fn hypot(a: f64, b: f64) -> f64 {
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    a.hypot(b)
}

/// The same, of three. The sum of squares is scaled by the largest, so that it neither overflows nor underflows.
pub fn hypot3(a: f64, b: f64, c: f64) -> f64 {
    if a.is_infinite() || b.is_infinite() || c.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() || c.is_nan() {
        return f64::NAN;
    }
    let largest = a.abs().max(b.abs()).max(c.abs());
    if largest == 0.0 {
        return 0.0;
    }
    let (a, b, c) = (a / largest, b / largest, c / largest);
    largest * (a * a + b * b + c * c).sqrt()
}

/// For four arguments or more.
#[derive(Default)]
pub struct Hypot {
    largest: f64,
    /// Of the squares of the arguments over `largest`.
    sum: f64,
    has_infinity: bool,
    has_nan: bool,
}

impl Hypot {
    #[inline]
    pub fn add(&mut self, value: f64) {
        let magnitude = value.abs();
        if !magnitude.is_finite() {
            self.has_infinity |= magnitude.is_infinite();
            self.has_nan |= magnitude.is_nan();
        } else if self.largest < magnitude {
            let ratio = self.largest / magnitude;
            self.sum = self.sum.mul_add(ratio * ratio, 1.0);
            self.largest = magnitude;
        } else if self.largest != 0.0 {
            let ratio = magnitude / self.largest;
            self.sum = ratio.mul_add(ratio, self.sum);
        }
    }

    pub fn result(&self) -> f64 {
        if self.has_infinity {
            f64::INFINITY
        } else if self.has_nan {
            f64::NAN
        } else {
            self.sum.sqrt() * self.largest
        }
    }
}
