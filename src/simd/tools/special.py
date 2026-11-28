#!/usr/bin/env python3
"""Writes math/special_tables.rs: tools/special.py > math/special_tables.rs"""
from multiprocessing import Pool
from mpmath import mp, mpf, exp, ln, sqrt, pi, erf, erfc, rgamma, loggamma
from minimax import polynomial, literal, log2, rounded

BITS = (24, 53)
K = (mpf(5) / 2, 4)
MIDDLE = mpf(7) / 16
STIRLING = mpf(7) / 2


def scaled_erfc(k):
    def p(v):
        t = v + MIDDLE
        x = k * t / (1 - t)
        return ((1 + 2 * x) * exp(x * x) * erfc(x) - 1) / t
    return p


def two_zeros(middle, n):
    """The middle is one where the first coefficient, which nothing makes up for, is close to a float."""
    def p(v):
        x = v + middle + mpf(2) ** -90
        return (rgamma(x) - 1) / (x - 1) / (x - 2)
    return p, lambda v: 1 / p(v), 0.75 - middle, 2.5 - middle, n


def binet(w):
    x = 1 / sqrt(w)
    return (loggamma(x) - (x - mpf(1) / 2) * ln(x) + x - ln(2 * pi) / 2) * x


# name: what it is, and for f32 and f64: P, weight, from, to, number of coefficients
both = lambda f, w, lo, hi, a, b: [(f, w, lo, hi, a), (f, w, lo, hi, b)]
TABLES = {
    "erf_small": ("erf(x) = x + x * P(x^2)",
                  both(lambda t: erf(sqrt(t)) / sqrt(t) - 1, lambda t: sqrt(t) / erf(sqrt(t)), 0, 1, 7, 12)),
    "erf_large": ("erf(x) = 1 - exp(-P(x - 1))",
                  [(lambda u: -ln(erfc(1 + u)), lambda u: erfc(1 + u), 0, hi, n) for hi, n in ((3, 7), (5, 18))]),
    "erfc": ("erfc(x) = exp(-x^2) * (1 + t * P(t - 7 / 16)) / (1 + 2 * x), t = x / (x + 2.5 or 4)",
             [(scaled_erfc(k), lambda v: v + MIDDLE, mpf(2) ** -40 - MIDDLE, hi / (hi + k) - MIDDLE, n)
              for k, hi, n in zip(K, (mpf("10.1"), mpf("27.4")), (11, 22))]),
    "inverse_gamma": ("1 / gamma(1 + u) = 1 + u * P(u)",
                      both(lambda u: (rgamma(1 + u) - 1) / u, lambda u: abs(u) / rgamma(1 + u), -0.5, 0.5, 8, 14)),
    "two_zeros": ("1 / gamma(x) = 1 + (x - 1) * (x - 2) * P(x - 105 / 64 or 104 / 64)",
                  [two_zeros(mpf(105) / 64, 10), two_zeros(mpf(104) / 64, 18)]),
    "sinc": ("sin(pi * u) = pi * u * (1 + u^2 * P(u^2))",
             both(lambda t: (mp.sinc(pi * sqrt(t)) - 1) / t, lambda t: t / mp.sinc(pi * sqrt(t)), 0, 0.25, 4, 8)),
    "stirling": ("ln(gamma(x)) = (x - 1 / 2) * ln(x) - x + ln(2 * pi) / 2 + P(1 / x^2) / x, absolute",
                 both(binet, sqrt, 0, 1 / STIRLING**2, 3, 10)),
}


def fit(job):
    f, weight, lo, hi, n = TABLES[job[0]][1][job[1]]
    return polynomial(f, n, weight, lo, hi, BITS[job[1]], points=500)


def arm(name, comment, single, double):
    """The first step is by Horner's scheme, which rounds less."""
    print("    // %s\n    (%s $x:expr) => {{ let x = $x; poly!(x;" % (comment, name))
    first, single, double = (literal(single[0], 24), literal(double[0], 53)), single[1:], double[1:]
    for it, bits in ((single, 24), (double, 53)):
        line = "        ["
        for i, c in enumerate(it):
            word = literal(c, bits) + (", " if i + 1 < len(it) else "]")
            if len(line) + len(word) > 120:
                print(line.rstrip())
                line = "         "
            line += word
        print(line)
    print("    ).mul_add_relaxed(x, x.k2(%s, %s)) }};" % first)


if __name__ == "__main__":
    jobs = [(name, which) for name in TABLES for which in (0, 1)]
    with Pool() as pool:
        done = dict(zip(jobs, pool.map(fit, jobs, 1)))
    print("//! Written by tools/special.py. The first of each pair is for f32, the second for f64.\n")
    print("macro_rules! special {")
    for name, (what, (single, double)) in TABLES.items():
        a, b = done[name, 0], done[name, 1]
        arm(name, "%s, P on %.4g..%.4g, %.4g. Errors 2^%.1f, 2^%.1f." % (what, single[2], single[3], double[3], log2(a[1]), log2(b[1])), a[0], b[0])
    print("}\n")
    for name, shifts in (("", (0, 0)), ("_DOWN", (-8, -8)), ("_UP", (-48, -128))):
        print("/// (ln(2 * pi) - 1) / 2 + %d or %d times ln(2), in two parts." % shifts)
        print("pub const STIRLING%s: [[f64; 2]; 2] = [" % name)
        for shift, bits in zip(shifts, BITS):
            c = (ln(2 * pi) - 1) / 2 + shift * ln(2)
            print("    [%s, %s]," % (literal(rounded(c, bits), bits), literal(rounded(c - rounded(c, bits), bits), bits)))
        print("];")
    print("/// 1 / e, and -1 - ln of that.\npub const INVERSE_E: [[f64; 2]; 2] = [")
    for bits in BITS:
        c = rounded(exp(-1), bits)
        print("    [%s, %s]," % (literal(c, bits), literal(rounded(-1 - ln(c), bits), bits)))
    print("];")
