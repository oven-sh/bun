// Programs of native-callbacks: one class (or function) of its own for each native caller. `bun test/aot/generate.ts native-callbacks <where>` writes them.
// The analysis of the flow of values has one set per parameter, so in a program where ten native callers share one method a single well described caller hides nine wrong ones.
// Here every caller has a method of its own and a bit of its own in the number printed. `$` in a use is `(new <Name>() as any)`.
import { programsOf, type WrittenProgram } from "../generate";

/** By the path below the folder of programs. */
const filesWritten: Record<string, string> = {};

const ATTEMPT = "function attempt(run: () => unknown): void {\n  try {\n    run();\n  } catch {}\n}\n";

function write(name: string, head: string, imports: any[], prelude: string, rows: any[], definition: string, honest: string, tail = "console.log(bits.toString(2));", isAsync = false) {
  let lines = ["// " + head];
  lines.push(...(imports.length > 0 ? imports : isAsync ? ["export {};"] : []));
  lines.push(...["", "let bits = 0;", "", ATTEMPT.trimEnd(), ...(prelude ? [prelude.trimEnd()] : []), ""]);
  if (rows.length > 31) throw new Error(name);
  for (const [i, [n, use]] of rows.entries()) {
    lines.push(definition.replaceAll("@N", n).replaceAll("@B", i < 31 ? String(1 << i) : "?"));
  }
  lines.push("");
  for (const [i, [n, use]] of rows.entries()) {
    const u = use.replaceAll("$", `(new ${n}() as any)`).replaceAll("@N", n);
    const h = honest.replaceAll("@N", n);
    if (u.startsWith("await ")) {
      lines.push(`${h}\ntry {\n  ${u};\n} catch {}`);
    } else {
      lines.push(`${h}\nattempt(() => ${u});`);
    }
  }
  lines.push(tail);
  filesWritten[name + ".ts"] = lines.join("\n") + "\n";
}

write(
  "methods-to-string-one-class-for-each-native-caller",
  "Methods found through instances: each class here has a toString(radix: number) that the program calls with a number and that one native caller calls without an argument. A bit is set for each caller that passed no number.",
  ['import { format } from "node:util";'], "",
  [
    ["ByJoin", "[$].join()"], ["ByString", "String($)"], ["ByConcat", '"".concat($)'], ["BySymbol", "Symbol($)"], ["ByRegExp", "new RegExp($)"], ["ByParseInt", "parseInt($)"],
    ["ByKey", "({} as any)[$]"], ["ByEncode", "encodeURIComponent($)"], ["ByError", "new Error($)"], ["ByReplace", '"a".replace($, "b")'], ["ByTemplate", "`${$}`"], ["ByPlus", '$ + ""'],
    ["ByIncludes", '"abc".includes($)'], ["ByCompare", '"a".localeCompare($)'], ["ByPad", '"a".padStart(3, $)'], ["ByHasOwn", "Object.hasOwn({}, $)"], ["ByReflect", "Reflect.get({}, $)"],
    ["ByNumber", "Number($)"], ["ByURL", 'new URL($, "http://localhost")'], ["ByEncoder", "new TextEncoder().encode($)"], ["ByHeaders", 'new Headers([["a", $]])'], ["ByBlob", "new Blob([$])"],
    ["ByParams", "new URLSearchParams({ a: $ })"], ["ByBtoa", "btoa($)"], ["ByEvent", "new Event($)"], ["ByEnv", "(process.env.NATIVE_CALLBACKS = $)"], ["ByFormat", 'format("%s", $)'],
    ["ByDate", "new Date($)"], ["BySymbolFor", "Symbol.for($)"], ["ByResponse", "new Response($)"], ["ByEscape", "Bun.escapeHTML($)"],
  ],
  'class @N { toString(radix: number): string { if (typeof radix !== "number") bits |= @B; return "a"; } }',
  "new @N().toString(2);",
);

write(
  "methods-value-of-one-class-for-each-native-caller",
  "Methods found through instances: each class here has a valueOf(unit: string) that the program calls with a string and that one native caller calls without an argument. A bit is set for each caller that passed no string.",
  [], "",
  [
    ["ByMax", "Math.max($)"], ["ByImul", "Math.imul($, 1)"], ["ByDate", "new Date($)"], ["ByNumber", "Number($)"], ["ByFill", "new Uint8Array(1).fill($)"], ["ByCharCode", '"a".charCodeAt($)'],
    ["BySlice", "[1].slice($)"], ["ByAt", "[1].at($)"], ["ByRepeat", '"a".repeat($)'], ["ByIsNaN", "isNaN($)"], ["ByTimes", "$ * 1"], ["ByUnaryPlus", "+$"], ["ByLess", "$ < 1"], ["ByEquals", "$ == 1"],
    ["ByOr", "$ | 0"], ["ByNegate", "-$"], ["ByAtomics", "Atomics.load(new Int32Array(1), $)"], ["ByDataView", "new DataView(new ArrayBuffer(8)).getInt8($)"], ["ByToFixed", "(1).toFixed($)"],
    ["BySubstring", '"abc".substring($)'], ["ByArrayBuffer", "new ArrayBuffer($)"], ["ByAsIntN", "BigInt.asIntN($, 1n)"], ["ByPow", "Math.pow($, 1)"], ["ByIncludes", "[3].includes(3, $)"],
    ["BySubarray", "new Uint8Array(2).subarray($)"], ["ByLength", "Array.from({ length: $ })"], ["ByPadEnd", '"a".padEnd($)'], ["ByStore", "(new Float64Array(1)[0] = $)"], ["ByClearTimeout", "clearTimeout($)"],
    ["ByIndexOf", '"abc".indexOf("c", $)'], ["ByCopyWithin", "[1, 2].copyWithin($, 1)"],
  ],
  'class @N { valueOf(unit: string): number { if (typeof unit !== "string") bits |= @B; return 0; } }',
  'new @N().valueOf("m");',
);

write(
  "methods-to-primitive-one-class-for-each-native-caller",
  "Methods found through instances: each class here has a Symbol.toPrimitive method whose parameter says number, as the program's call does, and one native caller that passes a hint, a string. A bit is set for each such caller.",
  [], "",
  [
    ["ByAbs", "Math.abs($)"], ["ByString", "String($)"], ["ByPlus", "$ + 1"], ["ByTemplate", "`${$}`"], ["ByDate", "new Date($)"], ["ByEquals", "$ == 5"], ["ByLess", "$ < 6"], ["ByIndexOf", "[1].indexOf(1, $)"],
    ["ByKey", "({} as any)[$]"], ["ByNumber", "Number($)"], ["ByBigInt", "BigInt($)"], ["ByJoin", "[$].join()"], ["ByHas", "Reflect.has({}, $)"], ["ByDefine", "Object.defineProperty({}, $, {})"],
    ["ByIn", "$ in {}"], ["ByDateJSON", "Date.prototype.toJSON.call($)"], ["ByBuffer", "Buffer.from($)"], ["BySetTime", "new Date(0).setTime($)"], ["ByNumberFormat", 'new Intl.NumberFormat("en").format($)'],
    ["ByStringRaw", "String.raw({ raw: [$] } as any)"], ["ByFromCharCode", "String.fromCharCode($)"], ["ByBigIntStore", "(new BigInt64Array(1)[0] = $)"], ["ByIsFinite", "isFinite($)"], ["ByParseFloat", "parseFloat($)"],
  ],
  'class @N { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= @B; return 0; } }',
  "new @N()[Symbol.toPrimitive](2);",
);

write(
  "methods-to-json-one-class-for-each-native-caller",
  "Methods found through instances: each class here has a toJSON(scale: number) that the program calls with a number and that one native caller calls with the key, a string. A bit is set for each such caller.",
  ['import { format } from "node:util";'], "",
  [
    ["AtTop", "JSON.stringify($)"], ["InProperty", "JSON.stringify({ a: $ })"], ["InArray", "JSON.stringify([$])"], ["WithReplacer", "JSON.stringify({ a: $ }, (key, value) => value)"], ["WithList", 'JSON.stringify({ a: $ }, ["a"])'],
    ["WithIndent", "JSON.stringify([$], null, 2)"], ["ByResponse", "Response.json($)"], ["ByResponseNested", "Response.json({ a: [$] })"], ["ByFormat", 'format("%j", $)'], ["FromToJSON", "JSON.stringify({ toJSON: () => $ })"],
    ["FromReplacer", "JSON.stringify(1, () => $)"], ["InGetter", "JSON.stringify({ get a() { return $; } })"], ["InProxy", "JSON.stringify(new Proxy({ a: $ }, {}))"], ["InInherited", "JSON.stringify(Object.create($))"],
  ],
  'class @N { toJSON(scale: number): number { if (typeof scale !== "number") bits |= @B; return 0; } }',
  "new @N().toJSON(2);",
);

write(
  "methods-iterator-one-class-for-each-native-consumer",
  "Methods found through instances: each class here is an iterator whose next(step: number) the program calls with a number and one native consumer calls without an argument. A bit is set for each such consumer.",
  ['import { Readable } from "node:stream";'], "",
  [
    ["ByArrayFrom", "Array.from($)"], ["BySet", "new Set($)"], ["ByMap", "new Map($)"], ["ByWeakSet", "new WeakSet($)"], ["BySpread", "[...$]"], ["ByCallSpread", "Math.max(...$)"], ["ByDestructuring", "(([first]: any) => first)($)"],
    ["ByForOf", "{ for (const one of $) return one; }"], ["ByPromiseAll", "Promise.all($)"], ["ByPromiseRace", "Promise.race($)"], ["ByAllSettled", "Promise.allSettled($)"], ["ByPromiseAny", "Promise.any($).catch(() => 0)"],
    ["ByFromEntries", "Object.fromEntries($)"], ["ByTypedArray", "new Uint8Array($)"], ["ByTypedFrom", "Float64Array.from($)"], ["ByAggregate", "new AggregateError($)"], ["ByGroupBy", 'Object.groupBy($, () => "k")'],
    ["ByMapGroupBy", "Map.groupBy($, () => 1)"], ["ByYieldStar", "[...(function* () { yield* $; })()]"], ["ByIteratorFrom", "(Iterator as any).from($).toArray()"], ["ByHeaders", "new Headers($)"], ["ByParams", "new URLSearchParams($)"],
    ["ByBlob", "new Blob($)"], ["ByFromAsync", "Array.fromAsync($)"], ["ByReadableFrom", 'Readable.from($).on("data", () => {})'], ["ByStreamFrom", "(ReadableStream as any).from($).getReader().read()"], ["ByBufferConcat", "Buffer.from($)"],
    ["BySetUnion", "new Set([1]).union({ size: 1, has: () => false, keys: () => $ } as any)"],
  ],
  'class @N { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= @B; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }',
  "new @N().next(1);", "setTimeout(() => console.log(bits.toString(2)), 5);",
);

write(
  "methods-then-one-class-for-each-native-caller",
  "Methods found through instances: each class here has a then(priority: number) that the program calls with a number and that one native caller calls with a resolving function. A bit is set for each such caller.",
  [], "",
  [
    ["ByAwait", "(async () => await $)()"], ["ByResolve", "Promise.resolve($)"], ["ByExecutor", "new Promise(resolve => resolve($))"], ["ByAsyncReturn", "(async () => $)()"], ["ByThenResult", "Promise.resolve().then(() => $)"],
    ["ByCatchResult", "Promise.reject().catch(() => $)"], ["ByFinallyResult", "Promise.resolve().finally(() => $)"], ["ByAll", "Promise.all([$])"], ["ByRace", "Promise.race([$])"], ["ByAllSettled", "Promise.allSettled([$])"], ["ByAny", "Promise.any([$])"],
    ["ByWithResolvers", "Promise.withResolvers().resolve($)"], ["ByForAwait", "(async () => { for await (const one of [$]) return one; })()"], ["ByAsyncGenerator", "(async function* () { yield $; })().next()"], ["ByFromAsync", "Array.fromAsync([$])"],
    ["ByStreamPull", "new ReadableStream({ pull: () => $ }).getReader().read()"], ["ByStreamStart", "new ReadableStream({ start: () => $ })"], ["ByTimerPromise", "new Promise(resolve => setTimeout(resolve, 0, $))"],
    ["ByTry", "(Promise as any).try(() => $)"], ["ByTickResolve", "new Promise(resolve => process.nextTick(resolve, $))"], ["ByMicrotask", "new Promise(resolve => queueMicrotask(() => resolve($)))"],
  ],
  'class @N { then(priority: number): void { if (typeof priority !== "number") bits |= @B; } }',
  "new @N().then(1);", "setTimeout(() => console.log(bits.toString(2)), 10);",
);

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
