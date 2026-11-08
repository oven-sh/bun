// Is a value that has gone a short way round still the same value: the question, times the way round, times the value, times whether the value is used otherwise, times where it is made, untyped and with
// written types. Each program holds one of each and as good as nothing else, and is built alone.
//
//   bun write-identity-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<question>--<way>--<value>--<use>--<place>.js | .ts
//   bun write-identity-sweep.ts count
//   bun write-identity-sweep.ts named <pattern> <folder> [most]
//
// A compiler that shares a literal nobody changes, leaves an object unmade, or copies a small function in line gives a value more than one name. Whoever then answers a question of identity by the names
// answers it wrongly: `Object.is(id(v), v)` is true whatever `v` is, and one literal that is evaluated twice gives two objects. A use of the value in front of the question may settle what the compiler
// makes of it, so the value is used otherwise only where the name of the program says so. The first 17,458 programs are every question, way and value with a constant of the file that is not used otherwise.
import { mkdirSync, writeFileSync } from "fs";

// A is the value behind its way round, B the value. ANY and RET are the types written in a typed file.
const questions: [string, string, string][] = [
  ["object-is", "", "Object.is(A, B)"],
  ["object-is-the-other-way-round", "", "Object.is(B, A)"],
  ["object-is-under-a-written-key", "", 'Object["is"](A, B)'],
  ["object-is-as-the-test-of-an-if", "", '(() => {\n  if (Object.is(A, B)) return "same";\n  return "other";\n})()'],
  ["strictly-the-same", "", "A === B"],
  ["strictly-another", "", "A !== B"],
  ["loosely-the-same", "", "A == B"],
  ["a-list-includes-it", "", "[B].includes(A)"],
  ["its-place-in-a-list", "", "[B].indexOf(A)"],
  ["how-many-a-set-holds", "", "new Set([A, B]).size"],
  ["a-set-has-it", "", "new Set([B]).has(A)"],
  ["a-map-finds-it", "", "new Map([[B, 1]]).get(A)"],
  ["object-is-in-a-function", "function same(aANY, bANY)RET {\n  return Object.is(a, b);\n}", "same(A, B)"],
  ["a-case-of-a-switch", "", "(() => {\n  switch (A) {\n    case B:\n      return true;\n  }\n  return false;\n})()"],
];

const arrow = "const id = (xANY)RET => x;";
// What is declared in front of the value, what behind it, and the value behind its way round.
const ways: [string, string, string, string][] = [
  ["itself", "", "", "v"],
  ["through-an-arrow", arrow, "", "id(v)"],
  ["through-a-declared-function", "function id(xANY)RET {\n  return x;\n}", "", "id(v)"],
  ["through-a-method", "const holder = {\n  id(xANY)RET {\n    return x;\n  },\n};", "", "holder.id(v)"],
  ["through-a-static-method", "class Holder {\n  static id(xANY)RET {\n    return x;\n  }\n}", "", "Holder.id(v)"],
  ["through-object", "", "", "Object(v)"],
  [
    "as-a-fallback",
    "const orDefault = (givenANY, fallbackANY)RET => given ?? fallback;",
    "",
    "orDefault(undefined, v)",
  ],
  ["behind-a-comma", "", "", "(0, v)"],
  ["out-of-a-list", "", "", "[v][0]"],
  ["out-of-a-record", "", "", "({ k: v }).k"],
  ["out-of-an-arrow-called-at-once", "", "", "(() => v)()"],
  ["behind-or", "", "", "(v || v)"],
  ["in-front-of-a-default", "", "", "(v ?? 0)"],
  ["as-an-arm-of-a-choice", "", "", "(v === 1 ? 0 : v)"],
  ["through-an-arrow-into-a-constant", arrow, "const w = id(v);", "w"],
  ["by-a-pattern-over-a-list", "", "const [w] = [v];", "w"],
  ["by-a-pattern-over-a-record", "", "const { w } = { w: v };", "w"],
  ["by-call", arrow, "", "id.call(null, v)"],
  ["by-apply", arrow, "", "id.apply(null, [v])"],
  ["by-reflection", arrow, "", "Reflect.apply(id, null, [v])"],
  ["through-map", arrow, "", "[v].map(id)[0]"],
  ["by-at", "", "", "[v].at(0)"],
  ["out-of-a-generator", "", "", "(function* () {\n  yield v;\n})().next().value"],
  ["as-the-default-of-a-parameter", "", "", "((x = v) => x)()"],
  ["out-of-the-rest", "", "", "((...allLIST) => all[0])(v)"],
  ["through-two-arrows", `${arrow}\nconst again = (xANY)RET => id(x);`, "", "again(v)"],
  ["through-a-bound-function", `${arrow}\nconst bound = id.bind(null);`, "", "bound(v)"],
  [
    "through-a-function-under-a-key-made-at-run-time",
    'const given = (valueANY)RET => Number(process.argv[9] ?? value);\nconst hANY = {};\nh["g" + given(1)] = (xANY)RET => x;',
    "",
    'h["g" + given(1)](v)',
  ],
  ["made-twice-by-one-arrow", "const make = ()RET => VALUE;", "", "make()"],
];

const values: [string, string][] = [
  ["a-pattern", "/r/"],
  ["a-pattern-with-a-flag", "/r/g"],
  ["a-pattern-made-of-a-written-text", 'new RegExp("r")'],
  ["a-pattern-made-without-new", 'RegExp("r")'],
  ["an-empty-pattern-made-of-a-written-text", 'new RegExp("")'],
  ["an-empty-list", "[]"],
  ["a-list", "[1, 2]"],
  ["an-empty-record", "{}"],
  ["a-record", "{ a: 1 }"],
  ["an-arrow", "() => 1"],
  ["a-function", "function () {}"],
  ["a-class", "class {}"],
  ["a-date", "new Date(0)"],
  ["a-map", "new Map()"],
  ["a-set", "new Set()"],
  ["a-weak-map", "new WeakMap()"],
  ["a-symbol", "Symbol()"],
  ["a-registered-symbol", 'Symbol.for("s")'],
  ["a-well-known-symbol", "Symbol.iterator"],
  ["a-big-integer", "1n"],
  ["not-a-number", "NaN"],
  ["minus-zero", "-0"],
  ["zero", "0"],
  ["a-fraction", "1.5"],
  ["a-text", '"text"'],
  ["a-template", "`t`"],
  ["true", "true"],
  ["null", "null"],
  ["undefined", "undefined"],
  ["a-text-in-an-object", 'Object("s")'],
  ["a-number-in-an-object", "new Number(1)"],
  ["a-view", "new Uint8Array(2)"],
  ["a-buffer", "new ArrayBuffer(2)"],
  ["a-promise", "Promise.resolve(1)"],
  ["a-proxy", "new Proxy({}, {})"],
  ["a-bound-function", "(() => 1).bind(null)"],
  ["an-error", 'new Error("e")'],
  ["a-url", 'new URL("http://h.example/")'],
  ["the-texts-of-a-tagged-template", "((xANY) => x)`t`"],
  ["a-namespace-of-the-language", "Math"],
  ["the-global-object", "globalThis"],
  ["a-prototype-of-the-language", "Array.prototype"],
  ["a-function-of-the-language", "Array.isArray"],
];

const keeps = "(globalThisAS).kept = v;";
// What stands in front of the question and what behind it.
const uses: [string, string, string][] = [
  ["not-used-otherwise", "", ""],
  ["tested-in-front", 'if (v === 1) console.log("one");', ""],
  ["handed-on-in-front", keeps, ""],
  ["handed-on-behind", "", keeps],
];

const places: [string, string][] = [
  ["a-constant-of-the-file", "BODY"],
  ["a-constant-of-a-function", "function asks() {\n  BODY\n}\nasks();"],
  ["a-constant-of-a-turn", "for (let turn = 0; turn < 2; turn++) {\n  BODY\n}"],
  [
    "a-constant-of-a-turn-of-a-loop-whose-bound-the-run-gives",
    "const turns = (valueANY)RET => Number(process.argv[9] ?? value);\nfor (let turn = 0; turn < turns(2); turn++) {\n  BODY\n}",
  ],
  [
    "a-constant-of-a-function-that-such-a-loop-calls",
    "const turns = (valueANY)RET => Number(process.argv[9] ?? value);\nfunction asks() {\n  BODY\n}\nfor (let turn = 0; turn < turns(3); turn++) asks();",
  ],
];

const files = ["js", "ts"] as const;

const all = questions.length * ways.length * values.length * uses.length * places.length * files.length;

const indented = (text: string, by: string) =>
  text
    .split("\n")
    .map((line, at) => (line && at ? by + line : line))
    .join("\n");

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [question, forQuestion, asked] = pick(questions);
  const [way, inFront, behind, other] = pick(ways);
  const [value, made] = pick(values);
  const [use, before, after] = pick(uses);
  const [place, shape] = pick(places);
  const file = pick(files);
  const typed = (text: string) =>
    text
      .replaceAll("VALUE", /^[{]|^function|^class/.test(made) ? `(${made})` : made)
      .replaceAll("LIST", file === "ts" ? ": any[]" : "")
      .replaceAll("ANY", file === "ts" ? ": any" : "")
      .replaceAll("RET", file === "ts" ? ": any" : "")
      .replaceAll("AS", file === "ts" ? " as any" : "");
  const first = way === "made-twice-by-one-arrow" ? "make()" : made;
  const body = [`const vANY = ${first};`, behind, before, `console.log(${asked.replaceAll("A", "\u0001").replaceAll("B", "v").replaceAll("\u0001", other)});`, after].filter(Boolean).join("\n"); // prettier-ignore
  const text = [forQuestion, inFront, shape.replace("BODY", () => indented(body, shape === "BODY" ? "" : "  "))]
    .filter(Boolean)
    .join("\n");
  return { name: `${question}--${way}--${value}--${use}--${place}.${file}`, text: typed(text) + "\n" };
}

const pad = (at: number) => String(at).padStart(6, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
