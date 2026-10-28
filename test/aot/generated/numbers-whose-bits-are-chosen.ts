// A NaN is one value to a program, whatever its 64 bits are. Compiled code holds numbers as raw doubles, and a value, an optional number and a hole in an array are told apart by bit patterns that are
// NaNs too. So a double whose bits somebody has chosen must not reach a place where bits are read as something else.
//
// Every case is a source, a road and a sink:
//   source  where the bits come in: an element of a Float64Array | Float32Array | Float16Array by a constant, a parameter, a loop; the same over a subarray, a resizable and a shared buffer; DataView;
//           Buffer; the methods, iterators and copies of a view; structuredClone; WebAssembly
//   road    what carries the double on: arithmetic that keeps a NaN's payload, a choice, a call and its result, a field, an optional field, an element, a variable of a closure or a module, a generator ..
//   sink    where a raw double turns into something else: a value (an argument, an element, a field, a key, a result, a thrown value), a text by every way of joining, an optional number, an array's storage,
//           an index, a length
// and runs with bit patterns from the corners of the encodings: quiet and signaling NaNs of both signs, the ranges that a boxed cell, int32, undefined, null, true, false and the empty value would come out of,
// the patterns that stand for undefined, null and absent in optional numbers, and a few ordinary numbers. What is printed is compared with plain Bun.
import { spread } from "./case-files";

const patterns: [number, number][] = [
  [0x7ff80000, 0], [0xfff80000, 0], [0x7ff00000, 1], [0xfff00000, 1], [0x7ff80000, 1], [0x7ff7ffff, 0xffffffff], [0xfff7ffff, 0xffffffff],
  [0xfffe0000, 0], [0xfffe0000, 2], [0xfffe0000, 6], [0xfffe0000, 7], [0xfffe0000, 10], [0xfffe0000, 42], [0xfffe0000, 0x1000], [0xfffe1234, 0x56789ab8], [0xfffe7fff, 0xfffffff8],
  [0xfffc0000, 0], [0xfffc0000, 42], [0xfffc0000, 0xffffffff], [0xfffd0000, 0], [0xfffdffff, 0xffffffff], [0xffff0000, 7], [0xffff8000, 0], [0xffffffff, 0xffffffff], [0x7fffffff, 0xffffffff],
  [0x7ffa0000, 0], [0x7ffa0000, 1], [0x7ffb0000, 0], [0x7ffc0000, 0], [0x7ffc0000, 1], [0x7ffd0000, 0], [0x7ffe0000, 0], [0xfffa0000, 0], [0xfffb0000, 0],
  [0xfff00000, 0], [0xffe00000, 0], [0x7fd00000, 0], [0x7fd80000, 0], [0x7fe00000, 0], [0xff800000, 0], [0xff800001, 0], [0x7fc00000, 0], [0xffc00000, 0], [0xfe000000, 0], [0x7e000000, 0], [0x7d000000, 0],
  [0x7ff00000, 0], [0x3ff80000, 0], [0x80000000, 0], [0, 0], [0x40450000, 0],
];

const head = (isOpened: boolean) => `declare const console: { log(...values: unknown[]): void };
const PATTERNS: number[][] = ${JSON.stringify(patterns)};
const seen = ${isOpened ? 'new Function("value", "return value") as <V>(value: V) => V' : "<V>(value: V): V => value"};
const memory = new ArrayBuffer(64);
const WORDS = new Uint32Array(memory, 0, 2);
const F64 = seen(new Float64Array(memory, 0, 2)), F32 = seen(new Float32Array(memory, 0, 2)), F16 = seen(new Float16Array(memory, 0, 4)), VIEW = seen(new DataView(memory));
const SUB64 = seen(new Float64Array(memory).subarray(0, 1)), SUB32 = seen(new Float32Array(memory).subarray(1, 2));
const growing = new ArrayBuffer(16, { maxByteLength: 64 }), GROWING_WORDS = new Uint32Array(growing, 0, 2), GROWING64 = seen(new Float64Array(growing)), GROWING32 = seen(new Float32Array(growing));
const shared = new SharedArrayBuffer(16), SHARED_WORDS = new Uint32Array(shared), SHARED64 = seen(new Float64Array(shared)), SHARED32 = seen(new Float32Array(shared));
const BUFFER = seen(Buffer.from(memory, 0, 16));
const wasm = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 11, 2, 96, 1, 126, 1, 124, 96, 1, 127, 1, 125, 3, 3, 2, 0, 1, 7, 13, 2, 3, 102, 54, 52, 0, 0, 3, 102, 51, 50, 0, 1, 10, 13, 2, 5, 0, 32, 0, 191, 11, 5, 0, 32, 0, 190, 11])));
const wasm64 = wasm.exports.f64 as (bits: bigint) => number, wasm32 = wasm.exports.f32 as (bits: number) => number;
let HIGH = 0, LOW = 0;
function choose(high: number, low: number): void {
  HIGH = high; LOW = low;
  WORDS[0] = low; WORDS[1] = high; GROWING_WORDS[0] = low; GROWING_WORDS[1] = high; SHARED_WORDS[0] = low; SHARED_WORDS[1] = high;
}
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value.map(show).join(",") + "]" : "{" + Object.keys(value).map(key => key + ":" + show((value as Record<string, unknown>)[key])).join(",") + "}";
  return String(value);
}
function list(view: ArrayLike<unknown>): string { let text = "#" + view.length; for (let i = 0; i < view.length; i++) text += (i in view ? " " + show(view[i]) : " _"); return text; }
function attempt(run: () => string): string { try { return run(); } catch (error) { return "threw " + (error instanceof Error ? error.name : show(error)); } }
function pad(depth: number): string { return depth > 0 ? pad(depth - 1) + "." : ""; }
function same(x: number, depth: number): number { return depth > 0 ? same(x, depth - 1) : x; }
function sameValue(x: unknown, depth: number): unknown { return depth > 0 ? sameValue(x, depth - 1) : x; }
class Raw { size = 0.5; other = 1.5; }
class Maybe { size?: number; next: number | undefined = undefined; last: number | null = null; }
class Any { value: unknown = 0; }
let MODULE_NUMBER = 0.5;
let MODULE_MAYBE: number | undefined = undefined;
function* yields(x: number): Generator<number, number, number> { const sent = yield x; return sent; }
function rest(...all: number[]): number { return all[all.length - 1]; }
function withDefault(x: number, y: number = x): number { return y; }
function counter(x: number): () => number { let kept = x; return () => { const was = kept; kept = was; return was; }; }
`;

// prettier-ignore
const sources: Record<string, string> = {
  "f64-constant": "F64[0]", "f64-parameter": "F64[k]", "f64-loop": "F64[i & 0]", "f64-subarray": "SUB64[k]", "f64-growing": "GROWING64[k]", "f64-shared": "SHARED64[k]",
  "f32-constant": "F32[1]", "f32-parameter": "F32[k + 1]", "f32-subarray": "SUB32[k]", "f32-growing": "GROWING32[k + 1]", "f32-shared": "SHARED32[k + 1]",
  "f16-parameter": "F16[k + 3]",
  "view-f64": "VIEW.getFloat64(k, true)", "view-f64-swapped": "VIEW.getFloat64(k, false)", "view-f32": "VIEW.getFloat32(k + 4, true)", "view-f16": "VIEW.getFloat16(k + 6, true)",
  "buffer-double": "BUFFER.readDoubleLE(k)", "buffer-double-swapped": "BUFFER.readDoubleBE(k)", "buffer-float": "BUFFER.readFloatLE(k + 4)",
  "f64-at": "F64.at(k)!", "f64-find": "F64.find(() => true)!", "f64-reduce": "SUB64.reduce((_, element) => element, 0)", "f64-of": "(() => { for (const element of SUB64) return element; return 0; })()",
  "f64-spread": "[...SUB64][k]", "f64-from": "Array.from(SUB64)[k]", "f64-destructured": "(([first]: Float64Array) => first)(F64)", "f64-values": "(F64.values().next().value as number)",
  "f64-slice": "F64.slice(0, 1)[k]", "f64-map": "SUB64.map(element => element)[k]", "f64-set": "(() => { const copy = new Float64Array(1); copy.set(SUB64); return copy[k]; })()",
  "f64-widened": "new Float64Array(SUB32)[k]", "f64-cloned": "structuredClone(SUB64)[k]", "f32-at": "F32.at(k + 1)!", "f32-of": "(() => { for (const element of SUB32) return element; return 0; })()",
  "wasm-f64": "wasm64((BigInt(HIGH) << 32n) | BigInt(LOW))", "wasm-f32": "wasm32(HIGH | 0)",
  "zero-over-zero": "k / k", "infinity-less-infinity": "1 / k - 1 / k", "root-of-minus-one": "Math.sqrt(k - 1)",
};

// prettier-ignore
const roads: Record<string, string> = {
  "as-it-is": "s", "plus-zero": "s + 0", "plus-itself": "s + s", "minus-one": "s - 1", "times-one": "s * 1", "over-one": "s / 1", "negated": "-s", "to-the-first": "s ** 1", "remainder": "s % 3",
  "abs": "Math.abs(s)", "max": "Math.max(s, 1)", "min": "Math.min(1, s)", "fround": "Math.fround(s)", "sqrt": "Math.sqrt(s)", "trunc": "Math.trunc(s)", "floor": "Math.floor(s)", "sign": "Math.sign(s)",
  "chosen": "k === 0 ? s : 1.5", "or-else": "s || s", "call": "same(s, 2)", "field": "(raw.size = s, raw.size)", "two-fields": "(raw.size = s, raw.other = raw.size, raw.other)",
  "optional-field": "(maybe.size = s, maybe.size!)", "undefined-field": "(maybe.next = s, maybe.next!)", "null-field": "(maybe.last = s, maybe.last!)", "element": "(numbers[0] = s, numbers[0])",
  "pushed": "(numbers.push(s), numbers.pop()!)", "literal": "[s, 0.5][k]", "optional-element": "(maybes[0] = s, maybes[0]!)", "module-variable": "(MODULE_NUMBER = s, MODULE_NUMBER)",
  "module-optional": "(MODULE_MAYBE = s, MODULE_MAYBE!)", "closure": "counter(s)()", "generator": "yields(s).next().value", "sent": "(() => { const g = yields(0); g.next(); return g.next(s).value; })()",
  "rest": "rest(1, s)", "spread-call": "same(...([s, 1] as [number, number]))", "default": "withDefault(s)", "tuple": "(([a, b]: [number, number]) => k === 0 ? b : a)([1, s])", "view": "(scratch[0] = s, scratch[0])",
  "boxed-and-back": "sameValue(s, 1) as number",
};

// prettier-ignore
const sinks: Record<string, string> = {
  "argument": "show(x)", "argument-by-call": "show(sameValue(x, 2))", "any-element": "(anything[0] = x, show(anything[0]))", "any-push": "(anything.push(x), show(anything.pop()))", "any-field": "(any.value = x, show(any.value))",
  "any-literal": "show([x, \"a\"])", "object-literal": "show({ a: x, b: 1 })", "map-value": "show(new Map<string, unknown>([[\"a\", x]]).get(\"a\"))", "map-key": "show(new Map<unknown, number>([[x, 1]]).get(NaN)) + show([...new Map<unknown, number>([[x, 1]]).keys()])",
  "set": "show(new Set<unknown>([x]).has(NaN)) + show([...new Set<number>([x, x])])", "number-map": "(() => { const made = new Map<number, number>(); made.set(x, 1); made.set(x, 2); return show(made.get(NaN)) + show(made.get(x)) + made.has(NaN) + made.size + show([...made.keys()]) + made.delete(NaN); })()",
  "number-set": "(() => { const made = new Set<number>(); made.add(x).add(x).add(0.5); return show(made.has(NaN)) + made.has(x) + made.size + show([...made]) + made.delete(x); })()", "map-of-numbers": "(() => { const made = new Map<string, number>(); made.set(\"a\", x); return show(made.get(\"a\")) + show([...made.values()]); })()", "thrown": "(() => { try { throw x; } catch (caught) { return show(caught); } })()", "promise": "show(typeof Promise.resolve(x))",
  "concatenated": "\"<\" + x + \">\"", "template": "`<${x}>`", "string": "String(x)", "to-string": "x.toString()", "to-fixed": "x.toFixed(1)", "to-string-radix": "x.toString(16)",
  "joined-between-calls": "pad(k) + \"<\" + x + \">\" + pad(k + 1) + (x !== x) + pad(k) + String(x)", "joined-template": "`${pad(k)}<${x}>${pad(k + 1)}${x + 1}${pad(k)}`", "appended": "(() => { let text = pad(k); text += x; text += pad(k); text += x; return text; })()",
  "array-join": "[x, x].join(\"|\")", "json": "JSON.stringify(x) + JSON.stringify([x]) + JSON.stringify({ a: x })", "number-literal": "list([x, 0.5])", "number-push": "(() => { const made: number[] = [0.5]; made.push(x); made[0] = x; return list(made) + made.includes(NaN) + made.indexOf(x); })()",
  "number-fill": "list(new Array<number>(2).fill(x))", "number-unshift": "(() => { const made: number[] = [0.5]; made.unshift(x); return list(made); })()", "number-concat": "list([0.5].concat([x], x))", "number-spread": "list([...[x, 1.5], x])",
  "number-from": "list(Array.from({ length: 2 }, () => x))", "number-map": "list([0.5, 1.5].map(() => x))", "number-sort": "list([x, 0.5, x, -1.5].sort())", "number-splice": "(() => { const made: number[] = [0.5, 1.5]; made.splice(1, 0, x); return list(made); })()",
  "optional-field": "(() => { const made = new Maybe(); made.size = x; return show(made.size) + (made.size === undefined) + (\"size\" in made) + show(Object.keys(made)) + show(made); })()",
  "undefined-field": "(() => { const made = new Maybe(); made.next = x; return show(made.next) + (made.next === undefined) + (made.next ?? \"none\") + show(made); })()",
  "null-field": "(() => { const made = new Maybe(); made.last = x; return show(made.last) + (made.last === null) + (made.last ?? \"none\") + show(made); })()",
  "optional-variable": "(() => { let held: number | undefined = k === 0 ? x : undefined; return show(held) + (held === undefined) + (held ?? \"none\") + typeof held; })()",
  "optional-element": "(() => { const made: (number | undefined)[] = [undefined, 0.5]; made[0] = x; made.push(x); return list(made) + (made[0] === undefined) + made.includes(undefined); })()",
  "optional-result": "(() => { const pick = (n: number): number | undefined => (n === 0 ? x : undefined); return show(pick(k)) + (pick(k) === undefined) + (pick(k) ?? \"none\"); })()",
  "raw-field": "(() => { const made = new Raw(); made.size = x; return show(made.size) + show(made) + JSON.stringify(made) + show(Object.values(made)); })()",
  "tests": "typeof x + (x === x) + (x !== x) + (x == x) + Object.is(x, NaN) + Number.isNaN(x) + isNaN(x) + Number.isFinite(x) + Number.isInteger(x) + (x < 1) + (x >= 1) + (x ? 1 : 2) + !x",
  "integers": "show(x | 0) + show(x >>> 0) + show(~x) + show(x << 1) + show(Math.round(x)) + show(Math.imul(x, 3)) + show(Math.clz32(x))", "switch": "(() => { switch (x) { case 0: return \"zero\"; case 1.5: return \"one and a half\"; case 42: return \"forty-two\"; default: return \"other\"; } })()",
  "key": "show({ [x]: 1 }) + show(({ NaN: 7, 42: 8 } as Record<string, number>)[x])", "index": "show(numbers[x]) + show(anything[x]) + show(\"abc\"[x]) + show(\"abc\".charAt(x)) + show(\"abc\".at(x)) + show(scratch[x]) + show(x in numbers)",
  "index-store": "(() => { const made: number[] = [0.5]; made[x] = 1; const bytes = new Uint8Array(2); bytes[x] = 1; return list(made) + show(Object.keys(made)) + list(bytes); })()",
  "length": "attempt(() => list(new Uint8Array(x))) + attempt(() => list(new Array<number>(x))) + attempt(() => \"ab\".repeat(x)) + \"abc\".slice(x) + \"abc\".substring(x, 2) + [1, 2, 3].slice(x).length + \"a\".padStart(x, \"-\")",
  "stored-in-views": "(() => { const bytes = new Uint8Array(1), clamped = new Uint8ClampedArray(1), ints = new Int32Array(1), floats = new Float32Array(1); bytes[0] = x; clamped[0] = x; ints[0] = x; floats[0] = x; return list(bytes) + list(clamped) + list(ints) + list(floats); })()",
  "date": "show(new Date(x).getTime()) + String(new Date(x))", "bigint": "attempt(() => String(BigInt(x)))", "arguments": "(function (this: void, _: number) { return show(arguments[0]) + arguments.length; })(x)", "apply": "show(sameValue.apply(null, [x, 1])) + show(Reflect.apply(sameValue, null, [x, 0]))",
  "awaited": "(async () => show(await x))()", "async-result": "(async (): Promise<number> => x)().then(show)", "kept-over-await": "(async () => { const kept = x + 0; await null; return show(kept) + String(kept); })()",
  "kept-over-yield": "(() => { function* steps(): Generator<undefined, string> { const kept = x + 0; yield; return show(kept) + String(kept); } const all = steps(); all.next(); return all.next().value as string; })()",
  "kept-over-throw": "(() => { const kept = x + 0; try { if (k === 0) throw new Error(pad(1)); return \"\"; } catch { return show(kept) + String(kept); } })()", "unknown-result": "show(((): unknown => x)())",
  "numbers-then-a-text": "(() => { const made: number[] = [0.5]; made.push(x); made[0] = x; (made as unknown[]).push(\"a\"); return list(made); })()", "view-from-numbers": "list(new Float64Array([x, 0.5])) + list(Float32Array.of(x))",
  "defined-property": "show(Object.defineProperty({}, \"a\", { value: x, enumerable: true })) + show(Reflect.set(any, \"value\", x)) + show(any.value)", "cloned": "show(structuredClone({ a: x, b: [x] }))", "inspected": "Bun.inspect(x) + Bun.inspect([x]) + Bun.inspect({ a: x })",
  "to-precision": "x.toPrecision(3) + x.toExponential(1) + x.toLocaleString(\"en\")", "mapped-by-a-built-in": "list([x, x].map(Math.abs)) + list([x].map(String)) + list([x].map(Number))", "comparator": "list([3, 1, 2].sort(() => x))",
  "array-length": "attempt(() => { const made: number[] = [0.5]; made.length = x; return list(made); })", "called-as-any": "show((sameValue as unknown as (...all: unknown[]) => unknown)(x, 0))", "constructed": "show(new (class { held: unknown; constructor(value: unknown) { this.held = value; } })(x))",
  "bound": "show(sameValue.bind(null, x)(1))", "captured": "(() => { const read: () => unknown = () => x; return show(read()); })()", "symbol-description": "String(Symbol(x as unknown as string).description)", "format": "new Intl.NumberFormat(\"en\").format(x)",
};

export const ways: Record<string, string[]> = {
  "as built": [],
  "everything hot": ["--aot-heat=everything-is-hot"],
  "everything cold": ["--aot-heat=everything-is-cold"],
  "no inlining": ["--aot-disable=InlineCalls"],
  "hot, no inlining": ["--aot-heat=everything-is-hot", "--aot-disable=InlineCalls"],
  "validating": ["--aot-validate"],
  "types erased": ["--aot-erase-types"],
  "proofs checked": ["--aot-testing=CheckProofsAtRunTime"],
  "expected types ignored": ["--aot-testing=IgnoreExpectedTypes"],
};

export const everyCase = Object.keys(sources).flatMap(source => Object.keys(roads).flatMap(road => Object.keys(sinks).map(sink => `${source} ${road} ${sink}`)));
export const sample = (count: number) => spread(everyCase, count);
export const casesOfSource = (source: string) => everyCase.filter(name => name.startsWith(source + " "));
export const namesOfSources = Object.keys(sources);

export function program(cases: string[], isOpened = false): { file: string; text: string } {
  let text = head(isOpened);
  cases.forEach((name, number) => {
    const [source, road, sink] = name.split(" ");
    text += `function c${number}(k: number): string | Promise<string> {
  const raw = seen(new Raw()), maybe = seen(new Maybe()), any = seen(new Any()), numbers: number[] = seen([0.5, 1.5]), maybes: (number | undefined)[] = seen([undefined, 0.5]), anything: unknown[] = seen(["a"]), scratch = seen(new Float64Array(1));
  let out: string | Promise<string> = "";
  for (let i = 0; i < 2; i++) {
    const s: number = ${sources[source]};
    const x: number = ${roads[road]};
    out = ${sinks[sink]};
  }
  return out;
}
`;
  });
  text += `const CASES: [string, (k: number) => string | Promise<string>][] = [${cases.map((name, number) => `[${JSON.stringify(name)}, c${number}]`).join(", ")}];
for (const [name, run] of CASES) {
  const answers = new Map<string, string[]>();
  for (const [high, low] of PATTERNS) {
    choose(high, low);
    let answer: string;
    try { answer = await run(0); } catch (error) { answer = "threw " + (error instanceof Error ? error.name : show(error)); }
    const bits = high.toString(16) + "_" + low.toString(16);
    const seen = answers.get(answer);
    if (seen) seen.push(bits);
    else answers.set(answer, [bits]);
  }
  for (const [answer, bits] of answers) console.log(name + " | " + answer + " | " + bits.join(" "));
}
`;
  return { file: "main.ts", text };
}
