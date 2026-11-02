// A function that ends in a call returns less than its callee does where its own callers hand it less: integers where the callee also returns fractions, numbers where it also returns undefined or null. What it returns goes to where only that is kept.
function out(l: string, v: unknown) { console.log(l, Object.is(v, -0) ? "-0" : String(v), typeof v); }
{
  out("case", "fraction int, or itself, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number) { return turns > 100 ? p : f(p); }
  out("r", f(0.5));
  const t = g(11);
  out("s", g(t));
}
{
  out("case", "null fraction, arrow, class field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g = (p: number) => f(p);
  out("r", f(null));
  class Box { v: number; constructor(v: number) { this.v = v; } }
  const b = new Box(2.5);
  b.v = g(b.v);
  out("s", b.v);
  b.v = g(b.v);
  out("s", b.v);
}
{
  out("case", "fraction wide int, declaration, parameter");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number) { return f(p); }
  out("r", f(0.5));
  function use(x: number) { if (turns++ % 5 === 9) out("never", x); return [x]; }
  out("s", use(g(1099511627776))[0]);
  out("s", use(1099511627776)[0]);
}
{
  out("case", "nan int, method, literal field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  class C { m(p: number) { return f(p); } }
  const c = new C();
  out("r", f(NaN));
  const box = { v: 11 };
  box.v = c.m(box.v);
  out("s", box.v);
  box.v = c.m(box.v);
  out("s", box.v);
}
{
  out("case", "minus zero int, static method, join");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  class C { static m(p: number) { return f(p); } }
  out("r", f(-0));
  const j = turns > 2 ? C.m(11) : 11;
  out("s", C.m(j));
}
{
  out("case", "fraction undefined int, literal method, class field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const o = { m(p: number) { return f(p); } };
  out("r", f(0.5));
  out("r", f(undefined));
  class Box { v: number; constructor(v: number) { this.v = v; } }
  const b = new Box(11);
  b.v = o.m(b.v);
  out("s", b.v);
  b.v = o.m(b.v);
  out("s", b.v);
}
{
  out("case", "fraction int, super, loop");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  class A { m(p: number) { return f(p); } }
  class C extends A { m(p: number) { return super.m(p); } }
  const c = new C();
  out("r", f(0.5));
  let sum: number = 11;
  for (let i = 0; i < 5; i++) sum = c.m(sum);
  out("s", sum);
}
{
  out("case", "fraction wide int, factory, json");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const make = () => (p: number) => f(p);
  const g = make();
  out("r", f(0.5));
  out("s", JSON.stringify({ v: g(1099511627776), w: [g(1099511627776)] }));
}
{
  out("case", "fraction int, conditional, captured");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g = (p: number) => (turns > 100 ? f(p) : f(p));
  out("r", f(0.5));
  function mk() { let c2: number = 11; return () => (c2 = g(c2)); }
  const step = mk();
  step();
  out("s", step());
}
{
  out("case", "fraction undefined int, conditional, variable");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g = (p: number) => (turns > 100 ? f(p) : f(p));
  out("r", f(0.5));
  out("r", f(undefined));
  let m: number = 11;
  function bump() { m = g(m); }
  bump();
  bump();
  out("s", m);
}
{
  out("case", "fraction int, two levels, class field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g1 = (p: number) => f(p);
  const g = (p: number) => g1(p);
  out("r", f(0.5));
  class Box { v: number; constructor(v: number) { this.v = v; } }
  const b = new Box(11);
  b.v = g(b.v);
  out("s", b.v);
  b.v = g(b.v);
  out("s", b.v);
}
{
  out("case", "fraction int, two subclasses, literal field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  abstract class A { abstract m(p: number): number; }
  class C extends A { m(p: number) { return f(p); } }
  class D extends A { m(p: number) { return f(p); } }
  const list: A[] = [new C(), new D()];
  out("r", f(0.5));
  const box = { v: 11 };
  box.v = list[turns & 1].m(box.v);
  out("s", box.v);
  box.v = list[turns & 1].m(box.v);
  out("s", box.v);
}
{
  out("case", "fraction wide int, optional, json");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g: ((p: number) => number) | undefined = turns > 100 ? undefined : p => f(p);
  out("r", f(0.5));
  out("s", JSON.stringify({ v: (g?.(1099511627776) as number), w: [(g?.(1099511627776) as number)] }));
}
{
  out("case", "null fraction, two levels, typed array");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g1 = (p: number) => f(p);
  const g = (p: number) => g1(p);
  out("r", f(null));
  const f64 = new Float64Array(2);
  const i32 = new Int32Array(2);
  f64[0] = g(2.5);
  i32[1] = g(2.5);
  out("s", f64[0] + i32[1]);
}
export {};
