// What kind a value is: the value, times the way that it goes, times the test of its kind, times how the answer is used, times the value that goes the same way before it.
//
//   bun write-kind-test-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<value>--<way>--<test>--<use>--<before>.mjs
//   bun write-kind-test-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const values: [name: string, text: string, before?: string][] = [
  ["json", "JSON"],
  ["math", "Math"],
  ["reflect", "Reflect"],
  ["atomics", "Atomics"],
  ["intl", "Intl"],
  ["console", "console"],
  ["global", "globalThis"],
  ["process", "process"],
  ["environment", "process.env"],
  ["performance", "performance"],
  ["web-crypto", "crypto"],
  ["web-assembly", "WebAssembly"],
  ["array-prototype", "Array.prototype"],
  ["object-prototype", "Object.prototype"],
  ["function-prototype", "Function.prototype"],
  ["date-prototype", "Date.prototype"],
  ["map-prototype", "Map.prototype"],
  ["error-prototype", "Error.prototype"],
  ["array", "Array"],
  ["object", "Object"],
  ["map-class", "Map"],
  ["promise-class", "Promise"],
  ["typed-class", "Uint8Array"],
  ["parse", "parseInt"],
  ["method", "Math.max"],
  ["prototype-method", "Array.prototype.map"],
  ["symbol", "Symbol.iterator"],
  ["not-a-number", "NaN"],
  ["infinite", "Infinity"],
  ["constant", "Math.PI"],
  ["largest", "Number.MAX_SAFE_INTEGER"],
  ["nothing", "undefined"],
  ["null", "null"],
  ["truth", "true"],
  ["empty-text", '""'],
  ["big", "5n"],
  ["node-module", "nodePath", 'import * as nodePath from "node:path";'],
  ["node-function", "join", 'import { join } from "node:path";'],
  ["literal", "{ v: 1 }"],
  ["constant-literal", "own", "const own = { v: 1 };"],
  ["frozen", "own", "const own = Object.freeze({ v: 1 });"],
  ["list", "[1, 2]"],
  ["class", "Own", "class Own {}"],
  ["instance", "new Own()", "class Own {}"],
  ["class-prototype", "Own.prototype", "class Own {}"],
  ["static-object", "Own.table", "class Own {\n  static table = { v: 1 };\n}"],
  ["arrow", "() => 1"],
  ["bound", "own.bind(null)", "function own() {}"],
  ["expression", "/a/"],
  ["date", "new Date(0)"],
  ["map", "new Map()"],
  ["error", 'new RangeError("e")'],
  ["boxed", "new Number(1)"],
  ["boxed-symbol", "Object(Symbol.iterator)"],
  ["bare", "Object.create(null)"],
  ["proxy", "new Proxy({}, {})"],
  ["function-proxy", "new Proxy(() => 1, {})"],
  ["generator", "(function* () {})()"],
  ["arguments", "(function () {\n  return arguments;\n})()"],
  ["typed", "new Uint8Array(2)"],
  ["buffer", "new ArrayBuffer(2)"],
  ["link", 'new URL("http://a/")'],
];
// The value is `given`; `bound` is what arrives.
const ways: [name: string, text: string, before?: string][] = [
  ["parameter", "const bound = given;"],
  ["map", 'const bound = new Map([["a", given]]).get("a");'],
  ["map-set", 'const map = new Map();\nmap.set("a", given);\nconst bound = map.get("a");'],
  ["map-of-the-file", 'kept.set("a", given);\nconst bound = kept.get("a");', "const kept = new Map();"],
  ["map-entries", "let bound;\nfor (const [, value] of new Map([[1, given]])) bound = value;"],
  ["map-values", "const [bound] = new Map([[1, given]]).values();"],
  ["map-keys", "const [bound] = new Map([[given, 1]]).keys();"],
  ["map-each", "let bound;\nnew Map([[1, given]]).forEach(value => {\n  bound = value;\n});"],
  ["weak-map", "const key = {};\nconst bound = new WeakMap([[key, given]]).get(key);"],
  ["set", "const [bound] = new Set([given]);"],
  [
    "set-of-the-file",
    "kept.clear();\nkept.add(given);\nlet bound;\nfor (const value of kept) bound = value;",
    "const kept = new Set();",
  ],
  ["list", "const bound = [given, 1][0];"],
  ["list-of-the-file", "kept[0] = given;\nconst bound = kept[0];", "const kept = [];"],
  ["list-at", 'const list = [given, 1];\nconst bound = list[JSON.parse("0")];'],
  ["indices", "const list = [given, given];\nlet bound;\nfor (let at = 0; at < list.length; at++) bound = list[at];"],
  ["filled", "const list = [];\nfor (let at = 0; at < 3; at++) list[at] = given;\nconst bound = list[1];"],
  ["both-in-a-list", "all.push(given);\nconst bound = all[all.length - 1];", "const all = [];"],
  [
    "all-in-a-list",
    "all.push(given);\nlet bound;\nfor (let at = 0; at < all.length; at++) bound = all[at];",
    "const all = [];",
  ],
  [
    "all-in-a-map",
    "all.set(all.size, given);\nlet bound;\nfor (let at = 0; at < all.size; at++) bound = all.get(at);",
    "const all = new Map();",
  ],
  ["iterated", "let bound;\nfor (const value of [1, given]) bound = value;"],
  ["sorted", "const [bound] = [given].sort();"],
  ["flat", "const [bound] = [[given]].flat();"],
  ["pushed", "const list = [];\nlist.push(given);\nconst bound = list.pop();"],
  ["found", "const bound = [1, given].find(value => value !== 1);"],
  ["mapped", "const [bound] = [1].map(() => given);"],
  ["reduced", "const bound = [given].reduce((left, value) => value, 0);"],
  ["field", "const bound = { given }.given;"],
  ["field-of-the-file", "kept.given = given;\nconst bound = kept.given;", 'const kept = { given: "text" };'],
  [
    "by-key",
    'kept["k" + String(typeof given).length] = given;\nconst bound = kept["k" + String(typeof given).length];',
    "const kept = {};",
  ],
  [
    "class-field",
    "const bound = new Holder(given).given;",
    "class Holder {\n  constructor(given) {\n    this.given = given;\n  }\n}",
  ],
  [
    "private-field",
    "const bound = new Holder(given).ask();",
    "class Holder {\n  #given;\n  constructor(given) {\n    this.#given = given;\n  }\n  ask() {\n    return this.#given;\n  }\n}",
  ],
  ["static-field", "Holder.given = given;\nconst bound = Holder.given;", "class Holder {\n  static given;\n}"],
  ["variable-of-the-file", "kept = given;\nconst bound = kept;", "let kept;"],
  ["captured", "const ask = () => given;\nconst bound = ask();"],
  ["getter", "const bound = {\n  get given() {\n    return given;\n  },\n}.given;"],
  ["yielded", "const [bound] = (function* () {\n  yield given;\n})();"],
  ["returned", "const bound = pass(given);", "const pass = value => value;"],
  ["chosen", 'const bound = pass(given, 1);\npass("other", 0);', "const pass = (value, flag) => (flag ? value : 0);"],
  ["pattern", "const { given: bound = 5 } = { given };"],
  ["rest", "const [, ...others] = [0, given];\nconst bound = others[0];"],
  ["spread", "const bound = { ...{ given } }.given;"],
  ["assigned", "const bound = Object.assign({ given: 1 }, { given }).given;"],
  ["applied", "const bound = pass.apply(null, [given]);", "const pass = value => value;"],
  ["joined", "const bound = given ?? 7;"],
  ["thrown", "let bound;\ntry {\n  throw given;\n} catch (error) {\n  bound = error;\n}"],
];
// `T` is the test of `bound`.
const tests: [name: string, text: string][] = [
  ["is-object", 'typeof bound === "object"'],
  ["is-object-loosely", 'typeof bound == "object"'],
  ["is-no-object", 'typeof bound !== "object"'],
  ["is-function", 'typeof bound === "function"'],
  ["is-no-function", 'typeof bound !== "function"'],
  ["is-text", 'typeof bound === "string"'],
  ["is-number", 'typeof bound === "number"'],
  ["is-undefined", 'typeof bound === "undefined"'],
  ["is-symbol", 'typeof bound === "symbol"'],
  ["is-truth", 'typeof bound === "boolean"'],
  ["is-big", 'typeof bound === "bigint"'],
  ["object-not-null", 'bound !== null && typeof bound === "object"'],
  ["object-and-true", 'bound && typeof bound === "object"'],
  ["object-or-function", 'typeof bound === "object" || typeof bound === "function"'],
  ["neither", 'typeof bound !== "object" && typeof bound !== "function"'],
  ["kind-kept", '(kind => kind === "object")(typeof bound)'],
  ["kind-length", "(typeof bound).length"],
  ["kind-in-list", '["object", "function"].includes(typeof bound)'],
  ["instance-of-object", "bound instanceof Object"],
  ["instance-of-function", "bound instanceof Function"],
  ["instance-of-array", "bound instanceof Array"],
  ["is-list", "Array.isArray(bound)"],
  ["itself-as-object", "Object(bound) === bound"],
  ["truthy", "!!bound"],
  ["nothing", "bound == null"],
  ["not-null", "bound !== null"],
  ["not-undefined", "bound !== undefined"],
  ["text-of-kind", "Object.prototype.toString.call(bound)"],
  ["same", "bound === given"],
  ["same-value", "Object.is(bound, given)"],
  ["unequal-to-itself", "bound !== bound"],
  ["chain", 'bound?.constructor === undefined ? "none" : "some"'],
  ["has", 'typeof bound === "object" && bound !== null && "v" in bound'],
  ["own-keys", 'typeof bound === "object" && bound ? "keys" : "no keys"'],
];
const uses: [name: string, text: string][] = [
  ["returned", "return T;"],
  ["branch", "if (T) return 1;\nreturn 2;"],
  ["negated", "if (!T) return 1;\nreturn 2;"],
  ["chosen", 'return T ? "a" : "b";'],
  ["kept", "const answer = T;\nnotes.push(String(answer));\nreturn answer;"],
  ["loop", "let turns = 0;\nwhile (T && turns < 3) turns++;\nreturn turns;"],
  ["counted", "let sum = 0;\nfor (let i = 0; i < 3; i++) if (T) sum += i + 1;\nreturn sum;"],
  ["switch", "switch (true) {\n  case !!T:\n    return 1;\n  default:\n    return 2;\n}"],
  ["twice", "if (T) {\n  if (T) return 1;\n  return 3;\n}\nreturn 2;"],
  ["behind-text", 'if (typeof bound === "string") return "text";\nreturn T;'],
  ["in-a-callback", "return [1].map(() => T)[0];"],
];
const befores: [name: string, text: string][] = [
  ["text", '"text"'],
  ["number", "1"],
  ["nothing", "undefined"],
  ["object", "{ w: 2 }"],
  ["function", "() => 2"],
  ["built-in", "Math"],
  ["class", "class {}"],
  ["method", "Math.max"],
  ["bound", "(function () {}).bind(null)"],
  ["namespace", "nodeUrl"],
  ["prototype", "Map.prototype"],
  ["date", "new Date(0)"],
  ["null", "null"],
  ["none", ""],
];
const total = values.length * ways.length * tests.length * uses.length * befores.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const value = pick(values);
  const way = pick(ways);
  const test = pick(tests);
  const use = pick(uses);
  const before = pick(befores);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const lines = [
    ...(value[2] ? [value[2]] : []),
    ...(before[0] === "namespace" ? ['import * as nodeUrl from "node:url";'] : []),
    "const notes = [];",
    ...(way[2] ? [way[2]] : []),
    "function read(given) {",
    indent(way[1], "  "),
    indent(
      use[1].replaceAll(/\bT\b/g, () => `(${test[1]})`),
      "  ",
    ),
    "}",
    ...(before[1] ? [`notes.push(String(read(${before[1]})));`] : []),
    `notes.push(String(read(${value[1]})));`,
    'console.log(notes.join(" "));',
  ];
  return {
    name: `${value[0]}--${way[0]}--${test[0]}--${use[0]}--${before[0]}.mjs`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
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
