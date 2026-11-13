// Keys that are known at run time alone: what the key is, times how it is held, times the object, times what is done under the key, times what changes the object between the turns, times the loop.
//
//   bun write-variable-key-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<key>--<holding>--<object>--<use>--<change>--<shape>.mjs
//   bun write-variable-key-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const keys: [name: string, text: string][] = [
  ["x", "JSON.parse('\"x\"')"],
  ["y", "JSON.parse('\"y\"')"],
  ["none", "JSON.parse('\"none\"')"],
  ["length", "JSON.parse('\"length\"')"],
  ["zero-text", "JSON.parse('\"0\"')"],
  ["five-text", "JSON.parse('\"5\"')"],
  ["zero", 'JSON.parse("0")'],
  ["two", 'JSON.parse("2")'],
  ["minus", 'JSON.parse("-1")'],
  ["fraction", 'JSON.parse("1.5")'],
  ["fraction-text", "JSON.parse('\"1.5\"')"],
  ["wide", 'JSON.parse("4294967295")'],
  ["empty", "JSON.parse('\"\"')"],
  ["prototype", "JSON.parse('\"__proto__\"')"],
  ["constructor", "JSON.parse('\"constructor\"')"],
  ["method", "JSON.parse('\"ask\"')"],
  ["text-method", "JSON.parse('\"toString\"')"],
  ["symbol", 'Symbol.for("k" + JSON.parse("1"))'],
  ["iterator", '[Symbol.iterator, 1][JSON.parse("0")]'],
  ["nothing", '[undefined][JSON.parse("0")]'],
  ["null", 'JSON.parse("null")'],
  ["true", 'JSON.parse("true")'],
  ["object", '{ toString: () => (notes.push("s"), "x") }'],
  ["rope", '"x" + JSON.parse(\'""\')'],
];
// `KEY` is the key's text; `K` is how it is named where it is used.
const holdings: [name: string, before: string, inside: string][] = [
  ["constant", "const K = KEY;", ""],
  ["variable", "let K = KEY;", ""],
  ["assigned-later", "let K;\nK = KEY;", ""],
  ["in-the-function", "", "const K = KEY;"],
  ["field", "const held = { K: KEY };", "const { K } = held;"],
  ["element", 'const names = [KEY, "y"];', "const K = names[0];"],
  ["static", "class Names {\n  static K = KEY;\n}", "const K = Names.K;"],
  [
    "captured",
    "const make = () => {\n  const K = KEY;\n  return () => K;\n};\nconst ask = make();",
    "const K = ask();",
  ],
  ["changes", "let K = KEY;\nconst first = K;", 'K = turn & 1 ? "y" : first;'],
  ["default", "const name = (K = KEY) => K;", "const K = name();"],
];
const objects: [name: string, text: string][] = [
  ["literal", "{ x: 1, y: 2 }"],
  ["literal-with-more", '{ a: "a", x: 0.5, y: 2, length: 3, 0: "z", ask: by => by }'],
  ["parsed", 'JSON.parse(\'{"y":1,"x":"p","5":5}\')'],
  ["instance", "new Point(turn)"],
  ["heir", "new Deep(turn)"],
  ["of-prototype", "Object.create({ x: 7, y: turn })"],
  ["getter", '{\n  get x() {\n    notes.push("g");\n    return 3;\n  },\n  y: 1,\n}'],
  [
    "accessors",
    '{\n  at: 0,\n  get x() {\n    return this.at;\n  },\n  set x(value) {\n    notes.push("set");\n    this.at = value;\n  },\n}',
  ],
  ["frozen", "Object.freeze({ x: 4, y: 5 })"],
  ["sealed", "Object.seal({ x: 4 })"],
  ["read-only", 'Object.defineProperty({ y: 1 }, "x", { value: 6, configurable: true })'],
  ["bare", "Object.assign(Object.create(null), { x: 1 })"],
  ["dictionary", "dictionary(turn)"],
  ["list", "[turn, 2, 3]"],
  ["halves", "[0.5, 1.5]"],
  ["holes", "[1, , 3]"],
  ["text", '"abc"'],
  ["number", "turn"],
  ["function", "named"],
  ["class", "Point"],
  ["map", 'new Map([["x", 1]])'],
  ["bytes", "new Uint8Array(3)"],
  ["doubles", "Float64Array.of(0.5, 1.5, 2.5)"],
  ["arguments", "given(turn, 2)"],
  [
    "proxy",
    'new Proxy({ x: 1 }, {\n  get(of, name) {\n    notes.push("p" + String(name));\n    return of[name];\n  },\n})',
  ],
  ["null-sometimes", "turn === 2 ? null : { x: 1 }"],
  ["of-the-file", "shared"],
  ["global", "globalThis"],
  ["error", 'new RangeError("e")'],
];
// `O` is the object.
const uses: [name: string, text: string][] = [
  ["read", "note(O[K]);"],
  ["read-twice", "note([O[K], O[K]]);"],
  ["sum", "sum += O[K];"],
  ["store", "O[K] = turn;\nnote(O[K]);"],
  ["store-text", 'O[K] = "s" + turn;\nnote([O[K], O.x]);'],
  ["add", "O[K] += 1;\nnote(O[K]);"],
  ["step", "note(O[K]++);\nnote(--O[K]);"],
  ["nullish-store", "O[K] ??= 9;\nnote(O[K]);"],
  ["or-store", "O[K] ||= 8;\nnote(O[K]);"],
  ["delete", "note(delete O[K]);\nnote(O[K]);"],
  ["in", "note(K in O);"],
  ["own", "note(Object.hasOwn(O, K));"],
  ["optional", "note(O?.[K]);"],
  ["call", "note(O[K](turn));"],
  ["optional-call", "note(O[K]?.(turn));"],
  ["literal", "const made = { a: 1, [K]: turn };\nnote(made);"],
  ["pattern", "const { [K]: taken = 4, ...others } = O;\nnote([taken, others]);"],
  ["assigned", "const made = {};\nmade[K] = O[K];\nnote(made);"],
  ["written-beside", "O.x = 50;\nnote(O[K]);\nO[K] = 60;\nnote(O.x);"],
  ["swap", "const spare = O[K];\nO[K] = O.y;\nO.y = spare;\nnote([O[K], O.y]);"],
  ["compared", "note([O[K] === O.x, O[K] > 1]);"],
  ["nested", "const outer = { [K]: { [K]: turn } };\nnote(outer[K][K]);"],
  ["descriptor", "const found = Object.getOwnPropertyDescriptor(O, K);\nnote(found && [found.value, found.writable]);"],
  ["reflect", "note([Reflect.get(O, K), Reflect.set(O, K, 3), Reflect.has(O, K)]);"],
  ["list-element", "const list = [5, 6, 7];\nlist[K] = turn;\nnote([list[K], list.length]);"],
  ["keys-behind", "O[K] = 1;\nnote(Object.keys(O).slice(0, 6));"],
];
// What changes the object between two turns.
const changes: [name: string, text: string][] = [
  ["nothing", ""],
  ["nothing-again", ""],
  ["grows", 'O["z" + turn] = turn;'],
  ["field-removed", "delete O.x;"],
  ["field-back", "O.x = turn;"],
  ["prototype", "if (turn === 1) Object.setPrototypeOf(O, { x: 70, y: 71, none: 72 });"],
  ["redefined", 'if (turn === 1) Object.defineProperty(O, "x", { get: () => 80, configurable: true });'],
  ["frozen", "if (turn === 2) Object.freeze(O);"],
  ["by-key", "Object.defineProperty(O, K, { value: 90, configurable: true, enumerable: true, writable: turn < 2 });"],
];
// `STEP` is the step; the object is named `o`.
const shapes: [name: string, text: string][] = [
  ["one-object", "let turn = 0;\nHEAD\nconst o = OBJECT;\nfor (; turn < 4; turn++) {\nSTEP\n}"],
  ["new-objects", "for (let turn = 0; turn < 4; turn++) {\n  HEAD\n  const o = OBJECT;\nSTEP\n}"],
  [
    "nest",
    "for (let turn = 0; turn < 3; turn++) {\n  HEAD\n  const o = OBJECT;\n  for (let i = 0; i < 2; i++) {\nSTEP\n  }\n}",
  ],
  [
    "list",
    "let turn = 0;\nHEAD\nconst list = [OBJECT, { y: 4, x: 5 }, OBJECT, [6, 7]];\nfor (const o of list) {\nSTEP\n  turn++;\n}",
  ],
  [
    "field",
    "const holder = { o: null };\nfor (let turn = 0; turn < 4; turn++) {\n  HEAD\n  holder.o ??= OBJECT;\nSTEP\n}",
  ],
  ["callback", "[0, 1, 2].forEach(turn => {\n  HEAD\n  const o = OBJECT;\nSTEP\n});"],
];
const total = keys.length * holdings.length * objects.length * uses.length * changes.length * shapes.length;

function write(cell: number): { name: string; text: string } {
  let rest = Number((BigInt(cell) * 829348951n) % BigInt(total));
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const shape = pick(shapes);
  const drawnUse = pick(uses);
  const key = pick(keys);
  // The constructor of a function compiles text, which an executable refuses.
  const use = key[0] === "constructor" && drawnUse[1].includes("(turn)") ? uses[0] : drawnUse;
  const drawnObject = pick(objects);
  // Plain Bun converts the key of a store in front of the question whether there is an object.
  const object = key[0] === "object" && drawnObject[0] === "null-sometimes" ? objects[0] : drawnObject;
  const holding = pick(holdings);
  const drawn = pick(changes);
  const change = object[0] === "global" ? changes[0] : drawn;
  const indent = (text: string, by: string) => text.split("\n").filter(line => line).map(line => by + line).join("\n"); // prettier-ignore
  const o = shape[0] === "field" ? "holder.o" : "o";
  const step = [use[1], change[1]].filter(text => text).join("\n").replaceAll(/\bO\b/g, () => o); // prettier-ignore
  const tried = `try {\n${indent(step, "  ")}\n} catch (error) {\n  note(told(error));\n}`;
  const text = shape[1].replace("HEAD", () => holding[2].replaceAll("KEY", () => key[1])).replaceAll("OBJECT", () => (object[1].startsWith("{") ? `(${object[1]})` : object[1])).replace("STEP", () => indent(tried, "    ")); // prettier-ignore
  const lines = [
    "const notes = [];",
    "let sum = 0;",
    'const told = error => "!" + error.name;',
    'const show = value => (typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : value === globalThis ? "global" : value instanceof Error ? told(value) : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + typeof value[name]).join() + "}" : String(value));',
    "const note = value => void notes.push(show(value));",
    "class Point {\n  constructor(x) {\n    this.x = x;\n  }\n  ask(by) {\n    return this.x + by;\n  }\n}",
    "class Deep extends Point {\n  y = 1.5;\n}",
    "function named(x) {\n  return this ? 5 : x;\n}",
    "const given = function (...items) {\n  return arguments;\n};",
    "const dictionary = turn => {\n  const made = { x: turn, y: 1, w: 2 };\n  delete made.w;\n  delete made.y;\n  return made;\n};",
    "const shared = { x: 11, y: 12 };",
    ...holding[1].replaceAll("KEY", () => key[1]).split("\n"),
    "function walk() {",
    ...indent(text, "  ").split("\n"),
    "}",
    "for (let round = 0; round < 2; round++) {",
    "  try {",
    "    walk();",
    "  } catch (error) {",
    '    notes.push("left" + told(error));',
    "  }",
    "}",
    'console.log(notes.join(" "), String(sum), Object.keys(shared).join());',
  ].filter(line => line); // prettier-ignore
  return { name: `${key[0]}--${holding[0]}--${object[0]}--${use[0]}--${change[0]}--${shape[0]}.mjs`, text: lines.join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(8, "0");
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
