// The least loops that write numbers as texts: the number, times the radix, times how it is written, times what is done with the text, times the loop.
//
//   bun write-number-text-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<number>--<radix>--<written>--<used>--<loop>.mjs, .cjs or .ts
//   bun write-number-text-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// X is the number, R the radix, Y the text.
const numbers: [name: string, text: string][] = [
  ["counter", "i"],
  ["negative", "-i"],
  ["half", "i / 2"],
  ["third", "i / 3"],
  ["large", "i * 1e9"],
  ["word", "i * 123456789 | 0"],
  ["unsigned", "i * 3123456789 >>> 0"],
  ["byte", "i * 37 & 255"],
  ["greatest", "2 ** 53 - i"],
  ["huge", "i * 1e300"],
  ["tiny", "i * 1e-7"],
  ["zero-sign", "i * -0"],
  ["not-a-number", "i > 2 ? NaN : i"],
  ["infinite", "i > 2 ? 1 / 0 : i"],
  ["element", "a[i & 7]"],
  ["fraction-element", "d[i & 7]"],
  ["byte-element", "b[i & 7]"],
  ["past", "a[i + 5]"],
  ["big", "BigInt(i) * 3n"],
  ["text", "'1' + i"],
  ["boxed", "new Number(i)"],
  ["kinds", "i & 1 ? i : i + 0.5"],
  ["truth", "i > 1"],
  ["argument", "f"],
];
const radixes: [name: string, text: string][] = [
  ["sixteen", "16"],
  ["two", "2"],
  ["most", "36"],
  ["ten", "10"],
  ["eight", "8"],
  ["three", "3"],
  ["none", ""],
  ["undefined", "undefined"],
  ["one", "1"],
  ["too-many", "37"],
  ["given", "r"],
  ["counter", "i + 2"],
  ["text", "'16'"],
  ["fraction", "16.9"],
];
const written: [name: string, text: string][] = [
  ["to-string", "(X).toString(R)"],
  ["padded", "(X).toString(R).padStart(2, '0')"],
  ["padded-four", "(X).toString(R).padStart(4)"],
  ["cut", "('0' + (X).toString(R)).slice(-2)"],
  ["cut-more", "('000' + (X).toString(R)).slice(-4)"],
  ["upper", "(X).toString(R).toUpperCase()"],
  ["length", "(X).toString(R).length"],
  ["first", "(X).toString(R)[0]"],
  ["code", "(X).toString(R).charCodeAt(0)"],
  ["back", "parseInt((X).toString(R), R || 10)"],
  ["applied", "Number.prototype.toString.call(X, R)"],
  ["made", "String(X)"],
  ["template", "`${X}`"],
  ["added", "(X) + ''"],
  ["in-front", "'#' + (X).toString(R)"],
  ["by-name", "(X)['toString'](R)"],
  ["compared", "(X).toString(R) === '10'"],
  ["fixed", "Number(X).toFixed(2)"],
  ["optional", "(X)?.toString(R)"],
  ["through-function", "write(X, R)"],
  ["split", "(X).toString(R).split('').reverse().join('')"],
];
const used: [name: string, text: string][] = [
  ["grown", "t += Y;"],
  ["grown-in-front", "t = Y + t;"],
  ["listed", "l.push(Y);"],
  ["key", "o[Y] = i;"],
  ["counted", "o[Y] = (o[Y] ?? 0) + 1;"],
  ["set", "m.add(Y);"],
  ["branch", "if (Y > '5') s++;\nelse s += 3;"],
  ["kept", "t = Y;"],
  ["sum", "s += Y.length ?? 1;"],
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
const total = numbers.length * radixes.length * written.length * used.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 317_521;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const number = pick(numbers);
  const radix = pick(radixes);
  const form = pick(written);
  const use = pick(used);
  const loop = pick(loops);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const text = form[1]
    .replaceAll("(X)", `(${number[1]})`)
    .replaceAll(/\bX\b/g, number[1])
    .replaceAll("R || 10", radix[1] ? `${radix[1]} || 10` : "10")
    .replaceAll(/, R\b/g, radix[1] ? `, ${radix[1]}` : "")
    .replaceAll(/\bR\b/g, radix[1]);
  const body = within(loop[1], "IN", use[1].replaceAll(/\bY\b/g, use[0] === "sum" ? `(${text})` : text));
  const has = (word: RegExp) => word.test(body);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(has(/\bwrite\(/) ? ["function write(x, r) {\n  return x.toString(r);\n}"] : []),
    "function run(n, r, f) {",
    ...(has(/\ba\[/) ? ["  const a = [3, 10, 255, 16, 4, 9, 70, 6];"] : []),
    ...(has(/\bd\[/) ? ["  const d = new Float64Array([3.5, 1, 255, 0.1, 4.25, 9, -7, 6]);"] : []),
    ...(has(/\bb\[/) ? ["  const b = new Uint8Array([3, 1, 255, 16, 4, 9, 70, 160]);"] : []),
    "  let s = 0;",
    "  let t = '';",
    ...(has(/\bl\.push/) ? ["  const l = [];"] : []),
    ...(has(/\bo\[/) ? ["  const o = {};"] : []),
    ...(has(/\bm\.add/) ? ["  const m = new Set();"] : []),
    indent(body, "  "),
    `  return [s, t${has(/\bl\.push/) ? ", l.join()" : ""}${has(/\bo\[/) ? ", JSON.stringify(o)" : ""}${has(/\bm\.add/) ? ", [...m].join()" : ""}].join("/");`,
    "}",
    "const out = [];",
    "for (const [n, r, f] of [[3, 16, 255], [6, 2, -10.5], [4, 10, 1e21]]) {",
    "  try {",
    "    out.push(run(n, r, f));",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${number[0]}--${radix[0]}--${form[0]}--${use[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
