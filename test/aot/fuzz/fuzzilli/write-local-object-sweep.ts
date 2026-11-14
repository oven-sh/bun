// The least programs with one object that never leaves its function until the end: how it is made, times what happens to it in the loop, times what happens behind the loop, times how it leaves, times the loop, times what throws.
//
//   bun write-local-object-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<made>--<deed>--<second>--<behind>--<leaves>--<loop>--<way>.mjs, .cjs or .ts
//   bun write-local-object-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const made: [name: string, text: string][] = [
  ["literal", "{ x: 1, y: 2 }"],
  ["one-field", "{ x: c }"],
  ["doubles", "{ x: 0.5, y: 1.5 }"],
  ["texts", "{ x: 'a', y: '' }"],
  ["instance", "new P(c)"],
  ["heir", "new Q(c)"],
  ["nested", "{ x: 1, y: 2, o: { x: 3, y: 4 } }"],
  ["of-function", "make(c)"],
  ["list", "[1, 2]"],
  ["pair", "{ x: c, y: n }"],
];
// `o` is the object, `i` counts.
const deeds: [name: string, text: string][] = [
  ["nothing", ";"],
  ["added", "o.x += i;"],
  ["stepped", "o.x++;"],
  ["both", "o.x += o.y;\no.y -= 1;"],
  ["sometimes", "if (i & 1) o.x += 10;"],
  ["either", "if (i & 1) o.x += 1;\nelse o.y += 2;"],
  ["replaced", "o = { x: o.x + 1, y: i };"],
  ["replaced-sometimes", "if (i === 1) o = { x: 7, y: 8 };"],
  ["copied", "o = { ...o, x: i };"],
  ["exchanged", "[o.x, o.y] = [o.y, o.x];"],
  ["kind", "o.x = i & 1 ? 't' : i;"],
  ["new-field", "o.z = i;"],
  ["removed", "delete o.y;"],
  ["second", "const p = o;\np.x += 2;"],
  ["second-kept", "const p = o;\no = { x: p.x, y: i };\np.x = -1;"],
  ["nested", "if (o.o) o.o.x += i;"],
  ["method", "o.move?.(i);"],
  ["passed", "bump(o);"],
  ["closure", "const f = () => o.x;\no.y = f();"],
  ["element", "o[0] = (o[0] ?? 0) + i;"],
  ["missing", "o = i === 2 ? null : o;\nif (!o) o = { x: 99, y: 98 };"],
  ["of-other", "o.x = other.x;\nother.x += 1;"],
  ["linked", "o = { x: i, y: 0, o };"],
];
const behinds: [name: string, text: string][] = [
  ["nothing", ";"],
  ["added", "o.x += 10;"],
  ["sometimes", "if (n & 1) o.x += 100;"],
  ["second", "const r = o;\nr.y = 5;"],
  ["replaced", "o = { x: o.y, y: o.x };"],
  ["loop", "for (let k = 0; k < 2; k++) o.y += k;"],
  ["passed", "bump(o);"],
  ["branch", "if (o.x > 3) o.x = -o.x;\nelse o.y = 'small';"],
];
const leaves: [name: string, text: string][] = [
  ["fields", "return o.x + '|' + o.y;"],
  ["object", "return o;"],
  ["in-list", "return [o, o];"],
  ["in-object", "return { o };"],
  ["kept", "all.push(o);\nreturn o.x;"],
  ["json", "return JSON.stringify(o);"],
  ["one-field", "return o.x;"],
  ["thrown", "throw o;"],
];
const ways: [name: string, text: string][] = [
  ["nothing", "DEED\nSECOND"],
  ["try", "try {\n  DEED\n  if (i === 1) throw 1;\n  SECOND\n} catch {\n  o.y = 'c';\n}"],
  ["finally", "try {\n  DEED\n} finally {\n  SECOND\n}"],
  ["break", "DEED\nif (i === 2) break;\nSECOND"],
  ["continue", "DEED\nif (i === 1) continue;\nSECOND"],
  ["noted", "DEED\nif (i === 1) all.push(o.x);\nSECOND"],
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
const total = made.length * deeds.length * deeds.length * behinds.length * leaves.length * ways.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 10_156_801;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const deed = pick(deeds);
  const behind = pick(behinds);
  const make = pick(made);
  const way = pick(ways);
  const leave = pick(leaves);
  const loop = pick(loops);
  const second = pick(deeds);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const clean = (text: string) =>
    text
      .split("\n")
      .filter(line => line.trim() !== ";")
      .join("\n");
  const block = (text: string) => (/^const /m.test(text) ? `{\n${indent(text, "  ")}\n}` : text);
  const turn = within(within(way[1], "DEED", block(deed[1])), "SECOND", block(second[1]));
  const body = clean(within(loop[1].replace("const go = i", "const go = i"), "IN", way[0] === "break" || way[0] === "continue" ? (loop[0] === "callee" ? turn.replace(/break|continue/, "return") : loop[0] === "while" ? turn.replace("continue;", "{\n  i++;\n  continue;\n}") : turn) : turn)); // prettier-ignore
  const last = clean(behind[1]);
  const all = [body, last, leave[1]].join("\n");
  const has = (word: RegExp) => word.test(all + make[1]);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(has(/\bnew [PQ]\b/)
      ? ["class P {\n  constructor(x) {\n    this.x = x;\n    this.y = 2;\n  }\n  move(i) {\n    this.x += i;\n  }\n}"]
      : []),
    ...(has(/\bnew Q\b/) ? ["class Q extends P {\n  w = 3;\n}"] : []),
    ...(has(/\bmake\(/) ? ["function make(x) {\n  return { x, y: x + 1 };\n}"] : []),
    ...(has(/\bbump\(/) ? ["function bump(o) {\n  o.x += 5;\n}"] : []),
    "const all = [];",
    'const show = v => (Array.isArray(v) ? "[" + v.map(show).join() + "]" : typeof v === "object" && v ? Object.keys(v).map(k => k + ":" + show(v[k])).join() : String(v));',
    "function run(n, c) {",
    ...(has(/\bother\b/) ? ["  const other = { x: 40 };"] : []),
    `  let o = ${make[1]};`,
    indent([body, last, leave[1]].filter(Boolean).join("\n"), "  "),
    "}",
    "const out = [];",
    "for (const [n, c] of [[3, 1], [0, 2], [5, 0.5], [4, 't']]) {",
    "  try {",
    "    out.push(show(run(n, c)));",
    "  } catch (error) {",
    "    out.push(error?.name ?? show(error));",
    "  }",
    "}",
    "out.push(show(all));",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${make[0]}--${deed[0]}--${second[0]}--${behind[0]}--${leave[0]}--${loop[0]}--${way[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
