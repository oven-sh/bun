// The least loops that index with numbers of every width: what is indexed, times the index, times the numbers, times what is done there, times how the index is reached, times the loop.
//
//   bun write-wide-index-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<held>--<index>--<numbers>--<deed>--<way>--<loop>.mjs, .cjs or .ts
//   bun write-wide-index-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const held: [name: string, text: string][] = [
  ["words", "new Int32Array([3, 1, 2, 5, 4, 9, 7, 6])"],
  ["unsigned-words", "new Uint32Array([3, 1, 2, 5, 4, 9, 7, 4294967295])"],
  ["bytes", "new Uint8Array([3, 1, 2, 5, 4, 9, 7, 6])"],
  ["clamped", "new Uint8ClampedArray([3, 1, 2, 5, 4, 9, 7, 6])"],
  ["shorts", "new Int16Array([3, -1, 2, 5, 4, 9, 7, 6])"],
  ["doubles", "new Float64Array([3.5, 1, 2, 5, 4, 9, 7, 6])"],
  ["floats", "new Float32Array([3.5, 1, 2, 5, 4, 9, 7, 6])"],
  ["big", "new BigInt64Array([3n, 1n, 2n, 5n, 4n, 9n, 7n, 6n])"],
  ["integers", "[3, 1, 2, 5, 4, 9, 7, 6]"],
  ["fractions", "[3.5, 1, 2.5, 5, 4, 9, 7, 6]"],
  ["texts", "['d', 'b', 'c', 'f', 'e', 'a', 'h', 'g']"],
  ["hole", "[3, , 2, 5, , 9, 7, 6]"],
  ["text", "'dbcfeahg'"],
  ["object", "{ 0: 3, 1: 1, 7: 6, length: 8 }"],
  ["window", "new Int32Array(new Int32Array(16).map((_, k) => k).buffer, 16, 8)"],
  ["growing", "new Uint8Array(new ArrayBuffer(8, { maxByteLength: 64 }))"],
];
// `y` is the number, `i` counts.
const indexes: [name: string, text: string][] = [
  ["unsigned", "y >>> 0"],
  ["truncated", "y | 0"],
  ["masked", "y & 7"],
  ["remainder", "y % 8"],
  ["cut", "Math.trunc(y)"],
  ["floor", "Math.floor(y)"],
  ["absolute", "Math.abs(y)"],
  ["itself", "y"],
  ["above-mask", "y - (y & ~7)"],
  ["twice", "~~y"],
  ["half", "y >> 1"],
  ["unsigned-half", "y >>> 1"],
  ["sum", "(y + i) >>> 0"],
  ["sum-masked", "(y + i) & 7"],
  ["product", "Math.imul(y, 3) & 7"],
  ["product-unsigned", "Math.imul(y, 3) >>> 0"],
  ["difference", "8 - (y >>> 0)"],
  ["less-one", "(y >>> 0) - 1"],
  ["more-one", "(y | 0) + 1"],
  ["negated", "-(y | 0)"],
  ["inverted", "~y"],
  ["plus", "+y"],
  ["text", "String(y & 7)"],
  ["least", "Math.min(y, 7)"],
  ["greatest", "Math.max(y, 0)"],
  ["both", "Math.min(Math.max(y, 0), 7)"],
  ["leading", "Math.clz32(y)"],
  ["fraction", "y / 2"],
  ["choice", "y > 7 ? 7 : y"],
  ["xor", "(y ^ i) >>> 0"],
  ["unsigned-of-sum", "Math.trunc(Math.abs(y >>> 0))"],
];
const numbers: [name: string, text: string][] = [
  ["small", "0, 1, 7, 8"],
  ["around-word", "2 ** 31 - 1, 2 ** 31, 2 ** 31 + 1"],
  ["around-two-words", "2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1, 2 ** 32 + 7"],
  ["word-and-wide", "2 ** 31, 2 ** 52"],
  ["small-and-wide", "3, 2 ** 52, 2 ** 53 - 1"],
  ["wide", "2 ** 52, 2 ** 53, 2 ** 53 - 1"],
  ["huge", "1e300, 2 ** 64, -(2 ** 64)"],
  ["negative", "-1, -8, -(2 ** 31), -(2 ** 32)"],
  ["fractions", "0.5, 7.9, -0.5, 2 ** 31 + 0.5"],
  ["not-numbers", "NaN, Infinity, -Infinity"],
  ["zeros", "0, -0"],
  ["kinds", "3, '4', null, undefined, true"],
  ["small-and-negative", "5, -1, 6"],
  ["all", "1, 2 ** 31, -1, 0.5, NaN, 2 ** 32 + 2"],
];
// A is what is indexed, X the index.
const deeds: [name: string, text: string][] = [
  ["read", "say(a[X]);"],
  ["sum", "s += +String(a[X]) || 1;"],
  ["store", "a[X] = 1;\nsay(a[0]);"],
  ["store-counter", "a[X] = i;\nsay(a[X]);"],
  ["added", "a[X] += 1;\nsay(a[X]);"],
  ["stepped", "a[X]++;\nsay(a[1]);"],
  ["has", "say((X) in a);"],
  ["at", "say(a.at?.(X));"],
  ["removed", "say(delete a[X]);"],
  ["optional", "say(a?.[X]);"],
  ["two", "say(a[X]);\nsay(b[X]);"],
  ["copied", "b[X] = a[X];\nsay(b[0]);"],
  ["branch", "if (a[X] > 3) s++;\nelse s += 10;"],
  ["missing", "say(a[X] === undefined);"],
];
const ways: [name: string, text: string, front: string][] = [
  ["in-place", "DEED", ""],
  ["kept", "const k = X;\nDEED-K", ""],
  ["callee", "go(a, b, y, i);", "function go(a, b, y, i) {\n  DEED\n}"],
  ["reading-callee", "say(get(a, y, i));", "function get(a, y, i) {\n  return a[X];\n}"],
  ["tested", "if ((X) < 8) {\n  DEED\n}", ""],
  ["tested-length", "const k = X;\nif (k >= 0 && k < 8) {\n  DEED-K\n}", ""],
  ["stepped-down", "const z = y;\n{\n  const y = z - i;\n  DEED\n}", ""],
];
const loops: [name: string, text: string][] = [
  ["once", "{\n  const i = 1;\n  IN\n}"],
  ["four", "for (let i = 0; i < 4; i++) {\n  IN\n}"],
  ["nest", "for (let j = 0; j < 2; j++) {\n  for (let i = 0; i < 4; i++) {\n    IN\n  }\n}"],
  ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["carried", "for (let i = 0; i < 4; i++) {\n  IN\n  y = y + 1;\n}"],
  ["doubled", "for (let i = 0; i < 4; i++) {\n  IN\n  y = y * 2;\n}"],
];
const total = held.length * indexes.length * numbers.length * deeds.length * ways.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 2_551_921;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const index = pick(indexes);
  const deed = pick(deeds);
  const of = pick(held);
  const given = pick(numbers);
  const way = pick(ways);
  const loop = pick(loops);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && of[0] !== "text" && deed[0] !== "removed";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isCarried = loop[0] === "carried" || loop[0] === "doubled";
  const fill = (text: string, x: string) => text.replaceAll(/\bX\b/g, () => x);
  const turn = within(within(way[1], "DEED-K", fill(deed[1], "k")), "DEED", fill(deed[1], index[1]));
  const body = within(loop[1], "IN", fill(turn, index[1]));
  const front = way[2] ? fill(within(way[2], "DEED", fill(deed[1], index[1])), index[1]) : "";
  const has = (word: RegExp) => word.test(body + front);
  const usesSum = /\bs\b *(\+=|\+\+)/.test(body + front);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    'const say = x => void said.push(Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x));',
    ...(usesSum ? ["let s = 0;"] : []),
    ...(front ? [front] : []),
    `function run(a, b, ${isCarried ? "first" : "y"}, n) {`,
    ...(isCarried ? ["  let y = first;"] : []),
    indent(body, "  "),
    "}",
    `for (const y of [${given[1]}]) {`,
    `  const a = ${of[1]};`,
    ...(has(/\bb\b/) ? [`  const b = ${of[0] === "text" ? "[1, 2, 3, 4, 5, 6, 7, 8]" : of[1]};`] : ["  const b = a;"]),
    "  try {",
    "    run(a, b, y, 3);",
    "  } catch (error) {",
    "    say(error.name);",
    "  }",
    '  say(typeof a === "string" ? a : a.length + ":" + Object.keys(a).slice(0, 14).map(k => k + "=" + String(a[k])).join());',
    "}",
    ...(usesSum ? ["say(s);"] : []),
    'console.log(said.join(" ").slice(0, 1500));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${of[0]}--${index[0]}--${given[0]}--${deed[0]}--${way[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
