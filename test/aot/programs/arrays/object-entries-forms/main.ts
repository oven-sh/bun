// `Object.entries` consumed in fourteen ways, on objects that change, lose or hide properties during or between the calls.
import * as impl from "./impl.js"
declare const console: { log(...values: unknown[]): void };
const leftOut = new Set<string>(["one | warmThenChanged", "one | warmThenDeleted", "one | warmThenHidden", "one | warmThenAGetter", "four | warmThenChanged", "four | warmThenDeleted", "four | warmThenHidden", "four | warmThenAGetter", "values of every kind | loop", "values of every kind | untyped", "seven: beyond the cell | warmThenChanged", "seven: beyond the cell | warmThenDeleted", "seven: beyond the cell | warmThenHidden", "seven: beyond the cell | warmThenAGetter", "a getter | warmThenChanged", "a getter | warmThenDeleted", "a getter | warmThenHidden", "a getter | warmThenAGetter", "sealed | warmThenChanged", "a text | entriesOfRecord", "a number | entriesOfRecord", "a proxy | warmThenChanged", "a proxy | warmThenDeleted", "a proxy | warmThenHidden", "a proxy | warmThenAGetter"]);
const print = (line: string): void => { if (!leftOut.has(line.split(" | ").slice(0, 2).join(" | "))) console.log(line); };
const m: any = impl
const log: string[] = []
function show(x: unknown): string { return JSON.stringify(x, (_, v) => typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? "bigint" : typeof v === "function" ? "function" : v === undefined ? "undefined" : Object.is(v, -0) ? "-0" : v) }
function attempt(f: () => unknown): string { log.length = 0; try { return show(f()) + " {" + log.join("") + "}" } catch (e) { return "throws " + (e as Error).constructor.name + " {" + log.join("") + "}" } }
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y } get sum(): number { return this.x + this.y } }
class Heir extends Point { z = 3 }
const makers: [string, () => any][] = [
  ["empty", () => ({})],
  ["one", () => ({ a: 1 })],
  ["four", () => ({ a: 1, b: "two", c: 3.5, d: null })],
  ["values of every kind", () => ({ u: undefined, n: null, z: -0, nan: NaN, s: "s", o: { p: 1 }, l: [1, 2], f() {}, y: Symbol.for("y"), g: 3n })],
  ["seven: beyond the cell", () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 })],
  ["twenty", () => { const o: Record<string, number> = {}; for (let k = 0; k < 20; k++) o["k" + k] = k; return o }],
  ["seventy", () => { const o: Record<string, number> = {}; for (let k = 0; k < 70; k++) o["k" + k] = k; return o }],
  ["a symbol among them", () => ({ a: 1, [Symbol.for("s")]: 2, b: 3 })],
  ["one not enumerable", () => Object.defineProperty({ a: 1, c: 3 }, "b", { value: 2, enumerable: false })],
  ["one read-only", () => Object.defineProperty({ a: 1, c: 3 }, "b", { value: 2, enumerable: true, writable: false })],
  ["a getter", () => ({ a: 1, get b() { log.push("g"); return 2 }, c: 3 })],
  ["a getter that deletes the next", () => { const o: any = { a: 1, get b() { log.push("g"); delete o.c; return 2 }, c: 3 }; return o }],
  ["a getter that changes the next", () => { const o: any = { a: 1, get b() { log.push("g"); o.c = "changed"; return 2 }, c: 3 }; return o }],
  ["index keys", () => ({ b: 1, 2: "two", a: 3, 1: "one" })],
  ["only index keys", () => ({ 1: "one", 0: "zero" })],
  ["deleted and added again", () => { const o: any = { a: 1, b: 2, c: 3 }; delete o.a; o.a = 4; return o }],
  ["many deleted", () => { const o: any = {}; for (let k = 0; k < 30; k++) o["k" + k] = k; for (let k = 0; k < 30; k += 2) delete o["k" + k]; return o }],
  ["no prototype", () => Object.assign(Object.create(null), { a: 1, b: 2 })],
  ["inherits enumerable names", () => Object.assign(Object.create({ inherited: 0 }), { a: 1 })],
  ["frozen", () => Object.freeze({ a: 1, b: 2 })],
  ["sealed", () => Object.seal({ a: 1, b: 2 })],
  ["an instance of a class", () => new Point(1, 2)],
  ["an heir", () => new Heir(1, 2)],
  ["an instance given a name", () => Object.assign(new Point(1, 2), { extra: 3 })],
  ["an array", () => ["x", "y"]],
  ["an array with a name", () => Object.assign(["x"], { name: 1 })],
  ["a text", () => "ab"],
  ["a number", () => 5],
  ["a function with names", () => Object.assign(function f() {}, { a: 1 })],
  ["a Map", () => new Map([["a", 1]])],
  ["a Date with a name", () => Object.assign(new Date(0), { a: 1 })],
  ["an Error", () => Object.assign(new Error("e"), { a: 1 })],
  ["arguments", () => (function (..._: unknown[]) { return arguments })("x", "y")],
  ["a proxy", () => new Proxy({ a: 1, b: 2 }, { ownKeys(t) { log.push("k"); return Reflect.ownKeys(t) }, getOwnPropertyDescriptor(t, k) { log.push("d"); return Reflect.getOwnPropertyDescriptor(t, k) }, get(t, k, r) { log.push("r"); return Reflect.get(t, k, r) } })],
  ["what JSON.parse made", () => JSON.parse('{"a":1,"b":[2],"c":{"d":3}}')],
  ["a spread", () => ({ ...{ a: 1, b: 2 }, c: 3 })],
  ["null", () => null],
  ["undefined", () => undefined],
]
function makeCold(): Record<string, (o: any) => unknown> { return { entriesCold: o => Object.entries(o) } }
const cold = makeCold()
const hot: Record<string, (o: any) => unknown> = {
  entries: o => Object.entries(o),
  entriesOfRecord: (o: Record<string, unknown>) => Object.entries(o),
  loop: o => { const out: string[] = []; for (const [k, v] of Object.entries(o)) out.push(k + "=" + String(typeof v === "symbol" ? "symbol" : v)); return out },
  fourTimes: o => { Object.entries(o); Object.entries(o); Object.entries(o); return Object.entries(o) },
  warmThenChanged: o => { Object.entries(o); Object.entries(o); Object.entries(o); const before = Object.entries(o); try { o.a = "changed" } catch {} return [before, Object.entries(o)] },
  warmThenAdded: o => { Object.entries(o); Object.entries(o); Object.entries(o); try { o.added = 1 } catch {} return Object.entries(o) },
  warmThenDeleted: o => { Object.entries(o); Object.entries(o); Object.entries(o); try { delete o.a } catch {} return Object.entries(o) },
  warmThenHidden: o => { Object.entries(o); Object.entries(o); Object.entries(o); try { Object.defineProperty(o, "a", { enumerable: false }) } catch {} return Object.entries(o) },
  warmThenAGetter: o => { Object.entries(o); Object.entries(o); Object.entries(o); try { Object.defineProperty(o, "a", { get() { log.push("G"); return "got" }, enumerable: true }) } catch {} return Object.entries(o) },
  pairsAreTheirOwn: o => { Object.entries(o); Object.entries(o); const first = Object.entries(o), second = Object.entries(o); if (first.length) { first[0]![0] = "mine"; first[0]!.push("more" as any); first.push(["pushed", 1]) } return [first, second, first === second, first.length && first[0] === second[0], Array.isArray(second), second.length && Array.isArray(second[0]) && second[0]!.length] },
  keysAndValuesAgree: o => { Object.entries(o); Object.entries(o); const e = Object.entries(o), k = Object.keys(o), v = Object.values(o); return e.length === k.length && e.every((p, i) => p[0] === k[i] && Object.is(p[1], v[i])) },
  fromEntries: o => { Object.entries(o); Object.entries(o); return Object.fromEntries(Object.entries(o)) },
}
for (const [kind, make] of makers) {
  for (const name of Object.keys(hot)) print(kind + " | " + name + " | " + attempt(() => hot[name]!(make())))
  print(kind + " | cold | " + attempt(() => { const o = make(); cold.entriesCold!(o); cold.entriesCold!(o); return cold.entriesCold!(o) }))
  print(kind + " | untyped | " + attempt(() => { const o = make(); m.entriesUntyped(o); m.entriesUntyped(o); return [m.entriesUntyped(o), m.loopUntyped(o)] }))
}
export {}
