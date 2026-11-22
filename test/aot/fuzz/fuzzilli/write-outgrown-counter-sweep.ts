// The least programs of a counter that outgrows its kind: each place, times where it starts, times each step, times each copy of it, times each use of the copy.
//
//   bun write-outgrown-counter-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<place>--<start>--<step>--<copy>--<use>--<loop>.mjs, .cjs or .ts
//   bun write-outgrown-counter-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// PLACE is the counter.
const spots: [name: string, text: string, place: string][] = [
  ["variable", "let c = START;", "c"],
  ["captured", "let c = START;\nconst get = () => c;", "c"],
  ["field", "const o = { c: START, d: 0 };", "o.c"],
  ["two-fields", "const o = { c: START, d: START };", "o.d"],
  [
    "class-field",
    "class C {\n  c = START;\n  step() {\n    this.c += 1;\n  }\n}\nconst o = new C();\nconst o2 = new C();",
    "o.c",
  ],
  [
    "private",
    "class C {\n  #c = START;\n  get c() {\n    return this.#c;\n  }\n  set c(v) {\n    this.#c = v;\n  }\n}\nconst o = new C();",
    "o.c",
  ],
  ["static", "class C {\n  static c = START;\n}", "C.c"],
  ["element", "const l = [START, 0, 1];", "l[0]"],
  ["pushed", "const l = [];\nl.push(START);", "l[0]"],
  ["any-element", "const l = [1, START, 2];\nconst at = given ? 1 : 1;", "l[at]"],
  ["row", "const rows = [[START], [0]];", "rows[0][0]"],
  ["item", "const items = [{ c: START }, { c: 0 }];", "items[0].c"],
  ["key", "const o = {};\no['c'] = START;", "o['c']"],
  ["doubles", "const l = new Float64Array([START, 0]);", "l[0]"],
  ["module", "", "top"],
  ["map", "const m = new Map([['c', START]]);", "MAP"],
];
const starts: string[] = [
  "0",
  "1",
  "2147483646",
  "2147483640",
  "-2147483647",
  "-2147483648",
  "4294967294",
  "4294967290",
  "1073741823",
  "9007199254740989",
  "-1",
  "0.5",
  "65535",
  "Number(given)",
  "given",
];
const steps: string[] = [
  "P++;",
  "P += 1;",
  "P += 2;",
  "P = P + 1;",
  "P--;",
  "P -= 3;",
  "P *= 2;",
  "P = P * 2 + 1;",
  "P += i;",
  "P += given;",
  "P = (P + 1) | 0;",
  "P = (P + 1) >>> 0;",
  "P = P + 1 > 2147483647 ? 0 : P + 1;",
  "P = Math.imul(P, 3);",
  "P <<= 1;",
  "P = Math.max(P, i) + 1;",
  "P += P;",
  "P = -P;",
  "P ^= i;",
  "P = Math.abs(P) + 1;",
  "if (i % 2) P++;\nelse P += 3;",
  "P += 1073741824;",
  "P = P / 2;",
  "P %= 2147483647;",
  "++P;",
];
// Each leaves a copy of the counter in `v`.
const copies: string[] = [
  "const v = P;",
  "const q = [P];\nconst v = q[0];",
  "const q = [P, P + 1];\nconst v = q[1] - 1;",
  "const q = { v: P };\nconst v = q.v;",
  "const { v } = { v: P };",
  "const [v] = [P, 0];",
  "const v = (a => a)(P);",
  "const g = () => P;\nconst v = g();",
  "const q = [0, 0];\nq[1] = P;\nconst v = q[1];",
  "const q = [];\nq.push(P);\nconst [v] = q;",
  "const q = [...[P]];\nconst v = q[0];",
  "const q = [P].slice();\nconst v = q[0];",
  "const q = [P].concat([P]);\nconst v = q[1];",
  "const v = given ? P : 0;",
  "let v = 0;\nv = P;",
  "let v = P;\nv++;\nv--;",
  "const v = P + 0;",
  "const v = kept.push(P) && kept.at(-1);",
  "const v = (last = P);",
  "const v = P | 0;",
  "const v = P >>> 0;",
  "const v = ~~P;",
  "const v = Math.trunc(P);",
  "const q = new Int32Array(1);\nq[0] = P;\nconst v = q[0];",
  "const q = new Uint32Array([P]);\nconst v = q[0];",
  "const q = new Map([[P, P]]);\nconst v = q.get(P);",
  "const q = [P, 'x'];\nconst v = q[0];",
  "const q = [0.5, P];\nconst v = q[1];",
  "const v = [P].map(x => x)[0];",
  "const v = Math.max(P, 0);",
  "const q = [3, 2, P].sort((a, b) => a - b);\nconst v = q[2];",
  "const q = [1, P];\nq.unshift(0);\nconst v = q[2];",
  "const q = [1, 2, P];\nq.copyWithin(0, 2);\nconst v = q[0];",
  "const q = [P, 1].reverse();\nconst v = q[1];",
  "const v = { ...{ v: P } }.v;",
  "const v = new Set([P]).values().next().value;",
];
const reads: string[] = [
  "say(v);",
  "say(v > 2147483647);",
  "say(v < i, v === P);",
  "say(v % 2);",
  "say(v + 1);",
  "say(v / 2);",
  "say(String(v).length);",
  "say(v === (v | 0));",
  "say(Number.isSafeInteger(v));",
  "sum += v;",
  "say(letters[v] ?? letters[v % 5]);",
  "say(v ? 'y' : 'n');",
  "say(Object.is(v, -0));",
  "say(v >> 1, v >>> 1);",
  "say(`${v}`);",
  "say(JSON.stringify([v]));",
  "kept.push(v);\nsay(kept.length);",
  "switch (v) {\n  case 1:\n    say('one');\n    break;\n  case 2147483648:\n    say('past');\n    break;\n  default:\n    say('other');\n}",
];
const loops: [name: string, text: string][] = [
  ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["eight", "for (let i = 0; i < 8; i++) {\n  IN\n}"],
  ["many", "for (let i = 0; i < 40; i++) {\n  IN\n}"],
  ["while", "let i = 0;\nwhile (i < n) {\n  IN\n  i++;\n}"],
  ["down", "for (let i = n; i > 0; i--) {\n  IN\n}"],
  ["nested", "for (let j = 0; j < 2; j++)\n  for (let i = 0; i < n; i++) {\n    IN\n  }"],
  ["of", "for (const i of [0, 3, 1, 2]) {\n  IN\n}"],
  ["callee", "const go = i => {\n  IN\n};\nfor (let i = 0; i < n; i++) go(i);"],
];
const total = spots.length * starts.length * steps.length * copies.length * reads.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 19_440_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const spot = pick(spots);
  const start = pick(starts);
  const step = pick(steps);
  const copy = pick(copies);
  const read = pick(reads);
  const loop = pick(loops);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isMap = spot[2] === "MAP";
  const isTop = spot[2] === "top";
  const inner = isMap
    ? `let c = m.get('c');\n${step}\nm.set('c', c);\n${copy}\n${read}`.replaceAll(/\bP\b/g, "c")
    : `${step}\n${copy}\n${read}`.replaceAll(/\bP\b/g, () => spot[2]);
  const outer = within("HERE\nLOOP", "HERE", spot[1].replaceAll("START", start));
  const body = within(outer, "LOOP", within(loop[1], "IN", inner));
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    'const tell = v => (Object.is(v, -0) ? "-0" : Array.isArray(v) ? "list" + v.length : String(v).slice(0, 24));',
    'const say = (...values) => void said.push(values.map(tell).join(":"));',
    "const kept = [1, 2];",
    "const letters = ['a', 'b', 'c', 'd', 'e'];",
    "let sum = 0;",
    "let last = 0;",
    ...(isTop ? [`let top = ${start.replaceAll("given", "1")};`] : []),
    `function run(given, n) {\n${indent(body.replaceAll("HERE\n", ""), "  ")}\n}`,
    "function said0(of) {\n  try {\n    of();\n  } catch (error) {\n    say(error.name);\n  }\n}",
    "said0(() => run(1, 3));",
    cell % 5 < 2
      ? "said0(() => run(2147483647, 4));"
      : cell % 5 < 4
        ? "said0(() => run(0.5, 4));"
        : "said0(() => run('7', 2));",
    'console.log(said.join(" ").slice(0, 1200), sum, last, kept.length);',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${spot[0]}--${starts.indexOf(start)}--${steps.indexOf(step)}--${copies.indexOf(copy)}--${reads.indexOf(read)}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
