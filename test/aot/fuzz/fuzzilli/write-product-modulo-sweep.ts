// The least loops of remainders: what is divided, times by what, times the numbers, times what the remainder becomes, times the loop, times what is done with it.
//
//   bun write-product-modulo-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<divided>--<divisor>--<first>--<becomes>--<loop>--<used>.mjs, .cjs or .ts
//   bun write-product-modulo-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `x` is carried, `i` counts, `a` is a list, `m` and `f` are handed over; D is the divisor.
const divideds: [name: string, text: string][] = [
  ["product", "x * 31"],
  ["product-and-sum", "x * 31 + i"],
  ["square", "x * x"],
  ["of-handed", "x * f"],
  ["of-both", "x * f + f"],
  ["of-counter", "x * i"],
  ["of-element", "x * a[i & 7]"],
  ["elements", "a[i & 7] * a[(i + 1) & 7]"],
  ["past-the-end", "x * a[i + 5]"],
  ["sum", "x + a[i & 7]"],
  ["difference", "x - i * 7"],
  ["negative", "-x * 3 - 1"],
  ["truncated", "Math.imul(x, 31)"],
  ["three", "x * f * 3"],
  ["code", "x * 31 + 'abcdefgh'.charCodeAt(i & 7)"],
  ["large", "x * 1103515245 + 12345"],
  ["larger", "x * 6364136223846793"],
  ["itself", "x"],
  ["half", "x / 2"],
  ["shifted", "(x << 5) - x"],
  ["unsigned", "(x * 31) >>> 0"],
];
const divisors: [name: string, text: string][] = [
  ["prime", "65521"],
  ["ten", "10"],
  ["power", "1024"],
  ["two", "2"],
  ["one", "1"],
  ["zero", "0"],
  ["negative", "-7"],
  ["large", "2147483647"],
  ["larger", "4294967296"],
  ["largest", "1000000007"],
  ["huge", "9007199254740881"],
  ["fraction", "2.5"],
  ["handed", "m"],
  ["element", "a[i & 7]"],
  ["length", "a.length"],
  ["counter", "i"],
  ["counter-and-one", "(i + 1)"],
  ["infinite", "Infinity"],
];
const firsts: [name: string, text: string][] = [
  ["one", "1"],
  ["zero", "0"],
  ["negative", "-5"],
  ["negative-zero", "-0"],
  ["fraction", "0.5"],
  ["large", "2147483647"],
  ["larger", "4e15"],
  ["handed", "f"],
  ["length", "a.length"],
  ["text", "'12'"],
];
// X is the remainder.
const becomes: [name: string, text: string][] = [
  ["carried", "x = X;"],
  ["truncated", "x = X | 0;"],
  ["twice", "x = X;\nx = X;"],
  ["compound", "x = DIVIDED;\nx %= D;"],
  ["made-positive", "x = (X + D) % D;"],
  ["by-hand", "x = DIVIDED;\nif (x >= D) x -= D;"],
  ["floor", "x = Math.floor((DIVIDED) / D);"],
  ["both", "const q = Math.trunc((DIVIDED) / D);\nx = DIVIDED - q * D;"],
  ["sometimes", "if (i & 1) x = X;\nelse x += 3;"],
  ["choice", "x = i > 2 ? X : x + 1;"],
  ["argument", "x = rest(DIVIDED, D);"],
  ["field", "o.x = X;\nx = o.x;"],
  ["element", "a[0] = X;\nx = a[0];"],
  ["negated", "x = -(X);"],
  ["sum", "s += X;\nx++;"],
];
const loops: [name: string, text: string][] = [
  ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["eight", "for (let i = 0; i < 8; i++) {\n  IN\n}"],
  ["while", "let i = 0;\nwhile (i < n) {\n  IN\n  i++;\n}"],
  ["down", "for (let i = n; i > 0; i--) {\n  IN\n}"],
  ["nested", "for (let k = 0; k < 2; k++)\n  for (let i = 0; i < n; i++) {\n    IN\n  }"],
  ["until", "for (let i = 0; i < 12 && x !== 3; i++) {\n  IN\n}"],
  ["of", "for (const i of [0, 3, 1, 2]) {\n  IN\n}"],
];
const uses: [name: string, text: string][] = [
  ["nothing", ";"],
  ["sum", "s += x;"],
  ["index", "s += a[x];"],
  ["index-truncated", "s += a[x & 7];"],
  ["stored", "a[x] = i;"],
  ["zero-sign", "s += Object.is(x, -0) ? 1000 : 1;"],
  ["reciprocal", "s += 1 / x > 0 ? 1 : 100;"],
  ["text", "t += x + ',';"],
  ["branch", "if (x === 0) s++;\nelse if (x < 0) s += 10;"],
  ["xor", "s ^= x;"],
  ["counted", "counts[x] = (counts[x] ?? 0) + 1;"],
];
const lists: [name: string, text: string][] = [
  ["integers", "[3, 1, 2, 5, 4, 9, 7, 6]"],
  ["fractions", "[3.5, 1, 2, 5, 4.25, 9, 7, 6]"],
  ["words", "new Int32Array([3, 1, 2, 5, 4, 9, 7, 6])"],
  ["doubles", "new Float64Array([3.5, 1, 2, 5, 4, 9, 7, 6])"],
  ["signed", "[-3, 1, -2, 5, 0, 9, -7, 6]"],
  ["bytes", "new Uint8Array([3, 1, 2, 5, 4, 9, 7, 6])"],
];
const handed: [name: string, text: string][] = [
  ["integers", "3, 7, n"],
  ["one-integer", "n + 2, 5, n"],
  ["fractions", "2.5, 7, n"],
  ["zero", "3, 0, n"],
  ["negative", "-3, -7, n"],
  ["large", "65537, 2147483647, n"],
  ["kinds", "n > 4 ? '3' : 4, n > 4 ? 6 : 5.5, n"],
];
const total =
  divideds.length *
  divisors.length *
  firsts.length *
  becomes.length *
  loops.length *
  uses.length *
  lists.length *
  handed.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 30_000_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const divided = pick(divideds);
  const divisor = pick(divisors);
  const become = pick(becomes);
  const first = pick(firsts);
  const used = pick(uses);
  const list = pick(lists);
  const loop = pick(loops);
  const given = pick(handed);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const turn = become[1]
    .replaceAll(/\bX\b/g, "(DIVIDED) % D")
    .replaceAll("DIVIDED", divided[1])
    .replaceAll(/\bD\b/g, divisor[1]);
  const body = within(loop[1], "IN", turn + (used[1] === ";" ? "" : "\n" + used[1]));
  const has = (word: RegExp) => word.test(body + first[1]);
  const isListed = has(/\ba\b/);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(has(/\brest\(/) ? ["function rest(x, m) {\n  return x % m;\n}"] : []),
    `function run(${isListed ? "a, " : ""}f, m, n) {`,
    `  let x = ${first[1]};`,
    "  let s = 0;",
    ...(has(/\bt \+=/) ? ["  let t = '';"] : []),
    ...(has(/\bo\.x/) ? ["  const o = { x: 0 };"] : []),
    ...(has(/\bcounts\b/) ? ["  const counts = [0, 0, 0];"] : []),
    indent(body, "  "),
    `  return [x, s${has(/\bt \+=/) ? ", t" : ""}${has(/\bcounts\b/) ? ", Object.keys(counts).length" : ""}, Object.is(x, -0)].join("/");`,
    "}",
    "const out = [];",
    "for (const n of [3, 6]) {",
    "  try {",
    `    out.push(run(${isListed ? list[1] + ", " : ""}${given[1]}));`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${divided[0]}--${divisor[0]}--${first[0]}--${become[0]}--${loop[0]}--${used[0]}--${list[0]}--${given[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
