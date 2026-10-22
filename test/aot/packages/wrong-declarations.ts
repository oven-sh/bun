// Declaration files that do not match the code, imported from TypeScript. The output must equal plain Bun's or be an error, never a different value.
import { pkg, ts, type Case } from "./run-packages";

// The name of an export, what the code exports, and what the declaration file says.
const exported: [string, string, string][] = [
  ["num_is_string", `"5"`, `const num_is_string: number`],
  ["num_is_undefined", `undefined`, `const num_is_undefined: number`],
  ["num_is_null", `null`, `const num_is_null: number`],
  ["str_is_number", `7`, `const str_is_number: string`],
  ["str_is_null", `null`, `const str_is_null: string`],
  ["bool_is_number", `0`, `const bool_is_number: boolean`],
  ["bool_is_string", `"false"`, `const bool_is_string: boolean`],
  ["big_is_number", `5`, `const big_is_number: bigint`],
  ["lit_five", `6`, `const lit_five: 5`],
  ["lit_version", `"2.0.0"`, `const lit_version: "1.0.0"`],
  ["lit_true", `false`, `const lit_true: true`],
  ["lit_mode", `"c"`, `const lit_mode: "a" | "b"`],
  ["levels", `{ low: 10, high: 20 }`, `const levels: { readonly low: 1; readonly high: 2 }`],
  ["tuple_const", `[3, 4]`, `const tuple_const: readonly [1, 2]`],
  ["ret_num", `function ret_num() { return "5"; }`, `function ret_num(): number`],
  ["ret_str_null", `function ret_str_null() { return null; }`, `function ret_str_null(): string`],
  ["ret_str_undefined", `function ret_str_undefined() {}`, `function ret_str_undefined(): string`],
  ["ret_obj_null", `function ret_obj_null() { return null; }`, `function ret_obj_null(): { a: number }`],
  ["ret_void_value", `function ret_void_value() { return 5; }`, `function ret_void_value(): void`],
  ["ret_never", `function ret_never() { return "came back"; }`, `function ret_never(): never`],
  ["ret_kind", `function ret_kind() { return 3; }`, `function ret_kind(): 1 | 2`],
  ["ret_obj_missing", `function ret_obj_missing() { return { a: 1 }; }`, `function ret_obj_missing(): { a: number; b: string }`],
  ["ret_obj_extra", `function ret_obj_extra() { return { z: 0, b: "b", a: 1, y: 2 }; }`, `function ret_obj_extra(): { a: number; b: string }`],
  ["ret_obj_wrong", `function ret_obj_wrong() { return { a: "1", b: 2 }; }`, `function ret_obj_wrong(): { a: number; b: string }`],
  ["ret_obj_getter", `function ret_obj_getter() { let n = 0; return { get a() { return ++n; }, b: "b" }; }`, `function ret_obj_getter(): { a: number; b: string }`],
  ["ret_obj_proto", `function ret_obj_proto() { return Object.create({ a: 1, b: "proto" }); }`, `function ret_obj_proto(): { a: number; b: string }`],
  ["ret_obj_proxy", `function ret_obj_proxy() { return new Proxy({}, { get: (t, k) => k === "a" ? 1 : "proxied" }); }`, `function ret_obj_proxy(): { a: number; b: string }`],
  ["ret_obj_frozen", `function ret_obj_frozen() { return Object.freeze({ a: 1, b: "b" }); }`, `function ret_obj_frozen(): { a: number; b: string }`],
  ["ret_arr_strings", `function ret_arr_strings() { return ["1", "2"]; }`, `function ret_arr_strings(): number[]`],
  ["ret_arr_holes", `function ret_arr_holes() { return [1, , 3]; }`, `function ret_arr_holes(): number[]`],
  ["ret_arr_mixed", `function ret_arr_mixed() { return [1, "2", null, undefined, { x: 1 }]; }`, `function ret_arr_mixed(): number[]`],
  ["ret_arr_like", `function ret_arr_like() { return { length: 2, 0: 1, 1: 2 }; }`, `function ret_arr_like(): number[]`],
  ["ret_arr_typed", `function ret_arr_typed() { return new Uint8Array([1, 2, 300]); }`, `function ret_arr_typed(): number[]`],
  ["ret_arr_sub", `function ret_arr_sub() { class L extends Array { sum() { return 1; } } return L.from([1, 2]); }`, `function ret_arr_sub(): number[]`],
  ["ret_arr_frozen", `function ret_arr_frozen() { return Object.freeze([1, 2]); }`, `function ret_arr_frozen(): number[]`],
  ["ret_arr_null", `function ret_arr_null() { return null; }`, `function ret_arr_null(): number[]`],
  ["ret_tuple_short", `function ret_tuple_short() { return [1]; }`, `function ret_tuple_short(): [number, string]`],
  ["ret_tuple_long", `function ret_tuple_long() { return [1, "s", true]; }`, `function ret_tuple_long(): [number, string]`],
  ["ret_promise_plain", `function ret_promise_plain() { return 5; }`, `function ret_promise_plain(): Promise<number>`],
  ["ret_promise_thenable", `function ret_promise_thenable() { return { then(r) { r("5"); } }; }`, `function ret_promise_thenable(): Promise<number>`],
  ["ret_promise_wrong", `function ret_promise_wrong() { return Promise.resolve("5"); }`, `function ret_promise_wrong(): Promise<number>`],
  ["ret_map_object", `function ret_map_object() { return { get: (k) => "object:" + k, size: 1 }; }`, `function ret_map_object(): Map<string, number>`],
  ["ret_map_wrong", `function ret_map_wrong() { return new Map([[1, "one"]]); }`, `function ret_map_wrong(): Map<string, number>`],
  ["ret_set_array", `function ret_set_array() { return [1, 2]; }`, `function ret_set_array(): Set<number>`],
  ["ret_date_string", `function ret_date_string() { return "2020-01-01"; }`, `function ret_date_string(): Date`],
  ["ret_iter", `function ret_iter() { let i = 0; return { [Symbol.iterator]() { return this; }, next() { return i < 2 ? { value: String(i++), done: false } : { value: undefined, done: true }; } }; }`, `function ret_iter(): Iterable<number>`],
  ["ret_record", `function ret_record() { return Object.assign(Object.create({ inherited: 9 }), { a: "1" }); }`, `function ret_record(): Record<string, number>`],
  ["ret_fn_wrong", `function ret_fn_wrong() { return (x) => String(x) + "!"; }`, `function ret_fn_wrong(): (x: number) => number`],
  ["ret_fn_not", `function ret_fn_not() { return 5; }`, `function ret_fn_not(): () => number`],
  ["over", `function over(x) { return typeof x === "string" ? 1 : "one"; }`, `function over(x: string): string;
export declare function over(x: number): number`],
  ["ident", `function ident(x) { return [x]; }`, `function ident<T>(x: T): T`],
  ["each", `function each(cb) { return [cb("1", "0"), cb(), cb(1, 2, 3)]; }`, `function each(cb: (x: number, i: number) => number): number[]`],
  ["each_this", `function each_this(cb) { return cb.call({ k: "this given" }, 1); }`, `function each_this(cb: (x: number) => unknown): unknown`],
  ["takes_obj", `function takes_obj(o) { o.a = "written by the package"; o.extra = 1; delete o.b; return o; }`, `function takes_obj(o: { a: number; b: string }): void`],
  ["takes_arr", `function takes_arr(a) { a.push("pushed"); a[5] = 1; a.length = 7; }`, `function takes_arr(a: readonly number[]): void`],
  ["keeps", `(() => { let kept; return { put(o) { kept = o; }, poke() { kept.n = "poked"; kept.list.push("poked"); } }; })()`, `const keeps: { put(o: { n: number; list: number[] }): void; poke(): void }`],
  ["is_string", `function is_string(x) { return true; }`, `function is_string(x: unknown): x is string`],
  ["assert_string", `function assert_string(x) {}`, `function assert_string(x: unknown): asserts x is string`],
  ["counter", `{ get v() { return (this._n = (this._n || 0) + 1); } }`, `const counter: { readonly v: number }`],
  ["opt", `{ }`, `const opt: { a: number; nested: { b: string } }`],
  ["E", `{ A: 1, B: 2, 1: "A", 2: "B" }`, `enum E { A, B }`],
  ["K", `function K(x) { if (!(this instanceof K)) return new K(x); this.x = String(x); }
K.prototype.m = function () { return "m" + this.x; };
K.s = function () { return "not a K"; };
Object.defineProperty(K.prototype, "acc", { get() { return "accessor"; } })`, `class K { constructor(x: number); x: number; acc: string; m(): string; static s(): K; gone(): void }`],
  ["Fac", `function Fac() { return { made: "by a factory" }; }`, `class Fac { made: string; own(): string }`],
  ["Arrow", `class Arrow { m = () => "own arrow"; n = 1; }`, `class Arrow { m(): string; n: string }`],
  ["NotAClass", `{ create() { return 1; } }`, `class NotAClass { }`],
  ["Err", `class Err { constructor(m) { this.message = m; } }`, `class Err extends Error { code: number }`],
];

// What a TypeScript program does with each export, which it imports as `V`.
const uses: Record<string, string> = {
  num_is_string: `t("+", () => V + 1);
t("*", () => V * 2);
t("typeof", () => typeof V);
t("===", () => V === 5);
t("<", () => V < 10);
t("tpl", () => \`\${V}\`);
t("|0", () => V | 0);
t("max", () => Math.max(V, 1));
const f = (x: number): number => x + 1;
t("f", () => f(V));
const a: number[] = [V];
t("arr", () => a[0]! + 1);
const o: { v: number } = { v: V };
t("field", () => o.v + 1);
let s = 0;
for (let i = 0;
i < 3;
i++) s += V;
t("loop", () => s);
t("toFixed", () => V.toFixed(1));
`,
  num_is_undefined: `t("+", () => V + 1);
t("typeof", () => typeof V);
t("=== undefined", () => V === undefined);
t("??", () => V ?? 9);
t("||", () => V || 9);
t("if", () => V ? "y" : "n");
const f = (x: number = 3): number => x + 1;
t("default", () => f(V));
t("isNaN", () => Number.isNaN(V + 0));
const o = { v: V };
t("json", () => JSON.stringify(o));
`,
  num_is_null: `t("+", () => V + 1);
t("typeof", () => typeof V);
t("=== null", () => V === null);
t("== null", () => V == null);
t("??", () => V ?? 9);
t("json", () => JSON.stringify({ v: V }));
`,
  str_is_number: `t("+", () => V + 1);
t("length", () => V.length);
t("typeof", () => typeof V);
t("===", () => V === "7");
t("tpl", () => \`\${V}!\`);
t("upper", () => V.toUpperCase());
t("switch", () => { switch (V) { case "7": return "string seven";
default: return "default";
} });
const m: Record<string, number> = { "7": 1 };
t("key", () => m[V]);
`,
  str_is_null: `t("=== null", () => V === null);
t("== null", () => V == null);
t("!V", () => !V);
t("??", () => V ?? "dflt");
t("||", () => V || "dflt");
t("?.", () => V?.length);
t("typeof", () => typeof V);
t("if", () => { if (V) return "truthy";
return "falsy";
});
t("length", () => V.length);
t("+", () => V + "x");
function g(s: string): string { return s === null ? "was null" : s === undefined ? "was undefined" : "a string";
} t("g", () => g(V));
`,
  bool_is_number: `t("if", () => V ? "y" : "n");
t("=== false", () => V === false);
t("=== true", () => V === true);
t("!", () => !V);
t("typeof", () => typeof V);
t("json", () => JSON.stringify([V]));
t("+", () => Number(V) + 1);
`,
  bool_is_string: `t("if", () => V ? "y" : "n");
t("=== false", () => V === false);
t("!", () => !V);
t("&&", () => V && "and");
t("json", () => JSON.stringify([V]));
`,
  big_is_number: `t("typeof", () => typeof V);
t("+", () => V + 1n);
t("===", () => V === 5n);
t("str", () => String(V));
`,
  lit_five: `t("v", () => V);
t("+", () => V + 1);
t("===", () => V === 5);
t("switch", () => { switch (V) { case 5: return "five";
} return "fell out";
});
const a: number[] = [V, V];
t("arr", () => a);
t("tpl", () => \`\${V}\`);
`,
  lit_version: `t("v", () => V);
t("===", () => V === "1.0.0");
t("len", () => V.length);
t("split", () => V.split(".")[0]);
t("tpl", () => \`v\${V}\`);
const o = { [V]: 1 };
t("key", () => Object.keys(o));
`,
  lit_true: `t("v", () => V);
t("if", () => V ? "y" : "n");
t("!", () => !V);
t("&&", () => V && "and");
t("if stmt", () => { if (!V) return "was false";
return "was true";
});
`,
  lit_mode: `t("v", () => V);
t("switch", () => { switch (V) { case "a": return "A";
case "b": return "B";
} return "fell out";
});
t("if", () => V === "a" ? "A" : "then it is b: " + V);
const table = { a: 1, b: 2 };
t("table", () => table[V]);
function never(x: never): string { return "never reached with " + x;
} t("exhaustive", () => V === "a" ? 1 : V === "b" ? 2 : never(V));
`,
  levels: `t("v", () => V);
t("low", () => V.low);
t("+", () => V.low + V.high);
t("===", () => V.low === 1);
const { low, high } = V;
t("destructured", () => [low, high]);
t("keys", () => Object.keys(V));
`,
  tuple_const: `t("v", () => V);
t("0", () => V[0]);
t("+", () => V[0] + V[1]);
const [a, b] = V;
t("destructured", () => [a, b]);
t("len", () => V.length);
`,
  ret_num: `t("+", () => V() + 1);
const n: number = V();
t("n", () => n * 2);
t("typeof", () => typeof n);
const a: number[] = [];
a.push(V());
t("arr", () => a);
let s = 0;
for (let i = 0;
i < 3;
i++) s += V();
t("loop", () => s);
`,
  ret_str_null: `const s: string = V();
t("=== null", () => s === null);
t("== null", () => s == null);
t("??", () => s ?? "dflt");
t("||", () => s || "dflt");
t("?.", () => s?.length);
t("!s", () => !s);
t("typeof", () => typeof s);
t("length", () => s.length);
t("inline ??", () => V() ?? "dflt");
t("if", () => { if (s !== null && s !== undefined) return "has it";
return "has none";
});
`,
  ret_str_undefined: `const s: string = V();
t("=== undefined", () => s === undefined);
t("typeof", () => typeof s === "undefined");
t("??", () => s ?? "dflt");
t("?.", () => s?.length);
t("tpl", () => \`\${s}\`);
function d(x: string = "default used"): string { return x;
} t("default", () => d(V()));
`,
  ret_obj_null: `const o = V();
t("=== null", () => o === null);
t("?.", () => o?.a);
t("!o", () => !o);
t("&&", () => o && o.a);
t("a", () => o.a);
t("typeof", () => typeof o);
`,
  ret_void_value: `const v = V();
t("v", () => v);
t("typeof", () => typeof v);
t("=== undefined", () => v === undefined);
t("inline", () => V());
`,
  ret_never: `t("x", () => { const r: string = V();
return "after never: " + r;
});
t("y", () => { V();
return "went on";
});
function f(x: number): number { if (x > 0) return x;
V();
return -1;
} t("z", () => f(0));
`,
  ret_kind: `t("switch", () => { const k = V();
switch (k) { case 1: return "one";
case 2: return "two";
} return "fell out with " + k;
});
t("if", () => V() === 1 ? "one" : "then two");
const names = ["zero", "one", "two", "three"];
t("index", () => names[V()]);
`,
  ret_obj_missing: `const o = V();
t("b", () => o.b);
t("b.length", () => o.b.length);
t("in", () => "b" in o);
t("json", () => JSON.stringify(o));
t("=== undefined", () => o.b === undefined);
t("??", () => o.b ?? "dflt");
const { a, b } = o;
t("destructured", () => [a, b]);
const c: { a: number;
b: string } = { ...o };
t("spread", () => c);
`,
  ret_obj_extra: `const o = V();
t("a", () => o.a + 1);
t("b", () => o.b + "!");
t("keys", () => Object.keys(o));
t("json", () => JSON.stringify(o));
const c = { ...o };
t("spread", () => Object.keys(c));
t("any", () => (o as any).z);
for (const k in o) console.log("in", k);
`,
  ret_obj_wrong: `const o = V();
t("a", () => o.a + 1);
t("b", () => o.b + "!");
t("b.length", () => o.b.length);
t("json", () => JSON.stringify(o));
const n: number = o.a;
t("n", () => n * 2);
function f(p: { a: number;
b: string }): string { return p.a + 1 + p.b;
} t("f", () => f(o));
`,
  ret_obj_getter: `const o = V();
t("a", () => [o.a, o.a, o.a]);
const c = { ...o };
t("spread", () => [c.a, c.a]);
function f(p: { a: number }): number { return p.a + p.a;
} t("f", () => f(o));
`,
  ret_obj_proto: `const o = V();
t("a", () => o.a + 1);
t("b", () => o.b);
t("keys", () => Object.keys(o));
t("json", () => JSON.stringify(o));
t("own", () => Object.hasOwn(o, "a"));
o.a = 5;
t("written", () => [o.a, Object.keys(o)]);
const c = { ...o };
t("spread", () => c);
`,
  ret_obj_proxy: `const o = V();
t("a", () => o.a + 1);
t("b", () => o.b);
t("keys", () => Object.keys(o));
function f(p: { a: number;
b: string }): string { return p.b + p.a;
} t("f", () => f(o));
`,
  ret_obj_frozen: `const o = V();
t("a", () => o.a + 1);
t("write", () => { o.a = 5;
return o.a;
});
t("frozen", () => Object.isFrozen(o));
`,
  ret_arr_strings: `const a = V();
t("0", () => a[0]! + 1);
t("map", () => a.map((x) => x + 1));
t("reduce", () => a.reduce((s, x) => s + x, 0));
let s = 0;
for (const x of a) s += x;
t("for of", () => s);
t("sort", () => a.slice().sort((x, y) => x - y));
t("includes", () => a.includes(1));
t("join", () => a.join());
t("max", () => Math.max(...a));
`,
  ret_arr_holes: `const a = V();
t("1", () => a[1]);
t("len", () => a.length);
t("map", () => a.map((x) => x + 1));
let n = 0;
a.forEach(() => n++);
t("forEach", () => n);
let s = 0;
for (const x of a) s += x;
t("for of", () => s);
t("in", () => 1 in a);
t("json", () => JSON.stringify(a));
let u = 0;
for (let i = 0;
i < a.length;
i++) u += a[i]!;
t("for", () => u);
`,
  ret_arr_mixed: `const a = V();
t("map", () => a.map((x) => typeof x));
t("sum", () => a.reduce((s, x) => s + x, 0));
t("filter", () => a.filter((x) => x > 0));
t("json", () => JSON.stringify(a));
for (const x of a) console.log("of", typeof x);
`,
  ret_arr_like: `const a = V();
t("len", () => a.length);
t("0", () => a[0]);
t("isArray", () => Array.isArray(a));
t("map", () => a.map((x) => x));
let s = 0;
for (let i = 0;
i < a.length;
i++) s += a[i]!;
t("for", () => s);
t("of", () => { let n = 0;
for (const x of a) n += x;
return n;
});
`,
  ret_arr_typed: `const a = V();
t("len", () => a.length);
t("2", () => a[2]);
t("isArray", () => Array.isArray(a));
t("map", () => a.map((x) => x * 200));
t("push", () => a.push(1));
t("write", () => { a[0] = 1000;
return a[0];
});
let s = 0;
for (const x of a) s += x;
t("of", () => s);
`,
  ret_arr_sub: `const a = V();
t("len", () => a.length);
t("map", () => a.map((x) => x + 1).constructor.name);
t("isArray", () => Array.isArray(a));
t("any", () => (a as any).sum());
t("concat", () => a.concat([3]).constructor.name);
`,
  ret_arr_frozen: `const a = V();
t("push", () => a.push(3));
t("write", () => { a[0] = 9;
return a[0];
});
t("len", () => a.length);
t("sort", () => a.sort());
`,
  ret_arr_null: `const a = V();
t("=== null", () => a === null);
t("?.", () => a?.length);
t("||", () => a || []);
t("len", () => a.length);
t("of", () => { for (const x of a) return x;
return "none";
});
`,
  ret_tuple_short: `const p = V();
t("1", () => p[1]);
const [a, b] = p;
t("destructured", () => [a, b]);
t("b.length", () => b.length);
t("len", () => p.length);
t("=== undefined", () => b === undefined);
`,
  ret_tuple_long: `const p = V();
t("len", () => p.length);
t("json", () => JSON.stringify(p));
const [a, b] = p;
t("destructured", () => [a + 1, b + "!"]);
t("spread", () => [...p]);
`,
  ret_promise_plain: `await ta("await", async () => (await V()) + 1);
t("then", () => typeof V().then);
await ta("all", async () => Promise.all([V(), V()]));
await ta("async fn", async () => { async function f(): Promise<number> { return V();
} return (await f()) + 1;
});
`,
  ret_promise_thenable: `await ta("await", async () => (await V()) + 1);
t("instanceof", () => V() instanceof Promise);
await ta("catch", async () => V().catch(() => 0));
`,
  ret_promise_wrong: `await ta("await", async () => (await V()) + 1);
await ta("then", async () => V().then((x) => x * 2));
await ta("typeof", async () => typeof (await V()));
`,
  ret_map_object: `const m = V();
t("get", () => m.get("a"));
t("size", () => m.size);
t("has", () => m.has("a"));
t("instanceof", () => m instanceof Map);
t("of", () => { for (const [k] of m) return k;
return "none";
});
`,
  ret_map_wrong: `const m = V();
t("get", () => m.get("1"));
t("any", () => m.get(1 as any));
t("entries", () => [...m]);
for (const [k, v] of m) console.log(typeof k, typeof v, v + 1);
`,
  ret_set_array: `const s = V();
t("has", () => s.has(1));
t("size", () => s.size);
t("of", () => [...s]);
t("instanceof", () => s instanceof Set);
`,
  ret_date_string: `const d = V();
t("typeof", () => typeof d);
t("getTime", () => d.getTime());
t("instanceof", () => d instanceof Date);
t("+", () => +d);
t("str", () => String(d));
`,
  ret_iter: `let s = 0;
for (const x of V()) s += x;
t("of", () => s);
t("spread", () => [...V()]);
t("from", () => Array.from(V(), (x) => x + 1));
const [a, b] = V();
t("destructured", () => [a, b]);
`,
  ret_record: `const r = V();
t("a", () => r["a"]! + 1);
t("inherited", () => r["inherited"]);
t("keys", () => Object.keys(r));
for (const k in r) console.log("in", k);
t("none", () => r["none"]);
t("values", () => Object.values(r).map((v) => v + 1));
`,
  ret_fn_wrong: `const f = V();
t("call", () => f(1) + 1);
const g: (x: number) => number = f;
t("map", () => [1, 2].map(g));
t("typeof", () => typeof f(1));
`,
  ret_fn_not: `const f = V();
t("typeof", () => typeof f);
t("call", () => f());
t("guarded", () => typeof f === "function" ? f() : "not a function");
`,
  over: `t("string", () => V("s") + "!");
t("number", () => V(1) + 1);
const s: string = V("s");
t("len", () => s.length);
const n: number = V(1);
t("n", () => n * 2);
`,
  ident: `t("number", () => V(1) + 1);
t("string", () => V("s").length);
const o = V({ a: 1 });
t("object", () => o.a);
t("isArray", () => Array.isArray(V(1)));
`,
  each: `t("x", () => V((x, i) => x + i));
t("typeof", () => V((x) => (typeof x).length));
t("arity", () => V(function (x: number, i: number): number { return arguments.length;
}));
function named(x: number, i: number): number { return x * 2 + i;
} t("named", () => V(named));
t("direct", () => named(1, 2));
`,
  each_this: `t("fn", () => V(function (this: any, x: number) { return [this && this.k, x];
}));
t("arrow", () => V((x) => x + 1));
class C { k = "C";
m(x: number) { return [this && (this as any).k, x];
} } t("method", () => V(new C().m));
`,
  takes_obj: `const o = { a: 1, b: "b" };
V(o);
t("a", () => o.a);
t("a+1", () => o.a + 1);
t("b", () => o.b);
t("keys", () => Object.keys(o));
t("json", () => JSON.stringify(o));
t("typeof", () => typeof o.a);
class P { a = 1;
b = "b";
sum() { return this.a + 1;
} } const p = new P();
V(p);
t("class", () => [p.a, p.sum(), p.b, Object.keys(p)]);
`,
  takes_arr: `const a = [1, 2, 3];
V(a);
t("len", () => a.length);
t("3", () => a[3]);
t("json", () => JSON.stringify(a));
t("sum", () => a.reduce((s, x) => s + x, 0));
let s = 0;
for (let i = 0;
i < a.length;
i++) s += a[i]!;
t("for", () => s);
`,
  keeps: `const o = { n: 1, list: [1, 2] };
V.put(o);
t("before", () => [o.n + 1, o.list.length]);
V.poke();
t("after", () => [o.n, o.n + 1, typeof o.n, o.list, o.list.length]);
let s = 0;
for (const x of o.list) s += x;
t("sum", () => s);
`,
  is_string: `const x: unknown = [5][0];
t("guard", () => V(x) ? x.length : "no");
t("upper", () => V(x) ? x.toUpperCase() : "no");
t("+", () => V(x) ? x + "1" : "no");
const y: string | number = [5, "s"][0]!;
t("union", () => V(y) ? y.length : y + 1);
`,
  assert_string: `const x: unknown = [5][0];
V(x);
t("length", () => x.length);
t("+", () => x + "1");
t("typeof", () => typeof x);
t("upper", () => x.toUpperCase());
`,
  counter: `t("v", () => [V.v, V.v, V.v]);
const f = (): number => V.v + V.v;
t("f", f);
let s = 0;
for (let i = 0;
i < 3;
i++) s += V.v;
t("loop", () => s);
`,
  opt: `t("a", () => V.a);
t("a+1", () => V.a + 1);
t("nested", () => V.nested);
t("nested?.b", () => V.nested?.b);
t("nested.b", () => V.nested.b);
t("in", () => "a" in V);
const { a = 7 } = V;
t("default", () => a);
`,
  E: `t("A", () => V.A);
t("B", () => V.B);
t("rev", () => V[0]);
t("rev1", () => V[1]);
t("===", () => V.A === 0);
const e: V = V.A;
t("switch", () => { switch (e) { case V.A: return "A";
case V.B: return "B";
} return "fell out";
});
t("keys", () => Object.keys(V));
`,
  K: `const k = new V(1);
t("x", () => k.x);
t("x+1", () => k.x + 1);
t("m", () => k.m());
t("acc", () => k.acc);
t("s", () => V.s());
t("instanceof", () => k instanceof V);
t("gone", () => k.gone());
t("typeof gone", () => typeof k.gone);
t("keys", () => Object.keys(k));
class L extends V { y = 2;
m(): string { return super.m() + "!";
} } const l = new L(3);
t("sub", () => [l.x, l.y, l.m(), l instanceof V, l instanceof L, Object.keys(l)]);
`,
  Fac: `const f = new V();
t("made", () => f.made);
t("instanceof", () => f instanceof V);
t("own", () => f.own());
class G extends V { extra = 1;
who(): string { return "G";
} } const g = new G();
t("sub", () => [g.made, g.extra, g instanceof G, typeof g.who]);
`,
  Arrow: `const a = new V();
t("m", () => a.m());
t("n", () => a.n);
t("n.length", () => a.n.length);
t("own", () => Object.keys(a));
class B extends V { m(): string { return "overridden";
} } t("sub", () => new B().m());
`,
  NotAClass: `t("new", () => new V());
t("typeof", () => typeof V);
t("instanceof", () => ({}) instanceof V);
t("extends", () => { class Z extends V {} return new Z();
});
`,
  Err: `const e = new V("msg");
t("message", () => e.message);
t("instanceof", () => e instanceof Error);
t("stack", () => typeof e.stack);
t("code", () => e.code);
t("throw", () => { try { throw e;
} catch (x) { return x instanceof V;
} });
class Mine extends V { more = 1;
} t("sub", () => { const m = new Mine("m");
return [m.message, m.more, m instanceof Error, m instanceof V];
});
`,
};

const isDeclaration = (code: string) => /^(function|class) /.test(code);
const commonjs = exported.map(([name, code]) => (isDeclaration(code) ? `${code};\nexports.${name} = ${name};\n` : `exports.${name} = ${code};\n`)).join("");
const esm = exported.map(([name, code]) => (isDeclaration(code) ? `export ${code}\n` : `export const ${name} = ${code};\n`)).join("");
const declarations =
  exported.map(([, , declaration]) => `export declare ${declaration};\n`).join("") +
  `export declare const not_there: number;
export declare function not_there_fn(): number;
export declare const enum CE { A = 10, B = 20 }
export interface Shape { a: number }
`;

const differs = "A value that does not match the declaration file is carried on with, as under plain Bun: nothing throws on a type. What the build reports: a type error of the importer itself, and an import from an ES module of a name that only the declaration file has, which `bun run` reports when the file is loaded.";

export const cases: Case[] = (
  [
    ["commonjs", "lie_c", commonjs, {}],
    ["esm", "lie_e", esm, { type: "module" }],
  ] as const
).map(([name, from, code, packageJson]) => ({
  name,
  // A name that only the declaration file has is a SyntaxError under `bun run` too.
  fails: true as const,
  differs,
  files: pkg(from, { "index.js": code, "index.d.ts": declarations }, { main: "index.js", types: "index.d.ts", ...packageJson }),
  importers: {
    ...Object.fromEntries(Object.entries(uses).map(([exportName, use]) => [`${exportName}.ts`, `import { ${exportName} as V } from "${from}";\n${ts}${use}`])),
    "ns_lits.ts": `import * as L from "${from}";\n${ts}t("x", () => [L.lit_five, L.lit_five + 1, L.lit_version, L.lit_true ? "y" : "n", L.lit_mode, L.levels.low, L.num_is_string + 1, L.str_is_null ?? "dflt", L.ret_num() + 1]);\n`,
    "not_there.ts": `import { not_there } from "${from}";\n${ts}t("v", () => not_there); t("+", () => not_there + 1); t("typeof", () => typeof not_there);\n`,
    "not_there_fn.ts": `import { not_there_fn } from "${from}";\n${ts}t("typeof", () => typeof not_there_fn); t("call", () => not_there_fn());\n`,
    "not_there_ns.ts": `import * as L from "${from}";\n${ts}t("v", () => L.not_there); t("call", () => L.not_there_fn()); t("in", () => "not_there" in L);\n`,
    "const_enum.ts": `import { CE } from "${from}";\n${ts}t("A", () => CE.A); t("B", () => CE.B + 1);\n`,
    "type_only.ts": `import { Shape, num_is_string } from "${from}";\nimport type { K } from "${from}";\n${ts}const s: Shape = { a: 1 }; let k: K | undefined; t("x", () => [s.a, k, typeof num_is_string]);\n`,
  },
}));
