// The flow analysis asks nothing about the order of statements. So two texts that differ only in the order of two neighboring statements, neither of which
// writes a name that the other mentions, give the same tables.
//
// The engine's own tests turn the order of the worklist and the number of threads over one text, which has one numbering of sites and nodes. A rule that asks
// "is the other one there already?" answers by the order of the text, and all those orders agree on it: one such rule tied the call of a larger set of functions
// to the call of a smaller one only where the smaller had been met, and which of two functions lost its callers hung on which of two calls was written first.
//
//   plain          `path(atom, ..);` or `path = atom;` of names, members by name, numbers and quoted texts: nothing that makes a function, an object, a list
//                  or a class, so no number of a function or of a layout moves
//   independent    neither writes a name, the root of its target, that the other mentions
//   the same       what `testaot link` prints in both readings, with the numbers of values struck and the lines sorted: the two sites change places
//   the control    a store and the call that reads what it stored change places too, and the comparison must report it
//
// A program as written is a case, and so is each of its swaps. The case of a swap builds its own text and holds the tables against those of the program as
// written, which are made once. A program lists its swaps by name: a swap that is no longer found fails its own case.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../engine/testaot";
import { built, slot, spawned } from "../harness/commands";
import { afterAll } from "../harness/default-timeout";
import { buildFlags, compileCommand, withProgramOutput, withThreads } from "../harness/flags";
import { describe, test } from "../supported";

const name = String.raw`[A-Za-z_$][\w$]*`;
const path = String.raw`${name}(?:\.${name})*`;
const atom = String.raw`(?:${path}|-?\d+(?:\.\d+)?|"[^"\\\n]*"|'[^'\\\n]*')`;
const call = new RegExp(String.raw`^${path}\((?:${atom}(?:\s*,\s*${atom})*)?\)$`);
const store = new RegExp(String.raw`^${path}\s*=\s*${atom}$`);
const quoted = /"[^"\\\n]*"|'[^'\\\n]*'/g;
const wordsOfTheLanguage = new Set(
  "return typeof await yield new delete void throw super import if while for switch catch function class let const var do else case default break continue debugger with export in of instanceof async static get set".split(
    " ",
  ),
);

interface Statement {
  begin: number;
  end: number;
  text: string;
}

function plain(statement: string) {
  const first = statement.match(new RegExp(`^${name}`))?.[0];
  if (!first || wordsOfTheLanguage.has(first) || !(call.test(statement) || store.test(statement))) return undefined;
  return {
    writes: new Set(store.test(statement) ? [first] : []),
    mentions: new Set(statement.replace(quoted, "").match(new RegExp(name, "g"))),
  };
}

/** Each statement that ends in a semicolon right inside a block or the file; `undefined` wherever something else stands between two of them. */
function statementsOf(text: string) {
  const found: (Statement | undefined)[] = [];
  const open: string[] = [];
  let start = 0;
  for (let at = 0; at < text.length; at++) {
    const character = text[at];
    if (text.startsWith("//", at)) {
      const end = text.indexOf("\n", at);
      at = end < 0 ? text.length : end;
      if (/^\s*(\/\/.*)?$/s.test(text.slice(start, at))) start = at;
    } else if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at + 2);
      at = end < 0 ? text.length : end + 1;
    } else if (character === '"' || character === "'" || character === "`") {
      for (at++; at < text.length && text[at] !== character; at++) if (text[at] === "\\") at++;
    } else if (character === "(" || character === "[" || character === "{") {
      open.push(character === "{" && /\bclass\b[^;{}()]*$/.test(text.slice(start, at)) ? "class" : character);
      if (character === "{") {
        start = at + 1;
        found.push(undefined);
      }
    } else if (character === ")" || character === "]" || character === "}") {
      open.pop();
      if (character === "}") {
        start = at + 1;
        found.push(undefined);
      }
    } else if (character === ";") {
      const written = text.slice(start, at);
      const begin = start + written.length - written.trimStart().length;
      found.push(open.length === 0 || open.at(-1) === "{" ? { begin, end: at, text: written.trim() } : undefined);
      start = at + 1;
    }
  }
  return found;
}

function swapsOf(text: string, alsoDependent = false) {
  const statements = statementsOf(text);
  const swaps: { title: string; text: string }[] = [];
  for (let at = 0; at + 1 < statements.length; at++) {
    const [first, second] = [statements[at], statements[at + 1]];
    if (!first || !second || first.text === second.text || text.slice(first.end + 1, second.begin).trim() !== "")
      continue;
    const [one, other] = [plain(first.text), plain(second.text)];
    if (!one || !other) continue;
    if (!alsoDependent && (!one.writes.isDisjointFrom(other.mentions) || !other.writes.isDisjointFrom(one.mentions)))
      continue;
    swaps.push({
      title: `${first.text} <> ${second.text}`,
      text:
        text.slice(0, first.begin) +
        second.text +
        text.slice(first.end, second.begin) +
        first.text +
        text.slice(second.end),
    });
  }
  return swaps;
}

const programs = {
  "a set of functions that grew from another is called in front of it or behind it": {
    text: `
function one() {} function two() {} function three() {} function p() {} function q() {}
let g0 = one; g0 = two; let g1 = g0; g1 = three;
function both() { g0(p); g1(q); }
both(); p(); q();
`,
    swaps: ["g0(p) <> g1(q)", "both() <> p()", "p() <> q()"],
  },
  "one object goes out of sight and is kept in sight": {
    text: `
const kept = [];
function keep(what) { kept.push(what); }
function lose(what) { globalThis[String(Date.now())] = what; }
function run(thing, other) { keep(thing); lose(thing); keep(other); }
run({ a: 1 }, { b: "two" });
console.log(kept.length);
`,
    swaps: ["keep(thing) <> lose(thing)", "lose(thing) <> keep(other)"],
  },
  "two variables of the module take functions that meet at one call": {
    text: `
function first() { return 1; } function second() { return "two"; } function third() { return null; }
let held = first; let spare = second;
function turn() { held = second; spare = third; take(held); take(spare); }
function take(what) { return what(); }
turn(); console.log(typeof take(held));
`,
    swaps: ["held = second <> spare = third", "spare = third <> take(held)", "take(held) <> take(spare)"],
  },
  "members of two built-ins are called and one of them is handed on": {
    text: `
function hand(what) { return what; }
function run() { console.log("a"); Math.max(1, 2); hand(console); JSON.stringify("b"); hand(Math); }
run();
`,
    swaps: [
      'console.log("a") <> Math.max(1, 2)',
      "Math.max(1, 2) <> hand(console)",
      'hand(console) <> JSON.stringify("b")',
      'JSON.stringify("b") <> hand(Math)',
    ],
  },
};

const control = `
function one() { return 1; } function two() { return "two"; } function take(what) { return what(); } function other() { return 0; }
function run() {
  let held = one;
  other();
  held = two; take(held);
  other(); take(one);
}
run();
`;

// `  parameter 0 expected=.. proven=f1|f2`: of each parameter that is proven to take functions alone, how many.
const functionsProvenToArrive = (tables: string) =>
  Array.from(
    tables.matchAll(/^  parameter \d+ .*\bproven=(f\d+(?:\|f\d+)*)(?= |$)/gm),
    ([, functions]) => functions.split("|").length,
  );

// A build here runs on one thread, and that of the largest program takes over a minute in a debug build: it gets more time than a command gets unless it
// says so (../harness/commands.ts). That is half the limit of a case, which waits for two builds at most: its own, and that of its program as written.
const limitOfABuild = 300_000;

describe("compile/aot/independent-statements-change-places", () => {
  const folder = String(tempDir("aot-statements-change-places", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  let numberOfTexts = 0;

  // Under a sanitizer the cases of a file run beside one another (../supported.ts): each text lies in a folder of its own, or one case builds what another has just written.
  // Nothing here starts a program, so no build writes an executable. Nothing here reads what a build costs, so none is counted as ./measure counts one, in a process of its own.
  // A build on one thread and a `testaot link` each keep one processor busy, and each takes a slot.
  async function tablesOf(text: string) {
    const own = join(folder, String(++numberOfTexts));
    mkdirSync(own);
    writeFileSync(join(own, "entry.js"), text);
    const wire = join(own, "program.ir");
    const flags = [withThreads(1), withProgramOutput(wire), buildFlags.withoutExecutable];
    const command = [bunExe(), ...compileCommand, ...flags, "./entry.js"];
    built(await slot(() => spawned(command, own, bunEnv, limitOfABuild)));
    // The table of functions has a row for the body of the module and one for each function that the text writes.
    const functionsWritten = text.match(/\bfunction\b/g)!.length;
    const readings = { proving: "", held: "" };
    for (const reading of ["proving", "held"] as const) {
      const { lines, stderr, exitCode } = await slot(() =>
        run(
          "link",
          wire,
          ...(reading === "held" ? ["held"] : []),
          "threads=1",
          "mechanisms=all",
          "exclude=CodeOutsideImage",
        ),
      );
      // The tables begin with the mechanisms that they were made under. A command that ends in front of them prints no such line.
      expect({ stderr, exitCode, firstLine: lines[0] }).toEqual({
        stderr: "",
        exitCode: 0,
        firstLine: "mechanisms all",
      });
      expect(lines.filter(line => line.startsWith("function ")).length).toBeGreaterThan(functionsWritten);
      readings[reading] = lines
        .filter(line => !/^(referrer|counts) /.test(line))
        .map(line =>
          line.replace(/\bv\d+\b/g, "v#").replace(/ (cycle|rank)=\d+| leaf| takes-arrivals| in-queue-from-start/g, ""),
        )
        .sort()
        .join("\n");
    }
    rmSync(own, { recursive: true, force: true });
    return readings;
  }

  const whenWritten = new Map<string, ReturnType<typeof tablesOf>>();
  const asWritten = (text: string) => {
    if (!whenWritten.has(text)) whenWritten.set(text, tablesOf(text));
    return whenWritten.get(text)!;
  };

  for (const [title, { text, swaps }] of Object.entries(programs)) {
    test(`${title}: as written`, async () => {
      expect(swapsOf(text).map(swap => swap.title)).toEqual(swaps);
      await asWritten(text);
    }, 600_000);
    for (const named of swaps) {
      test(`${title}: ${named}`, async () => {
        const swap = swapsOf(text).find(swap => swap.title === named);
        if (!swap) throw new Error(`the program has no two independent statements ${named}`);
        expect(await tablesOf(swap.text)).toEqual(await asWritten(text));
      }, 600_000);
    }
  }

  test("the control: a store and the call that reads it change places, and the tables differ", async () => {
    expect(swapsOf(control).map(swap => swap.title)).toEqual([
      "other() <> held = two",
      "take(held) <> other()",
      "other() <> take(one)",
    ]);
    const dependent = swapsOf(control, true).find(swap => swap.title === "held = two <> take(held)")!;
    const [swapped, written] = [await tablesOf(dependent.text), await tablesOf(control)];
    expect(swapped).not.toEqual(written);
    // What the comparison reports: as written `one` and `two` arrive at the parameter of `take`, behind the swap `one` alone.
    expect({
      written: functionsProvenToArrive(written.held),
      swapped: functionsProvenToArrive(swapped.held),
    }).toEqual({ written: [2], swapped: [1] });
  }, 600_000);
});
