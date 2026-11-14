// The least loops over rings and windows: the list, times how the index comes round, times what is read there, times what is stored there, times the loop, times what happens to the list on the way.
//
//   bun write-ring-index-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<index>--<read>--<stored>--<loop>--<way>.mjs, .cjs or .ts
//   bun write-ring-index-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `p` is carried, `i` counts, K is the index.
const lists: [name: string, text: string][] = [
  ["integers", "[3, 1, 2, 5, 4, 9, 7, 6]"],
  ["fractions", "[3.5, 1, 2, 5.25, 4, 9, 7, 6]"],
  ["texts", "['d', 'b', 'c', 'f', 'e', 'a', 'h', 'g']"],
  ["kinds", "[3, 'b', 2.5, null, 4, undefined, 7, true]"],
  ["hole", "[3, , 2, 5, 4, , 7, 6]"],
  ["words", "new Int32Array([3, 1, 2, 5, 4, 9, 7, 6])"],
  ["bytes", "new Uint8Array([3, 1, 2, 5, 4, 9, 7, 6])"],
  ["doubles", "new Float64Array([3.5, 1, 2, 5, 4, 9, 7, 6])"],
  ["objects", "Array.from({ length: 8 }, (_, k) => ({ v: k }))"],
  ["rows", "Array.from({ length: 8 }, (_, k) => [k, k + 1])"],
  ["text", "'dbcfeahg'"],
  ["short", "[1, 2]"],
  ["empty", "[]"],
  ["window", "new Float64Array(new Float64Array(20).map((_, k) => k / 2).buffer, 16, 8)"],
];
const indexes: [name: string, step: string, at: string][] = [
  ["round", "p = (p + 1) % 8;", "p"],
  ["round-given", "p = (p + 1) % n;", "p"],
  ["round-length", "p = (p + 1) % a.length;", "p"],
  ["round-by-step", "p = (p + c) % 8;", "p"],
  ["back", "p = (p + 7) % 8;", "p"],
  ["back-negative", "p = (p - 1) % 8;", "p"],
  ["masked", "p = (p + 3) & 7;", "p"],
  ["by-hand", "if (++p === 8) p = 0;", "p"],
  ["by-hand-length", "p++;\nif (p >= a.length) p = 0;", "p"],
  ["counter", "", "i % 8"],
  ["counter-length", "", "i % a.length"],
  ["sum", "", "(i + c) % 8"],
  ["sum-of-two", "", "(p + i) % a.length"],
  ["neighbor", "", "(i + 1) % a.length"],
  ["product", "", "(i * 5) % 8"],
  ["shifted", "", "(i >> 1) & 7"],
  ["difference", "", "Math.abs(i - 3) & 7"],
  ["ahead", "", "i + 1"],
  ["ahead-given", "", "i + c"],
  ["behind", "", "i - 1"],
  ["past", "p += 3;", "p"],
  ["from-list", "", "a[i & 7] & 7"],
  ["truncated", "p = (p * 1.5 + 1) | 0;", "p & 7"],
  ["fraction", "", "i / 2"],
];
const reads: [name: string, text: string][] = [
  ["nothing", ";"],
  ["sum", "s += +a[K] || 0;"],
  ["text", "t += a[K];"],
  ["field", "s += a[K]?.v ?? 1;"],
  ["with-next", "t += a[K] === a[i & 7] ? 'e' : 'd';"],
  ["compared", "if (a[K] > 3) s++;"],
  ["listed", "l.push(a[K]);"],
  ["greatest", "if (a[K] > s) s = a[K];"],
  ["row", "s += a[K]?.[0] ?? 1;"],
];
const stores: [name: string, text: string][] = [
  ["nothing", ";"],
  ["counter", "a[K] = i;"],
  ["sum", "a[K] += 1;"],
  ["exchanged", "[a[K], a[0]] = [a[0], a[K]];"],
  ["of-other", "a[K] = a[i & 7];"],
  ["fraction", "a[K] = i + 0.5;"],
  ["text", "a[K] = 't' + i;"],
  ["sometimes", "if (i & 1) a[K] = -i;"],
  ["other-list", "o[K] = a[i & 7];"],
  ["field", "if (a[K]?.v !== undefined) a[K].v += 2;"],
  ["removed", "delete a[K];"],
];
const ways: [name: string, text: string][] = [
  ["nothing", ""],
  ["pushed", "if (i === 2) a.push?.(8);"],
  ["shorter", "if (i === 2) a.length = 3;"],
  ["shifted", "if (i === 2) a.shift?.();"],
  ["other", "if (i === 2) a = b;"],
  ["kept", "if (i === 2) kept = a;"],
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
const total = lists.length * indexes.length * reads.length * stores.length * ways.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 997_921;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const index = pick(indexes);
  const list = pick(lists);
  const read = pick(reads);
  const store = pick(stores);
  const loop = pick(loops);
  const way = pick(ways);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const at = (text: string) => text.replaceAll(/\bK\b/g, index[2]);
  const turn =
    [read[1], store[1], way[1], index[1]]
      .filter(text => text && text !== ";")
      .map(at)
      .join("\n") || "s++;";
  const body = within(loop[1], "IN", turn);
  const has = (word: RegExp) => word.test(body);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(has(/\bkept = /) ? ["let kept;"] : []),
    "function run(a, n, c) {",
    "  let s = 0;",
    "  let t = '';",
    ...(has(/\bp\b/) ? ["  let p = 0;"] : []),
    ...(has(/\bl\.push/) ? ["  const l = [];"] : []),
    ...(has(/\bo\[/) ? ["  const o = [0, 0, 0, 0, 0, 0, 0, 0];"] : []),
    ...(has(/\ba = b\b/) ? ["  const b = [9, 8, 7, 6, 5, 4, 3, 2];"] : []),
    indent(body, "  "),
    `  return [s, t, Array.from(a, x => (typeof x === "object" && x ? (x.v ?? x[0]) : x)).join()${has(/\bl\.push/) ? ", l.map(x => typeof x).join()" : ""}${has(/\bo\[/) ? ", o.map(x => typeof x).join(), o.length" : ""}, Object.keys(a).length].join("/");`,
    "}",
    "const out = [];",
    "for (const [n, c] of [[3, 1], [8, 3], [12, 5]]) {",
    "  try {",
    `    out.push(run(${list[1]}, n, c));`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${index[0]}--${read[0]}--${store[0]}--${loop[0]}--${way[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
