#!/usr/bin/env python3
"""The constants of approximate_reciprocal_sqrt for f64 in numeric.rs. Needs numpy."""
# y0 = bits(M - (bits(x) >> 1)); y = y0 * (a - b * x * y0^2). Search M; a, b by minimax over the range of t = y0 * sqrt(x).
import numpy as np
x = np.exp2(np.linspace(0, 2, 200001)[:-1]); xb = x.view(np.uint64)
def rng(m):
    t = (np.uint64(m) - (xb >> np.uint64(1))).view(np.float64) * np.sqrt(x); return t.min(), t.max()
best = min(((lambda r: (r[1] / r[0], k, r))(rng(0x5fe0 << 48 | k << 40)) for k in range(0, 0x1000, 4)))
print(best, hex(0x5fe0 << 48 | best[1] << 40))
lo, hi = best[2]
# g(t) = a t - b t^3 equal at both ends, peak between: g(lo) = g(hi) = 1 - e, peak = 1 + e
s = lo*lo + lo*hi + hi*hi   # a / b
peak = (s/3)**.5; gp = s*peak - peak**3; ge = s*lo - lo**3; b = 2/(gp+ge); print(b*s, b, b*gp-1)
