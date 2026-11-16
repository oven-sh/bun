// The least programs of a thing that a loop reaches anew in each iteration: is it the same one? Each way to reach it, times each kind of thing, times two deeds with it, times each loop.
//
//   bun write-same-each-time-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<reach>--<kind>--<deed>--<deed>--<loop>.mjs, .cjs or .ts
//   bun write-same-each-time-sweep.ts count
//
// With HELD in the environment a program writes to its standard error what its things hold behind a collection; TURNS and ROWS say how many iterations there are and how many things.
import { mkdirSync, writeFileSync } from "node:fs";

// What stands before the loop, and how iteration `i` reaches `o`.
const reaches: [name: string, before: string, reach: string][] = [
  ["row", "const rows = ones;", "const o = rows[i % rows.length];"],
  ["row-in-turn", "const rows = ones;", "const o = rows[i];\nif (!o) return sum;"],
  ["other-step", "const rows = ones;", "const o = rows[(i * 2 + 1) % rows.length];"],
  ["same", "const rows = ones;", "const o = rows[0];"],
  ["name", "const one = ones[1];", "const o = one;"],
  ["turns", "let a = ones[0];\nlet b = ones[1];", "[a, b] = [b, a];\nconst o = a;"],
  ["either", "const a = ones[0];\nconst b = ones[1];", "const o = i & 1 ? a : b;"],
  [
    "next",
    "const nodes = ones.map(list => ({ list, next: null }));\nnodes.forEach((node, at) => (node.next = nodes[(at + 1) % nodes.length]));\nlet node = nodes[0];",
    "node = node.next;\nconst o = node.list;",
  ],
  ["children", "const tree = { children: ones };", "const o = tree.children[i % tree.children.length];"],
  ["field-of-row", "const nodes = ones.map((list, at) => ({ list, at }));", "const o = nodes[i % nodes.length].list;"],
  [
    "this",
    "class Holder {\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    return this.x;\n  }\n}\nconst holders = ones.map(x => new Holder(x));",
    "const o = holders[i % holders.length].get();",
  ],
  [
    "this-field",
    "class Holder {\n  constructor(rows) {\n    this.rows = rows;\n  }\n  at(i) {\n    return this.rows[i % this.rows.length];\n  }\n}\nconst holder = new Holder(ones);",
    "const o = holder.at(i);",
  ],
  ["written-field", "const holder = { x: ones[0] };", "holder.x = ones[i % ones.length];\nconst o = holder.x;"],
  [
    "rarely-written-field",
    "const holder = { x: ones[0] };",
    "if (i % 4 === 3) holder.x = ones[(i >> 2) % ones.length];\nconst o = holder.x;",
  ],
  ["map", "const map = new Map(ones.map((one, at) => [at, one]));", "const o = map.get(i % map.size);"],
  [
    "map-of-texts",
    "const map = new Map(ones.map((one, at) => ['k' + at, one]));",
    "const o = map.get('k' + (i % ones.length));",
  ],
  [
    "weak-map",
    "const keys = ones.map(() => ({}));\nconst map = new WeakMap(ones.map((one, at) => [keys[at], one]));",
    "const o = map.get(keys[i % keys.length]);",
  ],
  [
    "key",
    "const table = {};\nones.forEach((one, at) => (table['k' + at] = one));",
    "const o = table['k' + (i % ones.length)];",
  ],
  [
    "captured",
    "let current = ones[0];\nconst go = i => void (current = ones[i % ones.length]);",
    "go(i);\nconst o = current;",
  ],
  [
    "captured-rarely",
    "let current = ones[0];\nconst go = i => {\n  if (i === 3) current = ones[2];\n};",
    "go(i);\nconst o = current;",
  ],
  ["variable-rarely", "let o = ones[0];", "if (i === 3) o = ones[2];"],
  ["variable-behind", "let o = ones[0];", "sum += i;\nif (i % 3 === 1) o = ones[i % ones.length];"],
  [
    "destructured",
    "const holders = ones.map(one => ({ one, n: 1 }));",
    "const { one: o } = holders[i % holders.length];",
  ],
  ["destructured-row", "const holders = ones.map(one => [one, 1]);", "const [o] = holders[i % holders.length];"],
  ["returned", "const pick = i => ones[i % ones.length];", "const o = pick(i);"],
  ["returned-object", "const pick = i => ({ o: ones[i % ones.length], i });", "const { o } = pick(i);"],
  [
    "getter",
    "let at = 0;\nconst holder = {\n  get o() {\n    return ones[at++ % ones.length];\n  },\n};",
    "const o = holder.o;",
  ],
  ["static", "class C {\n  static o = ones[0];\n}", "C.o = ones[i % ones.length];\nconst o = C.o;"],
  [
    "private",
    "class P {\n  #o = ones[0];\n  turn(i) {\n    if (i % 2) this.#o = ones[i % ones.length];\n    return this.#o;\n  }\n}\nconst p = new P();",
    "const o = p.turn(i);",
  ],
  [
    "iterator",
    "const steps = (function* () {\n  for (let k = 0; ; k++) yield ones[k % ones.length];\n})();",
    "const o = steps.next().value;",
  ],
  ["new-row", "const rows = [...ones];", "if (i === 4) rows[0] = make(7);\nconst o = rows[i % 2];"],
  ["copied", "const rows = ones;", "const o = [...rows][i % rows.length];"],
  ["at", "const rows = ones;", "const o = rows.at(-1 - (i % rows.length));"],
  ["shifted", "const rows = [...ones];", "const o = rows.shift();\nrows.push(o);"],
  ["popped", "const rows = [...ones];", "const o = rows.pop();\nrows.unshift(o);"],
  ["argument", "const inner = o => o;", "const o = inner(ones[i % ones.length]);"],
  ["two-levels", "const grid = [ones, [...ones].reverse()];", "const o = grid[i & 1][i % ones.length];"],
  [
    "other-of",
    "const links = ones.map(one => ({ one, other: null }));\nlinks.forEach((link, at) => (link.other = links[(at + 2) % links.length]));\nlet link = links[0];",
    "const o = link.one;\nlink = link.other;",
  ],
  ["swapped", "const rows = [...ones];", "const o = rows[0];\nrows[0] = rows[1];\nrows[1] = o;"],
  ["chosen-by-value", "let o = ones[0];", "o = sum & 1 ? ones[1] : ones[0];"],
];
const kinds: [name: string, make: string, deeds: string][] = [
  ["integers", "const make = k => [k, 2, 3];", "list"],
  ["fractions", "const make = k => [k + 0.5, 2.5];", "list"],
  ["empty", "const make = k => [];", "list"],
  ["texts", "const make = k => ['t' + k, 'u'];", "list"],
  ["mixed", "const make = k => (k & 1 ? [k, 'x', null] : [k, 2, 3]);", "list"],
  ["kinds", "const make = k => (k & 1 ? [0.5, k] : k ? ['s'] : [1, 2, 3]);", "list"],
  ["holes", "const make = k => [k, , 3];", "list"],
  ["objects-in-list", "const make = k => [{ v: k }, { v: 2 }];", "list"],
  ["object", "const make = k => ({ v: k, t: 'a' + k, sub: { v: k }, l: [k] });", "object"],
  [
    "shapes",
    "const make = k => (k & 1 ? { t: 'b', v: k, l: [], sub: { v: 1 } } : { v: k, sub: { v: 2 }, t: 'a', l: [1] });",
    "object",
  ],
  [
    "instance",
    "class One {\n  t = 'c';\n  l = [];\n  sub = { v: 3 };\n  constructor(v) {\n    this.v = v;\n  }\n}\nconst make = k => new One(k);",
    "object",
  ],
  [
    "two-classes",
    "class One {\n  v = 1;\n  t = 'd';\n  l = [];\n  sub = { v: 3 };\n}\nclass Two {\n  t = 'e';\n  sub = { v: 4 };\n  l = [2];\n  v = 0.5;\n}\nconst make = k => (k & 1 ? new One() : new Two());",
    "object",
  ],
  ["values", "const make = k => ({ v: [1, 's', 0.5][k % 3], t: 'f', sub: { v: k }, l: ['q'] });", "object"],
  ["bare", "const make = k => Object.assign(Object.create(null), { v: k, t: 'g', sub: { v: 5 }, l: [] });", "object"],
  [
    "fractions-view",
    "const make = k => new Float64Array(new ArrayBuffer(32, { maxByteLength: 256 })).fill(k);",
    "view",
  ],
  ["bytes-view", "const make = k => new Uint8Array([k, 2, 3, 250]);", "view"],
  [
    "views",
    "const make = k => (k & 1 ? new Int32Array(4) : k ? new Float32Array(3) : new Uint8ClampedArray(5));",
    "view",
  ],
  ["tracking", "const make = k => new Int16Array(new ArrayBuffer(16, { maxByteLength: 64 }));", "view"],
  ["map", "const make = k => new Map([[k, k], [1, 'one']]);", "map"],
  ["map-of-texts", "const make = k => new Map([['k' + k, k]]);", "map"],
  ["set", "const make = k => new Set([k, 1, 's']);", "set"],
  [
    "private",
    "class Own {\n  #p;\n  #l = [];\n  constructor(p) {\n    this.#p = p;\n  }\n  step(i) {\n    this.#p += i;\n    return this.#p;\n  }\n  keep(i) {\n    return this.#l.push(i);\n  }\n  get p() {\n    return this.#p;\n  }\n  set p(v) {\n    this.#p = v;\n  }\n}\nconst make = k => new Own(k);",
    "own",
  ],
  [
    "dictionary",
    "const make = k => {\n  const o = {};\n  for (let j = 0; j < 6; j++) o['d' + j] = j + k;\n  delete o.d2;\n  return o;\n};",
    "dictionary",
  ],
  ["indexed-object", "const make = k => ({ 0: k, 1: 2, length: 2 });", "dictionary"],
];
const deeds: Record<string, string[]> = {
  "list": [
    "o.push(i);",
    "o.push(i, 'x');",
    "o.push(i / 4);",
    "o.push({ v: i });",
    "sum += o.length;",
    "o.pop();",
    "o.length = 2;",
    "o[o.length] = i;",
    "o[o.length + 1] = i;",
    "o[0] = i;",
    "o[0] += i;",
    "sum += o[0] | 0;",
    "sum += o[o.length - 1] | 0;",
    "o.sort();",
    "o.reverse();",
    "o.shift();",
    "o.unshift(i);",
    "o.splice(1, 1);",
    "o.fill(i, 0, 1);",
    "delete o[1];",
    "sum += o.at(-1) | 0;",
    "for (const e of o) sum += e | 0;",
    "sum += o.indexOf(i);",
    "sum += o.concat(i).length;",
    "o[1] = 't' + i;",
    "const last = o.pop();\no.push(last);",
    "if (o.length > 6) o.length = 0;",
    "sum += o.join().length;",
    "o.copyWithin(0, 1);",
    "sum += o.push(i);",
    "o[i] = i;",
    "const q = o;\nq.push(i);\nsum += o.length;",
  ],
  "object": [
    "o.v += i;",
    "sum += o.v | 0;",
    "o.v = 't' + i;",
    "o.late = i;",
    "sum += o.late | 0;",
    "delete o.v;",
    "sum += 'late' in o ? 1 : 2;",
    "o.m = () => i;\nsum += o.m();",
    "sum += Object.keys(o).length;",
    "o.sub.v++;\nsum += o.sub.v;",
    "o['k' + (i & 1)] = i;",
    "if (i === 5) Object.freeze(o);",
    "if (i === 3) Object.setPrototypeOf(o, { up: 9 });",
    "sum += o.up | 0;",
    "o.t += 'x';",
    "sum += o.t.length;",
    "sum += o.l.push(i);",
    "o.v = { n: i };\nsum += o.v.n;",
    "sum += typeof o.v === 'number' ? 1 : 2;",
    "o.v = undefined;",
    "o.v ??= 5;",
    "o.l = [i];",
    "o.sub = { v: i, w: 1 };",
    "const { v = 4, ...rest } = o;\nsum += Object.keys(rest).length;",
    "o.v = i / 2;",
    "sum += o.v === i ? 1 : 2;",
    "o.l.length = 1;",
    "Object.defineProperty(o, 'g', { get: () => 3, configurable: true });",
    "sum += o.g | 0;",
    "o.sub = null;\nsum += o.sub?.v ?? 1;\no.sub = { v: 2 };",
  ],
  "view": [
    "o[0] = i * 1.5;",
    "o[i % 3] += i;",
    "sum += o[0];",
    "sum += o.length;",
    "if (o.buffer.resizable) o.buffer.resize(8 + (i % 4) * 8);",
    "o.fill(i);",
    "sum += o.at(-1) | 0;",
    "o.set([i], 0);",
    "if (i === 5) structuredClone(o.buffer, { transfer: [o.buffer] });",
    "o.sort();",
    "for (const e of o) sum += e;",
    "sum += o.byteLength;",
    "sum += o.subarray(1).length;",
    "sum += o.indexOf(i);",
    "for (let k = 0; k < o.length; k++) o[k] += 1;",
    "o.reverse();",
    "sum += o[o.length - 1] ?? 7;",
    "o.copyWithin(0, 1);",
    "sum += new DataView(o.buffer).byteLength;",
  ],
  "map": [
    "o.set(i, i);",
    "o.set('k' + i, i);",
    "o.delete(i - 1);",
    "sum += o.size;",
    "sum += o.get(1) | 0;",
    "sum += o.has(i) ? 1 : 2;",
    "if (i === 4) o.clear();",
    "for (const k of o.keys()) sum += k | 0;",
    "o.set(1, (o.get(1) | 0) + i);",
    "o.forEach(v => (sum += v | 0));",
    "sum += [...o].length;",
    "o.set(o.size, o);\no.delete(o.size - 1);",
  ],
  "set": [
    "o.add(i);",
    "o.add('k' + i);",
    "o.delete(i - 1);",
    "sum += o.size;",
    "sum += o.has(i) ? 1 : 2;",
    "if (i === 4) o.clear();",
    "for (const k of o) sum += k | 0;",
    "sum += [...o].length;",
    "o.add(o.size);",
    "o.forEach(v => (sum += v | 0));",
  ],
  "own": [
    "sum += o.step(i) | 0;",
    "sum += o.keep(i);",
    "o.p = 't' + i;",
    "sum += o.p | 0;",
    "o.p = i / 2;",
    "o.late = i;",
    "sum += o.late | 0;",
    "sum += typeof o.p === 'number' ? 1 : 2;",
    "o.p = undefined;",
    "o.p = { i };\nsum += o.p.i;",
  ],
  "dictionary": [
    "o['d' + (i % 7)] = i;",
    "delete o['d' + (i % 5)];",
    "sum += Object.keys(o).length;",
    "sum += o.d1 | 0;",
    "o.d1 = 't';",
    "o[i] = i;",
    "sum += o[0] | 0;",
    "for (const k in o) sum += k.length;",
    "sum += 'd3' in o ? 1 : 2;",
    "o.d1 = i / 2;",
    "o.length = i;",
    "delete o[0];",
    "Object.assign(o, { d1: i, e: 2 });",
  ],
};
const loops: [name: string, text: string][] = [
  ["for", "for (let i = 0; i < n; i++) {\n  BODY\n}"],
  ["while", "let i = 0;\nwhile (i < n) {\n  BODY\n  i++;\n}"],
  ["do", "let i = 0;\ndo {\n  BODY\n} while (++i < n);"],
  ["of", "for (const i of turns) {\n  BODY\n}"],
  ["nested", "for (let j = 0; j < 2; j++)\n  for (let i = 0; i < n; i++) {\n    BODY\n  }"],
  ["inner", "for (let j = 0; j < 3; j++) {\n  const i = j;\n  for (let k = 0; k < 3; k++) {\n    BODY\n  }\n}"],
  ["each", "turns.forEach(i => {\n  BODY\n});"],
  ["map", "turns.map(i => {\n  BODY\n  return 0;\n});"],
  ["itself", "const again = i => {\n  if (i >= n) return;\n  BODY\n  again(i + 1);\n};\nagain(0);"],
  [
    "steps",
    "const all = (function* () {\n  for (let i = 0; i < n; i++) {\n    BODY\n    yield i;\n  }\n})();\nfor (const i of all) sum += i;",
  ],
  ["skipped", "for (let i = 0; i < n; i++) {\n  if (i === 2) continue;\n  BODY\n  if (sum > 100000) break;\n}"],
  ["handled", "for (let i = 0; i < n; i++) {\n  try {\n    BODY\n  } catch (e) {\n    sum += e.name.length;\n  }\n}"],
  ["down", "for (let i = n; i-- > 0; ) {\n  BODY\n}"],
  ["awaited", "for (let i = 0; i < n; i++) {\n  BODY\n  await null;\n}"],
  ["callee", "const turn = i => {\n  BODY\n};\nfor (let i = 0; i < n; i++) turn(i);"],
  ["filter", "sum += turns.filter(i => {\n  BODY\n  return i & 1;\n}).length;"],
];
const most = Math.max(...Object.values(deeds).map(list => list.length));
const total = reaches.length * kinds.length * most * most * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 9_830_401;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const reach = pick(reaches);
  const kind = pick(kinds);
  const first = pick(Array.from({ length: most }, (_, at) => deeds[kind[2]][at % deeds[kind[2]].length]));
  const second = pick(Array.from({ length: most }, (_, at) => deeds[kind[2]][at % deeds[kind[2]].length]));
  const loop = pick(loops);
  const isTyped = cell % 4 === 1;
  const isAwaited = loop[0] === "awaited";
  const isCommon = !isTyped && cell % 3 === 0 && !isAwaited; // a program that waits is a module
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const block = (text: string) => (/^(const|let) /m.test(text) ? `{\n${indent(text, "  ")}\n}` : text);
  // A function inside of the loop's body has an end of its own.
  const inFunction = /each|map|itself|steps|callee|filter/.test(loop[0]);
  const reached = inFunction ? reach[2].replace("return sum;", "return;") : reach[2];
  const body = within(loop[1], "BODY", `${reached}\n${block(first)}\n${block(second)}`);
  const isHeldToOne = cell % 6 === 4;
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(isCommon && cell % 2 ? ["'use strict';"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "function" ? "function" : Object.is(v, -0) ? "-0" : Array.isArray(v) ? `[${Array.from(v.slice(0, 12), tell)}]/${v.length}` : v instanceof Map || v instanceof Set ? `{${[...v].slice(0, 8).map(e => (e === v || e[1] === v ? "itself" : tell(e)))}}` : ArrayBuffer.isView(v) ? `<${v.buffer.detached ? "gone" : Array.from(v).slice(0, 8)}>` : typeof v === "object" && v ? `{${Object.keys(v).slice(0, 9).map(k => k + "=" + (typeof v[k] === "object" && v[k] && !Array.isArray(v[k]) ? Object.keys(v[k]).join("/") + (v[k].v ?? "") : tell(v[k])))}}` : String(v));',
    kind[1],
    `${isAwaited ? "async " : ""}function run(n, ones, turns) {\n${indent(`let sum = 0;\n${reach[1]}\n${body}\nreturn sum;`, "  ")}\n}`,
    "const held = [];",
    "const many = Number(process.env.ROWS ?? 3);",
    "const heap = () => (Bun.gc(true), process.memoryUsage().heapUsed);",
    `${isAwaited ? "async " : ""}function once(n) {\n  const ones = Array.from({ length: many }, (_, at) => make(at));\n  const turns = Array.from({ length: n }, (_, at) => at);\n  held.push(ones);\n  const before = process.env.HELD ? heap() : 0;\n  try {\n    said.push(tell(${isAwaited ? "await " : ""}run(n, ones, turns)));\n  } catch (e) {\n    said.push(e.name);\n  }\n  if (process.env.HELD) console.error("HELD", heap() - before);\n  said.push(...ones.slice(0, 3).map(one => tell(one)));\n}`,
    `${isAwaited ? "await " : ""}once(Number(process.env.TURNS ?? 9));${isHeldToOne ? "" : `\n${isAwaited ? "await " : ""}once(Number(process.env.TURNS ?? 4));`}\nconsole.log(said.join(" ").slice(0, 1600));`,
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${reach[0]}--${kind[0]}--${deeds[kind[2]].indexOf(first)}--${deeds[kind[2]].indexOf(second)}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
