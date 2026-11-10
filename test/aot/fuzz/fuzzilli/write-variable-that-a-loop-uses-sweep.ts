// A loop uses a variable of a file, turn after turn, beside write-called-in-a-turn-sweep.ts: what a turn does with the variable, times where the variable lives, times what has been stored in it when the loop
// begins, times the loop, times what is stored there later, times where the text of the file stands. Each program holds one of each and is built alone.
//
//   bun write-variable-that-a-loop-uses-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<use>--<holder>--<state>--<loop>--<later>[--<where>].<cjs | mjs | ts>
//   bun write-variable-that-a-loop-uses-sweep.ts count
//   bun write-variable-that-a-loop-uses-sweep.ts named <pattern> <folder> [most]
//
// A variable holds what was stored in it last. Until something is stored a `var` holds undefined and a `let` cannot be read. A store that is written in front of a loop has not always run when the loop begins.
import { mkdirSync, writeFileSync } from "fs";

// The values of a use: what suits it, a second one that suits it, and one of another kind.
const numbers = ['Number("7")', 'Number("3")', 'Number("0.5")'];
const records = ["{ step: 5 }", "{ step: 9 }", "{ other: 1, step: 2 }"];
const functions = ["turn => turn + 10", "turn => turn * 2", "7"];

// What a turn does. PLACE is how the variable reads, TAKE(..) is what becomes of an answer, STORE(..) stores.
const uses: [string, string[], string][] = [
  ["divides-the-turn", numbers, "TAKE(turn % PLACE)"],
  ["divides-a-product", numbers, "TAKE((turn * 7 + 3) % PLACE)"],
  ["asked-by-an-if", records, "if (PLACE) TAKE(PLACE.step)\nelse TAKE(-1)"],
  ["asked-against-undefined", records, "if (PLACE !== undefined) TAKE(PLACE.step)\nelse TAKE(-1)"],
  ["asked-by-a-chain", records, "TAKE(PLACE?.step ?? -1)"],
  ["made-where-it-is-missing", records, "if (!PLACE) STORE(GOOD)\nTAKE(PLACE.step)"],
  ["called", functions, "TAKE(PLACE(turn))"],
  ["called-where-it-is-there", functions, "if (PLACE) TAKE(PLACE(turn))\nelse TAKE(-1)"],
  ["handed-on", functions, "TAKE(apply(PLACE, turn))"],
  ["added-to", numbers, "STORE(PLACE + turn)\nTAKE(PLACE)"],
];

type Holder = {
  name: string;
  kind: "cjs" | "mjs" | "ts";
  top: string; // at the top of the file that holds the loop
  end: string; // at its very end
  behind?: string; // behind the loop, or behind the first call of its function
  // Where the variable is a private static field: everything that names it stands in the class, and what stands outside stores through a method.
  inClass?: { declaredBehind: boolean; fromOutside: (value: string) => string };
  // Where the turn itself takes the other file: what opens each turn, and how the variable reads and is stored outside the turns.
  inTheTurn?: { opens: string; place: string; store: (value: string) => string };
  place: string;
  store: (value: string) => string; // an expression
  // Where the variable lives in another file: the name of that file, and its text round what stands in front.
  other?: { file: string; place: string; text: (inFront: string) => string; loopLiesThere?: boolean };
};
const own = (value: string) => `(held = ${value})`;
const peek = "function peek() {\n  return held;\n}";
const holders: Holder[] = [
  { name: "a-var", kind: "cjs", top: "var held;", end: peek, place: "held", store: own },
  { name: "a-let", kind: "cjs", top: "let held;", end: peek, place: "held", store: own },
  { name: "a-var-declared-at-the-end", kind: "cjs", top: "", end: peek + "\nvar held;", place: "held", store: own },
  { name: "a-let-of-a-module", kind: "mjs", top: "let held;", end: peek, place: "held", store: own },
  {
    name: "a-let-declared-behind-the-loop",
    kind: "mjs",
    top: "",
    behind: "let held;",
    end: peek,
    place: "held",
    store: own,
  },
  {
    name: "a-let-of-another-module",
    kind: "mjs",
    top: 'import { held, lay } from "./other.mjs";',
    end: "",
    place: "held",
    store: value => `lay(${value})`,
    other: {
      file: "other.mjs",
      place: "held",
      text: inFront => `export let held;\nexport function lay(value) {\n  held = value;\n}\n${inFront}`,
    },
  },
  {
    name: "a-name-of-the-exports-of-another-file",
    kind: "cjs",
    top: 'const tool = require("./tool.cjs");',
    end: "",
    place: "tool.held",
    store: value => `tool.lay(${value})`,
    other: {
      file: "tool.cjs",
      place: "exports.held",
      text: inFront => `exports.lay = value => {\n  exports.held = value;\n};\n${inFront}`,
    },
  },
  {
    name: "a-var-of-a-module-that-has-not-run",
    kind: "mjs",
    top: 'import { held, lay } from "./p.mjs";',
    end: "",
    place: "held",
    store: value => `lay(${value})`,
    other: {
      file: "user.mjs",
      place: "held",
      text: inFront =>
        `import "./user.mjs";\nexport var held;\nexport function lay(value) {\n  held = value;\n}\n${inFront}`,
      loopLiesThere: true,
    },
  },
  {
    name: "a-let-of-a-module-that-has-not-run",
    kind: "mjs",
    top: 'import { held, lay } from "./p.mjs";',
    end: "",
    place: "held",
    store: value => `lay(${value})`,
    other: {
      file: "user.mjs",
      place: "held",
      text: inFront =>
        `import "./user.mjs";\nexport let held;\nexport function lay(value) {\n  held = value;\n}\n${inFront}`,
      loopLiesThere: true,
    },
  },
  {
    name: "a-name-imported-from-a-commonjs-file",
    kind: "mjs",
    top: 'import { held, lay } from "./tool.cjs";',
    end: "",
    place: "held",
    store: value => `lay(${value})`,
    other: {
      file: "tool.cjs",
      place: "exports.held",
      text: inFront => `exports.held = undefined;\nexports.lay = value => {\n  exports.held = value;\n};\n${inFront}`,
    },
  },
  {
    name: "a-private-static-field",
    kind: "mjs",
    top: "",
    end: "",
    place: "Box.#held",
    store: value => `(Box.#held = ${value})`,
    inClass: { declaredBehind: false, fromOutside: value => `Box.lay(${value})` },
  },
  {
    name: "a-private-static-field-declared-behind-the-loop",
    kind: "mjs",
    top: "",
    end: "",
    place: "Box.#held",
    store: value => `(Box.#held = ${value})`,
    inClass: { declaredBehind: true, fromOutside: value => `Box.lay(${value})` },
  },
  {
    name: "a-name-of-the-exports-of-a-file-required-in-the-turn",
    kind: "cjs",
    top: "",
    end: "",
    place: "tool.held",
    store: value => `tool.lay(${value})`,
    inTheTurn: {
      opens: 'const tool = require("./tool.cjs");',
      place: 'require("./tool.cjs").held',
      store: value => `require("./tool.cjs").lay(${value})`,
    },
    other: {
      file: "tool.cjs",
      place: "exports.held",
      text: inFront => `exports.lay = value => {\n  exports.held = value;\n};\n${inFront}`,
    },
  },
  // TYPE is what the values of the use are declared to be. The mark behind the name says that the file takes it on itself that a store comes first.
  { name: "a-let-with-a-declared-type", kind: "ts", top: "let held!: TYPE;", end: peek, place: "held", store: own },
  {
    name: "a-var-with-a-declared-type-declared-at-the-end",
    kind: "ts",
    top: "",
    end: peek + "\nvar held!: TYPE;",
    place: "held",
    store: own,
  },
];

// What a file with types says more, so that TypeScript takes the same text.
const typed: [string | RegExp, string][] = [
  ["null.nothing", "(null as any).nothing"],
  ["= undefined)", "= undefined as any)"],
  ["= { other: 1, step: 2 })", "= { other: 1, step: 2 } as any)"],
  ["= 7)", "= 7 as any)"],
  ['Number("1") ?? ', 'JSON.parse("1") ?? '],
  ["return error.constructor.name;", "return (error as Error).constructor.name;"],
  ["function apply(given, value) {", "function apply(given: unknown, value: number) {"],
  ["function work(most) {", "function work(most: number) {"],
  ["function attempt(most) {", "function attempt(most: number) {"],
];
const types = new Map<string[], string>();

// What stands in front of the loop, in the turn in front of the use, and in the turn behind it.
const states: [string, string, string, string][] = [
  ["stored-in-front", "STORE(GOOD)", "", ""],
  ["never-stored-in-front", "", "", ""],
  ["stored-in-the-turn-in-front-of-its-use", "", "STORE(GOOD)", ""],
  ["stored-in-the-turn-behind-its-use", "", "", "STORE(GOOD)"],
  ["twice-in-the-turn", "", "STORE(GOOD)\nSTORE(SECOND)", ""],
  ["from-the-second-turn-on", "", "if (turn) STORE(GOOD)", ""],
  ["under-an-if-that-holds", 'if (Number("1")) STORE(GOOD)', "", ""],
  ["under-an-if-that-does-not-hold", 'if (Number("0")) STORE(GOOD)', "", ""],
  ["behind-a-throw-in-a-try", "try {\n  null.nothing;\n  STORE(GOOD)\n} catch {}", "", ""],
  ["in-a-loop-that-takes-no-turn", 'for (let n = 0; n < Number("0"); n++) STORE(GOOD)', "", ""],
  ["by-a-function-called-in-front", "function fill() {\n  STORE(GOOD)\n}\nfill();", "", ""],
  ["by-a-function-that-is-never-called", "function fill() {\n  STORE(GOOD)\n}", "", ""],
  ["behind-an-and-that-stops", 'Number("0") && STORE(GOOD)', "", ""],
  ["in-a-block-left-early", 'early: {\n  if (Number("1")) break early;\n  STORE(GOOD)\n}', "", ""],
  ["another-kind-in-front-and-its-own-in-the-turn", "STORE(OTHER)", "STORE(GOOD)", ""],
  ["stored-and-cleared-in-front", "STORE(GOOD)\nSTORE(undefined)", "", ""],
  ["in-the-arm-of-a-choice-that-is-not-taken", 'Number("1") ? 0 : STORE(GOOD)', "", ""],
  ["behind-a-question-for-nothing-that-stops", 'Number("1") ?? STORE(GOOD)', "", ""],
  ["in-a-case-that-is-not-taken", 'switch (Number("1")) {\n  case 0:\n    STORE(GOOD)\n}', "", ""],
  ["in-a-finally", "try {\n} finally {\n  STORE(GOOD)\n}", "", ""],
  [
    "behind-the-return-of-a-function-called-in-front",
    'function fill() {\n  if (Number("1")) return;\n  STORE(GOOD)\n}\nfill();',
    "",
    "",
  ],
  [
    "behind-the-throw-of-a-function-called-in-front",
    "function fill() {\n  null.nothing;\n  STORE(GOOD)\n}\ntry {\n  fill();\n} catch {}",
    "",
    "",
  ],
];

const turns = 'Number("3")';
const asFor = [`for (let turn = 0; turn < ${turns}; turn++) {`, "", "}"];
const upToMost = ["for (let turn = 0; turn < most; turn++) {", "", "}"];
const asDoWhile = ["let turn = 0;\ndo {", "turn++;", `} while (turn < ${turns});`];
// Where the loop stands (at the top of its file, in a function that holds what stands in front too, in a function whose caller holds it, or in the turn of another loop), what opens it, what ends a turn, what closes it.
const loops: [string, "top" | "function" | "caller" | "inner", string, string, string][] = [
  ["for", "top", ...asFor] as any,
  ["while", "top", `let turn = 0;\nwhile (turn < ${turns}) {`, "turn++;", "}"],
  ["do-while", "top", ...asDoWhile] as any,
  [
    "for-left-by-a-break-at-its-end",
    "top",
    "let turn = 0;\nfor (;;) {",
    `turn++;\nif (!(turn < ${turns})) break;`,
    "}",
  ],
  ["for-in-a-function", "function", ...asFor] as any,
  ["do-while-in-a-function", "function", ...asDoWhile] as any,
  ["for-in-a-function-behind-its-caller", "caller", ...asFor] as any,
  ["for-in-the-turn-of-a-loop", "inner", ...asFor] as any,
  ["for-in-a-function-that-a-conversion-calls", "caller", ...asFor] as any,
  ["for-in-a-function-that-a-getter-calls", "caller", ...asFor] as any,
  ["for-in-a-function-that-a-method-of-a-list-calls", "caller", ...asFor] as any,
  ["for-in-a-function-that-the-writer-of-json-calls", "caller", ...asFor] as any,
  ["for-that-takes-no-turn", "top", 'for (let turn = 0; turn < Number("0"); turn++) {', "", "}"],
  ["in-a-function-with-no-turn-at-first", "function", ...upToMost] as any,
  ["behind-its-caller-with-no-turn-at-first", "caller", ...upToMost] as any,
];

// What is stored behind the loop, between the two calls of its function, or at the end of the turn of the loop round it.
const laters: [string, string][] = [
  ["nothing-later", ""],
  ["a-second-of-its-kind-later", "STORE(SECOND)"],
  ["another-kind-later", "STORE(OTHER)"],
];

// By which road the function of the loop is called, where no call of it is written. WORK is the function.
const roads: Record<string, string> = {
  "for-in-a-function-that-a-conversion-calls": "+{ valueOf: WORK }",
  "for-in-a-function-that-a-getter-calls": "{\n      get now() {\n        return WORK();\n      },\n    }.now",
  "for-in-a-function-that-a-method-of-a-list-calls": "[0].map(() => WORK())[0]",
  "for-in-a-function-that-the-writer-of-json-calls": "JSON.parse(JSON.stringify({ toJSON: WORK }))",
};

types.set(numbers, "number").set(records, "{ step: number }").set(functions, "(turn: number) => number");

// Where the text of the file stands: in the file, where its variables are variables of the file, or in a function, where they are variables of that function which the functions inside hold on to.
const wheres: [string, string, string][] = [
  ["", "", ""],
  ["in-one-function", "(function whole() {", "})();"],
  ["two-functions-deep", "(function outer() {\n  (function whole() {", "  })();\n})();"],
  ["in-a-method", "class Whole {\n  static run() {", "  }\n}\nWhole.run();"],
];

const all = uses.length * holders.length * states.length * loops.length * laters.length * wheres.length;

const indented = (text: string, by = "  ") => by + text.replaceAll("\n", "\n" + by);
const joined = (...parts: string[]) => parts.filter(Boolean).join("\n");

// STORE(..) and TAKE(..) hold no parentheses of their own kind inside, but their arguments do: the closing one is found by counting.
function rewritten(text: string, word: string, by: (inside: string) => string): string {
  for (let at = text.indexOf(word + "("); at >= 0; at = text.indexOf(word + "(", at)) {
    let depth = 0;
    let end = at + word.length;
    do {
      if (text[end] === "(") depth++;
      if (text[end] === ")") depth--;
      end++;
    } while (depth);
    text = text.slice(0, at) + by(text.slice(at + word.length + 1, end - 1)) + ";" + text.slice(end);
  }
  return text;
}

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [state, written, before, behind] = pick(states);
  const [later, stored] = pick(laters);
  const [loop, stands, opens, ends, closes] = pick(loops);
  // Where the function of the loop is told how many turns to take: none at its first call.
  const [most, none, three] = opens.includes("most") ? ["most", 'Number("0")', turns] : ["", "", ""];
  const [use, values, does] = pick(uses);
  const [good, second, other] = values;
  const holder = pick(holders);
  const [where, opensWhere, closesWhere] = pick(wheres);
  // `bun <file>` takes no `break` to a label in a static block, though the label stands in that block too: there the block that is left early is a loop of one turn.
  const inFront =
    holder.inClass && written.startsWith("early: {")
      ? 'do {\n  if (Number("1")) break;\n  STORE(GOOD)\n} while (false);'
      : written;
  const filled = (text: string, place: string, store: (value: string) => string) =>
    rewritten(rewritten(text, "STORE", store), "TAKE", inside => `total = total * 3 + (${inside})`)
      .replaceAll("GOOD", () => good)
      .replaceAll("SECOND", () => second)
      .replaceAll("OTHER", () => other)
      .replaceAll("PLACE", place);
  const here = (text: string) => filled(text, holder.place, holder.store);
  const front = holder.other ? "" : here(inFront);
  const theLoop = joined(
    here(opens),
    indented(here(joined(holder.inTheTurn?.opens ?? "", before, does, behind, ends))),
    closes,
  );
  const behindIt = holder.inTheTurn ? filled(stored, holder.inTheTurn.place, holder.inTheTurn.store) : here(stored);
  const helper =
    use === "handed-on"
      ? 'function apply(given, value) {\n  return typeof given === "function" ? given(value) : -2;\n}'
      : "";
  const seen = `console.log("SAID holds " + typeof ${holder.inTheTurn?.place ?? holder.place});`;
  let body: string;
  if (holder.inClass) {
    const { declaredBehind, fromOutside } = holder.inClass;
    const outside = (text: string) => filled(text, "Box.peek()", fromOutside);
    const methods = "static lay(value) {\n  Box.#held = value;\n}\nstatic peek() {\n  return Box.#held;\n}";
    const block = (text: string) => (text ? joined("static {", indented(text), "}") : "");
    const inTheClass =
      stands === "top"
        ? block(joined(front, "let total = 0;", theLoop, 'console.log("SAID end " + total);', here(stored)))
        : stands === "inner"
          ? block(joined(front, "let total = 0;", "for (let round = 0; round < 2; round++) {", indented(joined(theLoop, here(stored))), "}", 'console.log("SAID end " + total);')) // prettier-ignore
          : joined(
              `static work(${most}) {`,
              indented(joined(stands === "function" ? front : "", "let total = 0;", theLoop, "return total;")),
              "}",
              `static attempt(${most}) {\n  try {\n    return ${(roads[loop] ?? `WORK(${most})`).replaceAll("WORK", "Box.work")};\n  } catch (error) {\n    return error.constructor.name;\n  }\n}`,
              stands === "caller" ? block(front) : "",
              `static first = Box.attempt(${none});`,
            );
    body = joined(
      "class Box {",
      indented(
        joined(declaredBehind ? "" : "static #held;", methods, inTheClass, declaredBehind ? "static #held;" : ""),
      ),
      "}",
      stands === "top" || stands === "inner" ? "" : joined('console.log("SAID first " + Box.first);', outside(stored), `console.log("SAID second " + Box.attempt(${three}));`), // prettier-ignore
      'console.log("SAID holds " + typeof Box.peek());',
    );
  } else if (stands === "top")
    body = joined(
      front,
      "let total = 0;",
      theLoop,
      'console.log("SAID end " + total);',
      holder.behind ?? "",
      behindIt,
      seen,
    );
  else if (stands === "inner")
    body = joined(
      front,
      "let total = 0;",
      "for (let round = 0; round < 2; round++) {",
      indented(joined(theLoop, behindIt)),
      "}",
      'console.log("SAID end " + total);',
      holder.behind ?? "",
      seen,
    );
  else
    body = joined(
      stands === "caller" ? front : "",
      `function work(${most}) {`,
      indented(joined(stands === "function" ? front : "", "let total = 0;", theLoop, "return total;")),
      "}",
      `function attempt(${most}) {\n  try {\n    return ${(roads[loop] ?? `WORK(${most})`).replaceAll("WORK", "work")};\n  } catch (error) {\n    return error.constructor.name;\n  }\n}`,
      `console.log("SAID first " + attempt(${none}));`,
      holder.behind ?? "",
      behindIt,
      `console.log("SAID second " + attempt(${three}));`,
      seen,
    );
  // What a file imports stays at its top.
  const imports = holder.top.startsWith("import ") ? holder.top : "";
  const inside = joined(imports ? "" : holder.top, helper, body, holder.end);
  const file = where
    ? joined(imports, opensWhere, indented(inside, opensWhere.includes("\n") ? "    " : "  "), closesWhere)
    : joined(imports, inside);
  let text = file;
  if (holder.other) {
    const beside = holder.other.text(
      filled(inFront, holder.other.place, value => `(${holder.other!.place} = ${value})`),
    );
    text = holder.other.loopLiesThere
      ? joined(beside, `// @filename: ./${holder.other.file}`, file)
      : joined(file, `// @filename: ./${holder.other.file}`, beside);
  }
  if (holder.kind === "ts") {
    for (const [plain, withTypes] of typed) text = text.replaceAll(plain, withTypes);
    text = text.replaceAll("TYPE", types.get(values)!);
  }
  const name = `${use}--${holder.name}--${state}--${loop}--${later}${where && "--" + where}.${holder.kind}`;
  return { name, text: text + "\n" };
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
