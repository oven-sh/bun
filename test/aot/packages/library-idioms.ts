// What well-known libraries do with the objects, classes and functions that a TypeScript program passes to them: clone by prototype, deep clone, freeze, drafts wrapped in a Proxy, fields turned into accessors, instances filled from plain data, spies, generated code, checks of what kind of function a value is.
import { js, pkg, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    // @jridgewell/remapping 2.3.5: the .d.cts that "require" leads to does not parse. Nobody who builds can edit it, and plain Bun never reads it.
    name: "declarations-that-do-not-parse",
    files: {
      ...pkg(
        "declares_badly",
        {
          "index.cjs": `module.exports = function remap(a) { return [a, "cjs"]; };\n`,
          "index.mjs": `export default function remap(a) { return [a, "mjs"]; }\n`,
          "types/index.d.mts": `export default function remap(a: string): string[];\n`,
          "types/index.d.cts": `export type Options = { a?: number };
export =       function remap(a: string): string[];
`,
        },
        {
          main: "index.cjs",
          module: "index.mjs",
          exports: { ".": { import: { types: "./types/index.d.mts", default: "./index.mjs" }, default: { types: "./types/index.d.cts", default: "./index.cjs" } } },
        },
      ),
    },
    importers: {
      "require.cjs": `${js}t("x", () => require("declares_badly")("x"));
`,
      "import.mjs": `import remap from "declares_badly";
${js}t("x", () => remap("x"));
`,
    },
  },
  {
    // A package whose entry is TypeScript is checked under the options of whoever imports it, who cannot edit it: its type errors make it untyped code, with a warning, and stop no build.
    name: "typescript-with-type-errors",
    files: {
      ...pkg("undeclared", { "index.js": `exports.load = function load(s) { return { text: s }; };\n` }, { main: "index.js" }),
      ...pkg(
        "ships_typescript",
        {
          "index.ts": `import { load } from "undeclared";
import { twice } from "./twice";
import type { Options } from "./types";
export function parse(s: string, options?: Options): unknown { return load(s); }
export function loose(x) { return x.length; }
const wrong: number = "a text";
export const length: number = String(wrong).length;
export { twice };
`,
          "twice.ts": `export function twice(n: number): number { return n * 2; }\n`,
          "types.ts": `import type { Loaded } from "undeclared";
import type { Nothing } from "not_installed";
export interface Options { loaded?: Loaded; nothing?: Nothing }
`,
        },
        { main: "index.ts", module: "index.ts", types: "index.ts" },
      ),
    },
    importers: {
      "import.mjs": `import { parse, loose, length, twice } from "ships_typescript";
${js}t("x", () => [parse("a"), loose("abc"), length, twice(4)]);
`,
      "import.ts": `import { parse, loose, length, twice } from "ships_typescript";
${ts}t("x", () => [parse("a"), loose("abc"), length, twice(4)]);
`,
      "require.cjs": `${js}t("x", () => { const it = require("ships_typescript"); return [it.parse("a"), it.loose("abc"), it.length, it.twice(4)]; });
`,
    },
  },
  {
    // tsdown and rolldown cut code and declarations into chunks and shorten the names of their exports separately, so `a` is a function in core.js and an interface in core.d.ts.
    name: "chunk-exports-shortened-separately",
    files: {
      ...pkg(
        "shortened",
        {
          "dist/core.js": `function namespaces() { return "namespaces"; }
function enabled() { return "enabled"; }
function disable() { return "disable"; }
export { namespaces as a, enabled as i, disable as n };
`,
          "dist/core.d.ts": `interface Debugger { (x: string): void }
interface DebugOptions { a?: number }
declare function enabled(): string;
declare function namespaces(): string;
declare function disable(): string;
export { Debugger as a, DebugOptions as i, enabled as n, namespaces as r, disable as t };
`,
          "dist/node.js": `import { a as namespaces, i as enabled, n as disable } from "./core.js";
function createDebug() { return [namespaces(), enabled(), disable()].join(); }
export { createDebug, disable, enabled, namespaces };
`,
          "dist/node.d.ts": `import { a as Debugger, i as DebugOptions, n as enabled, r as namespaces, t as disable } from "./core.js";
declare function createDebug(): string;
export { type DebugOptions, type Debugger, createDebug, disable, enabled, namespaces };
`,
        },
        { type: "module", main: "./dist/node.js", types: "./dist/node.d.ts" },
      ),
    },
    importers: {
      "namespace.mjs": `import * as ns from "shortened";
${js}t("x", () => [keys(ns), ns.enabled(), ns.namespaces(), ns.createDebug()]);
`,
      "dynamic.mjs": `${js}await ta("x", async () => { const ns = await import("shortened"); return [keys(ns), typeof ns.enabled, typeof ns.namespaces]; });
`,
      "required.cjs": `${js}t("x", () => { const ns = require("shortened"); return [keys(ns), typeof ns.enabled, typeof ns.namespaces]; });
`,
      "names.mjs": `import { enabled, namespaces, disable } from "shortened";
${js}t("x", () => [enabled(), namespaces(), disable()]);
`,
      "namespace.ts": `import * as ns from "shortened";
${ts}t("x", () => [keys(ns), ns.enabled(), ns.namespaces()]);
`,
      "names.ts": `import { enabled, namespaces, disable } from "shortened";
${ts}t("x", () => [enabled(), namespaces(), disable()]);
`,
    },
  },
  {
    name: "typed",
    files: {
      ...pkg("libs", {
        "index.js": `"use strict";
exports.cloneByPrototype = (o) => Object.assign(Object.create(Object.getPrototypeOf(o)), o);
exports.cloneDeep = function cloneDeep(v) { if (Array.isArray(v)) return v.map(cloneDeep); if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, cloneDeep(x)])); if (v instanceof Date) return new Date(+v); if (v && typeof v === "object") { const r = Object.create(Object.getPrototypeOf(v)); for (const k of Object.keys(v)) r[k] = cloneDeep(v[k]); return r; } return v; };
exports.cloneByConstructor = (o) => { const r = new o.constructor(); for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; };
exports.cloneByDescriptors = (o) => Object.create(Object.getPrototypeOf(o), Object.getOwnPropertyDescriptors(o));
exports.freezeDeep = function freezeDeep(v) { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(freezeDeep); } return v; };
exports.produce = (base, recipe) => { const copy = Array.isArray(base) ? base.slice() : Object.assign(Object.create(Object.getPrototypeOf(base)), base); let changed = false; const draft = new Proxy(copy, { set(t, k, v) { changed = true; t[k] = v; return true; }, deleteProperty(t, k) { changed = true; return delete t[k]; } }); recipe(draft); return changed ? Object.freeze(copy) : base; };
exports.observable = (o, log) => { for (const k of Object.keys(o)) { let v = o[k]; Object.defineProperty(o, k, { get() { log.push("get " + k); return v; }, set(x) { log.push("set " + k); v = x; }, enumerable: true, configurable: true }); } return o; };
exports.fill = (K, plain) => { const r = new K(); for (const k of Object.keys(plain)) r[k] = plain[k]; return r; };
exports.fillByCreate = (K, plain) => Object.assign(Object.create(K.prototype), plain);
exports.pick = (o, ...ks) => { const r = {}; for (const k of ks) if (k in o) r[k] = o[k]; return r; };
exports.omit = (o, ...ks) => { const r = { ...o }; for (const k of ks) delete r[k]; return r; };
exports.merge = function merge(a, b) { for (const k of Object.keys(b)) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") merge(a[k], b[k]); else a[k] = b[k]; } return a; };
exports.defaults = (o, d) => { for (const k in d) if (o[k] === undefined) o[k] = d[k]; return o; };
exports.mapValues = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v, k)]));
exports.groupBy = (a, f) => a.reduce((r, x) => { (r[f(x)] ||= []).push(x); return r; }, {});
exports.sortBy = (a, f) => a.slice().sort((x, y) => (f(x) < f(y) ? -1 : f(x) > f(y) ? 1 : 0));
exports.nullProto = (o) => Object.assign(Object.create(null), o);
exports.sealed = (o) => Object.seal({ ...o });
exports.proxied = (o) => new Proxy(o, {});
exports.withGetter = (o) => { const r = {}; for (const k of Object.keys(o)) Object.defineProperty(r, k, { get: () => o[k], enumerable: true }); return r; };
exports.memoize = (f) => { const c = new Map(); return function (x) { if (!c.has(x)) c.set(x, f.apply(this, arguments)); return c.get(x); }; };
exports.once = (f) => { let done = false, r; return function () { if (!done) { done = true; r = f.apply(this, arguments); } return r; }; };
exports.debounceNow = (f) => function (...a) { return f.call(this, ...a); };
exports.promisify = (f) => function (...a) { return new Promise((res, rej) => f.call(this, ...a, (e, v) => (e ? rej(e) : res(v)))); };
exports.bindAll = (o) => { for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(o))) if (k !== "constructor" && typeof o[k] === "function") o[k] = o[k].bind(o); return o; };
exports.methodsOf = (o) => Object.getOwnPropertyNames(Object.getPrototypeOf(o)).sort();
exports.spy = (o, k) => { const orig = o[k]; const calls = []; o[k] = function (...a) { calls.push(a); return orig.apply(this, a); }; o[k].restore = () => { o[k] = orig; }; return calls; };
exports.delegate = (proto, target, names) => { for (const n of names) { proto.__defineGetter__(n, function () { return this[target][n]; }); proto.__defineSetter__(n, function (v) { this[target][n] = v; }); } return proto; };
exports.kind = (f) => [typeof f, f.constructor && f.constructor.name, Object.prototype.toString.call(f), Object.getPrototypeOf(f) === Function.prototype, "prototype" in f, Object.getOwnPropertyNames(f).sort().join(), /^class[\\s{]/.test(Function.prototype.toString.call(f)), f.length, f.name].join(" | ");
const util = require("node:util");
exports.nativeKind = (f) => [util.types.isAsyncFunction(f), util.types.isGeneratorFunction(f), util.inspect(f), util.types.isProxy(f), util.types.isPromise(f)].join(" | ");
const GeneratorFunction = Object.getPrototypeOf(Function("return function* () {}")());
const AsyncFunction = Object.getPrototypeOf(Function("return async function () {}")());
exports.sameKin = (f) => [Object.getPrototypeOf(f) === GeneratorFunction, Object.getPrototypeOf(f) === AsyncFunction, f instanceof Function, f instanceof AsyncFunction.constructor].join(" | ");
exports.isConstructor = (f) => { try { Reflect.construct(String, [], f); return true; } catch { return false; } };
exports.inspect = (v) => util.inspect(v, { depth: 3, breakLength: Infinity });
exports.deepEqual = (a, b) => util.isDeepStrictEqual(a, b);
exports.compile = (names, body) => new Function(...names, body);
exports.template = (text) => new Function("obj", "with (obj) { return \`" + text + "\`; }");
exports.builder = () => { const styles = { bold: "<b>", dim: "<d>" }; const proto = Object.defineProperties(function () {}, Object.fromEntries(Object.keys(styles).map((n) => [n, { get() { const b = make([...(this._s || []), styles[n]]); Object.defineProperty(this, n, { value: b }); return b; } }]))); function make(s) { const b = (...a) => s.join("") + a.join(" "); Object.setPrototypeOf(b, proto); b._s = s; return b; } return make([]); };
exports.argumentsOf = function () { return arguments; };
`,
        "index.d.ts": `export declare function cloneByPrototype<T>(o: T): T;
export declare function cloneDeep<T>(o: T): T;
export declare function cloneByConstructor<T>(o: T): T;
export declare function cloneByDescriptors<T>(o: T): T;
export declare function freezeDeep<T>(o: T): T;
export declare function produce<T>(base: T, recipe: (draft: T) => void): T;
export declare function observable<T extends object>(o: T, log: string[]): T;
export declare function fill<T>(K: new () => T, plain: object): T;
export declare function fillByCreate<T>(K: new (...a: any[]) => T, plain: object): T;
export declare function pick<T, K extends keyof T>(o: T, ...ks: K[]): Pick<T, K>;
export declare function omit<T, K extends keyof T>(o: T, ...ks: K[]): Omit<T, K>;
export declare function merge<A extends object, B extends object>(a: A, b: B): A & B;
export declare function defaults<A extends object, B extends object>(o: A, d: B): A & B;
export declare function mapValues<T extends object, R>(o: T, f: (v: T[keyof T], k: string) => R): Record<keyof T, R>;
export declare function groupBy<T>(a: T[], f: (x: T) => string): Record<string, T[]>;
export declare function sortBy<T>(a: T[], f: (x: T) => number | string): T[];
export declare function nullProto<T>(o: T): T;
export declare function sealed<T>(o: T): T;
export declare function proxied<T>(o: T): T;
export declare function withGetter<T>(o: T): T;
export declare function memoize<A, R>(f: (x: A) => R): (x: A) => R;
export declare function once<F extends (...a: any[]) => any>(f: F): F;
export declare function debounceNow<F extends (...a: any[]) => any>(f: F): F;
export declare function promisify<A, R>(f: (x: A, cb: (e: Error | null, v?: R) => void) => void): (x: A) => Promise<R>;
export declare function bindAll<T>(o: T): T;
export declare function methodsOf(o: object): string[];
export declare function spy<T, K extends keyof T>(o: T, k: K): unknown[][];
export declare function delegate<T>(proto: T, target: string, names: string[]): T;
export declare function kind(f: Function): string;
export declare function nativeKind(f: unknown): string;
export declare function sameKin(f: Function): string;
export declare function isConstructor(f: unknown): boolean;
export declare function inspect(v: unknown): string;
export declare function deepEqual(a: unknown, b: unknown): boolean;
export declare function compile(names: string[], body: string): (...a: any[]) => any;
export declare function template(text: string): (obj: object) => string;
export declare function builder(): any;
export declare function argumentsOf(...a: unknown[]): IArguments;
`,
      }, {"main": "index.js", "types": "index.d.ts"}),
    },
    importers: {
      "clone_by_prototype.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const p = new Point(1, 2); const c = L.cloneByPrototype(p);
t("x", () => [c.x + 1, c.norm(), c.sum, c instanceof Point, c !== p, c.plus(p).x, p.plus(c).y, Object.keys(c)]);
c.x = 10; t("own state", () => [p.x, c.x, c.norm()]);
`,
      "clone_deep.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const p = new Point(1, 2); const c = L.cloneDeep(p);
t("x", () => [c.norm(), c instanceof Point, c.plus(p).sum]);
const s = state(); const d = L.cloneDeep(s);
d.nested.n++; d.tags.push("b"); d.count += 1;
t("s", () => [s, d, d.nested.n + 1, d.tags.length]);
const list: Point[] = [new Point(1, 1), new Point(2, 2)]; const l2 = L.cloneDeep(list);
t("list", () => [l2.map((q) => q.norm()), l2[0] instanceof Point, l2[0] !== list[0]]);
const m = new Map<string, Point>([["a", new Point(3, 4)]]); t("map", () => L.cloneDeep(m).get("a")!.norm());
`,
      "clone_by_constructor.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const p = new Point(1, 2); const c = L.cloneByConstructor(p);
t("x", () => [c.x, c.norm(), c instanceof Point, c.plus(p).sum]);
`,
      "clone_by_descriptors.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const p = new Point(1, 2); const c = L.cloneByDescriptors(p);
t("x", () => [c.x, c.norm(), c instanceof Point, c.plus(p).sum, Object.keys(c)]);
const d = L.cloneByDescriptors(state()); t("s", () => [d.count + 1, d.nested.n, d]);
`,
      "structured_clone.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const p = new Point(1, 2); const c = structuredClone(p);
t("x", () => [c.x + 1, c instanceof Point, typeof c.norm, Object.keys(c)]);
const d = structuredClone(state()); d.nested.n++; t("s", () => [d, d.count + 1]);
t("json", () => { const j: State = JSON.parse(JSON.stringify(state())); j.count++; return [j, j.tags.length]; });
`,
      "freeze_deep.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const s = L.freezeDeep(state());
t("read", () => [s.count + 1, s.nested.n, s.tags.length, Object.isFrozen(s), Object.isFrozen(s.nested), Object.isFrozen(s.tags)]);
t("write", () => { s.count = 5; return s.count; }); t("nested", () => { s.nested.n = 5; return s.nested.n; }); t("push", () => s.tags.push("x"));
const p = L.freezeDeep(new Point(1, 2)); t("p", () => [p.norm(), Object.isFrozen(p)]); t("p write", () => { p.x = 9; return p.x; });
`,
      "produce.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const a = state(); const b = L.produce(a, (d) => { d.count++; d.name = "changed"; });
t("x", () => [a.count, b.count + 1, b.name, a !== b, Object.isFrozen(b), b.tags === a.tags]);
const c = L.produce(b, () => {}); t("same", () => c === b);
t("write", () => { b.count = 9; return b.count; });
function read(s: State): string { return s.name + s.count + s.nested.n; } t("typed use", () => [read(a), read(b)]);
const arr: number[] = [1, 2]; const arr2 = L.produce(arr, (d) => { d.push(3); d[0] = 9; }); t("arr", () => [arr, arr2, arr2.length, arr2.reduce((x, y) => x + y, 0)]);
const p2 = L.produce(new Point(1, 2), (d) => { d.x = 5; }); t("class", () => [p2.x, p2.norm(), p2 instanceof Point]);
`,
      "observable.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const log: string[] = []; const s = L.observable(state(), log);
t("x", () => [s.count + 1, s.name]); s.count = 5; s.count++;
t("after", () => [s.count, log]);
function bump(x: State): number { x.count += 1; return x.count; } t("typed use", () => [bump(s), log.length]);
const log2: string[] = []; const p = L.observable(new Point(1, 2), log2);
t("class", () => [p.x, p.norm(), p.sum, log2]); p.x = 7; t("class after", () => [p.x, p.norm(), log2.length, JSON.stringify(p)]);
`,
      "fill.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const p = L.fill(Point, { x: 3, y: 4 }); t("x", () => [p.norm(), p instanceof Point, p.plus(new Point(1, 1)).sum]);
const q = L.fill(Point, { x: 3, extra: "e" }); t("extra", () => [q.norm(), (q as any).extra, Object.keys(q)]);
t("wrong", () => { const w = L.fill(Point, { x: "3" }); return [w.x, w.norm()]; });
const r = L.fillByCreate(Point, { x: 5, y: 6 }); t("by create", () => [r.norm(), r instanceof Point, r.sum, r.plus(p).x, p.plus(r).x]);
const h = L.fillByCreate(Point, { x: 5 }); t("half", () => [h.x, h.y, h.norm(), h.sum]);
`,
      "pick_omit_merge.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const s = state();
const pk = L.pick(s, "count", "name"); t("pick", () => [pk, pk.count + 1]);
const om = L.omit(s, "tags"); t("omit", () => [om, om.nested.n + 1, "tags" in om]);
const mg = L.merge(state(), { nested: { n: 9 }, extra: "e" }); t("merge", () => [mg, mg.nested.n + 1, mg.nested.on, mg.extra]);
const df = L.defaults({ a: 1 } as { a: number; b?: number }, { b: 2, a: 5 }); t("defaults", () => [df, df.a + df.b]);
const mv = L.mapValues({ a: 1, b: 2 }, (v) => v * 2); t("mapValues", () => [mv, mv.a + mv.b]);
const gb = L.groupBy([new Point(1, 1), new Point(2, 2), new Point(1, 5)], (p) => "x" + p.x); t("groupBy", () => [Object.keys(gb), gb["x1"]!.map((p) => p.norm())]);
const sb = L.sortBy([new Point(3, 0), new Point(1, 0)], (p) => p.x); t("sortBy", () => sb.map((p) => p.x));
`,
      "odd_objects_as_typed.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
function read(s: State): string { return s.name + (s.count + 1) + s.nested.n + s.tags.length; }
function write(s: State): number { s.count += 1; return s.count; }
for (const [n, f] of Object.entries({ nullProto: L.nullProto, sealed: L.sealed, proxied: L.proxied, withGetter: L.withGetter, freezeDeep: L.freezeDeep })) { const o = (f as (x: State) => State)(state()); t(n + " read", () => read(o)); t(n + " write", () => write(o)); t(n + " json", () => JSON.stringify(o)); t(n + " spread", () => ({ ...o }).count + 1); }
`,
      "wrappers_of_functions.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const sq = L.memoize((x: number): number => x * x); t("memoize", () => [sq(3), sq(3) + 1]);
let n = 0; const o = L.once((): number => ++n); t("once", () => [o(), o(), n]);
const p = new Point(1, 2); const nm = L.debounceNow(p.norm); t("this lost", () => nm()); t("this given", () => nm.call(p));
const pr = L.promisify((x: number, cb: (e: Error | null, v?: number) => void) => cb(null, x + 1)); await ta("promisify", async () => (await pr(1)) + 1);
const pe = L.promisify((x: number, cb: (e: Error | null, v?: number) => void) => cb(new RangeError("no"))); await ta("rejects", () => pe(1));
`,
      "bind_all_and_spy.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
class Svc { n: number = 1; inc(by: number): number { this.n += by; return this.n; } twice(): number { return this.inc(1) + this.inc(1); } }
t("methods", () => L.methodsOf(new Svc()));
t("bindAll", () => { const s = L.bindAll(new Svc()); const { inc } = s; return [inc(2), s.n]; });
t("spy", () => { const s = new Svc(); const calls = L.spy(s, "inc"); return [s.twice(), calls, s.n]; });
t("spy on the prototype", () => { const calls = L.spy(Svc.prototype, "inc"); const r = new Svc().twice(); return [r, calls]; });
`,
      "delegates.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const proto = L.delegate({ response: { status: 200, body: "b" } } as any, "response", ["status", "body"]);
const ctx = Object.create(proto); t("x", () => [ctx.status, ctx.body]); ctx.status = 404; t("set", () => [ctx.status, proto.response.status, Object.keys(ctx)]);
class Ctx { response: { status: number } = { status: 1 }; declare status: number; }
t("on a typed class", () => { L.delegate(Ctx.prototype, "response", ["status"]); const c = new Ctx(); c.status = 5; return [c.status, c.response.status]; });
`,
      "kinds_of_functions.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
function decl(a: number, b: number): number { return a + b; }
const arrow = (a: number): number => a; async function asy(): Promise<void> {} function* gen(): Generator<number> { yield 1; } async function* agen(): AsyncGenerator<number> { yield 1; } const aarrow = async (): Promise<void> => {};
class Sub extends Point { m(): void {} static s(): void {} }
const all: Record<string, Function> = { decl, arrow, asy, gen, agen, aarrow, Point, Sub, method: new Sub().m, stat: Sub.s, getter: Object.getOwnPropertyDescriptor(Point.prototype, "sum")!.get!, bound: decl.bind(null, 1), builtin: Math.max };
for (const [n, f] of Object.entries(all)) { t(n + " kind", () => L.kind(f)); t(n + " native", () => L.nativeKind(f)); t(n + " kin", () => L.sameKin(f)); t(n + " constructor", () => L.isConstructor(f)); }
`,
      "inspect.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const p = new Point(1, 2); class Sub extends Point { z: string = "z"; #hidden = 1; peek(): number { return this.#hidden; } }
t("point", () => L.inspect(p)); t("sub", () => L.inspect(new Sub(1, 2))); t("state", () => L.inspect(state())); t("array", () => L.inspect([p, new Sub()])); t("map", () => L.inspect(new Map([["k", p]]))); t("class", () => L.inspect(Point)); t("nested", () => L.inspect({ a: { b: { c: { d: { e: 1 } } } } }));
const cyc: { self?: unknown; n: number } = { n: 1 }; cyc.self = cyc; t("cycle", () => L.inspect(cyc));
console.log(p); console.log(new Sub(3, 4)); console.log(state()); console.log([p], { p }); console.log(Point, Sub, p.norm); console.log("%o %j %s", p, p, p);
t("Bun.inspect", () => Bun.inspect(p)); t("String", () => String(p)); t("tag", () => Object.prototype.toString.call(p));
`,
      "deep_equal.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const a = new Point(1, 2), b = new Point(1, 2);
t("x", () => [L.deepEqual(a, b), L.deepEqual(a, { x: 1, y: 2 }), L.deepEqual(state(), state()), L.deepEqual(a, L.cloneByPrototype(a)), L.deepEqual([a], [b]), Bun.deepEquals(a, b), Bun.deepEquals(a, { x: 1, y: 2 }), Bun.deepEquals(a, { x: 1, y: 2 }, true), Bun.deepEquals(state(), JSON.parse(JSON.stringify(state())), true)]);
`,
      "generated_code.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const add = L.compile(["a", "b"], "return a + b"); t("add", () => add(1, 2) + 1);
const p = new Point(1, 2); const rd = L.compile(["p"], "return p.x + p.norm() + p.sum"); t("reads typed", () => rd(p));
const wr = L.compile(["p"], "p.x = 10; p.extra = 1; return Object.keys(p).join()"); t("writes typed", () => [wr(p), p.x, p.norm()]);
const mk = L.compile(["P"], "return new P(3, 4)"); t("makes typed", () => { const q: Point = mk(Point); return [q.norm(), q instanceof Point, q.plus(p).x]; });
const tp = L.template("\${name}:\${count + 1}:\${nested.n}"); t("with", () => tp(state()));
const cb = L.compile(["f"], "return [f(1), f('2'), f()]"); t("calls typed", () => cb((x: number): number => x + 1));
`,
      "callable_builder.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const c = L.builder();
t("x", () => [c("plain"), c.bold("b"), c.bold.dim("bd"), c.dim.bold("db", "two"), typeof c.bold, c.bold === c.bold, Object.getPrototypeOf(c.bold) === Object.getPrototypeOf(c), c.bold.name, c.bold instanceof Function]);
`,
      "arguments_object.ts": `import * as L from "libs";
${ts}class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const a = L.argumentsOf(1, "two", { three: 3 });
t("x", () => [a.length, a[0], Object.prototype.toString.call(a), Array.isArray(a), Array.from(a), [...a], Object.keys(a), JSON.stringify(a), Array.prototype.slice.call(a, 1), typeof a[Symbol.iterator]]);
function mine(..._: unknown[]): IArguments { return arguments; }
const b = mine(1, 2); t("own", () => [b.length, Object.prototype.toString.call(b), Array.prototype.map.call(b, (x) => (x as number) * 2), L.inspect(b), Object.getOwnPropertyNames(b).sort()]);
`,
    },
  },
  {
    name: "wasm",
    files: {
      ...pkg("wasmy", {
        "index.js": `var wasm = null;
try { wasm = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,7,7,1,3,97,100,100,0,0,10,9,1,7,0,32,0,32,1,106,11])), {}).exports; } catch (e) { exports.why = e.name; }
exports.add = wasm ? wasm.add : function (a, b) { return (a + b) | 0; };
exports.native = !!wasm;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "sync.mjs": `import w from "wasmy";
${js}t("x", () => [w.native, w.why, w.add(2, 3), w.add(2147483647, 1)]);
`,
      "async.mjs": `${js}await ta("x", async () => { const { instance } = await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,7,7,1,3,97,100,100,0,0,10,9,1,7,0,32,0,32,1,106,11])); return [instance.exports.add(1, 2), WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,7,7,1,3,97,100,100,0,0,10,9,1,7,0,32,0,32,1,106,11]))]; });
`,
    },
  },
  {
    // zod 4's normalizeParams() deletes `message` from the options object that it is handed.
    name: "members-deleted-from-options",
    files: {
      ...pkg(
        "tinyparams",
        {
          "index.js": `function normalize(_params) {
  const params = _params;
  if (!params) return {};
  if (typeof params === "string") return { error: () => params };
  if (params.message !== undefined) {
    if (params.error !== undefined) throw new Error("Cannot specify both message and error params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string") return { ...params, error: () => params.error };
  return params;
}
function dropCount(value) { delete value.count; }
function dropByLiteralKey(value) { delete value["label"]; }
function reflectDrop(value) { Reflect.deleteProperty(value, "flag"); }
module.exports = { normalize, dropCount, dropByLiteralKey, reflectDrop };
`,
          "index.d.ts": `export function normalize(params?: string | { message?: string; abort?: boolean }): { error?: () => string; abort?: boolean };
export function dropCount(value: object): void;
export function dropByLiteralKey(value: object): void;
export function reflectDrop(value: object): void;
`,
        },
        { main: "index.js", types: "index.d.ts" },
      ),
    },
    importers: {
      "records.ts": `import { normalize, dropCount, dropByLiteralKey, reflectDrop } from "tinyparams";
${ts}type Options = { message: string; abort: boolean }
const shown = (r: { error?: () => string; abort?: boolean }) => Object.keys(r).join() + " " + r.error?.() + " " + r.abort
function made(message: string): Options { return { message, abort: true } }
const kept: Options = { message: "kept", abort: false }
t("a literal as the argument", () => shown(normalize({ message: "inline", abort: true })))
t("an annotated constant", () => shown(normalize(kept)))
t("what a typed helper returns", () => shown(normalize(made("helper"))))
t("a spread of a typed record", () => shown(normalize({ ...made("spread") })))
t("the keys afterwards", () => Object.keys(kept).join() + " " + ("message" in kept) + " " + JSON.stringify(kept))
t("stored again by typed code", () => { kept.message = "again"; return kept.message + " " + Object.keys(kept).join() })
type Counted = { count: number; name: string }
const counted: Counted = { count: 2.5, name: "n" }
t("a number", () => { const before = counted.count + 1; dropCount(counted); return before + " " + Object.keys(counted).join() + " " + ("count" in counted) + " " + counted.name })
t("a number, stored again", () => { counted.count = 4.5; return counted.count * 2 + " " + Object.keys(counted).join() })
type Labeled = { label: string; on: boolean }
const labeled: Labeled = { label: "l", on: true }
t("by a key that is a literal", () => { dropByLiteralKey(labeled); return Object.keys(labeled).join() + " " + labeled.on })
type Flagged = { flag: boolean; id: number }
const flagged: Flagged = { flag: true, id: 7 }
t("Reflect.deleteProperty", () => { reflectDrop(flagged); return Object.keys(flagged).join() + " " + flagged.id + " " + ("flag" in flagged) })
let total = 0
for (let i = 0; i < 1000; i++) { const o: Options = { message: "m" + i, abort: i % 2 === 0 }; total += o.message.length + (o.abort ? 1 : 0) }
t("objects that nobody deletes from", () => total)
`,
    },
  },
  {
    // What reducers, config mergers and form libraries do: they store a new plain object into a member of the state object that they are handed.
    name: "records-stored-into-members",
    files: {
      ...pkg(
        "tinyset",
        {
          "index.js": `exports.setInner = function (o, n) { o.inner = { n: n }; };
exports.pushItem = function (o, n) { o.items.push({ n: n }); };
exports.setList = function (o) { o.items = [{ n: 7 }, { n: 8 }]; };
`,
          "index.d.ts": `export function setInner(o: object, n: number): void;
export function pushItem(o: object, n: number): void;
export function setList(o: object): void;
`,
        },
        { main: "index.js", types: "index.d.ts" },
      ),
    },
    importers: {
      "records.ts": `import { setInner, pushItem, setList } from "tinyset";
${ts}const inferred = { id: 1, label: "l", inner: { n: 1.5 }, items: [{ n: 1 }] }
interface Inner { n: number }
interface State { id: number; label: string; inner: Inner; items: Inner[] }
const annotated: State = { id: 2, label: "a", inner: { n: 2.5 }, items: [{ n: 2 }] }
function made(): State { return { id: 3, label: "m", inner: { n: 3.5 }, items: [] } }
t("inferred, a record is stored", () => { setInner(inferred, 4.5); return inferred.inner.n + 1 })
t("annotated, a record is stored", () => { setInner(annotated, 5.5); return annotated.inner.n + 1 })
t("made by a helper", () => { const s = made(); setInner(s, 6.5); return s.inner.n + 1 })
t("inferred, pushed to its array", () => { pushItem(inferred, 9); return inferred.items.map(i => i.n).join() })
t("annotated, pushed to its array", () => { pushItem(annotated, 9); return annotated.items.map(i => i.n).join() })
t("inferred, its array replaced", () => { setList(inferred); return inferred.items.map(i => i.n).join() })
t("annotated, its array replaced", () => { setList(annotated); return annotated.items.map(i => i.n).join() })
t("the stored object is the same object", () => { const held: { n: number }[] = []; const keep = { id: 4, inner: { n: 0 } }; setInner(keep, 1.25); held.push(keep.inner); keep.inner.n = 2.25; return held[0].n + " " + (held[0] === keep.inner) + " " + JSON.stringify(keep) })
t("stored twice", () => { const twice = { inner: { n: 0 } }; setInner(twice, 1); const first = twice.inner; setInner(twice, 2); return first.n + " " + twice.inner.n + " " + (first === twice.inner) })
`,
    },
  },
];
