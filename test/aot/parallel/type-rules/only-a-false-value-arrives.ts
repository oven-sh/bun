// Each written type here is reached by one value only, and that value does not fit. The analysis of the whole program finds that nothing passes the test, so the code behind it is dead; the test itself still runs and throws a TypeError at the place that wrote the type. A type parameter tests nothing, an object type is satisfied by any object, and a literal type by any primitive of its kind.
function describe(error: unknown): string {
  if (!(error instanceof Error)) return "thrown: " + String(error);
  const e = error;
  const message = e.message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "");
  // The text of an error of the language is not the subject here.
  if (!/(^|: )expected |^Expected /.test(message)) return e.name;
  const position = message.includes(", got ") ? /:(\d+):(\d+)\)?\s*$/m.exec(e.stack ?? "") : null;
  return e.name + ": " + message + (position ? " | " + position[1] + ":" + position[2] : "");
}
async function attempt(name: string, f: () => unknown): Promise<void> {
  try { console.log(name, "|", "no error:", String(await f())); } catch (error) { console.log(name, "|", describe(error)); }
}
{
  function double(n: number) { return n * 2; }
  await attempt("argument", () => double("4" as any));
}
{
  function double(n: number) { return n * 2; }
  const untyped: any = double;
  await attempt("argument-by-value", () => untyped("x"));
}
{
  function ignore(n: number) { return 1; }
  await attempt("argument-unused", () => ignore("4" as any));
}
{
  function second(a: string, n: number) { return a + n; }
  await attempt("argument-second", () => second("a", "4" as any));
}
{
  function double(n: number) { return n * 2; }
  await attempt("argument-object-for-number", () => double({} as any));
}
{
  interface Point { x: number }
  function readX(p: Point) { return p.x; }
  await attempt("argument-number-for-object", () => readX(5 as any));
}
{
  function first(list: number[]) { return list[0]; }
  await attempt("argument-number-for-array", () => first(5 as any));
}
{
  function run(f: () => number) { return f(); }
  await attempt("argument-number-for-function", () => run(5 as any));
}
{
  class Box { n = 1; }
  function open(b: Box) { return b.n; }
  await attempt("argument-string-for-class", () => open("s" as any));
}
{
  function not(b: boolean) { return !b; }
  await attempt("argument-string-for-boolean", () => not("s" as any));
}
{
  function big(b: bigint) { return b + 1n; }
  await attempt("argument-number-for-bigint", () => big(1 as any));
}
{
  function sym(s: symbol) { return s.description; }
  await attempt("argument-number-for-symbol", () => sym(1 as any));
}
{
  function pick(s: "a" | "b") { return s + "!"; }
  await attempt("argument-number-for-literal", () => pick(1 as any));
}
{
  function none(n: never) { return 1; }
  await attempt("argument-for-never", () => none(1 as never));
}
{
  function size(m: Map<string, number>) { return m.size; }
  await attempt("argument-for-map", () => size(1 as any));
}
{
  const double = (n: number) => n * 2;
  await attempt("argument-arrow", () => double("4" as any));
}
{
  const double = function (n: number) { return n * 2; };
  await attempt("argument-function-expression", () => double("4" as any));
}
{
  function make(k: number) { return (n: number) => n * k; }
  const triple = make(3);
  await attempt("argument-closure", () => triple("4" as any));
}
{
  class C { k = 2; m(n: number) { return n * this.k; } }
  await attempt("argument-method", () => new C().m("4" as any));
}
{
  class C { static m(n: number) { return n * 2; } }
  await attempt("argument-static-method", () => C.m("4" as any));
}
{
  class C { #m(n: number) { return n * 2; } run(v: any) { return this.#m(v); } }
  await attempt("argument-private-method", () => new C().run("4"));
}
{
  const o = { k: 2, m(n: number) { return n * this.k; } };
  await attempt("argument-literal-method", () => o.m("4" as any));
}
{
  class A { m(n: number) { return n * 2; } }
  class B extends A {}
  await attempt("argument-inherited-method", () => new B().m("4" as any));
}
{
  class A { m(n: number) { return n * 2; } }
  class B extends A { m(n: any) { return super.m(n); } }
  await attempt("argument-super-method", () => new B().m("4"));
}
{
  class P { x: number; constructor(x: number) { this.x = x; } }
  await attempt("argument-constructor", () => new P("4" as any).x);
}
{
  class P { constructor(public x: number) {} }
  await attempt("argument-constructor-property", () => new P("4" as any).x);
}
{
  class A { x: number; constructor(x: number) { this.x = x; } }
  class B extends A { constructor(v: any) { super(v); } }
  await attempt("argument-super-constructor", () => new B("4").x);
}
{
  class A { x: number; constructor(x: number) { this.x = x; } }
  class B extends A {}
  await attempt("argument-implicit-super-constructor", () => new B("4" as any).x);
}
{
  function Old(this: any, n: number) { this.n = n; }
  await attempt("argument-constructor-function", () => new (Old as any)("4").n);
}
{
  class P { x: number; constructor(x: number) { this.x = x; } }
  await attempt("argument-reflect-construct", () => Reflect.construct(P, ["4"]).x);
}
{
  class S { #n = 0; set v(n: number) { this.#n = n; } get v() { return this.#n; } }
  await attempt("argument-setter", () => ((new S() as any).v = "4"));
}
{
  function d(n: number = 1) { return n * 2; }
  await attempt("argument-default-passed", () => d("4" as any));
}
{
  function d(n: number = "4" as any) { return n * 2; }
  await attempt("argument-default-false", () => d());
}
{
  function d(n?: number) { return (n ?? 1) * 2; }
  await attempt("argument-optional", () => d("4" as any));
}
{
  function sum(...n: number[]) { let t = 0; for (const x of n) t += x; return t; }
  await attempt("argument-rest-element", () => sum("4" as any));
}
{
  function sum(k: number, ...n: number[]) { return k + n.length; }
  await attempt("argument-before-rest", () => sum("4" as any, 1));
}
{
  function readX({ x }: { x: number }) { return x * 2; }
  await attempt("argument-destructured", () => readX({ x: "4" } as any));
}
{
  function readX({ x }: { x: number }) { return x * 2; }
  await attempt("argument-destructured-no-object", () => readX(5 as any));
}
{
  function head([x]: number[]) { return x * 2; }
  await attempt("argument-destructured-array", () => head(["4"] as any));
}
{
  function readX({ x = 1 }: { x?: number }) { return x * 2; }
  await attempt("argument-destructured-default", () => readX({ x: "4" } as any));
}
{
  function shout(this: string) { return this + "!"; }
  await attempt("argument-this", () => shout.call(5 as any));
}
{
  interface Point { x: number }
  function getX(this: Point) { return this.x; }
  await attempt("argument-this-object", () => getX.call(5 as any));
}
{
  function double(n: number) { return n * 2; }
  await attempt("argument-call", () => double.call(null, "4" as any));
}
{
  function double(n: number) { return n * 2; }
  await attempt("argument-apply", () => double.apply(null, ["4"] as any));
}
{
  function double(n: number) { return n * 2; }
  await attempt("argument-reflect-apply", () => Reflect.apply(double, null, ["4"]));
}
{
  function double(n: number) { return n * 2; }
  await attempt("argument-bind", () => double.bind(null)("4" as any));
}
{
  function double(n: number) { return n * 2; }
  await attempt("argument-bound", () => double.bind(null, "4" as any)());
}
{
  function double(n: number) { return n * 2; }
  await attempt("argument-spread", () => double(...(["4"] as any as [number])));
}
{
  const double: ((n: number) => number) | undefined = (n: number) => n * 2;
  await attempt("argument-optional-call", () => double?.("4" as any));
}
{
  function double(n: number) { return n * 2; }
  function outer(v: any) { return double(v); }
  await attempt("argument-tail-call", () => outer("4"));
}
{
  function double(n: number) { return n * 2; }
  function outer(v: any) { return 1 + double(v); }
  await attempt("argument-nested-call", () => outer("4"));
}
{
  function down(n: number): number { return n > 0 ? down(n - 1) : n === 0 ? down("x" as any) : 7; }
  await attempt("argument-recursive", () => down(2));
}
{
  function tag(s: TemplateStringsArray, n: number) { return s[0] + n * 2; }
  await attempt("argument-tagged-template", () => tag`a${"4" as any}`);
}
{
  function double(n: number) { return n * 2; }
  await attempt("argument-callback-map", () => ["4"].map(double as any));
}
{
  function log(n: number) { total += n; }
  let total = 0;
  await attempt("argument-callback-for-each", () => ["4"].forEach(log as any));
}
{
  function order(a: number, b: number) { return a - b; }
  await attempt("argument-callback-sort", () => ["4", "5"].sort(order as any));
}
{
  function swap(n: number) { return String(n * 2); }
  await attempt("argument-callback-replace", () => "4".replace("4", swap as any));
}
{
  function double(n: number) { return n * 2; }
  await attempt("argument-callback-then", () => Promise.resolve("4").then(double as any));
}
{
  function later(n: number) { settle(n * 2); }
  let settle: (v: unknown) => void = () => {};
  await attempt("argument-callback-timer", () => new Promise((resolve, reject) => { settle = resolve; process.once("uncaughtException", reject); setTimeout(later as any, 0, "4"); }));
}
{
  function revive(k: number, v: unknown) { return v; }
  await attempt("argument-callback-json", () => JSON.parse("[1]", revive as any));
}
{
  function each(f: (v: any) => number, v: any) { return f(v); }
  function double(n: number) { return n * 2; }
  await attempt("argument-callback-own", () => each(double, "4"));
}
{
  async function double(n: number) { return n * 2; }
  await attempt("argument-async", () => double("4" as any));
}
{
  const double = async (n: number) => n * 2;
  await attempt("argument-async-arrow", () => double("4" as any));
}
{
  class C { async m(n: number) { return n * 2; } }
  await attempt("argument-async-method", () => new C().m("4" as any));
}
{
  async function double(n: number) { return n * 2; }
  const untyped: any = double;
  await attempt("argument-async-by-value", () => untyped("4"));
}
{
  function* count(n: number) { yield n * 2; }
  await attempt("argument-generator", () => [...count("4" as any)]);
}
{
  function* count(n: number) { yield n * 2; }
  await attempt("argument-generator-not-started", () => typeof count("4" as any));
}
{
  async function* count(n: number) { yield n * 2; }
  await attempt("argument-async-generator", () => count("4" as any).next());
}
{
  const o = { set v(n: number) { kept = n; } };
  let kept = 0;
  await attempt("argument-getter-of-object", () => ((o as any).v = "4"));
}
{
  const o = { [Symbol.toPrimitive](hint: number) { return hint * 2; } };
  await attempt("argument-symbol-method", () => `${o as any}`);
}
{
  const o = { toJSON(key: number) { return key * 2; } };
  await attempt("argument-to-json", () => JSON.stringify(o));
}
{
  await attempt("variable-const", () => (() => { const n: number = "4" as any; return n * 2; })());
}
{
  await attempt("variable-let-assigned", () => (() => { let n: number = 1; n = "4" as any; return n * 2; })());
}
{
  await attempt("variable-unused", () => (() => { const n: number = "4" as any; return 1; })());
}
{
  let counter: number = 1;
  function set(v: any) { counter = v; }
  await attempt("variable-module", () => (set("4"), counter * 2));
}
{
  function make() { let n: number = 1; return { set(v: any) { n = v; }, get() { return n; } }; }
  await attempt("variable-captured", () => (() => { const m = make(); m.set("4"); return m.get(); })());
}
{
  await attempt("variable-destructured", () => (() => { const { x }: { x: number } = { x: "4" } as any; return x * 2; })());
}
{
  await attempt("variable-compound", () => (() => { let n: number = 1; n += "4" as any; return n; })());
}
{
  function r(): number { return "4" as any; }
  await attempt("result", () => r());
}
{
  function r(): number { return "4" as any; }
  await attempt("result-unused", () => (r(), 1));
}
{
  const r = (): number => "4" as any;
  await attempt("result-arrow", () => r());
}
{
  class C { m(): number { return "4" as any; } }
  await attempt("result-method", () => new C().m());
}
{
  class C { get v(): number { return "4" as any; } }
  await attempt("result-getter", () => new C().v);
}
{
  function r(): number { return "4" as any; }
  const untyped: any = r;
  await attempt("result-by-value", () => untyped());
}
{
  function inner(): any { return "4"; }
  function r(): number { return inner(); }
  await attempt("result-tail-call", () => r());
}
{
  async function r(): Promise<number> { return "4" as any; }
  await attempt("result-async", () => r());
}
{
  function r(): number { return "4" as any; }
  await attempt("result-callback", () => [1].map(r));
}
{
  function* g(): Generator<number> { yield "4" as any; }
  await attempt("result-generator-yield", () => [...g()]);
}
{
  function r(): never { return 1 as never; }
  await attempt("result-never", () => r());
}
{
  class F { n: number = "4" as any; }
  await attempt("field-initializer", () => new F().n);
}
{
  class F { n: number = 1; }
  await attempt("field-store", () => (() => { const f = new F(); f.n = "4" as any; return f.n; })());
}
{
  class F { n: number; constructor(v: any) { this.n = v; } }
  await attempt("field-store-in-constructor", () => new F("4").n);
}
{
  await attempt("field-static", () => (() => { class F { static n: number = "4" as any; } return F.n; })());
}
{
  class F { #n: number = 1; set(v: any) { this.#n = v; return this.#n; } }
  await attempt("field-private", () => new F().set("4"));
}
{
  await attempt("field-literal", () => (() => { const p: { x: number } = { x: "4" as any }; return p.x; })());
}
{
  interface Point { x: number }
  await attempt("field-interface-store", () => (() => { const p: Point = { x: 1 }; p.x = "4" as any; return p.x; })());
}
{
  class F { n: number = 1; }
  await attempt("field-read-untyped-store", () => (() => { const f = new F(); (f as any).n = "4"; return f.n; })());
}
{
  await attempt("element-store", () => (() => { const a: number[] = [1]; a[0] = "4" as any; return a[0]; })());
}
{
  await attempt("element-push", () => (() => { const a: number[] = [1]; a.push("4" as any); return a[1]; })());
}
{
  await attempt("element-literal", () => (() => { const a: number[] = ["4" as any]; return a[0]; })());
}
{
  await attempt("record-value", () => (() => { const r: Record<string, number> = {}; r.a = "4" as any; return r.a; })());
}
{
  const v: any = "4";
  await attempt("cast", () => (v as number) * 2);
}
{
  const v: any = "4";
  await attempt("cast-unused", () => (v as number, 1));
}
{
  await attempt("cast-constant", () => ("4" as unknown as number) * 2);
}
{
  const v: any = "4";
  await attempt("cast-angle", () => (<number>v) * 2);
}
{
  await attempt("awaited", () => (async () => { const n: number = await (Promise.resolve("4") as any); return n * 2; })());
}
{
  enum Color { Red, Green }
  function name(c: Color) { return Color[c]; }
  await attempt("enum-value", () => name("x" as any));
}
{
  function u(v: number | boolean) { return typeof v; }
  await attempt("union-argument", () => u("4" as any));
}
{
  function g<T extends number>(v: T) { return v * 2; }
  await attempt("generic-constraint", () => g("4" as any));
}
{
  class A { a = 1; }
  class B { b = 2; }
  function readA(v: A) { return v.a; }
  await attempt("class-for-other-class", () => readA(new B() as any));
}
{
  function source(r: RegExp) { return r.source; }
  await attempt("date-for-regexp", () => source(new Date(0) as any));
}
{
  interface Point { x: number }
  function readX(p: Point) { return p.x; }
  await attempt("function-for-object", () => readX((() => 1) as any));
}
{
  function pick(s: "a" | "b") { return s + "!"; }
  await attempt("string-outside-literals", () => pick("c" as any));
}
console.log("after");
