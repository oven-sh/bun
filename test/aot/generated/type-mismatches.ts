// Values that do not fit: every kind of value goes, through `any`, into every kind of place that has a type, for every kind of type. Plain Bun takes
// them all. Under --aot some are refused with a TypeError: which, and in which words, is for the executable to say, and `bun run --aot` says the same.
//
// A program is one kind of place. A line is a cell: `<place> | <type> | <value>: ok <what is there>` or `..: THROWS <the error>`.
const types: [name: string, type: string, sound: string][] = [
  ["number", "number", "1"],
  ["string", "string", "\"s\""],
  ["boolean", "boolean", "true"],
  ["bigint", "bigint", "1n"],
  ["symbol", "symbol", "Symbol.iterator"],
  ["null", "null", "null"],
  ["undefined", "undefined", "undefined"],
  ["numberOrUndefined", "number | undefined", "1"],
  ["stringOrNull", "string | null", "null"],
  ["numberOrString", "number | string", "1"],
  ["letters", "\"a\" | \"b\"", "\"a\""],
  ["digits", "1 | 2", "1"],
  ["yes", "true", "true"],
  ["numbers", "number[]", "[1]"],
  ["strings", "string[]", "[\"s\"]"],
  ["pair", "[number, string]", "[1, \"s\"]"],
  ["readonlyNumbers", "readonly number[]", "[1]"],
  ["unknowns", "unknown[]", "[1]"],
  ["record", "{ a: number }", "{ a: 1 }"],
  ["optional", "{ a: number; b?: string }", "{ a: 1 }"],
  ["P", "P", "{ a: 1 }"],
  ["C", "C", "new C()"],
  ["D", "D", "new D()"],
  ["thunk", "() => number", "() => 1"],
  ["mapper", "(x: number) => string", "(x: number) => String(x)"],
  ["map", "Map<string, number>", "new Map<string, number>()"],
  ["set", "Set<number>", "new Set<number>()"],
  ["date", "Date", "new Date(0)"],
  ["regexp", "RegExp", "/x/"],
  ["promise", "Promise<number>", "Promise.resolve(1)"],
  ["dictionary", "Record<string, number>", "{ k: 1 }"],
  ["object", "object", "{}"],
  ["Function", "Function", "() => 1"],
  ["E", "E", "E.A"],
  ["S", "S", "S.X"],
  ["bytes", "Uint8Array", "new Uint8Array(1)"],
  ["COrNull", "C | null", "null"],
  ["error", "Error", "new Error(\"e\")"],
];

const values: [name: string, made: string][] = [
  ["5", "5"],
  ["1.5", "1.5"],
  ["NaN", "NaN"],
  ["minusZero", "-0"],
  ["big", "2 ** 40"],
  ["text", "\"text\""],
  ["a", "\"a\""],
  ["empty", "\"\""],
  ["true", "true"],
  ["false", "false"],
  ["null", "null"],
  ["undefined", "undefined"],
  ["10n", "10n"],
  ["aSymbol", "Symbol.asyncIterator"],
  ["{}", "({})"],
  ["{a:1}", "({ a: 1 })"],
  ["{a:\"x\"}", "({ a: \"x\" })"],
  ["{a:1,b:2}", "({ a: 1, b: 2 })"],
  ["{a:1,z:0}", "({ a: 1, z: 0 })"],
  ["{n:{a:1}}", "({ n: { a: 1 } })"],
  ["{n:{a:\"x\"}}", "({ n: { a: \"x\" } })"],
  ["{kind:\"a\",x:1}", "({ kind: \"a\", x: 1 })"],
  ["{kind:\"c\"}", "({ kind: \"c\" })"],
  ["{k:\"v\"}", "({ k: \"v\" })"],
  ["[]", "[]"],
  ["[1]", "[1]"],
  ["[\"x\"]", "[\"x\"]"],
  ["[1,\"x\"]", "[1, \"x\"]"],
  ["[1,,3]", "[1, , 3]"],
  ["newC", "new C()"],
  ["newD", "new D()"],
  ["newOther", "new Other()"],
  ["likeC", "({ c: 1, m() { return 1; } })"],
  ["arrow", "() => 1"],
  ["function", "function () { return 1; }"],
  ["class", "class {}"],
  ["theClassC", "C"],
  ["map", "new Map()"],
  ["set", "new Set()"],
  ["date", "new Date(0)"],
  ["regexp", "/x/"],
  ["promise", "Promise.resolve(1)"],
  ["thenable", "({ then(f: any) { f(1); } })"],
  ["StringObject", "new String(\"s\")"],
  ["NumberObject", "new Number(1)"],
  ["BooleanObject", "new Boolean(false)"],
  ["nullPrototype", "Object.assign(Object.create(null), { a: 1 })"],
  ["heir", "Object.create({ a: 1 })"],
  ["proxyOfRecord", "new Proxy({ a: 1 }, {})"],
  ["proxyOfArray", "new Proxy([1], {})"],
  ["proxyOfFunction", "new Proxy(() => 1, {})"],
  ["bytes", "new Uint8Array(2)"],
  ["floats", "new Float64Array(2)"],
  ["arguments", "args()"],
  ["frozen", "Object.freeze({ a: 1 })"],
  ["parsed", "JSON.parse('{\"a\":1}')"],
  ["parsedList", "JSON.parse(\"[1]\")"],
  ["getter", "({ get a() { return 1; } })"],
  ["getterOfText", "({ get a() { return \"x\"; } })"],
  ["error", "new Error(\"e\")"],
  ["typeError", "new TypeError(\"t\")"],
  ["subarray", "new (class extends Array {})()"],
  ["boundFunction", "(function () { return 1; }).bind(null)"],
  ["asyncFunction", "async () => 1"],
  ["generator", "(function* () { yield 1; })()"],
];

// N: the name of the type, T: the type, S: a value that fits.
const declared: Record<string, [declarations: string, call: string]> = {
  "parameter, typed caller": ["function f_N_(x: T_): unknown { return x; }", "f_N_(v)"],
  "parameter, untyped caller": ["function f_N_(x: T_): unknown { return x; }\nconst u_N_: any = f_N_;", "u_N_(v)"],
  "optional parameter, untyped caller": ["function f_N_(x?: T_): unknown { return x; }\nconst u_N_: any = f_N_;", "u_N_(v)"],
  "rest parameter, untyped caller": ["function f_N_(...xs: (T_)[]): unknown { return xs[0]; }\nconst u_N_: any = f_N_;", "u_N_(v)"],
  "arrow parameter, untyped caller": ["const f_N_ = (x: T_): unknown => x;\nconst u_N_: any = f_N_;", "u_N_(v)"],
  "method parameter, untyped caller": ["class K_N_ { m(x: T_): unknown { return x; } }\nconst u_N_: any = new K_N_();", "u_N_.m(v)"],
  "async parameter, untyped caller": ["async function f_N_(x: T_): Promise<unknown> { return [x]; }\nconst u_N_: any = f_N_;", "new Held(u_N_(v).then((got: unknown[]) => got[0]))"],
  "parameter, the function stands in an untyped object": ["function f_N_(x: T_): unknown { return x; }\nconst u_N_: any = { f_N_ };", "u_N_.f_N_(v)"],
  "optional parameter, the function stands in an untyped object": ["function f_N_(x?: T_): unknown { return x; }\nconst u_N_: any = { f_N_ };", "u_N_.f_N_(v)"],
  "arrow parameter, the function stands in an untyped object": ["const f_N_ = (x: T_): unknown => x;\nconst u_N_: any = { f_N_ };", "u_N_.f_N_(v)"],
  "async parameter, the function stands in an untyped object": ["async function f_N_(x: T_): Promise<unknown> { return [x]; }\nconst u_N_: any = { f_N_ };", "new Held(u_N_.f_N_(v).then((got: unknown[]) => got[0]))"],
  "parameter, the function stands in a record of functions": ["function f_N_(x: T_): unknown { return x; }\nconst u_N_: Record<string, (...given: any[]) => unknown> = { f_N_ };", "u_N_.f_N_!(v)"],
  "variable": ["function f_N_(v: any): unknown { const x: T_ = v; return x; }", "f_N_(v)"],
  "assignment": ["function f_N_(v: any): unknown { let x: T_ = S_; x = v; return x; }", "f_N_(v)"],
  "return": ["function f_N_(v: any): T_ { return v; }", "f_N_(v)"],
  "arrow return": ["const f_N_ = (v: any): T_ => v;", "f_N_(v)"],
  "field store": ["function f_N_(v: any): unknown { const o: { f: T_ } = { f: S_ }; o.f = v; return o.f; }", "f_N_(v)"],
  "field of a literal": ["function f_N_(v: any): unknown { const o: { f: T_ } = { f: v }; return o.f; }", "f_N_(v)"],
  "field of a class": ["class K_N_ { f: T_; constructor(v: any) { this.f = v; } }", "new K_N_(v).f"],
  "field store by untyped code": ["class K_N_ { f: T_ = S_; }\nfunction f_N_(v: any): unknown { const k = new K_N_(); const u: any = k; u.f = v; return k.f; }", "f_N_(v)"],
  "element store": ["function f_N_(v: any): unknown { const a: (T_)[] = [S_]; a[0] = v; return a[0]; }", "f_N_(v)"],
  "push": ["function f_N_(v: any): unknown { const a: (T_)[] = []; a.push(v); return a[0]; }", "f_N_(v)"],
  "element of a literal": ["function f_N_(v: any): unknown { const a: (T_)[] = [v]; return a[0]; }", "f_N_(v)"],
  "property of any": ["function f_N_(o: any): unknown { const x: T_ = o.p; return x; }", "f_N_({ p: v })"],
  "element of any": ["function f_N_(o: any): unknown { const x: T_ = o[0]; return x; }", "f_N_([v])"],
  "call of any": ["function f_N_(g: any): unknown { const x: T_ = g(); return x; }", "f_N_(() => v)"],
  "await of any": ["async function f_N_(v: any): Promise<unknown> { const x: T_ = await v; return [x]; }", "new Held(f_N_(Promise.resolve([v]).then(l => l[0])).then((got: any) => got[0]))"],
  "destructured property": ["function f_N_(o: any): unknown { const { p }: { p: T_ } = o; return p; }", "f_N_({ p: v })"],
  "destructured element": ["function f_N_(o: any): unknown { const [p]: (T_)[] = o; return p; }", "f_N_([v])"],
  "parameter of a callback": ["function f_N_(list: any[]): unknown { let got: unknown; list.forEach((x: T_) => { got = x; }); return got; }", "f_N_([v])"],
  "for of": ["function f_N_(list: any): unknown { for (const x of list as (T_)[]) return x; }", "f_N_([v])"],
  "element read": ["function f_N_(list: (T_)[]): unknown { return list[0]; }", "f_N_([v])"],
  "property read": ["function f_N_(o: { p: T_ }): unknown { return o.p; }", "f_N_({ p: v })"],
  "generic": ["function f_N_(v: any): unknown { const x = id<T_>(v); return x; }", "f_N_(v)"],
  "non-null": ["function f_N_(v: any): unknown { const x: T_ | null | undefined = v; return x!; }", "f_N_(v)"],
  "satisfies a predicate": ["function is_N_(v: unknown): v is T_ { return true; }\nfunction f_N_(v: unknown): unknown { if (is_N_(v)) { const x: T_ = v; return x; } }", "f_N_(v)"],
};

// Where `bun run --aot` takes what the executable refuses today.
const modeFailsToday: Record<string, string> = {
  "async parameter, untyped caller": "an object at the entry of a function that has no second body is taken where the type has a record or a class",
  "parameter of a callback": "an object at the entry of a function that has no second body is taken where the type has a record or a class",
  "parameter, the function stands in an untyped object": "an object at the entry of a function that has no second body is taken where the type has a record or a class",
  "optional parameter, the function stands in an untyped object": "an object at the entry of a function that has no second body is taken where the type has a record or a class",
  "arrow parameter, the function stands in an untyped object": "an object at the entry of a function that has no second body is taken where the type has a record or a class",
  "async parameter, the function stands in an untyped object": "an object at the entry of a function that has no second body is taken where the type has a record or a class",
  "parameter, the function stands in a record of functions": "an object at the entry of a function that has no second body is taken where the type has a record or a class",
  "destructured property": "a class that is closed and has a record among its members takes any object",
  "destructured element": "a class that is closed and has a record among its members takes any object",
  "for of": "a class that is closed and has a record among its members takes any object",
};
const alwaysRun = ["variable", "parameter, untyped caller", "field store"];
// `x!` of what can only be null or undefined is an error of the build.
const leftOut: Record<string, string[]> = { "non-null": ["null", "undefined"] };

const head = `declare const console: { log(...values: unknown[]): void };
class C { c = 1; m(): number { return this.c; } }
class D extends C { d = 2; }
class Other { o = 3; }
interface P { a: number }
enum E { A, B }
enum S { X = "x", Y = "y" }
function args(): unknown { return (function (..._: unknown[]) { return arguments; })(1, 2); }
function id<X>(x: X): X { return x; }
const values: [string, () => any][] = [
${values.map(([name, made]) => `  [${JSON.stringify(name)}, () => ${made}],`).join("\n")}
];
const tagOf = Object.prototype.toString;
function show(x: unknown): string {
  if (x === null) return "null";
  if (typeof x === "number") return "number " + (Object.is(x, -0) ? "-0" : String(x));
  if (typeof x === "string") return "string " + JSON.stringify(x);
  if (typeof x === "bigint") return "bigint " + String(x);
  if (typeof x === "symbol") return "symbol";
  if (typeof x === "function") return "function";
  if (typeof x !== "object") return String(x);
  return tagOf.call(x);
}
class Held { constructor(public promise: Promise<unknown>) {} }
async function wrap(f: () => unknown): Promise<[unknown]> { const got = f(); return [got instanceof Held ? await got.promise : got]; }
async function cell(name: string, f: () => unknown): Promise<void> {
  let text: string;
  try { text = "ok " + show((await wrap(f))[0]); } catch (e) { text = "THROWS " + (e instanceof Error ? e.name + " " + e.message.split(" (bun compile")[0].replaceAll(": ", " - ") : String(e)); }
  console.log(name + ": " + text);
}
`;

export const places = Object.keys(declared).map(place => ({ place, isAlwaysRun: alwaysRun.includes(place), modeFailsToday: modeFailsToday[place] }));

export function program(place: string) {
  const [declarations, call] = declared[place];
  const chosen = types.filter(([name]) => !leftOut[place]?.includes(name));
  const written = (text: string, [name, type, sound]: [string, string, string]) => text.replaceAll("N_", name).replaceAll("T_", type).replaceAll("S_", sound);
  const text =
    head +
    chosen.map(type => written(declarations, type)).join("\n") +
    "\nfor (const [name, make] of values) {\n" +
    chosen.map(type => `  { const v: any = make(); await cell(${JSON.stringify(`${place} | ${type[0]} | `)} + name, () => ${written(call, type)}); }`).join("\n") +
    "\n}\nexport {};\n";
  return { file: "main.ts", text, files: { "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true, "lib": ["ESNext"] } }` } };
}
