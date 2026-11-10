// A loop walks something by its places, in a function of some kind, with a handler or an early way out in or round the turn: the kind of function, times the loop, times what a turn does, times the handler, times what
// is walked, times who calls. Each program holds one of each and is built alone.
//
//   bun write-loop-with-a-handler-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<function>--<loop>--<turn>--<handler>--<walked>--<caller>.mjs
//   bun write-loop-with-a-handler-sweep.ts count
//   bun write-loop-with-a-handler-sweep.ts named <pattern> <folder> [most]
import { mkdirSync, writeFileSync } from "fs";

// How the function begins, what stands in every turn besides, and how a call of it is taken. BODY is its body, CALL the call.
const functions: [string, string, string, string][] = [
  ["a-function", "function work(walked, end) {\nBODY\n}", "", "CALL"],
  ["an-arrow", "const work = (walked, end) => {\nBODY\n};", "", "CALL"],
  [
    "a-method",
    "class Walker {\n  static work(walked, end) {\nBODY\n  }\n}\nconst work = (walked, end) => Walker.work(walked, end);",
    "",
    "CALL",
  ],
  ["an-async-function", "async function work(walked, end) {\nBODY\n}", "", "await CALL"],
  [
    "an-async-function-that-waits-in-the-turn",
    "async function work(walked, end) {\nBODY\n}",
    "await null;",
    "await CALL",
  ],
  ["a-generator", "function* work(walked, end) {\nBODY\n}", "", "[...CALL].length"],
  ["a-generator-that-yields-in-the-turn", "function* work(walked, end) {\nBODY\n}", "yield at;", "[...CALL].join()"],
  ["an-async-generator-that-yields-in-the-turn", "async function* work(walked, end) {\nBODY\n}", "yield at;", "(await Array.fromAsync(CALL)).join()"], // prettier-ignore
];

// TURN is what a turn does. `to` is the bound, a whole number made of the parameter.
const loops: [string, string][] = [
  ["for-upward", "for (let at = 0; at < to; at++) {\n  TURN\n}"],
  ["for-downward", "for (let at = to - 1; at >= 0; at--) {\n  TURN\n}"],
  ["while", "let at = 0;\nwhile (at < to) {\n  TURN\n  at = (at + 1) | 0;\n}"],
  ["do-while", "let at = 0;\ndo {\n  TURN\n  at = (at + 1) | 0;\n} while (at < to);"],
  ["for-with-two-questions", "let turns = 0;\nfor (let at = 0; to && turns++ < 8 && at < to; at++) {\n  TURN\n}"],
  ["endless-with-a-way-out", "for (let at = 0; ; at++) {\n  if (at >= to) break;\n  TURN\n}"],
  ["down-from-its-own-length", "for (let at = walked.length - 1; at >= 0; at--) {\n  TURN\n}"],
  [
    "the-inner-of-two",
    "for (let round = 0; round < 2; round++) {\n  for (let at = 0; at < to; at++) {\n    TURN\n  }\n}",
  ],
];

const turns: [string, string][] = [
  ["a-remainder-into-a-variable-of-the-file", "const one = walked[at];\nsum %= one;"],
  ["a-sum-into-a-variable-of-the-file", "sum += walked[at];"],
  [
    "a-field-of-a-record-of-the-file-under-a-typeof",
    'const one = walked[at];\nif (typeof one === "string") box.held = one.length;',
  ],
  ["a-text-of-the-file-grows", 'text += walked[at] + " ";'],
  ["neighbors-are-compared", "if (at > 0 && walked[at] === walked[at - 1]) count++;"],
  ["a-list-of-the-file-is-pushed-to", "list.push(walked[at]);"],
];

// INNER is the turn's own work, LOOP the whole loop.
const handlers: [string, string, string][] = [
  ["no-handler", "INNER", "LOOP"],
  [
    "a-throw-caught-in-the-turn",
    'INNER\ntry {\n  if (at === 2) throw new Error("turn");\n  count++;\n} catch (error) {\n  text += "caught" + at;\n}',
    "LOOP",
  ],
  [
    "the-work-in-a-try-in-the-turn",
    'try {\n  INNER\n  if (at === 2) throw new Error("turn");\n} catch (error) {\n  text += "caught" + at;\n}',
    "LOOP",
  ],
  ["a-finally-in-the-turn", "try {\n  INNER\n} finally {\n  count++;\n}", "LOOP"],
  [
    "a-try-round-the-loop",
    'INNER\nif (at === 2) throw new Error("turn");',
    'try {\n  LOOP\n} catch (error) {\n  text += "caught";\n}',
  ],
  ["left-early-under-an-if", "INNER\nif (at === 2) break;", "LOOP"],
  ["an-if-in-front-of-the-work", "if (at === 1 && count < 9) {\n  count += 10;\n}\nINNER", "LOOP"],
];

const walkeds: [string, string][] = [
  ["a-parsed-text", "JSON.parse('\"abcd\"')"],
  ["a-written-text", '"aabb"'],
  ["a-parsed-list-of-whole-numbers", 'JSON.parse("[1,5,2,4]")'],
  ["a-parsed-list-with-fractions", 'JSON.parse("[1.5,5,2.25,4]")'],
  ["a-typed-list", "Uint8Array.of(1, 5, 2, 4)"],
  ["an-arguments-object", "(function () {\n  return arguments;\n})(1, 5, 2, 4)"],
  ["a-record-with-a-length", "{ length: 4, 0: 1, 1: 5, 2: 2, 3: 4 }"],
  ["a-list-with-a-hole", "[1, , 2, 4]"],
];

const callers = ["once-under-a-try", "in-a-loop-of-one-turn", "three-times-with-other-bounds"];

const all = functions.length * loops.length * turns.length * handlers.length * walkeds.length * callers.length;

const indented = (text: string, by = "  ") => by + text.replaceAll("\n", "\n" + by);
const joined = (...parts: string[]) => parts.filter(Boolean).join("\n");
const laid = (text: string, mark: string, what: string) =>
  text.replace(new RegExp(`^( *)${mark}$`, "m"), (_, by) => indented(what, by));

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [handler, inTurn, roundLoop] = pick(handlers);
  const [loop, walks] = pick(loops);
  const [kind, begins, besides, taken] = pick(functions);
  const [turn, works] = pick(turns);
  const [walked, made] = pick(walkeds);
  const caller = pick(callers);
  const body = joined(
    "const to = end | 0;",
    laid(roundLoop, "LOOP", laid(walks, "TURN", joined(laid(inTurn, "INNER", works), besides))),
    kind.includes("generator") ? "" : "return count;",
  );
  const work = laid(begins, "BODY", indented(body, begins.startsWith("class") ? "    " : "  "));
  const call = (end: string) =>
    joined(
      "try {",
      `  said = String(${taken.replace("CALL", () => `work(${made.includes("\n") || made.startsWith("{") ? "made()" : made}, ${end})`)});`,
      "} catch (error) {",
      "  said = error.constructor.name;",
      "}",
      'console.log("SAID " + [said, sum, box.held, text, count, list.join()].join(" | "));',
    );
  const calls =
    caller === "once-under-a-try"
      ? call("4")
      : caller === "in-a-loop-of-one-turn"
        ? joined("for (let round = 0; round < 1; round++) {", indented(call("9")), "}")
        : joined(call("3"), call("0"), call("4"));
  return {
    name: `${kind}--${loop}--${turn}--${handler}--${walked}--${caller}.mjs`,
    text:
      joined(
        "let sum = 0.5;",
        'let text = "";',
        "let count = 0;",
        "const box = { held: 0 };",
        "const list = [];",
        made.includes("\n") || made.startsWith("{") ? `const made = () => (${made});` : "",
        work,
        "let said;",
        calls,
      ) + "\n",
  };
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
