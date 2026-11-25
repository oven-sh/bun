// Names and values of an object asked again and again: the object, times how it is asked, times what is done with the answer, times what happens to the object between two askings, times where the askings stand.
//
//   bun write-own-key-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<object>--<ask>--<use>--<change>--<place>.mjs
//   bun write-own-key-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number from 1.
const objects: [name: string, text: string][] = [
  ["literal", "{ a: 1, b: n }"],
  ["three", '{ c: n, a: "x", b: null }'],
  ["integers", "{ b: 1, 2: n, a: 3, 0: 4 }"],
  ["empty", "{}"],
  ["instance", "new Row(n)"],
  ["heir", "new Heir(n)"],
  ["made", "make(n)"],
  ["by-turns", "n & 1 ? { a: 1 } : { b: 2, a: 1 }"],
  ["hidden", 'Object.defineProperty({ a: 1, z: n }, "h", { value: 2 })'],
  ["symbol", "{ a: n, [Symbol.iterator]: 1 }"],
  ["getter", "{ a: 1, get g() {\n  return n;\n} }"],
  ["inherits", "Object.assign(Object.create({ p: 1 }), { a: n })"],
  ["bare", "Object.assign(Object.create(null), { a: n, b: 2 })"],
  ["list", "[n, 2]"],
  ["holes", "[n, , 3]"],
  ["list-with-name", "Object.assign([1], { x: n })"],
  ["text", '"ab"'],
  ["number", "n"],
  ["nothing", "n === 2 ? undefined : { a: 1 }"],
  ["function", "Object.assign(() => 1, { f: n })"],
  ["class", "Row"],
  ["proxy", "new Proxy({ a: 1, b: n }, {})"],
  ["proxy-of-keys", 'new Proxy({ a: 1 }, { ownKeys: () => ["a", "q"] })'],
  ["parsed", 'JSON.parse(`{"b":${n},"a":[1]}`)'],
  ["spread", "{ ...{ a: 1, b: 2 }, c: n }"],
  ["frozen", "Object.freeze({ a: 1, b: n })"],
  ["many", "many(n)"],
  ["by-key", 'keyed(["x", "y", "a" + n])'],
  ["deleted", 'without({ a: 1, b: 2, c: n }, "b")'],
  ["typed", "new Uint8Array(n)"],
  ["map", "new Map([[1, n]])"],
  ["namespace", 'Object.fromEntries([["k" + n, 1], ["a", 2]])'],
];
// `o` is the object.
const asks: [name: string, text: string][] = [
  ["keys", "Object.keys(o)"],
  ["values", "Object.values(o)"],
  ["entries", "Object.entries(o)"],
  ["names", "Object.getOwnPropertyNames(o)"],
  ["reflect", "Reflect.ownKeys(o)"],
  ["in-loop", "((names = []) => {\n  for (const name in o) names.push(name);\n  return names;\n})()"],
  ["of-keys", "((names = []) => {\n  for (const name of Object.keys(o)) names.push(name);\n  return names;\n})()"],
  [
    "of-entries",
    "((names = []) => {\n  for (const [name, value] of Object.entries(o)) names.push(name, value);\n  return names;\n})()",
  ],
  ["json", 'JSON.stringify(o)?.split(",") ?? []'],
  ["spread", "Object.keys({ ...o })"],
  ["assigned", "Object.keys(Object.assign({}, o))"],
  ["rest", "(({ a, ...others }) => Object.keys(others))(o ?? {})"],
  ["mapped", "Object.keys(o).map(name => o[name])"],
  ["descriptors", "Object.keys(Object.getOwnPropertyDescriptors(o))"],
  ["length", "[Object.keys(o).length]"],
  ["sorted", "Object.keys(o).sort()"],
  ["filtered", 'Object.keys(o).filter(name => name !== "a")'],
  ["from", "Array.from(Object.keys(o))"],
  ["symbols", "Object.getOwnPropertySymbols(o)"],
];
// `answer` is the list.
const uses: [name: string, text: string][] = [
  ["kept", ""],
  ["pushed-to", 'answer.push("more");'],
  ["first-written", 'answer[0] = "first";'],
  ["popped", "answer.pop();"],
  ["shifted", "answer.shift();"],
  ["reversed", "answer.reverse();"],
  ["sorted", "answer.sort();"],
  ["shortened", "answer.length = 1;"],
  ["spliced", 'answer.splice(0, 1, "s");'],
  ["filled", "answer.fill(0);"],
  ["frozen", "Object.freeze(answer);"],
  ["named", "answer.named = 1;"],
  ["compared", "notes.push(answer === last, answer.length === last?.length);"],
  ["joined", 'notes.push(answer.join("+"));'],
  ["text-added", 'if (answer.length) answer[answer.length - 1] += "!";'],
];
const changes: [name: string, text: string][] = [
  ["none", ""],
  ["writes", "o.a = turn;"],
  ["adds", 'o["n" + turn] = turn;'],
  ["adds-one", "o.later = turn;"],
  ["deletes", "delete o.a;"],
  ["deletes-and-adds", "delete o.a;\no.a = turn;"],
  ["integer", "o[turn] = turn;"],
  ["hides", 'if (turn === 1) Object.defineProperty(o, "a", { enumerable: false });'],
  ["symbol", 'o[Symbol.for("s" + turn)] = 1;'],
  ["parent", "if (turn === 1) Object.setPrototypeOf(o, { p: 1 });"],
  ["replaced", "o = { z: turn, a: 1 };"],
  ["by-turns", "o = turn & 1 ? { x: 1 } : { y: 2, x: 1 };"],
  ["frozen", "Object.freeze(o);"],
];
const places: [name: string, text: string][] = [
  ["loop", "for (let turn = 0; turn < 3; turn++) {\n  const answer = ASK;\n  USE\n  keep(answer);\n  CHANGE\n}"],
  [
    "function",
    "const ask = o => ASK;\nfor (let turn = 0; turn < 3; turn++) {\n  const answer = ask(o);\n  USE\n  keep(answer);\n  CHANGE\n}",
  ],
  [
    "two",
    "for (let turn = 0; turn < 3; turn++) {\n  const answer = ASK;\n  CHANGE\n  keep(ASK);\n  USE\n  keep(answer);\n}",
  ],
  ["callback", "[0, 1, 2].forEach(turn => {\n  const answer = ASK;\n  USE\n  keep(answer);\n  CHANGE\n});"],
  [
    "tried",
    "for (let turn = 0; turn < 3; turn++) {\n  try {\n    const answer = ASK;\n    USE\n    keep(answer);\n    CHANGE\n  } catch (error) {\n    notes.push(error.name);\n  }\n}",
  ],
  ["once", "const turn = 1;\nconst answer = ASK;\nUSE\nkeep(answer);\nCHANGE\nkeep(ASK);"],
];
const total = objects.length * asks.length * uses.length * changes.length * places.length * objects.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const object = pick(objects);
  const ask = pick(asks);
  const use = pick(uses);
  const change = pick(changes);
  const place = pick(places);
  const other = pick(objects);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const body = place[1]
    .replaceAll("ASK", () => ask[1])
    .replace("USE", () => use[1])
    .replace("CHANGE", () => change[1]);
  const used = [object[1], other[1]].join(" ");
  const lines = [
    "const notes = [];",
    'const show = value => (typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : Array.isArray(value) ? "[" + Array.from(value, show).join() + "]" : typeof value === "object" && value ? "object" : String(value));',
    "let last;",
    "const keep = answer => {\n  notes.push(show(answer));\n  last = answer;\n};",
    ...(/Row|Heir/.test(used) ? ["class Row {\n  b = 1;\n  constructor(a) {\n    this.a = a;\n  }\n}"] : []),
    ...(/Heir/.test(used) ? ["class Heir extends Row {\n  c = 3;\n}"] : []),
    ...(/make\(/.test(used) ? ["const make = n => {\n  const made = {};\n  made.first = n;\n  if (n > 1) made.second = 2;\n  return made;\n};"] : []),
    ...(/many\(/.test(used) ? ['const many = n => {\n  const made = {};\n  for (let i = 0; i < 40; i++) made["m" + ((i * 7) % 40)] = n;\n  return made;\n};'] : []),
    ...(/keyed\(/.test(used) ? ["const keyed = names => {\n  const made = {};\n  for (const name of names) made[name] = 1;\n  return made;\n};"] : []),
    ...(/without\(/.test(used) ? ["const without = (made, name) => {\n  delete made[name];\n  return made;\n};"] : []),
    "function work(o) {",
    indent(body, "  ").split("\n").filter(line => line.trim()).join("\n"),
    "}",
    "for (const n of [1, 2, 3]) {",
    `  for (const made of [${object[1]}, ${other[1]}]) {`,
    "    try {",
    "      work(made);",
    "    } catch (error) {",
    "      notes.push(error.name);",
    "    }",
    "  }",
    "}",
    'console.log(notes.join(" ").slice(0, 900));',
  ]; // prettier-ignore
  return {
    name: `${object[0]}--${ask[0]}--${use[0]}--${change[0]}--${place[0]}.mjs`,
    text: lines.join("\n") + "\n",
  };
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
