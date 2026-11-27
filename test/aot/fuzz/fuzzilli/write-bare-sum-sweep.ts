// The least loops over many elements, as vectors may run them: the list, times what is done with an element, times how many there are, times the numbers, times the loop, times what is odd among them, with nothing beside.
//
//   bun write-bare-sum-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<deed>--<length>--<numbers>--<loop>--<odd>.mjs, .cjs or .ts
//   bun write-bare-sum-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const lists: [name: string, make: string][] = [["words", "Int32Array.from({ length: N }, F)"], ["unsigned-words", "Uint32Array.from({ length: N }, F)"], ["bytes", "Uint8Array.from({ length: N }, F)"], ["signed-bytes", "Int8Array.from({ length: N }, F)"], ["half-words", "Int16Array.from({ length: N }, F)"], ["unsigned-half-words", "Uint16Array.from({ length: N }, F)"], ["floats", "Float32Array.from({ length: N }, F)"], ["doubles", "Float64Array.from({ length: N }, F)"], ["clamped", "Uint8ClampedArray.from({ length: N }, F)"], ["list", "Array.from({ length: N }, F)"], ["part", "new Float64Array(Array.from({ length: N + 3 }, F)).subarray(1, N + 1)"], ["part-of-bytes", "new Uint8Array(Array.from({ length: N + 5 }, F)).subarray(3, N + 3)"], ["part-of-words", "new Int32Array(Array.from({ length: N + 2 }, F)).subarray(1, N + 1)"]]; // prettier-ignore
// a and b are lists, s a number; `i` counts.
const deeds: [name: string, text: string][] = [
  ["sum", "s += a[i];"],
  ["truncated-sum", "s = (s + a[i]) | 0;"],
  ["sum-of-products", "s += a[i] * b[i];"],
  ["sum-of-squares", "s += a[i] * a[i];"],
  ["sum-of-differences", "s += Math.abs(a[i] - b[i]);"],
  ["difference", "s -= a[i];"],
  ["xor", "s ^= a[i];"],
  ["or", "s |= a[i];"],
  ["and", "s &= a[i];"],
  ["greatest", "if (a[i] > s) s = a[i];"],
  ["least", "s = Math.min(s, a[i]);"],
  ["counted", "if (a[i] === 3) s++;"],
  ["counted-above", "if (a[i] > 2) s += 1;"],
  ["added", "a[i] += b[i];"],
  ["scaled", "a[i] *= 2;"],
  ["copied", "a[i] = b[i];"],
  ["filled", "a[i] = 7;"],
  ["of-counter", "a[i] = i;"],
  ["shifted", "a[i] = b[i] >> 1;"],
  ["negated", "a[i] = -b[i];"],
  ["halved", "a[i] = b[i] / 2;"],
  ["imul", "a[i] = Math.imul(a[i], b[i]);"],
  ["absolute", "a[i] = Math.abs(b[i]);"],
  ["greater-of-two", "a[i] = Math.max(a[i], b[i]);"],
  ["rounded", "a[i] = Math.floor(b[i] * 0.5);"],
  ["truncated", "a[i] = b[i] | 0;"],
  ["unsigned", "a[i] = b[i] >>> 0;"],
  ["masked", "a[i] = b[i] & 15;"],
  ["bounded", "a[i] = a[i] > 5 ? 5 : a[i];"],
  ["hash", "s = (s * 31 + a[i]) | 0;"],
  ["from-left", "if (i > 0) a[i] = a[i - 1] + b[i];"],
  ["from-right", "a[i] = a[i + 1] ?? 0;"],
  ["sum-with-fraction", "s += a[i] * 0.5;"],
  ["two-sums", "s += a[i];\nt += b[i];"],
  ["count-and-sum", "s += a[i];\nt++;"],
];
const lengths: [name: string, count: number][] = [["none", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["seven", 7], ["eight", 8], ["fifteen", 15], ["sixteen", 16], ["seventeen", 17], ["thirty-one", 31], ["thirty-three", 33], ["sixty-six", 66], ["many", 301]]; // prettier-ignore
const numbers: [name: string, text: string][] = [["counted", "(_, k) => k"], ["small", "(_, k) => k % 5"], ["signed", "(_, k) => (k & 1 ? -k : k)"], ["large", "(_, k) => 2147483647 - k"], ["lowest", "(_, k) => -2147483648 + k"], ["fractions", "(_, k) => k / 4"], ["wide", "(_, k) => k * 1e9"], ["edge-of-bytes", "(_, k) => 250 + (k % 12)"], ["zeros", "() => 0"], ["minus-zeros", "() => -0"]]; // prettier-ignore
const loops: [name: string, text: string][] = [["of-length", "for (let i = 0; i < a.length; i++) {\n  DO\n}"], ["given", "for (let i = 0; i < n; i++) {\n  DO\n}"], ["down", "for (let i = a.length; i-- > 0; ) {\n  DO\n}"], ["by-two", "for (let i = 0; i < a.length; i += 2) {\n  DO\n}"], ["from-one", "for (let i = 1; i < a.length - 1; i++) {\n  DO\n}"], ["while", "let i = 0;\nwhile (i < a.length) {\n  DO\n  i++;\n}"], ["nested", "for (let k = 0; k < 3; k++) {\n  for (let i = 0; i < a.length; i++) {\n    DO\n  }\n}"], ["past", "const end = a.length + 2;\nfor (let i = 0; i < end; i++) {\n  DO\n}"], ["kept-length", "const length = a.length;\nfor (let i = 0; i < length; i++) {\n  DO\n}"]]; // prettier-ignore
const odd: [name: string, text: string][] = [["nothing", ""], ["not-a-number", "if (a.length > 2) a[2] = NaN;"], ["fraction", "if (a.length > 2) a[2] = 2.5;"], ["same", "b = a;"], ["overlapping", "if (a.buffer) b = new a.constructor(a.buffer, 0, Math.max(0, a.length - 1));"], ["shorter", "b = b.slice(0, 2);"], ["other-kind", "b = Array.from(b);"]]; // prettier-ignore
const starts: [name: string, text: string][] = [["zero", "0"], ["fraction", "0.5"], ["large", "2147483640"], ["minus-zero", "-0"]]; // prettier-ignore
const total = lists.length * deeds.length * lengths.length * numbers.length * loops.length * odd.length * starts.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const deed = pick(deeds);
  const list = pick(lists);
  const length = pick(lengths);
  const number = pick(numbers);
  const loop = pick(loops);
  const strange = pick(odd);
  const start = pick(starts);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const make = list[1].replaceAll(/\bN\b/g, String(length[1])).replaceAll(/\bF\b/g, number[1]);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    `function run(a, b, n) {\n  let s = ${start[1]};\n  let t = 0;\n${indent(within(loop[1], "DO", deed[1]), "  ")}\n  return [s, t];\n}`,
    "const show = x => (Object.is(x, -0) ? '-0' : String(x));",
    "for (let turn = 0; turn < 3; turn++) {",
    `  const a = ${make};`,
    `  let b = ${make}.reverse();`,
    ...(strange[1] ? [`  ${strange[1]}`] : []),
    `  console.log(run(a, b, ${Math.max(0, length[1] - 1)}).map(show).join(), Array.from(a, show).join().slice(0, 500));`,
    "}",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${deed[0]}--${length[0]}--${number[0]}--${loop[0]}--${strange[0]}--${start[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
