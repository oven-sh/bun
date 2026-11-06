#!/usr/bin/env python3
"""for-in-of-any.py <folder>: ONE CASE A FOLDER: `for (k in x)` with x of type any, and keys, values, entries of typed objects in untyped code: ONE SITE that meets every kind of value, typed objects in every state among them, again and again."""
import os, sys
out = sys.argv[1]
S = '''declare const console: { log(...values: unknown[]): void };
interface Row { a: number; b: string; c?: boolean; d?: Row | null }
class Kept implements Row { a = 1; b = "b"; c?: boolean; d?: Row | null; }
class Sub extends Kept { e = 5; }
const literal = (): Row => ({ a: 1, b: "b" }); const full = (): Row => ({ a: 1, b: "b", c: true, d: null });
const other = (): { b: string; a: number } => ({ b: "b", a: 1 });
function keysOf(x: any): string { let r = ""; for (const k in x) r += k + ","; return r; }
function keysAndValues(x: any): string { let r = ""; for (const k in x) r += k + "=" + String(x[k]) + ","; return r; }
function changes(x: any): string { let r = ""; for (const k in x) { r += k + ","; if (k === "a") { try { delete x.b; } catch {} try { x.late = 1; } catch {} } } return r; }
function nested(x: any, y: any): string { let r = ""; for (const k in x) for (const j in y) r += k + j + ","; return r; }
function broken(x: any): string { let r = ""; for (const k in x) { r += k; if (r.length > 2) break; } return r; }
const sym = Symbol("s");
const makers: [string, () => any][] = [
  ["literal", literal], ["full", full], ["other order", other], ["class", () => new Kept()], ["subclass", () => new Sub()], ["optional stored later", () => { const r = literal(); r.c = false; return r; }], ["optional stored in another order", () => { const r = literal(); r.d = null; r.c = true; return r; }],
  ["optional deleted", () => { const r = full(); delete r.c; return r; }], ["extra by any", () => { const r: any = literal(); r.extra = 1; return r; }], ["extra index", () => { const r: any = literal(); r[3] = "i"; r[1] = "j"; return r; }], ["extra symbol", () => { const r: any = literal(); r[sym] = 1; return r; }],
  ["hidden by defineProperty", () => { const r: any = literal(); try { Object.defineProperty(r, "hidden", { value: 1, enumerable: false }); } catch {} return r; }], ["frozen", () => Object.freeze(literal())], ["sealed", () => Object.seal(full())], ["a copy", () => ({ ...full() })], ["assigned", () => Object.assign({}, literal())], ["created from", () => Object.create(literal())], ["created from a class instance", () => Object.create(new Kept())],
  ["inherited name", () => Object.assign(Object.create({ inherited: "p" }), { x: 1 })], ["a string", () => "ab"], ["an empty string", () => ""], ["a rope", () => "a" + ["b"][0] + "c"], ["a String object", () => new String("ab")], ["a symbol", () => sym], ["a bigint", () => 5n], ["a big bigint", () => 10n ** 30n], ["a number", () => 5], ["a double", () => 1.5], ["true", () => true], ["null", () => null], ["undefined", () => undefined],
  ["an array", () => [1, 2]], ["a holey array", () => { const a = [1, 2, 3]; delete a[1]; return a; }], ["an array with a name", () => Object.assign([1], { n: 1 })], ["a typed array", () => new Uint8Array(2)], ["a function", () => function f() {}], ["a function with a name", () => Object.assign(() => {}, { n: 1 })], ["a class", () => Kept], ["a map", () => new Map([[1, 2]])], ["a date", () => new Date(0)], ["a regexp", () => /a/], ["an error", () => new Error("x")], ["a promise", () => Promise.resolve()],
  ["a proxy", () => new Proxy({ p: 1, q: 2 }, {})], ["a proxy of a typed object", () => new Proxy(literal(), {})], ["a proxy with ownKeys", () => new Proxy({}, { ownKeys() { return ["z", "y"]; }, getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; } })], ["no prototype", () => Object.assign(Object.create(null), { n: 1 })], ["arguments", () => (function (..._: unknown[]) { return arguments; })(1, 2)], ["plain", () => ({ p: 1, q: 2 })], ["plain with numbers", () => ({ b: 1, 2: 1, a: 1, 1: 1 })], ["parsed", () => JSON.parse('{"a":1,"b":"b"}')], ["a getter", () => ({ get g() { return 1; }, h: 2 })], ["shadowed", () => Object.create({ a: 1, z: 1 }, { a: { value: 2, enumerable: false } })],
];
for (let round = 0; round < 4; round++) for (const [name, make] of makers) { const line = [keysOf(make()), keysAndValues(make()), changes(make()), nested(make(), literal()), nested(full(), make()), broken(make()), Object.keys(Object(make() ?? {})).join(), Object.values(Object(make() ?? {})).map(String).join(), Object.entries(Object(make() ?? {})).length].join(" | "); if (round === 0 || round === 3) console.log(round, name + ": " + line); }
'''
os.makedirs(out + "/for-in-of-any", exist_ok=True); open(out + "/for-in-of-any/main.ts", "w").write(S)
print("1 program")
