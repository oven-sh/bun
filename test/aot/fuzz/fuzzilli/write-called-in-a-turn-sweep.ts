// A file holds one of a few functions somewhere and calls it, turn after turn, beside write-required-in-a-turn-sweep.ts: where the function is held, times who else names that place, times where it is stored, times
// the loop, times what the functions are. Each program holds one of each, is one file, and is built alone.
//
//   bun write-called-in-a-turn-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<held>--<named>--<stored>--<loop>--<functions>.cjs
//   bun write-called-in-a-turn-sweep.ts count
//   bun write-called-in-a-turn-sweep.ts named <pattern> <folder> [most]
//
// A variable holds what was stored in it last, and until something is stored a `var` holds undefined.
import { mkdirSync, writeFileSync } from "fs";

// What stands in front, how the place reads, and what stands at the very end of the file.
const helds: [string, string, string, string][] = [
  ["a-var", "var pick;", "pick", ""],
  ["a-let", "let pick;", "pick", ""],
  ["a-var-declared-at-the-end", "", "pick", "var pick;"],
  ["the-name-of-a-declared-function", 'function pick(turn) {\n  return "declared" + turn;\n}', "pick", ""],
  ["a-name-that-nothing-declares", "", "pick", ""],
  ["a-name-of-the-exports", "", "exports.name", ""],
  ["a-field-of-a-record", "const held = {};", "held.pick", ""],
  ["a-field-of-the-global-object", "", "globalThis.pick", ""],
];

// What stands at the top of the file, what stands in the turn behind the call, what stands behind the loop, and what is printed at the end. PLACE is how the place reads.
const nameds: [string, string, string, string, string][] = [
  ["by-nobody-else", "", "", "", ""],
  ["by-a-declared-function-below", "", "", "function peek() {\n  return PLACE;\n}", "typeof peek()"],
  ["by-a-declared-function-above", "function peek() {\n  return PLACE;\n}", "", "", "typeof peek()"],
  ["by-an-arrow-above", "const peek = () => PLACE;", "", "", "typeof peek()"],
  ["by-an-arrow-made-in-the-turn", "let peek;", "peek = () => PLACE;", "", "typeof peek()"],
  [
    "by-a-function-that-stores-there-and-is-never-called",
    "",
    "",
    "function clear() {\n  PLACE = undefined;\n}",
    "typeof clear",
  ],
  [
    "by-a-method-of-a-class-below",
    "",
    "",
    "class Peek {\n  static at() {\n    return PLACE;\n  }\n}",
    "typeof Peek.at()",
  ],
];

// What stands in front of the loop, in the turn in front of the call, and in the turn behind the call. FIRST and LAST are the functions.
const storeds: [string, string, string, string][] = [
  ["twice-in-the-turn", "", "PLACE = FIRST;\nPLACE = LAST;", ""],
  ["once-in-the-turn", "", "PLACE = LAST;", ""],
  ["one-of-two-in-the-turn", "", "PLACE = turn % 2 ? FIRST : LAST;", ""],
  ["in-the-turn-and-again-under-an-if", "", "PLACE = FIRST;\nif (turn) PLACE = LAST;", ""],
  ["one-in-the-first-turn-and-the-other-later", "", "if (!turn) PLACE = FIRST;\nelse PLACE = LAST;", ""],
  ["once-in-front-and-once-in-the-turn", "PLACE = FIRST;", "PLACE = LAST;", ""],
  ["twice-in-front", "PLACE = FIRST;\nPLACE = LAST;", "", ""],
  ["in-front-and-behind-the-call", "PLACE = FIRST;", "", "PLACE = LAST;"],
  ["by-a-function-called-in-the-turn", "function lay() {\n  PLACE = FIRST;\n  PLACE = LAST;\n}", "lay();", ""],
];

const turns = 'Number("3")';
// What stands in front of the loop, what opens it, what stands at the end of the turn, and what closes it.
const loops: [string, string, string, string, string][] = [
  ["for", "", `for (let turn = 0; turn < ${turns}; turn++) {`, "", "}"],
  ["while", "let turn = 0;", `while (turn < ${turns}) {`, "turn++;", "}"],
  ["do-while", "let turn = 0;", "do {", "turn++;", `} while (turn < ${turns});`],
  ["for-left-by-a-break-at-its-end", "let turn = 0;", "for (;;) {", `turn++;\nif (!(turn < ${turns})) break;`, "}"],
  ["for-of", "", "for (const turn of [0, 1, 2]) {", "", "}"],
  ["for-in-a-function", "function work() {", `  for (let turn = 0; turn < ${turns}; turn++) {`, "", "  }\n}\nwork();"],
];

// What stands at the top of the file, and the two functions.
const functions: [string, string, string, string][] = [
  ["arrows-written-there", "", 'turn => "first" + turn', 'turn => "second" + turn'],
  [
    "arrows-out-of-constants",
    'const first = turn => "first" + turn;\nconst second = turn => "second" + turn;',
    "first",
    "second",
  ],
  [
    "declared-functions",
    'function first(turn) {\n  return "first" + turn;\n}\nfunction second(turn) {\n  return "second" + turn;\n}',
    "first",
    "second",
  ],
];

const all = helds.length * nameds.length * storeds.length * loops.length * functions.length;

const indented = (text: string, by: string) => text.replaceAll("\n", "\n" + by);

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [stored, inFront, before, behind] = pick(storeds);
  const [named, atTheTop, inTheTurn, below, printed] = pick(nameds);
  const [held, declares, place, atTheEnd] = pick(helds);
  const [loop, inFrontOfTheLoop, opens, ends, closes] = pick(loops);
  const [kind, made, first, last] = pick(functions);
  const deeper = opens.startsWith("  ") ? "    " : "  ";
  const turn = [before, "total += PLACE(turn);", behind, inTheTurn, ends].filter(Boolean).join("\n");
  const text = [
    made,
    atTheTop,
    declares,
    'let total = "";',
    inFront,
    inFrontOfTheLoop,
    opens,
    deeper + indented(turn, deeper),
    closes,
    'console.log("SAID end " + total);',
    below,
    printed && `console.log("SAID peek " + ${printed});`,
    atTheEnd,
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("FIRST", () => first)
    .replaceAll("LAST", () => last)
    .replaceAll("PLACE", place);
  return { name: `${held}--${named}--${stored}--${loop}--${kind}.cjs`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(4, "0");
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
