/**
 * Parameter accepted by some of the algorithms in this namespace which
 * controls the input/output format of numbers.
 *
 * @example
 * ```ts
 * // Returns an integer
 * numeric.random.between(0, 10, { domain: "integral" });
 * // Returns a floating point number
 * numeric.random.between(0, 10, { domain: "floating" });
 * ```
 */
export type FormatSpecifier = {
  domain: "floating" | "integral";
};

const DefaultFormatSpecifier: FormatSpecifier = {
  domain: "floating",
};

/**
 * Generate an array of evenly-spaced numbers in a range.
 *
 * The name iota comes from https://aplwiki.com/wiki/Index_Generator. It is
 * commonly used across programming languages and libraries.
 *
 * @param count The total number of points to generate.
 * @param step The step size between each value.
 * @returns An array of evenly-spaced numbers.
 */
export function iota(count: number, step: number = 1) {
  return Array.from({ length: count }, (_, i) => i * step);
}

/**
 * Create an array of linearly spaced numbers.
 *
 * @param start The starting value of the sequence.
 * @param end The end value of the sequence.
 * @param numPoints The number of points to generate.
 *
 * @returns An array of numbers, spaced evenly in the linear space.
 */
export function linSpace(start: number, end: number, numPoints: number): number[] {
  if (numPoints <= 0) return [];
  if (numPoints === 1) return [start];
  if (numPoints === 2) return [start, end];
  const step = (end - start) / (numPoints - 1);

  return iota(numPoints).map(i => start + i * step);
}

/**
 * Create an array of exponentially spaced numbers.
 *
 * @param start The starting value of the sequence.
 * @param end The end value of the sequence.
 * @param numPoints The number of points to generate.
 * @param base The exponential base
 *
 * @returns An array of numbers, spaced evenly in the exponential space.
 */
export function expSpace(start: number, end: number, numPoints: number, base: number): number[] {
  if (numPoints <= 0) return [];
  if (numPoints === 1) return [start];

  if (!Number.isFinite(base) || base <= 0 || base === 1) {
    throw new Error('expSpace: "base" must be > 0 and !== 1');
  }

  // Generate exponentially spaced values from 0 to 1
  const exponentialValues = Array.from(
    { length: numPoints },
    (_, i) => (Math.pow(base, i / (numPoints - 1)) - 1) / (base - 1),
  );

  // Scale and shift to fit the [start, end] range
  return exponentialValues.map(t => start + t * (end - start));
}

export namespace stats {
  /**
   * Computes the Pearson correlation coefficient between two arrays of numbers.
   *
   * The Pearson correlation coefficient, also known as Pearson's r, is a
   * statistical measure that quantifies the strength and direction of a linear
   * relationship between two variables.
   *
   * @param xs The first array of numbers.
   * @param ys The second array of numbers.
   * @returns The Pearson correlation coefficient, or 0 if there is no correlation.
   */
  export function computePearsonCorrelation(xs: number[], ys: number[]): number {
    if (xs.length !== ys.length || xs.length === 0) {
      throw new Error("Input arrays must have the same non-zero length");
    }

    const n = xs.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((sum, x, i) => sum + x * ys[i], 0);
    const sumX2 = xs.reduce((sum, x) => sum + x * x, 0);
    const sumY2 = ys.reduce((sum, y) => sum + y * y, 0);

    // Compute the Pearson correlation coefficient (r) using the formula:
    // r = (n * Σ(xy) - Σx * Σy) / sqrt[(n * Σ(x^2) - (Σx)^2) * (n * Σ(y^2) - (Σy)^2)]
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) {
      return 0; // Avoid division by zero; implies no correlation
    }

    return numerator / denominator;
  }

  /**
   * Compute the slope of the best-fit line using linear regression.
   *
   * @param xs The random variable.
   * @param ys The dependent variable.
   * @returns The slope of the best-fit line.
   */
  export function computeLinearSlope(xs: number[], ys: number[]): number {
    if (xs.length !== ys.length || xs.length === 0) {
      throw new Error("Input arrays must have the same non-zero length");
    }

    const n = xs.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((sum, x, i) => sum + x * ys[i], 0);
    const sumX2 = xs.reduce((sum, x) => sum + x * x, 0);

    // Compute the slope (m) using the formula:
    // m = (n * Σ(xy) - Σx * Σy) / (n * Σ(x^2) - (Σx)^2)
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  /**
   * Compute euclidean the mean (average) of an array of numbers.
   *
   * @param xs An array of numbers.
   * @returns The mean of the numbers.
   */
  export function computeMean(xs: number[]): number {
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  /**
   * Compute the average absolute deviation of an array of numbers.
   *
   * The average absolute deviation (AAD) of a data set is the average of the
   * absolute deviations from a central point.
   *
   * @param xs An array of numbers.
   * @returns The average absolute deviation of the numbers.
   */
  export function computeAverageAbsoluteDeviation(xs: number[]): number {
    const mean = computeMean(xs);
    return xs.reduce((sum, x) => sum + Math.abs(x - mean), 0) / xs.length;
  }
}

/**
 * Utilities for numeric randomness.
 *
 * @todo Perhaps this does not belong in the numeric namespace.
 */
export namespace random {
  /**
   * Generate a random number between the specified range.
   *
   * @param min The minimum value (inclusive for integrals).
   * @param max The maximum value (inclusive for integrals).
   * @param format The format specifier for the random number.
   * @returns A random number between min and max, formatted according to the specifier.
   */
  export function between(min: number, max: number, format: FormatSpecifier = DefaultFormatSpecifier): number {
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("min/max must be finite");
    if (max < min) throw new Error("max must be >= min");

    if (format.domain === "floating") {
      return Math.random() * (max - min) + min;
    }

    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }
}
