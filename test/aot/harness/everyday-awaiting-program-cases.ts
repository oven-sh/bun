// Everyday programs of a dozen lines, beside everyday-program-cases.ts and everyday-gathering-program-cases.ts: an async function walks a list of records and awaits something for each. How the list is walked,
// times what is awaited, times what is taken in front of the `await` and used behind it, times how the walk is left early, times where the rows come from, times the kind of file. Each program holds one of each.
//
// The first question to each is whether it can be built at all, the second whether it prints what `bun <file>` prints.

const written =
  '[{ name: "ash", size: 3 }, { name: "elm", size: 8 }, { name: "oak", size: 13 }, { name: "ash", size: 1 }, { name: "fir", size: 5 }]';
const parsed = `JSON.parse('[{"name":"ash","size":3},{"name":"elm","size":8},{"name":"oak","size":13},{"name":"ash","size":1},{"name":"fir","size":5}]')`;

// What stands in front of the function, what opens the walk and gives `row`, what closes it, what goes on with the next row, what ends the walk. ROWS is how the list is named there.
const walks: [string, string, string, string, string, string][] = [
  ["for-of", "", "for (const row of ROWS) {", "}", "continue;", "break;"],
  ["counted-up", "", "for (let i = 0; i < ROWS.length; i++) {\n  const row = ROWS[i];", "}", "continue;", "break;"],
  [
    "counted-down",
    "",
    "for (let i = ROWS.length - 1; i >= 0; i--) {\n  const row = ROWS[i];",
    "}",
    "continue;",
    "break;",
  ],
  [
    "while-some-are-left",
    "",
    "const left = [...ROWS];\nwhile (left.length) {\n  const row = left.shift()BANG;",
    "}",
    "continue;",
    "break;",
  ],
  ["do-while", "", "let i = 0;\ndo {\n  const row = ROWS[i];", "} while (++i < ROWS.length);", "continue;", "break;"],
  ["for-await-over-a-generator", "async function* each(listLIST) {\n  for (const one of list) yield one;\n}", "for await (const row of each(ROWS)) {", "}", "continue;", "break;"], // prettier-ignore
  [
    "for-await-over-promises",
    "",
    "for await (const row of ROWS.map((oneROW) => Promise.resolve(one))) {",
    "}",
    "continue;",
    "break;",
  ],
  ["all-at-once", "", "await Promise.all(\n  ROWS.map(async (rowROW) => {\n  if (stopped) return;", "  }),\n);", "return;", "{\n  stopped = true;\n  return;\n}"], // prettier-ignore
  ["a-chain-of-thens", "", "await ROWS.reduce(\n  (beforePROMISE, rowROW) =>\n  before.then(async () => {\n  if (stopped) return;", "  }),\n  Promise.resolve()AS,\n);", "return;", "{\n  stopped = true;\n  return;\n}"], // prettier-ignore
  ["a-function-that-calls-itself", "", "const walk = async (iNUMBER)PROMISE => {\n  if (i >= ROWS.length) return;\n  const row = ROWS[i];\n  once: {", "  }\n  await walk(i + 1);\n};\nawait walk(0);", "break once;", "return;"], // prettier-ignore
];

// What stands in front of the function, and the expression. It gives the size of the row.
const awaiteds: [string, string, string][] = [
  ["a-plain-value", "", "await row.size"],
  ["a-resolved-promise", "", "await Promise.resolve(row.size)"],
  ["an-async-function", "const twice = async (nNUMBER) => n * 2;", "(await twice(row.size)) / 2"],
  [
    "a-timer",
    "const later = (valueNUMBER) => new PromiseOFNUMBER(resolve => setTimeout(resolve, 0, value));",
    "await later(row.size)",
  ],
  ["something-with-a-then", "", "await ({\n  then(doneANY) {\n    done(row.size);\n  },\n}AS)"],
  ["a-rejection-that-is-caught", "", 'await Promise.reject(new Error("no")).catch(() => row.size)'],
  ["two-at-once", "", "(await Promise.all([row.size, Promise.resolve(1)]))[0]"],
];

// What the function makes at its start, what stands in front of the `await`, what stands behind it, and what the function hands back. `got` is what was awaited.
const kepts: [string, string, string, string, string][] = [
  ["a-sum", "let sum = 0;", "", "sum += got;", "sum"],
  ["a-sum-read-in-front", "let sum = 0;", "const was = sum;", "sum = was + got;", "sum"],
  ["a-list", "const keptNUMBERS = [];", "", "kept.push(got);", "kept"],
  ["a-name-taken-in-front", 'let text = "";', "const name = row.name;", 'text += name + got + ";";', "text"],
  [
    "a-pair-taken-apart-in-front",
    'let text = "";',
    "const { name, size } = row;",
    'text += name + (got + size) + ";";',
    "text",
  ],
  [
    "a-record-made-in-front",
    "const keptLIST = [];",
    "const made = { name: row.name, size: 0 };",
    "made.size = got;\nkept.push(made);",
    "kept",
  ],
  [
    "a-closure-made-in-front",
    'let sum = 0;\nlet text = "";',
    "const say = () => row.name + sum;",
    'sum += got;\ntext += say() + ";";',
    "text",
  ],
  ["a-variable-of-the-file", "total = 0;", "", "total += got;", "total"],
];

// What stands in front of the `await`, what stands behind it, and what stands round the whole walk. SKIP goes on with the next row, STOP ends the walk, KEPT is what the function hands back.
const exits: [string, string, string, string, string][] = [
  ["none", "", "", "", ""],
  ["skips-the-small", "if (row.size < 3) SKIP", "", "", ""],
  ["stops-at-a-big-one", "if (row.size > limit) STOP", "", "", ""],
  ["stops-behind-the-await", "", "if (got > limit) STOP", "", ""],
  ["hands-back-from-inside", "", "if (got > limit) return shown(KEPT);", "", ""],
  ["throws-behind-the-await", "", 'if (got > limit) throw new Error("too big");', "try {", "} catch {\n  caught++;\n}"],
  [
    "under-a-finally-that-awaits",
    "if (row.size > limit) STOP",
    "",
    "try {",
    "} finally {\n  await null;\n  seen++;\n}",
  ],
];

// How the list is named in the function, what stands in front of the function, the function's head, and the call.
const sources: [string, string, string, string, string][] = [
  [
    "parsed-and-handed-in",
    "rows",
    `const rowsLIST = ${parsed};`,
    "async function work(rowsLIST, limitNUMBER) {",
    "work(rows, 10)",
  ],
  [
    "written-and-handed-in",
    "rows",
    `const rowsLIST = ${written};`,
    "async function work(rowsLIST, limitNUMBER) {",
    "work(rows, 10)",
  ],
  ["captured", "rows", `const rowsLIST = ${parsed};`, "async function work(limitNUMBER) {", "work(10)"],
  ["a-field-of-this", "this.rows", `const rowsLIST = ${parsed};`, "class Shelf {\n  rowsLIST;\n  constructor(rowsLIST) {\n    this.rows = rows;\n  }\n  async work(limitNUMBER) {", "new Shelf(rows).work(10)"], // prettier-ignore
];

const files = ["js", "ts", "ts-with-any"] as const;

export const everydayAwaitingProgramCount =
  walks.length * awaiteds.length * kepts.length * exits.length * sources.length * files.length;

const indented = (text: string, by: string) => text.replaceAll("\n", "\n" + by);

export function everydayAwaitingProgram(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [exit, leavesInFront, leavesBehind, opensRound, closesRound] = pick(exits);
  const [kept, makes, inFront, behind, handsBack] = pick(kepts);
  const [awaited, helper, awaits] = pick(awaiteds);
  const [source, rows, atTheTop, head, call] = pick(sources);
  const [walk, generator, opens, closes, skip, stop] = pick(walks);
  const file = pick(files);
  const isMethod = source === "a-field-of-this";
  const by = isMethod ? "    " : "  ";
  const deeper =
    walk === "a-function-that-calls-itself" || walk === "all-at-once" || walk === "a-chain-of-thens" ? "    " : "  ";
  const body = [leavesInFront, inFront, `const got = ${awaits};`, leavesBehind, behind]
    .filter(Boolean)
    .join("\n")
    .replaceAll("SKIP", () => skip)
    .replaceAll("STOP", () => stop)
    .replaceAll("KEPT", handsBack);
  const walked = [opens, deeper + indented(body, deeper), closes].join("\n");
  const text = [
    file !== "js" && (file === "ts" ? "type Row = { name: string; size: number };" : "type Row = any;"),
    "const shown = (valueANY) => JSON.stringify(value);",
    "let total = 0;",
    helper,
    generator,
    atTheTop,
    head,
    by +
      indented(
        [
          "let stopped = false;\nlet caught = 0;\nlet seen = 0;",
          makes,
          opensRound ? [opensRound, "  " + indented(walked, "  "), closesRound].join("\n") : walked,
          `return shown(${handsBack}) + " " + caught + " " + seen;`,
        ].join("\n"),
        by,
      ),
    isMethod ? "  }\n}" : "}",
    `console.log("SAID " + (await ${call}));`,
    "export {};",
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("ROWS", rows)
    .replaceAll("OFNUMBER", file === "js" ? "" : file === "ts" ? "<number>" : "<any>")
    .replaceAll("NUMBERS", file === "js" ? "" : file === "ts" ? ": number[]" : ": any")
    .replaceAll("PROMISE", file === "js" ? "" : ": Promise<any>")
    .replaceAll("LIST", file === "js" ? "" : file === "ts" ? ": Row[]" : ": any")
    .replaceAll("ROW", file === "js" ? "" : ": Row")
    .replaceAll("NUMBER", file === "js" ? "" : file === "ts" ? ": number" : ": any")
    .replaceAll("BANG", file === "js" ? "" : "!")
    .replaceAll("AS", file === "js" ? "" : " as any")
    .replaceAll("ANY", file === "js" ? "" : ": any");
  return {
    name: `${walk}--${awaited}--${kept}--${exit}--${source}--${file}.${file === "js" ? "mjs" : "ts"}`,
    text: text + "\n",
  };
}
