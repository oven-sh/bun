// A getter is laid on an object by a descriptor, and the property is read: how the getter is given, times how it is laid, times what it is laid on, times where the property is read, times what is asked of
// what was read, times the kind of file. Each program holds one of each and is built alone.
//
//   bun write-laid-getter-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<given>--<laid>--<on>--<read>--<asked>.mjs or .ts
//   bun write-laid-getter-sweep.ts count
//   bun write-laid-getter-sweep.ts named <pattern> <folder> [most]
import { mkdirSync, writeFileSync } from "fs";

// What stands in front, and the expression that gives the getter. ANY is `: any` in TypeScript and nothing elsewhere.
const givens: [string, string, string][] = [
  ["an-arrow", "", "() => 7"],
  ["an-async-arrow", "", "async () => 7"],
  ["a-function", "", "function () {\n  return 7;\n}"],
  ["an-async-function", "", "async function () {\n  return 7;\n}"],
  [
    "a-method-of-an-instance",
    "class Maker {\n  load() {\n    return 7;\n  }\n}\nconst maker = new Maker();",
    "maker.load",
  ],
  ["a-static-method", "class Maker {\n  static load() {\n    return 7;\n  }\n}", "Maker.load"],
  ["out-of-a-list", "const list = [() => 7, () => 8];", "list[0]"],
  ["out-of-a-map", 'const table = new Map([["k", () => 7]]);', 'table.get("k")'],
  ["out-of-a-record", "const kit = { load: () => 7 };", "kit.load"],
  ["a-name-taken-out-of-a-record", "const { load } = { load: () => 7 };", "load"],
  ["made-by-a-call", "const make = () => () => 7;", "make()"],
  ["a-bound-function", "function load(thisANY) {\n  return 7;\n}", "load.bind(null)"],
  ["a-constant", "const load = () => 7;", "load"],
  ["a-let-that-was-stored-twice", "let load = () => 8;\nload = () => 7;", "load"],
  [
    "a-choice-that-the-run-makes",
    "const first = () => 7;\nconst second = () => 8;",
    'JSON.parse("true") ? first : second',
  ],
  ["a-function-of-the-library", "", "Object.prototype.toString"],
  [
    "a-helper-that-runs-it-once",
    "const once = (runANY) => {\n  let doneANY;\n  return () => (done ??= run());\n};",
    "once(() => 7)",
  ],
  ["a-generator-function", "", "function* () {\n  yield 7;\n}"],
];

// TARGET is what the getter is laid on, GETTER the expression.
const laids: [string, string][] = [
  ["define-property", 'Object.defineProperty(TARGET, "part", { get: GETTER });'],
  ["define-properties", "Object.defineProperties(TARGET, { part: { get: GETTER } });"],
  ["by-reflection", 'Reflect.defineProperty(TARGET, "part", { get: GETTER });'],
  [
    "a-descriptor-kept-first",
    'const how = { get: GETTER, enumerable: true };\nObject.defineProperty(TARGET, "part", how);',
  ],
  [
    "handed-to-a-function-that-lays-it",
    'function lay(targetANY, getANY) {\n  Object.defineProperty(target, "part", { get });\n}\nlay(TARGET, GETTER);',
  ],
  ["by-the-old-method", '(TARGETAS).__defineGetter__("part", GETTER);'],
];

// LAY is the statement that lays the getter on TARGET.
const ons: [string, string, string][] = [
  ["an-empty-record", "holder", "const holderANY = {};\nLAY"],
  ["a-record-with-fields", "holder", "const holderANY = { a: 1, b: 2 };\nLAY"],
  ["an-instance", "holder", "class Held {\n  a = 1;\n}\nconst holderANY = new Held();\nLAY"],
  ["this-in-a-constructor", "this", "class Held {\n  constructor() {\n    LAY\n  }\n}\nconst holderANY = new Held();"],
];

// ASK is what is asked of VALUE, the read.
const reads: [string, string, string][] = [
  ["straight", "holder.part", "out += ASK;"],
  ["in-a-loop", "holder.part", 'for (let i = 0; i < 9; i++) out += ASK + "|";'],
  ["in-a-while-loop", "holder.part", 'let i = 0;\nwhile (i++ < 9) out += ASK + "|";'],
  ["in-a-loop-over-a-list", "holder.part", 'for (const each of [1, 2, 3]) out += ASK + each + "|";'],
  [
    "in-a-function-called-from-a-loop",
    "holder.part",
    'function deed() {\n  return ASK;\n}\nfor (let i = 0; i < 9; i++) out += deed() + "|";',
  ],
  ["awaited-in-a-loop", "(await holder.part)", 'for (let i = 0; i < 9; i++) out += ASK + "|";'],
  ["under-a-made-key-in-a-loop", "holder[JSON.parse('\"part\"')]", 'for (let i = 0; i < 9; i++) out += ASK + "|";'],
];

const askeds: [string, string][] = [
  ["made-a-text", "String(VALUE)"],
  ["asked-for-its-kind", "typeof VALUE"],
  ["asked-whether-it-is-a-promise", '(VALUE instanceof Promise ? "a promise" : "none")'],
];

const files = ["mjs", "ts"] as const;

const all = givens.length * laids.length * ons.length * reads.length * askeds.length * files.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [given, inFront, getter] = pick(givens);
  const [read, value, shape] = pick(reads);
  const [laid, lays] = pick(laids);
  const [on, target, holds] = pick(ons);
  const [asked, asks] = pick(askeds);
  const file = pick(files);
  const lay = lays.replaceAll("TARGET", target).replace("GETTER", () => getter);
  const text = [
    inFront,
    holds.replace("LAY", () => (target === "this" ? lay.replaceAll("\n", "\n    ") : lay)),
    'let out = "";',
    shape.replace("ASK", () => asks.replace("VALUE", () => value)),
    'console.log("SAID " + out);',
    file === "ts" && "export {};",
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("thisANY", file === "ts" ? "this: any" : "")
    .replaceAll("ANY", file === "ts" ? ": any" : "")
    .replaceAll("AS)", file === "ts" ? " as any)" : ")");
  return { name: `${given}--${laid}--${on}--${read}--${asked}.${file}`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laidOut++;
  }
  console.log(laidOut);
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
