// A function returns what it is given. One caller hands it more kinds of value than those that reach it through a bound function, a default, an await, a generator, a getter or a built-in that calls. What comes back that way goes to where only that is kept.
function out(l: string, v: unknown) { console.log(l, Object.is(v, -0) ? "-0" : String(v), typeof v); }
{
  out("case", "fraction int, bound, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function h(this: unknown, p: number) { return f(p); }
  const g = h.bind(null);
  out("r", f(0.5));
  const t = g(11);
  out("s", g(t));
}
{
  out("case", "fraction undefined int, bound argument, class field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function h(k: number, p: number) { return f(p); }
  const g = h.bind(null, 1);
  out("r", f(0.5));
  out("r", f(undefined));
  class Box { v: number; constructor(v: number) { this.v = v; } }
  const b = new Box(11);
  b.v = g(b.v);
  out("s", b.v);
  b.v = g(b.v);
  out("s", b.v);
}
{
  out("case", "fraction int, default parameter, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number, q: number = f(p)) { return q; }
  out("r", f(0.5));
  const t = g(11);
  out("s", g(t));
}
{
  out("case", "null fraction, default parameter, literal field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number, q: number = f(p)) { return q; }
  out("r", f(null));
  const box = { v: 2.5 };
  box.v = g(box.v);
  out("s", box.v);
  box.v = g(box.v);
  out("s", box.v);
}
{
  out("case", "fraction int, async, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  async function g(p: number) { return f(p); }
  out("r", f(0.5));
  const t = (await g(11));
  out("s", (await g(t)));
}
{
  out("case", "fraction undefined int, async, variable");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  async function g(p: number) { return f(p); }
  out("r", f(0.5));
  out("r", f(undefined));
  let m: number = 11;
  async function bump() { m = (await g(m)); }
  await bump();
  await bump();
  out("s", m);
}
{
  out("case", "fraction wide int, async arrow await, result");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g = async (p: number) => await f(p);
  out("r", f(0.5));
  async function again(x: number) { const y = (await g(x)); turns++; return y; }
  out("s", await again(await again(1099511627776)));
}
{
  out("case", "fraction int, then, loop");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  out("r", f(0.5));
  let sum: number = 11;
  for (let i = 0; i < 5; i++) sum = (await Promise.resolve(sum).then(f));
  out("s", sum);
}
{
  out("case", "fraction int, generator yield, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function* gen(p: number) { yield f(p); }
  out("r", f(0.5));
  const t = (gen(11).next().value as number);
  out("s", (gen(t).next().value as number));
}
{
  out("case", "fraction undefined int, generator return, class field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function* gen(p: number): Generator<never, number, unknown> { return f(p); }
  out("r", f(0.5));
  out("r", f(undefined));
  class Box { v: number; constructor(v: number) { this.v = v; } }
  const b = new Box(11);
  b.v = gen(b.v).next().value;
  out("s", b.v);
  b.v = gen(b.v).next().value;
  out("s", b.v);
}
{
  out("case", "fraction wide int, generator spread, join");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function* gen(p: number) { yield f(p); }
  out("r", f(0.5));
  const j = turns > 2 ? [...gen(1099511627776)][0] : 1099511627776;
  out("s", [...gen(j)][0]);
}
{
  out("case", "fraction int, async generator, captured");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  async function* gen(p: number) { yield f(p); }
  out("r", f(0.5));
  function mk() { let c2: number = 11; return async () => (c2 = ((await gen(c2).next()).value as number)); }
  const step = mk();
  await step();
  out("s", await step());
}
{
  out("case", "fraction int, getter, literal field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  class C { p: number; constructor(p: number) { this.p = p; } get v() { return f(this.p); } }
  out("r", f(0.5));
  const box = { v: 11 };
  box.v = new C(box.v).v;
  out("s", box.v);
  box.v = new C(box.v).v;
  out("s", box.v);
}
{
  out("case", "fraction undefined int, call, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function h(this: unknown, p: number) { return f(p); }
  out("r", f(0.5));
  out("r", f(undefined));
  const t = h.call(null, 11);
  out("s", h.call(null, t));
}
{
  out("case", "fraction int, apply, parameter");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function h(this: unknown, p: number) { return f(p); }
  out("r", f(0.5));
  function use(x: number) { if (turns++ % 5 === 9) out("never", x); return [x]; }
  out("s", use(h.apply(null, [11]))[0]);
  out("s", use(11)[0]);
}
{
  out("case", "fraction int, reflect apply, join");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function h(p: number) { return f(p); }
  out("r", f(0.5));
  const j = turns > 2 ? (Reflect.apply(h, null, [11]) as number) : 11;
  out("s", (Reflect.apply(h, null, [j]) as number));
}
{
  out("case", "fraction wide int, try finally, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number) { try { return f(p); } finally { turns++; } }
  out("r", f(0.5));
  const t = g(1099511627776);
  out("s", g(t));
}
{
  out("case", "fraction int, callback, loop");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function via(h: (p: number) => number, p: number) { return h(p); }
  out("r", f(0.5));
  let sum: number = 11;
  for (let i = 0; i < 5; i++) sum = via(f, sum);
  out("s", sum);
}
{
  out("case", "fraction undefined int, rest, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g = (...a: number[]) => f(a[0]);
  out("r", f(0.5));
  out("r", f(undefined));
  const t = g(11);
  out("s", g(t));
}
{
  out("case", "fraction int, map, class field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g = (p: number) => [p].map(v => f(v))[0];
  out("r", f(0.5));
  class Box { v: number; constructor(v: number) { this.v = v; } }
  const b = new Box(11);
  b.v = g(b.v);
  out("s", b.v);
  b.v = g(b.v);
  out("s", b.v);
}
{
  out("case", "fraction int, local then return, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number) { const r = f(p); turns++; return r; }
  out("r", f(0.5));
  const t = g(11);
  out("s", g(t));
}
{
  out("case", "fraction undefined int, constructor, loop");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  class C { v: number; constructor(p: number) { this.v = f(p); } }
  out("r", f(0.5));
  out("r", f(undefined));
  let sum: number = 11;
  for (let i = 0; i < 5; i++) sum = new C(sum).v;
  out("s", sum);
}
{
  out("case", "string int, arrow, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g = (p: number) => f(p);
  out("r", f("w"));
  const t = g(11);
  out("s", g(t));
}
{
  out("case", "object int, declaration, class field");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number) { return f(p); }
  out("r", f({ a: 1 }));
  class Box { v: number; constructor(v: number) { this.v = v; } }
  const b = new Box(11);
  b.v = g(b.v);
  out("s", b.v);
  b.v = g(b.v);
  out("s", b.v);
}
{
  out("case", "boolean int, method, loop");
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
  out("r", f(true));
  let sum: number = 11;
  for (let i = 0; i < 5; i++) sum = c.m(sum);
  out("s", sum);
}
{
  out("case", "undefined int, recursion, counter");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  function g(p: number, d: number = 2): number { return d > 0 ? g(p, d - 1) : f(p); }
  out("r", f(undefined));
  let n2 = 0;
  for (let i = 0; i < 40; i = g(i) + 7) n2++;
  out("s", n2);
}
{
  out("case", "wide int int, arrow, index");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g = (p: number) => f(p);
  out("r", f(1099511627776));
  const table = ["a", "b", "c"];
  out("s", table[g(1)]);
  out("s", "xyz".charAt(g(2)));
}
{
  out("case", "int boolean, arrow, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g = (p: boolean) => f(p);
  out("r", f(7));
  const t = g(true);
  out("s", g(t));
}
{
  out("case", "int string, conditional, variable");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g = (p: string) => (turns > 100 ? f(p) : f(p));
  out("r", f(7));
  let m: string = "n";
  function bump() { m = g(m); }
  bump();
  bump();
  out("s", m);
}
{
  out("case", "fraction undefined, two levels, feedback");
  let turns = 0;
  function f<T>(n: T): T {
    if (turns++ % 3 === 0) {
      out("p", "x");
      out("q", n);
    }
    return n;
  }
  const g1 = (p: undefined) => f(p);
  const g = (p: undefined) => g1(p);
  out("r", f(0.5));
  const t = g(undefined);
  out("s", g(t));
}
export {};
