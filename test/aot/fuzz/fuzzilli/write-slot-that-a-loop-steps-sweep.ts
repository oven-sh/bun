// A closure's loop reads and stores a variable of the function round it, and the closure is first called above the line that declares the variable, beside write-variable-that-a-loop-uses-sweep.ts: what a turn does
// to the variable, times the loop, times who calls early, times what the variable is born with, times how many turns the early call takes, times where it all stands. Each program holds one of each and is built alone.
//
//   bun write-slot-that-a-loop-steps-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<stepped>--<loop>--<early>--<born>--<turns>--<where>.cjs
//   bun write-slot-that-a-loop-steps-sweep.ts count
//   bun write-slot-that-a-loop-steps-sweep.ts named <pattern> <folder> [most]
//
// Above its line a `let`, a `const`, a class or a later parameter cannot be read or stored: the first turn throws a ReferenceError. A call that takes no turn touches nothing and throws nothing.
import { mkdirSync, writeFileSync } from "fs";

// What a turn does where the variable can be stored. `at` is the counter of the loop.
const steppeds: [string, string][] = [
  ["plus-a-fraction", "total += at * 0.5;"],
  ["plus-a-whole-number", "total += at;"],
  ["written-out-as-a-sum", "total = total + at;"],
  ["minus", "total -= at;"],
  ["times", "total *= 2;"],
  ["times-and-plus", "total = total * 3 + at;"],
  ["stepped-by-one", "total++;"],
  ["read-first-and-stored-under-an-if", "if (total < 100) total += at;"],
  ["two-variables", "total += at;\nother += total;"],
];

// TURN is what a turn does.
const loops: [string, string][] = [
  ["for", "for (let at = 0; at < turns; at++) {\n  TURN\n}"],
  ["while", "let at = 0;\nwhile (at < turns) {\n  TURN\n  at++;\n}"],
  ["do-while", "let at = 0;\nif (turns > 0)\n  do {\n    TURN\n    at++;\n  } while (at < turns);"],
  ["downward", "for (let at = turns; at > 0; at--) {\n  TURN\n}"],
  [
    "the-inner-of-two",
    "for (let round = 0; round < turns; round++) {\n  for (let at = 0; at < 2; at++) {\n    TURN\n  }\n}",
  ],
];

// What stands in front of the early call, and the call. `add` is the closure, `early` how many turns it is to take.
const earlies: [string, string, string][] = [
  ["above-the-line", "", "add(early)"],
  ["through-the-global-object", "globalThis.road = add;", "globalThis.road(early)"],
  ["by-a-closure-one-scope-further-in", "const inner = () => add(early);", "inner()"],
  ["by-a-method-of-a-list", "", "[early].map(turns => add(turns))[0]"],
  ["out-of-another-file", "", 'require("./other.cjs").call(add, early)'],
];

// The line that declares the variable, what a turn does where the variable cannot be stored, and how the variable is shown at the end.
const borns: [string, string, string, string][] = [
  ["a-let-with-a-number", "let total = 1;", "", "total"],
  ["a-let-without-a-value", "let total;\ntotal = 1;", "", "total"],
  ["a-const", "const total = 1;", "seen += total + at;", "total"],
  ["a-class", "class total {\n  static step = 2;\n}", "seen += total.step + at;", "total.step"],
  ["a-later-parameter", "", "", "total"],
];

const counts: [string, string][] = [
  ["no-turn-at-first", 'Number("0")'],
  ["two-turns-at-first", 'Number("2")'],
];

const wheres: [string, string, string][] = [
  ["in-a-function", "", ""],
  ["two-functions-deep", "(function whole() {", "})();"],
  ["in-a-method", "class Whole {\n  static run() {", "  }\n}\nWhole.run();"],
];

const all = steppeds.length * loops.length * earlies.length * borns.length * counts.length * wheres.length;

const indented = (text: string, by = "  ") => by + text.replaceAll("\n", "\n" + by);
const joined = (...parts: string[]) => parts.filter(Boolean).join("\n");

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [stepped, stores] = pick(steppeds);
  const [loop, walks] = pick(loops);
  const [early, inFront, calls] = pick(earlies);
  const [born, declares, readsAlone, shown] = pick(borns);
  const [count, first] = pick(counts);
  const [where, opens, closes] = pick(wheres);
  const closure = joined(
    "turns => {",
    indented(walks.replace(/^( *)TURN$/m, (_, by) => indented(readsAlone || stores, by))),
    "  return turns;",
    "}",
  );
  const two = stepped === "two-variables" && !readsAlone;
  const tried = `tried(() => ${calls})`;
  const helper =
    "function tried(run) {\n  try {\n    return run();\n  } catch (error) {\n    return error.constructor.name;\n  }\n}";
  const ends = `return result + ":" + add(Number("5")) + ":" + ${shown}${two ? ' + "," + other' : ""} + ":" + seen;`;
  const outer =
    born === "a-later-parameter"
      ? joined(
          `function outer(early, add = ${closure}, result = ${inFront ? `(${inFront.replace(/^const inner = /, "inner = ").replace(/;$/, "")}, ${tried})` : tried}, total = 1${two ? ", other = 0" : ""}) {`,
          indented(ends),
          "}",
        )
      : joined(
          "function outer(early) {",
          indented(
            joined(
              `const add = ${closure};`,
              inFront,
              `const result = ${tried};`,
              declares,
              two ? "let other = 0;" : "",
              ends,
            ),
          ),
          "}",
        );
  const inside = joined("let seen = 0;", born === "a-later-parameter" && early === "by-a-closure-one-scope-further-in" ? "let inner;" : "", helper, outer, `console.log("SAID " + outer(${first}));`, `console.log("SAID " + outer(${first}));`); // prettier-ignore
  const file =
    where === "in-a-function" ? inside : joined(opens, indented(inside, opens.includes("\n") ? "    " : "  "), closes);
  const text =
    early === "out-of-another-file"
      ? joined(file, "// @filename: ./other.cjs", "exports.call = (run, turns) => run(turns);")
      : file;
  return { name: `${stepped}--${loop}--${early}--${born}--${count}--${where}.cjs`, text: text + "\n" };
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
