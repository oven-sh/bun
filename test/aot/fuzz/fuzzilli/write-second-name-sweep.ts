// The least programs in which one object has two names: how it is made, times what hands it on under its second name, times what is stored, times what is read, times the loop, times where it is kept, with nothing beside.
//
//   bun write-second-name-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<made>--<handed>--<stored>--<read>--<loop>--<kept>.mjs, .cjs or .ts
//   bun write-second-name-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `i` counts; the kinds say what the object is.
const made: [name: string, text: string, kind: "record" | "list" | "map" | "view"][] = [
  ["literal", "{ a: i, b: 1 }", "record"],
  ["one-field", "{ a: i }", "record"],
  ["empty", "{}", "record"],
  ["instance", "new C(i)", "record"],
  ["heir", "new D(i)", "record"],
  ["of-function", "make(i)", "record"],
  ["spread", "{ ...base, a: i }", "record"],
  ["created", "Object.create(base)", "record"],
  ["without-prototype", "{ __proto__: null, a: i }", "record"],
  ["with-accessor", "{ a: i, get b() {\n  return this.a;\n} }", "record"],
  ["function", "function () {}", "record"],
  ["list", "[i, 1, 2]", "list"],
  ["empty-list", "[]", "list"],
  ["fractions", "[i + 0.5, 1.5, 2]", "list"],
  ["texts", "['t' + i, 'b', 'c']", "list"],
  ["made-list", "new Array(3).fill(i)", "list"],
  ["map", "new Map([['a', i]])", "map"],
  ["view", "new Float64Array([i, 1, 2])", "view"],
  ["words", "new Int32Array([i, 1, 2])", "view"],
];
// O is the first name.
const handed: [name: string, text: string, kinds: string][] = [
  ["same", "O", "record list map view"],
  ["comma", "(0, O)", "record list map view"],
  ["or", "O || base", "record list map view"],
  ["choice", "n > 1 ? O : base", "record list map view"],
  ["choice-of-turn", "i & 1 ? O : last", "record list map view"],
  ["function", "pass(O)", "record list map view"],
  ["rest", "rest(O)", "record list map view"],
  ["closure", "(() => O)()", "record list map view"],
  ["element", "[O][0]", "record list map view"],
  ["field", "({ o: O }).o", "record list map view"],
  ["pattern", "(({ o }) => o)({ o: O })", "record list map view"],
  ["box", "((box.o = O), box.o)", "record list map view"],
  ["assigned", "(last = O)", "record list map view"],
  ["object", "Object(O)", "record list map view"],
  ["value-of", "Object.prototype.valueOf.call(O)", "record list map view"],
  [
    "define",
    "Object.defineProperty(O, 'c', { value: 3, writable: true, enumerable: true, configurable: true })",
    "record list map",
  ],
  [
    "define-old",
    "Object.defineProperty(O, 'a', { value: 3, writable: true, enumerable: true, configurable: true })",
    "record list map",
  ],
  ["define-fixed", "Object.defineProperty(O, 'c', { value: 3 })", "record list map"],
  ["define-accessor", "Object.defineProperty(O, 'c', { get: () => 4, configurable: true })", "record list map"],
  [
    "define-many",
    "Object.defineProperties(O, { c: { value: 3, writable: true }, d: { value: 4, enumerable: true } })",
    "record list map",
  ],
  ["assign", "Object.assign(O, { c: 3 })", "record list map view"],
  ["assign-old", "Object.assign(O, { a: 3 })", "record list map"],
  ["freeze", "Object.freeze(O)", "record list map"],
  ["seal", "Object.seal(O)", "record list map"],
  ["not-extended", "Object.preventExtensions(O)", "record list map"],
  ["prototype", "Object.setPrototypeOf(O, { c: 3 })", "record map"],
  ["fill", "O.fill(7)", "list view"],
  ["sort", "O.sort()", "list view"],
  ["reverse", "O.reverse()", "list view"],
  ["copied-within", "O.copyWithin(0, 1)", "list view"],
  ["set", "O.set('c', 3)", "map"],
  ["slice", "O.slice()", "list view"],
  ["concat", "O.concat()", "list"],
  ["map", "O.map(x => x)", "list view"],
  ["subarray", "O.subarray(0)", "view"],
  ["heir", "Object.create(O)", "record list map view"],
  ["spread", "({ ...O })", "record list view"],
  ["proxy", "new Proxy(O, {})", "record list"],
  ["reflected", "Reflect.construct(function () {\n  return O;\n}, [])", "record list map view"],
  ["generated", "gives(O).next().value", "record list map view"],
  ["values", "Object.values({ o: O })[0]", "record list map view"],
  ["held-weakly", "new WeakRef(O).deref()", "record list map view"],
  ["applied", "pass.apply(null, [O])", "record list map view"],
  ["bound", "pass.bind(null, O)()", "record list map view"],
];
// W is the name that is stored through.
const stored: [name: string, text: string, kinds: string][] = [
  ["nothing", ";", "record list map view"],
  ["field", "W.a = i + 10;", "record list map view"],
  ["other-field", "W.b = i + 20;", "record list map view"],
  ["new-field", "W.z = i;", "record list map view"],
  ["by-name", "W['a'] = i + 30;", "record list map view"],
  ["by-key", "W[key] = i + 40;", "record list map view"],
  ["counted", "W.a++;", "record"],
  ["added", "W.a += 0.5;", "record"],
  ["text", "W.a = 't' + i;", "record list map"],
  ["object", "W.a = { v: i };", "record list map"],
  ["removed", "delete W.a;", "record list map"],
  ["pattern", "({ a: W.a } = { a: i + 50 });", "record list map"],
  ["accessor", "Object.defineProperty(W, 'a', { get: () => 60, configurable: true });", "record map"],
  ["prototype", "Object.setPrototypeOf(W, { a: 70, z: 71 });", "record map"],
  ["element", "W[0] = i + 80;", "record list view"],
  ["last-element", "W[2] = i + 0.25;", "list view"],
  ["past", "W[5] = i;", "record list view"],
  ["pushed", "W.push(i);", "list"],
  ["popped", "W.pop();", "list"],
  ["shorter", "W.length = 1;", "list"],
  ["filled", "W.fill(i);", "list view"],
  ["put", "W.set('a', i + 90);", "map"],
  ["deleted", "W.delete('a');", "map"],
  ["by-call", "change(W, i);", "record list map view"],
];
// R is the name that is read, P the other.
const read: [name: string, text: string, kinds: string][] = [
  ["field", "R.a", "record list map"],
  ["other-field", "R.b", "record list map"],
  ["new-field", "R.z", "record list map view"],
  ["laid", "R.c", "record list map view"],
  ["both", "R.a + '|' + P.a", "record"],
  ["sum", "R.a + R.b", "record"],
  ["names", "Object.keys(R).join()", "record list view"],
  ["has", "'a' in R", "record list map"],
  ["own", "Object.hasOwn(R, 'c')", "record list map"],
  ["same", "R === P", "record list map view"],
  ["all", "String(JSON.stringify(R))", "record list map view"],
  ["element", "R[0]", "list view"],
  ["last-element", "R[2]", "list view"],
  ["length", "R.length", "list view"],
  ["joined", "R.join()", "list view"],
  ["held", "R.get('a')", "map"],
  ["size", "R.size", "map"],
  ["called", "ask(R)", "record list map view"],
  ["rest-of-pattern", "(({ a, ...r }) => Object.keys(r).length)(R)", "record list"],
];
const loops: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["once", "{\n  const i = 1;\n  IN\n}"],
  ["while", "let i = 0;\nwhile (i < n) {\n  IN\n  i++;\n}"],
  ["callee", "const go = i => {\n  IN\n};\nfor (let i = 0; i < n; i++) go(i);"],
  ["each", "[1, 2, 0].forEach(i => {\n  IN\n});"],
  ["try", "for (let i = 0; i < n; i++) {\n  try {\n    IN\n  } finally {\n    turns++;\n  }\n}"],
  ["nested", "for (let k = 0; k < 2; k++)\n  for (let i = 0; i < n; i++) {\n    IN\n  }"],
];
const kept: [name: string, text: string][] = [
  ["not", ""],
  ["second", "last = q;"],
  ["first", "last = o;"],
  ["listed", "all.push(q);"],
  ["returned", "if (turns > 9) return q;"],
];
// Which name is stored through, and which is read.
const ways: [name: string, stores: string, reads: string][] = [
  ["second-first", "q", "o"],
  ["first-second", "o", "q"],
  ["second-second", "q", "q"],
  ["first-first", "o", "o"],
];
const total = made.length * handed.length * stored.length * read.length * loops.length * kept.length * ways.length;

// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 33_000_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const [madeName, make, kind] = pick(made);
  const fitting = <T extends [string, string, string]>(from: readonly T[]): T => {
    const all = from.filter(one => one[2].split(" ").includes(kind));
    return all[(rest % from.length) % all.length];
  };
  const take = <T extends [string, string, string]>(from: readonly T[]): T => {
    const one = fitting(from);
    rest = Math.floor(rest / from.length);
    return one;
  };
  const hand = take(handed);
  const way = pick(ways);
  const store = take(stored);
  const ask = take(read);
  const loop = pick(loops);
  const keep = pick(kept);
  const isTyped = cell % 4 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const asking = ask[1].replaceAll(/\bR\b/g, way[2]).replaceAll(/\bP\b/g, way[2] === "o" ? "q" : "o");
  const body = [
    `const o = ${make};`,
    `const q = ${hand[1].replaceAll(/\bO\b/g, "o")};`,
    ...(store[1] === ";" ? [] : [store[1].replaceAll(/\bW\b/g, way[1])]),
    `out.push(${asking});`,
    ...(keep[1] ? [keep[1]] : []),
  ].join("\n");
  const inner = within(loop[1], "IN", body);
  const uses = (word: RegExp) => word.test(inner);
  const isCommon = !isTyped && cell % 3 === 0 && !/freeze|seal|preventExtensions|value: 3 }|get: /.test(body);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    ...(uses(/\bbase\b/) ? ["const base = { a: 5, e: 6 };"] : []),
    ...(uses(/\bbox\b/) ? ["const box = { o: null };"] : []),
    ...(uses(/\ball\b/) ? ["const all = [];"] : []),
    ...(uses(/\blast\b/) ? ["let last = { a: -1 };"] : []),
    ...(uses(/\bturns\b/) ? ["let turns = 0;"] : []),
    ...(uses(/\bkey\b/) ? ["let key = 'a';"] : []),
    ...(uses(/\bnew [CD]\b/) ? ["class C {\n  constructor(x) {\n    this.a = x;\n    this.b = 1;\n  }\n}"] : []),
    ...(uses(/\bnew D\b/) ? ["class D extends C {\n  e = 2;\n}"] : []),
    ...(uses(/\bmake\(/) ? ["function make(x) {\n  return { a: x, b: 1 };\n}"] : []),
    ...(uses(/\bpass\b/) ? ["function pass(x) {\n  return x;\n}"] : []),
    ...(uses(/\brest\(/) ? ["function rest(...x) {\n  return x[0];\n}"] : []),
    ...(uses(/\bgives\(/) ? ["function* gives(x) {\n  yield x;\n}"] : []),
    ...(uses(/\bchange\(/) ? ["function change(x, i) {\n  x.a = i + 100;\n}"] : []),
    ...(uses(/\bask\(/) ? ["function ask(x) {\n  return x.a;\n}"] : []),
    `function run(n) {\n${indent(inner, "  ")}\n}`,
    "for (const n of [2, 4]) {",
    "  try {",
    "    run(n);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    ...(uses(/\blast\b/) ? ["out.push(String(last.a));"] : []),
    ...(uses(/\ball\b/) ? ["out.push(all.map(x => String(x.a)).join('/'));"] : []),
    'console.log(out.map(x => String(typeof x === "object" && x ? x.v : x)).join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${madeName}--${hand[0]}--${way[0]}--${store[0]}--${ask[0]}--${loop[0]}--${keep[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
