// Iterators of Maps and Sets: how the table is made, times which iterator, times how it is stepped, times what happens on the way, times what is done with what comes, times where it stands.
//
//   bun write-table-iterator-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<table>--<iterator>--<step>--<event>--<use>--<place>.mjs, .cjs or .ts
//   bun write-table-iterator-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number, `given` a list of keys.
const tables: [name: string, text: string, isSet?: true][] = [
  ["map", "new Map([[1, 2], [3, 4], [5, 6]])"],
  ["set", "new Set([1, 3, 5])", true],
  ["empty-map", "new Map()"],
  ["empty-set", "new Set()", true],
  ["of-texts", "new Map([['a', 1], ['b', 0.5], ['c', null]])"],
  ["of-objects", "new Map([[{}, 1], [[], 2]])"],
  ["of-mixed", "new Set([1, 'a', undefined, NaN, -0, null])", true],
  ["filled", "fill(new Map())"],
  ["filled-set", "fill(new Set())", true],
  ["of-keys", "new Set(fill(new Map()).keys())", true],
  ["of-values", "new Set(fill(new Map()).values())", true],
  ["of-entries", "new Map(fill(new Map()).entries())"],
  ["copy", "new Map(fill(new Map()))"],
  ["copy-set", "new Set(fill(new Set()))", true],
  ["of-list", "new Set(given)", true],
  ["subclass", "fill(new Table())"],
  ["own-iterator", "fill(new Odd())"],
  ["emptied", "emptied(fill(new Map()))"],
  ["with-holes", "dropped(fill(new Map()))"],
  ["large", "new Map(Array.from({ length: 70 }, (_, at) => [at, at / 2]))"],
  ["of-field", "holder.table"],
  ["given", "choose(n)"],
  ["of-map-of-sets", "new Map([[1, new Set([7])], [2, new Set([8, 9])]])"],
];
// `t` is the table.
const iterators: [name: string, text: string][] = [
  ["itself", "t"],
  ["entries", "t.entries()"],
  ["keys", "t.keys()"],
  ["values", "t.values()"],
  ["symbol", "t[Symbol.iterator]()"],
  ["list", "[...t]"],
  ["list-of-keys", "[...t.keys()]"],
  ["from", "Array.from(t.values())"],
  ["mapped", "t.values().map(item => item)"],
  ["taken", "t.keys().take(2)"],
  ["wrapped", "Iterator.from(t.entries())"],
  ["by-call", "Map.prototype.keys.call(t)"],
  ["by-key", "t[way]()"],
  ["of-generator", "yielded(t)"],
  ["copied", "new Set(t.keys())"],
  ["copied-map", "new Map(t.entries())"],
];
// `it` is the iterator, `USE` the statement over `x`.
const steps: [name: string, text: string][] = [
  ["of", "for (const x of it) {\n  USE\n}"],
  ["of-broken", "for (const x of it) {\n  USE\n  if (i++ > 1) break;\n}"],
  ["of-continued", "for (const x of it) {\n  if (i++ & 1) continue;\n  USE\n}"],
  ["of-returned", "const first = () => {\n  for (const x of it) {\n    USE\n    return x;\n  }\n};\nlast = first();"],
  ["next", "for (let s = it.next(); !s.done; s = it.next()) {\n  const x = s.value;\n  USE\n}"],
  ["next-while", "let s;\nwhile (!(s = it.next()).done) {\n  const x = s.value;\n  USE\n}"],
  ["next-once", "const x = it.next().value;\nUSE"],
  ["next-twice", "it.next();\nconst x = it.next().value;\nUSE"],
  [
    "next-past",
    "for (let k = 0; k < 8; k++) {\n  const { value: x, done } = it.next();\n  if (done) out.push(k);\n  USE\n}",
  ],
  ["two", "const other = t.keys();\nfor (const x of it) {\n  USE\n  out.push(show(other.next().value));\n}"],
  ["resumed", "for (const x of it) {\n  USE\n  break;\n}\nfor (const x of it) {\n  USE\n}"],
  ["for-each", "[...it].forEach(x => {\n  USE\n});"],
  ["spread", "const x = Math.max(0, ...[...it].map(Number));\nUSE"],
  ["destructured", "const [x, second = 9, ...others] = it;\nUSE\nout.push(show(second), others.length);"],
  ["helper", "it.forEach?.(x => {\n  USE\n});"],
  ["reduced", "const x = Array.from(it).reduce((from, item) => from + String(item), '');\nUSE"],
  [
    "thrown",
    "try {\n  for (const x of it) {\n    USE\n    if (i++ === 1) throw new RangeError('t');\n  }\n} catch (error) {\n  out.push(error.name);\n}",
  ],
  [
    "nested",
    "for (const x of it) {\n  USE\n  for (const y of t.keys()) i += typeof y === 'number' ? y : 1;\n}\nout.push(i);",
  ],
];
const events: [name: string, text: string][] = [
  ["none", ""],
  ["added", "if (t.size < 9) add(t, 100 + t.size);"],
  ["deleted", "t.delete(3);"],
  ["deleted-first", "t.delete(t.keys().next().value);"],
  ["deleted-and-added", "t.delete(1);\nif (i < 4) add(t, 1);\ni++;"],
  ["cleared", "if (turn === 1) t.clear();"],
  ["cleared-and-added", "if (turn === 1 && t.size > 1) {\n  t.clear();\n  add(t, 50);\n}"],
  ["written", "if (t.set) t.set(1, turn + 0.5);"],
  ["grown", "if (turn === 0) for (let k = 0; k < 40; k++) add(t, 200 + k);"],
  ["exchanged", "if (turn === 1) t = new Map([[9, 9]]);"],
  ["own-next", "if (turn === 1 && typeof it.next === 'function') it.next = () => ({ done: true, value: 77 });"],
  ["own-keys", "if (turn === 0) t.keys = () => [5][Symbol.iterator]();"],
];
const uses: [name: string, text: string][] = [
  ["sum", "sum += typeof x === 'number' ? x : Array.isArray(x) ? +x[0] || 1 : 2;"],
  ["shown", "if (out.length < 30) out.push(show(x));"],
  [
    "pair",
    "const [key, value] = Array.isArray(x) ? x : [x, x];\nsum += (typeof key === 'number' ? key : 1) * (typeof value === 'number' ? value : 1);",
  ],
  ["kept", "kept.push(x);"],
  ["written", "if (Array.isArray(x)) x[0] = 'w';\nkept.push(x);"],
  ["counted", "sum++;"],
  ["asked", "sum += t.has(x) ? 1 : 10;"],
  ["last", "last = x;"],
  ["joined", "words += x;"],
];
// `STEP` is what is done with a table.
const places: [name: string, text: string][] = [
  ["loop", "for (let turn = 0; turn < 3; turn++) {\n  STEP\n}"],
  ["once", "const turn = 1;\n{\n  STEP\n}"],
  ["long", "for (let turn = 0; turn < 60; turn++) {\n  STEP\n}"],
  ["callback", "[0, 1, 2].forEach(turn => {\n  STEP\n});"],
  ["function", "const each = turn => {\n  STEP\n};\nfor (let turn = 0; turn < 3; turn++) each(turn);"],
  [
    "generator",
    "function* steps() {\n  for (let turn = 0; turn < 3; turn++) {\n    STEP\n    yield turn;\n  }\n}\nfor (const _ of steps());",
  ],
];
const total = tables.length * iterators.length * steps.length * events.length * uses.length * places.length * 2; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const iterator = pick(iterators);
  const step = pick(steps);
  const event = pick(events);
  const table = pick(tables);
  const use = pick(uses);
  const place = pick(places);
  // The table is made in front of the turns, or in each of them.
  const isFresh = pick([false, true]);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 5 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const used = [event[1], use[1]].filter(Boolean).join("\n");
  const isStepped = /\bit\.(next|forEach)\b/.test(step[1]);
  // A table and a list have no `next`.
  const made = isStepped && /^(t|\[\.\.\..*|Array.*|new .*)$/.test(iterator[1]) ? `${iterator[1]}[Symbol.iterator]()` : iterator[1]; // prettier-ignore
  const stepped = [...(isFresh ? [`let t = ${table[1]};`] : []), "let i = 0;", `const it = ${made};`, within(step[1], "USE", used)].join("\n"); // prettier-ignore
  const body = within(place[1], "STEP", stepped);
  const whole = body + table[1];
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Array.isArray(value) ? "[" + value.map(show) + "]" : value instanceof Map || value instanceof Set ? "{" + [...value].map(show) + "}" : typeof value === "object" && value ? "o" : Object.is(value, -0) ? "-0" : String(value));',
    "const out = [];",
    ...(/\bfill\(/.test(whole) ? ["const fill = table => {\n  for (let k = 0; k < 5; k++) table.set ? table.set(k * 2 + 1, k) : table.add(k * 2 + 1);\n  return table;\n};"] : []), // prettier-ignore
    ...(/\badd\(/.test(whole) ? ["const add = (table, key) => (table.set ? table.set(key, key / 2) : table.add(key));"] : []), // prettier-ignore
    ...(/\bTable\b/.test(whole) ? ["class Table extends Map {\n  keys() {\n    return [1, 2][Symbol.iterator]();\n  }\n}"] : []), // prettier-ignore
    ...(/\bOdd\b/.test(whole) ? ["class Odd extends Map {\n  *[Symbol.iterator]() {\n    yield [8, 8];\n  }\n}"] : []), // prettier-ignore
    ...(/\bemptied\(/.test(whole) ? ["const emptied = table => {\n  for (const key of table.keys()) table.delete(key);\n  return table;\n};"] : []), // prettier-ignore
    ...(/\bdropped\(/.test(whole) ? ["const dropped = table => {\n  table.delete(1);\n  table.delete(5);\n  return table;\n};"] : []), // prettier-ignore
    ...(/\bholder\b/.test(whole) ? ["const holder = { table: new Map([[1, 1], [2, 'b']]) };"] : []),
    ...(/\bchoose\(/.test(whole) ? ["const choose = n => (n & 1 ? new Map([[n, n]]) : new Set([n, 'n']));"] : []),
    ...(/\byielded\(/.test(whole) ? ["function* yielded(table) {\n  yield* table;\n}"] : []),
    ...(/\[way\]/.test(whole) ? ['const way = ["keys", "values"][out.length];'] : []),
    "function work(n, given) {",
    "  let sum = 0;",
    "  let last;",
    ...(/\bkept\b/.test(body) ? ["  const kept = [];"] : []),
    ...(/\bwords\b/.test(body) ? ['  let words = "";'] : []),
    ...(isFresh ? [] : [`  let t = ${table[1]};`]),
    indent(body, "  "),
    `  out.push(show(sum), show(last)${isFresh ? "" : ", t.size"}${/\bkept\b/.test(body) ? ", show(kept)" : ""}${/\bwords\b/.test(body) ? ", words" : ""});`,
    "}",
    "for (const n of [1, 2]) {",
    "  try {",
    "    work(n, n > 1 ? [0.5, 'g', 2] : [4, 5, 6]);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${table[0]}--${iterator[0]}--${step[0]}--${event[0]}--${use[0]}--${place[0]}${isFresh ? "-fresh" : ""}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
