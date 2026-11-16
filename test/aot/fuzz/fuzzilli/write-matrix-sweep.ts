// The least loops over matrices: how the numbers are held, times the index of what is stored, times the indexes of what is read, times the deed, times the order and the bounds of the loops, times what two of them share, with nothing beside.
//
//   bun write-matrix-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<held>--<stored>--<first>--<second>--<deed>--<loops>--<shared>.mjs, .cjs or .ts
//   bun write-matrix-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// t is stored, p and q are read.
const held: [name: string, text: string][] = [["list", "Array.from({ length: 16 }, (_, k) => V)"], ["doubles", "Float64Array.from({ length: 16 }, (_, k) => V)"], ["words", "Int32Array.from({ length: 16 }, (_, k) => V)"], ["floats", "Float32Array.from({ length: 16 }, (_, k) => V)"], ["pushed", "(() => {\n  const a = [];\n  for (let k = 0; k < 16; k++) a.push(V);\n  return a;\n})()"], ["filled", "new Array(16).fill(0).map((_, k) => V)"], ["short", "Array.from({ length: 11 }, (_, k) => V)"], ["holes", "Array.from({ length: 16 }, (_, k) => V).map((x, k) => x)"], ["rows", "Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => ((k) => V)(r * 4 + c)))"]]; // prettier-ignore
const values: [name: string, text: string][] = [["integers", "k + 1"], ["fractions", "k / 4 + 0.5"], ["both", "k & 1 ? k : k + 0.5"], ["signed", "k % 3 ? -k : k"], ["large", "k * 1e8"], ["zeros", "0"]]; // prettier-ignore
// r, c and k count; M4 says how a place is written.
const places: [name: string, at: (x: string, y: string) => string][] = [
  ["row-major", (x, y) => `${x} * 4 + ${y}`],
  ["column-major", (x, y) => `${x} + 4 * ${y}`],
  ["shifted", (x, y) => `(${x} << 2) + ${y}`],
  ["or", (x, y) => `(${x} << 2) | ${y}`],
  ["given", (x, y) => `${x} * n + ${y}`],
  ["turned", (x, y) => `${y} * 4 + ${x}`],
  ["backwards", (x, y) => `15 - ${x} * 4 - ${y}`],
  ["next", (x, y) => `${x} * 4 + ${y} + 1`],
  ["diagonal", (x, y) => `${x} * 5 + ${y} * 0`],
];
const deeds: [name: string, text: string][] = [
  ["add-product", "T += P * Q;"],
  ["sum-kept", "s += P * Q;\nT = s;"],
  ["product", "T = P * Q;"],
  ["sum", "T = P + Q;"],
  ["copied", "T = P;"],
  ["scaled", "T *= 0.5;"],
  ["from-itself", "T = T + P;"],
  ["difference", "T -= Q;"],
  ["greatest", "T = Math.max(T, P);"],
  ["truncated", "T = (P * 3 + Q) | 0;"],
  ["of-counters", "T = r * 10 + c;"],
  ["swapped", "const x = T;\nT = P;\nP = x;"],
  ["read-behind", "T = P * 2;\ns += T;"],
  ["two-stores", "T = P;\nt[c] = Q;"],
];
// DO is the deed.
const loops: [name: string, text: string][] = [
  ["three-of-four", "for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) {\n  DO\n}"],
  ["three-given", "for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) for (let k = 0; k < n; k++) {\n  DO\n}"],
  ["inner-first", "for (let k = 0; k < 4; k++) for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {\n  DO\n}"],
  ["three-of-three", "for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) {\n  DO\n}"],
  ["two", "for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {\n  const k = r;\n  DO\n}"],
  [
    "sum-a-cell",
    "for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {\n  s = 0;\n  for (let k = 0; k < 4; k++) {\n    DO\n  }\n}",
  ],
  ["one", "for (let r = 0; r < 4; r++) {\n  const c = r;\n  const k = 1;\n  DO\n}"],
  ["down", "for (let r = 3; r >= 0; r--) for (let c = 3; c >= 0; c--) for (let k = 3; k >= 0; k--) {\n  DO\n}"],
  ["triangle", "for (let r = 0; r < 4; r++) for (let c = 0; c <= r; c++) for (let k = 0; k <= c; k++) {\n  DO\n}"],
  ["two-then-two", "for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) for (let k = 0; k < 2; k++) {\n  DO\n}"],
];
const shares: [name: string, text: string][] = [["nothing", "const p = A;\nconst q = A;\nconst t = A;"], ["stored-and-first", "const p = A;\nconst q = A;\nconst t = p;"], ["both-read", "const p = A;\nconst q = p;\nconst t = A;"], ["all", "const p = A;\nconst q = p;\nconst t = p;"], ["made-empty", "const p = A;\nconst q = A;\nconst t = [];"], ["given", "const p = A;\nconst q = given;\nconst t = A;"], ["called-first", "const p = A;\nconst q = A;\nconst t = p;\nCALL(t, p, q)"], ["called-second", "const p = A;\nconst q = A;\nconst t = q;\nCALL(t, p, q)"], ["called-all", "const p = A;\nconst q = p;\nconst t = p;\nCALL(t, p, q)"], ["called-apart", "const p = A;\nconst q = A;\nconst t = A;\nCALL(t, p, q)"], ["called-both", "const p = A;\nconst q = A;\nconst t = A;\nCALL(t, p, q)\nCALL(p, p, q)\nCALL(q, t, q)"]]; // prettier-ignore
const pairs: [name: string, t: [string, string], p: [string, string], q: [string, string]][] = [["product", ["r", "c"], ["r", "k"], ["k", "c"]], ["turned", ["c", "r"], ["k", "r"], ["c", "k"]], ["same", ["r", "c"], ["r", "c"], ["r", "c"]], ["of-inner", ["k", "c"], ["r", "k"], ["c", "r"]]]; // prettier-ignore
const total = held.length * values.length * places.length * deeds.length * loops.length * shares.length * pairs.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const deed = pick(deeds);
  const loop = pick(loops);
  const place = pick(places);
  const hold = pick(held);
  const share = pick(shares);
  const value = pick(values);
  const pair = pick(pairs);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isRows = hold[0] === "rows";
  const at = (name: string, [x, y]: [string, string]) => (isRows && name !== "given" ? `${name}[${x}][${y}]` : `${name}[${place[1](x, y)}]`); // prettier-ignore
  const step = deed[1].replaceAll(/\bT\b/g, at("t", pair[1])).replaceAll(/\bP\b/g, at("p", pair[2])).replaceAll(/\bQ\b/g, at("q", pair[3])).replace("t[c] =", isRows ? "t[0][c] =" : "t[c] ="); // prettier-ignore
  const make = hold[1].replaceAll(/\bV\b/g, value[1]);
  const isEmptyRows = isRows && share[0] === "made-empty";
  const isCalled = share[0].startsWith("called");
  const work = within(loop[1], "DO", step);
  const declared = (isEmptyRows ? shares[0][1] : share[1]).replaceAll(/\bA\b/g, () => make).replaceAll(/CALL\((.*)\)/g, "s += multiply($1, n);"); // prettier-ignore
  const body = isCalled
    ? `let s = 0;\n${declared}\nreturn [s, show(t), show(p), show(q)].join(' ');`
    : `${declared}\nlet s = 0;\n${work}\nreturn [s, show(t), show(p), show(q)].join(' ');`;
  const any = isTyped ? ": number" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const show = a => Array.from(a, x => (Object.is(x, -0) ? '-0' : typeof x === 'object' && x ? '(' + x.join() + ')' : String(x))).join().slice(0, 500);",
    `const given = ${make};`,
    ...(isCalled ? [`function multiply(t, p, q, n) {\n  let s = 0;\n${indent(work, "  ")}\n  return s;\n}`] : []),
    `function run(n${any}) {\n${indent(body, "  ")}\n}`,
    "for (const n of [4, 2]) {",
    "  try {",
    "    console.log(run(n));",
    "  } catch (error) {",
    "    console.log(error.name);",
    "  }",
    "}",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${hold[0]}--${value[0]}--${place[0]}--${deed[0]}--${loop[0]}--${share[0]}--${pair[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
