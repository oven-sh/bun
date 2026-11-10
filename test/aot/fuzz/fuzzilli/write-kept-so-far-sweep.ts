// A loop walks a list of numbers, keeps something so far and stores it into a second list: how the list is walked, times what is kept, times how it is stored, times where the list comes from, times what the second
// list is, times who calls. Each program holds one of each and is built alone.
//
//   bun write-kept-so-far-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<walk>--<kept>--<stored>--<source>--<second>--<caller>.js
//   bun write-kept-so-far-sweep.ts count
//   bun write-kept-so-far-sweep.ts named <pattern> <folder> [most]
import { mkdirSync, writeFileSync } from "fs";

// TURN is what a turn does. `list` is the list, `at` the place of the turn.
const walks: [string, string][] = [
  ["down-from-the-end", "for (let at = list.length - 1; at >= 0; at--) {\n  TURN\n}"],
  ["up-from-the-start", "for (let at = 0; at < list.length; at++) {\n  TURN\n}"],
  ["up-to-a-length-read-once", "for (let at = 0, most = list.length; at < most; at++) {\n  TURN\n}"],
  ["down-by-a-while", "let at = list.length;\nwhile (at-- > 0) {\n  TURN\n}"],
  ["up-by-a-do-while", "let at = 0;\nif (list.length > 0)\n  do {\n    TURN\n  } while (++at < list.length);"],
  ["by-for-of-with-a-counter", "let at = -1;\nfor (const each of list) {\n  at++;\n  TURN\n}"],
  ["down-two-at-a-time", "for (let at = list.length - 1; at >= 0; at -= 2) {\n  TURN\n}"],
  ["by-a-method-of-the-list", "list.forEach((each, at) => {\n  TURN\n});"],
];

// What stands in front of the loop, and what a turn does to it.
const kepts: [string, string, string][] = [
  ["the-greatest-by-an-if", "let kept = -1;", "if (list[at] > kept) kept = list[at];"],
  ["the-least-by-an-if", "let kept = 1e9;", "if (list[at] < kept) kept = list[at];"],
  ["the-greatest-by-a-choice", "let kept = -1;", "kept = list[at] > kept ? list[at] : kept;"],
  ["the-greatest-by-a-built-in", "let kept = -1;", "kept = Math.max(kept, list[at]);"],
  ["the-sum", "let kept = 0;", "kept += list[at];"],
  ["the-count-of-the-great-ones", "let kept = 0;", "if (list[at] > 2) kept++;"],
  ["the-one-seen-last", "let kept;", "kept = list[at];"],
  ["the-place-of-the-greatest", "let kept = -1;", "if (kept < 0 || list[at] > list[kept]) kept = at;"],
  ["the-greatest-read-once", "let kept = -1;", "const one = list[at];\nif (one > kept) kept = one;"],
];

const storeds: [string, string][] = [
  ["one-place-further", "second[at + 1] = kept;"],
  ["at-the-same-place", "second[at] = kept;"],
  ["pushed", "second.push(kept);"],
  ["at-the-length", "second[second.length] = kept;"],
  ["mirrored", "second[list.length - 1 - at] = kept;"],
  ["under-an-if", "if (kept > 1) second[at] = kept;"],
  ["added-to-what-is-there", "second[at] = (second[at] ?? 0) + kept;"],
  ["into-the-list-itself", "list[at] = kept;"],
];

const sources: [string, string][] = [
  ["parsed", 'JSON.parse("[1,5,2,4]")'],
  ["written", "[1, 5, 2, 4]"],
  ["parsed-with-fractions", 'JSON.parse("[1.5,5,2.25,4]")'],
  ["made-by-a-built-in", "Array.from({ length: 4 }, (_, at) => (at * 7) % 5)"],
  ["a-typed-list", "Float64Array.of(1, 5, 2, 4)"],
  ["with-a-hole", "[1, , 2, 4]"],
  ["empty", "[]"],
];

// Where the second list is made: at the top and handed in, or in front of the loop.
const seconds: [string, string, boolean][] = [
  ["an-empty-list-handed-in", "[]", true],
  ["an-empty-list-made-in-front", "[]", false],
  ["a-list-of-a-length-made-in-front", "new Array(list.length)", false],
  ["a-filled-list-made-in-front", "new Array(list.length + 1).fill(0)", false],
  ["a-typed-list-handed-in", "new Float64Array(6)", true],
];

const callers = ["called-once", "called-in-a-loop", "a-method-called-once"];

const all = walks.length * kepts.length * storeds.length * sources.length * seconds.length * callers.length;

const indented = (text: string, by = "  ") => by + text.replaceAll("\n", "\n" + by);
const joined = (...parts: string[]) => parts.filter(Boolean).join("\n");

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [kept, begins, keeps] = pick(kepts);
  const [walk, walks_] = pick(walks);
  const [stored, stores] = pick(storeds);
  const [second, makes, handedIn] = pick(seconds);
  const [source, made] = pick(sources);
  const caller = pick(callers);
  const body = joined(
    handedIn ? "" : `const second = ${makes};`,
    begins,
    walks_.replace(/^( *)TURN$/m, (_, by) => indented(joined(keeps, stores), by)),
    'return String(kept) + " | " + Array.from(second).join();',
  );
  const takes = handedIn ? "(list, second)" : "(list)";
  const hands = handedIn ? `(${made}, ${makes})` : `(${made})`;
  const tried = (call: string) => joined("try {", `  console.log("SAID " + ${call});`, "} catch (error) {", '  console.log("SAID " + error.constructor.name);', "}"); // prettier-ignore
  const text =
    caller === "a-method-called-once"
      ? joined(
          "class Walker {",
          indented(joined(`static work${takes} {`, indented(body), "}")),
          "}",
          tried(`Walker.work${hands}`),
        )
      : joined(
          `function work${takes} {`,
          indented(body),
          "}",
          caller === "called-once"
            ? tried(`work${hands}`)
            : joined("for (let round = 0; round < 3; round++) {", indented(tried(`work${hands}`)), "}"),
        );
  return { name: `${walk}--${kept}--${stored}--${source}--${second}--${caller}.js`, text: text + "\n" };
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
