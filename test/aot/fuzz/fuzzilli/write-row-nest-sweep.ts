// Loops over rows and the numbers in them: how the rows are held, times how a row is taken, times what the inner loop does, times what stands around it, times how the loops count, times the numbers, times what happens to the rows, times the function around.
//
//   bun write-row-nest-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<rows>--<taken>--<inner>--<around>--<loops>--<numbers>--<changed>--<function>.mjs, .cjs or .ts
//   bun write-row-nest-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `rows` holds `h` rows of `w` numbers; `N(y, x)` is the first number at a place.
const rows: [name: string, text: string][] = [
  [
    "lists",
    "const rows = [];\nfor (let y = 0; y < h; y++) {\n  const row = [];\n  for (let x = 0; x < w; x++) row.push(N(y, x));\n  rows.push(row);\n}",
  ],
  ["made", "const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => N(y, x)));"],
  ["floats", "const rows = Array.from({ length: h }, (_, y) => Float64Array.from({ length: w }, (_, x) => N(y, x)));"],
  ["words", "const rows = Array.from({ length: h }, (_, y) => Int32Array.from({ length: w }, (_, x) => N(y, x)));"],
  ["bytes", "const rows = Array.from({ length: h }, (_, y) => Uint8Array.from({ length: w }, (_, x) => N(y, x)));"],
  [
    "flat",
    "const flat = Float64Array.from({ length: h * w }, (_, k) => N((k / w) | 0, k % w));\nconst rows = Array.from({ length: h }, (_, y) => flat.subarray(y * w, y * w + w));",
  ],
  [
    "overlapping",
    "const flat = Float64Array.from({ length: h * w + 9 }, (_, k) => N(k, 1));\nconst rows = Array.from({ length: h }, (_, y) => flat.subarray(y * 2, y * 2 + w));",
  ],
  [
    "shared",
    "const one = Array.from({ length: w }, (_, x) => N(1, x));\nconst rows = Array.from({ length: h }, (_, y) => (y & 1 ? one : Array.from({ length: w }, (_, x) => N(y, x))));",
  ],
  ["filled", "const rows = new Array(h);\nfor (let y = 0; y < h; y++) rows[y] = new Array(w).fill(N(y, 0));"],
  [
    "uneven",
    "const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w - (y & 3) }, (_, x) => N(y, x)));",
  ],
  [
    "holes",
    "const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => N(y, x)));\nif (h > 1) delete rows[1][2];",
  ],
  [
    "of-both",
    "const rows = Array.from({ length: h }, (_, y) => (y === 2 ? Float64Array : Array).from({ length: w }, (_, x) => N(y, x)));",
  ],
  [
    "objects",
    "const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => ({ v: N(y, x) })).map(o => o.v));",
  ],
  [
    "class",
    "class Matrix {\n  constructor() {\n    this.rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => N(y, x)));\n  }\n}\nconst { rows } = new Matrix();",
  ],
  [
    "below-array",
    "class Row extends Array {}\nconst rows = Array.from({ length: h }, (_, y) => Row.from({ length: w }, (_, x) => N(y, x)));",
  ],
];
// `R` is the row at `j`.
const taken: [name: string, before: string, row: string][] = [
  ["kept", "const r = rows[j];", "r"],
  ["indexed", "", "rows[j]"],
  ["by-helper", "const r = pick(rows, j);", "r"],
  ["destructured", "const { [j]: r } = rows;", "r"],
  ["later-row", "const r = rows[(j + 1) % h];", "r"],
  ["asked", "const r = rows[j] ?? [];", "r"],
];
// `i` counts; `u` is the row above, `s` a sum.
const inner: [name: string, text: string][] = [
  ["outer-added", "R[i] = R[i] + j;"],
  ["product-and-outer", "R[i] = R[i] * 2 + j;"],
  ["sum", "s += R[i];"],
  ["sum-of-products", "s += R[i] * u[i];"],
  ["from-above", "R[i] = u[i] + 1;"],
  ["from-left", "R[i] = (i > 0 ? R[i - 1] : 0) + R[i];"],
  ["from-left-and-above", "if (i > 0) R[i] = Math.max(R[i - 1], u[i]);"],
  ["counted", "R[i] = i;"],
  ["of-both-counters", "R[i] = i * w + j;"],
  ["of-outer-value", "R[i] = outer - R[i];"],
  ["outer-steps", "outer += R[i];\nR[i] = outer;"],
  ["greatest", "if (R[i] > outer) outer = R[i];"],
  ["truncated", "R[i] = (R[i] + u[i] + j) | 0;"],
  ["scaled", "R[i] *= outer;"],
  ["swapped", "const t = R[i];\nR[i] = u[i];\nu[i] = t;"],
  ["into-other", "target[j * w + i] = R[i];"],
  ["turned", "other[i][j] = R[i];"],
  ["three-loops", "let sum = 0;\nfor (let k = 0; k < h; k++) sum += R[k % w] * rows[k][i];\nother[j][i] = sum;"],
  ["counts-of", "table[R[i] & 7]++;"],
  ["xor", "R[i] ^= outer;"],
  ["plus-own-outer", "R[i] += a;\na += 0.5;"],
];
// `INNER` is the inner loop.
const around: [name: string, text: string][] = [
  ["nothing", "INNER"],
  ["outer-of-row", "outer = j * 3;\nINNER"],
  ["outer-of-field", "outer = box.v;\nINNER\nbox.v = outer + 1;"],
  ["sum-of-row", "s = 0;\nINNER\nout.push(show(s));"],
  ["twice", "INNER\nINNER"],
  ["skips", "if (j !== 2) {\n  INNER\n}"],
  ["breaks", "INNER\nif (s > 500) break;"],
  ["kept", "const before = s;\nINNER\nlasts.push(s - before);"],
  ["call-behind", "INNER\nnote(j);"],
  ["caught", "try {\n  INNER\n} catch (error) {\n  out.push(error.name);\n}"],
];
// `j` and `i` count.
const loops: [name: string, outer: string, inside: string][] = [
  ["known", "for (let j = 0; j < h; j++) {\n  TURN\n}", "for (let i = 0; i < w; i++) {\n  STEP\n}"],
  [
    "of-lengths",
    "for (let j = 0; j < rows.length; j++) {\n  TURN\n}",
    "for (let i = 0; i < R.length; i++) {\n  STEP\n}",
  ],
  ["literal", "for (let j = 0; j < 5; j++) {\n  TURN\n}", "for (let i = 0; i < 4; i++) {\n  STEP\n}"],
  ["down", "for (let j = h - 1; j >= 0; j--) {\n  TURN\n}", "for (let i = w; i-- > 0; ) {\n  STEP\n}"],
  ["inside-first", "for (let j = 1; j < h - 1; j++) {\n  TURN\n}", "for (let i = 1; i < w - 1; i++) {\n  STEP\n}"],
  ["triangle", "for (let j = 0; j < h; j++) {\n  TURN\n}", "for (let i = 0; i <= j && i < w; i++) {\n  STEP\n}"],
  ["by-twos", "for (let j = 0; j < h; j += 2) {\n  TURN\n}", "for (let i = 0; i < w; i += 2) {\n  STEP\n}"],
  ["while", "let j = 0;\nwhile (j < h) {\n  TURN\n  j++;\n}", "let i = 0;\nwhile (i < w) {\n  STEP\n  i++;\n}"],
  ["of", "for (const j of rows.keys()) {\n  TURN\n}", "for (const i of R.keys()) {\n  STEP\n}"],
];
const numbers: [name: string, text: string][] = [
  ["integers", "y * 3 + x"],
  ["fractions", "y + x / 4"],
  ["signed", "(x - y) * 7"],
  ["large", "(y + 1) * 1e9 + x"],
  ["zeros", "0"],
  ["odd", "x === 1 ? -0 : x === 2 ? NaN : y"],
];
// Done once in front of the loops.
const changed: [name: string, text: string][] = [
  ["nothing", ""],
  ["row-replaced", "if (h > 2) rows[2] = rows[0];"],
  ["row-of-text", "if (h > 3 && given) rows[3] = ['a', 'b', 'c', 'd'];"],
  ["shorter", "if (h > 1 && given) rows.length = h - 1;"],
  ["swapped", "[rows[0], rows[h - 1]] = [rows[h - 1], rows[0]];"],
];
const functions: [name: string, text: string][] = [
  ["function", "function run(h, w, given) {\n  BODY\n}"],
  ["arrow", "const run = (h, w, given) => {\n  BODY\n};"],
  [
    "method",
    "class Runner {\n  run(h, w, given) {\n    BODY\n  }\n}\nconst run = (h, w, given) => new Runner().run(h, w, given);",
  ],
];
const total = rows.length * taken.length * inner.length * around.length * loops.length * numbers.length * changed.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const work = pick(inner);
  const hold = pick(rows);
  const loop = pick(loops);
  const take = pick(taken);
  const frame = pick(around);
  const number = pick(numbers);
  const change = pick(changed);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const step = within(loop[2], "STEP", work[1]);
  const inside = loop[0] === "while" && /INNER\nINNER/.test(frame[1]) ? `{\n${indent(step, "  ")}\n}` : step;
  const turn = `${take[1] ? take[1] + "\n" : ""}const u = rows[(j + h - 1) % h] ?? [];\n${within(frame[1], "INNER", inside)}`;
  const body = [
    hold[1],
    "let s = 0;\nlet outer = 2;\nlet a = 1;",
    "const box = { v: 3 };\nconst table = [0, 0, 0, 0, 0, 0, 0, 0];\nconst target = [];\nconst lasts = [];",
    "const other = Array.from({ length: Math.max(h, w) }, () => new Array(Math.max(h, w)).fill(0));",
    ...(change[1] ? [change[1]] : []),
    within(loop[1], "TURN", turn).replaceAll(/\bR\b/g, take[2]),
    "out.push(show(s), show(outer), table.join(''), lasts.map(show).join());",
    "for (const row of rows) out.push(Array.from(row, show).join());",
    "out.push(target.map(show).join(), other.map(row => row.map(show).join()).join(';'));",
  ].join("\n");
  const any = isTyped ? ": any" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : String(value).slice(0, 14));',
    "const out = [];",
    `const N = (y${any}, x${any}) => ${number[1]};`,
    ...(/pick\(/.test(body) ? [`const pick = (list${any}, at${any}) => list[at];`] : []),
    ...(/note\(/.test(body) ? [`const note = (j${any}) => {\n  if (j === 3) out.push('n');\n};`] : []),
    within(form[1], "BODY", body),
    "for (const [h, w, given] of [[4, 4, 0], [7, 5, 1], [1, 9, 0]]) {",
    "  try {",
    "    run(h, w, given);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 2500));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${hold[0]}--${take[0]}--${work[0]}--${frame[0]}--${loop[0]}--${number[0]}--${change[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
