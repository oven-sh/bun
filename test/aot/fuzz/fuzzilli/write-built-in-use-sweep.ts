// Built-in objects as values: which one, times how it arrives, times what is done with it, times the program's own value that arrives the same way.
//
//   bun write-built-in-use-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<value>--<way>--<use>--<round>--<beside>.mjs
//   bun write-built-in-use-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const values: [name: string, text: string][] = [
  ["json", "JSON"],
  ["math", "Math"],
  ["reflect", "Reflect"],
  ["atomics", "Atomics"],
  ["global", "globalThis"],
  ["array-prototype", "Array.prototype"],
  ["object-prototype", "Object.prototype"],
  ["map-prototype", "Map.prototype"],
  ["text-prototype", "String.prototype"],
  ["number-prototype", "Number.prototype"],
  ["function-prototype", "Function.prototype"],
  ["error-prototype", "TypeError.prototype"],
  ["expression-prototype", "RegExp.prototype"],
  ["typed-prototype", "Int8Array.prototype"],
  ["iterator-prototype", "Object.getPrototypeOf([][Symbol.iterator]())"],
  ["array", "Array"],
  ["object", "Object"],
  ["text", "String"],
  ["number", "Number"],
  ["truth", "Boolean"],
  ["symbol", "Symbol"],
  ["date", "Date"],
  ["map", "Map"],
  ["set", "Set"],
  ["promise", "Promise"],
  ["error", "RangeError"],
  ["expression", "RegExp"],
  ["typed", "Uint8Array"],
  ["floor", "Math.floor"],
  ["parse", "JSON.parse"],
  ["is-list", "Array.isArray"],
  ["keys", "Object.keys"],
  ["parse-integer", "parseInt"],
  ["is-nan", "isNaN"],
  ["push", "[].push"],
  ["trim", '"".trim'],
  ["call", "Function.prototype.call"],
  ["own", "{ length: 2, v: 1 }"],
  ["own-list", "[3, 4]"],
  ["own-function", "(a, b) => a"],
  ["own-class", "class {\n  static v = 1;\n}"],
];
const ways: [name: string, text: string, before?: string][] = [
  ["parameter", "const it = given;"],
  ["map", "const it = new Map([[1, given]]).get(1);"],
  ["map-of-the-file", "kept.set(1, given);\nconst it = kept.get(1);", "const kept = new Map();"],
  ["list", "const it = [given, 0][0];"],
  ["list-of-the-file", "kept.push(given);\nconst it = kept[kept.length - 1];", "const kept = [];"],
  ["field", "const it = { given }.given;"],
  ["field-of-the-file", "kept.given = given;\nconst it = kept.given;", "const kept = { given: 1 };"],
  [
    "class-field",
    "const it = new Holder(given).given;",
    "class Holder {\n  constructor(given) {\n    this.given = given;\n  }\n}",
  ],
  ["variable-of-the-file", "kept = given;\nconst it = kept;", "let kept;"],
  ["captured", "const ask = () => given;\nconst it = ask();"],
  ["returned", "const it = pass(given);", "const pass = value => value;"],
  ["by-key", 'kept["k" + n] = given;\nconst it = kept["k" + n];', "const kept = {};"],
  ["yielded", "const [it] = (function* () {\n  yield given;\n})();"],
  ["set", "const [it] = new Set([given]);"],
  ["chosen", "const it = n & 1 ? given : given;"],
];
// `it` is the value, `n` a number.
const uses: [name: string, text: string][] = [
  ["own-keys", "Object.keys(it).length"],
  ["own-names", 'Object.getOwnPropertyNames(it).includes("length")'],
  ["has-v", '"v" in it'],
  ["has-own", 'Object.hasOwn(it, "length")'],
  ["length", "it.length"],
  ["length-plus", "it.length + n"],
  ["missing", "it.missing"],
  ["missing-chain", "it.missing?.v ?? n"],
  ["missing-call", "it.missing?.(n)"],
  ["name", "it.name"],
  ["element", "it[0]"],
  ["element-by-number", "it[n]"],
  ["spread", "Object.keys({ ...it }).length"],
  ["listed", "[...it].length"],
  ["json", "JSON.stringify(it)"],
  ["text", "Object.prototype.toString.call(it)"],
  ["prototype", "Object.getPrototypeOf(it) === Object.prototype"],
  ["prototype-function", "Object.getPrototypeOf(it) === Function.prototype"],
  ["constructor", "it.constructor === Object"],
  ["call", "it(n)"],
  ["call-two", "it(n, 2)"],
  ["call-list", "it([n])"],
  ["call-text", 'it("3")'],
  ["construct", "String(new it(n))"],
  ["construct-none", "typeof new it()"],
  ["method-call", "it.call(null, n)"],
  ["apply", "it.apply([], [n])"],
  ["bound", "it.bind(null, n)()"],
  ["mapped", "[1.5, 2.5].map(it)"],
  ["method", "it.max(n, 2)"],
  ["of", "it.of(n, 1)"],
  ["from", "it.from([n, 2])"],
  ["is-equal", "it === given"],
  ["is-math", "it === Math"],
  ["is-array", "it === Array"],
  ["same-kind", "typeof it === typeof given"],
  ["instance", "it instanceof Function"],
  ["instance-of-it", "[] instanceof it"],
  ["as-key", "new Map([[it, n]]).get(given)"],
  ["in-set", "new Set([it, given, Math]).size"],
  ["found", "[Math, it, Array].indexOf(given)"],
  ["frozen", "Object.isFrozen(it)"],
  ["descriptor", 'JSON.stringify(Object.getOwnPropertyDescriptor(it, "length"))'],
  ["created", "Object.getPrototypeOf(Object.create(it)) === given"],
  ["inherited", "Object.create(it).length"],
  ["assigned", "Object.keys(Object.assign({}, it)).length"],
  ["loop", "((count = 0) => {\n  for (const name in it) count++;\n  return count;\n})()"],
  ["pattern", "(({ length, ...others }) => [length, Object.keys(others).length])(it)"],
  ["truthy", "it ? 1 : 0"],
  ["or", "(it || n) === given"],
  [
    "switch",
    "(() => {\n  switch (it) {\n    case Math:\n      return 1;\n    case JSON:\n      return 2;\n    case Array:\n      return 3;\n    default:\n      return 4;\n  }\n})()",
  ],
  ["tagged", "[it].map(tag => tag`a${n}`)[0]"],
  ["compared", "it > n"],
  ["added", '(it + "").length > 3'],
  ["symbol", "it[Symbol.iterator] === [][Symbol.iterator]"],
  ["tag", "it[Symbol.toStringTag]"],
];
const rounds: [name: string, text: string][] = [
  ["loop", "for (const n of [1, 2, 3]) {\nASK\n}"],
  ["parsed", 'for (const n of JSON.parse("[0, 2]")) {\nASK\n}'],
  ["once", "{\n  const n = 2;\nASK\n}"],
];
const besides: [name: string, text: string][] = [
  ["nobody", ""],
  ["object", "{ length: 5, v: n }"],
  ["list", "[n, n]"],
  ["function", "(a, b) => b"],
  ["class", "Own"],
  ["text", '"given"'],
  ["nothing", "undefined"],
  ["built-in", "Math"],
  ["built-in-function", "parseFloat"],
];
const total = values.length * ways.length * uses.length * rounds.length * besides.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const value = pick(values);
  const way = pick(ways);
  const use = pick(uses);
  const round = pick(rounds);
  const beside = pick(besides);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const ask = (text: string) => `try {\n  note(use(${text}, n));\n} catch (error) {\n  note(error.name);\n}`;
  const lines = [
    "const notes = [];",
    'const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "object" : String(value).replace(/\\d\\d:\\d\\d:\\d\\d/, "time").slice(0, 60));',
    "const note = value => void notes.push(show(value));",
    "class Own {\n  static length = 7;\n  v = 1;\n}",
    ...(way[2] ? [way[2]] : []),
    "function use(given, n) {",
    indent(way[1], "  "),
    `  return ${indent(use[1], "  ").trimStart()};`,
    "}",
    round[1].replace("ASK", () => indent([...(beside[1] ? [ask(beside[1])] : []), ask(value[1])].join("\n"), "  ")),
    'console.log(notes.join(" "));',
  ]; // prettier-ignore
  return {
    name: `${value[0]}--${way[0]}--${use[0]}--${round[0]}--${beside[0]}.mjs`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
