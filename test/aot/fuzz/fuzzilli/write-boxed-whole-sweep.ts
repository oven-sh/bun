// A whole number that came about as a fraction does goes into a list of whole numbers: the number, times where it comes from, times how the program learns that it is whole, times how it is stored, times how
// the list was made, times what is asked of the list. Each program holds one of each and is built alone.
//
//   bun write-boxed-whole-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<number>--<source>--<narrowing>--<store>--<list>--<question>.js
//   bun write-boxed-whole-sweep.ts count
//   bun write-boxed-whole-sweep.ts named <pattern> <folder> [most]
//
// A type says what a number is and never how it is held. `case 3` makes `x` a small whole number by type, while the value that came out of a list of fractions is still held the way fractions are. A list of
// small whole numbers is read on the understanding that each of its elements is held the way small whole numbers are, so a store that passes the value on as it came leaves an element that reads as
// another number.
import { mkdirSync, writeFileSync } from "fs";

// The number as it is written in the program, and as it stands in data.
const numbers: [string, string, string][] = [
  ["three", "3", "3"],
  ["zero", "0", "0"],
  ["minus-zero", "-0", "-0"],
  ["minus-one", "-1", "-1"],
  ["the-greatest-int32", "2147483647", "2147483647"],
];

// D is the number as it stands in data.
const sources: [string, string][] = [
  ["out-of-fractions-beside-a-text", 'const list = JSON.parse("[0.5,1,2,D]");\n  list.push("x");\n  return list[3];'],
  ["out-of-fractions", 'const list = JSON.parse("[0.5,1,2,D]");\n  return list[3];'],
  ["a-sum-of-fractions", 'const [a, b] = JSON.parse("[0.5,D]");\n  return a + b - 0.5;'],
  ["out-of-a-view-of-doubles", 'return new Float64Array(JSON.parse("[0.5,D]"))[1];'],
  ["a-number-of-a-text", "return Number(JSON.parse('\"D\"'));"],
  [
    "a-field-that-held-a-fraction",
    'const record = { v: 0.5 };\n  record.v = JSON.parse("[0.5,D]")[1];\n  return record.v;',
  ],
  ["rounded", 'return Math.round(JSON.parse("[0.5,D]")[1]);'],
];

// L is the number as it is written, BODY the store.
const narrowings: [string, string][] = [
  ["a-case", "switch (x) {\n    case L:\n      BODY\n      break;\n  }"],
  ["an-if", "if (x === L) {\n    BODY\n  }"],
  ["an-early-return", "if (x !== L) return to;\n  BODY"],
  ["a-case-of-true", "switch (true) {\n    case x === L:\n      BODY\n      break;\n  }"],
  ["not-narrowed", "BODY"],
  ["cut-and-compared", "if ((x | 0) === x) {\n    BODY\n  }"],
  ["asked-whether-whole", "if (Number.isInteger(x)) {\n    BODY\n  }"],
];

const stores: [string, string][] = [
  ["in-a-loop-over-the-length", "for (let i = 0; i < to.length; i++) to[i] = x;"],
  ["in-a-loop-to-four", "for (let i = 0; i < 4; i++) to[i] = x;"],
  ["in-a-while-loop", "let i = 0;\n      while (i < to.length) to[i++] = x;"],
  ["once", "to[0] = x;"],
  ["pushed-in-a-loop", "for (let i = 0; i < 4; i++) to.push(x);"],
  ["by-fill", "to.fill(x);"],
  ["by-splice", "to.splice(1, 2, x, x);"],
  ["by-unshift", "to.unshift(x);"],
  ["behind-the-end", "to[to.length] = x;"],
];

const lists: [string, string][] = [
  ["a-slice-of-a-written-list", "[9, 9, 9, 9].slice()"],
  ["a-written-list", "[9, 9, 9, 9]"],
  ["filled", "new Array(4).fill(9)"],
  ["out-of-data", 'JSON.parse("[9,9,9,9]")'],
  ["from-a-length", "Array.from({ length: 4 }, () => 9)"],
];

const questions: [string, string][] = [
  [
    "joined-and-searched",
    'console.log(filled.join() + " " + filled.indexOf(L) + " " + filled.includes(L) + " " + JSON.stringify(filled));',
  ],
  [
    "each-is-looked-at",
    'console.log(filled.map(each => typeof each + ":" + (each | 0) + ":" + Object.is(each, L) + ":" + 1 / each).join());',
  ],
];

const all = numbers.length * sources.length * narrowings.length * stores.length * lists.length * questions.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [list, made] = pick(lists);
  const [store, stored] = pick(stores);
  const [narrowing, narrowed] = pick(narrowings);
  const [source, comes] = pick(sources);
  const [number, written, inData] = pick(numbers);
  const [question, asked] = pick(questions);
  const text = [
    "function fill(to, x) {",
    `  ${narrowed.replace("BODY", stored).replaceAll("L", written)}`,
    "  return to;",
    "}",
    "function given() {",
    `  ${comes.replaceAll("D", inData)}`,
    "}",
    `const filled = fill(${made}, given());`,
    asked.replaceAll("L", written),
  ].join("\n");
  return { name: `${number}--${source}--${narrowing}--${store}--${list}--${question}.js`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
