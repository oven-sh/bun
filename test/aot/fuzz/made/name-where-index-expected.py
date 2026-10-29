#!/usr/bin/env python3
"""name-where-index-expected.py <folder>: ONE CASE A FOLDER: the shape of lodash's baseClone: the callback of an arrayEach gets an index everywhere else and a NAME here. One site, every receiver x every key, three rounds, reads and stores, against plain Bun."""
import os, sys
out = sys.argv[1]
EACH = '''export function arrayEach(array, iteratee) { var index = -1, length = array == null ? 0 : array.length; while (++index < length) { if (iteratee(array[index], index, array) === false) break; } return array; }
export function sumByIndex(array) { var total = 0; arrayEach(array, function (value, key) { total += array[key] === value ? 1 : 0; }); return total; }
export function readAll(value, props, show) { var out = []; arrayEach(props || value, function (subValue, key) { if (props) { key = subValue; try { subValue = value[key]; } catch (e) { subValue = "THROWS " + e.name; } } out.push(show(key) + "=" + show(subValue)); }); return out.join(" "); }
export function storeAll(value, props, made, show) { var out = []; arrayEach(props || value, function (subValue, key) { if (props) key = subValue; try { value[key] = made(key); out.push(show(key) + ":" + show(value[key])); } catch (e) { out.push(show(key) + ":REFUSED"); } }); return out.join(" "); }
'''
MAIN = '''declare const console: { log(...values: unknown[]): void };
import { arrayEach, sumByIndex, readAll, storeAll } from "./each.js";
interface Row { a: number; b: string; c?: boolean; d?: Row | null; 0?: string }
class Kept { a = 1; b = "b"; c?: boolean; get g(): string { return "got " + this.a; } m(): number { return this.a; } static s = 1; }
class Sub extends Kept { e = 5; override m(): number { return 2; } }
const sym = Symbol("s");
const show = (v: unknown): string => typeof v === "function" ? "function" : typeof v === "symbol" ? v.toString() : typeof v === "object" && v !== null ? (Array.isArray(v) ? "[" + v.length + "]" : "{" + Object.keys(v).join() + "}") : typeof v === "string" ? JSON.stringify(v) : String(v);
const makers: [string, () => any][] = [
  ["literal", (): Row => ({ a: 1, b: "b" })], ["full", (): Row => ({ a: 1, b: "b", c: true, d: null })], ["nested", (): Row => ({ a: 1, b: "b", d: { a: 2, b: "in" } })], ["class", () => new Kept()], ["subclass", () => new Sub()],
  ["optional later", () => { const r: Row = { a: 1, b: "b" }; r.c = false; return r; }], ["optional deleted", () => { const r: Row = { a: 1, b: "b", c: true }; delete r.c; return r; }], ["extra", () => { const r: any = { a: 1, b: "b" } as Row; r.extra = "x"; return r; }], ["extra index", () => { const r: any = { a: 1, b: "b" } as Row; r[1] = "one"; return r; }], ["extra symbol", () => { const r: any = { a: 1, b: "b" } as Row; r[sym] = "s"; return r; }],
  ["frozen", () => Object.freeze({ a: 1, b: "b" } as Row)], ["heir", () => Object.create({ a: 1, b: "b" } as Row)], ["proxy", () => new Proxy({ a: 1, b: "b" } as Row, {})], ["plain", () => JSON.parse('{"a":1,"b":"b","c":true}')], ["array", () => [10, 20]], ["array with a name", () => Object.assign([10], { a: "named" })], ["string", () => "ab"], ["bytes", () => new Uint8Array([7, 8])], ["map", () => new Map([["a", 1]])], ["no prototype", () => Object.assign(Object.create(null), { a: 1 })], ["function", () => Object.assign(function f() {}, { a: 1 })], ["number", () => 5], ["arguments", () => (function (..._: unknown[]) { return arguments; })("x", "y")],
];
const rope = (s: string): string => s.length < 2 ? ("<" + s).slice(1) : s.slice(0, 1) + [s.slice(1)][0];
const keys: unknown[] = ["a", "b", "c", "d", "e", "g", "m", "s", "extra", "absent", "constructor", "__proto__", "toString", "hasOwnProperty", "length", "0", "1", "2", "-1", "1.5", "01", 0, 1, 2, -1, 1.5, NaN, 4294967295, 4294967294, sym, Symbol.iterator, Symbol.toStringTag, rope("a"), rope("b"), rope("extra"), rope("absent"), rope("length"), rope("constructor"), null, undefined, true, { toString() { return "a"; } }, ["b"], 1n, ""];
console.log(sumByIndex([1, 2, 3]), sumByIndex(["x"]), sumByIndex([]));
for (let i = 0; i < 300; i++) sumByIndex([i, i + 1, i + 2]);
for (let round = 0; round < 3; round++) for (const [name, make] of makers) { const line = readAll(make(), keys, show); const byIndex = readAll(make(), null, show); if (round !== 1) console.log(round, name, "|", line, "|", byIndex); }
const made = (key: unknown): unknown => key === "a" ? 7 : key === "b" ? "stored" : key === "c" ? false : key === "d" ? null : key === "e" ? 9 : "any " + show(key);
const wrong = (key: unknown): unknown => key === "a" ? "seven" : key === "b" ? 5 : key === "c" ? "no" : key === "d" ? 3 : key === "e" ? "nine" : 1;
const right: unknown[] = ["a", "b", "c", "d", rope("a"), rope("b"), 0, 1, "0", "extra2", sym, rope("extra2")];
for (let round = 0; round < 3; round++) for (const [name, make] of makers) { if (name === "number" || name === "string") continue; const o = make(); const line = storeAll(o, right, made, show); if (round !== 1) console.log(round, "stores", name, "|", line, "|", show(o)); }
let refused = 0, taken = 0; for (let round = 0; round < 3; round++) for (const [name, make] of makers.slice(0, 10)) { const o = make(); const before = JSON.stringify(o); const line = storeAll(o, ["a", "b", "c", "d", rope("a")], wrong, show); for (const part of line.split(" ")) part.endsWith("REFUSED") ? refused++ : taken++; if (line.split(" ").every((p: string) => p.endsWith("REFUSED")) && JSON.stringify(o) !== before) console.log("REFUSED AND YET CHANGED", name, before, JSON.stringify(o)); }
console.log("wrong values: taken or refused", refused + taken);
'''
os.makedirs(out + "/name-where-index-expected", exist_ok=True)
open(out + "/name-where-index-expected/each.js", "w").write(EACH); open(out + "/name-where-index-expected/main.ts", "w").write(MAIN)
print("1 program")
