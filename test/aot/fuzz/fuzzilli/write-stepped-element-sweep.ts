// Elements that are stepped in place: what the list holds, times the step, times the index, times the loop, times who reads, times what else happens to the list.
//
//   bun write-stepped-element-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<step>--<index>--<loop>--<read>--<other>.ts or .mjs
//   bun write-stepped-element-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number.
const lists: [name: string, text: string][] = [
  ["integers", "[1, 2, 3, 4]"],
  ["zeros", "new Array(4).fill(0)"],
  ["near-largest", "[2147483646, 2147483647, -2147483648, 0]"],
  ["past-int32", "[4294967295, 2147483648, 1, 2]"],
  ["doubles", "[0.5, 1.5, -0, 2]"],
  ["one-double", "[1, 2, 0.5, 4]"],
  ["not-a-number", "[1, NaN, 3, Infinity]"],
  ["texts", '["1", "b", "3", ""]'],
  ["mixed", '[1, "b", null, undefined]'],
  ["holes", "[1, , 3, 4]"],
  ["counted", "counted(n)"],
  ["safe", "[9007199254740991, 9007199254740992, 1, 0]"],
  ["negative-zeros", "[-0, -0, 0, 1]"],
  ["int32-list", "new Int32Array([1, 2147483647, -5, 0])"],
  ["uint8-list", "new Uint8Array([1, 255, 5, 0])"],
  ["clamped-list", "new Uint8ClampedArray([1, 255, 5, 0])"],
  ["uint32-list", "new Uint32Array([1, 4294967295, 5, 0])"],
  ["float32-list", "new Float32Array([1, 0.1, 5, 16777216])"],
  ["double-list", "new Float64Array([1, 0.5, 5, -0])"],
  ["truths", "[true, false, true, 1]"],
  ["short", "[1]"],
  ["frozen", "Object.freeze([1, 2, 3, 4])"],
  ["record", "{ 0: 1, 1: 2, 2: 3, 3: 4, length: 4 }"],
];
// `E` is the element, `i` counts.
const steps: [name: string, text: string][] = [
  ["increment", "E++;"],
  ["decrement", "--E;"],
  ["add-counter", "E += i;"],
  ["add-one", "E = E + 1;"],
  ["add-int32", "E = (E + 1) | 0;"],
  ["subtract", "E -= 3;"],
  ["times", "E *= 2;"],
  ["times-int32", "E = Math.imul(E, 3);"],
  ["divided", "E /= 2;"],
  ["remainder", "E %= 3;"],
  ["and", "E &= 255;"],
  ["xor", "E ^= i;"],
  ["shift", "E <<= 1;"],
  ["unsigned-shift", "E >>>= 1;"],
  ["negated", "E = -E;"],
  ["largest", "E = Math.max(E, i);"],
  ["floor", "E = Math.floor(E / 2);"],
  ["if-larger", "if (E > 1) E -= 1;\nelse E += 2;"],
  ["kept-old", "const old = E++;\nsum += old;"],
  ["of-neighbor", "E += list[0];"],
  ["swapped", "[list[0], E] = [E, list[0]];"],
  ["added-half", "E += 0.5;"],
  ["by-turns", "E += i === 2 ? 0.25 : 1;"],
  ["or", "E ||= 5;"],
  ["nullish", "E ??= 6;"],
  ["text", 'if (i === 3) E = "t";\nelse E++;'],
  ["product-sum", "E = E * 31 + i;"],
];
const indexes: [name: string, text: string][] = [
  ["counter", "i"],
  ["masked", "i & 3"],
  ["remainder", "i % 4"],
  ["constant", "1"],
  ["second-counter", "at"],
  ["behind", "i + 1"],
  ["before", "i - 1"],
  ["from-a-list", "where[i & 3]"],
  ["half", "i >> 1"],
  ["last", "list.length - 1"],
  ["beyond", "i + 4"],
  ["parsed", "Number(String(i & 3))"],
];
const loops: [name: string, text: string][] = [
  ["counted", "for (let i = 0; i < n; i++) {\n  STEP\n}"],
  ["nested", "for (let k = 0; k < 3; k++)\n  for (let i = 0; i < 4; i++) {\n    STEP\n  }"],
  ["down", "for (let i = n; i-- > 0; ) {\n  STEP\n}"],
  ["long", "for (let i = 0; i < 60; i++) {\n  STEP\n}"],
  ["while", "let i = 0;\nwhile (i < n && sum < 1e9) {\n  STEP\n  i++;\n}"],
  ["callback", "[0, 1, 2, 3].forEach(i => {\n  STEP\n});"],
  ["function", "const step = i => {\n  STEP\n};\nfor (let i = 0; i < n; i++) step(i);"],
  ["by-length", "for (let i = 0; i < list.length && i < 30; i++) {\n  STEP\n}"],
  ["tried", "for (let i = 0; i < n; i++) {\n  try {\n    STEP\n  } catch (error) {\n    sum += 1000;\n  }\n}"],
];
const reads: [name: string, text: string][] = [
  ["whole", ""],
  ["sum", "for (let k = 0; k < list.length; k++) sum += list[k];"],
  ["signs", "for (let k = 0; k < list.length; k++) sum += Object.is(list[k], -0) ? 100 : 0;"],
  ["integers", "for (let k = 0; k < list.length; k++) sum = (sum + list[k]) | 0;"],
];
const others: [name: string, text: string][] = [
  ["nothing", ""],
  ["push", "if (i === 2) list.push?.(7);"],
  ["write-double", "if (i === 2) list[0] = 0.5;"],
  ["write-text", 'if (i === 2) list[2] = "w";'],
  ["read-in-between", "sum += list[0];"],
  ["second-step", "list[0]++;"],
  ["shorter", "if (i === 2 && Array.isArray(list) && !Object.isFrozen(list)) list.length = 2;"],
];
const total = lists.length * steps.length * indexes.length * loops.length * reads.length * others.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const list = pick(lists);
  const step = pick(steps);
  const index = pick(indexes);
  const loop = pick(loops);
  const read = pick(reads);
  const other = pick(others);
  const isTyped = cell % 3 === 2;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  const stepped = [step[1].replaceAll(/\bE\b/g, () => `list[${index[1]}]`), ...(other[1] ? [other[1]] : []), ...(index[0] === "second-counter" ? ["at = (at + 1) & 3;"] : [])].join("\n"); // prettier-ignore
  const body = loop[1].replace("STEP", () => `{\n${indent(stepped, "  ")}\n}`);
  const typed = isTyped
    ? body.replaceAll("i => {", "(i: number) => {").replaceAll("catch (error)", "catch (error: any)")
    : body;
  const lines = [
    `const show = (value${type(": any")})${type(": string")} => (Object.is(value, -0) ? "-0" : String(value));`,
    ...(/counted/.test(list[1]) ? [`const counted = (n${type(": number")}) => {\n  const list${type(": any[]")} = [];\n  for (let i = 0; i < n + 2; i++) list.push(i);\n  return list;\n};`] : []),
    ...(/where/.test(index[1]) ? ["const where = [3, 0, 2, 1];"] : []),
    `const notes${type(": string[]")} = [];`,
    `function work(list${type(": any")}, n${type(": number")}) {`,
    `  let sum${type(": any")} = 0;`,
    ...(index[0] === "second-counter" ? ["  let at = 0;"] : []),
    indent(typed, "  "),
    ...(read[1] ? [indent(read[1], "  ")] : []),
    `  notes.push(Array.from(list, show).join() + ":" + show(sum));`,
    "}",
    "for (const n of [4, 0, 3]) {",
    "  try {",
    `    work(${list[1]}, n);`,
    "  } catch (error) {",
    `    notes.push((error${type(" as any")}).name);`,
    "  }",
    "}",
    'console.log(notes.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${list[0]}--${step[0]}--${index[0]}--${loop[0]}--${read[0]}--${other[0]}.${isTyped ? "ts" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
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
