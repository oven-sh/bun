// The range of the counter `i` does not settle within the rounds that typing allows, in a function whose variable `d` a closure captures and a call stores to.
let fuel = 6000;
function log(id: number, v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? v.length : v === undefined ? -1 : v === null ? -2 : v === true ? 1 : 0;
  return typeof v === "number" ? v : n;
}
const later: (() => number)[] = [];
const K3: number = 3;
function f4(p: number): number {
  let v: number = p;
  return log(95, v !== (p <= v ? v : p) ? Math.imul(p, v) : K3) < v ? v : log(96, v * p);
}
function main(): number {
  let a: number = 1, b: number = 2, c: number = -3, d: number = 0.5;
  try {
    for (let i = 0; i < 2; i++) {
      {
        let t: number = d * c;
        let w = 0;
        do {
          if (--fuel < 0) break;
          i &= ((((i <= c ? a : w) >> (b && c)) << (t << Math.min(a, a))) ^ w);
          i--;
        } while (++w < 4);
      }
      switch (log(128, d ^ a) % 6 | 0) {
        case 5:
          for (let j = 0; j < 1; j += 2) {
            later.push(() => j + d);
          }
          break;
        case 0:
          for (let k = 0; k < 5; k++) {
            if (c < Math.max(b, i + a)) {
            }
          }
          d = f4(b === (i & b) ? b : c || i);
          break;
      }
    }
    if (b !== ((a | 0) || (a & d))) return a;
  } catch (e) {}
  return 0;
}
console.log(main(), fuel, later.length);
