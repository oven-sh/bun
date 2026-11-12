// The least loops that store and test: the list, times what is stored first, times the test, times what happens then, times what is stored behind it, times the names, times the loop.
//
//   bun write-store-and-test-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<first>--<test>--<then>--<behind>--<names>--<loop>.mjs, .cjs or .ts
//   bun write-store-and-test-sweep.ts count
//
// What an iteration stores in front of a test that leaves is stored, and what stands behind it is not.
import { mkdirSync, writeFileSync } from "node:fs";

// A and B are lists; `i` counts; T is given.
const lists: [name: string, text: string][] = [
  ["integers", "[3, 1, 2, 5, 4, 9, 7, 6]"],
  ["fractions", "[3.5, 1, 2, 5.25, 4, 9, 7, 6]"],
  ["hole", "[3, , 2, 5, 4, , 7, 6]"],
  ["kinds", "[3, 'b', 2.5, null, 4, undefined, 7, true]"],
  ["words", "new Int32Array([3, 1, 2, 5, 4, 9, 7, 6])"],
  ["bytes", "new Uint8Array([3, 1, 2, 5, 4, 9, 7, 6])"],
  ["doubles", "new Float64Array([3.5, 1, 2, 5, 4, 9, 7, 6])"],
  ["floats", "new Float32Array([3.5, 1, 2, 5, 4, 9, 7, 6])"],
  ["objects", "Array.from({ length: 8 }, (_, k) => ({ x: k, y: k / 2, v: 1 }))"],
  ["instances", "Array.from({ length: 8 }, (_, k) => new P(k))"],
  ["rows", "Array.from({ length: 8 }, (_, k) => [k, k + 0.5, 1])"],
  ["many", "Array.from({ length: 40 }, (_, k) => (k * 7) % 11)"],
];
const firsts: [name: string, text: string][] = [
  ["nothing", ""],
  ["counter", "A[i] = i;"],
  ["sum", "A[i] += 2;"],
  ["scaled", "A[i] *= 1.5;"],
  ["of-other", "A[i] = B[i] + 1;"],
  ["other", "B[i] = A[i];"],
  ["next", "if (i < 20) A[i + 1] = A[i];"],
  ["field", "A[i].x += A[i].v;"],
  ["two-fields", "A[i].x += A[i].v;\nA[i].y -= 0.25;"],
  ["element", "A[i][0] += A[i][2];"],
  ["carried", "s += A[i];"],
  ["pushed", "l.push(A[i]);"],
];
const tests: [name: string, text: string][] = [
  ["above", "A[i] > T"],
  ["equal", "A[i] === T"],
  ["counter", "i === T"],
  ["odd", "i & 1"],
  ["sum", "s > T * 3"],
  ["field", "A[i].x > T"],
  ["field-below", "A[i].y < T - 2"],
  ["element", "A[i][0] > T"],
  ["of-other", "B[i] > T"],
  ["missing", "A[i] === undefined"],
  ["not-a-number", "A[i] !== A[i]"],
  ["called", "isPast(A[i], T)"],
  ["two", "A[i] > T || i > 5"],
  ["both", "A[i] > 1 && A[i] < T"],
  ["last", "i === A.length - 1"],
  ["never", "T < 0"],
];
const thens: [name: string, text: string][] = [
  ["break", "break;"],
  ["continue", "continue;"],
  ["return", "return s + ':' + i;"],
  ["throw", "throw new RangeError('r');"],
  ["stored", "A[i] = 0;"],
  ["stored-other", "B[i] = -1;"],
  ["negated-field", "A[i].v = -A[i].v;"],
  ["counted", "s++;"],
  ["pushed", "l.push(i);"],
  ["text", "A[i] = 't';"],
  ["called", "note(i);"],
  ["shorter", "A.length = 2;"],
  ["stepped", "i++;"],
  ["kept", "kept = A[i];"],
  ["labelled", "break outer;"],
];
const behinds: [name: string, text: string][] = [
  ["nothing", ""],
  ["sum", "s += +A[i] || 1;"],
  ["stored", "A[i] = s & 15;"],
  ["other", "B[i] = i;"],
  ["added", "B[i] += A[i];"],
  ["field", "A[i].y = i;"],
  ["element", "A[i][1] = i;"],
  ["pushed", "l.push(-i);"],
];
const names: [name: string, b: string][] = [
  ["two", "[8, 7, 6, 5, 4, 3, 2, 1]"],
  ["one", "A"],
  ["views", "new Float64Array(8)"],
  ["words", "new Int32Array(40)"],
  ["same-buffer", "overlap(A)"],
];
const loops: [name: string, text: string][] = [
  ["length", "for (let i = 0; i < A.length; i++) {\n  IN\n}"],
  ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["while", "let i = -1;\nwhile (++i < n) {\n  IN\n}"],
  ["down", "for (let i = n - 1; i >= 0; i--) {\n  IN\n}"],
  ["nested", "for (let j = 0; j < 2; j++)\n  for (let i = 0; i < n; i++) {\n    IN\n  }"],
  ["by-two", "for (let i = 0; i < 8; i += 2) {\n  IN\n}"],
  ["kept-length", "for (let i = 0, m = A.length; i < m; i++) {\n  IN\n}"],
];
const total = lists.length * firsts.length * tests.length * thens.length * behinds.length * names.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 6_048_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const list = pick(lists);
  const first = pick(firsts);
  const test = pick(tests);
  const picked = pick(thens);
  const behind = pick(behinds);
  const loop = pick(loops);
  const then: [string, string] = loop[0] === "down" && picked[0] === "stepped" ? ["stepped", "i--;"] : picked;
  const name = pick(names);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const turn = [first[1], `if (${test[1]}) ${then[1].includes("\n") ? `{\n${indent(then[1], "  ")}\n}` : then[1]}`, behind[1]].filter(Boolean).join("\n"); // prettier-ignore
  const named = (text: string) => text.replaceAll(/\bA\b/g, "a").replaceAll(/\bB\b/g, "b").replaceAll(/\bT\b/g, "t");
  const body = named(within(loop[1], "IN", turn));
  const has = (word: RegExp) => word.test(body);
  const isLabelled = has(/\bbreak outer\b/);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(/\bP\(/.test(list[1])
      ? ["class P {\n  constructor(k) {\n    this.x = k;\n    this.y = k / 2;\n    this.v = 1;\n  }\n}"]
      : []),
    ...(has(/\bisPast\(/) ? ["function isPast(x, t) {\n  return x > t;\n}"] : []),
    ...(has(/\bnote\(/) ? ["let noted = 0;\nfunction note(i) {\n  noted += i;\n}"] : []),
    ...(has(/\bkept\b/) ? ["let kept;"] : []),
    ...(name[1].startsWith("overlap")
      ? ["function overlap(x) {\n  return x.buffer ? new x.constructor(x.buffer, x.BYTES_PER_ELEMENT) : x;\n}"]
      : []),
    "const l = [];",
    "function run(a, b, n, t) {",
    "  let s = 0;",
    indent(isLabelled ? body.replace(/^(for|while)\b/m, "outer: $1") : body, "  "),
    "  return s;",
    "}",
    'const show = x => (typeof x === "object" && x ? Object.values(x).join("~") : String(x));',
    "const out = [];",
    "for (const [n, t] of [[3, 2], [8, 4], [7, 8]]) {",
    `  const a = ${list[1]};`,
    `  const b = ${named(name[1])};`,
    "  try {",
    "    out.push(run(a, b, n, t));",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "  out.push(Array.from(a, show).join());",
    ...(has(/\bb\[/) ? ["  if (b !== a) out.push(Array.from(b, show).join());"] : []),
    "}",
    ...(has(/\bnoted|note\(/) ? ["out.push(noted);"] : []),
    ...(has(/\bkept\b/) ? ["out.push(show(kept));"] : []),
    "out.push(l.map(show).join());",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${first[0]}--${test[0]}--${then[0]}--${behind[0]}--${name[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
