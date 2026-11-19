// Generators that are methods, and the loops over what they yield: where the method lives, times what it yields, times who it is called on, times the test in front, times the loop over it, times what the loop does, times what changes between two calls, times the values, times what is handed over.
//
//   bun write-generator-method-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<home>--<yields>--<receiver>--<test>--<consumer>--<work>--<change>--<values>--<argument>.mjs, .cjs or .ts
//   bun write-generator-method-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `GENERATOR` is the method `all`, its parameters and its body.
const homes: [name: string, text: string, name_: string][] = [
  [
    "class",
    "class Store {\n  items = [3, 1, 2];\n  table = new Map([['a', 1], ['b', 2]]);\n  GENERATOR\n  *other() {\n    yield 'o';\n  }\n}",
    "*all(n)",
  ],
  [
    "private",
    "class Store {\n  items = [3, 1, 2];\n  table = new Map([['a', 1], ['b', 2]]);\n  GENERATOR\n  all(n) {\n    return this.#all(n);\n  }\n  *other() {\n    yield 'o';\n  }\n}",
    "*#all(n)",
  ],
  [
    "static",
    "class Store {\n  static items = [3, 1, 2];\n  static table = new Map([['a', 1], ['b', 2]]);\n  GENERATOR\n  static *other() {\n    yield 'o';\n  }\n  all(n) {\n    return Store.all(n);\n  }\n}",
    "static *all(n)",
  ],
  [
    "above",
    "class Above {\n  items = [3, 1, 2];\n  table = new Map([['a', 1], ['b', 2]]);\n  GENERATOR\n  *other() {\n    yield 'o';\n  }\n}\nclass Store extends Above {}",
    "*all(n)",
  ],
  [
    "overridden",
    "class Above {\n  items = [3, 1, 2];\n  table = new Map([['a', 1], ['b', 2]]);\n  *all(n) {\n    yield 'above';\n  }\n  *other() {\n    yield 'o';\n  }\n}\nclass Store extends Above {\n  GENERATOR\n}",
    "*all(n)",
  ],
  [
    "by-symbol",
    "class Store {\n  items = [3, 1, 2];\n  table = new Map([['a', 1], ['b', 2]]);\n  GENERATOR\n  all(n) {\n    return this[Symbol.iterator](n);\n  }\n  *other() {\n    yield 'o';\n  }\n}",
    "*[Symbol.iterator](n)",
  ],
  [
    "on-prototype",
    "function Store() {\n  this.items = [3, 1, 2];\n  this.table = new Map([['a', 1], ['b', 2]]);\n}\nStore.prototype.other = function* () {\n  yield 'o';\n};\nStore.prototype.all = GENERATOR;",
    "function* (n)",
  ],
  [
    "field",
    "class Store {\n  items = [3, 1, 2];\n  table = new Map([['a', 1], ['b', 2]]);\n  *other() {\n    yield 'o';\n  }\n  all = GENERATOR;\n}",
    "function* (n)",
  ],
  [
    "list-below",
    "class Store extends Array {\n  items = [3, 1, 2];\n  table = new Map([['a', 1], ['b', 2]]);\n  GENERATOR\n  *other() {\n    yield 'o';\n  }\n}",
    "*all(n)",
  ],
];
// The generator's body; `n` is given.
const yields: [name: string, text: string][] = [
  ["items", "for (const x of this.items) yield x;"],
  ["counted", "for (let i = 0; i < n; i++) yield i;"],
  ["pairs", "for (const [key, value] of this.table) yield [key, value];"],
  ["entries", "for (const entry of this.table.entries()) yield entry;"],
  ["other", "yield* this.other();\nyield n;"],
  ["list", "yield* this.items;"],
  ["sometimes", "for (const x of this.items) {\n  if (x > 1) yield x;\n}"],
  [
    "tested",
    "for (const [key, value] of this.table) {\n  const isOld = this.items.includes(value);\n  if (isOld === false) yield [key, value];\n  else yield value;\n}",
  ],
  ["returns", "if (n > 1) return n;\nyield 1;"],
  ["finally", "try {\n  yield n;\n  yield n + 1;\n} finally {\n  out.push('f');\n}"],
  ["backwards", "for (let i = this.items.length - 1; i >= 0; i--) yield this.items[i];"],
  ["objects", "for (const x of this.items) yield { key: x, value: n };"],
  ["nothing", "out.push('empty');"],
  ["sent", "const given = yield n;\nyield given;"],
  ["itself", "if (n > 0) {\n  yield n;\n  if (this.all) yield* this.all(n - 1);\n}"],
];
// `s` is what it is called on.
const receivers: [name: string, text: string][] = [
  ["one", "const s = store;"],
  ["fresh", "const s = new Store();"],
  ["either", "const s = n & 1 ? store : new Store();"],
  ["of-two-classes", "const s = n === 2 ? { all: function* () { yield 'plain'; } } : store;"],
  ["maybe-null", "const s = n === 2 ? null : store;"],
  ["of-list", "const s = [store, new Store()][n & 1];"],
  ["of-map", "const s = new Map([[0, store]]).get(n & 1) ?? store;"],
  ["heir", "const s = new (class extends Store {})();"],
  ["list-or-store", "const s = n === 1 ? { all: () => [5, 6] } : store;"],
];
// `LOOP` is the loop.
const tests: [name: string, text: string][] = [
  ["none", "LOOP"],
  ["truth", "if (s) {\n  LOOP\n}"],
  ["size", "if (s?.items?.length > 0) {\n  LOOP\n}"],
  ["type", "if (typeof s?.all === 'function') {\n  LOOP\n}"],
  ["class", "if (s instanceof Store) {\n  LOOP\n} else out.push('not');"],
  ["caught", "try {\n  LOOP\n} catch (error) {\n  out.push(error.name);\n}"],
  ["method-read", "const { all } = s ?? {};\nif (all) {\n  LOOP\n}"],
  ["twice", "LOOP\n{\n  LOOP\n}"],
];
// `X` is done with `x`.
const consumers: [name: string, text: string][] = [
  ["of", "for (const x of s.all(n)) {\n  X\n}"],
  ["of-asked", "for (const x of s?.all?.(n) ?? []) {\n  X\n}"],
  ["pairs", "for (const [x, y] of s.all(n)) {\n  X\n  out.push(show(y));\n}"],
  ["fields", "for (const { key: x, value = 'none' } of s.all(n)) {\n  X\n  out.push(show(value));\n}"],
  ["spread", "for (const x of [...s.all(n)]) {\n  X\n}"],
  ["from", "Array.from(s.all(n), x => {\n  X\n});"],
  [
    "by-hand",
    "const it = s.all(n);\nfor (let turn = it.next(), count = 0; !turn.done && count < 6; turn = it.next(count), count++) {\n  const x = turn.value;\n  X\n}",
  ],
  ["kept", "const it = s.all(n);\nfor (const x of it) {\n  X\n}\nout.push(show([...it].length));"],
  ["first", "const [x, ...others] = s.all(n);\n{\n  X\n}\nout.push(others.length);"],
  ["breaks", "let count = 0;\nfor (const x of s.all(n)) {\n  X\n  if (count++ > 0) break;\n}"],
  ["handed-on", "const pass = function* () {\n  yield* s.all(n);\n};\nfor (const x of pass()) {\n  X\n}"],
  [
    "each",
    "const each = (call, self) => {\n  for (const x of s.all(n)) call.call(self, x, s);\n};\neach(x => {\n  X\n});",
  ],
  ["helper", "s.all(n).forEach?.(x => {\n  X\n});"],
  [
    "map",
    "const map = new Map([...s.all(n)].map((value, at) => [at, value]));\nfor (const x of map.values()) {\n  X\n}",
  ],
];
const works: [name: string, text: string][] = [
  ["shown", "out.push(show(x));"],
  ["summed", "sum += +x || 1;"],
  ["kept", "kept.push(x);"],
  ["text", "text += `${show(x)},`;"],
  ["stored", "box.last = x;\nout.push(show(box.last));"],
  ["changes", "if (kept.length < 3) store.items?.push?.(9);\nkept.push(x);"],
  ["throws", "if (x === 2) throw new RangeError('x');\nsum++;"],
];
const changes: [name: string, text: string][] = [
  ["nothing", ""],
  ["replaced", "if (n === 2) store.all = function* () {\n  yield 'mine';\n};"],
  ["on-prototype", "if (n === 2) Store.prototype.all = function* () {\n  yield 'proto';\n};"],
  ["list-instead", "if (n === 2) store.all = () => ['l'];"],
  ["other-replaced", "if (n === 1) Store.prototype.other = () => [7, 8];"],
  ["items", "if (n === 2) store.items = new Set(['x', 2]);"],
  [
    "generator-prototype",
    "if (n === 3) store.all = () => ({ [Symbol.iterator]: () => ({ next: () => ({ done: true }) }) });",
  ],
];
const values: [name: string, text: string][] = [
  ["integers", "0, 1, 2, 3"],
  ["doubles", "0.5, 2, 1.5"],
  ["many", "...Array(20).fill(2), 1, 3"],
];
// In the place of the argument `n`.
const handed: [name: string, text: string][] = [
  ["value", "n"],
  ["effect", "(out.push('g'), n)"],
  ["replaces", "replace(n)"],
  ["throws", "fail(n)"],
  ["spread", "...[n, 1]"],
  ["two", "n, out.push('s')"],
  ["changes", "(store.items?.push?.(8), n)"],
];
const total = homes.length * yields.length * receivers.length * tests.length * consumers.length * works.length * changes.length * values.length * handed.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const consumer = pick(consumers);
  const argument = pick(handed);
  const yielded = pick(yields);
  const home = pick(homes);
  const test = pick(tests);
  const receiver = pick(receivers);
  const work = pick(works);
  const change = pick(changes);
  const value = pick(values);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const generator = `${home[2]} {\n${indent(yielded[1], "  ")}\n}`;
  const declared = home[1].replace(
    /^( *)(.*)GENERATOR/m,
    (_, by, front) => by + front + indent(generator, by).trimStart(),
  );
  const loop = within(consumer[1], "X", work[1]).replaceAll(
    /\ball(\?\.)?\(n\)/g,
    (_, asked) => `all${asked ?? ""}(${argument[1]})`,
  );
  const body = [...(change[1] ? [change[1]] : []), receiver[1], within(test[1], "LOOP", loop)].join("\n");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + value.map(show).join("|") + "]" : typeof value === "object" && value ? "{" + Object.keys(value).join("|") + "}" : String(value).slice(0, 30));',
    "const out = [];",
    "let sum = 0;",
    'let text = "";',
    "const kept = [];",
    "const box = { last: 0 };",
    declared,
    "const store = new Store();",
    ...(/replace\(/.test(body)
      ? ["const replace = n => {\n  if (n > 1) store.all = function* () {\n    yield 'late';\n  };\n  return n;\n};"]
      : []),
    ...(/fail\(/.test(body) ? ["const fail = n => {\n  if (n > 1) throw new EvalError('a');\n  return n;\n};"] : []),
    `function run(n) {\n${indent(body, "  ")}\n}`,
    `for (const n of [${value[1]}]) {`,
    "  try {",
    "    run(n);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900), sum, text.slice(0, 200), kept.map(show).join().slice(0, 200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${home[0]}--${yielded[0]}--${receiver[0]}--${test[0]}--${consumer[0]}--${work[0]}--${change[0]}--${value[0]}--${argument[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
