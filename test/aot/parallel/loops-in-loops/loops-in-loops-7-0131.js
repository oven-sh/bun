let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  L0_85: for (let i0_80 = 0; i0_80 < n && i0_80 < 4; i0_80++) {
    m1 -= 1;
  }
  L0_61: for (let i0_37 = 0; i0_37 < 4 && i0_37 < 4; i0_37++) {
    if (b > i0_37) d = 1; else e = m1;
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
