// Everyday programs of a dozen lines, beside everyday-program-cases.ts: a function walks a list of records and gathers something out of them. How the list is walked, times how the walk is left early, times how
// the parts of a record are taken, times what is gathered into, times where the rows come from, times the kind of file. Each program holds one of each.
//
// The first question to each is whether it can be built at all, the second whether it prints what `bun <file>` prints.

const written =
  '[{ name: "ash", size: 3 }, { name: "elm", size: 8 }, { name: "oak", size: 13 }, { name: "ash", size: 1 }, { name: "fir", size: 5 }]';
const parsed = `JSON.parse('[{"name":"ash","size":3},{"name":"elm","size":8},{"name":"oak","size":13},{"name":"ash","size":1},{"name":"fir","size":5}]')`;

// What opens the walk and gives `row`, what closes it, what goes on with the next row, what ends the walk, and whether the body is a function of its own. ROWS is how the list is named there.
const walks: [string, string, string, string, string, boolean][] = [
  ["for-of", "for (const row of ROWS) {", "}", "continue;", "break;", false],
  ["over-its-entries", "for (const [at, row] of ROWS.entries()) {", "}", "continue;", "break;", false],
  ["counted-up", "for (let i = 0; i < ROWS.length; i++) {\n  const row = ROWS[i];", "}", "continue;", "break;", false],
  [
    "counted-down",
    "for (let i = ROWS.length - 1; i >= 0; i--) {\n  const row = ROWS[i];",
    "}",
    "continue;",
    "break;",
    false,
  ],
  ["over-its-keys", "for (const key in ROWS) {\n  const row = ROWS[Number(key)];", "}", "continue;", "break;", false],
  [
    "while-some-are-left",
    "const left = [...ROWS];\nwhile (left.length) {\n  const row = left.shift()BANG;",
    "}",
    "continue;",
    "break;",
    false,
  ],
  [
    "do-while",
    "let i = 0;\ndo {\n  const row = ROWS[i];",
    "} while (++i < ROWS.length);",
    "continue;",
    "break;",
    false,
  ],
  ["by-its-iterator", "const walker = ROWS[Symbol.iterator]();\nfor (let step = walker.next(); !step.done; step = walker.next()) {\n  const row = step.value;", "}", "continue;", "break;", false], // prettier-ignore
  [
    "for-each",
    "ROWS.forEach((rowROW) => {\n  if (stopped) return;",
    "});",
    "return;",
    "{\n  stopped = true;\n  return;\n}",
    true,
  ],
  ["a-function-that-calls-itself", "const walk = (iNUMBER)ANY => {\n  if (i >= ROWS.length) return;\n  const row = ROWS[i];\n  once: {", "  }\n  walk(i + 1);\n};\nwalk(0);", "break once;", "return;", true], // prettier-ignore
];

// What stands in the body in front of the gathering. SKIP goes on with the next row, STOP ends the walk. The last two say what stands round the whole walk.
const exits: [string, string, string, string][] = [
  ["none", "", "", ""],
  ["skips-the-small", "if (SIZE < 3) SKIP", "", ""],
  ["stops-at-a-big-one", "if (SIZE > limit) STOP", "", ""],
  ["hands-back-from-inside", "if (SIZE > limit) return shown(into);", "", ""],
  [
    "throws-and-is-caught-outside",
    'if (SIZE > limit) throw new Error("too big");',
    "try {",
    "} catch {\n  caught++;\n}",
  ],
  [
    "throws-and-is-caught-inside",
    'try {\n  if (SIZE > limit) throw new Error("too big");\n} catch {\n  caught++;\n  SKIP\n}',
    "",
    "",
  ],
  ["skips-out-of-a-finally", "try {\n  if (SIZE < 3) SKIP\n} finally {\n  seen++;\n}", "", ""],
  ["goes-on-with-a-loop-round-it", "if (SIZE > limit) AGAIN", "again: for (let turn = 0; turn < 2; turn++) {", "}"],
];

// What stands in the function in front of everything, what stands in the body, and how the name and the size read.
const takes: [string, string, string, string, string][] = [
  ["by-a-dot", "", "", "row.name", "row.size"],
  ["taken-apart", "", "const { name, size } = row;", "name", "size"],
  ["under-written-keys", "", "", 'row["name"]', 'row["size"]'],
  ["under-reckoned-keys", 'const keys = JSON.parse(\'["name","size"]\');', "", "(rowAS)[keys[0]]", "(rowAS)[keys[1]]"],
  [
    "by-helpers",
    "const nameOf = (oneROW) => one.name;\nconst sizeOf = (oneROW) => one.size;",
    "",
    "nameOf(row)",
    "sizeOf(row)",
  ],
  ["with-a-question-mark", "", "", '(row?.name ?? "none")', "(row?.size ?? 0)"],
];

// What is made, its type in TypeScript, and what a row adds.
const intos: [string, string, string, string][] = [
  ["a-list-by-push", "const intoTYPE = [];", "number[]", "into.push(SIZE);"],
  ["a-list-by-its-length", "const intoTYPE = [];", "number[]", "into[into.length] = SIZE;"],
  ["a-record-under-the-name", "const intoTYPE = {};", "Record<string, number>", "into[NAME] = SIZE;"],
  ["a-record-that-counts", "const intoTYPE = {};", "Record<string, number>", "into[NAME] = (into[NAME] ?? 0) + SIZE;"],
  [
    "a-map-that-counts",
    "const intoTYPE = new Map();",
    "Map<string, number>",
    "into.set(NAME, (into.get(NAME) ?? 0) + SIZE);",
  ],
  ["a-set", "const intoTYPE = new Set();", "Set<string>", "into.add(NAME);"],
  ["a-text", 'let intoTYPE = "";', "string", 'into += NAME + ":" + SIZE + ";";'],
  ["a-sum", "let intoTYPE = 0;", "number", "into += SIZE;"],
  [
    "lists-under-a-key",
    "const intoTYPE = {};",
    "Record<string, string[]>",
    '(into[SIZE % 2 ? "odd" : "even"] ??= []).push(NAME);',
  ],
  ["records-made-anew", "const intoTYPE = [];", "Row[]", "into.push({ ...row, size: SIZE * 2 });"],
  ["a-closure-a-row", "const intoTYPE = [];", "(() => string)[]", "into.push(() => NAME + SIZE);"],
];

// How the list is named in the function, what stands in front of the function, the function's head, and the call.
const sources: [string, string, string, string, string][] = [
  [
    "parsed-and-handed-in",
    "rows",
    `const rowsLIST = ${parsed};`,
    "function gather(rowsLIST, limitNUMBER) {",
    "gather(rows, 10)",
  ],
  [
    "written-and-handed-in",
    "rows",
    `const rowsLIST = ${written};`,
    "function gather(rowsLIST, limitNUMBER) {",
    "gather(rows, 10)",
  ],
  ["captured", "rows", `const rowsLIST = ${parsed};`, "function gather(limitNUMBER) {", "gather(10)"],
  ["a-field-of-this", "this.rows", `const rowsLIST = ${parsed};`, "class Shelf {\n  rowsLIST;\n  constructor(rowsLIST) {\n    this.rows = rows;\n  }\n  gather(limitNUMBER) {", "new Shelf(rows).gather(10)"], // prettier-ignore
  ["the-values-of-a-record", "rows", `const rowsLIST = Object.values(Object.fromEntries(${parsed}.map((rowROW, atNUMBER) => ["k" + at, row])));`, "function gather(rowsLIST, limitNUMBER) {", "gather(rows, 10)"], // prettier-ignore
  ["the-values-of-a-map", "rows", `const rowsLIST = [...new Map(${parsed}.map((rowROW, atNUMBER) => [at, row])).values()]AS;`, "function gather(rowsLIST, limitNUMBER) {", "gather(rows, 10)"], // prettier-ignore
  [
    "made-by-a-map-call",
    "rows",
    `const rowsLIST = ${parsed}.map((rowROW) => ({ ...row }));`,
    "function gather(rowsLIST, limitNUMBER) {",
    "gather(rows, 10)",
  ],
];

const files = ["js", "ts", "ts-with-any"] as const;

export const everydayGatheringProgramCount =
  walks.length * exits.length * takes.length * intos.length * sources.length * files.length;

const indented = (text: string, by: string) => text.replaceAll("\n", "\n" + by);

export function everydayGatheringProgram(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [exit, leaves, opensRound, closesRound] = pick(exits);
  const [take, helpers, takesApart, name, size] = pick(takes);
  const [into, makes, type, adds] = pick(intos);
  const [source, rows, atTheTop, head, call] = pick(sources);
  const [walk, opens, closes, skip, stop, isFunction] = pick(walks);
  const file = pick(files);
  const isMethod = source === "a-field-of-this";
  const by = isMethod ? "    " : "  ";
  const deeper = walk === "a-function-that-calls-itself" ? "    " : "  ";
  const body = [takesApart, leaves, adds]
    .filter(Boolean)
    .join("\n")
    .replaceAll("SKIP", () => skip)
    .replaceAll("STOP", () => stop)
    // A function of its own cannot go on with a loop that stands round it.
    .replaceAll("AGAIN", () => (isFunction ? skip : "continue again;"));
  const walked = [opens, deeper + indented(body, deeper), closes].join("\n");
  const text = [
    file !== "js" && (file === "ts" ? "type Row = { name: string; size: number };" : "type Row = any;"),
    "const shown = (valueANY) =>\n  JSON.stringify(value, (key, oneANY) => (one instanceof Map || one instanceof Set ? [...one] : typeof one === \"function\" ? one() : one));", // prettier-ignore
    atTheTop,
    head,
    by +
      indented(
        [
          "let stopped = false;\nlet caught = 0;\nlet seen = 0;",
          helpers,
          makes,
          opensRound ? [opensRound, "  " + indented(walked, "  "), closesRound].join("\n") : walked,
          'return shown(into) + " " + caught + " " + seen;',
        ]
          .filter(Boolean)
          .join("\n"),
        by,
      ),
    isMethod ? "  }\n}" : "}",
    `console.log("SAID " + ${call});`,
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("NAME", () => name)
    .replaceAll("SIZE", () => size)
    .replaceAll("ROWS", rows)
    .replaceAll("TYPE", file === "js" ? "" : file === "ts" ? `: ${type}` : ": any")
    .replaceAll("LIST", file === "js" ? "" : file === "ts" ? ": Row[]" : ": any")
    .replaceAll("ROW", file === "js" ? "" : ": Row")
    .replaceAll("NUMBER", file === "js" ? "" : file === "ts" ? ": number" : ": any")
    .replaceAll("BANG", file === "js" ? "" : "!")
    .replaceAll("AS", file === "js" ? "" : " as any")
    .replaceAll("ANY", file === "js" ? "" : ": any");
  return {
    name: `${walk}--${exit}--${take}--${into}--${source}--${file}.${file === "js" ? "js" : "ts"}`,
    text: text + (file === "js" ? "\n" : "\nexport {};\n"),
  };
}
