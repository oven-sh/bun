// Everyday programs of a dozen lines: a function walks a list of numbers and raises each of them to a least value. The kind of loop, times the kind of loop inside it, times what the function makes in front of
// the loop, times where the list comes from, times what the body does, times the kind of file. Each program holds one of each.
//
// The first question to each is whether it can be built at all, the second whether it prints what `bun <file>` prints.

// HEAD opens the loop and gives `i`, the place in the list. ROWS is how the list is named there.
const loops: [string, string, string][] = [
  ["counted-up", "for (let i = 0; i < ROWS.length; i++) {", "}"],
  ["counted-down-from-its-length", "for (let i = ROWS.length - 1; i >= 0; i--) {", "}"],
  ["counted-down-from-a-count", "for (let i = count - 1; i >= 0; i--) {", "}"],
  ["over-its-places", "for (const i of ROWS.keys()) {", "}"],
  ["over-its-keys", "for (const key in ROWS) {\n  const i = Number(key);", "}"],
  ["while", "let i = -1;\nwhile (++i < ROWS.length) {", "}"],
  ["do-while", "let i = 0;\ndo {", "} while (++i < ROWS.length);"],
  ["for-each", "ROWS.forEach((eachANY, iNUMBER) => {", "});"],
];

// BODY raises ROWS[i] by one or more, so each of these ends.
const inners: [string, string][] = [
  ["none", "if (ROWS[i] < least) {\n  BODY\n}"],
  ["do-while", "do {\n  BODY\n} while (ROWS[i] < least);"],
  ["do-while-false", "do {\n  BODY\n} while (false);"],
  ["while", "while (ROWS[i] < least) {\n  BODY\n}"],
  ["for-without-a-counter", "for (; ROWS[i] < least; ) {\n  BODY\n}"],
  ["counted", "for (let turn = 0; turn < 2; turn++) {\n  BODY\n}"],
  ["over-a-written-list", "for (const turn of [1, 2]) {\n  BODY\n}"],
];

// What is made, and what is done with it behind the loop.
const fronts: [string, string, string][] = [
  ["nothing", "", "const front = 0;"],
  ["an-empty-list", "const frontLIST = [];", "front.push(ROWS.length);"],
  ["a-list-of-a-length", "const frontLIST = new Array(3);", "front.push(ROWS.length);"],
  ["a-list-with-a-value", "const frontLIST = [least];", "front.push(ROWS.length);"],
  ["a-written-list", "const frontLIST = [1];", "front.push(ROWS.length);"],
  ["a-record-with-a-value", "const frontANY = { n: least };", "front.n += ROWS.length;"],
  ["an-empty-record", "const frontANY = {};", "front.n = ROWS.length;"],
  ["a-map", "const front = new Map();", 'front.set("n", ROWS.length);'],
  ["a-set", "const front = new Set();", "front.add(ROWS.length);"],
];

// How the list is named in the function, what stands in front of the function, the function's head, and the call. MADE is the list.
const sources: [string, string, string, string, string][] = [
  [
    "parsed-and-handed-in",
    "rows",
    'const rowsLIST = JSON.parse("[0,5,2]");',
    "function work(rowsLIST, leastNUMBER, countNUMBER) {",
    "work(rows, 3, rows.length)",
  ],
  [
    "written-and-handed-in",
    "rows",
    "const rowsLIST = [0, 5, 2];",
    "function work(rowsLIST, leastNUMBER, countNUMBER) {",
    "work(rows, 3, rows.length)",
  ],
  [
    "captured",
    "rows",
    'const rowsLIST = JSON.parse("[0,5,2]");',
    "function work(leastNUMBER, countNUMBER) {",
    "work(3, rows.length)",
  ],
  ["a-field-of-a-record", "holder.rows", 'const rowsLIST = JSON.parse("[0,5,2]");', "function work(holderHOLDER, leastNUMBER, countNUMBER) {", "work({ rows }, 3, rows.length)"], // prettier-ignore
  ["a-field-of-this", "this.rows", 'const rowsLIST = JSON.parse("[0,5,2]");', "class Shelf {\n  rowsLIST;\n  constructor(rowsLIST) {\n    this.rows = rows;\n  }\n  work(leastNUMBER, countNUMBER) {", "new Shelf(rows).work(3, rows.length)"], // prettier-ignore
  ["out-of-the-arguments", "rows", 'const given = process.argv.slice(2);\nconst rowsLIST = (given.length ? given : ["0", "5", "2"]).map(Number);', "function work(rowsLIST, leastNUMBER, countNUMBER) {", "work(rows, 3, rows.length)"], // prettier-ignore
];

// What stands in the function in front of everything, and the body.
const bodies: [string, string, string][] = [
  ["stored-back", "", "ROWS[i] = ROWS[i] + 1;"],
  ["added-to", "", "ROWS[i] += 1;"],
  ["stepped", "", "ROWS[i]++;"],
  ["stored-back-and-pushed", "const keptLIST = [];", "ROWS[i] = ROWS[i] + 1;\nkept.push(ROWS[i]);"],
  [
    "by-a-closure-that-writes-a-variable",
    "let calls = 0;\nconst step = () => {\n  calls++;\n  return 1;\n};",
    "ROWS[i] = ROWS[i] + step();",
  ],
  ["by-a-counter-out-of-a-table", 'function make() {\n  let made = 0;\n  return () => ++made;\n}\nconst tableANY = { make, size: 3 };\nconst step = table[JSON.parse(\'"make"\')]();', "ROWS[i] = ROWS[i] + step();"], // prettier-ignore
  [
    "by-a-table-under-a-reckoned-key",
    "const tableANY = { even: 1, odd: 2 };",
    'ROWS[i] = ROWS[i] + table[ROWS[i] % 2 ? "odd" : "even"];',
  ],
  [
    "in-a-try",
    "let caught = 0;",
    'try {\n  ROWS[i] = ROWS[i] + 1;\n  if (ROWS[i] === 2) throw new Error("two");\n} catch {\n  caught++;\n}',
  ],
  [
    "in-a-switch",
    "",
    "switch (ROWS[i] % 3) {\n  case 0:\n    ROWS[i] += 1;\n    break;\n  case 1:\n    ROWS[i] += 2;\n    break;\n  default:\n    ROWS[i] += 1;\n}",
  ],
  [
    "beside-calls-of-a-map-and-a-set",
    "const seen = new Map();\nconst marks = new Set();",
    "seen.set(i, ROWS[i]);\nmarks.add(ROWS[i]);\nROWS[i] = (seen.get(i) ?? 0) + 1;",
  ],
  [
    "by-members-that-are-closures",
    "const workers = [0, 1].map(() => {\n  let done = 0;\n  return { step: () => ++done };\n});",
    "ROWS[i] = ROWS[i] + workers[i % 2].step();",
  ],
  ["through-a-local", "", "const was = ROWS[i];\nROWS[i] = was + 1;"],
  ["this-place-and-the-next", "", "ROWS[i] = ROWS[i] + 1;\nif (i + 1 < ROWS.length) ROWS[i + 1] = ROWS[i];"],
  ["a-fraction-stored", "", "ROWS[i] = ROWS[i] + 0.5;"],
  ["the-one-before-read", "", "const before = ROWS[i - 1] ?? 0;\nROWS[i] = ROWS[i] + 1 + (before > 100 ? 1 : 0);"],
  ["summed-into-an-integer", "let sum = 0;", "sum = (sum + ROWS[i]) | 0;\nROWS[i] += 1;"],
  ["under-a-label", "", "skip: {\n  if (ROWS[i] > 100) break skip;\n  ROWS[i] += 1;\n}"],
  ["a-text-built", 'let text = "";', "text += ROWS[i];\nROWS[i] += 1;"],
];

const files = ["js", "ts", "ts-with-any"] as const;

export const everydayProgramCount =
  loops.length * inners.length * fronts.length * sources.length * bodies.length * files.length;

const indented = (text: string, by: string) => text.replaceAll("\n", "\n" + by);

export function everydayProgram(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [inner, inside] = pick(inners);
  const [front, makes, uses] = pick(fronts);
  const [source, rows, atTheTop, head, call] = pick(sources);
  const [body, inFront, does] = pick(bodies);
  const [loop, opens, closes] = pick(loops);
  const file = pick(files);
  const isMethod = source === "a-field-of-this";
  const by = isMethod ? "    " : "  ";
  // `this` is another one in a function that is no arrow, and forEach takes an arrow here.
  const text = [
    "const shown = (valueANY) => JSON.stringify(value instanceof Map || value instanceof Set ? [...value] : value);",
    atTheTop,
    head,
    by + indented([inFront, makes, opens].filter(Boolean).join("\n"), by),
    by +
      "  " +
      indented(
        inside.replace("BODY", () => indented(does, "  ")),
        by + "  ",
      ),
    by + indented([closes, uses, "return shown(front);"].join("\n"), by),
    isMethod ? "  }\n}" : "}",
    `console.log("SAID " + ${call} + " " + rows.join());`,
  ]
    .join("\n")
    .replaceAll("ROWS", rows)
    .replaceAll("HOLDER", file === "js" ? "" : file === "ts" ? ": { rows: number[] }" : ": any")
    .replaceAll("LIST", file === "js" ? "" : file === "ts" ? ": number[]" : ": any")
    .replaceAll("NUMBER", file === "js" ? "" : file === "ts" ? ": number" : ": any")
    .replaceAll("ANY", file === "js" ? "" : ": any");
  return {
    name: `${loop}--${inner}--${front}--${source}--${body}--${file}.${file === "js" ? "js" : "ts"}`,
    text: text + (file === "js" ? "\n" : "\nexport {};\n"),
  };
}
