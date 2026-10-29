// An array literal of a few thousand elements, around the lengths at which a compiler may build a literal in another way. A program draws a
// length, what the elements are (numbers, texts, holes, spreads, calls that log, throw or change what later elements read, computed numbers)
// and where the literal stands. It prints the length, a hash over every element with holes told apart, the elements around 4,095, the last
// three, and the order in which the calls inside the literal ran.
import type { Random } from "./random";

const lengths = [4094, 4095, 4096, 4097, 4100, 5000, 8192, 12289];
const text = (i: number) => `"s${i}"`;
const kinds: Record<string, (i: number, n: number) => string> = {
  // Numbers that are computed where the literal stands.
  "computed-integers": i => `x + ${i}`,
  "computed-doubles": i => `y * ${i}`,
  "computed-integers-and-doubles": i => (i % 2 ? `x + ${i}` : `y + ${i}`),
  "computed-and-holes": i => (i % 7 === 3 ? "" : `x + ${i}`),
  "computed-and-holes-at-the-end": (i, n) => (i > n - 4 ? "" : `x * ${i}`),
  "computed-that-overflow": i => `x * 1000000000 + ${i}`,
  "computed-minus-zero-and-nan": i => (i % 3 === 0 ? "-x * 0" : i % 3 === 1 ? "y / 0 - y / 0" : `x - ${i}`),
  "computed-by-calls": i => `n(${i})`,
  "computed-and-a-call-that-changes-x": i => (i % 1000 === 500 ? "raise()" : `x + ${i}`),
  "computed-and-a-call-that-throws": (i, n) => (i === n - 3 ? `fail(${i})` : `x + ${i}`),
  "computed-and-one-text": i => (i === 4095 ? `"t" + x` : `x + ${i}`),
  "computed-and-one-undefined": i => (i === 2000 ? "nothing" : `x + ${i}`),
  "computed-conditionals": i => `(x > ${i % 5} ? ${i} : y)`,
  "computed-increments": () => "x++",
  "computed-and-constants-in-turn": i => (i % 2 ? `x + ${i}` : String(i)),
  "computed-members": i => `box.a + ${i}`,
  "texts": text,
  "one-text-many-times": () => '"x"',
  "three-texts-in-turn": i => ['"a"', '"b"', '"c"'][i % 3],
  "numbers-and-a-text-first": i => (i === 0 ? '"t"' : String(i)),
  "numbers-and-a-text-last": (i, n) => (i === n - 1 ? '"t"' : String(i)),
  "numbers-and-a-text-at-the-limit": i => (i === 4095 ? '"t"' : String(i)),
  "texts-and-numbers-in-turn": i => (i % 2 ? text(i) : String(i)),
  "texts-and-holes": i => (i % 7 === 3 ? "" : text(i)),
  "words": i => (i % 5 === 4 ? text(i) : ["null", "undefined", "true", "false"][i % 4]),
  "bigints": i => (i % 3 ? text(i) : i + "n"),
  "templates": i => "`t" + i + "`",
  "calls": i => (i % 1000 === 500 ? `f(${i})` : text(i)),
  "objects": i => (i % 500 === 250 ? `{ a: ${i} }` : text(i)),
  "nested-arrays": i => (i % 500 === 250 ? `["n", ${i}]` : text(i)),
  "a-spread": (i, n) => (i === n >> 1 ? "...more" : text(i)),
  "doubles": i => (i % 4 === 0 ? text(i) : ["1.5", "-0", "NaN"][i % 3]),
  "a-variable-that-calls-change": i => (i % 1000 === 500 ? "bump()" : i % 10 === 0 ? "v" : text(i)),
  "a-call-that-throws": (i, n) => (i === n - 3 ? `fail(${i})` : i % 1000 === 500 ? `f(${i})` : text(i)),
  "regular-expressions": i => (i % 800 === 400 ? "/r/g" : text(i)),
  "functions": i => (i % 800 === 400 ? `() => ${i}` : text(i)),
  "symbols": i => (i % 900 === 1 ? "Symbol.iterator" : text(i)),
};
const written = (elements: string[]) => {
  const rows = [];
  for (let i = 0; i < elements.length; i += 20) rows.push(elements.slice(i, i + 20).join(", "));
  return "[\n" + rows.join(",\n") + "\n]";
};
const replaced = (elements: string[], changes: Record<number, string>) =>
  elements.map((element, i) => changes[i] ?? element);
const homes: Record<string, (e: string[]) => string> = {
  "top-level": e => `const a = ${written(e)};\nreport(a);`,
  "a-function-called-twice": e =>
    `function make() { return ${written(e)}; }\nconst a = make(); a[0] = "changed"; a.length = 10;\nconst b = make(); report(b); console.log(a !== b, a.length);`,
  "an-argument": e => `report(${written(e)});`,
  "a-static-field": e => `class K { static list = ${written(e)}; }\nreport(K.list);`,
  "a-generator": e =>
    `function* g() { report(${written(replaced(e, { 10: "(yield 10)", [e.length - 2]: "(yield 11)" }))}); }\nconst it = g(); console.log(it.next().value); console.log(it.next("first").value); it.next("second");`,
  "an-async-function": e =>
    `async function g() { report(${written(replaced(e, { 10: "(await 10)", [e.length - 2]: "(await tick())" }))}); }\nawait g();`,
  "a-loop": e => `for (let round = 0; round < 3; round++) report(${written(e)});`,
  "a-pattern": e =>
    `const [first, , third, ...rest] = ${written(e)};\nreport(rest); console.log(show(first), show(third));`,
};

export function generate(random: Random): string {
  const n = random.pick(lengths);
  const kind = random.pick(Object.values(kinds));
  const home = random.pick(Object.values(homes));
  const elements = Array.from({ length: n }, (_, i) => kind(i, n));
  return `const log = [];
let v = 0;
let x = 3, y = 1.5, calls = 0, nothing;
const box = { a: 2 };
function n(i) { calls++; return i * 2; }
function raise() { x += 10; log.push("raise"); return x; }
const more = ["m1", 2, "m3"];
function f(i) { log.push("f" + i); return "f" + i; }
function bump() { v++; log.push("bump"); return "bumped"; }
function fail(i) { log.push("fail"); throw new RangeError("fail " + i); }
async function tick() { log.push("tick"); return "ticked"; }
function show(value) {
  return typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "function" ? "function " + value() : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) + JSON.stringify(value) : String(value);
}
function report(a) {
  const parts = [];
  for (let i = 0; i < a.length; i++) parts.push(i in a ? show(a[i]) : "hole");
  console.log(a.length, Bun.hash(parts.join("\\u0001")).toString(36), parts.slice(4088, 4100).join(","), parts.slice(-3).join(","));
}
try {
${home(elements)}
} catch (error) {
  console.log(error.name, error.message);
}
console.log(log.join(), v, x, calls);
`;
}
