// An operator takes a number and a member that the program never stores, or stores late, beside write-variable-that-a-loop-uses-sweep.ts: the operator, times the side the member stands on, times the other operand,
// times who holds the member, times the loop, times the calls, times where the function stands. Each program holds one of each and is built alone.
//
//   bun write-member-that-nobody-stores-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<operator>--<side>--<other>--<holder>--<loop>--<calls>--<where>.cjs or .mjs
//   bun write-member-that-nobody-stores-sweep.ts count
//   bun write-member-that-nobody-stores-sweep.ts named <pattern> <folder> [most]
//
// A member that nobody has stored reads as undefined, and an operator makes NaN, 0 or false of it. Nothing throws.
import { mkdirSync, writeFileSync } from "fs";
import { printThroughBranch } from "./print-through-branch.ts";

const operators: [string, string][] = [
  ["remainder", "%"],
  ["quotient", "/"],
  ["product", "*"],
  ["difference", "-"],
  ["sum", "+"],
  ["power", "**"],
  ["or-of-bits", "|"],
  ["and-of-bits", "&"],
  ["xor-of-bits", "^"],
  ["shifted-left", "<<"],
  ["shifted-right", ">>"],
  ["shifted-right-unsigned", ">>>"],
  ["less-than", "<"],
  ["at-most", "<="],
  ["greater-than", ">"],
  ["loosely-equal", "=="],
  ["strictly-equal", "==="],
  ["strictly-unequal", "!=="],
];

const sides = ["the-member-on-the-right", "the-member-on-the-left"];

const others: [string, string][] = [
  ["a-computed-whole-number", "(turn * 7 + 3)"],
  ["the-counter", "turn"],
  ["a-fraction", "(turn * 0.5)"],
  ["the-sum-so-far", "total"],
  ["a-written-number", "5"],
];

// The extension, what stands at the top of the file, the member, what stands between the calls, what the calls hand over beside the count, and the other files.
const holders: [string, string, string, string, string, string, string][] = [
  ["stored-only-by-a-function-that-nobody-calls", "cjs", 'const tool = require("./tool.cjs");', "tool.held", "", "", "// @filename: ./tool.cjs\nexports.lay = value => {\n  exports.held = value;\n};"], // prettier-ignore
  ["a-name-that-nobody-writes", "cjs", 'const tool = require("./tool.cjs");', "tool.held", "", "", "// @filename: ./tool.cjs\nexports.other = 1;"], // prettier-ignore
  ["stored-at-the-top", "cjs", 'const tool = require("./tool.cjs");', "tool.held", "", "", '// @filename: ./tool.cjs\nexports.held = Number("7");'], // prettier-ignore
  ["stored-behind-the-first-call", "cjs", 'const tool = require("./tool.cjs");', "tool.held", 'tool.lay(Number("7"));', "", "// @filename: ./tool.cjs\nexports.lay = value => {\n  exports.held = value;\n};"], // prettier-ignore
  ["an-es-file-imports-the-commonjs-file", "mjs", 'import tool from "./tool.cjs";', "tool.held", "", "", "// @filename: ./tool.cjs\nexports.lay = value => {\n  exports.held = value;\n};"], // prettier-ignore
  ["a-let-that-an-es-file-exports-and-never-stores", "mjs", 'import * as tool from "./tool.mjs";', "tool.held", "", "", "// @filename: ./tool.mjs\nexport let held;\nexport function lay(value) {\n  held = value;\n}"], // prettier-ignore
  [
    "an-object-of-the-own-file",
    "cjs",
    "const tool = {\n  lay(value) {\n    this.held = value;\n  },\n};",
    "tool.held",
    "",
    "",
    "",
  ],
  ["an-object-handed-in", "cjs", "const options = {};", "tool.held", "", "options", ""],
  ["a-static-field-of-a-class-of-another-file", "cjs", 'const tool = require("./tool.cjs");', "tool.Box.held", "", "", "// @filename: ./tool.cjs\nexports.Box = class Box {\n  static held;\n};"], // prettier-ignore
];

// TURN is what a turn does. `most` is the count that the call hands over.
const loops: [string, string][] = [
  ["for-up-to-a-parameter", "for (let turn = 0; turn < most; turn++) {\n  TURN\n}"],
  ["while", "let turn = 0;\nwhile (turn < most) {\n  TURN\n  turn++;\n}"],
  ["do-while", "let turn = 0;\nif (most > 0)\n  do {\n    TURN\n    turn++;\n  } while (turn < most);"],
  ["for-up-to-a-written-number", "for (let turn = 0; turn < 3; turn++) {\n  TURN\n}"],
  ["no-loop", "const turn = most;\nTURN"],
  ["the-inner-of-two", "for (let round = 0; round < most; round++) {\n  for (let turn = 0; turn < most; turn++) {\n    TURN\n  }\n}"], // prettier-ignore
  ["for-of-a-list", "for (const turn of Array.from({ length: most }, (_, at) => at)) {\n  TURN\n}"],
];

const calls: [string, string[]][] = [
  ["no-turn-at-first", ['Number("0")', 'Number("3")']],
  ["turns-at-first", ['Number("2")', 'Number("3")']],
  ["one-call", ['Number("3")']],
];

const wheres = ["in-a-function", "in-a-method", "in-an-arrow", "in-a-function-in-a-function"];

const all = operators.length * sides.length * others.length * holders.length * loops.length * calls.length * wheres.length; // prettier-ignore

const indented = (text: string, by = "  ") => by + text.replaceAll("\n", "\n" + by);
const joined = (...parts: string[]) => parts.filter(Boolean).join("\n");

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [operator, sign] = pick(operators);
  const [call, counts] = pick(calls);
  const [loop, walks] = pick(loops);
  const [holder, extension, top, member, between, handed, files] = pick(holders);
  const [other, operand] = pick(others);
  const side = pick(sides);
  const where = pick(wheres);
  const taken = side === "the-member-on-the-right" ? `${operand} ${sign} ${member}` : `${member} ${sign} ${operand}`;
  const body = joined(
    "let total = 0;",
    walks.replace(/^( *)TURN$/m, (_, by) => `${by}total = total * 3 + (${taken});`),
    "return total;",
  );
  const takes = handed ? "(most, tool)" : where === "in-an-arrow" ? "most" : "(most)";
  const work =
    where === "in-a-method"
      ? joined("class Worker {", indented(joined(`static work${takes} {`, indented(body), "}")), "}")
      : where === "in-an-arrow"
        ? joined(`const work = ${takes} => {`, indented(body), "};")
        : joined(`function work${takes} {`, indented(body), "}");
  const called = where === "in-a-method" ? "Worker.work" : "work";
  const said = counts.map((count, which) => `const said${which} = ${called}(${count}${handed ? ", " + handed : ""});`);
  const shown = handed ? member.replace(/^tool/, handed) : member;
  const ends = `console.log("SAID " + ${counts.map((_, which) => "said" + which).join(' + " " + ')} + " " + typeof ${shown});`;
  const imports = top.startsWith("import ") ? top : "";
  const inside = joined(imports ? "" : top, work, said[0], between, said[1] ?? "", ends);
  const file =
    where === "in-a-function-in-a-function"
      ? joined(imports, "(function whole() {", indented(inside), "})();")
      : joined(imports, inside);
  return {
    name: `${operator}--${side}--${other}--${holder}--${loop}--${call}--${where}.${extension}`,
    text: joined(file, files) + "\n",
  };
}

const pad = (at: number) => String(at).padStart(6, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
    laidOut++;
  }
  console.log(laidOut);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
  }
  console.log(Math.min(count, all));
}
