// A variable of a file is stored and read, turn after turn, beside write-called-in-a-turn-sweep.ts: how the variable is declared, times who else names it, times what is stored, times in which order the turn stores and
// reads, times the loop. Each program holds one of each, is one file, and is built alone.
//
//   bun write-stored-in-a-turn-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<declared>--<named>--<stored>--<order>--<loop>.cjs
//   bun write-stored-in-a-turn-sweep.ts count
//   bun write-stored-in-a-turn-sweep.ts named <pattern> <folder> [most]
//
// Until something is stored a `var` or a `let` without a value holds undefined, in the first turn of a loop as anywhere else.
import { mkdirSync, writeFileSync } from "fs";

// What stands in front, and what stands at the very end of the file. NAMES are the variables.
const declareds: [string, string, string][] = [
  ["a-var", "var NAMES;", ""],
  ["a-var-declared-at-the-end", "", "var NAMES;"],
  ["a-let", "let NAMES;", ""],
];

// What stands at the top of the file, what stands at the end of the turn, what stands behind the loop, and what is printed at the end.
const nameds: [string, string, string, string, string][] = [
  ["by-nobody-else", "", "", "", ""],
  ["by-a-declared-function-below", "", "", "function peek() {\n  return held;\n}", "typeof peek()"],
  ["by-an-arrow-made-in-the-turn", "let peek;", "peek = () => held;", "", "typeof peek()"],
  [
    "by-a-function-that-stores-there-and-is-never-called",
    "",
    "",
    "function clear() {\n  held = undefined;\n}",
    "typeof clear",
  ],
];

// What is stored, and how it is read. IT is the variable.
const storeds: [string, string, string][] = [
  ["an-integer", "turn + 1", "IT"],
  ["a-fraction", "turn + 0.5", "IT"],
  ["a-text", '"t" + turn', "IT"],
  ["a-truth-value", "turn % 2 === 0", "IT"],
  ["a-record-of-one-layout", "{ n: turn }", "IT.n"],
  ["a-list", "[turn, turn + 1]", "IT[1]"],
  ["a-function-that-captures-nothing", 'given => "f" + given', "IT(1)"],
  ["a-function-that-captures-the-turn", '() => "g" + turn', "IT()"],
];

// What stands in front of the loop, the turn, and what stands behind the loop. STORE stores in `held`, READ reads it, SAFELY reads it where it may hold nothing yet; the same with OTHER for a second variable.
const orders: [string, string, string, string][] = [
  ["stored-and-then-read", "", "STORE\ntotal += READ;", ""],
  ["stored-and-then-read-twice", "", "STORE\ntotal += READ;\ntotal += READ;", ""],
  ["read-under-an-if-ahead-of-the-store", "", "if (turn) total += READ;\nSTORE", ""],
  ["read-ahead-of-the-store", "", "total += SAFELY;\nSTORE", ""],
  ["stored-in-the-first-turn-alone", "", "if (!turn) STORE\ntotal += READ;", ""],
  ["stored-from-the-second-turn-on", "", "if (turn) STORE\ntotal += SAFELY;", ""],
  ["stored-in-front-too-and-read-ahead-of-the-store", "{\n  const turn = 9;\n  STORE\n}", "total += READ;\nSTORE", ""],
  ["stored-read-and-cleared", "", "STORE\ntotal += READ;\nheld = undefined;", ""],
  [
    "left-ahead-of-the-store-and-read-behind-the-loop",
    "",
    "if (turn === 2) break;\nSTORE\ntotal += READ;",
    "total += SAFELY;",
  ],
  ["beside-a-second-variable-that-is-read-first", "", "total += OTHERSAFELY;\nOTHERSTORE\nSTORE\ntotal += READ;", ""],
  ["two-stores-with-a-read-between", "", "STORE\ntotal += READ;\nSTORE\ntotal += READ;", ""],
  [
    "a-turn-cut-short-between-the-store-and-the-read",
    "",
    "STORE\nif (turn === 1) {\n  turn++;\n  continue;\n}\ntotal += READ;",
    "",
  ],
  [
    "a-turn-cut-short-ahead-of-the-store",
    "",
    "if (turn === 1) {\n  turn++;\n  continue;\n}\nSTORE\ntotal += READ;",
    "total += SAFELY;",
  ],
  ["left-between-the-store-and-the-read", "", "STORE\nif (turn === 1) break;\ntotal += READ;", "total += SAFELY;"],
  [
    "read-in-one-arm-and-stored-in-both",
    "",
    "if (turn % 2) {\n  total += SAFELY;\n  STORE\n} else {\n  STORE\n}\ntotal += READ;",
    "",
  ],
  ["stored-in-a-try-and-read-behind-it", "", "try {\n  STORE\n} catch {}\ntotal += READ;", ""],
  [
    "stored-behind-a-throw-that-is-caught",
    "",
    "try {\n  if (!turn) null.nothing;\n  STORE\n} catch {}\ntotal += SAFELY;",
    "",
  ],
  [
    "stored-in-an-inner-loop-that-may-take-no-turn",
    "",
    "for (let n = 0; n < turn; n++) {\n  STORE\n}\ntotal += SAFELY;",
    "",
  ],
  ["read-in-an-inner-loop-behind-the-store", "", "STORE\nfor (let n = 0; n < 2; n++) {\n  total += READ;\n}", ""],
  ["stored-and-read-in-an-inner-loop", "", "for (let n = 0; n < 2; n++) {\n  STORE\n  total += READ;\n}", ""],
];

const turns = 'Number("3")';
// What stands in front of the loop, what opens it, what stands at the end of the turn, and what closes it.
const loops: [string, string, string, string, string][] = [
  ["do-while", "let turn = 0;", "do {", "turn++;", `} while (turn < ${turns});`],
  ["for-left-by-a-break-at-its-end", "let turn = 0;", "for (;;) {", `turn++;\nif (!(turn < ${turns})) break;`, "}"],
  ["for", "", `for (let turn = 0; turn < ${turns}; turn++) {`, "", "}"],
  ["while", "let turn = 0;", `while (turn < ${turns}) {`, "turn++;", "}"],
  [
    "do-while-in-a-function-called-twice",
    "function work() {\n  let turn = 0;",
    "  do {",
    "turn++;",
    `  } while (turn < ${turns});\n}\nwork();\nwork();`,
  ],
  // The condition of the loop stores too: ahead of every turn, or behind it.
  ["while-whose-condition-stores", "let turn = 0;", `while (((held = VALUE), turn < ${turns})) {`, "turn++;", "}"],
  [
    "do-while-whose-condition-stores",
    "let turn = 0;",
    "do {",
    "turn++;",
    `} while (((held = VALUE), turn < ${turns}));`,
  ],
  ["for-whose-condition-stores", "", `for (let turn = 0; (held = VALUE), turn < ${turns}; turn++) {`, "", "}"],
];

const all = declareds.length * nameds.length * storeds.length * orders.length * loops.length;

const indented = (text: string, by: string) => text.replaceAll("\n", "\n" + by);

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [order, inFront, does, behindTheLoop] = pick(orders);
  const [stored, value, reads] = pick(storeds);
  const [named, atTheTop, inTheTurn, below, printed] = pick(nameds);
  const [declared, declares, atTheEnd] = pick(declareds);
  const [loop, inFrontOfTheLoop, opens, ends, closes] = pick(loops);
  const names = does.includes("OTHER") ? "held, other" : "held";
  const deeper = opens.startsWith("  ") ? "    " : "  ";
  const inFunction = opens.startsWith("  ");
  const read = (it: string) => `${reads.replaceAll("IT", it)} + ";"`;
  const safely = (it: string) => `(${it} === undefined ? "none" : ${reads.replaceAll("IT", it)}) + ";"`;
  const filled = (text: string) =>
    text
      .replaceAll("OTHERSAFELY", () => safely("other"))
      .replaceAll("OTHERSTORE", () => `other = ${value};`)
      .replaceAll("SAFELY", () => safely("held"))
      .replaceAll("STORE", () => `held = ${value};`)
      .replaceAll("READ", () => read("held"));
  const turn = [filled(does), inTheTurn, ends].filter(Boolean).join("\n");
  // What reads the turn behind the loop stands where the turn is still in reach.
  const behind = filled(behindTheLoop);
  const closed = behind && inFunction ? closes.replace("\n}\n", `\n  ${behind}\n}\n`) : closes;
  const text = [
    atTheTop,
    declares.replace("NAMES", names),
    'let total = "";',
    filled(inFront),
    inFrontOfTheLoop,
    opens,
    deeper + indented(turn, deeper),
    closed,
    !inFunction && behind,
    'console.log("SAID end " + total);',
    below,
    printed && `console.log("SAID peek " + ${printed});`,
    atTheEnd.replace("NAMES", names),
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("VALUE", () => value);
  return { name: `${declared}--${named}--${stored}--${order}--${loop}.cjs`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laidOut++;
  }
  console.log(laidOut);
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
