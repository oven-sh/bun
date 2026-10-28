// Calls whose callee comes out of a position of function type: a parameter, a field, an interface's method, a variable, a result, an element, a value of a Map.
// The compiler expects there the functions that the program converts into the type. A compiled program prints what plain Bun prints, whatever arrives.
declare const console: { log(...values: unknown[]): void };
function t(name: string, f: () => unknown) { let r: string; try { r = String(f()); } catch (e) { r = "threw " + (e instanceof Error ? e.name : typeof e); } console.log(name, r); }
type Unary = (value: number) => number;
type Visitor = (value: number, index: number) => number;
interface Host { read(path: string): string; size?: (path: string) => number }
interface Shape { area(): number }
const double: Unary = value => value * 2;
const negate: Unary = value => -value;
function square(value: number): number { return value * value; }
function apply(f: Unary, value: number): number { return f(value); }
function applyOnce(f: Unary, value: number): number { return f(value) + 1; }
function each(list: number[], visit: Visitor): number { let sum = 0; for (let i = 0; i < list.length; i++) sum += visit(list[i], i); return sum; }
function first<T, U>(list: readonly T[], pick: (element: T, index: number) => U | undefined): U | undefined { for (let i = 0; i < list.length; i++) { const found = pick(list[i], i); if (found !== undefined) return found; } return undefined; }
const unknownValue = (value: unknown): any => value;

t("one member", () => applyOnce(double, 4));
t("three members", () => [apply(double, 3), apply(negate, 3), apply(square, 3)].join());
t("six members", () => { const run = (f: (n: number) => string) => f(7); return [run(n => "a" + n), run(n => "b" + n), run(n => "c" + n), run(n => "d" + n), run(n => "e" + n), run(n => "f" + n)].join(); });
t("six members behind a field", () => { interface Holder { run: (n: number) => string } const hold = (run: (n: number) => string): Holder => ({ run }); const call = (holder: Holder) => holder.run(7); return [n => "a" + n, n => "b" + n, n => "c" + n, n => "d" + n, n => "e" + n, n => "f" + n].map(f => call(hold(f))).join(); });
t("six members and a stranger through any", () => { const run = (f: (n: number) => string) => f(7); const all: ((n: number) => string)[] = [n => "a" + n, n => "b" + n, n => "c" + n, n => "d" + n, n => "e" + n, n => "f" + n]; return all.map(run).join() + run(unknownValue((n: number) => "stranger" + n)); });
t("six members and something that is no function", () => { const run = (f: (n: number) => string) => f(7); const all: ((n: number) => string)[] = [n => "a" + n, n => "b" + n, n => "c" + n, n => "d" + n, n => "e" + n, n => "f" + n]; return all.map(run).join() + run(unknownValue("text")); });
t("six members, one with a rest parameter", () => { const run = (f: (n: number) => string) => f(7); return [run(n => "a" + n), run(n => "b" + n), run(n => "c" + n), run(n => "d" + n), run(n => "e" + n), run(n => "f" + n), run((...all: number[]) => "rest" + all.length)].join(); });
t("six members and a built-in", () => { const run = (f: (n: number) => number) => f(-7); return [run(n => n + 1), run(n => n + 2), run(n => n + 3), run(n => n + 4), run(n => n + 5), run(n => n + 6), run(Math.abs)].join(); });
t("a field of six members gets a stranger", () => { interface Holder { run: (n: number) => string } const hold = (run: (n: number) => string): Holder => ({ run }); const call = (holder: Holder) => holder.run(7); const all = [n => "a" + n, n => "b" + n, n => "c" + n, n => "d" + n, n => "e" + n, n => "f" + n].map(hold); const first = all[0]; unknownValue(first).run = (n: number) => "stranger" + n; return all.map(call).join(); });
t("fewer parameters than the type", () => each([1, 2, 3], value => value * 10));
t("as many parameters as the type", () => each([1, 2, 3], (value, index) => value * index));
t("the member counts its arguments", () => each([5], function () { return arguments.length; }));
t("the member reads an argument it does not declare", () => each([5, 6], function () { return arguments[1] as number; }));
t("a default value", () => each([1, 2], (value, index, extra = 100) => value + index + extra));
t("a rest parameter", () => each([1, 2], (...all: number[]) => all.length * 10 + all[0]));
t("an optional parameter is not passed", () => { const call = (f: (a: number, b?: number) => string) => f(1); return call((a, b) => a + ":" + b); });
t("more arguments than the member declares", () => { const call = (f: (a: number, b: number, c: number) => number) => f(1, 2, 3); return call(a => a); });
t("a generic helper, numbers", () => first([1, 2, 3], element => (element > 1 ? element * 2 : undefined)));
t("a generic helper, strings", () => first(["a", "bb"], (element, index) => (element.length > 1 ? element + index : undefined)));
t("a generic helper, objects", () => first([{ k: 1 }, { k: 2 }], element => (element.k === 2 ? element : undefined))?.k);
t("a generic helper finds nothing", () => first([1], () => undefined));
t("an interface's method, one literal", () => { const host: Host = { read: path => "<" + path + ">" }; return host.read("a"); });
t("an interface's method, two literals", () => { const hosts: Host[] = [{ read: path => "1" + path }, { read(path) { return "2" + path; } }]; return hosts.map(host => host.read("x")).join(); });
t("an optional member is absent", () => { const host: Host = { read: path => path }; return host.size ? host.size("a") : "none"; });
t("an optional member is called while absent", () => { const host: Host = { read: path => path }; return host.size!("a"); });
t("a class behind an interface", () => { class Circle implements Shape { constructor(private r: number) {} area() { return this.r * 3; } } class Box implements Shape { constructor(private s: number) {} area() { return this.s * this.s; } } const shapes: Shape[] = [new Circle(2), new Box(3)]; return shapes.map(shape => shape.area()).join(); });
t("an overriding method", () => { class Base { name() { return "base"; } twice() { return this.name() + this.name(); } } class Derived extends Base { name() { return "derived"; } } return new Base().twice() + new Derived().twice(); });
t("a method read as a value loses this", () => { class Counter { n = 5; get() { return this.n; } } const get: () => number = new Counter().get; return get(); });
t("a method read as a value and bound", () => { class Counter { n = 5; get() { return this.n; } } const counter = new Counter(); const get: () => number = counter.get.bind(counter); return get(); });
t("a this parameter", () => { function show(this: { n: number }, suffix: string) { return this.n + suffix; } const holder: { n: number; show: (this: { n: number }, suffix: string) => string } = { n: 3, show }; return holder.show("!"); });
t("a bound function", () => apply(Math.max.bind(null, 10), 3));
t("a built-in function", () => apply(Math.abs, -3));
t("a proxy of a function", () => apply(new Proxy(double, { apply: (target, self, list) => (target(list[0]) as number) + 1 }), 4));
t("a class where a function is declared", () => apply(unknownValue(class { }), 1));
t("a string where a function is declared", () => apply(unknownValue("text"), 1));
t("undefined where a function is declared", () => apply(unknownValue(undefined), 1));
t("an object where a function is declared", () => apply(unknownValue({}), 1));
t("a function that no conversion names", () => apply(unknownValue((value: number) => value + 0.5), 1));
t("a member replaced through any", () => { const host: Host = { read: path => path }; unknownValue(host).read = (path: string) => path + path; return host.read("ab"); });
t("a member replaced by a string through any", () => { const host: Host = { read: path => path }; unknownValue(host).read = "text"; return host.read("ab"); });
t("a member deleted through any", () => { const host: Host = { read: path => path }; delete unknownValue(host).read; return host.read("ab"); });
t("a member replaced by an accessor", () => { const host: Host = { read: path => path }; Object.defineProperty(host, "read", { get: () => (path: string) => "got " + path }); return host.read("ab"); });
t("a bivariant method parameter", () => { interface Sink { put(value: number | string): string } const narrow = { put(value: number) { return value.toFixed(1); } }; const sink: Sink = narrow; return sink.put("text"); });
t("an async member", () => { const call = (f: () => Promise<number> | number) => typeof f(); return call(async () => 1) + call(() => 1); });
t("a generator member", () => { const call = (f: () => Iterable<number>) => [...f()].join(); return call(function* () { yield 1; yield 2; }) + call(() => [3]); });
t("new.target in the member", () => { const call = (f: () => unknown) => f(); return call(function () { return new.target === undefined; }); });
t("a constructor function called through a type", () => { function Point(this: any, x: number) { if (!new.target) return "called"; this.x = x; } const f: (x: number) => unknown = Point; return f(1); });
t("a variable that changes", () => { let f: Unary = double; let sum = 0; for (let i = 0; i < 6; i++) { sum += f(i); f = i % 2 ? negate : square; } return sum; });
t("a result", () => { const make = (n: number): Unary => (n ? value => value + n : negate); return make(2)(1) + make(0)(1); });
t("an element", () => { const list: Unary[] = [double, negate, square]; let sum = 0; for (const f of list) sum += f(3); return sum + list[1](1); });
t("an element past the end", () => { const list: Unary[] = [double]; return list[1](1); });
t("a value of a Map", () => { const map = new Map<string, Unary>([["d", double], ["n", negate]]); return map.get("d")!(2) + map.get("n")!(2); });
t("a callback that returns a callback", () => { const make = (pick: (n: number) => Unary) => pick(1)(5); return make(n => value => value + n) + make(() => double); });
t("a callback that takes a callback", () => { const run = (f: (g: Unary) => number) => f(double) + f(negate); return run(g => g(3)) + run(g => g(g(1))); });
t("an overloaded function as a value", () => { function pick(value: number): number; function pick(value: string): string; function pick(value: number | string) { return value; } const f: Unary = pick; return f(4); });
t("a member that throws", () => apply(() => { throw new RangeError("from the member"); }, 1));
t("a recursive callback", () => { const walk = (n: number, visit: (n: number) => number): number => (n ? visit(n) + walk(n - 1, visit) : 0); return walk(4, n => n * n); });
t("a hot loop in which a stranger arrives", () => { let sum = 0; for (let i = 0; i < 3000; i++) sum += apply(i === 2500 ? unknownValue((value: number) => value + 1000) : double, 1); return sum; });
t("call, apply and bind of the position's value", () => { const use = (f: Unary) => f.call(null, 1) + f.apply(null, [2]) + f.bind(null, 3)(); return use(double); });
t("properties of the position's value", () => { const use = (f: Unary) => f.length + ":" + f.name; return use(double) + use(square) + use(function (a, b?: number) { return a; }); });
