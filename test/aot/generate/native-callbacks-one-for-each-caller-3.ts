// More programs with one class | function for each native caller (see native-callbacks-one-for-each-caller.ts), and one PROGRAM for each form in which a function of the library is applied with a number where it wants a string:
// the library's validators are shared, so within one program a single well described form would hide the others.
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
    lines.push((h ? h + "\n" : "") + `attempt(() => ${fill(use.replaceAll("$", `(new ${n}() as any)`), n, k)});`);
  }
  lines.push(tail);
  filesWritten[name + ".ts"] = lines.join("\n") + "\n";
}

write(
  "created-one-species-getter-for-each-native-reader",
  "Held from creation: each class here has a static Symbol.species getter that nothing in the program reads: one native method reads it, through `constructor` of an instance. A bit is set for each getter that ran.",
  [], "",
  [
    ["OfMap", "Array", "@N.from([1]).map(one => one)"], ["OfFilter", "Array", "@N.from([1]).filter(() => true)"], ["OfSlice", "Array", "@N.from([1]).slice()"], ["OfSplice", "Array", "@N.from([1]).splice(0)"], ["OfConcat", "Array", "@N.from([1]).concat([])"],
    ["OfFlat", "Array", "@N.from([1]).flat()"], ["OfFlatMap", "Array", "@N.from([1]).flatMap(one => one)"], ["OfThen", "Promise", "@N.resolve(1).then(() => 0)"], ["OfCatch", "Promise", "@N.resolve(1).catch(() => 0)"], ["OfFinally", "Promise", "@N.resolve(1).finally(() => 0)"],
    ["OfTypedSlice", "Uint8Array", "new @N(1).slice()"], ["OfTypedMap", "Uint8Array", "new @N(1).map(one => one)"], ["OfTypedFilter", "Uint8Array", "new @N(1).filter(() => true)"], ["OfSubarray", "Uint8Array", "new @N(1).subarray(0)"],
    ["OfBufferSlice", "ArrayBuffer", "new @N(2).slice(1)"], ["OfSplit", "RegExp", '"a".split(new @N("a"))'], ["OfMatchAll", "RegExp", '"a".matchAll(new @N("a", "g"))'], ["OfAwait", "Promise", "(async () => await @N.resolve(1))()"],
  ],
  "class @N extends @K<> { static get [Symbol.species](): any { bits |= @B; return @K; } }",
  "", "setTimeout(() => console.log(bits.toString(2)), 5);",
);

write(
  "created-one-static-member-for-each-native-reader",
  "Held from creation: each class here has a static method whose parameter says number, as the program's call does, and one native caller that finds the method on the class itself and passes something else or nothing. A bit is set for each such caller.",
  [], "",
  [
    ["ByAll", "resolve", '(Promise.all as any).call(@N, ["s"])'], ["ByRace", "resolve", '(Promise.race as any).call(@N, ["s"])'], ["ByAny", "resolve", '(Promise.any as any).call(@N, ["s"])'], ["ByAllSettled", "resolve", '(Promise.allSettled as any).call(@N, ["s"])'],
    ["ByInstanceOf", "[Symbol.hasInstance]", '("s" as any) instanceof @N'], ["ByString", "toString", "String(@N)"], ["ByTemplate", "toString", "`${@N}`"], ["ByNumber", "valueOf", "Number(@N)"], ["ByPrimitive", "[Symbol.toPrimitive]", "+(@N as any)"],
    ["ByStringify", "toJSON", "JSON.stringify({ k: @N })"], ["ByInspect", '[Symbol.for("nodejs.util.inspect.custom")]', "Bun.inspect(@N)"], ["ByResolve", "then", "Promise.resolve(@N)"], ["BySpread", "[Symbol.iterator]", "[...(@N as any)]"],
    ["ByReplace", "[Symbol.replace]", '"a".replace(@N as any, "b")'], ["ByValues", "run", '(Object.getOwnPropertyDescriptor(@N, "run")!.value as any)("s")'], ["ByInstance", "run", '(Reflect.get(new @N(), "constructor") as any).run("s")'],
  ],
  'class @N { static @K(value: number): any { if (typeof value !== "number") bits |= @B; return 0; } }',
  "(@N as any)@A(1);", "setTimeout(() => console.log(bits.toString(2)), 5);",
);

write(
  "methods-one-setter-for-each-native-writer",
  "Methods found through instances: each class here has a setter whose parameter says string, as the program's store does, and one native writer that stores a number through it. A bit is set for each such writer.",
  [], "",
  [
    ["ByAssign", "k", "Object.assign($, { k: 1 })"], ["ByAssignParsed", "k", `Object.assign($, JSON.parse('{"k":1}'))`], ["ByReflectSet", "k", 'Reflect.set($, "k", 1)'], ["ByHeir", "k", 'Reflect.set(Object.create($), "k", 1)'], ["ByReceiver", "k", 'Reflect.set($, "k", 1, {})'],
    ["ByProxy", "k", "(new Proxy($, {}).k = 1)"], ["ByPush", "length", "Array.prototype.push.call($, 1)"], ["ByPop", "length", "Array.prototype.pop.call($)"], ["ByShift", "length", "Array.prototype.shift.call($)"], ["ByUnshift", "length", "Array.prototype.unshift.call($, 1)"],
    ["BySplice", "length", "(Array.prototype.splice as any).call($, 0)"], ["ByOf", "length", "(Array.of as any).call(@N, 1)"], ["ByFrom", "length", "(Array.from as any).call(@N, [1])"], ["ByPushIndex", "[0]", "Array.prototype.push.call($, 1)"],
    ["ByFill", "[0]", "Array.prototype.fill.call(Object.assign(Object.create($), { length: 1 }), 1)"], ["ByReverse", "[0]", "Array.prototype.reverse.call(Object.assign(Object.create($), { length: 2, 1: 1 }))"],
    ["ByCopyWithin", "[0]", "Array.prototype.copyWithin.call(Object.assign(Object.create($), { length: 2, 1: 1 }), 0, 1)"], ["BySort", "[0]", "Array.prototype.sort.call(Object.assign(Object.create($), { length: 2, 1: 1 }))"],
    ["ByAssignSymbol", "[Symbol.iterator]", "Object.assign($, { [Symbol.iterator]: 1 })"], ["ByAssignGetter", "k", "Object.assign($, { get k() { return 1; } })"], ["ByAssignString", "[0]", "Object.assign($, [1])"],
  ],
  'class @N { set @K(value: string) { if (typeof value !== "string") bits |= @B; } }',
  '(new @N() as any)@A = "s";',
);

write(
  "methods-one-field-for-each-native-writer",
  "Methods found through instances: each class here has a field that the program only stores numbers into, and one native writer that puts a string there, removes the field or turns it into an accessor. A bit is set where a later read finds no number.",
  [], 'function check(object: { x: number }, bit: number): void {\n  if (typeof object.x !== "number") bits |= bit;\n}',
  [
    ["ByAssign", 'Object.assign(@N.it, { x: "s" })'], ["ByAssignParsed", `Object.assign(@N.it, JSON.parse('{"x":"s"}'))`], ["ByReflectSet", 'Reflect.set(@N.it, "x", "s")'], ["ByDefine", 'Object.defineProperty(@N.it, "x", { value: "s" })'],
    ["ByDefineMany", 'Object.defineProperties(@N.it, { x: { value: "s" } })'], ["ByReflectDefine", 'Reflect.defineProperty(@N.it, "x", { value: "s" })'], ["ByGetter", 'Object.defineProperty(@N.it, "x", { get: () => "s" })'],
    ["ByDelete", 'Reflect.deleteProperty(@N.it, "x")'], ["ByProxy", '((new Proxy(@N.it, {}) as any).x = "s")'], ["ByProxyDelete", "delete (new Proxy(@N.it, {}) as any).x"], ["ByReceiver", 'Reflect.set({}, "x", "s", @N.it)'],
    ["ByHeirReceiver", 'Reflect.set(Object.create(@N.it), "x", "s", @N.it)'], ["ByEntries", 'Object.entries({ x: "s" }).forEach(([key, value]) => ((@N.it as any)[key] = value))'], ["ByReviver", `JSON.parse('{"x":"s"}', function (key, value) { if (key) (@N.it as any)[key] = value; return value; })`],
    ["ByEmit", 'process.nextTick((target: any, value: unknown) => (target.x = value), @N.it, "s")'], ["ByTimer", 'setTimeout((target: any, value: unknown) => (target.x = value), 0, @N.it, "s")'], ["ByThen", 'Promise.resolve(@N.it as any).then(target => (target.x = "s"))'],
    ["ByMapValue", '(new Map<number, any>([[1, @N.it]]).get(1).x = "s")'], ["ByValues", '((Object.values({ it: @N.it }) as any)[0].x = "s")'], ["BySpreadHolder", '(({ ...{ it: @N.it } }) as any).it.x = "s"'], ["ByThrown", '{ try { [1].forEach(() => { throw @N.it; }); } catch (caught) { (caught as any).x = "s"; } }'],
    ["ByPrototype", 'Reflect.deleteProperty(Object.setPrototypeOf(@N.it, { x: "s" }), "x")'],
  ],
  "class @N { x = 1; static it = new @N(); }",
  "@N.it.x = @N.it.x + 1;",
  "setTimeout(() => {\n@CHECKS\n  console.log(bits.toString(2));\n}, 5);",
);

write(
  "methods-one-trap-for-each-native-operation",
  "Methods found through instances: each class here is the handler of a proxy with a `get` trap whose key parameter says string, as the program's call does, and one native operation that asks for a well-known symbol. A bit is set for each such operation.",
  [], "",
  [
    ["ByString", "String(new Proxy({}, $))"], ["BySpread", "[...(new Proxy({}, $) as any)]"], ["ByTag", "Object.prototype.toString.call(new Proxy({}, $))"], ["ByConcat", "([] as any[]).concat(new Proxy({}, $))"], ["ByInstanceOf", "({}) instanceof (new Proxy({}, $) as any)"],
    ["ByStartsWith", '"a".startsWith(new Proxy({}, $) as any)'], ["ByReplace", '"a".replace(new Proxy({}, $) as any, "b")'], ["BySplit", '"a".split(new Proxy({}, $) as any)'], ["BySearch", '"a".search(new Proxy({}, $) as any)'], ["ByMatch", '"a".match(new Proxy({}, $) as any)'],
    ["ByMatchAll", '"a".matchAll(new Proxy({}, $) as any)'], ["ByForAwait", "(async () => { for await (const one of new Proxy({}, $) as any) return one; })().catch(() => 0)"], ["ByArrayFrom", "Array.from(new Proxy({}, $) as any)"], ["ByNumber", "Number(new Proxy({}, $))"],
    ["ByDate", "new Date(new Proxy({}, $) as any)"], ["BySpecies", "Array.prototype.map.call(Object.assign([1], { constructor: new Proxy({}, $) }), one => one)"], ["ByAssign", "Object.assign({}, new Proxy({ [Symbol.iterator]: 1 }, $))"],
    ["ByObjectSpread", "({ ...new Proxy({ [Symbol.iterator]: 1 }, $) })"], ["ByReflectGet", "Reflect.get(new Proxy({}, $), Symbol.iterator)"], ["ByHeir", "String(Object.create(new Proxy({}, $)))"], ["ByFromAsync", "Array.fromAsync(new Proxy({}, $) as any).catch(() => 0)"],
    ["BySet", "new Set(new Proxy({}, $) as any)"], ["ByKey", "({} as any)[new Proxy({}, $) as any]"], ["ByPromiseAll", "Promise.all(new Proxy({}, $) as any).catch(() => 0)"],
  ],
  'class @N { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= @B; return undefined; } }',
  'new @N().get({}, "k");', "setTimeout(() => console.log(bits.toString(2)), 5);",
);

write(
  "exports-one-custom-inspect-method-for-each-printer",
  "Exports of start-up modules: each class here has a custom inspect method whose first parameter says string, as the program's call does, and one printer that calls it with a depth, a number. A bit is set for each such printer.",
  ['import { format, formatWithOptions, inspect } from "node:util";', 'import { Console } from "node:console";'], 'const custom = Symbol.for("nodejs.util.inspect.custom");',
  [
    ["ByLog", "console.log($)"], ["ByInfo", "console.info($)"], ["ByDebug", "console.debug($)"], ["ByDir", "console.dir($)"], ["ByLogInArray", "console.log([$])"], ["ByLogInObject", "console.log({ a: $ })"], ["ByLogInMap", "console.log(new Map([[1, $]]))"],
    ["ByLogInSet", "console.log(new Set([$]))"], ["ByLogFormat", 'console.log("%o", $)'], ["ByLogSecond", 'console.log("a", $)'], ["ByBunInspect", "Bun.inspect($)"], ["ByInspect", "inspect($)"], ["ByInspectNested", "inspect({ a: [$] })"], ["ByFormat", 'format("%o", $)'],
    ["ByFormatBig", 'format("%O", $)'], ["ByFormatRest", 'format("a", $)'], ["ByFormatWithOptions", "formatWithOptions({ depth: 0 }, $)"], ["ByConsoleClass", "new Console(process.stdout).log($)"], ["ByGroup", "(console.group($), console.groupEnd())"],
    ["ByTable", "console.table([{ a: $ }])"], ["ByInspectProxy", "inspect(new Proxy($, {}))"], ["ByInspectHeir", "inspect(Object.create($))"], ["ByInspectGetter", "inspect({ get a() { return $; } }, { getters: true })"],
  ],
  'class @N { [custom](depth: string): string { if (typeof depth !== "string") bits |= @B; return "."; } }',
  'new @N()[custom]("d");',
);

const FORMS: [string, string, string][] = [
  ["as-the-callback-of-map", "map passes the element, a number", "[5].map(@F as any)"],
  ["as-the-callback-of-for-each", "forEach passes the element, a number", "[5].forEach(@F as any)"],
  ["as-the-map-function-of-array-from", "Array.from passes the element, a number", "Array.from([5], @F as any)"],
  ["through-reflect-apply", "Reflect.apply passes what the list holds", "Reflect.apply(@F, null, [5])"],
  ["through-call", "call passes its second argument on", "@F.call(null, 5 as any)"],
  ["through-apply-with-an-array-like", "apply reads an array-like", "@F.apply(null, { length: 1, 0: 5 } as any)"],
  ["through-bind", "the bound function passes the bound argument", "@F.bind(null, 5 as any)()"],
  ["through-call-of-call", "Function.prototype.call is itself applied with call", "Function.prototype.call.call(@F, null, 5)"],
  ["as-the-to-string-of-an-object", "String calls it without an argument", "String({ toString: @F })"],
  ["as-a-getter", "a read calls it without an argument", '(Object.defineProperty({}, "x", { get: @F } as any) as any).x'],
  ["as-the-tag-of-a-template", "it gets the array of strings", "(@F as any)`x`"],
  ["behind-a-proxy", "the proxy passes the arguments on", "(new Proxy(@F, {}) as any)(5)"],
  ["as-a-listener", "emit passes its arguments on", 'new EventEmitter().on("e", @F as any).emit("e", 5)'],
  ["out-of-object-values", "Object.values hands it back and the program calls it", "(Object.values({ @F }) as any)[0](5)"],
  ["out-of-a-spread-of-the-module", "a copy of the module's exports holds it", "({ ...@M } as any).@F(5)"],
  ["under-a-computed-name", "the name is put together at run time", '(@M as any)[[@H].join("")](5)'],
  ["as-the-comparator-of-sort", "sort passes two elements, numbers", "[2, 1].sort(@F as any)"],
  ["as-a-trap-of-a-proxy", "the get trap gets the target, an object, first", "(new Proxy({}, { get: @F as any }) as any).x"],
];
const ASYNC: [string, string, string, boolean][] = [
  ["as-a-reaction-of-a-promise", "then passes what the promise holds", "Promise.resolve(5).then(@F as any).catch(report);", false],
  ["as-the-callback-of-a-timer", "the timer passes its extra argument", "setTimeout(@F as any, 0, 5);", true],
  ["as-the-callback-of-a-tick", "the tick queue passes the extra argument", "process.nextTick(@F, 5);", true],
  ["as-a-microtask", "it is called without an argument", "queueMicrotask(@F as any);", true],
];
// url.format tests its argument with typeof in the library's own code. path.basename is a member of what a native binding answers with, and tests its argument in native code.
const KINDS: [string, string, string, string, string, string, string, string, undefined | Set<string>][] = [
  ["library", "format", "url", "node:url", '"for", "mat"', 'format({ protocol: "http", host: "localhost", pathname: "/a" })', "the one call of url.format that the program spells out passes an object of its own", "the library's own `typeof` tests must still see what really arrives", undefined],
  [
    "native", "basename", "path", "node:path", '"base", "name"', 'basename("/a/b.txt", ".txt")', "every call of path.basename, a function out of a native binding, that the program spells out passes strings", "the function must still be there and refuse what is no string",
    new Set(["as-the-callback-of-map", "through-reflect-apply", "through-bind", "as-the-to-string-of-an-object", "as-the-tag-of-a-template", "behind-a-proxy", "out-of-object-values", "out-of-a-spread-of-the-module", "under-a-computed-name", "as-a-reaction-of-a-promise", "as-the-callback-of-a-tick"]),
  ],
];
for (const [kind, f, m, module, halves, honest, first, last, only] of KINDS) {
  const fill = text => text.replaceAll("@F", f).replaceAll("@M", m).replaceAll("@H", halves);
  const head = why => "// Built-ins applied by native code: " + first + "; here " + why + ", and " + last + ".";
  for (const [slug, why, form] of FORMS) {
    if (only !== undefined && !only.has(slug)) {
      continue;
    }
    const imports = form.includes("@M") ? [`import ${m}, { ${f} } from "${module}";`] : [`import { ${f} } from "${module}";`];
    if (form.includes("EventEmitter")) {
      imports.push('import { EventEmitter } from "node:events";');
    }
    filesWritten[`builtins-a-${kind}-function-gets-another-type-${slug}.ts`] = [head(why), ...imports, ...[
      "", "function attempt(run: () => unknown): string {", "  try {", "    return String(run());", "  } catch (error) {", "    return (error as NodeJS.ErrnoException).code ?? (error as Error).name;", "  }", "}", "",
      `const honest = ${honest};`, `console.log(honest, attempt(() => ${fill(form)}));`,
    ]].join("\n") + "\n";
  }
  for (const [slug, why, form, uncaught] of ASYNC) {
    if (only !== undefined && !only.has(slug)) {
      continue;
    }
    filesWritten[`builtins-a-${kind}-function-gets-another-type-${slug}.ts`] = [head(why), `import { ${f} } from "${module}";`, "", `const honest = ${honest};`, "const report = (error: NodeJS.ErrnoException): void => console.log(honest, error.code);", ...(uncaught ? ['process.on("uncaughtException", report);'] : []), fill(form)].join("\n") + "\n";
  }
}

let p = "created-one-species-getter-for-each-native-reader.ts";
let t = filesWritten[p];
t = t.replaceAll("extends Array<>", "extends Array<number>").replaceAll("extends Promise<>", "extends Promise<number>").replaceAll("<> {", " {");
filesWritten[p] = t;
p = "created-one-static-member-for-each-native-reader.ts";
t = filesWritten[p];
t = t.replace(/class (By(?:All|Race|Any|AllSettled)) \{ static resolve\(value: number\): any \{ (.*?) return 0; \} \}/g, "class $1 extends Promise<number> { static resolve: any = (value: number): unknown => { $2 return Promise.resolve(0); }; }");
filesWritten[p] = t;
p = "methods-one-field-for-each-native-writer.ts";
t = filesWritten[p];
const names = Array.from(t.matchAll(/^class (\w+) \{ x = 1;/gm), match => match[1]);
t = t.replaceAll("@CHECKS", [...names.entries()].map(([i, n]) => `  if (typeof ${n}.it.x !== "number") bits |= ${1 << i};`).join("\n"));
t = t.replaceAll('function check(object: { x: number }, bit: number): void {\n  if (typeof object.x !== "number") bits |= bit;\n}\n', "");
filesWritten[p] = t;

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
