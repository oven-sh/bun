// Maps and sets that change while they are read: the collection, times the kind of keys, times how it is filled, times how it is read, times what changes in an iteration, times how many there are, times what is done with what is read, times the function around.
//
//   bun write-changed-collection-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<collection>--<key>--<filled>--<read>--<changed>--<count>--<used>--<function>.mjs, .cjs or .ts
//   bun write-changed-collection-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `m` is the collection; PUT(k, v) puts, HAS(k) asks, GET(k) reads.
const collections: [name: string, text: string, put: string, get: string][] = [
  ["map", "const m = new Map();", "m.set(K, W);", "m.get(K)"],
  ["set", "const m = new Set();", "m.add(K);", "m.has(K)"],
  ["map-of-list", "const m = new Map([[0, 'zero'], ['a', 1]]);", "m.set(K, W);", "m.get(K)"],
  ["set-of-list", "const m = new Set([0, 'a', 1.5]);", "m.add(K);", "m.has(K)"],
  [
    "class",
    "class Table extends Map {\n  get(key) {\n    return super.get(key) ?? 'none';\n  }\n}\nconst m = new Table();",
    "m.set(K, W);",
    "m.get(K)",
  ],
  ["field", "const box = { m: new Map() };\nconst { m } = box;", "box.m.set(K, W);", "box.m.get(K)"],
  ["counted", "const m = new Map();", "m.set(K, (m.get(K) ?? 0) + 1);", "m.get(K)"],
  ["copied", "const first = new Map([[1, 2]]);\nconst m = new Map(first);", "m.set(K, W);", "m.get(K)"],
  ["either", "const m = given ? new Map() : new Set();", "if (given) m.set(K, W);\nelse m.add(K);", "m.has(K)"],
];
const keys: [name: string, text: string][] = [
  ["integer", "i"],
  ["double", "i / 2"],
  ["text", "'k' + i"],
  ["short-text", "'abcdef'[i % 6]"],
  ["template", "`key-${i % 5}`"],
  ["minus-zero", "i === 0 ? -0 : i"],
  ["not-a-number", "i % 3 === 0 ? NaN : i"],
  ["object", "objects[i % objects.length]"],
  ["symbol", "symbols[i % 3]"],
  ["big", "BigInt(i) * 10n ** 20n"],
  ["truth", "i % 3 === 0"],
  ["mixed", "[i, String(i), objects[i & 3], null, undefined][i % 5]"],
  ["large", "i * 1e10"],
  ["negative", "-i"],
  ["wide-text", "'\\u00e9' + i"],
  ["function", "functions[i & 1]"],
];
const filled: [name: string, text: string][] = [
  ["counted", "for (let i = 0; i < N; i++) {\n  PUT\n}"],
  ["down", "for (let i = N; i > 0; i--) {\n  PUT\n}"],
  ["twice", "for (let i = 0; i < N; i++) {\n  PUT\n}\nfor (let i = 0; i < N; i += 2) {\n  PUT\n}"],
  ["and-removed", "for (let i = 0; i < N; i++) {\n  PUT\n  if (i & 1) m.delete(K);\n}"],
  ["emptied", "for (let i = 0; i < N; i++) {\n  PUT\n}\nm.clear();\nfor (let i = 3; i < 6; i++) {\n  PUT\n}"],
  ["callback", "Array.from({ length: N }, (_, i) => i).forEach(i => {\n  PUT\n});"],
  [
    "removed-and-again",
    "for (let i = 0; i < N; i++) {\n  PUT\n}\nfor (let i = 0; i < N; i += 3) {\n  m.delete(K);\n  PUT\n}",
  ],
];
// EACH is done with `x`; CHANGE may change the collection.
const reads: [name: string, text: string][] = [
  ["of", "for (const x of m) {\n  EACH\n}"],
  ["keys", "for (const x of m.keys()) {\n  EACH\n}"],
  ["values", "for (const x of m.values()) {\n  EACH\n}"],
  ["entries", "for (const [x, y] of m.entries()) {\n  EACH\n}"],
  ["each", "m.forEach((y, x) => {\n  EACH\n});"],
  ["spread", "for (const x of [...m.keys()]) {\n  EACH\n}"],
  ["from", "Array.from(m.values(), x => {\n  EACH\n});"],
  [
    "by-hand",
    "const it = m.keys();\nfor (let r = it.next(); !r.done; r = it.next()) {\n  const x = r.value;\n  EACH\n}",
  ],
  ["asked", "for (let i = 0; i < N; i++) {\n  const x = GET;\n  EACH\n}"],
  ["asked-past", "for (let i = -2; i < N + 2; i++) {\n  const x = GET;\n  EACH\n}"],
  ["leaves", "for (const x of m.keys()) {\n  EACH\n  if (turns > 2) break;\n}"],
  ["two", "for (const x of m.keys()) {\n  for (const y of m.values()) total += y === x ? 1 : 0;\n  EACH\n}"],
];
const changes: [name: string, text: string][] = [
  ["nothing", ""],
  ["removed", "if (turns === 2) m.delete(x);"],
  ["removed-all", "m.delete(x);"],
  ["removed-next", "if (turns === 1) {\n  const i = 2;\n  m.delete(K);\n}"],
  ["put", "if (turns === 2) {\n  const i = 77;\n  PUT\n}"],
  ["put-many", "if (turns === 1) {\n  for (let i = 100; i < 130; i++) {\n    PUT\n  }\n}"],
  ["emptied", "if (turns === 2) m.clear();"],
  ["moved", "if (turns < 4) {\n  m.delete(x);\n  const i = 200 + turns;\n  PUT\n}"],
  ["put-again", "const i = turns & 3;\nPUT"],
];
const counts: [name: string, count: number][] = [["few", 4], ["nine", 9], ["grown", 40], ["large", 150], ["none", 0]]; // prettier-ignore
const used: [name: string, text: string][] = [["shown", "out.push(show(x));"], ["counted", "total++;"], ["summed", "total += +x || 1;"], ["size", "out.push(m.size);"], ["kept", "kept.push(x);"], ["asked", "out.push(m.has(x));"]]; // prettier-ignore
const functions: [name: string, text: string][] = [["function", "function run(given) {\n  BODY\n}"], ["arrow", "const run = given => {\n  BODY\n};"], ["method", "class Runner {\n  run(given) {\n    BODY\n  }\n}\nconst run = given => new Runner().run(given);"]]; // prettier-ignore
const total = collections.length * keys.length * filled.length * reads.length * changes.length * counts.length * used.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const key = pick(keys);
  const read = pick(reads);
  const change = pick(changes);
  const collection = pick(collections);
  const fill = pick(filled);
  const count = pick(counts);
  const use = pick(used);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const each = ["if (++turns > 400) throw new RangeError('endless');", use[1], change[1]].filter(Boolean).join("\n");
  const work = within(`${fill[1]}\n${within(read[1], "EACH", each)}`, "PUT", collection[2]);
  const body = [
    collection[1],
    "let turns = 0;\nlet total = 0;\nconst kept = [];",
    work,
    "out.push(m.size, total, kept.map(show).join(), [...m.keys()].map(show).join().slice(0, 300));",
  ]
    .join("\n")
    .replaceAll(/\bGET\b/g, () => collection[3])
    .replaceAll(/\bK\b/g, () => key[1])
    .replaceAll(/\bW\b/g, "i * 2")
    .replaceAll(/\bN\b/g, String(count[1]));
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + value.map(show).join("|") + "]" : typeof value === "object" && value ? "o" + value.id : typeof value === "function" ? "f" : String(value).slice(0, 24));',
    "const out = [];",
    ...(/\bobjects\b/.test(body) ? ["const objects = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];"] : []),
    ...(/\bsymbols\b/.test(body) ? ["const symbols = [Symbol('s'), Symbol.for('t'), Symbol.iterator];"] : []),
    ...(/\bfunctions\b/.test(body) ? ["const functions = [() => 1, function () {}];"] : []),
    within(form[1], "BODY", body),
    "for (const given of [1, 0]) {",
    "  try {",
    "    run(given);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 2200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${collection[0]}--${key[0]}--${fill[0]}--${read[0]}--${change[0]}--${count[0]}--${use[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
