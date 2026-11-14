// A value of one kind and then one of another kind at the same place: kinds, times kinds, times what is done with the value, times how it gets there. Whatever is known of the place holds both.
//
//   bun write-kind-pair-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<first>--<second>--<use>--<way>.mjs
//   bun write-kind-pair-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const kinds: [name: string, text: string][] = [
  ["integer", "n + 1"],
  ["wide", "2 ** 31 + n"],
  ["half", "n + 0.5"],
  ["minus-zero", "-0"],
  ["not-a-number", "0 / 0"],
  ["big", "10n ** 18n"],
  ["true", "n >= 0"],
  ["nothing", "undefined"],
  ["null", "null"],
  ["text", '"ab"'],
  ["rope", '"t" + n'],
  ["digit", "String(n)"],
  ["symbol", "Symbol.iterator"],
  ["integers", "[n, 2, 3]"],
  ["halves", "[0.5, n]"],
  ["texts", '["a", "b" + n]'],
  ["holes", "[n, , 3]"],
  ["nested", "[[n], [2]]"],
  ["empty-list", "[]"],
  ["literal", "{ x: n, y: 2 }"],
  ["other-literal", "{ y: 0.5, x: n, length: 2 }"],
  ["parsed", 'JSON.parse(\'{"x":"p","z":1}\')'],
  ["instance", "new Point(n)"],
  ["heir", "new Deep(n)"],
  ["counted", "new Counted(n)"],
  ["frozen", "Object.freeze({ x: n })"],
  ["bare", "Object.assign(Object.create(null), { x: n })"],
  ["arrow", "value => value"],
  ["function", "named"],
  ["bound", "Math.max.bind(null, n)"],
  ["class", "Point"],
  ["native", "Math.abs"],
  ["map", 'new Map([[n, 1], ["x", 2]])'],
  ["set", "new Set([n, 2])"],
  ["map-entries", 'new Map([["a", n]]).entries()'],
  ["list-values", "[n, 7].values()"],
  ["list-iterator", "[n, 7][Symbol.iterator]()"],
  ["map-iterator", "new Map([[n, 1]])[Symbol.iterator]()"],
  ["text-iterator", '("i" + n)[Symbol.iterator]()'],
  ["set-keys", "new Set([n, 4]).keys()"],
  ["pattern-matches", '"a1b2".matchAll(/[a-z](\\d)/g)'],
  ["mapped-iterator", "[n, 2].values().map(item => item)"],
  ["by-computed-method", "methods[n & 1 ? names[0] : names[1]](n)"],
  ["by-symbol-method", "methods[mark](n)"],
  ["by-getter", "methods.made"],
  ["by-call", "methods.one.call(null, n)"],
  ["by-apply", "Reflect.apply(methods.two, null, [n])"],
  ["generator", "steps(n)"],
  ["by-hand", "byHand(n)"],
  ["bytes", "new Uint8Array([n, 2, 300])"],
  ["doubles", "Float64Array.of(n, 0.5)"],
  ["date", "new Date(n * 1000)"],
  ["pattern", "/a+/g"],
  ["error", 'new RangeError("r" + n)'],
  ["promise", "Promise.resolve(n)"],
  ["arguments", "given(n, 2)"],
  ["boxed", "Object(n)"],
  ["proxy", "new Proxy({ x: n, length: 1 }, {})"],
  ["valued", '{ valueOf: () => n, toString: () => "v" }'],
];
// `v` is the value, `w` the one that stood here before.
const uses: [name: string, text: string][] = [
  ["typeof", "note(typeof v);"],
  ["text", "note(String(v).length);"],
  ["template", "note(`${v}`.slice(0, 6));"],
  ["plus-number", "note(v + 1);"],
  ["plus-text", 'note(v + "!");'],
  ["minus", "note(v - 1);"],
  ["sum", "total += v;\nnote(total);"],
  ["bits", "note(v | 0);"],
  ["compared", "note([v < 2, v > 2]);"],
  ["equal", "note([v == null, v === w, v == w]);"],
  ["truth", 'note(v ? "yes" : "no");'],
  ["nullish", 'note(v ?? "none");'],
  ["optional", "note(v?.x);"],
  ["field", "note(v.x);"],
  ["two-fields", "note([v.x, v.y, v.length]);"],
  ["element", "note(v[0]);"],
  ["element-behind", "note(v[5]);"],
  ["by-name", 'note(v["x" + ""]);'],
  ["length", "for (let i = 0; i < v.length; i++) note(v[i]);"],
  ["size", "note(v.size);"],
  ["store", 'v.x = "s";\nnote(v.x);'],
  ["element-store", "v[1] = 9;\nnote(v[1]);"],
  ["add-field", "v.added = n;\nnote(Object.keys(v));"],
  ["delete", "note(delete v.x);\nnote(v.x);"],
  ["in", 'note("x" in v);'],
  ["own", 'note([Object.hasOwn(v, "x"), Object.hasOwn(v, 0)]);'],
  ["keys", "note(Object.keys(v));"],
  ["entries", "note(Object.entries(v));"],
  ["for-in", "for (const name in v) note(name);"],
  ["for-of", "for (const item of v) note(item);"],
  ["spread", "note([...v]);"],
  ["object-spread", "note({ ...v });"],
  ["pattern", "const [a, b] = v;\nnote([a, b]);"],
  ["object-pattern", "const { x, length = 3 } = v;\nnote([x, length]);"],
  ["list-from", "note(Array.from(v));"],
  ["call", "note(v(3));"],
  ["call-method", "note(v.toString().length);"],
  ["own-method", "note(v.ask(2));"],
  ["construct", "note(new v(4));"],
  ["instance-of", "note([v instanceof Point, v instanceof Array, v instanceof Object]);"],
  ["is-list", "note(Array.isArray(v));"],
  ["class-of", "note(v.constructor?.name);"],
  ["tag", "note(Object.prototype.toString.call(v));"],
  ["json", "note(JSON.stringify(v));"],
  ["key", "const holder = { ab: 1, 1: 2 };\nnote(holder[v]);"],
  ["map-key", "counts.set(v, n);\nnote(counts.get(v));"],
  ["found", "note([v].indexOf(v));\nnote([w, v].includes(v));"],
  ["same", "note(Object.is(v, w));"],
  ["greatest", "note(Math.max(v, 1));"],
  ["number", "note(Number(v));"],
  [
    "switched",
    'switch (typeof v) {\n  case "number":\n    note(v + 1);\n    break;\n  case "string":\n    note(v.length);\n    break;\n  case "function":\n    note(v.length);\n    break;\n  default:\n    note(v && v.x);\n}',
  ],
  ["mapped", "note(v.map(item => item));"],
  ["pushed", "v.push(8);\nnote(v.length);"],
  ["joined", 'note(v.join("-"));'],
  ["sliced", "note(v.slice(1));"],
  ["thrown", "try {\n  throw v;\n} catch (caught) {\n  note(caught === v);\n}"],
  ["captured", "const ask = () => v;\nnote(typeof ask());"],
];
// `A` and `B` are the kinds; `use` takes the value and the one before.
const ways: [name: string, text: string][] = [
  ["argument", "for (let n = 0; n < 3; n++) {\n  use(A, w, n);\n  use(B, w, n);\n}"],
  ["second-later", "for (let n = 0; n < 4; n++) use(A, w, n);\nfor (let n = 0; n < 2; n++) use(B, w, n);"],
  ["list", "const n = 1;\nfor (const item of [A, B, A]) use(item, w, n);"],
  [
    "field",
    "const holder = { item: null };\nfor (let n = 0; n < 3; n++) {\n  holder.item = A;\n  use(holder.item, w, n);\n  holder.item = B;\n  use(holder.item, w, n);\n}",
  ],
  [
    "variable",
    "let item;\nfor (let n = 0; n < 4; n++) {\n  if (n & 1) item = B;\n  else item = A;\n  use(item, w, n);\n}",
  ],
  ["chosen", "for (let n = 0; n < 4; n++) use(n & 1 ? B : A, w, n);"],
  [
    "returned",
    "const make = n => {\n  if (n === 2) return B;\n  return A;\n};\nfor (let n = 0; n < 4; n++) use(make(n), w, n);",
  ],
  [
    "captured",
    "for (let n = 0; n < 2; n++) {\n  const a = A;\n  const b = B;\n  const run = first => use(first ? a : b, w, n);\n  run(true);\n  run(false);\n}",
  ],
  ["callback", "const n = 2;\n[A, B].forEach(item => use(item, w, n));"],
  [
    "table",
    'const table = { a: n => A, b: n => B };\nfor (let n = 0; n < 2; n++) for (const name of ["a", "b"]) use(table[name](n), w, n);',
  ],
  [
    "rest",
    "const all = (n, ...items) => {\n  for (const item of items) use(item, w, n);\n};\nfor (let n = 0; n < 2; n++) all(n, A, B);",
  ],
  [
    "in-place",
    "for (let n = 0; n < 3; n++) {\n  for (let turn = 0; turn < 2; turn++) {\n    const v = turn ? B : A;\n    try {\nUSE\n    } catch (error) {\n      note(told(error));\n    }\n    w = v;\n  }\n}",
  ],
];
const total = kinds.length * kinds.length * uses.length * ways.length;

function write(cell: number): { name: string; text: string } {
  let rest = Number((BigInt(cell) * 829348951n) % BigInt(total));
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const way = pick(ways);
  const first = pick(kinds);
  const use = pick(uses);
  const second = pick(kinds);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const object = (text: string) => (text.startsWith("{") || text.startsWith("function") ? `(${text})` : text);
  const body = way[1]
    .replaceAll(/\bA\b/g, () => object(first[1]))
    .replaceAll(/\bB\b/g, () => object(second[1]))
    .replace("USE", () => indent(use[1], "      "));
  const lines = [
    `const notes = [];`,
    `const told = (error) => "!" + error?.name;`,
    `const show = (value) => (typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : value instanceof Error ? told(value) : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : String(value));`,
    `const note = (value) => void notes.push(show(value));`,
    `class Point {`,
    `  constructor(x) {\n    this.x = x;\n  }\n  ask(by) {\n    return this.x + by;\n  }\n}`,
    `function named(x) {\n  return this ? 5 : x;\n}`,
    `class Deep extends Point {\n  y = 1.5;\n  ask(by) {\n    return super.ask(by) + 0.5;\n  }\n}`,
    `class Counted {`,
    `  constructor(n) {\n    this.length = n;\n    this[0] = "c";\n  }\n}`,
    `function* steps(n) {\n  yield n;\n  yield "g";\n}`,
    `const byHand = (n) => ({ [Symbol.iterator]: () => ({ next: () => ({ done: n-- < 1, value: n }) }) });`,
    `const given = function (..._) {\n  return arguments;\n};`,
    `const mark = Symbol("mark");`,
    `const names = JSON.parse('["one","two"]');`,
    `const methods = {\n  one: n => ({ x: n }),\n  two(n) {\n    return [n, "two"];\n  },\n  [mark](n) {\n    return new Set([n]);\n  },\n  get made() {\n    return { y: 1, x: 0.5 };\n  },\n};`,
    `const counts = new Map();`,
    `let total = 0;`,
    `let w = undefined;`,
    `function use(v, before, n) {`,
    `  try {`,
    ...indent(use[1], "    ").split("\n"),
    `  } catch (error) {`,
    `    note(told(error));`,
    `  }`,
    `  w = v;`,
    `}`,
    ...body.split("\n"),
    `console.log(notes.join(" "));`,
  ]; // prettier-ignore
  return { name: `${first[0]}--${second[0]}--${use[0]}--${way[0]}.mjs`, text: lines.join("\n") + "\n" }; // prettier-ignore
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
