// Numbers in one list that are computed row by row out of their neighbors: the list, times what is computed, times what of the outer loop it reads, times how the places are counted, times what the outer loop does besides, times the width, times what is odd in the list, times the function around.
//
//   bun write-stencil-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<computed>--<outer>--<places>--<besides>--<width>--<odd>--<function>.mjs, .cjs or .ts
//   bun write-stencil-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `x` is read and stored, `y` is read; both hold (h + 2) * (w + 2) numbers F(k).
const lists: [name: string, text: string][] = [
  ["lists", "const x = [];\nconst y = [];\nfor (let k = 0; k < size; k++) {\n  x.push(F(k));\n  y.push(F(k + 1));\n}"],
  ["same", "const x = [];\nfor (let k = 0; k < size; k++) x.push(F(k));\nconst y = x;"],
  ["copy", "const x = [];\nfor (let k = 0; k < size; k++) x.push(F(k));\nconst y = x.slice();"],
  ["floats", "const x = Float64Array.from({ length: size }, (_, k) => F(k));\nconst y = Float64Array.from(x);"],
  [
    "same-floats",
    "const x = Float64Array.from({ length: size }, (_, k) => F(k));\nconst y = new Float64Array(x.buffer, 8);",
  ],
  [
    "short-floats",
    "const x = Float32Array.from({ length: size }, (_, k) => F(k));\nconst y = [];\nfor (let k = 0; k < size; k++) y.push(F(k));",
  ],
  ["words", "const x = Int32Array.from({ length: size }, (_, k) => F(k));\nconst y = Float64Array.from(x);"],
  [
    "sized",
    "const x = new Array(size);\nconst y = new Array(size);\nfor (let k = 0; k < size; k++) {\n  x[k] = F(k);\n  y[k] = k;\n}",
  ],
  [
    "of-fields",
    "class Field {\n  constructor() {\n    this.x = Array.from({ length: size }, (_, k) => F(k));\n    this.y = this.x.map(value => value / 2);\n  }\n}\nconst { x, y } = new Field();",
  ],
  ["shorter", "const x = [];\nfor (let k = 0; k < size; k++) x.push(F(k));\nconst y = x.slice(0, size - w);"],
];
// P is the place, A, B, L, R the places above, below, left and right; `last` is what was stored, O is of the outer loop.
const computed: [name: string, text: string][] = [
  ["chain", "last = x[P] = (y[P] + a * (last + x[R] + x[A] + x[B])) * c;"],
  ["chain-and-outer", "last = x[P] = (y[P] + a * (last - x[R] + x[A] - x[B])) * c + O;"],
  ["divided", "last = x[P] = (y[P] + (last + x[R] * 0.5 + x[B]) / a) * c;"],
  ["outer-times", "last = x[P] = (last + y[P] * O + x[A]) * c;"],
  ["plain", "x[P] = y[P] + O;"],
  ["mean", "x[P] = (x[L] + x[R] + x[A] + x[B]) / 4;"],
  ["mean-of-other", "x[P] = (y[L] + y[R] + y[A] + y[B]) * 0.25 - O;"],
  ["sum", "last += x[P] * y[P];\nx[P] = last;"],
  ["sum-of-outer", "last = last * 0.5 + O + x[P];\nx[P] = last + y[P];"],
  ["two-stores", "x[P] = y[P] * c + last;\nlast = x[L] + O;\nx[L] = last * a;"],
  ["greatest", "last = x[P] = Math.max(last, x[A] + y[P]) - O;"],
  ["truncated", "last = x[P] = (last + x[A] * 3 + y[P] + O) | 0;"],
  ["chosen", "last = x[P] = x[A] < last ? last + y[P] : x[A] * c - O;"],
  ["root", "last = x[P] = Math.sqrt(Math.abs(last + y[P] * a + x[B])) + O;"],
  ["from-behind", "x[P] = last;\nlast = y[R] * a + last * c + O;"],
  ["both-lists", "x[P] = y[L] + last * a;\ny[P] = x[P] * c + O;\nlast = y[P];"],
  ["five", "last = x[P] = ((((last + y[P]) * a + x[A]) * c + x[B]) * a + O) * c;"],
];
// What O is; the text in front of the inner loop.
const outer: [name: string, before: string, text: string][] = [
  ["counter", "", "j"],
  ["counter-half", "", "j / 2"],
  ["of-row", "const weight = j * 0.25 + 1;", "weight"],
  ["of-list", "const weight = weights[j];", "weight"],
  ["indexed", "", "weights[j]"],
  ["field", "box.v = j;", "box.v"],
  ["steps", "step += 0.5;", "step"],
  ["called", "const weight = ask(j);", "weight"],
  ["nothing", "", "0"],
  ["given", "", "a"],
  ["first-of-row", "const weight = x[j * width];", "weight"],
];
// `i` counts in a row.
const places: [name: string, before: string, inner: string][] = [
  ["formula", "", "for (let i = 1; i <= w; i++) {\n  const at = j * width + i;\n  STEP\n}"],
  ["stepped", "let at = j * width;", "for (let i = 1; i <= w; i++) {\n  ++at;\n  STEP\n}"],
  ["base", "const base = j * width;", "for (let i = 1; i <= w; i++) {\n  const at = base + i;\n  STEP\n}"],
  ["down", "const base = j * width;", "for (let i = w; i > 0; i--) {\n  const at = base + i;\n  STEP\n}"],
  ["while", "let at = j * width + 1;\nconst end = at + w;", "while (at < end) {\n  STEP\n  at++;\n}"],
  ["by-twos", "const base = j * width;", "for (let i = 1; i <= w; i += 2) {\n  const at = base + i;\n  STEP\n}"],
  ["var", "var at = j * width;", "for (var i = 1; i <= w; i++) {\n  at++;\n  STEP\n}"],
];
// `ROW` is a row.
const besides: [name: string, text: string][] = [
  ["nothing", "for (let j = 1; j <= h; j++) {\n  ROW\n}"],
  [
    "rounds",
    "for (let k = 0; k < 3; k++) {\n  for (let j = 1; j <= h; j++) {\n    ROW\n  }\n  x[0] = 0.5 * (x[1] + x[width]);\n}",
  ],
  ["last-of-row", "for (let j = 1; j <= h; j++) {\n  last = x[j * width];\n  ROW\n}"],
  ["border", "for (let j = 1; j <= h; j++) {\n  ROW\n  x[j * width] = x[j * width + 1];\n}"],
  ["down", "for (let j = h; j >= 1; j--) {\n  ROW\n}"],
  ["skips", "for (let j = 1; j <= h; j++) {\n  if (j !== 3) {\n    ROW\n  }\n}"],
  ["leaves", "for (let j = 1; j <= h; j++) {\n  ROW\n  if (last > 1e6) break;\n}"],
  ["kept", "for (let j = 1; j <= h; j++) {\n  ROW\n  lasts.push(last);\n}"],
];
const widths: [name: string, text: string][] = [["eight", "8, 9"], ["wide", "33, 6"], ["narrow", "2, 12"], ["page", "64, 5"], ["one-row", "40, 1"]]; // prettier-ignore
const odd: [name: string, number_: string, text: string][] = [
  ["nothing", "k * 0.37 - 4", ""],
  ["integers", "k", ""],
  ["of-both", "k & 3 ? k : k * 0.5", ""],
  ["not-a-number", "k / 8", "x[width + 5] = NaN;"],
  ["hole", "k / 8", "if (given) delete x[width + 4];"],
  ["text", "k / 8", "if (given) y[width + 3] = 'q';"],
  ["endless", "k", "y[width * 2 + 1] = Infinity;"],
  ["short", "k / 4", "if (given) x.length = size >> 1;"],
  ["frozen", "k / 4", "if (given && Array.isArray(x)) Object.freeze(x);"],
];
const functions: [name: string, text: string][] = [
  ["function", "function run(w, h, a, c, given) {\n  BODY\n}"],
  ["arrow", "const run = (w, h, a, c, given) => {\n  BODY\n};"],
  [
    "captured",
    "const make = () => {\n  let w, h;\n  return {\n    set(one, two) {\n      w = one;\n      h = two;\n    },\n    run(a, c, given) {\n      BODY\n    },\n  };\n};\nconst made = make();\nconst run = (w, h, a, c, given) => {\n  made.set(w, h);\n  made.run(a, c, given);\n};",
  ],
];
const total = lists.length * computed.length * outer.length * places.length * besides.length * widths.length * odd.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const compute = pick(computed);
  const outside = pick(outer);
  const list = pick(lists);
  const place = pick(places);
  const beside = pick(besides);
  const strange = pick(odd);
  const width = pick(widths);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const at: Record<string, string> = {
    P: "at",
    A: "at - width",
    B: "at + width",
    L: "at - 1",
    R: "at + 1",
    O: outside[2],
  };
  const step = compute[1].replaceAll(/\b[PABLRO]\b/g, letter => at[letter]);
  const row = [outside[1], place[1], within(place[2], "STEP", step)].filter(Boolean).join("\n");
  const body = [
    "const width = w + 2;\nconst size = width * (h + 2);",
    list[1],
    "let last = 0;\nlet step = 1;",
    "const box = { v: 0 };\nconst weights = [1, 0.5, 2, 3, 0.25, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];\nconst lasts = [];",
    ...(strange[2] ? [`try {\n  ${strange[2]}\n} catch (error) {\n  out.push(error.name);\n}`] : []),
    "try {",
    indent(within(beside[1], "ROW", row), "  "),
    "} catch (error) {\n  out.push(error.name);\n}",
    "out.push(sign(x), sign(y), show(last), lasts.map(show).join());",
  ].join("\n");
  const any = isTyped ? ": any" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : String(value));',
    "const sign = list => {\n  let hash = 7;\n  for (let k = 0; k < list.length; k++) {\n    const text = k in list ? show(list[k]) : 'hole';\n    for (let n = 0; n < text.length; n++) hash = (Math.imul(hash, 31) + text.charCodeAt(n)) | 0;\n  }\n  return list.length + ':' + hash;\n};",
    "const out = [];",
    `const F = (k${any}) => (${strange[1]});`,
    ...(/ask\(/.test(outside[1]) ? [`const ask = (j${any}) => j * 1.5;`] : []),
    within(form[1], "BODY", body),
    `for (const [a, c, given] of [[0.25, 4, 0], [-0.5, 0.5, 1], [3, 1, 0]]) {`,
    "  try {",
    `    run(${width[1]}, a, c, given);`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1500));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${compute[0]}--${outside[0]}--${place[0]}--${beside[0]}--${width[0]}--${strange[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
