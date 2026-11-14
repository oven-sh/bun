// Comparisons as values and as conditions: the left side, times the operator, times the right side, times where the answer goes, times which values come, times where they come from.
//
//   bun write-comparison-value-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<left>--<operator>--<right>--<place>--<values>--<source>.mjs or .ts
//   bun write-comparison-value-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `x` and `y` are what comes in.
const sides: [name: string, text: string][] = [
  ["itself", "x"],
  ["other", "y"],
  ["plus", "+x"],
  ["minus", "-x"],
  ["integer", "(x | 0)"],
  ["unsigned", "(x >>> 0)"],
  ["times", "x * 1"],
  ["sum", "(x + y)"],
  ["sum-of-one", "(x + 1)"],
  ["difference", "(x - y)"],
  ["number", "Number(x)"],
  ["text", "String(x)"],
  ["or", "(x ?? 0)"],
  ["field", "x?.length"],
  ["truth", "!!x"],
  ["kind", "typeof x"],
  ["floor", "Math.floor(x)"],
  ["largest", "Math.max(x, y)"],
  ["kept", "kept"],
  ["zero", "0"],
  ["one", "1"],
  ["not-a-number", "NaN"],
  ["nothing", "undefined"],
  ["null", "null"],
  ["empty-text", '""'],
  ["constant-kind", '"number"'],
  ["negative-zero", "-0"],
  ["large", "2147483648"],
];
const operators: [name: string, text: string][] = [
  ["same", "==="],
  ["not-same", "!=="],
  ["equal", "=="],
  ["not-equal", "!="],
  ["less", "<"],
  ["at-most", "<="],
  ["greater", ">"],
  ["at-least", ">="],
];
// `C` is the comparison; `out` takes an answer.
const places: [name: string, text: string][] = [
  ["value", "out.push(C);"],
  ["variable", "const answer = C;\nout.push(answer);"],
  ["branch", "if (C) out.push(1);\nelse out.push(0);"],
  ["negated", "out.push(!(C));"],
  ["negated-branch", "if (!(C)) out.push(1);\nelse out.push(0);"],
  ["chosen", 'out.push(C ? "a" : "b");'],
  ["both", "const answer = C;\nif (answer) out.push(1);\nout.push(answer);"],
  ["and", "out.push(C && x !== 5);"],
  ["or", "if (C || y === 7) out.push(1);"],
  ["counted", "count += C ? 1 : 0;"],
  ["number", "count += Number(C);"],
  ["field", "const holder = { answer: C };\nout.push(holder.answer);"],
  ["returned", "const ask = () => C;\nout.push(ask());"],
  ["passed", "out.push(pass(C));"],
  ["twice", "out.push(C);\nout.push(C);"],
  ["loop", "let turns = 0;\nwhile (C && turns < 2) turns++;\nout.push(turns);"],
  ["switch", "switch (C) {\n  case true:\n    out.push(1);\n    break;\n  default:\n    out.push(0);\n}"],
  ["bits", "out.push(Number(C) | 0);"],
];
// What comes in, in turn.
const inputs: [name: string, text: string][] = [
  ["all", '[undefined, null, NaN, 0, -0, 1, 0.5, "1", "", "a", true, false]'],
  ["numbers", "[1, 2, 0, -1, NaN, 0.5, -0, 2147483648]"],
  ["integers-then-nothing", "[1, 2, 3, undefined]"],
  ["integers-then-not-a-number", "[1, 2, 0, NaN]"],
  ["doubles", "[0.5, 1.5, NaN, -0, Infinity]"],
  ["texts", '["1", "", "a", "10", "1"]'],
  ["nothing", "[undefined, null, undefined]"],
  ["truths", "[true, false, 1, 0]"],
  ["objects", "[[], [1], [1, 2], { length: 1 }, 1]"],
  ["parsed", 'JSON.parse("[1,0.5,null,\\"1\\",0]")'],
  ["sums", "[1, 2].map(k => k + undefined).concat(3)"],
  ["large", "[2147483647, 2147483648, 4294967295, 4294967296, 9007199254740992]"],
];
const sources: [name: string, text: string][] = [
  ["parameter", "for (const x of list) ask(x, 1);"],
  ["two", "for (const x of list) for (const y of list) ask(x, y);"],
  ["missing", "for (const x of list) ask(x);\nask();"],
  ["itself", "for (const x of list) ask(x, x);"],
  ["index", "for (let i = 0; i <= list.length; i++) ask(list[i], i);"],
  ["sum", "for (let i = 0; i < list.length; i++) ask(list[i] + list[i + 1], list[i]);"],
  ["field", "for (const v of list) {\n  const holder = { v };\n  ask(holder.v, holder.w);\n}"],
  [
    "map",
    "const map = new Map(list.map((v, i) => [i, v]));\nfor (let i = 0; i <= list.length; i++) ask(map.get(i), i);",
  ],
];
const total = sides.length * operators.length * sides.length * places.length * inputs.length * sources.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const left = pick(sides);
  const operator = pick(operators);
  const right = pick(sides);
  const place = pick(places);
  const input = pick(inputs);
  const source = pick(sources);
  const isTyped = cell % 4 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  // The typed programs compare what TypeScript would not.
  const as = (text: string) => (isTyped ? `(${text} as any)` : text);
  const comparison = `${as(left[1])} ${operator[1]} ${as(right[1])}`;
  const isKept = /\bkept\b/.test(comparison);
  const lines = [
    `const out${type(": any[]")} = [];`,
    `const pass = (value${type(": any")})${type(": any")} => value;`,
    "let count = 0;",
    ...(isKept ? [`let kept${type(": any")} = 0;`] : []),
    `function ask(x${type("?: any")}, y${type("?: any")}) {`,
    indent(place[1].replaceAll(/\bC\b/g, () => `(${comparison})`), "  "),
    ...(isKept ? ["  kept = x;"] : []),
    "}",
    `const list${type(": any[]")} = ${isTyped ? input[1].replace("k => k + undefined", "(k: any) => k + (undefined as any)").replace(".concat(3)", ".concat(3 as any)") : input[1]};`,
    "try {",
    indent(isTyped ? source[1].replace("new Map(", "new Map<any, any>(").replace("const holder =", "const holder: any =") : source[1], "  "),
    "} catch (error) {",
    `  out.push((error${type(" as any")}).name);`,
    "}",
    'console.log(out.join().slice(0, 900), count);',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${left[0]}--${operator[0]}--${right[0]}--${place[0]}--${input[0]}--${source[0]}.${isTyped ? "ts" : "mjs"}`,
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
