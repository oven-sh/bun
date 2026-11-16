// A fourth set (see native-callbacks-one-for-each-caller.ts): names put together at run time, ways to install a method, ways to get at a prototype object.
import { programsOf, type WrittenProgram } from "../generate";

/** By the path below the folder of programs. */
const filesWritten: Record<string, string> = {};

const ATTEMPT = "function attempt(run: () => unknown): void {\n  try {\n    run();\n  } catch {}\n}\n";
function write(name: string, head: string, imports: any[], prelude: string, rows: any[], definition: string, honest: string, tail = "console.log(bits.toString(2));", module = false) {
  let lines = ["// " + head];
  lines.push(...(imports.length > 0 ? imports : module ? ["export {};"] : []));
  lines.push(...["", "let bits = 0;", "", ATTEMPT.trimEnd(), ...(prelude ? [prelude.trimEnd()] : []), ""]);
  if (rows.length > 31) throw new Error(name);
  rows = rows.map(r => r.length === 2 ? [r[0], "", r[1]] : r);
  const fill = (text, n, k) => text.replaceAll("@N", n).replaceAll("@K", k).replaceAll("@A", k.startsWith("[") ? k : "." + k);
  for (const [i, [n, k, use]] of rows.entries()) {
    lines.push(fill(definition, n, k).replaceAll("@B", String(1 << i)));
  }
  lines.push("");
  for (const [i, [n, k, use]] of rows.entries()) {
    const h = fill(honest, n, k);
    lines.push((h ? h + "\n" : "") + `attempt(() => ${fill(use.replaceAll("$", `(new ${n}() as any)`), n, k).replaceAll("@B", String(1 << i))});`);
  }
  lines.push(tail);
  filesWritten[name + ".ts"] = lines.join("\n") + "\n";
}

write(
  "methods-under-names-put-together-at-run-time",
  "Methods found through instances: each function here is stored under a name or a symbol that is put together at run time, so nothing in the text says that it is the toJSON, the then or the custom inspect method which one native caller looks for. A bit is set for each function that got no number.",
  [], 'const glue = (...parts: string[]): string => parts.join("");\nconst holding = (key: string | symbol, value: unknown): any => {\n  const holder: any = {};\n  holder[key] = value;\n  return holder;\n};',
  [
    ["asToJSON", 'JSON.stringify(holding(glue("to", "JSON"), @N))'], ["asToString", 'String(holding(glue("to", "String"), @N))'], ["asValueOf", 'Number(holding(glue("value", "Of"), @N))'], ["asThen", 'Promise.resolve(holding(glue("th", "en"), @N))'],
    ["asInspect", 'console.log(holding(Symbol.for(glue("nodejs.util.", "inspect.custom")), @N))'], ["asBunInspect", 'Bun.inspect(holding(Symbol.for(glue("nodejs.util.", "inspect.custom")), @N))'], ["asHandleEvent", '{ const target = new EventTarget(); target.addEventListener("e", holding(glue("handle", "Event"), @N)); target.dispatchEvent(new Event("e")); }'],
    ["asNext", 'Array.from({ [Symbol.iterator]: () => holding(glue("ne", "xt"), @N) } as any)'], ["asGetTrap", '(new Proxy({}, holding(glue("g", "et"), @N)) as any).x'], ["asStart", 'new ReadableStream(holding(glue("st", "art"), @N))'], ["asGetter", '(Object.defineProperty({}, "k", holding(glue("g", "et"), @N)) as any).k'],
    ["asIterator", '[...holding((Symbol as any)[glue("iter", "ator")], @N)]'], ["asToPrimitive", '`${holding((Symbol as any)[glue("to", "Primitive")], @N)}`'], ["asExec", 'RegExp.prototype.test.call(holding(glue("ex", "ec"), @N), "a")'],
    ["asToISOString", 'Date.prototype.toJSON.call(holding(glue("toISO", "String"), @N))'], ["asWrite", 'new WritableStream(holding(glue("wri", "te"), @N)).getWriter().write("c")'], ["asJoin", 'Array.prototype.toString.call(holding(glue("jo", "in"), @N))'],
    ["asResolve", '(Promise.all as any).call(Object.assign(function (this: any, executor: any) { executor(() => 0, () => 0); }, holding(glue("res", "olve"), @N)), ["s"])'],
  ],
  'function @N(value: number): any { if (typeof value !== "number") bits |= @B; return "."; }',
  "@N(1);", "setTimeout(() => console.log(bits.toString(2)), 5);",
);

write(
  "methods-one-to-json-for-each-way-to-install-it",
  "Methods found through instances: each function here becomes the toJSON of an object in another way, most of them by native code, and JSON.stringify then calls it with the key, a string, while the program calls it with a number. A bit is set for each function that saw the string.",
  [], "",
  [
    ["byLiteral", "JSON.stringify({ toJSON: @N })"], ["byStore", "{ const holder: any = {}; holder.toJSON = @N; return JSON.stringify(holder); }"], ["byAssign", "JSON.stringify(Object.assign({}, { toJSON: @N }))"], ["byDefine", 'JSON.stringify(Object.defineProperty({}, "toJSON", { value: @N }))'],
    ["byDefineGetter", 'JSON.stringify(Object.defineProperty({}, "toJSON", { get: () => @N }))'], ["byDefineMany", "JSON.stringify(Object.defineProperties({}, { toJSON: { value: @N } }))"], ["byFromEntries", 'JSON.stringify(Object.fromEntries([["toJSON", @N]]))'],
    ["byCreate", "JSON.stringify(Object.create({ toJSON: @N }))"], ["byCreateWith", "JSON.stringify(Object.create(null, { toJSON: { value: @N } }))"], ["byReflectSet", '{ const holder = {}; Reflect.set(holder, "toJSON", @N); return JSON.stringify(holder); }'],
    ["bySetPrototype", "JSON.stringify(Object.setPrototypeOf({}, { toJSON: @N }))"], ["byDunderProto", "JSON.stringify({ __proto__: { toJSON: @N } })"], ["byProxy", "JSON.stringify(new Proxy({}, { get: () => @N }))"], ["bySpread", "JSON.stringify({ ...{ toJSON: @N } })"],
    ["byEntriesLoop", "{ const holder: any = {}; for (const [key, value] of Object.entries({ toJSON: @N })) holder[key] = value; return JSON.stringify(holder); }"], ["byClassField", "JSON.stringify(new (class { toJSON = @N; })())"],
    ["byPrototypeStore", "{ class Holder {} (Holder.prototype as any).toJSON = @N; return JSON.stringify(new Holder()); }"], ["byPrototypeAssign", "{ class Holder {} Object.assign(Holder.prototype, { toJSON: @N }); return JSON.stringify(new Holder()); }"],
    ["byBound", "JSON.stringify({ toJSON: @N.bind(null) })"], ["byMapValue", 'JSON.stringify({ toJSON: new Map([["f", @N]]).get("f") })'], ["byReflectDefine", '{ const holder = {}; Reflect.defineProperty(holder, "toJSON", { value: @N }); return JSON.stringify(holder); }'],
    ["byStaticBlock", "JSON.stringify(new (class Holder { static { (Holder.prototype as any).toJSON = @N; } })())"], ["byArrayProperty", "JSON.stringify(Object.assign([1], { toJSON: @N }))"], ["byFunctionProperty", "JSON.stringify({ k: Object.assign(() => 0, { toJSON: @N }) })"],
  ],
  'function @N(scale: number): number { if (typeof scale !== "number") bits |= @B; return 0; }',
  "@N(1);",
);

write(
  "created-one-class-for-each-way-to-reach-its-prototype-object",
  "Held from creation: the prototype object of each class here is handed to nobody; one native function answers with it, and the program stores another method into what it got. A bit is set where a later call on a typed instance finds the new method.",
  [], 'const patch = (prototype: any): void => {\n  prototype.m = () => "patched";\n};',
  [
    ["ByGetPrototypeOf", "patch(Object.getPrototypeOf(new @N()))"], ["ByReflect", "patch(Reflect.getPrototypeOf(new @N()))"], ["ByDunderProto", "patch((new @N() as any).__proto__)"], ["ByDunderGetter", 'patch(Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!.get!.call(new @N()))'],
    ["ByReflectGet", 'patch(Reflect.get(@N, "prototype"))'], ["ByDescriptor", 'patch(Object.getOwnPropertyDescriptor(@N, "prototype")!.value)'], ["ByConstructor", 'patch(Reflect.get(new @N(), "constructor").prototype)'], ["ByValues", "patch((Object.values({ @N }) as any)[0].prototype)"],
    ["ByAt", "patch(([@N] as any[]).at(0).prototype)"], ["ByHeir", "patch(Object.getPrototypeOf(Object.getPrototypeOf(Object.create(new @N()))))"], ["BySubclass", "patch(Object.getPrototypeOf((class extends @N {}).prototype))"], ["BySubclassStatic", "patch(Object.getPrototypeOf(class extends @N {}).prototype)"],
    ["ByThen", "Promise.resolve(new @N()).then(one => patch(Object.getPrototypeOf(one)))"], ["ByTimer", "setTimeout((one: object) => patch(Object.getPrototypeOf(one)), 0, new @N())"], ["ByAssign", 'Object.assign(Object.getPrototypeOf(new @N()), { m: () => "patched" })'],
    ["ByDefine", 'Object.defineProperty(Reflect.getPrototypeOf(new @N())!, "m", { value: () => "patched" })'], ["ByReflectSet", 'Reflect.set(Reflect.getPrototypeOf(new @N())!, "m", () => "patched")'], ["ByNewTarget", "Reflect.construct(function (this: any) { patch(new.target.prototype); }, [], @N)"],
    ["ByIsPrototypeOf", "[Object.getPrototypeOf(new @N())].filter(one => one.isPrototypeOf(new @N())).forEach(patch)"], ["ByThrown", "{ try { throw Object.getPrototypeOf(new @N()); } catch (caught) { patch(caught); } }"], ["BySpreadHolder", "patch(({ ...{ p: Object.getPrototypeOf(new @N()) } }).p)"],
  ],
  "class @N { m(): number | string { return 1; } }",
  "new @N().m();",
  "setTimeout(() => {\n@CHECKS\n  console.log(bits.toString(2));\n}, 5);",
);
const p = "created-one-class-for-each-way-to-reach-its-prototype-object.ts";
let t = filesWritten[p];
const names = Array.from(t.matchAll(/^class (\w+) \{ m\(\)/gm), match => match[1]);
t = t.replaceAll("@CHECKS", [...names.entries()].map(([i, n]) => `  if (new ${n}().m() !== 1) bits |= ${1 << i};`).join("\n"));
filesWritten[p] = t;

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
