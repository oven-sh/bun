// The least loops whose first turn is another: what is held before the first turn, times how the first turn is told, times what it does, times what the others do, times what is held then, times the list, times the loop.
//
//   bun write-first-turn-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<before>--<told>--<first>--<other>--<held>--<list>--<loop>.mjs, .cjs or .ts
//   bun write-first-turn-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `p` is what is held from turn to turn, `x` the element, `i` counts.
const befores: [name: string, text: string][] = [
  ["undefined", "undefined"],
  ["null", "null"],
  ["minus-one", "-1"],
  ["zero", "0"],
  ["fraction", "0.5"],
  ["not-a-number", "NaN"],
  ["infinite", "-Infinity"],
  ["text", "''"],
  ["list", "[]"],
  ["object", "{ v: 0 }"],
  ["first-element", "a[0]"],
  ["false", "false"],
  ["big", "0n"],
];
const tolds: [name: string, text: string][] = [
  ["counter", "i === 0"],
  ["counter-above", "!(i > 0)"],
  ["undefined", "p === undefined"],
  ["nothing", "p == null"],
  ["falsy", "!p"],
  ["below", "p < 0"],
  ["kind", "typeof p !== 'number'"],
  ["flag", "isFirst"],
  ["itself", "p !== p"],
  ["same", "p === x"],
  ["none", "false"],
  ["length", "l.length === 0"],
];
const firsts: [name: string, text: string][] = [
  ["nothing", ";"],
  ["held", "p = x;"],
  ["sum", "s += 100;"],
  ["continue", "CONTINUE"],
  ["pushed", "l.push(x);"],
  ["made", "o = { v: x };"],
  ["text", "t = 'f' + x;"],
  ["kind", "s = 's';"],
  ["called", "s += f(x);"],
  ["thrown", "try {\n  throw x;\n} catch (e) {\n  s += +e || 1;\n}"],
  ["list-element", "a[i] = 9;"],
];
const others: [name: string, text: string][] = [
  ["difference", "s += x - p;"],
  ["sum", "s += +x || 1;"],
  ["compared", "if (x > p) s++;"],
  ["text", "t += ',' + x;"],
  ["field", "s += o.v;"],
  ["pushed", "l.push(x === p);"],
  ["previous-element", "s += +a[i - 1] || 1;"],
  ["called", "s += f(p);"],
  ["greatest", "if (!(x <= p)) p = x;"],
  ["break", "if (i > 2) break;"],
];
const helds: [name: string, text: string][] = [
  ["element", "p = x;"],
  ["nothing", ";"],
  ["counter", "p = i;"],
  ["sum", "p = s;"],
  ["fraction", "p = x / 2;"],
  ["text", "p = 'p' + i;"],
  ["sometimes", "if (i & 1) p = x;"],
  ["object", "p = { v: x };"],
  ["undefined-again", "p = i === 2 ? undefined : x;"],
];
const lists: [name: string, text: string][] = [
  ["integers", "[3, 1, 2, 5, 4]"],
  ["fractions", "[3.5, 1, 2.25, 5, 4]"],
  ["texts", "['c', 'a', 'b', 'e', 'd']"],
  ["kinds", "[3, 'a', null, 2.5, undefined]"],
  ["hole", "[, 1, 2, , 4]"],
  ["words", "new Int32Array([3, 1, 2, 5, 4])"],
  ["doubles", "new Float64Array([3.5, 1, 2, 5, 4])"],
  ["empty", "[]"],
  ["one", "[7]"],
  ["objects", "[{ v: 1 }, { v: 2 }, { v: 3 }]"],
];
const loops: [name: string, text: string][] = [
  ["index", "for (let i = 0; i < a.length; i++) {\n  const x = a[i];\n  IN\n}"],
  ["given", "for (let i = 0; i < n; i++) {\n  const x = a[i];\n  IN\n}"],
  ["of", "let i = -1;\nfor (const x of a) {\n  i++;\n  IN\n}"],
  ["while", "let i = -1;\nwhile (++i < a.length) {\n  const x = a[i];\n  IN\n}"],
  ["each", "a.forEach((x, i) => {\n  IN\n});"],
  ["nested", "for (let j = 0; j < 2; j++)\n  for (let i = 0; i < a.length; i++) {\n    const x = a[i];\n    IN\n  }"],
  ["do", "let i = 0;\ndo {\n  const x = a[i];\n  IN\n} while (++i < n);"],
];
const total =
  befores.length * tolds.length * firsts.length * others.length * helds.length * lists.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 6_756_751;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const told = pick(tolds);
  const first = pick(firsts);
  const other = pick(others);
  const before = pick(befores);
  const held = pick(helds);
  const loop = pick(loops);
  const list = pick(lists);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isFunction = loop[0] === "each";
  const leave = (text: string) => text.replace("CONTINUE", loop[0] === "do" ? "s += 2;" : isFunction ? "return;" : "continue;").replace("break;", isFunction ? "return;" : "break;"); // prettier-ignore
  const block = (text: string) => (text === ";" ? "{}" : `{\n${indent(text, "  ")}\n}`);
  const usesFlag = told[0] === "flag";
  const turn = [`if (${told[1]}) ${block(leave(first[1]))} else ${block(leave(other[1]))}`, held[1] === ";" ? "" : held[1], usesFlag ? "isFirst = false;" : ""].filter(Boolean).join("\n"); // prettier-ignore
  const body = within(loop[1], "IN", turn);
  const has = (word: RegExp) => word.test(body);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(has(/\bf\(/) ? ["function f(v) {\n  return v === undefined ? 50 : +v || 2;\n}"] : []),
    'const show = v => (Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v, show).join() : typeof v === "object" && v ? "o" + show(v.v) : String(v));',
    "function run(a, n) {",
    "  let s = 0;",
    "  let t = '';",
    ...(has(/\bo\b/) ? ["  let o = { v: 0 };"] : []),
    "  const l = [];",
    ...(usesFlag ? ["  let isFirst = true;"] : []),
    `  let p = ${before[1]};`,
    indent(body, "  "),
    '  return [s, t, show(l), show(p)].join("/");',
    "}",
    "const out = [];",
    "for (const n of [1, 3, 6]) {",
    "  try {",
    `    out.push(run(${list[1]}, n));`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${before[0]}--${told[0]}--${first[0]}--${other[0]}--${held[0]}--${list[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
