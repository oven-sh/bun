// Stores and other uses under an index: what is stored into, times what was done with it in front, times the store, times the index, times the value, times what is read, times the place.
//
//   bun write-indexed-store-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<target>--<before>--<store>--<index>--<value>--<read>--<place>.mjs, .cjs or .ts
//   bun write-indexed-store-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number.
const targets: [name: string, text: string][] = [
  ["list", "[1, 2, 3]"],
  ["doubles", "[0.5, 1.5]"],
  ["objects", "[{}, [], null]"],
  ["empty", "[]"],
  ["holes", "[1, , 3]"],
  ["sparse", "Object.assign([], { 200000: 1, 3: 2 })"],
  ["object", "{}"],
  ["object-with-indices", "{ 0: 1, 1: 2, length: 2, a: 3 }"],
  ["bare", "Object.assign(Object.create(null), { 2: 1 })"],
  ["bytes", "new Uint8Array([1, 2, 3])"],
  ["clamped", "new Uint8ClampedArray(3)"],
  ["floats", "new Float64Array([0.5, 1])"],
  ["halves", "new Float16Array([0.5, 1.1])"],
  ["bigs", "new BigInt64Array(2)"],
  ["below-typed", "Object.create(new Uint8Array([4, 5]))"],
  ["below-halves", "Object.create(new Float16Array([4, 5]))"],
  ["list-below-typed", "Object.setPrototypeOf([1, 2], new Int8Array([7, 8, 9]))"],
  ["instance-below-typed", "new Below()"],
  ["below-list", "Object.create([4, 5, 6])"],
  ["proxy-of-list", "new Proxy([1, 2], {})"],
  ["proxy-of-object", "new Proxy({ 1: 1 }, {})"],
  ["proxy-of-typed", "new Proxy(new Uint8Array(2), {})"],
  ["proxy-of-proxy", "new Proxy(new Proxy([1], {}), {})"],
  ["proxy-with-get", "new Proxy([1, 2], { get: (of, key) => (key === '0' ? 9 : Reflect.get(of, key)) })"],
  ["below-proxy", "Object.create(new Proxy([1, 2], {}))"],
  ["arguments", "(function () {\n    return arguments;\n  })(1, 2)"],
  ["mapped-arguments", "new Function('a', 'return arguments;')(1, 2)"],
  ["text-object", "new String('ab')"],
  ["subclass", "Items.from([1, 2])"],
  [
    "accessor",
    "Object.defineProperty([1, 2], 1, { configurable: true, get: () => 8, set: value => void out.push('s') })",
  ],
  ["read-only", "Object.defineProperty([1, 2], 0, { writable: false, value: 1, configurable: false })"],
  ["resizable", "new Uint8Array(new ArrayBuffer(2, { maxByteLength: 8 }))"],
];
const befores: [name: string, text: string][] = [
  ["nothing", ""],
  ["frozen", "Object.freeze(t);"],
  ["sealed", "Object.seal(t);"],
  ["not-extensible", "Object.preventExtensions(t);"],
  ["indices-added", "t[4] = 1;\nt[9] = 2;"],
  ["deleted", "delete t[0];"],
  ["parent-accessor", "Object.setPrototypeOf(t, { set 5(value) { out.push('p'); } });"],
  ["parent-typed", "Object.setPrototypeOf(t, new Uint8Array([3, 4]));"],
  [
    "parent-proxy",
    "Object.setPrototypeOf(t, new Proxy({}, { set: (of, key, value, to) => (out.push(String(key)), true) }));",
  ],
  ["sealed-then-read", "Object.seal(t);\nout.push(t[0] === undefined);"],
  ["frozen-in-turn", "if (n === 2) Object.freeze(t);"],
];
// `K` the index, `V` the value.
const stores: [name: string, text: string][] = [
  ["store", "t[K] = V;"],
  ["sum", "t[K] += V;"],
  ["step", "t[K]++;"],
  ["nullish", "t[K] ??= V;"],
  ["reflect", "out.push(Reflect.set(t, K, V));"],
  ["reflect-other", "const other = {};\nout.push(Reflect.set(t, K, V, other), Object.keys(other).join());"],
  ["assigned", "Object.assign(t, { [K]: V });"],
  ["defined", "Object.defineProperty(t, K, { value: V, configurable: true, enumerable: true, writable: true });"],
  ["deleted", "out.push(delete t[K]);"],
  ["reflect-deleted", "out.push(Reflect.deleteProperty(t, K));"],
  ["pushed", "Array.prototype.push.call(t, V);"],
  ["filled", "if (!(t.length > 999)) Array.prototype.fill.call(t, V);"],
  ["copied", "Array.prototype.copyWithin.call(t, 0, 1);"],
  ["reversed", "if (!(t.length > 999)) Array.prototype.reverse.call(t);"],
  ["length", "t.length = 1;"],
  ["destructured", "[t[K], t[1]] = [V, i];"],
  ["of-helper", "put(t, K, V);"],
  ["own", "Object.hasOwn(t, K) ? (t[K] = V) : out.push('no');"],
  ["sorted", "if (!(t.length > 999)) Array.prototype.sort.call(t);"],
  ["spliced", "if (!(t.length > 999)) Array.prototype.splice.call(t, 0, 1, V);"],
  ["through-super", "below.put(K, V);"],
];
const indices: [name: string, text: string][] = [
  ["counter", "i"],
  ["zero", "0"],
  ["beyond", "5"],
  ["far", "100000"],
  ["below", "-1"],
  ["fraction", "1.5"],
  ["text", '"1"'],
  ["odd-text", '"01"'],
  ["text-of-run", "String(n)"],
  ["largest", "4294967294"],
  ["too-large", "4294967295"],
  ["negative-zero", "-0"],
  ["not-a-number", "NaN"],
  ["name", '"a"'],
];
const values: [name: string, text: string][] = [
  ["integer", "i + 1"],
  ["double", "i + 0.1"],
  ["large", "70000"],
  ["text", '"t"'],
  ["object", "{ v: i }"],
  ["nothing", "undefined"],
  ["not-a-number", "NaN"],
  ["negative-zero", "-0"],
  ["big", "1n"],
  ["converted", "{ valueOf: () => (out.push('v'), 3) }"],
];
const reads: [name: string, text: string][] = [
  ["entries", "out.push(show(Object.entries(t)));"],
  ["keys", "out.push(Object.keys(t).join('/'));"],
  ["names", "out.push(Object.getOwnPropertyNames(t).join('/'));"],
  [
    "json",
    "out.push(JSON.stringify(t.length > 999 ? 0 : t, (key, value) => (typeof value === 'bigint' ? 'b' : value)).slice(0, 120));",
  ],
  [
    "json-indented",
    "out.push(JSON.stringify({ t: typeof t[0] === 'bigint' || t.length > 999 ? 0 : t }, null, 1).slice(0, 120).replaceAll('\\n', '/'));",
  ],
  ["json-back", "out.push(show(JSON.parse(JSON.stringify(typeof t[0] === 'bigint' || t.length > 999 ? 0 : t))));"],
  ["element", "out.push(show(t[0]), show(t[1]), show(t[5]));"],
  ["in", "out.push(0 in t, 5 in t, '1' in t, Object.hasOwn(t, 0));"],
  ["frozen", "out.push(Object.isFrozen(t), Object.isSealed(t), Object.isExtensible(t));"],
  [
    "for-in",
    "let keys = '';\nfor (const key in t) if (keys.length < 80 && !keys.includes(key + ',')) keys += key + ',';\nout.push(keys);",
  ],
  ["spread", "out.push(show({ ...t }));"],
  ["spread-call", "out.push(show(all(...(typeof t[Symbol.iterator] === 'function' && t.length < 99 ? t : [1]))));"],
  ["spread-new", "out.push(new Kept(...(typeof t[Symbol.iterator] === 'function' && t.length < 99 ? t : [1])).count);"],
  ["apply", "out.push(show(all.apply(null, t.length < 99 ? t : [2])));"],
  [
    "described",
    "out.push(show(Object.entries(Object.getOwnPropertyDescriptor(t, 0) ?? {}).map(([key, value]) => key + ':' + (typeof value === 'function' ? 'f' : show(value)))));",
  ],
  ["values", "out.push(show(Object.values(t)));"],
  ["length", "out.push(show(t.length));"],
];
// `STEP` is a store and a read.
const places: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < 4; i++) {\n  STORE\n}\nREAD"],
  ["read-in-it", "for (let i = 0; i < 3; i++) {\n  STORE\n  {\n    READ\n  }\n}"],
  ["once", "const i = 1;\n{\n  STORE\n}\nREAD"],
  [
    "tried",
    "for (let i = 0; i < 4; i++) {\n  try {\n    STORE\n  } catch (error) {\n    out.push(error.name);\n  }\n}\nREAD",
  ],
  ["callback", "[0, 1, 2].forEach(i => {\n  STORE\n});\nREAD"],
  ["function", "const step = i => {\n  STORE\n};\nfor (let i = 0; i < 4; i++) step(i);\nREAD"],
  ["long", "for (let i = 0; i < 60; i++) {\n  STORE\n}\nREAD"],
];
const total = targets.length * befores.length * stores.length * indices.length * values.length * reads.length * places.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const target = pick(targets);
  const store = pick(stores);
  const before = pick(befores);
  const read = pick(reads);
  const index = pick(indices);
  const value = pick(values);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  // A CommonJS file that is not strict: a store that is refused is silent there.
  const isSloppy = isCommon && cell % 2 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const stored = store[1].replaceAll(/\b[KV]\b/g, letter => (letter === "K" ? index[1] : value[1]));
  const body = within(within(place[1], "STORE", stored), "READ", read[1]);
  const whole = body + target[1] + before[1];
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(isCommon && !isSloppy ? ['"use strict";'] : []),
    'const show = value => (Array.isArray(value) ? "[" + value.slice(0, 20).map(show) + (value.length > 20 ? value.length : "") + "]" : typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? "{" + Object.keys(value).slice(0, 20).map(key => key + ":" + (typeof value[key] === "object" ? "o" : typeof value[key] === "function" ? "f" : String(value[key]))) + "}" : typeof value === "function" ? "f" : Object.is(value, -0) ? "-0" : String(value));',
    "const out = [];",
    ...(/\bItems\b/.test(whole) ? ["class Items extends Array {}"] : []),
    ...(/\bBelow\b/.test(whole) ? ["class Below {\n  a = 1;\n}\nObject.setPrototypeOf(Below.prototype, new Uint8Array([6, 7]));"] : []), // prettier-ignore
    ...(/\bKept\b/.test(whole) ? ["class Kept {\n  constructor(...items) {\n    this.count = items.length;\n  }\n}"] : []), // prettier-ignore
    ...(/\ball\b/.test(body) ? ["const all = (...items) => items.length + ':' + show(items.slice(0, 3));"] : []),
    ...(/\bput\(/.test(body) ? ["const put = (to, key, value) => {\n  to[key] = value;\n};"] : []),
    "function work(n) {",
    `  let t = ${target[1]};`,
    ...(/\bbelow\b/.test(body) ? ["  const below = {\n    __proto__: t,\n    put(key, value) {\n      super[key] = value;\n    },\n  };"] : []), // prettier-ignore
    ...(before[1] ? [indent(before[1], "  ")] : []),
    indent(body, "  "),
    "}",
    "for (const n of [1, 2]) {",
    "  try {",
    "    work(n);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${target[0]}--${before[0]}--${store[0]}--${index[0]}--${value[0]}--${read[0]}--${place[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
