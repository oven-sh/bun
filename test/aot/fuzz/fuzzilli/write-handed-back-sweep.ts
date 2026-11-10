// A function of the language may hand back the very object that it was given: the call, times the object, times how the object is given, times what is done to the object behind the call, times what is asked
// of what the call handed back. Each program holds one of each and as good as nothing else, and is built alone.
//
//   bun write-handed-back-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<call>--<object>--<given>--<deed>--<question>.ts
//   bun write-handed-back-sweep.ts count
//   bun write-handed-back-sweep.ts named <pattern> <folder> [most]
//
// `Promise.resolve(p)` is `p` where `p` is a promise, `Object(o)` is `o`, `list.sort()` is `list`. A compiler that takes what a call hands back for an object that was just made, with nothing laid on it yet,
// answers questions about it out of what it knows of fresh objects. What is laid on the object behind the call, under its other name, then goes unseen. Calls that do hand back a fresh object stand beside
// them: there the deed must not show.
import { mkdirSync, writeFileSync } from "fs";
import { printThroughBranch } from "./print-through-branch.ts";

// H is what is handed to the call. The kinds of object that the call takes: "any" is every object below.
const calls: [string, string, string][] = [
  ["promise-resolve", "Promise.resolve(H)", "any"],
  ["object", "Object(H)", "any"],
  ["new-object", "new Object(H)", "any"],
  ["assign-nothing", "Object.assign(H, {})", "any"],
  ["assign-without-a-source", "Object.assign(H)", "any"],
  ["define-properties-none", "Object.defineProperties(H, {})", "any"],
  ["define-a-property", 'Object.defineProperty(H, "extra", { value: 1, configurable: true, writable: true })', "any"],
  ["set-the-prototype-it-has", "Object.setPrototypeOf(H, Object.getPrototypeOf(H))", "any"],
  ["value-of", "H.valueOf()", "any"],
  ["by-reflection", "Reflect.apply(Object, undefined, [H])", "any"],
  ["sort", "H.sort()", "list"],
  ["reverse", "H.reverse()", "list"],
  ["fill-nothing", "H.fill(0, 0, 0)", "list"],
  ["copy-within-nothing", "H.copyWithin(0, 0, 0)", "list"],
  ["set-of-a-map", "H.set(9, 9)", "map"],
  ["add-of-a-set", "H.add(9)", "set"],
  ["its-own-iterator", "H[Symbol.iterator]()", "iterator"],
  ["a-spread-into-a-record", "({ ...H })", "any"],
  ["a-clone", "structuredClone(H)", "cloned"],
  ["create-below-it", "Object.create(H)", "any"],
  ["slice", "H.slice()", "list"],
  ["concat", "H.concat()", "list"],
  ["array-from", "Array.from(H)", "list"],
  ["then-without-a-function", "H.then()", "promise"],
  ["a-map-of-it", "new Map(H)", "map"],
  ["a-set-of-it", "new Set(H)", "set"],
];

const objects: [string, string, string[]][] = [
  ["a-promise", "Promise.resolve(1)", ["any", "promise"]],
  ["a-record", '{ a: 1, m() { return "made"; } }', ["any", "cloned-not"]],
  ["a-record-of-data", "{ a: 1, b: [2] }", ["any", "cloned"]],
  ["a-list", "[3, 1, 2]", ["any", "list", "cloned"]],
  ["a-list-of-fractions", "[3.5, 1.5, 2.5]", ["any", "list", "cloned"]],
  ["a-map", "new Map([[1, 2]])", ["any", "map", "cloned"]],
  ["a-set", "new Set([1])", ["any", "set", "cloned"]],
  ["a-date", "new Date(0)", ["any", "cloned"]],
  ["a-function", "function made() {}", ["any"]],
  ["a-pattern", "/r/g", ["any", "cloned"]],
  ["a-view", "new Uint8Array([3, 1, 2])", ["any", "list-not", "cloned"]],
  ["an-iterator-of-a-list", "[1, 2].values()", ["any", "iterator"]],
  ["an-error", 'new Error("e")', ["any", "cloned"]],
  ["an-instance", 'new (class Made { a = 1; m() { return "made"; } })()', ["any"]],
];

const givens: [string, string][] = [
  ["itself", "v"],
  ["by-a-choice-that-the-run-makes", 'JSON.parse("true") ? v : 1'],
  ["through-a-function", "pass(v)"],
];

// What is done to `v` behind the call.
const deeds: [string, string][] = [
  ["a-then-of-its-own-is-laid", 'v.then = (): string => "own";'],
  ["a-to-string-of-its-own-is-laid", 'v.toString = (): string => "own";'],
  ["a-method-is-laid", 'v.m = (): string => "own";'],
  ["a-field-is-stored", "v.a = 2;"],
  ["a-name-is-added", "v.added = 1;"],
  ["a-name-is-deleted", "delete v.a;"],
  ["an-element-is-stored", "v[0] = 9;"],
  ["its-prototype-is-exchanged", 'Object.setPrototypeOf(v, { m() { return "up"; }, toString() { return "up"; } });'],
  ["it-is-frozen", "Object.freeze(v);"],
  ["an-iterator-of-its-own-is-laid", "v[Symbol.iterator] = function* () { yield 7; };"],
  ["nothing-is-done", ""],
];

// What is asked of `same`, which the call handed back.
const questions: [string, string][] = [
  ["its-then-is-called", 'typeof same.then === "function" ? same.then(pass) : "no then"'],
  ["it-is-made-a-text", "`${same}`"],
  ["its-method-is-called", 'typeof same.m === "function" ? same.m() : "no m"'],
  ["its-field-is-read", "same.a"],
  ["the-added-name-is-read", "same.added"],
  ["its-keys-are-listed", "Object.keys(same).join()"],
  ["its-first-element-is-read", "same[0]"],
  ["is-it-the-same", "same === v"],
  ["is-it-frozen", "Object.isFrozen(same)"],
  [
    "it-is-spread",
    '(() => {\n    try {\n      return [...same].join();\n    } catch {\n      return "no iterator";\n    }\n  })()',
  ],
  ["is-the-name-its-own", 'Object.hasOwn(same, "added") + " " + ("a" in same)'],
  ["it-is-awaited", 'await Promise.race([same, new Promise(done => setTimeout(done, 30, "not settled"))])'],
];

const pairs: [number, number][] = [];
calls.forEach(([, , takes], call) =>
  objects.forEach(([, , kinds], object) => kinds.includes(takes) && pairs.push([call, object])),
);

const all = pairs.length * givens.length * deeds.length * questions.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [deed, done] = pick(deeds);
  const [question, asked] = pick(questions);
  const [given, handed] = pick(givens);
  const [callAt, objectAt] = pick(pairs);
  const [call, shape] = calls[callAt];
  const [object, made] = objects[objectAt];
  const text = [
    "function pass(x: unknown): unknown {\n  return x;\n}",
    "async function main(): Promise<string> {",
    `  const v: any = ${made};`,
    `  const held: any = ${handed};`,
    `  const same: any = ${shape.replaceAll("H", "held")};`,
    done && `  ${done}`,
    `  return String(${asked});`,
    "}",
    "console.log(await main().catch(error => error.name));",
  ]
    .filter(Boolean)
    .join("\n");
  return { name: `${call}--${object}--${given}--${deed}--${question}.ts`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
    laid++;
  }
  console.log(laid);
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
