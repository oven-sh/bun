// Elements that may be missing, read, converted, and stored: the table, times the index, times the conversion, times where the result is stored, times the loop, times how the results are looked at, times the function around.
//
//   bun write-truncated-read-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<table>--<index>--<conversion>--<store>--<loop>--<look>--<function>.mjs, .cjs or .ts
//   bun write-truncated-read-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// What is declared; `M` is the table.
const tables: [name: string, text: string][] = [
  ["integers", "const M = [3, 1, 4, 1, 5, 9, 2, 6];"],
  ["doubles", "const M = [0.5, 1.5, -0, 2.25, 1e9, 4294967296.5, NaN, -1.5];"],
  ["both", "const M = [3, 0.5, 4, 1, 1e10, 9, 2, -6];"],
  ["holes", "const M = [3, , 4, 1, , 9, 2, 6];"],
  ["wide", "const M = [4294967295, 2147483648, -2147483648, 2147483647, 0, 1, 65536, 4294967296];"],
  ["of-any", "const M = [3, '1', null, true, undefined, 9, {}, 6];"],
  ["pushed", "const M = [];\nfor (let k = 0; k < 8; k++) M.push(k * 3);"],
  ["filled", "const M = new Array(8).fill(7);"],
  ["empty", "const M = new Array(8);\nM[2] = 5;"],
  ["made", "const M = Array.from({ length: 8 }, (_, k) => k * 5);"],
  ["mapped", "const M = [1, 2, 3, 4, 5, 6, 7, 8].map(k => k / 2);"],
  ["shortened", "const M = [3, 1, 4, 1, 5, 9, 2, 6];\nM.length = 5;"],
  ["popped", "const M = [3, 1, 4, 1, 5, 9, 2, 6];\nM.pop();\nM.shift();"],
  ["bytes", "const M = new Uint8Array([3, 1, 4, 1, 5, 9, 2, 255]);"],
  ["words", "const M = new Int32Array([3, 1, -4, 1, 5, -9, 2, 6]);"],
  ["floats", "const M = new Float64Array([3, 0.5, -0, 1, NaN, 9, 2, 6]);"],
  ["row", "const M = [[3, 1, 4, 1, 5, 9, 2, 6], [1]][0];"],
  ["of-field", "const box = { table: [3, 1, 4, 1, 5, 9, 2, 6] };\nconst M = box.table;"],
  ["of-class", "class Holder {\n  static table = [3, 1, 4, 1, 5, 9, 2, 6];\n}\nconst M = Holder.table;"],
  ["text", 'const M = "31415926";'],
  ["holed-later", "const M = [3, 1, 4, 1, 5, 9, 2, 6];\ndelete M[3];"],
  ["sparse", "const M = [3, 1, 4];\nM[6] = 2;"],
];
const indexes: [name: string, text: string][] = [
  ["same", "M[i]"],
  ["next", "M[i + 1]"],
  ["before", "M[i - 1]"],
  ["masked", "M[(i * 5) & 15]"],
  ["halved", "M[i >> 1]"],
  ["doubled", "M[i * 2]"],
  ["length", "M[M.length]"],
  ["at", "M.at(i)"],
  ["by-text", "M[`${i}`]"],
  ["of-other", "M[t.length]"],
  ["by-double", "M[i / 2]"],
  ["inner", "M[M[i & 7] & 15]"],
  ["asked", "M?.[i]"],
  ["counted-down", "M[8 - i]"],
];
// `R` is the element read.
const conversions: [name: string, text: string][] = [
  ["unsigned", "R >>> 0"],
  ["truncated", "R | 0"],
  ["twice-not", "~~R"],
  ["not", "~R"],
  ["masked", "R & 255"],
  ["xor", "R ^ 3"],
  ["left", "R << 1"],
  ["right", "R >> 1"],
  ["as-count", "1 << R"],
  ["plus", "+R"],
  ["minus", "-R"],
  ["added", "R + 0"],
  ["times", "R * 1"],
  ["product", "Math.imul(R, 3)"],
  ["zeros", "Math.clz32(R)"],
  ["rounded", "Math.fround(R)"],
  ["whole", "Math.trunc(R)"],
  ["nullish", "R ?? 7"],
  ["or", "R || 7"],
  ["inverted", "!R"],
  ["itself", "R"],
  ["number", "Number(R)"],
  ["asked", "R === undefined ? 8 : R"],
  ["twice", "(R | 0) + (R >>> 0)"],
  ["greatest", "Math.max(R, 1)"],
  ["absolute", "Math.abs(R | 0)"],
  ["of-both", "(R | 0) ^ (M[i & 3] | 0)"],
  ["compared", "R < 3"],
  ["byte", "(R & 65535) >>> 8"],
];
// `X` is the value; `w` is the list looked at.
const stores: [name: string, text: string][] = [
  ["element", "w[i] = X;"],
  ["pushed", "w.push(X);"],
  ["at-length", "w[w.length] = X;"],
  ["twice", "w[i] = w[i + 1] = X;"],
  ["pair", "[w[i], last] = [X, i];"],
  ["field", "o.v = X;\nw.push(o.v);"],
  ["new-object", "w.push({ v: X }.v);"],
  ["instance", "w.push(new Point(X).v);"],
  ["summed", "sum += X;\nw[0] = sum;"],
  ["in-words", "bytes[i & 7] = X;\nw[i] = bytes[i & 7];"],
  ["in-floats", "floats[i & 7] = X;\nw[i] = floats[i & 7];"],
  ["in-map", "table.set(i, X);\nw[i] = table.get(i);"],
  ["spread", "w = [...w, X];"],
  ["literal", "w = [X, w.length, X];"],
  ["in-front", "w.unshift(X);"],
  ["spliced", "w.splice(1, 0, X);"],
  ["filled", "w.fill(X, i, i + 1);\nw.push(i);"],
  ["argument", "w.push(hand(X));"],
  ["captured", "kept = X;\nw.push(keep());"],
  ["same-table", "if (typeof M !== 'string') M[i & 7] = X;\nw[i] = M[i & 7];"],
  ["copied", "const now = X;\nw[i] = now;\nw[i] = w[i];"],
  ["choice", "w[i] = i & 1 ? X : 1.5;"],
  ["added-to", "w[i] = (w[i] ?? 0) + X;"],
  ["text", "w.push(`${X}`);"],
  ["two-lists", "const pair = [X, X];\nw.push(pair[1]);"],
  ["reserved", "const list = new Array(3);\nlist[1] = X;\nw.push(list[1], list[0]);"],
];
// `STEP` in a turn; `i` counts, and `t` is a list.
const loops: [name: string, text: string][] = [
  ["for", "for (let i = 0; i < 12; i++) {\n  STEP\n}"],
  ["given", "for (let i = 0; i < limit; i++) {\n  STEP\n}"],
  ["nested", "for (let k = 0; k < 3; k++) {\n  for (let i = 0; i < limit; i++) {\n    STEP\n  }\n}"],
  ["while", "let i = 0;\nwhile (i < 11) {\n  STEP\n  i++;\n}"],
  ["down", "for (let i = 11; i >= 0; i--) {\n  STEP\n}"],
  ["of", "for (const i of [0, 7, 8, 3, 20]) {\n  STEP\n}"],
  ["callback", "[0, 7, 8, 3, 20].forEach(i => {\n  STEP\n});"],
  ["several", "for (let i = 0; i < 12; i += 4) {\n  STEP\n}"],
  ["once", "{\n  const i = limit;\n  STEP\n}"],
  ["breaks", "for (let i = 0; ; i++) {\n  if (i > limit) break;\n  STEP\n}"],
  ["reads-list", "for (let i = 0; i < t.length; i++) {\n  const x = t[i];\n  STEP\n}"],
];
const looks: [name: string, text: string][] = [
  ["joined", "w.join()"],
  ["shown", "w.map(show).join()"],
  ["held", "Array.from(w, (value, k) => (k in w ? show(value) : 'hole')).join()"],
  ["as-json", "JSON.stringify(w)"],
  ["keys", "Object.keys(w).join()"],
  ["visited", "w.reduce((text, value) => text + ' ' + show(value), '')"],
  ["sorted", "[...w].sort((a, b) => a - b).join()"],
  ["counted", "[w.length, w.filter(value => value === undefined).length, w.indexOf(undefined), w.includes(0)].join()"],
];
// `BODY` is what is done with `limit` and `t`.
const functions: [name: string, text: string][] = [
  ["function", "function run(limit, t) {\n  BODY\n}"],
  ["arrow", "const run = (limit, t) => {\n  BODY\n};"],
  [
    "method",
    "class Runner {\n  run(limit, t) {\n    BODY\n  }\n}\nconst run = (limit, t) => new Runner().run(limit, t);",
  ],
  [
    "generator",
    "function* steps(limit, t) {\n  yield limit;\n  BODY\n}\nconst run = (limit, t) => [...steps(limit, t)].length;",
  ],
  ["table-outside", "function run(limit, t) {\n  BODY\n}"],
];
const total = tables.length * indexes.length * conversions.length * stores.length * loops.length * looks.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const conversion = pick(conversions);
  const store = pick(stores);
  const table = pick(tables);
  const index = pick(indexes);
  const loop = pick(loops);
  const look = pick(looks);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isOutside = form[0] === "table-outside";
  const isOfNumbers = /^const M = (\[[-\d., e]+\]|\[\]|new Array\(8\)\S*|Array\.from.*|\[[-\d., ]+\]\.map.*);/.test(
    table[1],
  );
  const declared = isTyped && isOfNumbers ? table[1].replace("const M =", "const M: number[] =") : table[1];
  const value = conversion[1].replaceAll(/\bR\b/g, index[1]);
  const step = store[1].replaceAll(/\bX\b/g, /[ ?<|^]/.test(value) ? `(${value})` : value).replaceAll(/= \((.*)\);$/gm, (line, inside) => (/^[^()]*$/.test(inside) ? `= ${inside};` : line)); // prettier-ignore
  const uses = (word: RegExp) => word.test(step);
  const any = isTyped ? ": any" : "";
  const body = [
    ...(isOutside ? [] : [declared]),
    `let w${any} = [];`,
    ...(uses(/\blast\b/) ? ["let last = 0;"] : []),
    ...(uses(/\bo\.v\b/) ? ["const o = { v: 1 };"] : []),
    ...(uses(/\bsum\b/) ? ["let sum = 0;"] : []),
    ...(uses(/\bbytes\b/) ? ["const bytes = new Int32Array(8);"] : []),
    ...(uses(/\bfloats\b/) ? ["const floats = new Float64Array(8);"] : []),
    ...(uses(/\btable\b/) ? ["const table = new Map();"] : []),
    ...(uses(/\bkept\b/) ? [`let kept${any} = 0;`, "const keep = () => kept;"] : []),
    within(loop[1], "STEP", step),
    `out.push(${look[1]});`,
  ].join("\n");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : String(value).slice(0, 30));',
    "const out = [];",
    ...(uses(/hand\(/) ? ["const hand = value => value;"] : []),
    ...(uses(/Point/) ? ["class Point {\n  constructor(v) {\n    this.v = v;\n  }\n}"] : []),
    ...(isOutside ? [declared] : []),
    within(form[1], "BODY", body),
    "for (const [limit, t] of [[0, []], [9, [1, 2, 3]], [14, new Float64Array(10)]]) {",
    "  try {",
    "    run(limit, t);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${table[0]}--${index[0]}--${conversion[0]}--${store[0]}--${loop[0]}--${look[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
