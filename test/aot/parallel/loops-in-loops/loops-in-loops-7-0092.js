let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_25 = 0;
  i0_25 = 0;
  L0_52: while (i0_25++ < 1) {
    L1_31: for (let i1_42 = 3; i1_42 > 0; i1_42--) {
      d = -0.5;
      b--;
      e = e;
    }
    L1_48: for (let i1_12 = 4; i1_12 > 0; i1_12--) {
      a = (p >>> 2);
      a >>>= 0;
      a = 2;
      if (a > b) break;
    }
    c = d;
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
