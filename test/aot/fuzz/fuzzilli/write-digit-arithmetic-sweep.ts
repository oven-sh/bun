// Arithmetic on digits and words as libraries of large numbers and of digests write it: the kernel, times the bits of a digit, times the digits, times the list that holds them, times how the carry is taken, times how the loop counts, times the constants, times the function around.
//
//   bun write-digit-arithmetic-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<kernel>--<bits>--<digits>--<list>--<carry>--<loop>--<constant>--<function>.mjs, .cjs or .ts
//   bun write-digit-arithmetic-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `x` and `y` hold digits, `z` is stored; BITS are the bits of a digit, MASK is 2 ** BITS - 1, HALF the bits of a half, CARRY takes the carry out of `t`; `c` is the carry, F a factor.
const kernels: [name: string, text: string][] = [
  ["sum", "t = x[i] + y[i] + c;\nz[i] = t & MASK;\nc = CARRY;"],
  ["difference", "t = x[i] - y[i] - c;\nz[i] = t & MASK;\nc = t < 0 ? 1 : 0;"],
  ["difference-by-shift", "t = x[i] - y[i] + c;\nc = t >> BITS;\nz[i] = t & MASK;"],
  ["times-word", "t = x[i] * F + c;\nz[i] = t & MASK;\nc = Math.floor(t / (MASK + 1));"],
  [
    "times-word-by-halves",
    "const low = x[i] & (2 ** HALF - 1);\nconst high = x[i] >> HALF;\nconst m = high * (F & (2 ** HALF - 1)) + (F >> HALF) * low;\nt = low * (F & (2 ** HALF - 1)) + ((m & (2 ** HALF - 1)) << HALF) + z[i] + c;\nc = (t >> BITS) + (m >> HALF) + (F >> HALF) * high;\nz[i] = t & MASK;",
  ],
  [
    "wide-by-halves",
    "const low = x[i] & 0xffff;\nconst high = x[i] >>> 16;\nconst m = high * (F & 0xffff) + (low * (F & 0xffff) >>> 16);\nz[i] = ((m << 16) + (low * (F & 0xffff) & 0xffff)) >>> 0;\nc = (c + (m >>> 16)) | 0;",
  ],
  ["imul-and-high", "z[i] = Math.imul(x[i], F);\nc = (c + ((x[i] * F) / 4294967296)) | 0;"],
  ["shift-left", "t = (x[i] << SHIFT) | c;\nz[i] = t & MASK;\nc = x[i] >>> (BITS - SHIFT);"],
  ["shift-right", "z[i] = (x[i] >>> SHIFT) | (((x[i + 1] ?? 0) << (BITS - SHIFT)) & MASK);"],
  ["divided", "t = c * (MASK + 1) + x[i];\nz[i] = (t / F) | 0;\nc = t % F;"],
  ["divided-floor", "t = c * (MASK + 1) + x[i];\nz[i] = Math.floor(t / F);\nc = t - z[i] * F;"],
  ["rotated", "c = ((c << SHIFT) | (c >>> (32 - SHIFT))) ^ x[i];\nz[i] = c >>> 0;"],
  ["rotated-right", "c = ((c >>> SHIFT) | (c << (32 - SHIFT))) + x[i];\nc |= 0;\nz[i] = c;"],
  ["digest", "c = (Math.imul(c ^ x[i], 0x01000193) + (c >>> SHIFT)) | 0;\nz[i] = c;"],
  ["checksum", "c = (c + x[i]) % 65521;\nt = (t + c) % 65521;\nz[i] = t;"],
  ["table", "c = (table[(c ^ x[i]) & 15] ^ (c >>> 4)) >>> 0;\nz[i] = c;"],
  ["square", "t = x[i] * x[i] + c;\nz[i] = t % (MASK + 1);\nc = Math.floor(t / (MASK + 1));"],
  ["compared", "if (c === 0 && x[i] !== y[i]) c = x[i] < y[i] ? -1 : 1;\nz[i] = c;"],
  ["sum-of-five", "c = (c + x[i] + y[i] + F + (z[i] ?? 0)) | 0;\nz[i] = c;"],
  ["unsigned-sum", "c = (c + x[i] + y[i]) >>> 0;\nz[i] = c;"],
  ["majority", "c = ((x[i] & y[i]) ^ (~x[i] & c) ^ (y[i] & c)) + F;\nc |= 0;\nz[i] = c;"],
  ["two-words", "const l = (x[i] >>> 0) + (y[i] >>> 0) + (c >>> 0);\nz[i] = l | 0;\nc = (l / 4294967296) | 0;"],
  [
    "masked-sum",
    "t = (x[i] & 0xffff) + (y[i] & 0xffff);\nz[i] = (((x[i] >> 16) + (y[i] >> 16) + (t >> 16)) << 16) | (t & 0xffff);",
  ],
  ["negated", "t = (~x[i] & MASK) + c;\nz[i] = t & MASK;\nc = CARRY;"],
  ["powers", "c = (c * 31 + x[i]) % 1000000007;\nz[i] = c;"],
];
const bits: [name: string, count: number][] = [["eight", 8], ["fourteen", 14], ["fifteen", 15], ["sixteen", 16], ["twenty-four", 24], ["twenty-six", 26], ["twenty-eight", 28], ["thirty", 30]]; // prettier-ignore
const digits: [name: string, text: string][] = [
  ["full", "MASK"],
  ["half", "MASK >>> 1"],
  ["counted", "(i * 2654435761) & MASK"],
  ["mixed", "i & 1 ? MASK : 1"],
  ["zero", "0"],
  ["one", "1"],
  ["top-bit", "(MASK >>> 1) + 1"],
  ["signed", "(i & 1 ? -1 : 1) * ((i * 77) & MASK)"],
  ["words", "(i * 0x9e3779b9) | 0"],
  ["unsigned-words", "(i * 0x9e3779b9) >>> 0"],
];
const lists: [name: string, text: string][] = [
  [
    "lists",
    "const x = [];\nconst y = [];\nfor (let i = 0; i < n; i++) {\n  x.push(D);\n  y.push(E);\n}\nconst z = new Array(n).fill(0);",
  ],
  [
    "words",
    "const x = Int32Array.from({ length: n }, (_, i) => D);\nconst y = Int32Array.from({ length: n }, (_, i) => E);\nconst z = new Int32Array(n);",
  ],
  [
    "unsigned",
    "const x = Uint32Array.from({ length: n }, (_, i) => D);\nconst y = Uint32Array.from({ length: n }, (_, i) => E);\nconst z = new Uint32Array(n);",
  ],
  [
    "made",
    "const x = Array.from({ length: n }, (_, i) => D);\nconst y = Array.from({ length: n }, (_, i) => E);\nconst z = [];",
  ],
  [
    "in-place",
    "const x = Array.from({ length: n }, (_, i) => D);\nconst y = Array.from({ length: n }, (_, i) => E);\nconst z = x;",
  ],
  [
    "doubles",
    "const x = Float64Array.from({ length: n }, (_, i) => D);\nconst y = Float64Array.from({ length: n }, (_, i) => E);\nconst z = new Float64Array(n);",
  ],
  [
    "of-class",
    "class Big {\n  constructor(make) {\n    this.words = [];\n    for (let i = 0; i < n; i++) this.words[i] = make(i);\n  }\n}\nconst x = new Big(i => D).words;\nconst y = new Big(i => E).words;\nconst z = new Big(() => 0).words;",
  ],
];
const carries: [name: string, text: string][] = [["shift", "t >> BITS"], ["unsigned-shift", "t >>> BITS"], ["floor", "Math.floor(t / (MASK + 1))"], ["truncated", "(t / (MASK + 1)) | 0"], ["asked", "t > MASK ? 1 : 0"]]; // prettier-ignore
// STEP is the kernel.
const loops: [name: string, text: string][] = [
  ["for", "for (let i = 0; i < n; i++) {\n  STEP\n}"],
  ["of-length", "for (let i = 0; i < x.length; i++) {\n  STEP\n}"],
  ["down", "for (let i = n - 1; i >= 0; i--) {\n  STEP\n}"],
  ["rounds", "for (let round = 0; round < 3; round++) {\n  for (let i = 0; i < n; i++) {\n    STEP\n  }\n}"],
  ["while", "let i = 0;\nwhile (i < n) {\n  STEP\n  i++;\n}"],
  ["two-counters", "for (let i = 0, j = n; i < j; i++) {\n  STEP\n}"],
  ["once", "{\n  const i = 1;\n  STEP\n}"],
];
const constants: [name: string, factor: string, shift: string][] = [["small", "3", "1"], ["large", "MASK", "5"], ["given", "f", "s"], ["power", "(MASK >>> 1) + 1", "7"], ["odd", "12345", "3"]]; // prettier-ignore
const functions: [name: string, text: string][] = [
  ["function", "function run(n, f, s) {\n  BODY\n}"],
  ["arrow", "const run = (n, f, s) => {\n  BODY\n};"],
  ["method", "class Runner {\n  run(n, f, s) {\n    BODY\n  }\n}\nconst run = (n, f, s) => new Runner().run(n, f, s);"],
];
const total = kernels.length * bits.length * digits.length ** 2 * lists.length * carries.length * loops.length * constants.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const kernel = pick(kernels);
  const bit = pick(bits);
  const first = pick(digits);
  const list = pick(lists);
  const constant = pick(constants);
  const loop = pick(loops);
  const carry = pick(carries);
  const second = pick(digits);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const numbers = (text: string) =>
    text
      .replaceAll(/\bCARRY\b/g, carry[1])
      .replaceAll(/\bF\b/g, /^\w+$/.test(constant[1]) ? constant[1] : `(${constant[1]})`)
      .replaceAll(/\bSHIFT\b/g, constant[2])
      .replaceAll(/\bBITS\b/g, String(bit[1]))
      .replaceAll(/\bHALF\b/g, String(bit[1] >> 1))
      .replaceAll(/\bMASK\b/g, String(2 ** bit[1] - 1));
  const body = [
    numbers(list[1].replaceAll(/\bD\b/g, first[1]).replaceAll(/\bE\b/g, second[1])),
    "let c = 0;\nlet t = 0;",
    ...(/table/.test(kernel[1])
      ? ["const table = Int32Array.from({ length: 16 }, (_, i) => Math.imul(i + 1, 0x1db71064));"]
      : []),
    within(loop[1], "STEP", numbers(kernel[1])),
    "out.push(Array.from(z, show).join(), show(c), show(t));",
  ].join("\n");
  const any = isTyped ? ": any" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : String(value));',
    "const out = [];",
    within(form[1].replace("(n, f, s)", `(n${any}, f${any}, s${any})`), "BODY", body),
    "for (const [n, f, s] of [[5, 7, 2], [9, 65535, 4], [12, 1, 13]]) {",
    "  try {",
    "    run(n, f, s);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 2500));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${kernel[0]}--${bit[0]}--${first[0]}--${second[0]}--${list[0]}--${carry[0]}--${loop[0]}--${constant[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
