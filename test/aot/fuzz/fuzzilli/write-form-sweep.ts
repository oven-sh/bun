// One number in each of the forms in which compiled code may hold it, times each question that narrows its type, times each place that it may go to.
//
//   bun write-form-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<value>--<question>--<sink>--<place>.<mjs|ts>
//   bun write-form-sweep.ts count
//   bun write-form-sweep.ts named <pattern> <folder> [most]
//
// A question such as `case 3` says what a number is. It does not say how the number lies there: as an integer in a register, as a double in a register, as an integer in a box, as a double in a box.
// What the sink does with the number stands in straight code, in a loop behind the question, or in a loop together with the question.
// A program holds one value, one question and one sink, and a function of its own for each road by which the value comes. Each function is called once. The roads that hand on the value unchanged must all say the same:
// the program throws where they do not, so that it needs no other run to be held against. Held against `bun <file>` it says more: there the roads that wrap the value are judged too.
// The second part does the same with numbers that are not whole and with what is no number: undefined, null, true, false, texts.
import { mkdirSync, writeFileSync } from "node:fs";

type Value = [name: string, text: string, value: number];
const values: Value[] = [
  ["three", "3", 3],
  ["zero", "0", 0],
  ["minus-zero", "-0", -0],
  ["minus-one", "-1", -1],
  ["a-byte-and-one", "256", 256],
  ["above-two-to-the-21", "2097153", 2097153],
  ["the-greatest-int32", "2147483647", 2147483647],
  ["the-least-int32", "-2147483648", -2147483648],
  ["past-int32", "2147483648", 2147483648],
  ["past-uint32", "4294967299", 4294967299],
  ["the-greatest-safe", "9007199254740991", 9007199254740991],
];

/** How the value comes: what the file hands to the function, its declared type, how the function reads it, and whether the value arrives unchanged. */
type Road = [name: string, given: (n: Value) => string, type: string, read: string, keeps: (n: Value) => boolean, takes?: (n: Value) => boolean]; // prettier-ignore
const always = () => true;
const isInt32 = ([, , value]: Value) => (value | 0) === value && !Object.is(value, -0);
const roads: Road[] = [
  ["written", n => n[1], "number", "given", always],
  ["parsed", n => `JSON.parse("${n[1]}")`, "any", "given", always],
  ["parsed-and-declared", n => `JSON.parse("${n[1]}")`, "number", "given", always],
  ["off-doubles-turned-into-values", n => `turned(${n[1]})`, "any", "given", always],
  ["read-off-parsed-doubles", n => `JSON.parse("[0.5,${n[1]}]")`, "number[]", "given[1]", always],
  ["read-off-written-doubles", n => `[0.5, ${n[1]}]`, "number[]", "given[1]", always],
  ["read-off-parsed-whole-numbers", n => `JSON.parse("[7,${n[1]}]")`, "number[]", "given[1]", always],
  ["read-off-a-view-of-doubles", n => `new Float64Array([0.5, ${n[1]}])`, "Float64Array", "given[1]", always],
  ["read-off-a-view-of-integers", n => `new Int32Array([7, ${n[1]}])`, "Int32Array", "given[1]", isInt32],
  ["reckoned-as-a-double", n => `Number("${Object.is(n[2], -0) ? "-0" : n[2] / 2}")`, "number", "given * 2", always],
  ["reckoned-as-an-integer", n => `Number("${n[1]}")`, "number", "given | 0", isInt32],
  ["a-field-of-a-parsed-record", n => `JSON.parse('{"v":${n[1]}}')`, "{ v: number }", "given.v", always],
  ["a-field-that-held-a-fraction", n => `refilled(${n[1]})`, "{ v: number }", "given.v", always],
  ["rounded", n => `Number("${Object.is(n[2], -0) ? "-0.25" : n[1]}")`, "number", "Math.round(given)", always],
  // A number or nothing: what is read at a place that may lie outside, off a field that may be missing, out of a choice.
  ["read-off-written-whole-numbers-at-a-place-nobody-knows", n => `[7, ${n[1]}]`, "number[]", "given[place]", always],
  ["read-off-written-doubles-at-a-place-nobody-knows", n => `[0.5, ${n[1]}]`, "number[]", "given[place]", always],
  ["read-off-a-view-of-doubles-at-a-place-nobody-knows", n => `new Float64Array([0.5, ${n[1]}])`, "Float64Array", "given[place]", always],
  ["a-field-that-may-be-missing", n => `maybe(${n[1]})`, "{ v?: number }", "given.v as number", always],
  ["out-of-a-choice", n => `JSON.parse("${n[1]}")`, "number", "(yes ? given : undefined) as number", always],
  // A whole number that needs more than 32 bits while it is reckoned.
  ["a-sum-of-two-integers", n => `Number("${n[2] - 1}")`, "number", "(given | 0) + (one | 0)", n => isInt32(["", "", n[2] - 1]) && !Object.is(n[2], -0)],
  ["shifted-by-nothing", n => `Number("${n[1]}")`, "number", "given >>> 0", always, n => n[2] >= 0 && n[2] < 4294967296 && !Object.is(n[2], -0)],
  ["the-length-of-a-list", n => `new Array(${n[1]})`, "any[]", "given.length", always, n => n[2] >= 0 && n[2] < 4294967296 && !Object.is(n[2], -0)],
  ["the-length-of-a-text", n => `"a".repeat(${n[1]})`, "string", "given.length", always, n => n[2] >= 0 && n[2] <= 256 && !Object.is(n[2], -0)],
  ["the-code-of-a-character", n => `String.fromCharCode(${n[1]})`, "string", "given.charCodeAt(0)", always, n => n[2] >= 0 && n[2] <= 256 && !Object.is(n[2], -0)],
  ["a-place-that-was-found", n => `placed(${n[1]})`, "string[]", 'given.indexOf("x")', always, n => n[2] >= -1 && n[2] <= 3 && !Object.is(n[2], -0)],
  ["a-number-of-a-text", n => `"${n[1]}"`, "string", "Number(given)", always],
  ["an-integer-of-a-text", n => `"${n[1]}"`, "string", "parseInt(given, 10)", always],
]; // prettier-ignore

/** What is asked of x in front of the sink. Each lets the value of the program through. */
const questions: [name: string, open: (n: Value) => string, close: string][] = [
  ["nothing-asked", () => "{", "}"],
  ["a-case", n => `switch (x) { case ${n[1]}: {`, "} }"],
  ["a-case-beside-another", n => `switch (x) { case 77: return "other"; case ${n[1]}: {`, "} }"],
  ["two-cases-into-one", n => `switch (x) { case 77: case ${n[1]}: {`, "} }"],
  ["is-it", n => `if (x === ${n[1]}) {`, "}"],
  ["is-it-the-other-way-round", n => `if (${n[1]} === x) {`, "}"],
  ["is-it-loosely", n => `if (x == ${n[1]}) {`, "}"],
  ["leaves-where-it-is-not", n => `if (x !== ${n[1]}) return "left"; {`, "}"],
  ["is-a-number", () => `if (typeof x === "number") {`, "}"],
  ["is-whole", () => `if (Number.isInteger(x)) {`, "}"],
  ["is-whole-and-safe", () => `if (Number.isSafeInteger(x)) {`, "}"],
  ["between-itself", n => `if (x >= ${n[1]} && x <= ${n[1]}) {`, "}"],
  ["has-no-remainder", () => `if (x % 1 === 0) {`, "}"],
  ["is-its-own-trunk", () => `if (Math.trunc(x) === x) {`, "}"],
  ["is-the-second", () => `if (x === second) {`, "}"],
  ["is-the-same-value", n => `if (Object.is(x, ${n[1]})) {`, "}"],
];

/** Where x goes. Each is a block that returns a text. `most` leaves out values that would have the sink lay out too much memory. */
type Sink = [name: string, block: string, most?: number];
const lists: [string, string, string][] = [
  ["whole-numbers", "[9, 8, 7]", "number[]"],
  ["filled-whole-numbers", "new Array(3).fill(9)", "number[]"],
  ["doubles", "[0.5, 8, 7]", "number[]"],
  ["values", '["t", 8, 7]', "any[]"],
  ["parsed-whole-numbers", 'JSON.parse("[9,8,7]")', "number[]"],
];
const intoLists: [string, string][] = [
  ["by-index-in-a-loop", "for (let i = 0; i < to.length; i++) to[i] = x;"],
  ["by-index-once", "to[1] = x;"],
  ["by-the-turn", "to[turn] = x;"],
  ["pushed", "to.push(x);"],
  ["filled", "to.fill(x);"],
  ["spliced", "to.splice(1, 1, x);"],
  ["unshifted", "to.unshift(x);"],
  ["with", "to = to.with(1, x);"],
  ["concatenated", "to = to.concat(x);"],
  ["beyond-the-end", "to[to.length] = x;"],
];
const views = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array"]; // prettier-ignore
const told = (expression: string) => `return tell(${expression});`;
const sinks: Sink[] = [
  ...lists.flatMap(([kind, made, type]) =>
    intoLists.map(
      ([how, store]): Sink => [`a-list-of-${kind}-${how}`, `let to: ${type} = ${made}; ${store} return showList(to);`],
    ),
  ),
  ["a-list-written-around-it", "const to = [x, 1, x]; return showList(to);"],
  ["a-list-of-it-alone", "const to = [x]; return showList(to);"],
  ["a-list-made-of-it", "const to = Array.of(x, x); return showList(to);"],
  ...views.flatMap((view): Sink[] => [
    [
      `${view}-by-index-in-a-loop`,
      `const to = new ${view}(3); for (let i = 0; i < to.length; i++) to[i] = x; return showList(Array.from(to));`,
    ],
    [`${view}-filled`, `const to = new ${view}(3); to.fill(x); return showList(Array.from(to));`],
    [`${view}-by-the-turn`, `const to = new ${view}(3); to[turn] = x; return showList(Array.from(to));`],
    [`${view}-of-a-list`, `const to = new ${view}([x, 1]); return showList(Array.from(to));`],
  ]),
  [
    "a-data-view-as-an-integer",
    "const to = new DataView(new ArrayBuffer(8)); to.setInt32(0, x); return tell(to.getInt32(0));",
  ],
  [
    "a-data-view-as-a-double",
    "const to = new DataView(new ArrayBuffer(8)); to.setFloat64(0, x); return tell(to.getFloat64(0));",
  ],
  ["a-field-that-held-a-whole-number", "const to = { v: 9 }; to.v = x; return tell(to.v) + JSON.stringify(to);"],
  ["a-field-that-held-a-fraction", "const to = { v: 0.5 }; to.v = x; return tell(to.v) + JSON.stringify(to);"],
  ["a-field-of-a-new-record", "const to = { v: x }; return tell(to.v) + JSON.stringify(to);"],
  ["a-field-of-a-class", "const to = new Holder(); to.v = x; return tell(to.v) + tell(to.twice());"],
  ["a-field-set-in-a-constructor", "const to = new Made(x); return tell(to.v) + tell(to.twice());"],
  ["a-variable-of-the-module", "kept = x; return tell(kept) + tell(readKept());"],
  ["a-captured-variable", "let held = 9; const set = (y: number) => { held = y; }; set(x); return tell(held);"],
  [
    "a-key-of-a-map",
    'const to = new Map<number, string>([[second, "found"]]); return String(to.get(x)) + to.has(x) + tell([...to.set(x, "again").keys()][0]) + to.size;',
  ],
  ["a-value-of-a-map", 'const to = new Map<string, number>(); to.set("k", x); return tell(to.get("k")!);'],
  [
    "a-member-of-a-set",
    "const to = new Set<number>([second]); to.add(x); return to.size + tell([...to][0]) + to.has(x);",
  ],
  ["a-key-of-a-record", "const to: Record<number, number> = {}; to[x] = 1; return Object.keys(to).join() + to[x];"],
  ["a-template", "return `<${x}>`;"],
  ["a-text-of-it", "return String(x);"],
  ["joined-to-a-text", 'return x + "" + "|" + ("" + x);'],
  ["its-own-text", "return x.toString() + x.toString(2).length + x.toString(16);"],
  ["fixed", "return x.toFixed(1) + x.toPrecision(3) + x.toExponential(1);"],
  ["as-json", "return JSON.stringify(x) + JSON.stringify([x]) + JSON.stringify({ v: x });"],
  ["in-its-tongue", 'return x.toLocaleString("en-US");'],
  ...(
    [
      ["plus-one", "x + 1"], ["minus-one", "x - 1"], ["doubled", "x * 2"], ["squared", "x * x"], ["halved", "x / 2"], ["one-over-it", "1 / x"], ["its-remainder", "x % 2"],
      ["a-remainder-by-it", "7 % x"], ["negated", "-x"], ["to-the-second", "x ** 2"], ["plus-itself", "x + x"], ["times-minus-one", "x * -1"], ["plus-a-half", "x + 0.5"], ["times-zero", "x * 0"],
      ["plus-zero", "x + 0"], ["minus-zero", "x - 0"], ["plus-minus-zero", "x + -0"], ["its-size", "Math.abs(x)"], ["its-sign", "Math.sign(x)"], ["the-greater-of-it-and-zero", "Math.max(x, 0)"],
      ["the-lesser-of-it-and-zero", "Math.min(x, 0)"], ["its-root", "Math.sqrt(x)"], ["multiplied-as-integers", "Math.imul(x, 3)"], ["its-leading-zeros", "Math.clz32(x)"], ["as-a-float", "Math.fround(x)"],
      ["an-angle", "Math.atan2(x, -1)"], ["floored", "Math.floor(x)"], ["ceiled", "Math.ceil(x)"], ["rounded", "Math.round(x)"], ["truncated", "Math.trunc(x)"], ["or-zero", "x | 0"],
      ["shifted-by-nothing", "x >>> 0"], ["shifted-right", "x >> 1"], ["shifted-left", "x << 1"], ["masked", "x & 255"], ["flipped-in-one-bit", "x ^ 1"], ["inverted", "~x"], ["as-a-number", "Number(x)"], ["plus-signed", "+x"],
      ["divided-and-floored", "Math.floor(x / 3)"], ["divided-as-integers", "(x / 3) | 0"], ["hypotenuse", "Math.hypot(x, 0)"], ["a-power-of-two", "2 ** (x % 40)"],
    ] as [string, string][]
  ).map(([name, expression]): Sink => [name, told(expression)]), // prettier-ignore
  ["raised-by-one", "let y = x; y++; return tell(y) + tell(x);"],
  ["lowered-by-one", "let y = x; --y; return tell(y);"],
  ["summed-in-a-loop", "let sum = 0; for (let i = 0; i < 3; i++) sum += x; return tell(sum);"],
  ["multiplied-in-a-loop", "let product = 1; for (let i = 0; i < 3; i++) product *= x; return tell(product);"],
  ["the-bound-of-a-loop", "let turns = 0; for (let i = 0; i < x && i < 5; i++) turns++; return tell(turns);"],
  ["the-start-of-a-loop", "let last = -7; for (let i = x; i < x + 2 && last !== i; i++) last = i; return tell(last);"],
  ...(
    [
      ["less-than-the-second", "x < second"], ["at-most-the-second", "x <= second"], ["greater-than-the-second", "x > second"], ["the-second", "x === second"], ["not-the-second", "x !== second"],
      ["loosely-its-text", "(x as any) == String(second)"], ["the-same-value-as-the-second", "Object.is(x, second)"], ["the-same-value-as-zero", "Object.is(x, 0)"], ["the-same-value-as-minus-zero", "Object.is(x, -0)"],
      ["zero", "x === 0"], ["not-it", "!x"], ["one-or-two", "x ? 1 : 2"], ["or-five", "x || 5"], ["and-five", "x && 5"], ["unless-nothing", "(x as any) ?? 5"], ["no-number", "Number.isNaN(x)"], ["finite", "Number.isFinite(x)"],
      ["whole", "Number.isInteger(x)"], ["safe", "Number.isSafeInteger(x)"], ["its-kind", "typeof x"], ["found-in-a-list", "[second].includes(x)"], ["its-place-in-a-list", "[5, second].indexOf(x)"],
      ["less-than-a-fraction", "x < 0.5"], ["less-than-a-text", '(x as any) < "1"'], ["compared-with-a-big-integer", "(x as any) == BigInt(second)"],
    ] as [string, string][]
  ).map(([name, expression]): Sink => [`asked-${name}`, `return String(${expression.replace(/(?<!\()\bx\b(?! as)/g, "(x as number)")});`]), // prettier-ignore
  [
    "a-switch-over-it",
    'switch (x as number) { case 0: return "zero"; case 3: return "three"; case -1: return "minus one"; case 2147483647: return "greatest"; default: return "another"; }',
  ],
  ...(
    [
      ["a-list", "[5, 6, 7, 8][x]"], ["a-list-of-doubles", "[0.5, 6.5, 7.5, 8.5][x]"], ["a-parsed-list", 'JSON.parse("[5,6,7,8]")[x]'], ["a-text", '"abcd"[x]'], ["a-character", '"abcd".charAt(x)'],
      ["a-code", '"abcd".charCodeAt(x)'], ["a-view", "new Uint8Array([5, 6, 7, 8])[x]"], ["a-view-of-doubles", "new Float64Array([5, 6, 7, 8])[x]"], ["a-list-from-either-end", "[5, 6, 7, 8].at(x)"],
      ["whether-it-is-in-a-list", "x in [5, 6, 7, 8]"], ["a-list-cut-from-it", "[5, 6, 7, 8].slice(x).join()"], ["a-text-cut-from-it", '"abcd".slice(x)'], ["a-text-cut-up-to-it", '"abcd".substring(0, x)'],
      ["a-search-from-it", "[5, 6, 5, 6].indexOf(5, x)"], ["a-record", '({ 0: "a", 3: "b", "-1": "c" } as any)[x]'], ["what-own-it-has", "Object.hasOwn([5, 6, 7, 8], x)"],
    ] as [string, string][]
  ).map(([name, expression]): Sink => [`the-index-into-${name}`, `return String(${expression});`]), // prettier-ignore
  ["the-index-of-a-store", "const to = [5, 6, 7, 8]; to[x] = 1; return to.length + Object.keys(to).join();", 3000000],
  ["the-index-of-a-store-into-a-view", "const to = new Uint8Array(4); to[x] = 1; return to.join();"],
  [
    "the-length-of-a-new-list",
    "try { return String(new Array(x).length); } catch (error) { return (error as Error).name; }",
  ],
  [
    "the-length-of-a-list",
    "const to = [5, 6, 7, 8]; try { to.length = x; return to.length + to.join().slice(0, 9); } catch (error) { return (error as Error).name; }",
    3000000,
  ],
  [
    "the-length-of-a-view",
    "try { return String(new Uint8Array(x).length); } catch (error) { return (error as Error).name; }",
    3000000,
  ],
  [
    "the-times-of-a-text",
    'try { return String("ab".repeat(x).length); } catch (error) { return (error as Error).name; }',
    3000000,
  ],
  ["the-width-of-a-text", 'return String("ab".padStart(x).length);', 3000000],
  ["the-length-of-what-is-walked", "return String(Array.from({ length: x }).length);", 300],
  ["returned", "return tell(back(x));"],
  ["returned-by-a-closure", "return tell((() => x)());"],
  ["spread-into-a-call", "return tell(Math.max(...[x]));"],
  ["taken-apart", "const [y] = [x]; const { v } = { v: x }; return tell(y) + tell(v);"],
  ["among-the-arguments", "return tell(lastOf(1, x));"],
  ["yielded", "return tell([...once(x)][0]);"],
  ["thrown", "try { throw x; } catch (caught) { return tell(caught as number); }"],
  ["a-big-integer", "return String(BigInt(x));"],
  ["a-date", "return String(new Date(x).getTime());"],
  ["cloned", "return tell(structuredClone(x));"],
  [
    "handed-to-unseen-code",
    "return tell(JSON.parse(JSON.stringify([x]))[0]) + tell(Reflect.apply(back, undefined, [x]));",
  ],
  ["sorted-among-others", "return showList([5, x, -5, 0].sort((a, b) => a - b));"],
  ["the-answer-of-a-comparer", "return showList([2, 1].sort(() => x));"],
  ["reduced", "return tell([x, x].reduce((sum: number, each: number) => sum + each, 0));"],
  ["mapped", "return showList([1, 2].map(() => x));"],
];

const prelude = `function tell(value: number): string { return (Object.is(value, -0) ? "-0" : String(value)) + ";"; }
function showList(list: any[]): string {
  let ours = "", sum = 0;
  for (let i = 0; i < list.length; i++) ours += tell(list[i]);
  for (const each of list) sum = (sum * 5 + each) | 0;
  return [ours, sum, list.join(), JSON.stringify(list), list.indexOf(second), list.includes(second), String(list.slice()), structuredClone(list).map(tell).join("")].join(" ");
}
function turned(n: number): any { const list = JSON.parse("[0.5," + (Object.is(n, -0) ? "-0" : n) + "]"); list.push("x"); return list[1]; }
function refilled(n: number): { v: number } { const record = { v: 0.5 }; record.v = turned(n); return record; }
function back(value: number): number { return value; }
function lastOf(...all: number[]): number { return all[all.length - 1]; }
function* once(value: number): Generator<number> { yield value; }
class Holder { v = 9; twice(): number { return this.v * 2; } }
class Made { v: number; constructor(v: number) { this.v = v; } twice(): number { return this.v * 2; } }
let kept = 9;
function readKept(): number { return kept; }
const place: number = Number("1"), far: number = Number("5"), one: number = Number("1"), three: number = Number("3");
const yes: boolean = JSON.parse("true"), no: boolean = JSON.parse("false");
function maybe(n: number): { v?: number } { const record: { v?: number } = {}; if (yes) record.v = n; return record; }
function placed(at: number): string[] { const list = ["a", "b", "c", "d"]; if (at >= 0) list[at] = "x"; return list; }`;

/** The second part: numbers that are not whole, and what is no number at all. Each has forms of its own: nothing may be a hole, a field that is not there, an argument that was not handed. */
type Other = [name: string, text: string, kind: "number" | "nothing" | "marker" | "text"];
const others: Other[] = [
  ["not-a-number", "NaN", "number"],
  ["infinity", "Infinity", "number"],
  ["minus-infinity", "-Infinity", "number"],
  ["a-half", "0.5", "number"],
  ["minus-a-half", "-0.5", "number"],
  ["a-great-number", "1e21", "number"],
  ["the-least-number", "5e-324", "number"],
  ["undefined", "undefined", "nothing"],
  ["null", "null", "marker"],
  ["true", "true", "marker"],
  ["false", "false", "marker"],
  ["an-empty-text", '""', "text"],
  ["a-text-that-spells-three", '"3"', "text"],
  ["a-letter", '"a"', "text"],
];
type OtherRoad = [name: string, given: (text: string) => string, read: string, takes: (kind: Other[2]) => boolean];
const any = () => true;
const only =
  (...kinds: Other[2][]) =>
  (kind: Other[2]) =>
    kinds.includes(kind);
const otherRoads: OtherRoad[] = [
  ["written", text => text, "given", any],
  ["through-unseen-code", text => `Reflect.apply(same, undefined, [${text}])`, "given", any],
  ["read-off-written-values", text => `["t", ${text}]`, "given[1]", any],
  ["read-off-a-written-list-of-it", text => `[${text}, ${text}]`, "given[1]", any],
  ["pushed-to-parsed-doubles", text => `pushedTo("[0.5]", ${text})`, "given[1]", any],
  ["pushed-to-parsed-whole-numbers", text => `pushedTo("[7]", ${text})`, "given[1]", any],
  ["stored-into-written-doubles", text => `storedInto([0.5, 1.5], ${text})`, "given[1]", any],
  ["a-field-of-a-written-record", text => `{ v: ${text} }`, "given.v", any],
  ["a-field-that-held-a-fraction", text => `fieldOf({ v: 0.5 }, ${text})`, "given.v", any],
  ["a-field-that-held-a-whole-number", text => `fieldOf({ v: 9 }, ${text})`, "given.v", any],
  ["a-value-of-a-map", text => `new Map([["k", ${text}]])`, 'given.get("k")', any],
  ["the-answer-of-a-closure", text => `() => ${text}`, "given()", any],
  ["read-off-a-view-of-doubles", text => `new Float64Array([0.5, ${text}])`, "given[1]", only("number")],
  ["reckoned", text => `Number("${text}")`, "given * 1", only("number")],
  ["a-number-of-a-text", text => `"${text}"`, "Number(given)", only("number")],
  ["parsed", text => `JSON.parse(${JSON.stringify(text)})`, "given", only("marker", "text")],
  [
    "a-field-of-a-parsed-record",
    text => `JSON.parse(${JSON.stringify(`{"v":${text}}`)})`,
    "given.v",
    only("marker", "text"),
  ],
  ["a-hole", () => "[7, , 7]", "given[1]", only("nothing")],
  ["a-hole-among-doubles", () => "[0.5, , 0.5]", "given[1]", only("nothing")],
  ["a-hole-of-a-new-list", () => "new Array(3)", "given[1]", only("nothing")],
  ["beyond-the-end", () => "[7, 7]", "given[5]", only("nothing")],
  ["beyond-the-end-of-a-view", () => "new Float64Array(2)", "given[5]", only("nothing")],
  ["a-field-that-is-not-there", () => "{ w: 1 }", "given.v", only("nothing")],
  ["a-field-of-a-parsed-record-that-is-not-there", () => `JSON.parse('{"w":1}')`, "given.v", only("nothing")],
  ["an-argument-that-was-not-handed", () => "", "given", only("nothing")],
  ["the-answer-of-what-returns-nothing", () => "() => {}", "given()", only("nothing")],
  ["what-a-map-does-not-hold", () => "new Map()", 'given.get("k")', only("nothing")],
  ["void", () => "1", "void given", only("nothing")],
  ["beyond-the-end-of-whole-numbers-at-a-place-nobody-knows", () => "[7, 7]", "given[far]", only("nothing")],
  ["beyond-the-end-of-doubles-at-a-place-nobody-knows", () => "[0.5, 1.5]", "given[far]", only("nothing")],
  ["a-hole-among-doubles-at-a-place-nobody-knows", () => "[0.5, , 0.5]", "given[place]", only("nothing")],
  ["a-hole-among-whole-numbers-at-a-place-nobody-knows", () => "[7, , 7]", "given[place]", only("nothing")],
  ["a-field-that-may-hold-a-fraction", () => "1.5", "(no ? { v: given } : {} as any).v", only("nothing")],
  ["the-other-side-of-a-choice-of-a-fraction", () => "1.5", "no ? given : undefined", only("nothing")],
  ["the-other-side-of-a-choice-of-a-whole-number", () => "7", "no ? given : undefined", only("nothing")],
  ["read-off-written-doubles-at-a-place-nobody-knows", text => `[0.5, ${text}]`, "given[place]", only("number")],
  ["out-of-a-choice", text => text, "yes ? given : undefined", any],
  ["out-of-a-choice-with-a-fraction", text => text, "yes ? given : 1.5", any],
  ["a-comparison", text => `Number("${text === "true" ? 1 : 2}")`, "given === 1", kind => kind === "marker"],
  ["a-character-of-a-text", text => `"x" + ${text}`, "given.slice(1)", only("text")],
  ["a-template", text => text, "`${given}`", only("text")],
  ["joined", text => `[${text}]`, "given.join()", only("text")],
];
const otherQuestions: [name: string, open: (text: string) => string, close: string][] = [
  ["nothing-asked", () => "{", "}"],
  ["a-case", text => `switch (x) { case ${text}: {`, "} }"],
  ["a-case-beside-another", text => `switch (x) { case 77: return "other"; case ${text}: {`, "} }"],
  ["the-case-that-is-left", () => `switch (x) { case 77: return "other"; default: {`, "} }"],
  ["is-it", text => `if (x === ${text}) {`, "}"],
  ["is-it-loosely", text => `if (x == ${text}) {`, "}"],
  ["is-the-same-value", text => `if (Object.is(x, ${text})) {`, "}"],
  ["is-the-second", () => `if (x === second) {`, "}"],
  ["its-kind-is-the-seconds", () => `if (typeof x === typeof second) {`, "}"],
  ["is-a-number", () => `if (typeof x === "number") {`, "}"],
  ["is-no-number", () => `if (typeof x !== "number") {`, "}"],
  ["is-no-object", () => `if (typeof x !== "object") {`, "}"],
  ["is-not-whole", () => `if (!Number.isInteger(x)) {`, "}"],
  ["is-not-itself", () => `if (x !== x) {`, "}"],
  ["is-itself", () => `if (x === x) {`, "}"],
  ["is-nothing-loosely", () => `if (x == null) {`, "}"],
  ["is-something-loosely", () => `if (x != null) {`, "}"],
  ["is-not-undefined", () => `if (x !== undefined) {`, "}"],
  ["holds", () => `if (x) {`, "}"],
  ["does-not-hold", () => `if (!x) {`, "}"],
  ["is-not-finite", () => `if (!Number.isFinite(x)) {`, "}"],
  ["is-less-than-one", () => `if (x < 1) {`, "}"],
];
const otherPrelude = `function same(value: any): any { return value; }
function pushedTo(text: string, value: any): any[] { const list = JSON.parse(text); list.push(value); return list; }
function storedInto(list: any[], value: any): any[] { list[1] = value; return list; }
function fieldOf(record: any, value: any): any { record.v = value; return record; }`;

const erase = new Bun.Transpiler({ loader: "ts", target: "bun" });
type Program = { name: string; text: string };
/**
 * Where the sink stands. A sink is what it lays out, what it does with x, and what it tells afterwards. In a loop only the deed stands in the turn: a list that is made in front of a loop and stored to in its
 * turns is built otherwise than one that is made, stored to and told in one turn. Nobody knows how many turns the loop runs.
 */
const places = ["straight", "the-deed-in-a-loop-behind-the-question", "the-deed-in-a-loop-with-the-question"] as const;
function parted(block: string): [laidOut: string, deed: string, told: string] {
  const found = /^((?:const|let) to\b[^;]*;) (.+) return ([^;]+);$/.exec(block);
  if (found && !/\bx\b/.test(found[1]) && !/\breturn\b/.test(found[2])) return [found[1], found[2], found[3]];
  // One expression: the turn keeps what it gives, and it is told behind the loop. A turn that puts a text together is built otherwise than a quiet one, and a question that a quiet turn answered wrongly was answered rightly there.
  const one = /^return (tell|String)\((.+)\);$/.exec(block);
  if (one && !/\) \+ /.test(one[2])) return ["let last: any;", `last = ${one[2]};`, `${one[1]}(last)`];
  const word = block.startsWith("switch") ? "{ answer += $1; break; }" : "answer += $1;";
  return ['let answer = "";', block.replace(/\breturn ([^;]+);/g, word), "answer"];
}
function laid(place: (typeof places)[number], open: string, block: string, close: string): string {
  const [laidOut, deed, told] = parted(block);
  const loop = (inside: string) => `for (let turn = 0; turn < three; turn++) { ${inside} }`;
  if (place === "straight")
    return `${open} ${laidOut} { const turn = 0; ${deed} } return ${told}; ${close} return "not taken";`;
  return place === "the-deed-in-a-loop-behind-the-question"
    ? `${laidOut} ${open} ${loop(deed)} return ${told}; ${close} return "not taken";`
    : `${laidOut} ${loop(`${open} ${deed} ${close}`)} return ${told};`;
}
const whole = values.length * questions.length * sinks.length * places.length * 2;
const all = whole + others.length * otherQuestions.length * sinks.length * places.length;
function writeOther(at: number): Program | undefined {
  const take = <T>(from: readonly T[]) => {
    const one = from[at % from.length];
    at = Math.floor(at / from.length);
    return one;
  };
  const place = take(places);
  const [value, spelled, kind] = take(others);
  const [question, open, close] = take(otherQuestions);
  const [sink, block, most] = take(sinks);
  // A length of 1e21 or of infinity is refused at once; nothing here lays out memory.
  if (most !== undefined && most < 1000 && kind === "number") return undefined;
  const taken = otherRoads.filter(
    ([road, , , takes]) => takes(kind) && (road !== "a-comparison" || /^(?:true|false)$/.test(spelled)),
  );
  const functions = taken.map(
    ([, , read], index) =>
      `function go${index}(given?: any): string { const x: any = ${read}; ${laid(place, open(spelled), block, close)} }`,
  );
  // A sink may refuse the value. What it throws is an answer like any other, and it is caught where the function is called, not in it.
  const calls = taken.map(
    ([road, given], index) =>
      `try { say(${JSON.stringify(road)}, go${index}(${given(spelled)})); } catch (error) { if (parted) throw error; say(${JSON.stringify(road)}, "threw " + (error as Error).name); }`,
  );
  const text = `${prelude}
${otherPrelude}
const second: any = same(${spelled});
${functions.join("\n")}
let first: string | undefined, parted = false;
function say(road: string, answer: string): void {
  console.log(road, answer);
  first ??= answer;
  if (answer !== first) { parted = true; throw new Error(road + " says otherwise than the value as it is written"); }
}
${calls.join("\n")}
export {};
`;
  return {
    name: `${value}--${question}--${sink}--${place}.mjs`,
    text: erase.transformSync(text),
  };
}
function write(at: number): Program | undefined {
  if (at >= whole) return writeOther(at - whole);
  const take = <T>(from: readonly T[]) => {
    const one = from[at % from.length];
    at = Math.floor(at / from.length);
    return one;
  };
  const isTypeScript = take([false, true]);
  const place = take(places);
  const value = take(values);
  const [question, open, close] = take(questions);
  const [sink, block, most] = take(sinks);
  if (most !== undefined && Math.abs(value[2]) > most) return undefined;
  const taken = roads.filter(road => !road[5] || road[5](value));
  const functions = taken.map(
    ([, , type, read], index) =>
      `function go${index}(given: ${type}): string { const x: ${type === "any" ? "any" : "number"} = ${read}; ${laid(place, open(value), block, close)} }`,
  );
  const calls = taken.map(
    ([road, given, , , keeps], index) => `say(${JSON.stringify(road)}, go${index}(${given(value)}), ${keeps(value)});`,
  );
  const text = `${prelude}
const second: number = JSON.parse("${value[1]}");
${functions.join("\n")}
let first: string | undefined;
function say(road: string, answer: string, keeps: boolean): void {
  console.log(road, answer);
  if (!keeps) return;
  first ??= answer;
  if (answer !== first) throw new Error(road + " says otherwise than the value as it is written");
}
${calls.join("\n")}
export {};
`;
  return {
    name: `${value[0]}--${question}--${sink}--${place}.${isTypeScript ? "ts" : "mjs"}`,
    text: isTypeScript ? text : erase.transformSync(text),
  };
}

const pad = (at: number) => String(at).padStart(6, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, most] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < most; at++) {
    const program = write(at);
    if (!program || !pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let step = 0; step < count; step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    if (!program) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
}
