// Every evaluation of a function expression makes a new function object, also where it captures nothing. A compiler that runs with one object for all of them has to know that nobody can tell.
// Each maker below makes closures of ONE function that captures nothing, and each block tells two of them apart in another way. What is only called comes last.
import { EventEmitter } from "node:events";
type F = () => number;
const lines: string[] = [];
function say(name: string, ...values: unknown[]) { lines.push(name + " " + values.join(" ")); }

{ const make = (): F => () => 1; const a = make(), b = make(); say("===", a === b, a === a, a !== b, a() + b()); }
{ const make = (): F => () => 2; const a: unknown = make(), b: unknown = make(); say("==", a == b, a == a, a != b); }
{ const make = (): F => () => 3; const a = make(), b = make(); say("Object.is", Object.is(a, b), Object.is(b, b)); }
{ const make = (): F => () => 4; const a = make(), b = make(); say("includes", [a].includes(b), [a, b].includes(b), [a].indexOf(b), [a, b].indexOf(b), [a, b, a].lastIndexOf(a)); }
{ const make = (): F => () => 5; say("Set", new Set([make(), make(), make()]).size); }
{ const make = (): F => () => 6; const s = new Set<F>(); for (let i = 0; i < 4; i++) s.add(make()); say("Set.add", s.size, s.has(make())); }
{ const make = (): F => () => 7; const m = new Map<F, number>(); const a = make(); m.set(a, 1); m.set(make(), 2); say("Map", m.size, m.get(a), m.get(make()), m.has(make()), m.delete(make()), m.size); }
{ const make = (): F => () => 8; const w = new WeakMap<F, number>(); const a = make(), b = make(); w.set(a, 1); say("WeakMap", w.has(a), w.has(b), w.get(b)); const ws = new WeakSet<F>([a]); say("WeakSet", ws.has(a), ws.has(b)); }
{ const make = (): F => () => 9; const a = make() as F & { mark?: number }, b = make() as F & { mark?: number }; a.mark = 1; say("property", a.mark, b.mark, "mark" in b, Object.keys(a).length + Object.keys(b).length); }
{ const make = () => ({ run: () => 10 }); say("members", make().run === make().run, make().run() + make().run()); }
{ class Holder { run = () => 11; } say("class fields", new Holder().run === new Holder().run); }
{ const make = (): F => () => 12; const a = make(), b = make(); let hit = "none"; switch (a) { case b: hit = "b"; break; case a: hit = "a"; break; } say("switch", hit); }
{ const make = (): F => () => 13; const list = [make(), make(), make()]; const first = list[0]; say("filter", list.filter(f => f !== first).length, list.filter((f, i, all) => all.indexOf(f) === i).length, list.findIndex(f => f === list[2])); }
{ const make = (): F => () => 14; const through = <T,>(x: T): T => x; const pair = (): [F, F] => [make(), make()]; const [a, b] = pair(); const spread = [...[a], ...[b]]; say("handed on", through(a) === through(b), through(a) === a, spread[0] === spread[1], { ...{ f: a } }.f === b); }
{ const make = (): F => () => 15; const equal = (x: readonly unknown[], y: readonly unknown[]) => x.every((v, i) => Object.is(v, y[i])); const a = make(); say("dependencies", equal([a, 1], [make(), 1]), equal([a, 1], [a, 1])); }
{
  const make = (): F => () => 16; const e = new EventEmitter(); let calls = 0; const listener = () => () => { calls++; };
  const a = listener(), b = listener(); e.on("x", a); e.on("x", b); e.off("x", listener()); e.emit("x"); const both = calls; e.off("x", a); e.emit("x"); say("listeners", both, calls, e.listenerCount("x"), make()());
}
{ const make = (): F => function () { return 17; }; say("function expressions", make() === make(), make().prototype === make().prototype); }
{ const make = () => function Thing(this: { n: number }) { this.n = 1; } as unknown as new () => { n: number }; const a = new (make())(), b = new (make())(); say("what new makes", Object.getPrototypeOf(a) === Object.getPrototypeOf(b), a.constructor === b.constructor, a.n + b.n, a instanceof make()); }
{ const make = () => class { n = 2; }; const a = new (make())(), b = new (make())(); say("classes", Object.getPrototypeOf(a) === Object.getPrototypeOf(b), a.n + b.n); }
{ const make = (): F => () => 18; const a = make(); const r = new WeakRef(a); say("WeakRef", r.deref() === a, r.deref() === make()); }
{ const make = (): F => () => 19; const o: Record<string, F> = {}; o.a = make(); o.b = make(); say("by name", o.a === o.b, Object.values(o).length, new Set(Object.values(o)).size); }
{ const make = (): F => () => 20; const a = make(), b = make(); say("bind", a.bind(null) === a.bind(null), a.bind(null)() + b.call(null) + b.apply(null)); }
{ const make = (): F => () => 21; const sorted = [make(), make()]; const before = sorted[0]; sorted.reverse(); say("reverse", sorted[1] === before, sorted[0] === before); }
{ const make = async () => 22; const gen = function* () { yield 23; }; say("async and generators", make === make, (() => async () => 1)() === (() => async () => 1)(), gen().next().value, await make()); }
{
  const make = (): F => () => 24; let sum = 0; const kept: F[] = [];
  for (let i = 0; i < 3000; i++) { const f = make(); kept[i & 7] = f; sum += f() + kept[(i + 1) & 7 & (i > 8 ? 7 : 0)](); }
  const table = { first: () => 1, second: () => 2, third: () => 3 };
  const use = (t: typeof table) => t.first() + t.second() + t.third();
  for (let i = 0; i < 3000; i++) sum += use({ first: () => 1, second: () => 2, third: () => 3 });
  say("only called", sum, use(table));
}
function churn(depth: number): number { const pair = { left: depth }; const read = () => pair.left; if (depth > 0) return churn(depth - 1) + read(); Bun.gc(true); return read(); }
{
  const make = (): F => () => 25; const watched: WeakRef<object>[] = []; let t = 0;
  function watch<T extends object>(value: T): T { watched.push(new WeakRef(value)); return value; }
  function ask() { for (let i = 0; i < 300; i++) t += watch(make())() + watch({ n: i }).n; }
  ask();
  await new Promise(resolve => setTimeout(resolve, 1)); churn(90);
  await new Promise(resolve => setTimeout(resolve, 1)); churn(90);
  say("a WeakRef watches them die", t, watched.filter(r => r.deref() !== undefined).length);
}
console.log(lines.join("\n"));
