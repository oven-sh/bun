// Two classes lay something under one key, and the property is read off an instance: what the base class lays, times what the subclass lays, times how the key is written, times what is done to the instance in
// front of the read, times where the read stands, times what the function that is handed the value asks of it, times the kind of file. Each program holds one of each and is built alone.
//
//   bun write-one-key-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<base>--<subclass>--<key>--<done>--<read>--<asked>.mjs or .ts
//   bun write-one-key-sweep.ts count
//   bun write-one-key-sweep.ts named <pattern> <folder> [most]
//
// A field is laid on the instance, a method and an accessor on the prototype. So a field of the base class hides an accessor of the subclass, and what is stored there afterwards is what is read.
import { mkdirSync, writeFileSync } from "fs";
import { printThroughBranch } from "./print-through-branch.ts";

// K is the key as it stands in the body of a class.
const bases: [string, string][] = [
  ["nothing", ""],
  ["a-field-with-a-number", "K = 7;"],
  ["a-field-with-a-text", 'K = "old";'],
  ["a-field-with-a-record", "K = { v: 0 };"],
  ["a-method", "K() {\n  return 7;\n}"],
  ["a-getter", "get K() {\n  return 7;\n}"],
  ["a-getter-and-a-setter", "get K() {\n  return this.kept ?? 7;\n}\nset K(value) {\n  this.kept = value;\n}"],
];

const subclasses: [string, string][] = [
  ["nothing", ""],
  ["a-getter-of-a-record", "get K() {\n  return { v: 1 };\n}"],
  ["a-getter-of-a-number", "get K() {\n  return 1;\n}"],
  ["a-method", "K() {\n  return 1;\n}"],
  ["a-field-with-a-record", "K = { v: 2 };"],
  ["a-setter-alone", "set K(value) {}"],
];

// What stands in front, the key in the body of a class, the key behind an object, and the key as a value.
const keys: [string, string, string, string, string][] = [
  ["written", "", "tag", ".tag", '"tag"'],
  ["a-constant", 'const key = "tag";', "[key]", "[key]", "key"],
  ["a-symbol", 'const key = Symbol("tag");', "[key]", "[key]", "key"],
  ["made-at-run-time", "const key = JSON.parse('\"tag\"');", "[key]", "[key]", "key"],
];

// AT is the key behind `x`, NAME the key as a value.
const dones: [string, string][] = [
  ["nothing", ""],
  ["a-text-stored", 'xAT = "new";'],
  ["a-number-stored", "xAT = 8;"],
  ["a-record-stored", "xAT = { v: 3 };"],
  ["deleted", "delete xAT;"],
  ["laid-by-a-descriptor", 'Object.defineProperty(x, NAME, { value: "laid", configurable: true });'],
];

// DONE is what is done to `x`.
const reads: [string, string][] = [
  ["in-a-function", "function read(x) {\n  DONE\n  return xAT;\n}\nout += say(read(new Loud()));"],
  ["straight", "const x = new Loud();\nDONE\nout += say(xAT);"],
  [
    "in-a-function-called-from-a-loop",
    'function read(x) {\n  DONE\n  return xAT;\n}\nfor (let i = 0; i < 40; i++) out += say(read(new Loud())) + "|";',
  ],
];

const askeds: [string, string][] = [
  ["made-a-text", 'value => (typeof value === "function" ? "a function" : String(value))'],
  ["asked-whether-it-is-an-object", 'value => (typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value === "function" ? "a function" : String(value))'], // prettier-ignore
  ["asked-whether-it-is-a-number", 'value => (typeof value === "number" ? value + 1 : typeof value)'],
  ["its-field-read", "value => String(value?.v)"],
  ["compared", 'value => (value === 7 ? "seven" : value === "new" ? "the new one" : typeof value)'],
];

const files = ["mjs", "ts"] as const;

const all = bases.length * subclasses.length * keys.length * dones.length * reads.length * askeds.length * files.length;

const indented = (text: string, by: string) => text.replaceAll("\n", "\n" + by);

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [asked, asks] = pick(askeds);
  const [done, does] = pick(dones);
  const [base, lays] = pick(bases);
  const [subclass, laysToo] = pick(subclasses);
  const [key, inFront, inAClass, behind, value] = pick(keys);
  const [read, shape] = pick(reads);
  const file = pick(files);
  const classOf = (head: string, body: string) => (body ? `${head} {\n  ${indented(body.replaceAll("K", inAClass), "  ")}\n}` : `${head} {}`); // prettier-ignore
  const text = [
    // TypeScript has no field of a base class overridden by an accessor.
    file === "ts" && "// @ts-nocheck",
    `const say = ${asks};`,
    inFront,
    classOf("class Base", lays),
    classOf("class Loud extends Base", laysToo),
    'let out = "";',
    "try {",
    "  " +
      indented(
        shape
          .replace(/^ *DONE\n/m, does ? line => line.replace("DONE", () => does) : "")
          .replaceAll("AT", behind)
          .replaceAll("NAME", value),
        "  ",
      ),
    "} catch (error) {",
    '  out += "threw " + error.name;',
    "}",
    'console.log("SAID " + out);',
    file === "ts" && "export {};",
  ]
    .filter(Boolean)
    .join("\n");
  return { name: `${base}--${subclass}--${key}--${done}--${read}--${asked}.${file}`, text: text + "\n" };
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
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
    laidOut++;
  }
  console.log(laidOut);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
  }
  console.log(Math.min(count, all));
}
