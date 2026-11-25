// Arithmetic with one constant: the form, times the constant, times where the other operand comes from. Every program asks some forty values at the edges: around 0, around the constant and its multiples, around the ends of int32 and uint32.
//
//   bun write-constant-arithmetic-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<form>--<constant>--<source>.mjs or .ts
//   bun write-constant-arithmetic-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `x` is the operand, `K` the constant.
const forms: [name: string, text: string][] = [
  ["quotient-or-0", "(x / K) | 0"],
  ["quotient-floored", "Math.floor(x / K)"],
  ["quotient-truncated", "Math.trunc(x / K)"],
  ["quotient-complement", "~~(x / K)"],
  ["quotient-unsigned", "(x / K) >>> 0"],
  ["quotient-rounded", "Math.round(x / K)"],
  ["quotient-ceiled", "Math.ceil(x / K)"],
  ["quotient", "x / K"],
  ["remainder", "x % K"],
  ["remainder-above-0", "((x % K) + K) % K"],
  ["remainder-or-0", "(x % K) | 0"],
  ["divides", "x % K === 0 ? 1 : 2"],
  ["whole-first", "((x | 0) / K) | 0"],
  ["whole-remainder", "(x | 0) % K"],
  ["unsigned-first", "((x >>> 0) / K) | 0"],
  ["unsigned-remainder", "(x >>> 0) % K"],
  ["unsigned-floored", "Math.floor((x >>> 0) / K)"],
  ["quotient-and-remainder", "Math.floor(x / K) * 1000 + (x % K)"],
  ["twice", "(((x / K) | 0) / K) | 0"],
  ["back", "x - Math.floor(x / K) * K"],
  ["added-first", "((x + K) / K) | 0"],
  ["less-first", "((x - 1) / K) | 0"],
  ["multiplied", "x * K"],
  ["multiplied-or-0", "(x * K) | 0"],
  ["multiplied-unsigned", "(x * K) >>> 0"],
  ["imul", "Math.imul(x, K)"],
  ["and", "x & K"],
  ["or", "x | K"],
  ["exclusive-or", "x ^ K"],
  ["left", "x << K"],
  ["right", "x >> K"],
  ["right-unsigned", "x >>> K"],
  ["added", "x + K"],
  ["subtracted", "x - K"],
  ["subtracted-from", "K - x"],
  ["added-or-0", "(x + K) | 0"],
  ["less", "x < K ? 1 : 2"],
  ["greater", "x > K ? 1 : 2"],
  ["same", "x === K ? 1 : 2"],
  ["between", "x >= 0 && x < K ? x : -1"],
  ["clamped", "Math.min(Math.max(x, 0), K)"],
  ["distance", "Math.abs(x - K)"],
  ["hash", "(Math.imul(x, 31) + K) | 0"],
  ["power", "x ** 2 % K"],
  ["masked-quotient", "((x / K) | 0) & 7"],
  ["index", "digits[((x % K) + 16) & 15]"],
];
const constants = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "24", "25", "31", "32", "33", "60", "64", "97", "100", "125", "127", "128", "255", "256", "365", "400", "641", "1000", "1024",
  "3600", "4096", "10000", "32767", "32768", "65535", "65536", "86400", "1000000", "16777216", "16777217", "536870912", "1073741824", "2147483647", "2147483648", "4294967295", "4294967296", "-1", "-2", "-3", "-5",
  "-7", "-8", "-10", "-16", "-100", "-128", "-1000", "-65536", "-2147483648", "0", "0.5", "0.1", "2.5", "-0.5", "1e9", "1e21",
]; // prettier-ignore
// Lines before, the head of the loop and what `x` is there.
const sources: [name: string, before: string, head: string, read: string][] = [
  ["int32s", "const held = Int32Array.from(values);", "for (let i = 0; i < held.length; i++)", "held[i]"],
  ["uint32s", "const held = Uint32Array.from(values);", "for (let i = 0; i < held.length; i++)", "held[i]"],
  ["bytes", "const held = Uint8Array.from(values);", "for (let i = 0; i < held.length; i++)", "held[i]"],
  ["shorts", "const held = Int16Array.from(values);", "for (let i = 0; i < held.length; i++)", "held[i]"],
  ["doubles", "const held = Float64Array.from(values);", "for (let i = 0; i < held.length; i++)", "held[i]"],
  ["list", "const held = values;", "for (let i = 0; i < held.length; i++)", "held[i]"],
  ["whole-list", "const held = values.map(one => one | 0);", "for (const one of held)", "one"],
  ["counter", "", "for (let one = -40; one < 41; one++)", "one"],
  ["counter-down", "", "for (let one = 70; one >= -3; one--)", "one"],
  ["counter-from-0", "", "for (let one = 0; one < 300; one += 7)", "one"],
  ["large-counter", "", "for (let one = 2147483600; one < 2147483670; one += 3)", "one"],
  ["field", "const o = { x: 0 };", "for (const one of values)", "((o.x = one), o.x)"],
  ["parameter", "", "for (const one of values)", "work(one)"],
  ["whole-parameter", "", "for (const one of values)", "work(one | 0)"],
];
const total = forms.length * constants.length * sources.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const form = pick(forms);
  const constant = pick(constants);
  const source = pick(sources);
  const isTyped = cell % 4 === 1;
  const number = isTyped ? ": number" : "";
  const written = constant.startsWith("-") ? `(${constant})` : constant;
  const asked = form[1].replaceAll(/\bK\b/g, cell % 3 ? written : "constant");
  const isCall = source[0].endsWith("parameter");
  const work = [`function work(x${number})${isTyped ? ": any" : ""} {`, `  return ${asked};`, "}"];
  const lines = [
    'const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];',
    `const constant${number} = ${constant};`,
    `const values${isTyped ? ": number[]" : ""} = [0, 1, -1, 2, -2, 3, 5, 7, 9, 10, 15, 16, 31, 32, 63, 99, 100, 127, 128, -128, 255, 256, 1000, -1000, 32767, -32768, 65535, 65536, 123456789, -123456789, 2147483646, 2147483647, -2147483647, -2147483648];`,
    "values.push(constant - 1, constant, constant + 1, -constant, constant * 2, constant * 3 - 1, constant * 7 + 3);",
    ...(cell % 2
      ? ["values.push(2147483648, 4294967295, 4294967296, 9007199254740991, 0.5, -0.5, 1.5, -0, NaN, Infinity);"]
      : []),
    ...work,
    `function all()${isTyped ? ": string" : ""} {`,
    `  const out${isTyped ? ": any[]" : ""} = [];`,
    ...(source[1] ? ["  " + source[1]] : []),
    `  ${source[2]} {`,
    ...(isCall ? [`    out.push(${source[3]});`] : [`    const x${number} = ${source[3]};`, `    out.push(${asked});`]),
    "  }",
    '  return out.map(one => (Object.is(one, -0) ? "-0" : String(one))).join();',
    "}",
    "console.log(all());",
    "console.log(values.map(one => work(one)).join());",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${form[0]}--${constant.replace("-", "minus-")}--${source[0]}${isTyped ? ".ts" : ".mjs"}`,
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
