// Packages of JavaScript whose declaration files are wrong about the code they lie beside: about what a function is given, how many
// parameters it has, what a class is made of. Every function is called with every kind of value. The output must equal plain Bun's.
import { js, pkg, ts, type Case } from "./run-packages";

// The name of an export, the code, and what the declaration file says about it.
type Export = [name: string, code: string, declaration: string];

const groups: Record<string, Export[]> = {
  strings: [
    ["s_length", `function s_length(x) { return [typeof x, x.length]; }`, `function s_length(x: string): number`],
    ["s_index", `function s_index(x, y) { return x.indexOf(y); }`, `function s_index(x: string, y: string): number`],
    ["s_scan", `function s_scan(x) { let n = 0; for (let i = 0; i < x.length; i++) if (x[i] === "a" || x[i] === 1) n++; return n; }`, `function s_scan(x: string): number`],
    ["s_code", `function s_code(x) { return x.charCodeAt(0); }`, `function s_code(x: string): number`],
    ["s_concat", `function s_concat(x, y) { return x + y; }`, `function s_concat(x: string, y: string): string`],
    ["s_template", "function s_template(x) { return `<${x}>`; }", `function s_template(x: string): string`],
    ["s_equal", `function s_equal(x, y) { return [x === y, x == y, x < y, Object.is(x, y)]; }`, `function s_equal(x: string, y: string): boolean[]`],
    ["s_slice", `function s_slice(x) { return x.slice(1); }`, `function s_slice(x: string): string`],
    ["s_switch", `function s_switch(x) { switch (x) { case "a": return 1; case "1": return 2; case 1: return 3; default: return 0; } }`, `function s_switch(x: "a" | "b"): number`],
    ["s_key", `function s_key(x) { return { a: "at a", 1: "at 1", null: "at null", undefined: "at undefined" }[x]; }`, `function s_key(x: string): string`],
    ["s_truthy", `function s_truthy(x) { return x ? "yes" : "no"; }`, `function s_truthy(x: string): string`],
    ["s_typeof", `function s_typeof(x) { return typeof x === "string" ? "a string" : typeof x; }`, `function s_typeof(x: string): string`],
    ["s_spread", `function s_spread(x) { return [...x]; }`, `function s_spread(x: string): string[]`],
    ["s_stored", `function s_stored(x) { const held = { x }; held.x += "!"; return held; }`, `function s_stored(x: string): { x: string }`],
  ],
  numbers: [
    ["n_add", `function n_add(x, y) { return x + y; }`, `function n_add(x: number, y: number): number`],
    ["n_multiply", `function n_multiply(x, y) { const r = x * y; return [r, 1 / r]; }`, `function n_multiply(x: number, y: number): number[]`],
    ["n_bits", `function n_bits(x) { return [x | 0, x >>> 0, ~x, x << 1]; }`, `function n_bits(x: number): number[]`],
    ["n_compare", `function n_compare(x, y) { return [x < y, x <= y, x === y, x == y]; }`, `function n_compare(x: number, y: number): boolean[]`],
    ["n_index", `function n_index(x) { return ["zero", "one", "two"][x]; }`, `function n_index(x: number): string`],
    ["n_increment", `function n_increment(x) { x++; return x; }`, `function n_increment(x: number): number`],
    ["n_negate", `function n_negate(x) { return [-x, +x, 1 / -x]; }`, `function n_negate(x: number): number[]`],
    ["n_fixed", `function n_fixed(x) { return x.toFixed(1); }`, `function n_fixed(x: number): string`],
    ["n_math", `function n_math(x) { return [Math.floor(x), Math.abs(x), Math.max(x, 1)]; }`, `function n_math(x: number): number[]`],
    ["n_loop", `function n_loop(x) { let n = 0; for (let i = 0; i < x && i < 50; i++) n += i; return n; }`, `function n_loop(x: number): number`],
    ["n_literal", `function n_literal(x) { return x === 1 ? "one" : x === 2 ? "two" : "other"; }`, `function n_literal(x: 1 | 2): string`],
    ["b_not", `function b_not(x) { return [!x, x === true, x === false, x ? 1 : 2, x & 1]; }`, `function b_not(x: boolean): unknown[]`],
    ["b_true", `function b_true(x) { return x === true ? "true" : "not true"; }`, `function b_true(x: true): string`],
    ["big_add", `function big_add(x) { return x + 1n; }`, `function big_add(x: bigint): bigint`],
    ["sym_text", `function sym_text(x) { return x.description; }`, `function sym_text(x: symbol): string`],
    ["nil_only", `function nil_only(x, y) { return [x === null, y === undefined, x ?? "was nil", y ?? "was nil"]; }`, `function nil_only(x: null, y: undefined): unknown[]`],
  ],
  parameters: [
    ["p_fewer", `function p_fewer(a, b, c) { return [a, b, c, arguments.length]; }`, `function p_fewer(a: string): unknown[]`],
    ["p_more", `function p_more(a) { return [a, arguments.length, arguments[1]]; }`, `function p_more(a: string, b: number, c: boolean): unknown[]`],
    ["p_none", `function p_none(a) { return [typeof a, a]; }`, `function p_none(): unknown[]`],
    ["p_swapped", `function p_swapped(text, count) { return [text.length, count + 1]; }`, `function p_swapped(count: number, text: string): unknown[]`],
    ["p_optional", `function p_optional(a) { return a === undefined ? "none" : a.length; }`, `function p_optional(a?: string): unknown`],
    ["p_required", `function p_required(a) { return a === undefined ? "none" : a.length; }`, `function p_required(a: string): unknown`],
    ["p_default", `function p_default(a = 5, b = a + 1) { return [a, b]; }`, `function p_default(a: string, b: string): unknown[]`],
    ["p_rest_declared", `function p_rest_declared(a, b) { return [a, b]; }`, `function p_rest_declared(...all: string[]): unknown[]`],
    ["p_rest_written", `function p_rest_written(...all) { return [all.length, all, Array.isArray(all)]; }`, `function p_rest_written(all: string): unknown[]`],
    ["p_rest_behind", `function p_rest_behind(a, ...more) { return [a, more]; }`, `function p_rest_behind(a: number, more: number): unknown[]`],
    ["p_object_pattern", `function p_object_pattern({ a, b = "default" }) { return [a, b]; }`, `function p_object_pattern(o: { a: string; b: number }): unknown[]`],
    ["p_pattern_is_string", `function p_pattern_is_string({ length, a }) { return [length, a]; }`, `function p_pattern_is_string(o: number): unknown[]`],
    ["p_array_pattern", `function p_array_pattern([a, b]) { return [a, b]; }`, `function p_array_pattern(pair: [number, number]): unknown[]`],
    ["p_assigned", `function p_assigned(a) { const was = a; a = { now: "an object" }; return [was, a.now]; }`, `function p_assigned(a: string): unknown[]`],
    ["p_or_default", `function p_or_default(a) { a = a || {}; return typeof a; }`, `function p_or_default(a: string): string`],
    ["p_arguments", `function p_arguments(a) { arguments[0] = "written through arguments"; return a; }`, `function p_arguments(a: number): unknown`],
    ["p_captured", `function p_captured(a) { const read = () => a; a = [a]; return read(); }`, `function p_captured(a: string): unknown`],
    ["p_this", `function p_this(a) { return [this === undefined ? "no this" : typeof this, a]; }`, `function p_this(this: { k: number }, a: string): unknown[]`],
    ["p_same_name", `function p_same_name(a, b) { return [a, b]; }`, `function p_same_name(b: string, a: number): unknown[]`],
  ],
  signatures: [
    ["g_overloads", `function g_overloads(x, y) { return [typeof x, typeof y, x + y]; }`, `function g_overloads(x: string, y: string): unknown[];\nexport declare function g_overloads(x: number, y: number): unknown[]`],
    ["g_overload_lengths", `function g_overload_lengths(x, y) { return [x, y]; }`, `function g_overload_lengths(x: string): unknown[];\nexport declare function g_overload_lengths(x: string, y: number): unknown[]`],
    ["g_generic", `function g_generic(x) { return [x, typeof x]; }`, `function g_generic<T>(x: T): T[]`],
    ["g_constrained", `function g_constrained(x) { return x.length; }`, `function g_constrained<T extends string>(x: T): number`],
    ["g_keyof", `function g_keyof(o, k) { return o[k]; }`, `function g_keyof<T, K extends keyof T>(o: T, k: K): T[K]`],
    ["g_any", `function g_any(x) { return x.length; }`, `function g_any(x: any): any`],
    ["g_unknown", `function g_unknown(x) { return x.length; }`, `function g_unknown(x: unknown): unknown`],
    ["g_never", `function g_never(x) { return [typeof x, x]; }`, `function g_never(x: never): never`],
    ["g_void", `function g_void(x) { return [typeof x, x]; }`, `function g_void(x: void): void`],
    ["g_union", `function g_union(x) { return typeof x === "string" ? x.length : x + 1; }`, `function g_union(x: string | number): number`],
    ["g_conditional", `function g_conditional(x) { return x.length; }`, `function g_conditional<T>(x: T extends string ? string : number): number`],
    ["g_const_arrow", `(x) => x.length`, `const g_const_arrow: (x: string) => number`],
    ["g_const_is_function", `function g_const_is_function(x) { return x.length; }`, `const g_const_is_function: number`],
    ["g_function_is_const", `"not a function"`, `function g_function_is_const(x: string): number`],
    ["g_function_is_class", `class g_function_is_class { constructor(x) { this.x = x; } }`, `function g_function_is_class(x: string): number`],
    ["g_interface_call", `function g_interface_call(x) { return x.length; }`, `const g_interface_call: { (x: string): number; (x: number): string; extra: number }`],
    ["g_async", `async function g_async(x) { return x.length; }`, `function g_async(x: string): number`],
    ["g_generator", `function* g_generator(x) { yield x.length; yield x; }`, `function g_generator(x: string): number`],
    ["g_result", `function g_result(x) { return x; }`, `function g_result(x: string): number`],
    ["g_inner_caller", `function g_inner_caller(x) { return g_result(x) + g_result(1); }`, `function g_inner_caller(x: number): number`],
  ],
  objects: [
    ["o_fields", `function o_fields(o) { return [o.a, o.b]; }`, `function o_fields(o: { a: number; b: string }): unknown[]`],
    ["o_named", `function o_named(o) { return [o.a, o.b, "a" in Object(o)]; }`, `function o_named(o: Named): unknown[]`],
    ["o_write", `function o_write(o) { o.a = "written"; o.fresh = 1; return Object.keys(o); }`, `function o_write(o: Named): string[]`],
    ["o_delete", `function o_delete(o) { delete o.a; return [o.a, Object.keys(o)]; }`, `function o_delete(o: Named): unknown[]`],
    ["o_method", `function o_method(o) { return o.m(1); }`, `function o_method(o: { m(x: number): number }): number`],
    ["o_nested", `function o_nested(o) { return o.inner.a; }`, `function o_nested(o: { inner: Named }): number`],
    ["o_array", `function o_array(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return [sum, list.length]; }`, `function o_array(list: number[]): unknown[]`],
    ["o_array_methods", `function o_array_methods(list) { return list.map((x) => x + 1); }`, `function o_array_methods(list: number[]): number[]`],
    ["o_array_push", `function o_array_push(list) { list.push("pushed"); return list.length; }`, `function o_array_push(list: number[]): number`],
    ["o_for_of", `function o_for_of(list) { const seen = []; for (const x of list) seen.push(x); return seen; }`, `function o_for_of(list: string[]): string[]`],
    ["o_tuple", `function o_tuple(pair) { return [pair[0], pair[1], pair.length]; }`, `function o_tuple(pair: [number, string]): unknown[]`],
    ["o_callback", `function o_callback(f) { return f(1, 2); }`, `function o_callback(f: (x: number) => string): string`],
    ["o_map", `function o_map(m) { return [m.get("a"), m.size, m.has("a")]; }`, `function o_map(m: Map<string, number>): unknown[]`],
    ["o_set", `function o_set(s) { return [s.has(1), s.size]; }`, `function o_set(s: Set<number>): unknown[]`],
    ["o_date", `function o_date(d) { return d.getTime(); }`, `function o_date(d: Date): number`],
    ["o_regexp", `function o_regexp(r) { return r.test("a"); }`, `function o_regexp(r: RegExp): boolean`],
    ["o_promise", `function o_promise(p) { return typeof p.then; }`, `function o_promise(p: Promise<number>): string`],
    ["o_url", `function o_url(u) { return [u.pathname, u.href]; }`, `function o_url(u: URL): string[]`],
    ["o_request", `function o_request(r) { return [r.url, r.method]; }`, `function o_request(r: Request): string[]`],
    ["o_bytes", `function o_bytes(b) { return [b[0], b.length, b.byteLength]; }`, `function o_bytes(b: Uint8Array): unknown[]`],
    ["o_record", `function o_record(r) { return [r.a, r["b"], Object.keys(r)]; }`, `function o_record(r: Record<string, number>): unknown[]`],
    ["o_object", `function o_object(o) { return Object.keys(o); }`, `function o_object(o: object): string[]`],
  ],
  classes: [
    [
      "Point",
      `class Point { constructor(x, y) { this.y = y; this.x = x; } sum(k) { return this.x + this.y + k; } static of(x) { return new Point(x, x); } get first() { return this.x; } set first(v) { this.x = v; } }`,
      `class Point { x: number; y: number; z: string; constructor(x: number, y: number); sum(k: number): number; gone(): void; static of(x: number): Point; get first(): number; set first(v: number) }`,
    ],
    [
      "Old",
      `function Old(a) { if (!(this instanceof Old)) return new Old(a); this.a = a; }\nOld.prototype.twice = function (k) { return [this.a, this.a, k.length]; };\nOld.make = function (a) { return new Old(a); }`,
      `class Old { a: string; constructor(a: string); twice(k: string): unknown[]; static make(a: string): Old }`,
    ],
    ["Factory", `class Factory { constructor(kind) { if (kind === "other") return { made: "another object" }; this.kind = kind; } who() { return this.kind; } }`, `class Factory { kind: number; constructor(kind: number); who(): number }`],
    ["Late", `class Late { constructor(n) { if (n > 1) this.big = true; this.n = n; } grow(name) { this[name] = name; return Object.keys(this); } }`, `class Late { n: string; big: string; constructor(n: string); grow(name: number): string[] }`],
    ["Sub", `class Sub extends Point { constructor(x) { super(x, "y of Sub"); this.extra = x; } sum(k) { return "Sub:" + super.sum(k); } }`, `class Sub { extra: string; constructor(x: string); sum(k: string): number }`],
    ["Generic", `class Generic { constructor(held) { this.held = held; } get() { return this.held; } put(held) { this.held = held; return this; } }`, `class Generic<T extends string> { held: T; constructor(held: T); get(): T; put(held: T): this }`],
    ["Private", `class Private { #held; constructor(held) { this.#held = held; } #twice(k) { return [this.#held, k]; } twice(k) { return this.#twice(k); } static is(o) { return #held in o; } }`, `class Private { #private; constructor(held: number); twice(k: number): number[]; static is(o: Private): boolean }`],
    ["takes_point", `function takes_point(p) { return [p.x, p.y, typeof p.sum === "function" ? p.sum(1) : "no sum", p instanceof Point]; }`, `function takes_point(p: Point): unknown[]`],
    ["takes_old", `function takes_old(o) { return [o.a, o instanceof Old]; }`, `function takes_old(o: Old): unknown[]`],
    ["takes_other_class", `function takes_other_class(p) { return [p.x, p.a, p.kind]; }`, `function takes_other_class(p: Factory): unknown[]`],
    ["writes_point", `function writes_point(p) { p.x = "written"; p.w = 1; return Object.keys(p); }`, `function writes_point(p: Point): string[]`],
    ["makes_point", `function makes_point(x) { return x === 1 ? new Point(1, 2) : x === 2 ? { x: "plain", y: 0 } : null; }`, `function makes_point(x: number): Point`],
    ["reads_made", `function reads_made(x) { const p = makes_point(x); return p && [p.x, p.y]; }`, `function reads_made(x: number): number[]`],
  ],
};

const shared = `export interface Named { a: number; b: string }\n`;

const values = `const values = () => [
  "a", "", "abc", "1", 0, 1, -1, 2, 1.5, -0, NaN, Infinity, 2 ** 31, 2 ** 53, true, false, null, undefined, 10n, Symbol("s"),
  {}, { a: 1, b: "b" }, { b: "b", a: 1 }, { a: "1", b: 2, c: 3 }, { length: 2, 0: "a", 1: 1 }, { get a() { return "from a getter"; }, b: 0 }, Object.create({ a: "inherited", b: "inherited" }), Object.create(null),
  { x: 1, y: 2 }, { y: 2, x: 1 }, { m(x) { return [x, this === undefined]; }, inner: { a: "inner a" }, then: 1, size: "size", get: () => "got", has: () => "had" },
  [], [1, 2], ["a", 1], [1, , 3], [1.5, "x", null], new Array(3), Object.freeze([1, 2]), new Uint8Array([1, 2]), new Float64Array([1.5]),
  new String("ab"), new Number(3), new Boolean(false), Object(1n),
  Object.assign(function named(x, y) { return [x, y]; }, { toString: () => "text of named" }), Object.assign((x) => x, { toString: () => "text of an arrow" }), class C { static toString() { return "text of C"; } },
  new Map([["a", 1]]), new Set([1]), new Date(0), /a/, new URL("http://h/p?q"), new Request("http://h/r"), Promise.resolve(1), new Error("e"),
  new Proxy({}, { get: (t, k) => typeof k === "symbol" ? undefined : "proxied " + k, has: () => true }), new Proxy([1, 2], {}),
  { valueOf() { return 7; } }, { toString() { return "text of an object"; } }, { [Symbol.toPrimitive]() { return "primitive"; } },
];
`;

const describe = `const seen = (v, depth = 0) => {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "symbol" || v === undefined || v === null || typeof v === "boolean") return String(v);
  if (typeof v === "function") return "fn:" + v.name;
  if (depth > 3) return "..";
  if (Array.isArray(v)) return "[" + Array.from(v, (x) => seen(x, depth + 1)).join() + "]";
  let tag; try { tag = Object.prototype.toString.call(v).slice(8, -1); } catch { tag = "?"; }
  let names; try { names = Object.keys(v); } catch { names = []; }
  return tag + "{" + names.map((k) => { try { return k + ":" + seen(v[k], depth + 1); } catch (e) { return k + ":!" + e.name; } }).join() + "}";
};
const pending = [];
const attempt = (name, f) => {
  let said;
  try { const v = f(); if (v instanceof Promise) pending.push(v.then((x) => name + " later " + seen(x), (e) => name + " later THROWS " + (e && e.name))); said = seen(v); } catch (e) { said = "THROWS " + (e && e.name); }
  console.log(name, said);
};
`;

const isDeclaration = (code: string) => /^(async )?(function|class)\b/.test(code);

function codeOf(list: Export[], isModule: boolean) {
  return list
    .map(([name, code]) =>
      isDeclaration(code) ? (isModule ? `export ${code}\n` : `${code};\nexports.${name} = ${name};\n`) : isModule ? `export const ${name} = ${code};\n` : `exports.${name} = ${code};\n`,
    )
    .join("");
}

const declarationsOf = (list: Export[]) => shared + list.map(([, , declaration]) => `export declare ${declaration};\n`).join("");

// Every function with every value, then with every value behind a fitting first argument, with none and with too many.
const callsOf = (list: Export[]) =>
  list
    .filter(([name]) => /^[a-z]/.test(name))
    .map(
      ([name]) => `{ const f = L.${name};
  values().forEach((v, i) => attempt("${name} " + i, () => f(v)));
  values().forEach((v, i) => attempt("${name} a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("${name} 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("${name} same " + i, () => f(v, v)));
  attempt("${name} none", () => f());
  attempt("${name} many", () => f("a", 1, true, null, {}));
  attempt("${name} call", () => f.call({ k: 1 }, "a"));
  attempt("${name} length", () => [f.length, f.name]);
}
`,
    )
    .join("");

const classCalls = `const made = () => [new L.Point(1, 2), new L.Point("x", null), L.Point.of(3), new L.Old("a"), L.Old("called"), L.Old.make(5), new L.Factory(1), new L.Factory("other"), new L.Late(1), new L.Late(2), new L.Sub(4),
  new L.Generic("g"), new L.Generic(7), new L.Private(1), Object.create(L.Point.prototype), Object.assign(Object.create(L.Point.prototype), { y: "late y", x: "late x" }), new (class Point { x = "another Point"; y = 0; })(),
  new (class extends L.Point { constructor() { super(8, 9); this.own = 1; } sum() { return "overridden"; } })()];
made().forEach((o, i) => attempt("made " + i, () => o));
for (const name of ["takes_point", "takes_old", "takes_other_class", "writes_point"]) made().forEach((o, i) => attempt(name + " made " + i, () => L[name](o)));
values().forEach((v, i) => {
  attempt("new Point " + i, () => new L.Point(v, v));
  attempt("sum " + i, () => new L.Point(1, 2).sum(v));
  attempt("sum of " + i, () => new L.Point(v, 1).sum(1));
  attempt("of " + i, () => L.Point.of(v));
  attempt("first " + i, () => { const p = new L.Point(1, 2); p.first = v; return [p.first, p]; });
  attempt("sum on " + i, () => L.Point.prototype.sum.call(v, 1));
  attempt("new Old " + i, () => new L.Old(v));
  attempt("twice " + i, () => new L.Old(v).twice(v));
  attempt("Factory " + i, () => [new L.Factory(v), new L.Factory(v).who?.()]);
  attempt("Late " + i, () => new L.Late(v));
  attempt("grow " + i, () => new L.Late(1).grow(v));
  attempt("Sub " + i, () => [new L.Sub(v), new L.Sub(v).sum(v)]);
  attempt("Generic " + i, () => new L.Generic(v).put(v).get());
  attempt("Private " + i, () => [new L.Private(v).twice(v), L.Private.is(v)]);
});
attempt("gone", () => new L.Point(1, 2).gone());
attempt("z", () => new L.Point(1, 2).z);
attempt("Point()", () => L.Point(1, 2));
`;

// Where a package keeps its code and its declarations.
const layouts: Record<string, (from: string, list: Export[]) => Record<string, string>> = {
  "beside-commonjs": (from, list) => pkg(from, { "index.js": codeOf(list, false), "index.d.ts": declarationsOf(list) }, { main: "index.js", types: "index.d.ts" }),
  "beside-module": (from, list) => pkg(from, { "index.js": codeOf(list, true), "index.d.ts": declarationsOf(list) }, { main: "index.js", types: "index.d.ts", type: "module" }),
  "beside-mjs": (from, list) =>
    pkg(from, { "dist/index.mjs": `export * from "./inner.mjs";\n`, "dist/index.d.ts": `export * from "./inner";\n`, "dist/inner.mjs": codeOf(list, true), "dist/inner.d.ts": declarationsOf(list) }, { exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs" } } }),
  "folder-of-declarations": (from, list) =>
    pkg(
      from,
      // Nothing imports the declarations of `inner.js`.
      { "dist/index.js": `export * from "./deep/inner.js";\n`, "dist/types/index.d.ts": `export {};\n`, "dist/deep/inner.js": codeOf(list, true), "dist/types/deep/inner.d.ts": declarationsOf(list) },
      { type: "module", exports: { ".": { types: "./dist/types/index.d.ts", import: "./dist/index.js" } } },
    ),
};

const head = (from: string, typed: boolean) => (typed ? `import * as M from "${from}";\nconst L: Record<string, any> = M;\n` : `import * as L from "${from}";\n`);
const untyped = (text: string) => `// @ts-nocheck\n${text}`;

export const cases: Case[] = [
  ...Object.entries(layouts).flatMap(([layout, files], at) =>
    Object.entries(groups).map(([group, list]): Case => {
      const from = `own_${group}_${at}`;
      const body = values + describe + (group === "classes" ? classCalls : "") + callsOf(list) + `for (const line of await Promise.all(pending)) console.log(line);\n`;
      return {
        name: `${group}-${layout}`,
        files: files(from, list),
        importers: { "from-javascript.js": head(from, false) + body, "from-typescript.ts": untyped(head(from, true) + body) },
      };
    }),
  ),
  {
    name: "a-declaration-file-that-is-no-module",
    files: pkg(
      "own_script",
      {
        "index.js": `export { inner } from "./inner.js";\n`,
        "index.d.ts": `export declare function inner(x: string): number;\n`,
        "inner.js": `export function inner(x) { return x.length; }\n`,
        "inner.d.ts": `declare function inner(x: number): string;\ndeclare const VERSION: number;\ninterface Array<T> { extra: string }\ninterface String { length: string }\ndeclare var process: number;\n`,
      },
      { main: "index.js", types: "index.d.ts", type: "module" },
    ),
    importers: { "main.ts": `import { inner } from "own_script";\n${ts}const VERSION = "mine";\nt("x", () => [inner("abc"), VERSION, [1].length, "ab".length + 1, typeof process.pid]);\n` },
  },
  {
    name: "a-declaration-file-that-does-not-parse",
    files: pkg(
      "own_broken",
      { "index.js": `export { inner } from "./inner.js";\n`, "index.d.ts": `export declare function inner(x: string): number;\n`, "inner.js": `export function inner(x) { return x.length; }\n`, "inner.d.ts": `export declare function inner(x: : ): {{{ ;\nclass\n` },
      { main: "index.js", types: "index.d.ts", type: "module" },
    ),
    importers: { "main.ts": `import { inner } from "own_broken";\n${ts}t("x", () => [inner("abc"), (inner as any)([1, 2]), (inner as any)({ length: "l" })]);\n` },
  },
  {
    name: "a-declaration-file-that-changes-the-globals",
    files: pkg(
      "own_global",
      {
        "index.js": `export { inner } from "./inner.js";\n`,
        "index.d.ts": `export declare function inner(x: string): number;\n`,
        "inner.js": `export function inner(x) { return x.length; }\n`,
        "inner.d.ts": `export declare function inner(x: string): number;\ndeclare global { interface Number { length: number } var added: string; }\ndeclare module "node:path" { export function join(x: number): number; }\n`,
      },
      { main: "index.js", types: "index.d.ts", type: "module" },
    ),
    importers: { "main.ts": `import { inner } from "own_global";\nimport { join } from "node:path";\n${ts}t("x", () => [inner("abc"), join("a", "b"), typeof (globalThis as any).added]);\n` },
  },
  {
    name: "declarations-that-export-otherwise",
    files: pkg(
      "own_exports",
      {
        "index.js": `export default function main(x) { return x.length; }\nexport function named(x) { return x + 1; }\nconst renamed = (x) => x.length;\nexport { renamed as other, renamed as "a string name" };\nexport * as space from "./space.js";\n`,
        "index.d.ts": `declare function main(x: number): string;\nexport = main;\n`,
        "space.js": `export function named(x) { return x.length; }\nexport default class { m(x) { return x.length; } }\n`,
        "space.d.ts": `export declare const named: { named(x: number): number };\ndeclare const value: number;\nexport default value;\n`,
      },
      { main: "index.js", types: "index.d.ts", type: "module" },
    ),
    importers: {
      "main.js": `import main, * as L from "own_exports";\n${js}t("x", () => [main("abc"), main([1]), L.named(1), L.named("1"), L.other("ab"), L.other([1]), L["a string name"]({ length: 5 }), L.space.named("abc"), L.space.named([1]), new L.space.default().m("ab"), new L.space.default().m([1])]);\n`,
    },
  },
  {
    name: "commonjs-that-exports-one-value",
    files: pkg(
      "own_equals",
      {
        "index.js": `function main(x) { return x.length; }\nmain.helper = function (x) { return x + 1; };\nmain.Inner = class { m(x) { return x.length; } };\nmodule.exports = main;\n`,
        "index.d.ts": `declare function main(x: number): number;\ndeclare namespace main { function helper(x: string): string; class Inner { m(x: number): number } }\nexport = main;\n`,
      },
      { main: "index.js", types: "index.d.ts" },
    ),
    importers: {
      "main.js": `const main = require("own_equals");\n${js}t("x", () => [main("abc"), main([1]), main.helper(1), main.helper("1"), new main.Inner().m("ab"), new main.Inner().m([1, 2, 3])]);\n`,
    },
  },
];
