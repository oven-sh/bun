// Functions that call themselves and each other last, a million deep, end in a call of one that returns what it is given. They are handed integers alone, another caller hands that one a fraction and undefined.
function out(l: string, v: unknown) { console.log(l, Object.is(v, -0) ? "-0" : String(v), typeof v); }
let turns = 0;
function f<T>(n: T): T {
  if (turns++ % 3 === 0) {
    out("p", "x");
    out("q", n);
  }
  return n;
}
function g(p: number, d: number): number { return d > 0 ? k(p, d - 1) : f(p); }
function k(p: number, d: number): number { return g(p, d); }
function down(p: number, d: number): number { return d > 0 ? down(p, d - 1) : f(p); }
out("r", f(0.5));
out("r", f(undefined));
const t = g(11, 1000000);
out("s", g(t, 1000001));
const u = down(t, 1000000);
out("s", down(u, 1000001));
export {};
