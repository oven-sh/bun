#!/usr/bin/env python3
"""Writes math/tables.rs: tools/coefficients.py > math/tables.rs"""
from multiprocessing import Pool
from mpmath import mp, mpf, exp, ln, sin, cos, tan, sinh, cosh, asin, atan, atanh, sqrt, pi, cbrt, floor
from minimax import polynomial, rational, literal, log2, rounded, truncated

LN2, WIDER = ln(2), 1 + mpf(2) ** -9
# 1 / pi as f32 is off by so much in 131072 / pi, and cos drops half of 2^-6.
ANGLE = 1 + mpf(1) / 40
Z = ((sqrt(2) - 1) / (sqrt(2) + 1)) ** 2 * WIDER


def odd(f):
    """P and the weight for f(r) = r + r * t * P(t), where t = r * r, with an error relative to f."""
    return lambda t: (f(sqrt(t)) / sqrt(t) - 1) / t, lambda t: t * sqrt(t) / f(sqrt(t))


# name: what it is, P, weight, from, to, coefficients for f32 and f64
TABLES = {
    "exp": ("exp(r) = 1 + r + r^2 * P(r), relative to exp(r) - 1", lambda r: (exp(r) - 1 - r) / r**2, lambda r: r**2 / abs(exp(r) - 1),
            -LN2 / 2 * WIDER, LN2 / 2 * WIDER, 5, 10),
    "exp2": ("2^r = 1 + r * P(r)", lambda r: (2**r - 1) / r, lambda r: abs(r) / 2**r, -0.5, 0.5, 6, 11),
    "rough_exp2": ("The same with fewer bits", lambda r: (2**r - 1) / r, lambda r: abs(r) / 2**r, -0.5, 0.5, 4, 7),
    "rough_log2": ("For f32 only: log2(1 + f) = f * P(f)", lambda f: ln(1 + f) / LN2 / f, lambda f: abs(f * LN2 / ln(1 + f)), sqrt(0.5) - 1, sqrt(2) - 1, 6, 1),
    "rough_atanh": ("For f64 only: 2 * atanh(z) / ln(2) = z * P(z^2)", lambda t: 2 * atanh(sqrt(t)) / sqrt(t) / LN2, lambda t: sqrt(t) * LN2 / 2 / atanh(sqrt(t)), 0, Z, 1, 5),
    "sinh": ("sinh(r) = r + r^3 * P(r^2)", *odd(sinh), 0, LN2**2 / 4 * WIDER, 2, 5),
    "cosh": ("cosh(r) = 1 + r^2 * P(r^2)", lambda t: (cosh(sqrt(t)) - 1) / t, lambda t: t, 0, LN2**2 / 4 * WIDER, 3, 5),
    "ln": ("2 * atanh(z) = 2 * z + z^3 * P(z^2)", lambda t: 2 * odd(atanh)[0](t), lambda t: t / 2, 0, Z, 3, 7),
    "precise_ln": ("2 * atanh(z) = 2 * z + z^3 * (2 / 3 + z^2 * P(z^2))", lambda t: (2 * odd(atanh)[0](t) - mpf(2) / 3) / t,
                   lambda t: t * t / 2, 0, Z, 3, 8),
    "sin_half_turn": ("sin(r) = r + r^3 * P(r^2)", *odd(sin), 0, pi**2 / 4 * ANGLE, 4, 8),
    "sin": ("sin(r) = r + r^3 * P(r^2)", *odd(sin), 0, pi**2 / 16 * ANGLE, 3, 6),
    "cos": ("cos(r) = 1 - r^2 / 2 + r^4 * P(r^2)", lambda t: (cos(sqrt(t)) - 1 + t / 2) / t**2, lambda t: t**2 / cos(sqrt(t)),
            0, pi**2 / 16 * ANGLE, 3, 6),
    "asin": ("asin(r) = r + r^3 * P(r^2)", *odd(asin), 0, 0.25, 5, 12),
    "atan": ("atan(r) = r + r^3 * P(r^2)", *odd(atan), 0, (1, 0.25 * WIDER), 8, 12),
    "cbrt": ("cbrt(x) = P(x), to start from", cbrt, lambda x: 1 / cbrt(x), 0.35, 2.83, 3, 3),
}
BITS = (24, 53)


def fit(job):
    name, which = job
    if name == "tan":
        f = lambda t: tan(sqrt(t)) / sqrt(t)
        n, d = ((1, 2), (3, 3))[which]
        return rational(f, n, d, lambda t: 1 / f(t), 0, pi**2 / 16 * ANGLE, BITS[which], p0=1)
    _, f, weight, lo, hi, *n = TABLES[name]
    return polynomial(f, n[which], weight, lo, hi[which] if isinstance(hi, tuple) else hi, BITS[which])


def parts(x, widths, bits):
    """Positive parts of x. All but the last have the given numbers of significant bits."""
    out = []
    for width in widths:
        out.append(truncated(x, int(floor(mp.log(x, 2))) + 1 - width))
        x -= out[-1]
    return out + [rounded(x, bits)]


def arm(name, comment, single, double):
    print("    // %s\n    (%s $m:ident!($($a:tt)*)) => { $m!($($a)*;" % (comment, name))
    for it, bits in ((single, 24), (double, 53)):
        line = "        ["
        for i, c in enumerate(it):
            word = literal(c, bits) + (", " if i + 1 < len(it) else "]")
            if len(line) + len(word) > 120:
                print(line.rstrip())
                line = "         "
            line += word
        print(line)
    print("    ) };")


def constant(name, comment, x, single, double):
    text = lambda widths, bits: "[" + ", ".join(literal(c, bits) for c in parts(x, widths, bits)) + "]"
    print("/// %s\npub const %s: [[f64; %d]; 2] = [\n    %s,\n    %s,\n];" % (comment, name, len(single) + 1, text(single, 24), text(double, 53)))


if __name__ == "__main__":
    jobs = [(name, which) for name in [*TABLES, "tan"] for which in (0, 1)]
    with Pool() as pool:
        done = dict(zip(jobs, pool.map(fit, jobs, 1)))
    print("//! Written by tools/coefficients.py. The first of each pair is for f32, the second for f64.\n")
    print("/// Calls the macro with the coefficients of a polynomial after its arguments.\nmacro_rules! table {")
    for name, (what, _, _, lo, hi, *_) in TABLES.items():
        a, b = done[name, 0], done[name, 1]
        arm(name, "%s, P on %.4g..%s. Errors 2^%.1f, 2^%.1f." % (what, lo, " or ".join("%.4g" % it for it in (hi if isinstance(hi, tuple) else [hi])), log2(a[1]), log2(b[1])), a[0], b[0])
    a, b = done["tan", 0], done["tan", 1]
    arm("tan_above", "tan(r) = (r + r^3 * P(r^2)) / (1 + r^2 * Q(r^2)) to pi / 4: P. Errors 2^%.1f, 2^%.1f." % (log2(a[2]), log2(b[2])), a[0], b[0])
    arm("tan_below", "Q.", a[1], b[1])
    print("}\n")
    constant("LN_2_FUSED", "For products that are not rounded.", LN2, [24], [53])
    constant("LN_2", "The first part times an exponent is exact.", LN2, [16], [42])
    constant("LOG10_2", "The same.", mp.log10(2), [16], [42])
    constant("LOG2_E", "Two parts.", 1 / LN2, [24], [53])
    constant("LOG10_E", "Two parts.", 1 / ln(10), [24], [53])
    constant("TWO_THIRDS", "Two parts.", mpf(2) / 3, [24], [53])
    constant("PI_FUSED", "For products that are not rounded.", +pi, [24, 24], [53, 53])
    constant("PI", "All but the last times an integer of 12 or 23 bits are exact, and so is the argument minus the first two products.", +pi,
             [12, 12, 12], [30, 23, 30])
    print("/// pi / 4 = c + c * k, where c * k is next to a short number. That is so far below pi / 4 that a sum with it is never rounded more")
    print("/// coarsely than the result. c is a multiple of 4 units in its last place.\npub const FRAC_PI_4: [[f64; 2]; 2] = [")
    for bits in BITS:
        def error(short):
            c = rounded(pi / 4 - short, bits - 2)
            return abs(c * rounded(short / c, bits) - short) + abs(c + short - pi / 4)
        short = min((mpf(m) / 4096 for m in range(2970, 3112)), key=error)
        c = rounded(pi / 4 - short, bits - 2)
        print("    [%s, %s], // %s, error 2^%.1f" % (literal(c, bits), literal(rounded(short / c, bits), bits), float(short), log2(error(short))))
    print("];")
