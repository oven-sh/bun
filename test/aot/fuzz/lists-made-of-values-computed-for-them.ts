// `const a = (f(1) | 0) + 6; const b = (f(2) | 0) + 1; use(Array.of(a, b, ..))`: values that are computed for a list and used by it alone.
// A compiler may make the list first and compute such a value behind the allocation, straight into its place; how it may do that goes by
// the way the list is made (a literal, Array.of, Array, new Array, with a spread, with a hole), by the number of elements (short lists,
// lists of five to sixteen and longer ones take different roads), by the kind of each value and by what stands around: a try block, a
// loop, an await or a yield between the values and the list, a call among them that throws. Each scene draws all of these.
import type { Random } from "./random";

/** `K` is a number of its own, `C` a small constant. */
const values = [
  "(pass(K) | 0) + C",
  "(pass(K) | 0) + C",
  "(pass(K) | 0) + C",
  "(first | 0) + C",
  "(first | 0) * C",
  "pass(K) | 0",
  "pass(K) >>> 0",
  "pass(K) + C",
  "pass(K) * 0.5",
  "pass(K) / 4 + C",
  "Math.floor(pass(K) / 3)",
  "first + C",
  "pass(K)",
  "pass(second)",
  "String(pass(K))",
  '"text" + C',
  "pass(K) > C",
  "null",
  "undefined",
  "{ held: pass(K) }",
  "[pass(K)]",
  "-0",
  "pass(K) * 1e10",
  "2147483647 + (pass(K) | 0)",
  "BigInt(C)",
];

/** `E` is the elements, with commas. */
const makers = [
  "[E]",
  "[E]",
  "Array.of(E)",
  "Array.of(E)",
  "Array.of(E)",
  "Array(E)",
  "Array(E)",
  "new Array(E)",
  "[E, ...more]",
  "[...more, E]",
  "[E, , C]",
  "Array.from([E])",
  "Object.freeze([E])",
  "[E].slice()",
  "[E].concat(more)",
  "[[E], [E]]",
  "{ list: [E] }.list",
  "Array.of.call(Array, E)",
  "Array.of(...[E])",
  "new Set([E]).size",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  const drives: string[] = [];
  let key = 70;
  const count = random.between(1, 4);
  for (let scene = 0; scene < count; scene++) {
    const size = random.pick([0, 1, 2, 3, 4, 4, 5, 5, 5, 6, 6, 7, 8, 12, 15, 16, 16, 17, 18, 33]);
    // Most lists hold one kind of value.
    const kinds = random.chance(0.6) ? [random.pick(values)] : values;
    const value = () =>
      random
        .pick(kinds)
        .replace(/\bK\b/g, () => String(key++))
        .replace(/\bC\b/g, () => String(random.below(7)));
    const isWrittenInPlace = random.chance(0.3);
    const names = Array.from({ length: size }, (_, at) => `made${at}`);
    const declared = isWrittenInPlace ? [] : names.map(name => `const ${name} = ${value()};`);
    const elements = (isWrittenInPlace ? names.map(value) : names).join(", ");
    const maker = random.pick(size ? makers : ["[]", "Array.of()", "Array()", "new Array()"]);
    const list = maker.replace(/\bE\b/g, elements).replace(/\bC\b/g, String(random.below(7)));
    const kind = random.pick([
      "function",
      "function",
      "async function",
      "async function",
      "function*",
      "async function*",
    ]);
    const pause = kind.includes("*") ? "yield sum;" : kind.startsWith("async") ? "await null;" : "";
    const between = random.chance(0.3) && pause ? [pause] : [];
    const alsoUsed = !isWrittenInPlace && size && random.chance(0.25) ? [`sum = mix(sum, ${random.pick(names)});`] : [];
    const body = [...declared, ...between, `sum = mix(sum, ${list});`, ...alsoUsed].join("\n");
    const looped = random.pick([
      body,
      body,
      `for (let turn = 0; turn < ${random.pick(["1", "2", "3", "9", "depth"])}; turn++) {\n${body}\n}`,
      `for (let turn = 0; turn < ${random.pick(["2", "3", "depth"])}; turn++) {\n${body}\n}`,
      `for (const each of more) {\n${body}\n}`,
      `if (first > 1) {\n${body}\n} else {\nsum = mix(sum, first);\n}`,
    ]);
    const wrapped = random.pick([
      looped,
      looped,
      `try {\n${looped}\n} finally {\nsum = mix(sum, "finally");\n}`,
      `try {\n${looped}\n} finally {\n}`,
      `try {\n${looped}\n} catch (error) {\nsum = mix(sum, error.message);\n}`,
      `try {\ntry {\n${looped}\n} finally {\nsum = mix(sum, "inner");\n}\n} catch (error) {\nsum = mix(sum, error.message);\n}`,
    ]);
    const drive = kind.includes("*")
      ? kind.startsWith("async")
        ? `for await (const step of run${scene}(A)) note("step", step);`
        : `for (const step of run${scene}(A)) note("step", step);`
      : `note("answer", await run${scene}(A));`;
    scenes.push(`${kind} run${scene}(first, second, depth) {
let sum = 1;
const more = [first, second];
${wrapped}
${kind.includes("*") ? "yield sum;" : "return sum;"}
}`);
    drives.push(`for (const given of [[2.5, 7, 1], [3, "two", 2], [-1, null, 0]]) {
  throwsAt = ${random.chance(0.25) ? `passes + ${random.below(size + 2)}` : "-1"};
  try {
    ${drive.replace("A", "...given")}
  } catch (error) {
    note("thrown", error.message);
  }
}`);
  }
  return `const passers = [value => value, value => value];
let passes = 0;
let throwsAt = -1;
function pass(value) {
  if (passes === throwsAt) {
    passes++;
    throw new RangeError("from pass " + value);
  }
  return passers[passes++ & 1](value);
}
function show(value) {
  if (typeof value === "bigint") return value + "n";
  if (Object.is(value, -0)) return "-0";
  if (Array.isArray(value)) {
    // Array(n) with one number makes a list of that length.
    if (value.length > 200) return "[" + value.length + " long]";
    let text = "";
    for (let at = 0; at < value.length; at++) text += (at ? "," : "") + (at in value ? show(value[at]) : "hole");
    return "[" + text + "]" + (Object.isFrozen(value) ? "F" : "");
  }
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
function mix(sum, value) {
  const text = show(value);
  lines.push(text.length > 90 ? text.slice(0, 90) + ".." + text.length : text);
  for (let at = 0; at < text.length; at++) sum = (sum * 31 + text.charCodeAt(at)) | 0;
  return sum;
}
const lines = [];
function note(label, value) {
  console.log(label, show(value), lines.splice(0).join(" ; "));
}
${scenes.join("\n")}
async function main() {
${drives.join("\n")}
}
main().then(
  () => console.log("done"),
  error => console.log("failed", error.message),
);
`;
}
