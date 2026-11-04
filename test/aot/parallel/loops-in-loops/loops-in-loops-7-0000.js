let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_4 = 0;
  L0_50: for (let i0_19 = 0; i0_19 < p && i0_19 < 1; i0_19++) {
    a -= 1;
  }
  i0_4 = 0;
  L0_11: do {
    e = -0.5;
  } while (++i0_4 < 3);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
