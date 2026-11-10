// As native-callbacks-one-for-each-caller.ts, for functions: `@N` is the function's (or the class's) name.
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
    lines.push(`${fill(honest, n, k)}\nattempt(() => ${fill(use.replaceAll("$", `(new ${n}() as any)`), n, k)});`);
  }
  lines.push(tail);
  filesWritten[name + ".ts"] = lines.join("\n") + "\n";
}

write(
  "callbacks-one-function-for-each-native-caller",
  "Callbacks handed over: each function here has a second parameter that says string, as the program's call does, and one native caller that passes a number, an object or nothing there. A bit is set for each such caller.",
  ['import { EventEmitter } from "node:events";'], "const list = [1];",
  [
    ["byMap", "list.map(@N as any)"], ["byForEach", "list.forEach(@N as any)"], ["byFilter", "list.filter(@N as any)"], ["bySome", "list.some(@N as any)"], ["byEvery", "list.every(@N as any)"], ["byFind", "list.find(@N as any)"],
    ["byFindIndex", "list.findIndex(@N as any)"], ["byFindLast", "list.findLast(@N as any)"], ["byFlatMap", "list.flatMap(@N as any)"], ["byArrayFrom", "Array.from(list, @N as any)"], ["byReduce", "list.reduce(@N as any, 0)"],
    ["bySort", "[2, 1].sort(@N as any)"], ["byToSorted", "[2, 1].toSorted(@N as any)"], ["byTypedMap", "new Uint8Array(1).map(@N as any)"], ["byTypedSort", "new Uint8Array(2).sort(@N as any)"], ["bySetForEach", "new Set(list).forEach(@N as any)"],
    ["byMapForEach", "new Map([[1, 1]]).forEach(@N as any)"], ["byGroupBy", "Object.groupBy(list, @N as any)"], ["byReplace", '"a".replace("a", @N as any)'], ["byReviver", 'JSON.parse("1", @N as any)'], ["byReplacer", "JSON.stringify(1, @N as any)"],
    ["byIteratorMap", "list.values().map(@N as any).toArray()"], ["byTimeout", "setTimeout(@N as any, 0, 1)"], ["byImmediate", "setImmediate(@N as any, 1, 2)"], ["byMicrotask", "queueMicrotask(@N as any)"], ["byTick", "process.nextTick(@N, 1, 2)"],
    ["byThen", "Promise.resolve(1).then(@N as any)"], ["byEmit", 'new EventEmitter().on("e", @N as any).emit("e", 1, 2)'], ["byParams", 'new URLSearchParams("a=1").forEach(@N as any, 1)'], ["byHeaders", 'new Headers({ a: "1" }).forEach(@N as any)'],
    ["byFromAsync", "Array.fromAsync(list, @N as any)"],
  ],
  'function @N(value: unknown, tag: string): number { if (typeof tag !== "string") bits |= @B; return 0; }',
  '@N(1, "t");', "setTimeout(() => console.log(bits.toString(2)), 10);",
);

write(
  "callbacks-one-function-for-each-container-it-comes-back-from",
  "Callbacks handed over: each function here is called by the program with a number, is put into one container of native code, comes back out of it as `any`, and is then called with a string. A bit is set for each one that saw the string.",
  ['import { EventEmitter, getEventListeners } from "node:events";', 'import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";'], "",
  [
    ["fromValues", '(Object.values({ f: @N }) as any)[0]("s")'], ["fromEntries", '(Object.entries({ f: @N }) as any)[0][1]("s")'], ["fromReflectGet", 'Reflect.get({ f: @N } as any, "f")("s")'],
    ["fromDescriptor", 'Object.getOwnPropertyDescriptor({ f: @N } as any, "f")!.value("s")'], ["fromAt", '([@N] as any[]).at(0)("s")'], ["fromPop", '([@N] as any[]).pop()("s")'], ["fromFind", '([@N] as any[]).find(() => true)("s")'],
    ["fromFlat", '([[@N]] as any[]).flat()[0]("s")'], ["fromConcat", '([] as any[]).concat([@N])[0]("s")'], ["fromArrayFrom", '(Array.from([@N]) as any[])[0]("s")'], ["fromSet", '(new Set([@N]).values().next().value as any)("s")'],
    ["fromMap", '(new Map([[1, @N]]).get(1) as any)("s")'], ["fromWeakMap", '(new WeakMap([[@N, @N]]).get(@N) as any)("s")'], ["fromWeakRef", '(new WeakRef(@N).deref() as any)("s")'], ["fromFromEntries", '(Object.fromEntries([["f", @N]]) as any).f("s")'],
    ["fromAssign", '(Object.assign({}, { f: @N }) as any).f("s")'], ["fromDetail", 'new CustomEvent("e", { detail: @N as any }).detail("s")'], ["fromCause", '(new Error("e", { cause: @N }).cause as any)("s")'], ["fromReason", 'AbortSignal.abort(@N).reason("s")'],
    ["fromListeners", '(new EventEmitter().on("e", @N).listeners("e")[0] as any)("s")'], ["fromRawListeners", '(new EventEmitter().once("e", @N).rawListeners("e")[0] as any).listener("s")'], ["fromStore", '{ const storage = new AsyncLocalStorage<any>(); return storage.run(@N, () => storage.getStore()("s")); }'],
    ["fromProxy", '(new Proxy(@N, {}) as any)("s")'], ["fromBind", '(@N.bind(null) as any)("s")'], ["fromReflectApply", 'Reflect.apply(@N, null, ["s"])'], ["fromCallCall", 'Function.prototype.call.call(@N, null, "s")'],
    ["fromResourceBind", '(AsyncResource.bind(@N) as any)("s")'], ["fromSnapshot", 'AsyncLocalStorage.snapshot()(@N as any, "s")'], ["fromTargetListeners", '{ const target = new EventTarget(); target.addEventListener("e", @N as any); return (getEventListeners(target, "e")[0] as any)("s"); }'],
    ["fromGroupBy", '(Object.groupBy([@N], () => "k") as any).k[0]("s")'], ["fromStructuredHolder", '(([@N] as any[]).toSpliced(0, 0)[0])("s")'],
  ],
  'function @N(value: number): void { if (typeof value !== "number") bits |= @B; }',
  "@N(1);", "console.log(bits.toString(2));",
);

write(
  "spread-one-copy-for-each-native-caller-of-its-methods",
  "Sources of a spread: each object here is only ever spread, and the copy is handed to one native caller, which calls the method it finds there with arguments of its own. The program calls the method on the source with a number. A bit is set for each such caller.",
  [], "",
  [
    ["forStringify", "toJSON", "JSON.stringify({ ...@N })"], ["forString", "toString", "String({ ...@N })"], ["forNumber", "valueOf", "Number({ ...@N })"], ["forResolve", "then", "Promise.resolve({ ...@N })"], ["forSpread", "[Symbol.iterator]", "[...({ ...@N } as any)]"],
    ["forProxy", "get", "(new Proxy({}, { ...@N } as any) as any).x"], ["forStream", "start", "new ReadableStream({ ...@N } as any)"],
    ["forListener", "handleEvent", '{ const target = new EventTarget(); target.addEventListener("e", { ...@N } as any); target.dispatchEvent(new Event("e")); }'],
    ["forDescriptor", "set", '((Object.defineProperty({}, "k", { ...@N } as any) as any).k = "s")'], ["forReplace", "[Symbol.replace]", '"a".replace({ ...@N } as any, "b")'], ["forAssigned", "toJSON", "JSON.stringify(Object.assign({}, @N))"],
    ["forRest", "toJSON", "(({ other, ...rest }: any) => JSON.stringify(rest))(@N)"], ["forNested", "toJSON", "JSON.stringify({ inner: [{ ...@N }] })"], ["forTwice", "toJSON", "JSON.stringify({ ...{ ...@N } })"],
    ["forInspect", '[Symbol.for("nodejs.util.inspect.custom")]', "Bun.inspect({ ...@N })"], ["forSink", "write", 'new WritableStream({ ...@N } as any).getWriter().write("c")'],
    ["forTransform", "transform", 'new TransformStream({ ...@N } as any).writable.getWriter().write("c")'], ["forInstanceOf", "[Symbol.hasInstance]", "({}) instanceof ({ ...@N } as any)"], ["forGroupKey", "toString", "Object.groupBy([1], () => ({ ...@N }) as any)"],
    ["forServe", "fetch", 'Bun.serve({ port: 0, hostname: "127.0.0.1", ...@N } as any).stop(true)'], ["forSort", "compare", "[2, 1].sort(({ ...@N } as any).compare)"], ["forEntries", "run", '(Object.entries({ ...@N }) as any)[1][1]("s")'],
  ],
  'const @N = { other: 1, @K(value: number): any { if (typeof value !== "number") bits |= @B; return 0; } };',
  "(@N as any)@A(1);", "setTimeout(() => console.log(bits.toString(2)), 5);",
);

write(
  "thrown-one-function-for-each-way-to-be-caught",
  "Thrown values: each function here is called by the program with a number, is thrown, passes through one kind of native frame, and is called with a string by whoever catches it. A bit is set for each one that saw the string.",
  ['import { EventEmitter } from "node:events";'], 'const call = (caught: any): void => caught("s");\nfunction caughtFrom(run: () => unknown): void {\n  try {\n    run();\n  } catch (caught) {\n    (caught as any)("s");\n  }\n}',
  [
    ["directly", "caughtFrom(() => { throw @N; })"], ["throughForEach", "caughtFrom(() => [1].forEach(() => { throw @N; }))"], ["throughSort", "caughtFrom(() => [1, 2].sort(() => { throw @N; }))"], ["throughStringify", "caughtFrom(() => JSON.stringify({ get a() { throw @N; } }))"],
    ["throughToString", "caughtFrom(() => String({ toString() { throw @N; } }))"], ["throughProxy", "caughtFrom(() => (new Proxy({}, { get() { throw @N; } }) as any).x)"], ["throughReflect", "caughtFrom(() => Reflect.apply(() => { throw @N; }, null, []))"],
    ["throughConstruct", "caughtFrom(() => Reflect.construct(function () { throw @N; }, []))"], ["throughIterator", "caughtFrom(() => Array.from({ [Symbol.iterator]() { throw @N; } } as any))"], ["throughReplace", 'caughtFrom(() => "a".replace("a", () => { throw @N; }))'],
    ["throughEmit", 'caughtFrom(() => new EventEmitter().on("e", () => { throw @N; }).emit("e"))'], ["throughReject", "Promise.reject(@N).catch(call)"], ["throughAsync", "(async () => { throw @N; })().catch(call)"], ["throughExecutor", "new Promise(() => { throw @N; }).catch(call)"],
    ["throughThen", "Promise.resolve().then(() => { throw @N; }).catch(call)"], ["throughThenable", "Promise.resolve({ then() { throw @N; } }).catch(call)"], ["throughAllSettled", 'Promise.allSettled([Promise.reject(@N)]).then(([outcome]: any) => outcome.reason("s"))'],
    ["throughAny", 'Promise.any([Promise.reject(@N)]).catch(error => error.errors[0]("s"))'], ["throughGenerator", "caughtFrom(() => (function* () {})().throw(@N))"], ["throughStreamError", "new ReadableStream({ start(controller) { controller.error(@N); } }).getReader().read().catch(call)"],
    ["throughStreamPull", "new ReadableStream({ pull() { throw @N; } }).getReader().read().catch(call)"], ["throughAbort", "caughtFrom(() => AbortSignal.abort(@N).throwIfAborted())"], ["throughCancel", "new ReadableStream({ cancel: call }).cancel(@N)"],
    ["throughSinkAbort", "new WritableStream({ abort: call }).abort(@N)"], ["throughStructuredClone", "caughtFrom(() => structuredClone({ get a() { throw @N; } }))"], ["throughSpecies", "caughtFrom(() => (class extends Array { static get [Symbol.species](): any { throw @N; } }).from([1]).map(one => one))"],
    ["throughFinally", "Promise.reject(@N).finally(() => {}).catch(call)"], ["throughAsyncIterator", "(async () => { for await (const one of { [Symbol.asyncIterator]() { throw @N; } } as any) return one; })().catch(call)"],
    ["throughTimerPromise", "new Promise((resolve, reject) => setTimeout(reject, 0, @N)).catch(call)"], ["throughErrorEvent", 'new EventEmitter().on("error", call).emit("error", @N)'],
  ],
  'function @N(value: number): void { if (typeof value !== "number") bits |= @B; }',
  "@N(1);", "setTimeout(() => console.log(bits.toString(2)), 10);",
);

write(
  "receivers-one-getter-for-each-native-reader",
  "Receivers below an accessor: each class here has an accessor that the program reads on an instance, and one native reader that reads it on an object which merely inherits from an instance, so `this` has no field of its own. A bit is set for each such reader.",
  [], "let sum = 0;\nconst heir = (instance: object): any => Object.create(instance);",
  [
    ["ByReflectGet", "value", 'Reflect.get(new @N(), "value", heir(new @N()))'], ["ByErrorCause", "cause", 'new Error("e", heir(new @N()))'], ["ByEventDetail", "detail", 'new CustomEvent("e", heir(new @N()))'], ["ByArrayFrom", "length", "Array.from(heir(new @N()))"],
    ["ByJoin", "length", "Array.prototype.join.call(heir(new @N()))"], ["ByStringify", "toJSON", "JSON.stringify(heir(new @N()))"], ["ByString", "toString", "String(heir(new @N()))"], ["ByResolve", "then", "Promise.resolve(heir(new @N()))"],
    ["ByConcat", "[Symbol.isConcatSpreadable]", "([] as any[]).concat(heir(new @N()))"], ["ByTag", "[Symbol.toStringTag]", "Object.prototype.toString.call(heir(new @N()))"], ["ByDefine", "enumerable", 'Object.defineProperty({}, "k", heir(new @N()))'],
    ["ByErrorToString", "name", "Error.prototype.toString.call(heir(new @N()))"], ["ByRegExpToString", "source", "RegExp.prototype.toString.call(heir(new @N()))"], ["ByFromEntries", "[0]", "Object.fromEntries([heir(new @N())])"],
    ["ByMap", "[1]", "new Map([heir(new @N())])"], ["ByApply", "length", "Reflect.apply(() => 0, null, heir(new @N()))"], ["ByDecoder", "fatal", 'new TextDecoder("utf-8", heir(new @N()))'], ["ByProxy", "get", "(new Proxy({}, heir(new @N())) as any).x"],
    ["BySpread", "[Symbol.iterator]", "[...heir(new @N())]"], ["ByDateJSON", "[Symbol.toPrimitive]", "Date.prototype.toJSON.call(heir(new @N()))"], ["ByStrategy", "highWaterMark", "new CountQueuingStrategy(heir(new @N()))"],
    ["ByStream", "start", "new ReadableStream(heir(new @N()))"], ["ByInstanceOf", "[Symbol.hasInstance]", "({}) instanceof heir(new @N())"], ["ByInspect", '[Symbol.for("nodejs.util.inspect.custom")]', "Bun.inspect(heir(new @N()))"],
    ["ByAssign", "kept", 'Object.assign({}, Object.defineProperty(heir(new @N()), "own", { enumerable: true, get: Object.getOwnPropertyDescriptor(@N.prototype, "kept")!.get }))'], ["ByIn", "seen", 'Reflect.get(heir(heir(new @N())), "seen")'],
  ],
  'class @N { held = 1; get @K(): any { if (!Object.hasOwn(this, "held")) bits |= @B; sum += this.held; return undefined; } }',
  "(new @N() as any)@A;", "console.log(bits.toString(2), sum);",
);

write(
  "created-one-class-for-each-native-construction",
  "Held from creation: each class here extends Array with a constructor whose parameter says string, as the one `new` in the program does, and one native caller constructs it, through `constructor` and Symbol.species or as its receiver, with a number or nothing. A bit is set for each such caller.",
  [], "",
  [
    ["ByMap", "@N.one().map(one => one)"], ["ByFilter", "@N.one().filter(() => true)"], ["BySlice", "@N.one().slice()"], ["BySplice", "@N.one().splice(0)"], ["ByConcat", "@N.one().concat([])"], ["ByFlat", "@N.one().flat()"], ["ByFlatMap", "@N.one().flatMap(one => one)"],
    ["ByFrom", "@N.from([1])"], ["ByFromLike", "@N.from({ length: 1 })"], ["ByOf", "@N.of(1)"], ["ByFromAsync", "@N.fromAsync([1])"], ["ByReflect", "Reflect.construct(@N, [1])"], ["ByReflectLike", "Reflect.construct(@N, { length: 1, 0: 1 } as any)"],
    ["ByNewTarget", "Reflect.construct(Array, [1], @N)"], ["ByProxy", "new (new Proxy(@N, {}) as any)(1)"], ["ByBound", "new (@N.bind(null, 1 as any) as any)()"], ["ByConstructorRead", 'new (Reflect.get(@N.one(), "constructor") as any)(1)'],
    ["ByPrototypeRead", "new (Object.getPrototypeOf(@N.one()).constructor as any)(1)"], ["ByDescriptor", 'new (Object.getOwnPropertyDescriptor(@N.prototype, "constructor")!.value as any)(1)'], ["ByGenericMap", "Array.prototype.map.call(@N.one(), one => one)"],
    ["ByGenericSlice", "Array.prototype.slice.call(@N.one())"],
  ],
  'class @N extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= @B; } static one(): @N { const made = new @N("mine"); made.push(1); return made; } }',
  "@N.one();", "setTimeout(() => console.log(bits.toString(2)), 5);",
);

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
