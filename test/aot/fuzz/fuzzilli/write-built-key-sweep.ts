// Fields whose names are built: how the name is built, times what it is asked of, times how the holder got its fields, times what is read, times what is stored between, times the loop, times the values, times the function around.
//
//   bun write-built-key-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<key>--<holder>--<read>--<store>--<loop>--<value>--<function>.mjs, .cjs or .ts
//   bun write-built-key-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// The name is `key`; `i` counts and `p` is "k".
const keys: [name: string, text: string][] = [
  ["added", "const key = 'k' + i;"],
  ["template", "const key = `k${i}`;"],
  ["behind", "const key = i + 'k';"],
  ["given", "const key = p + i;"],
  ["three", "const key = p + i + '_' + (i & 1);"],
  ["joined", "const key = [p, i].join('');"],
  ["sliced", "const key = 'k0k1k2k3k4k5'.slice(i * 2, i * 2 + 2);"],
  ["upper", "const key = ('K' + i).toLowerCase();"],
  ["from-list", "const key = ['k0', 'k1', 'x', 'isPrototypeOf', 'length', '2'][i % 6];"],
  ["index-text", "const key = '' + i;"],
  ["number", "const key = i;"],
  ["padded", "const key = 'k' + String(i).padStart(1, '0');"],
  ["from-code", "const key = 'k' + String.fromCharCode(48 + i);"],
  ["replaced", "const key = 'k#'.replace('#', String(i));"],
  ["proto", "const key = i === 2 ? '__' + 'proto__' : 'k' + i;"],
  ["concat", "const key = p.concat(i);"],
  ["symbol-or-text", "const key = i & 1 ? Symbol.for('k' + i) : 'k' + i;"],
  ["split", "const key = 'k0,k1,k2,k3'.split(',')[i & 3];"],
  ["double", "const key = 'k' + i / 2;"],
];
// `o` is the holder.
const holders: [name: string, text: string][] = [
  ["literal", "const o = { k0: V, k1: 1, k2: 'two', k3: V };"],
  ["empty", "const o = {};"],
  ["filled", "const o = {};\nfor (let i = 0; i < 4; i++) o['k' + i] = V;"],
  ["instance", "const o = new Holder(V);"],
  ["instance-with-more", "const o = new Holder(V);\no.k9 = V;\no.k1 = 'late';"],
  ["many", "const o = {};\nfor (let i = 0; i < 80; i++) o['k' + i] = i & 1 ? V : i;"],
  ["deleted", "const o = { k0: V, k1: 1, k2: V };\ndelete o.k1;"],
  ["no-prototype", "const o = Object.create(null);\no.k1 = V;"],
  ["above", "const o = Object.create({ k1: V, k2: 'above' });\no.k0 = V;"],
  [
    "accessor",
    "const o = {\n  held: V,\n  get k1() {\n    return this.held;\n  },\n  set k1(value) {\n    this.held = value;\n  },\n  k2: 2,\n};",
  ],
  ["list", "const o = [V, 1];\no.k1 = V;"],
  ["map-like", "const o = Object.fromEntries([['k0', V], ['k2', 2]]);"],
  ["spread", "const o = { ...{ k0: V, k1: 1 }, k2: V };"],
  ["frozen", "const o = Object.freeze({ k0: V, k1: 1 });"],
  ["class", "class Own {\n  static k0 = V;\n  static k1() {\n    return 1;\n  }\n}\nconst o = Own;"],
  [
    "proxy",
    "const o = new Proxy({ k0: V, k1: 1 }, { get: (target, name) => (name === 'k1' ? 'trap' : target[name]) });",
  ],
  ["parsed", 'const o = JSON.parse(\'{"k0":1,"k1":{"a":2},"k2":0.5}\');'],
  ["either", "const o = p === 'k' ? { k0: V, k1: 1 } : { k1: V, k0: 1, k2: 2 };"],
  ["read-only", "const o = {};\nObject.defineProperty(o, 'k1', { value: V, configurable: true });\no.k0 = V;"],
  [
    "table-of-functions",
    "const o = { k0: silent(() => V), k1: silent(function () { return this === o; }), k2: Math.abs };",
  ],
];
const reads: [name: string, text: string][] = [
  ["read", "out.push(show(o[key]));"],
  ["asked", "out.push(key in o, Object.hasOwn(o, key));"],
  ["or", "out.push(show(o[key] ?? 'none'));"],
  ["added", "o[key] += 1;\nout.push(show(o[key]));"],
  ["counted", "o[key] = (o[key] || 0) + 1;\nout.push(show(o[key]));"],
  ["called", "out.push(typeof o[key] === 'function' ? show(o[key](i)) : 'not');"],
  ["deleted", "out.push(delete o[key], key in o);"],
  [
    "destructured",
    "const { [key]: found = 'default', ...others } = o;\nout.push(show(found), Object.keys(others).length);",
  ],
  ["stepped", "o[key]++;\nout.push(show(o[key]));"],
  ["nested", "out.push(show(o[key]?.a), show(o?.[key]));"],
  ["twice", "const once = o[key];\nout.push(show(once) + show(o[key]));"],
  ["literal", "const made = { [key]: i, x: 1 };\nout.push(show(made.k1), JSON.stringify(made));"],
  ["nullish-store", "o[key] ??= 'filled';\nout.push(show(o[key]));"],
  ["reflected", "out.push(show(Reflect.get(o, key)), show(Object.getOwnPropertyDescriptor(o, key)?.value));"],
  ["compared", "out.push(o[key] === o.k1, o[key] === V);"],
  ["listed", "out.push(Object.keys(o).indexOf(key));"],
];
// Stands in front of the read.
const stores: [name: string, text: string][] = [
  ["nothing", ""],
  ["same", "o[key] = V;"],
  ["fixed", "o.k1 = i;"],
  ["other-kind", "o[key] = i & 1 ? 'text' : 0.5;"],
  ["new-name", "o['n' + i] = i;"],
  ["removed", "if (i === 2) delete o.k1;"],
  ["assigned", "Object.assign(o, { [key]: i });"],
  ["defined", "if (i === 1) Object.defineProperty(o, 'k0', { get: () => 'getter', configurable: true });"],
  ["by-other-key", "const other = 'k' + (i + 1);\no[other] = i;"],
  ["read-first", "sum += +o[key] || 0;"],
];
// `STEP` in a turn.
const loops: [name: string, text: string][] = [
  ["for", "for (let i = 0; i < 5; i++) {\n  STEP\n}"],
  ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < 4; i++) {\n    STEP\n  }\n}"],
  ["callback", "[0, 1, 2, 3].forEach(i => {\n  STEP\n});"],
  ["once", "{\n  const i = 1;\n  STEP\n}"],
  ["down", "for (let i = 4; i >= 0; i--) {\n  STEP\n}"],
  ["many", "for (let i = 0; i < 40; i++) {\n  STEP\n}"],
  ["of", "for (const i of [2, 0, 7, 1]) {\n  STEP\n}"],
];
const values: [name: string, text: string][] = [
  ["integer", "3"],
  ["double", "1.5"],
  ["text", "'t'"],
  ["object", "box"],
  ["nothing", "undefined"],
  ["given", "given"],
];
const functions: [name: string, text: string][] = [
  ["function", "function run(p, given) {\n  BODY\n}"],
  ["arrow", "const run = (p, given) => {\n  BODY\n};"],
  ["strict", "function run(p, given) {\n  'use strict';\n  BODY\n}"],
  [
    "method",
    "class Runner {\n  run(p, given) {\n    BODY\n  }\n}\nconst run = (p, given) => new Runner().run(p, given);",
  ],
];
const total = keys.length * holders.length * reads.length * stores.length * loops.length * values.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const holder = pick(holders);
  const key = pick(keys);
  const read = pick(reads);
  const store = pick(stores);
  const loop = pick(loops);
  const value = pick(values);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && form[0] !== "strict";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const turn = `${key[1]}\ntry {\n${indent(`${store[1] ? store[1] + "\n" : ""}${read[1]}`, "  ")}\n} catch (error) {\n  out.push(error.name);\n}`;
  const body =
    `${holder[1]}\nlet sum = 0;\n${within(loop[1], "STEP", turn)}\nout.push(sum, Object.keys(o).join('/').slice(0, 60));`.replaceAll(
      /\bV\b/g,
      value[1],
    );
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : typeof value === "function" ? "f" : typeof value === "object" && value ? "{" + Object.keys(value).join("|") + "}" : String(value).slice(0, 30));',
    "const out = [];",
    ...(/\bbox\b/.test(body) ? ["const box = { a: 1 };"] : []),
    ...(/silent/.test(holder[1]) ? ["const silent = made => Object.assign(made, { toString: () => 'F' });"] : []),
    ...(/Holder/.test(holder[1])
      ? ["class Holder {\n  constructor(v) {\n    this.k0 = v;\n    this.k1 = 1;\n    this.k2 = v;\n  }\n}"]
      : []),
    within(form[1], "BODY", body),
    "for (const [p, given] of [['k', 2], ['k', 0.5], ['q', 'g']]) {",
    "  try {",
    "    run(p, given);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 2000));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${key[0]}--${holder[0]}--${read[0]}--${store[0]}--${loop[0]}--${value[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
