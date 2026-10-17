// Every built-in, and every road through the program, that hands out an object which typed code has not made: held to a record type, then read,
// written and listed. `type Rec = { a: number; b: string }`.
//
// A type that data from outside is looked at as has no fixed layout in the whole program, so each road is a program of its own. What fits the type
// must answer as plain Bun does by every road. Of what does not fit, some roads assert nothing and others check where the object is held to the
// type: there the executable may throw a TypeError where plain Bun answers, and may give no other answer.
import { join } from "path";

/** T: the JSON text. L: a literal under `any`. N: the number of the shape. */
// prettier-ignore
export const roads: [string, string][] = [
  ["JSON.parse", "JSON.parse(T)"],
  ["JSON.parse with a reviver", "JSON.parse(T, (k, v) => v)"],
  ["structuredClone", "structuredClone(L)"],
  ["Response.json()", "await new Response(T).json()"],
  ["Request.json()", "await new Request(\"http://localhost/\", { method: \"POST\", body: T }).json()"],
  ["Blob.json()", "await new Blob([T]).json()"],
  ["Response.json(o).json()", "await Response.json(L).json()"],
  ["BunFile.json()", "await Bun.file(ROOT + \"/dN.json\").json()"],
  ["fetch of a data URL", "await (await fetch(\"data:application/json,\" + encodeURIComponent(T))).json()"],
  ["a JSON module, imported", "dN"],
  ["a JSON module, required", "require(\"./dN.json\")"],
  ["a JSON module by import()", "(await import(\"./dN.json\")).default"],
  ["a name without code", "ambient(N)"],
  ["a variable without code", "ambients[N]"],
  ["a stream to JSON", "await Bun.readableStreamToJSON(new Blob([T]).stream())"],
  ["Object.fromEntries", "Object.fromEntries(Object.entries(L))"],
  ["Object.assign onto {}", "Object.assign({}, L)"],
  ["Object.assign onto no prototype", "Object.assign(Object.create(null), L)"],
  ["Object.create with descriptors", "Object.create(Object.prototype, Object.getOwnPropertyDescriptors(L))"],
  ["v8.deserialize", "deserialize(serialize(L))"],
  ["Reflect.apply", "Reflect.apply(() => L, undefined, [])"],
  ["a message", "await new Promise<any>(resolve => { const c = new MessageChannel(); c.port1.onmessage = e => { c.port1.close(); resolve(e.data); }; c.port2.postMessage(L); })"],
  ["sqlite", "fromDatabase(T)"],
  ["a Map's value", "new Map<string, any>([[\"k\", L]]).get(\"k\")"],
  ["an element of a parsed array", "JSON.parse(\"[\" + T + \"]\")[0]"],
  ["a property of what is parsed", "JSON.parse('{\"in\":' + T + '}').in"],
  ["Array.from of what is parsed", "Array.from(JSON.parse(\"[\" + T + \"]\"))[0]"],
  ["a function of the program that yields any", "own(L)"],
  ["a literal under any", "L"],
  ["a proxy", "new Proxy(L, {})"],
  ["frozen", "Object.freeze(L)"],
  ["with a getter", "withGetter(L)"],
  ["an untyped file's function", "fromJavaScript(T)"],
  ["a message's data, read of the event", "(await new Promise<MessageEvent>(resolve => { const c = new MessageChannel(); c.port1.onmessage = e => { c.port1.close(); resolve(e); }; c.port2.postMessage(L); })).data"],
  ["a row of sqlite, straight", "database.query(sqlOf(T)).get(...valuesOf(T))"],
  ["rows of sqlite, the first", "database.query(sqlOf(T)).all(...valuesOf(T))[0]"],
  ["TOML", "Bun.TOML.parse(tomlOf(T))"],
  ["globalThis.JSON.parse", "globalThis.JSON.parse(T)"],
  ["JSON[\"parse\"]", "JSON[\"parse\"](T)"],
  ["parse taken out of JSON by a pattern", "(({ parse }) => parse(T))(JSON)"],
  ["JSON.parse kept in a variable", "kept(T)"],
  ["JSON.parse.call", "JSON.parse.call(JSON, T)"],
  ["Reflect.apply of JSON.parse", "Reflect.apply(JSON.parse, JSON, [T])"],
  ["JSON.parse in a callback of map", "[T].map(text => JSON.parse(text))[0]"],
  ["JSON.parse in a function of the program", "parsed(T)"],
  ["JSON.parse in a generic function", "parsedAs<Rec>(T)"],
  ["JSON.parse, then kept in a variable", "(() => { const v = JSON.parse(T); return v; })()"],
  ["JSON.parse, then kept in a field", "({ v: JSON.parse(T) }).v"],
  ["JSON.parse, then through Promise.resolve", "await Promise.resolve(JSON.parse(T))"],
  ["Response.json() by then", "await new Response(T).json().then(v => v)"],
  ["text() and JSON.parse", "JSON.parse(await new Response(T).text())"],
];
/** What these yield has a type of its own: TypeScript takes it for a Rec only by way of unknown. */
const typed = new Set(["Array.from of what is parsed", "JSON.parse in a generic function", "Object.fromEntries", "a JSON module by import()", "a JSON module, imported"]);
/** What these yield is unknown or an object: it takes a cast. */
const cast = new Set(["TOML", "a row of sqlite, straight", "rows of sqlite, the first"]);

export const shapes = {
  "fits": [{ a: 1, b: "x" }, { a: 1, b: "x", c: true }, { a: 1.5, b: "x" }],
  "does not fit": [{ b: "x" }, { a: 1, b: null }],
};
// prettier-ignore
const held: [string, string][] = [
  ["as Rec", "const r = (X) as Rec;"],
  ["as unknown as Rec", "const r = (X) as unknown as Rec;"],
  ["an annotated variable", "const r: Rec = X;"],
  ["an argument", "const r = taken(X);"],
  ["a result", "const r = await (async (): Promise<Rec> => X)();"],
];
// prettier-ignore
const uses: [string, string][] = [
  ["read a", "r.a"],
  ["a + 1", "r.a + 1"],
  ["as an index", "list[r.a]"],
  ["b.length", "r.b.length"],
  ["typeof both", "typeof r.a + typeof r.b"],
  ["store a", "((r.a = 5), r.a)"],
  ["a++", "(r.a++, r.a)"],
  ["keys", "Object.keys(r).join()"],
  ["JSON", "JSON.stringify(r)"],
  ["a spread", "JSON.stringify({ ...r })"],
  ["a pattern", "(({ a, b }: Rec) => [a, b])(r)"],
  ["for in", "(() => { const k: string[] = []; for (const n in r) k.push(n); return k.join(); })()"],
  ["in", "[\"a\" in r, \"c\" in r]"],
  ["handed on", "sum(r)"],
  ["beside the program's own", "[r, mine, r, mine].map(sum)"],
  ["in a loop", "(() => { let s = 0; for (let i = 0; i < 3; i++) s += r.a; return s; })()"],
  ["compared", "[r.a === 1, r.a < 2, r.b === \"x\"]"],
  ["in a template", "`${r.a}${r.b}`"],
  ["kept in an array of them", "(() => { const all: Rec[] = [mine]; all.push(r); return all.map(o => o.a); })()"],
  ["kept in a field", "(() => { const h: { r: Rec } = { r: mine }; h.r = r; return h.r.a; })()"],
];

const untyped = `export function fromJavaScript(text) { return JSON.parse(text); }
export function prepare() { globalThis.ambients = globalThis.texts.map(text => JSON.parse(text)); }
export function sqlOf(text) { return "select " + Object.keys(JSON.parse(text)).map(n => "? as " + n).join(", "); }
export function valuesOf(text) { return Object.values(JSON.parse(text)); }
export function tomlOf(text) { return Object.entries(JSON.parse(text)).filter(e => e[1] !== null).map(([k, v]) => k + " = " + JSON.stringify(v)).join("\\n"); }
export function rowOf(text) { const o = JSON.parse(text); return [Object.keys(o), Object.values(o)]; }
globalThis.ambient = n => JSON.parse(globalThis.texts[n]);
`;

export function program(road: string, expression: string, which: keyof typeof shapes): { file: string; text: string; files: Record<string, string> } {
  const objects = shapes[which];
  const texts = objects.map(object => JSON.stringify(object));
  const lines = [
    expression === "dN" ? objects.map((_, n) => `import d${n} from "./d${n}.json";`).join("\n") : "",
    `import { Database } from "bun:sqlite";
import { deserialize, serialize } from "node:v8";
import { fromJavaScript, prepare, rowOf, sqlOf, tomlOf, valuesOf } from "./untyped.js";
type Rec = { a: number; b: string };
declare function ambient(n: number): any;
declare const ambients: any[];
const texts: string[] = ${JSON.stringify(texts)};
(globalThis as any).texts = texts; prepare();
const list = [10, 20, 30];
const ROOT = process.cwd();
const mine: Rec = { a: 2, b: "mine" };
function sum(r: Rec): string { return r.a + r.b; }
function taken(r: Rec): Rec { return r; }
function own(o: any): any { return o; }
${/\bkept\b/.test(expression) ? "const kept = JSON.parse;" : ""}
${expression.includes("parsed(") ? "function parsed(text: string): any { return JSON.parse(text); }" : ""}
${expression.includes("parsedAs<") ? "function parsedAs<T>(text: string): T { return JSON.parse(text); }" : ""}
function withGetter(o: any): any { const made: any = {}; for (const k of Object.keys(o)) Object.defineProperty(made, k, { get: () => o[k], set: v => { o[k] = v; }, enumerable: true, configurable: true }); return made; }
const database = new Database(":memory:");
function fromDatabase(text: string): any { const [names, values] = rowOf(text); return database.query("select " + names.map((n: string) => "? as " + n).join(", ")).get(...values); }
const one = (x: unknown): string => x === undefined ? "<undefined>" : typeof x === "number" ? (x !== x ? "<NaN>" : String(x)) : typeof x === "string" ? JSON.stringify(x) : Array.isArray(x) ? "[" + x.map(one).join(", ") + "]" : x === null ? "<null>" : String(x);
const cells: [string, () => Promise<unknown>][] = [];
const say = async (label: string, f: () => Promise<unknown>): Promise<void> => { let r: string; try { r = one(await f()); } catch (e) { r = "THROWS " + (e as Error).constructor.name; } console.log(label + ": " + r); };`,
  ];
  let n = 0;
  objects.forEach((object, shape) => {
    const literal = "({ " + Object.entries(object).map(([key, value]) => key + ": " + JSON.stringify(value)).join(", ") + " } as any)";
    const yielded = expression.replaceAll("dN", "d" + shape).replace("ambient(N)", `ambient(${shape})`).replace("ambients[N]", `ambients[${shape}]`).replace(/\bT\b/g, `texts[${shape}]`).replace(/\bL\b/g, () => literal);
    for (const [how, statement] of held) {
      if (typed.has(road) && how !== "as unknown as Rec") continue;
      if (cast.has(road) && !how.startsWith("as ")) continue;
      for (const [use, read] of uses) {
        n++;
        lines.push(`async function f${n}(): Promise<unknown> { ${statement.replace("X", () => yielded)} return ${read}; } cells.push([${JSON.stringify(`${texts[shape]}, ${how}, ${use}`)}, f${n}]);`);
      }
    }
  });
  lines.push("for (const [label, f] of cells) await say(label, f);");
  return {
    file: "main.ts",
    text: lines.join("\n") + "\n",
    files: {
      ...Object.fromEntries(texts.map((text, n) => [`d${n}.json`, text + "\n"])),
      "untyped.js": untyped,
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, resolveJsonModule: true, allowJs: true, noEmit: true, typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")], types: ["bun-types"] } }) + "\n",
    },
  };
}
