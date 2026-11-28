"""Minimax approximations whose coefficients are floating-point numbers. Needs mpmath.

fit(f, basis, weight, lo, hi, bits) minimizes the largest |weight(t) * (sum(c[i] * basis[i](t)) - f(t))| by Remez's exchange on a
dense grid. It then rounds the first coefficient, fits the others again so that they make up for that, and so on.
"""
from mpmath import mp, mpf, matrix, lu_solve, cos, pi, frexp, ldexp, nint, floor, log

mp.prec = 240


def rounded(x, bits):
    """To the nearest number of so many significant bits."""
    if x == 0:
        return mpf(0)
    m, e = frexp(x)
    return ldexp(nint(ldexp(m, bits)), e - bits)


def truncated(x, grid):
    """Down to a multiple of 2^grid."""
    return ldexp(floor(ldexp(x, -grid)), grid)


def grid(lo, hi, n):
    points = [(lo + hi) / 2 - (hi - lo) / 2 * cos(pi * i / (n - 1)) for i in range(n)]
    return [t for t in points if abs(t) > (hi - lo) * mpf(2) ** -40]


def exchange(rows, target):
    """rows[j][i] is basis function i at point j. Returns the coefficients and the largest error."""
    n, count = len(rows[0]), len(rows)
    if n == 0:
        return [], max(abs(t) for t in target)
    at = [(2 * i + 1) * count // (2 * n + 2) for i in range(n + 1)]
    best = None
    for _ in range(40):
        scale = [max(abs(rows[j][i]) for j in at) for i in range(n)]
        a = matrix([[rows[j][i] / scale[i] for i in range(n)] + [(-1) ** k] for k, j in enumerate(at)])
        solution = lu_solve(a, matrix([target[j] for j in at]))
        c = [solution[i] / scale[i] for i in range(n)]
        error = [mp.fdot(row, c) - t for row, t in zip(rows, target)]
        worst = max(abs(e) for e in error)
        if best is None or worst < best[1]:
            best = (c, worst)
        if worst < abs(solution[n]) * 1.002:
            break
        peaks = []
        for j, e in enumerate(error):
            if peaks and (error[peaks[-1]] > 0) == (e > 0):
                if abs(e) > abs(error[peaks[-1]]):
                    peaks[-1] = j
            else:
                peaks.append(j)
        while len(peaks) > n + 1:
            k = min(range(len(peaks)), key=lambda k: abs(error[peaks[k]]))
            if k in (0, len(peaks) - 1):
                del peaks[k]
            elif len(peaks) == n + 2:
                del peaks[0 if abs(error[peaks[0]]) < abs(error[peaks[-1]]) else -1]
            else:
                other = k - 1 if abs(error[peaks[k - 1]]) < abs(error[peaks[k + 1]]) else k + 1
                del peaks[max(k, other)], peaks[min(k, other)]
        if len(peaks) < n + 1 or peaks == at:
            break
        at = peaks
    return best


def polynomial(f, n, weight, lo, hi, bits, points=700):
    """c[0] + c[1] * t + .. with n coefficients. weight is not negative."""
    ts = grid(mpf(lo), mpf(hi), points)
    w, y, fixed = [weight(t) for t in ts], [f(t) for t in ts], []
    for k in range(n + 1):
        # What is left has the factor t^k, whose sign would upset the alternation.
        sign = [-1 if t < 0 and k % 2 else 1 for t in ts]
        rows = [[s * v * t ** i for i in range(k, n)] for s, v, t in zip(sign, w, ts)]
        rest = [s * v * (u - sum(c * t ** i for i, c in enumerate(fixed))) for s, v, u, t in zip(sign, w, y, ts)]
        c, error = exchange(rows, rest)
        if k == n:
            return fixed, error
        fixed.append(rounded(c[0], bits))


def rational(f, n, d, weight, lo, hi, bits, p0=None, points=700):
    """(p0 + p[0] * t + ..) / (1 + q[0] * t + ..), for 0 <= lo. With p0 = None the numerator starts with p[0] alone."""
    ts = grid(mpf(lo), mpf(hi), points)
    w, y = [weight(t) for t in ts], [f(t) for t in ts]
    first = 0 if p0 is None else 1
    terms = sorted([(i + first, 1, i) for i in range(n)] + [(i + 1, 0, i) for i in range(d)])
    c, below = {}, [mpf(1)] * len(ts)
    term = lambda it, t, u: t ** it[0] * (1 if it[1] else -u)
    for k in range(len(terms) + 1):
        for _ in range(6 if k == 0 else 2):
            rows = [[v / b * term(it, t, u) for it in terms[k:]] for v, b, t, u in zip(w, below, ts, y)]
            rest = [v / b * (u - (p0 or 0) - sum(c[it] * term(it, t, u) for it in terms[:k])) for v, b, t, u in zip(w, below, ts, y)]
            free, error = exchange(rows, rest)
            c.update(zip(terms[k:], free))
            below = [1 + sum(c[it] * t ** it[0] for it in terms if not it[1]) for t in ts]
        if k == len(terms):
            return [c[it] for it in terms if it[1]], [c[it] for it in terms if not it[1]], error
        c[terms[k]] = rounded(c[terms[k]], bits)


def literal(x, bits):
    """The shortest decimal number that an f64, and from there an f32, turns into x."""
    if bits == 53:
        return repr(float(x))
    for digits in range(1, 18):
        text = "%.*e" % (digits, float(x))
        if rounded(mpf(float(text)), bits) == x:
            return repr(float(text))


def log2(x):
    return float(log(x, 2))
