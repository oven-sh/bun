// Members that are defined by descriptors and by maps of them: the holder, times the road, times the descriptor, times the value, times what is done to the member, times how it is read, times the loop, times the function around.
//
//   bun write-defined-member-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<holder>--<road>--<descriptor>--<value>--<deed>--<read>--<loop>--<function>.mjs, .cjs or .ts
//   bun write-defined-member-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `o` gets the member `m`; DEFINE defines it.
const holders: [name: string, text: string][] = [
  ["literal", "const o = { a: 1, z: 2 };\nDEFINE"],
  ["empty", "const o = {};\nDEFINE"],
  ["has-it", "const o = { a: 1, m: 'old', z: 2 };\nDEFINE"],
  ["instance", "const o = new Holder(i);\nDEFINE"],
  [
    "prototype",
    "const Local = class {\n  a = 1;\n};\n{\n  const o = Local.prototype;\n  DEFINE\n}\nconst o = new Local();",
  ],
  ["list", "const o = [1, 2];\nDEFINE"],
  ["function", "const o = function () {};\nDEFINE"],
  ["class", "const o = class {\n  static a = 1;\n};\nDEFINE"],
  ["no-prototype", "const o = Object.create(null);\no.a = 1;\nDEFINE"],
  ["created", "const o = Object.create({ above: 1 });\nDEFINE"],
  ["frozen-later", "const o = { a: 1 };\nDEFINE\nObject.freeze(o);"],
  ["closed", "const o = Object.preventExtensions({ a: 1, m: 0 });\nDEFINE"],
  [
    "in-constructor",
    "class Made {\n  constructor() {\n    const o = this;\n    this.a = 1;\n    DEFINE\n    this.z = 2;\n  }\n}\nconst o = new Made();",
  ],
  ["outside", "const o = kept;\nDEFINE"],
];
// D is the descriptor.
const roads: [name: string, text: string][] = [
  ["one", "Object.defineProperty(o, 'm', D);"],
  ["map", "Object.defineProperties(o, { m: D });"],
  [
    "map-of-two",
    "Object.defineProperties(o, { n: { value: i, writable: true, enumerable: true, configurable: true }, m: D });",
  ],
  ["held-map", "const map = { m: D };\nObject.defineProperties(o, map);"],
  ["built-map", "const map = {};\nmap['m'] = D;\nObject.defineProperties(o, map);"],
  ["reflected", "Reflect.defineProperty(o, 'm', D);"],
  ["held-descriptor", "const d = D;\nObject.defineProperty(o, 'm', d);"],
  ["by-key", "Object.defineProperty(o, ['m', 'n'][0], D);"],
  ["in-loop", "for (const name of ['m', 'n']) Object.defineProperty(o, name, D);"],
  ["by-helper", "define(o, 'm', D);"],
  ["copied", "Object.defineProperties(o, Object.getOwnPropertyDescriptors({ m: V, get n() { return 5; } }));"],
  ["symbol", "Object.defineProperty(o, tag, D);\nObject.defineProperty(o, 'm', D);"],
  ["index", "Object.defineProperty(o, 3, D);\nObject.defineProperty(o, 'm', D);"],
  [
    "twice",
    "Object.defineProperty(o, 'm', { value: 'first', configurable: true });\nObject.defineProperty(o, 'm', D);",
  ],
];
const descriptors: [name: string, text: string][] = [
  ["value", "{ value: V }"],
  ["open", "{ value: V, writable: true, enumerable: true, configurable: true }"],
  ["writable", "{ value: V, writable: true }"],
  ["enumerable", "{ value: V, enumerable: true }"],
  ["configurable", "{ configurable: true, value: V }"],
  ["getter", "{ get: () => V, configurable: true }"],
  ["getter-and-setter", "{ get() { return V; }, set(x) { sets.push(x); }, enumerable: true, configurable: true }"],
  ["getter-of-this", "{ get() { return this.a; }, enumerable: true }"],
  ["setter", "{ set(x) { this.a = x; } }"],
  ["empty", "{}"],
  ["flag-of-turn", "{ value: V, writable: i > 1, enumerable: i !== 2, configurable: true }"],
  ["undefined-value", "{ value: undefined, writable: true, enumerable: true }"],
  ["held-getter", "{ get: getter, enumerable: true, configurable: true }"],
  ["both-kinds", "{ value: V, get: undefined }"],
];
const values: [name: string, text: string][] = [["integer", "i"], ["double", "i + 0.5"], ["text", "'v' + i"], ["function", "() => i"], ["object", "held"], ["constant", "7"]]; // prettier-ignore
const deeds: [name: string, text: string][] = [
  ["nothing", ""],
  ["stored", "o.m = 'stored';"],
  ["strict-stored", "store(o);"],
  ["stepped", "o.m++;"],
  ["removed", "delete o.m;"],
  ["defined-again", "Object.defineProperty(o, 'm', { value: 'again' });"],
  ["made-fixed", "Object.defineProperty(o, 'm', { writable: false });"],
  ["more", "o.late = 1;"],
  ["assigned", "Object.assign(o, { m: 'assigned' });"],
  ["heir", "const heir = Object.create(o);\nheir.m = 'heir';\nout.push(Object.hasOwn(heir, 'm'));"],
];
const reads: [name: string, text: string][] = [
  ["read", "out.push(show(o.m));"],
  ["keys", "out.push(Object.keys(o).join('/'));"],
  [
    "names",
    "out.push(Reflect.ownKeys(o).map(String).filter(name => name !== 'name' && name !== 'length' && name !== 'prototype' && name !== 'arguments' && name !== 'caller').join('/'));",
  ],
  [
    "descriptor",
    "const d2 = Object.getOwnPropertyDescriptor(o, 'm');\nout.push(d2 ? [d2.writable, d2.enumerable, d2.configurable, 'get' in d2, show(d2.value)].join() : 'none');",
  ],
  ["json", "out.push(JSON.stringify(o));"],
  ["in-loop", "for (const key in o) out.push(key, show(o[key]));"],
  ["copied", "const copy = { ...o };\nout.push(Object.keys(copy).join('/'), show(copy.m));"],
  ["called", "out.push(typeof o.m === 'function' ? show(o.m()) : 'n');"],
  ["asked", "out.push('m' in o, Object.hasOwn(o, 'm'), o.propertyIsEnumerable?.('m'));"],
  ["all", "out.push(show(o.a), show(o.m), show(o.n), show(o.z), sets.length);"],
];
// `STEP` in a turn.
const loops: [name: string, text: string][] = [["for", "for (let i = 0; i < 4; i++) {\n  STEP\n}"], ["once", "{\n  const i = 1;\n  STEP\n}"], ["many", "for (let i = 0; i < 40; i++) {\n  STEP\n}"], ["callback", "[0, 1, 2].forEach(i => {\n  STEP\n});"]]; // prettier-ignore
const functions: [name: string, text: string][] = [["function", "function run() {\n  BODY\n}"], ["arrow", "const run = () => {\n  BODY\n};"], ["strict", "function run() {\n  'use strict';\n  BODY\n}"]]; // prettier-ignore
const total = holders.length * roads.length * descriptors.length * values.length * deeds.length * reads.length * loops.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const road = pick(roads);
  const descriptor = pick(descriptors);
  const read = pick(reads);
  const holder = pick(holders);
  const deed = pick(deeds);
  const value = pick(values);
  const loop = pick(loops);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && form[0] !== "strict" && deed[0] !== "strict-stored";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const define = road[1].replace(/\bD\b/g, () => descriptor[1]).replace(/\bV\b/g, () => value[1]);
  const turn = `try {\n${indent([within(holder[1], "DEFINE", define), deed[1], read[1]].filter(Boolean).join("\n"), "  ")}\n} catch (error) {\n  out.push(error.name);\n}`;
  const body = within(loop[1], "STEP", turn);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : typeof value === "function" ? "f" : value && typeof value === "object" ? "{" + Object.keys(value).join("|") + "}" : String(value).slice(0, 20));',
    "const out = [];",
    "const sets = [];",
    ...(/\bheld\b/.test(body) ? ["const held = { h: 1 };"] : []),
    ...(/\bkept\b/.test(body) ? ["const kept = { a: 1 };"] : []),
    ...(/\btag\b/.test(body) ? ["const tag = Symbol('tag');"] : []),
    ...(/\bgetter\b/.test(body) ? ["const getter = function () {\n  return 'got';\n};"] : []),
    ...(/define\(/.test(body) ? ["const define = (o, name, d) => Object.defineProperty(o, name, d);"] : []),
    ...(/store\(/.test(body) ? ["function store(o) {\n  'use strict';\n  o.m = 'strict';\n}"] : []),
    ...(/Holder/.test(body) ? ["class Holder {\n  constructor(a) {\n    this.a = a;\n    this.z = 2;\n  }\n}"] : []),
    within(form[1], "BODY", body),
    "for (let round = 0; round < 2; round++) run();",
    'console.log(out.join(" ").slice(0, 1800));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${holder[0]}--${road[0]}--${descriptor[0]}--${value[0]}--${deed[0]}--${read[0]}--${loop[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
