let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  L0_58: for (let i0_49 = 0; i0_49 < 2 && i0_49 < 2; i0_49++) {
    if (a <= 2) continue;
  }
  L0_44: for (let i0_86 = 0; i0_86 < p && i0_86 < 1; i0_86++) {
    d -= 1;
    a = m0;
    c = m0;
    if (e != d) break;
  }
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n as number, p as number, q));
  } catch (error) {
    console.log((error as Error).name);
  }
}
