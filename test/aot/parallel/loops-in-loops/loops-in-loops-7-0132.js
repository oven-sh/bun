let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_24 = 0;
  L0_67: for (let i0_83 = 0; i0_83 < 3 && i0_83 < 3; i0_83++) {
    if (b == m0) a = c; else a = (c << e);
    if (b != m0) d = p; else c = p;
  }
  i0_24 = 0;
  L0_90: while (i0_24++ < 2) {
    c = i0_24;
    c = (i0_24 | p);
    if (e != m0) c = m1; else e = NaN;
  }
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
