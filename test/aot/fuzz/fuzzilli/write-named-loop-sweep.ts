// Loops over an object that the function does not know: what is read, times what is stored, times what else runs, times what happens on the way, times the object, times the second object, times the list, times the loop.
//
//   bun write-named-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<read>--<store>--<else>--<event>--<object>--<second>--<list>--<loop>.mjs, .cjs or .ts
//   bun write-named-loop-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `o` and `p` are objects, `t` a list or a text, `k` a name of the run, `f` a function, `i` counts, `s` is the sum.
const reads: [name: string, text: string][] = [
  ["field", "s += o.n;"],
  ["two-fields", "s += o.n * 2 + o.m;"],
  ["second", "s += p.n;"],
  ["by-key", "s += o[k];"],
  ["element", "s += t[i];"],
  ["compared", "if (t[i] === o.c) s++;"],
  ["compared-loosely", "if (t[i] == o.n) s++;"],
  ["not-compared", "if (t[i] !== o.c) s += 2;"],
  ["less", "if (i < o.n) s++;"],
  ["length", "s += t.length;"],
  ["inner-list", "s += o.l[i & 3];"],
  ["inner", "s += o.in.v;"],
  ["optional", "s += o?.n ?? 7;"],
  ["tested", "if (o.n) s++;\nelse s += 3;"],
  ["in", "if ('n' in o) s++;"],
  ["method", "s += o.run?.(i) ?? 1;"],
  ["destructured", "const { n, m = 4 } = o;\ns += n + m;"],
  ["code", "if (String(t[i]).charCodeAt(0) === o.code) s++;"],
  ["joined", "text += o.c;"],
];
const stores: [name: string, text: string][] = [
  ["none", ""],
  ["counter", "o.n = i;"],
  ["double", "o.n = i * 0.5;"],
  ["text", "o.n = 's' + i;"],
  ["other-field", "o.m = i;"],
  ["both", "o.n = i;\no.m = o.n;"],
  ["added", "o.n += 1;"],
  ["second", "p.n = i;"],
  ["by-key", "o[k] = i;"],
  ["inner-list", "o.l[i & 3] = i;"],
  ["inner", "o.in.v = i;"],
  ["new", "o.late = i;"],
  ["letter", "o.c = t[i];"],
  ["element", "if (typeof t === 'object') t[i] = o.n;"],
  ["deleted", "delete o.m;"],
  ["nullish", "o.n ??= i;"],
  ["stepped", "o.n++;"],
  ["proto", "o.__proto__ = p;"],
];
const others: [name: string, text: string][] = [
  ["none", ""],
  ["call", "f();"],
  ["handed", "f(o);"],
  ["second", "f(p);"],
  ["converted", "s += +String(i);"],
  ["pushed", "seen.push(o.n);"],
  ["sometimes", "if (i === 1) f(o);"],
];
const events: [name: string, text: string][] = [
  ["none", ""],
  ["frozen", "if (i === 2) Object.freeze(o);"],
  ["prototype", "if (i === 2) Object.setPrototypeOf(o, { n: 50, m: 60 });"],
  ["accessor", "if (i === 2) Object.defineProperty(o, 'n', { configurable: true, get: () => 70, set() {} });"],
  ["exchanged", "if (i === 2) o = p;"],
  ["removed", "if (i === 2) delete o.n;"],
  ["nothing", "if (i === 2) o.n = undefined;"],
  ["alias", "if (i === 2) alias.n = 90;"],
  ["letter", "if (i === 1) alias.c = 'a';"],
  ["list", "if (i === 2) t = ['b', 'a', 'b', 1, 2, 3];"],
  ["key", "if (i === 2) k = 'm';"],
  ["object", "if (i === 2) o.n = { valueOf: () => 5 };"],
];
const objects: [name: string, text: string][] = [
  ["literal", "{ n: 1, m: 2, c: 'b', l: [1, 2, 3, 4], in: { v: 1 }, code: 98 }"],
  ["other-order", "{ c: 'a', m: 0.5, n: 2, in: { v: 2 }, l: [0.5, 1, 2, 3] }"],
  ["instance", "new Holder(3)"],
  ["child", "new Wide(4)"],
  ["accessors", "new Told(5)"],
  ["frozen", "Object.freeze({ n: 6, m: 7, c: 'b', l: [1], in: { v: 1 } })"],
  ["bare", "Object.assign(Object.create(null), { n: 1, c: 'b', l: [2], in: { v: 3 } })"],
  ["inherits", "Object.create({ n: 8, m: 9, c: 'c', l: [3], in: { v: 4 } })"],
  ["list", "Object.assign([5, 6], { n: 1, m: 2, c: 'b', l: [4], in: { v: 5 } })"],
  ["function", "Object.assign(() => 1, { n: 2, m: 3, c: 'a', l: [5], in: { v: 6 } })"],
  ["proxy", "new Proxy({ n: 1, m: 2, c: 'b', l: [1], in: { v: 1 } }, {})"],
  ["view", "Object.assign(new Uint8Array(4), { n: 3, m: 4, c: 'b', l: [1], in: { v: 1 } })"],
  ["dictionary", "many({ n: 1, m: 2, c: 'b', l: [1, 2], in: { v: 1 } })"],
  ["missing", "{ m: 1, l: [], in: {} }"],
  ["text", "'text'"],
  ["number", "7"],
  ["nothing", "undefined"],
];
const lists: [name: string, text: string][] = [
  ["text", "'abcbab'"],
  ["texts", "['b', 'a', 'b', 'c', 'b']"],
  ["integers", "[1, 2, 3, 4, 5]"],
  ["doubles", "[0.5, 1, 1.5, 2]"],
  ["mixed", "[1, 'b', null, 2, 'a']"],
  ["bytes", "new Uint8Array([98, 97, 98, 1])"],
  ["like", "{ length: 4, 0: 'b', 1: 1, 2: 'a', 3: 'b' }"],
  ["wide", "'b\\u0100b\\u0101'"],
  ["holes", "['b', , 'b', 2]"],
];
// `STEP` in a turn.
const loops: [name: string, text: string][] = [
  ["length", "for (let i = 0; i < t.length; i++) {\n  STEP\n}"],
  ["constant", "for (let i = 0; i < 5; i++) {\n  STEP\n}"],
  ["field", "for (let i = 0; i < o.n && i < 9; i++) {\n  STEP\n}"],
  ["while", "let i = 0;\nwhile (i < 6) {\n  STEP\n  i++;\n}"],
  ["nested", "for (let j = 0; j < 2; j++) {\n  for (let i = 0; i < 4; i++) {\n    STEP\n  }\n}"],
  ["long", "for (let i = 0; i < 70; i++) {\n  STEP\n}"],
  ["down", "for (let i = 4; i >= 0; i--) {\n  STEP\n}"],
  ["callback", "[0, 1, 2, 3].forEach(i => {\n  STEP\n});"],
];
const total = reads.length * stores.length * others.length * events.length * objects.length ** 2 * lists.length * loops.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const read = pick(reads);
  const store = pick(stores);
  const event = pick(events);
  const object = pick(objects);
  const other = pick(others);
  const list = pick(lists);
  const loop = pick(loops);
  const second = pick(objects);
  const isTyped = cell % 5 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  // The store stands in front of the read or behind it.
  const isStoredFirst = cell % 2 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const step = [event[1], ...(isStoredFirst ? [store[1], other[1], read[1]] : [read[1], other[1], store[1]])].filter(Boolean).join("\n"); // prettier-ignore
  const body = within(loop[1], "STEP", step);
  const whole = object[1] + second[1];
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(isCommon && cell % 2 ? ['"use strict";'] : []),
    'const show = value => (typeof value === "function" ? "f" : Array.isArray(value) ? "[" + value.map(show) + "]" : typeof value === "object" && value ? "(" + ["n", "m", "c", "late"].map(name => (value[name] === undefined ? "" : show(typeof value[name] === "object" ? "o" : value[name]))) + ")" : Object.is(value, -0) ? "-0" : String(value).slice(0, 40));',
    "const out = [];",
    "let held = 0;",
    "const f = given => {\n  held++;\n  if (given && typeof given === 'object' && !Object.isFrozen(given)) given.n = held;\n};",
    ...(/Holder|Wide/.test(whole) ? ["class Holder {\n  c = 'b';\n  l = [1, 2];\n  in = { v: 1 };\n  constructor(n) {\n    this.n = n;\n    this.m = 2;\n  }\n  run(value) {\n    return this.n + value;\n  }\n}\nclass Wide extends Holder {\n  extra = 1;\n}"] : []), // prettier-ignore
    ...(/Told/.test(whole) ? ["class Told {\n  #n = 1;\n  m = 3;\n  c = 'b';\n  l = [1];\n  in = { v: 2 };\n  get n() {\n    return this.#n++;\n  }\n  set n(value) {\n    this.#n = +value || 0;\n  }\n}"] : []), // prettier-ignore
    ...(/many\(/.test(whole) ? ["const many = object => {\n  for (let at = 0; at < 90; at++) object['x' + at] = at;\n  delete object.x3;\n  return object;\n};"] : []), // prettier-ignore
    `function work(${isTyped ? "o: any, p: any, t: any, k: string" : "o, p, t, k"}) {`,
    "  let s = 0;",
    '  let text = "";',
    "  const seen = [];",
    "  const alias = o;",
    indent(body, "  "),
    "  out.push(show(s), text.slice(0, 20), seen.map(show).join('/').slice(0, 60), show(alias), show(p));",
    "}",
    "for (const round of [0, 1, 2]) {",
    "  try {",
    `    const o = ${object[1]};`,
    `    work(round === 1 ? ${second[1]} : o, round === 2 ? o : ${second[1]}, ${list[1]}, round ? "n" : "m");`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${read[0]}--${store[0]}--${other[0]}--${event[0]}--${object[0]}--${second[0]}--${list[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
