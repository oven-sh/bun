// The least programs that fill a list in a loop and change it once more: the list, times how it is filled, times with what, times the second change, times where, times the loops, times what is asked, times how often all of it runs.
//
//   bun write-literal-fill-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<filled>--<value>--<second>--<where>--<loop>--<asked>--<runs>.mjs, .cjs or .ts
//   bun write-literal-fill-sweep.ts count
//
// A loop that counts on the length of the list that it fills may count on its own store alone.
import { mkdirSync, writeFileSync } from "node:fs";

// `i` counts, `c` and `n` are given, A is the list, V the value.
const lists: [name: string, text: string][] = [
  ["empty", "[]"],
  ["one", "[0]"],
  ["three", "[1, 2, 3]"],
  ["given", "[c]"],
  ["many", "[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]"],
];
const fills: [name: string, text: string][] = [
  ["push", "A.push(V);"],
  ["push-two", "A.push(V, i);"],
  ["push-spread", "A.push(...[V]);"],
  ["at-length", "A[A.length] = V;"],
  ["at-counter", "A[i] = V;"],
  ["at-own-counter", "A[k++] = V;"],
  ["callee", "add(A, V);"],
  ["callee-at-length", "put(A, V);"],
  ["closure", "more(V);"],
  ["sometimes", "if (i & 1) A.push(V);"],
  ["either", "if (i & 1) A.push(V);\nelse A.push(i);"],
  ["assigned-length", "A.length = A.length + 1;\nA[A.length - 1] = V;"],
  ["counted", "s = A.push(V);"],
  ["through-field", "box.a.push(V);"],
  ["through-list", "rows[0].push(V);"],
];
const values: [name: string, text: string][] = [
  ["counter", "i"],
  ["element", "l[c]"],
  ["outer-element", "l[i % 3]"],
  ["fraction", "i / 2"],
  ["length", "A.length"],
  ["kinds", "i & 1 ? 't' : i"],
];
const seconds: [name: string, text: string][] = [
  ["nothing", ";"],
  ["push", "A.push(V);"],
  ["push-other", "A.push(-1);"],
  ["push-on-second-name", "b.push(V);"],
  ["push-through-field", "box.a.push(V);"],
  ["push-through-list", "rows[0].push(V);"],
  ["at-length-through-field", "box.a[box.a.length] = V;"],
  ["pop-through-field", "box.a.pop();"],
  ["push-through-callee", "grow(box, V);"],
  ["inner-through-field", "for (let q = 0; q < 2; q++) box.a.push(V);"],
  ["same-callee", "add(A, V);"],
  ["callee", "put(A, 7);"],
  ["closure", "more(9);"],
  ["inner-two", "for (let q = 0; q < 2; q++) A.push(V);"],
  ["inner-given", "for (let q = 0; q < n; q++) A.push(q);"],
  ["inner-sometimes", "for (let q = 0; q < 2; q++) if (q & 1) A.push(q);"],
  ["inner-callee", "fill(A, 2);"],
  ["at-length", "A[A.length] = -2;"],
  ["past", "A[A.length + 2] = -3;"],
  ["first", "A[0] = -4;"],
  ["pop", "A.pop();"],
  ["pop-inner", "for (let q = 0; q < 2; q++) A.pop();"],
  ["shift", "A.shift();"],
  ["unshift", "A.unshift(-5);"],
  ["splice", "A.splice(0, 1);"],
  ["shorter", "A.length = 1;"],
  ["longer", "A.length += 2;"],
  ["emptied", "A.length = 0;"],
  ["removed", "delete A[0];"],
  ["replaced", "a = [8];"],
  ["kept", "all.push(A);"],
  ["frozen", "if (i === 1) Object.freeze(A);"],
];
const wheres: [name: string, text: string][] = [
  ["behind", "FILL\nSECOND"],
  ["in-front", "SECOND\nFILL"],
  ["once", "FILL\nif (i === 1) {\n  SECOND\n}"],
  ["odd", "FILL\nif (i & 1) {\n  SECOND\n}"],
  ["between", "FILL\nSECOND\nFILL"],
  ["in-try", "FILL\ntry {\n  SECOND\n} finally {\n  s++;\n}"],
];
const loops: [name: string, text: string][] = [
  ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["three", "for (let i = 0; i < 3; i++) {\n  IN\n}"],
  ["many", "for (let i = 0; i < 30; i++) {\n  IN\n}"],
  ["while", "let i = 0;\nwhile (i < n) {\n  IN\n  i++;\n}"],
  ["do", "let i = 0;\ndo {\n  IN\n} while (++i < n);"],
  ["from-one", "for (let i = 1; i <= n; i++) {\n  IN\n}"],
  ["by-two", "for (let i = 0; i < n; i += 2) {\n  IN\n}"],
  ["down", "for (let i = n; i > 0; i--) {\n  IN\n}"],
  ["of", "for (const i of [0, 1, 2]) {\n  IN\n}"],
  ["continue", "for (let i = 0; i < 5; i++) {\n  if (i === 2) continue;\n  IN\n}"],
  ["inner", "for (let j = 0; j < 2; j++) {\n  for (let i = 0; i < n; i++) {\n    IN\n  }\n}"],
  ["inner-of-two", "for (let j = 0; j < n; j++)\n  for (let i = 0; i < 2; i++) {\n    IN\n  }"],
  ["twice", "for (let i = 0; i < n; i++) {\n  IN\n}\nfor (let i = 0; i < n; i++) {\n  IN\n}"],
  ["outer-behind", "for (let j = 0; j < 3; j++) {\n  for (let i = 0; i < 2; i++) {\n    IN\n  }\n  a.push(j);\n}"],
];
const asks: [name: string, text: string][] = [
  ["all", "return a.join();"],
  ["length", "return a.length;"],
  ["last", "return a[a.length - 1] + '|' + a.length;"],
];
const runs: [name: string, text: string][] = [
  ["three", "for (const c of [0, 1, 2]) out.push(run(c, c + 2));"],
  ["many", "for (let turn = 0; turn < 12; turn++) out.push(run(turn % 3, turn % 5));"],
];
const total =
  lists.length *
  fills.length *
  values.length *
  seconds.length *
  wheres.length *
  loops.length *
  asks.length *
  runs.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 4_536_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const fill = pick(fills);
  const second = pick(seconds);
  const loop = pick(loops);
  const where = pick(wheres);
  const list = pick(lists);
  const value = pick(values);
  const ask = pick(asks);
  const call = pick(runs);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && second[0] !== "frozen";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const named = (text: string) => text.replaceAll(/\bV\b/g, value[1]).replaceAll(/\bA\b/g, "a");
  const turn = within(within(where[1], "FILL", fill[1]), "SECOND", second[1] === ";" ? "s++;" : second[1]);
  const body = named(within(loop[1], "IN", turn));
  const uses = (word: RegExp) => word.test(body);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    ...(uses(/\ball\b/) ? ["const all = [];"] : []),
    ...(uses(/\badd\(/) ? ["function add(x, v) {\n  x.push(v);\n}"] : []),
    ...(uses(/\bput\(/) ? ["function put(x, v) {\n  x[x.length] = v;\n}"] : []),
    ...(uses(/\bgrow\(/) ? ["function grow(x, v) {\n  x.a.push(v);\n}"] : []),
    ...(uses(/\bfill\(/) ? ["function fill(x, m) {\n  for (let q = 0; q < m; q++) x.push(q);\n}"] : []),
    "function run(c, n) {",
    ...(uses(/\bl\[/) ? ["  const l = [1, 2, 3];"] : []),
    "  let s = 0;",
    ...(uses(/\bk\+\+/) ? ["  let k = 0;"] : []),
    `  ${uses(/\ba = \[8\]/) ? "let" : "const"} a = ${list[1]};`,
    ...(uses(/\bb\.push/) ? ["  const b = a;"] : []),
    ...(uses(/\bbox\b/) ? ["  const box = { a };"] : []),
    ...(uses(/\brows\b/) ? ["  const rows = [a];"] : []),
    ...(uses(/\bmore\(/) ? ["  const more = v => {\n    a.push(v);\n  };"] : []),
    indent(body, "  "),
    indent(ask[1], "  "),
    "}",
    "try {",
    indent(call[1], "  "),
    "} catch (error) {",
    "  out.push(error.name);",
    "}",
    ...(uses(/\ball\b/) ? ["out.push(all.length, all.at(-1)?.length);"] : []),
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${fill[0]}--${value[0]}--${second[0]}--${where[0]}--${loop[0]}--${ask[0]}--${call[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
