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
import { expect } from "bun:test";
import { tempDir } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../engine/testaot";
import { afterAll } from "../harness/default-timeout";
import { withProgramOutput } from "../harness/flags";
import { describe, test } from "../supported";
import { build } from "./measure";

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
  "a set of functions that grew from another is called in front of it or behind it": `
function one() {} function two() {} function three() {} function p() {} function q() {}
let g0 = one; g0 = two; let g1 = g0; g1 = three;
function both() { g0(p); g1(q); }
both(); p(); q();
`,
  "one object goes out of sight and is kept in sight": `
const kept = [];
function keep(what) { kept.push(what); }
function lose(what) { globalThis[String(Date.now())] = what; }
function run(thing, other) { keep(thing); lose(thing); keep(other); }
run({ a: 1 }, { b: "two" });
console.log(kept.length);
`,
  "two variables of the module take functions that meet at one call": `
function first() { return 1; } function second() { return "two"; } function third() { return null; }
let held = first; let spare = second;
function turn() { held = second; spare = third; take(held); take(spare); }
function take(what) { return what(); }
turn(); console.log(typeof take(held));
`,
  "members of two built-ins are called and one of them is handed on": `
function hand(what) { return what; }
function run() { console.log("a"); Math.max(1, 2); hand(console); JSON.stringify("b"); hand(Math); }
run();
`,
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

describe("compile/aot/independent-statements-change-places", () => {
  const folder = String(tempDir("aot-statements-change-places", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  let numberOfTexts = 0;

  // Under a sanitizer the cases of a file run beside one another (../supported.ts): each text lies in a folder of its own, or one case builds what another has just written.
  async function tablesOf(text: string) {
    const own = join(folder, String(++numberOfTexts));
    mkdirSync(own);
    writeFileSync(join(own, "entry.js"), text);
    const wire = join(own, "program.ir");
    await build({ folder: own, entry: "./entry.js" }, [withProgramOutput(wire)]);
    const readings: string[] = [];
    for (const reading of [[], ["held"]]) {
      const { lines, exitCode } = await run(
        "link",
        wire,
        ...reading,
        "threads=1",
        "mechanisms=all",
        "exclude=CodeOutsideImage",
      );
      expect(exitCode).toBe(0);
      expect(lines.length).toBeGreaterThan(20);
      readings.push(
        lines
          .filter(line => !/^(referrer|counts) /.test(line))
          .map(line =>
            line
              .replace(/\bv\d+\b/g, "v#")
              .replace(/ (cycle|rank)=\d+| leaf| takes-arrivals| in-queue-from-start/g, ""),
          )
          .sort()
          .join("\n"),
      );
    }
    rmSync(own, { recursive: true, force: true });
    return readings;
  }

  for (const [title, text] of Object.entries(programs)) {
    test(
      title,
      async () => {
        const swaps = swapsOf(text);
        expect(swaps.length).toBeGreaterThan(0);
        const asWritten = await tablesOf(text);
        for (const swap of swaps)
          expect({ swap: swap.title, tables: await tablesOf(swap.text) }).toEqual({
            swap: swap.title,
            tables: asWritten,
          });
      },
      600_000,
    );
  }

  test("the control: a store and the call that reads it change places, and the tables differ", async () => {
    expect(swapsOf(control).map(swap => swap.title)).toEqual([
      "other() <> held = two",
      "take(held) <> other()",
      "other() <> take(one)",
    ]);
    const dependent = swapsOf(control, true).find(swap => swap.title === "held = two <> take(held)")!;
    expect(await tablesOf(dependent.text)).not.toEqual(await tablesOf(control));
  }, 600_000);
});
