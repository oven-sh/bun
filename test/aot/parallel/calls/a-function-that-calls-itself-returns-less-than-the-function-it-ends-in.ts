// A function calls itself, or another that calls it, and ends in a call of one that returns what it is given. Its own callers hand it integers alone, another caller hands that one fractions and undefined.
function out(l: string, v: unknown) { console.log(l, Object.is(v, -0) ? "-0" : String(v), typeof v); }
{
  out("case", "fraction undefined int, recursion, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number, d: number = 2): number { return d > 0 ? g(p, d - 1) : f(p); }
  out("r", f(0.5));
  out("r", f(undefined));
  const t = g(11);
  out("s", g(t));
}
{
  out("case", "fraction int, mutual recursion, literal field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number, d: number = 3): number { return d > 0 ? k(p, d - 1) : f(p); }
  function k(p: number, d: number): number { return g(p, d); }
  out("r", f(0.5));
  const box = { v: 11 };
  box.v = g(box.v);
  out("s", box.v);
  box.v = g(box.v);
  out("s", box.v);
}
{
  out("case", "fraction wide int, recursion, result");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number, d: number = 2): number { return d > 0 ? g(p, d - 1) : f(p); }
  out("r", f(0.5));
  function again(x: number) { const y = g(x); turns++; return y; }
  out("s", again(again(1099511627776)));
}
export {};
