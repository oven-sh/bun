// Regular expression literals that hold a run of places, each a letter or a class: every split of five to fifteen places, of sixteen to twenty-seven those with few classes and drawn ones, and shorter lists of runs that
// stand inside a longer pattern or hold an odd character; times which class stands where, times the flag. Each is asked over a text that matches and over texts
// that differ from it in one place, narrow and with a character above U+00FF in front or behind, once with an ordinary character in the place of each class and once with the lowest that it takes.
//
//   bun write-literal-pattern-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<kind of runs>--<classes>--<flag>--part-<k>.cjs
//   bun write-literal-pattern-sweep.ts count
//   bun write-literal-pattern-sweep.ts named <pattern> <folder> [most]
//
// A program holds up to 4,096 literals and prints a line for each: its source and a digest of all its answers. `<program> <source>` prints every text and answer of the one literal.
//
// A compiler of patterns compares several neighboring letters by one load and one mask, and takes the load apart differently for texts of one and of two bytes a character. How the letters are grouped hangs on where the
// classes stand between them.
import { mkdirSync, writeFileSync } from "node:fs";
import { printThroughBranch } from "./print-through-branch.ts";

const letters = "ghijklmnopqrstuvwxy";
const classes = ["\\d", "[^z]", "[a-f]", "."];
// Characters that have no case, as a pattern writes them and as a text holds them.
const marks = ["-", "\\.", "_", "5"];
const marksInTexts = "-._5";
const rotations = ["digits-first", "all-but-one-first", "a-range-first", "any-first"];
const flags: [name: string, text: string][] = [
  ["no-flag", ""],
  ["ignoring-case", "i"],
  ["sticky", "y"],
  ["global", "g"],
  ["unicode", "u"],
  ["ignoring-case-and-unicode", "iu"],
  ["sets", "v"],
  ["ignoring-case-and-sets", "iv"],
];
const most = 4096;

// A run: how many places, which of them are classes, and which place, if any, holds the odd character.
type Run = [places: number, split: number, odd: number];
/** Every split of `places` with at most `few` classes. */
function withFew(places: number, few: number): number[] {
  const found = [0];
  const add = (from: number, split: number, left: number) => {
    for (let i = from; i < places; i++) {
      found.push(split | (1 << i));
      if (left > 1) add(i + 1, split | (1 << i), left - 1);
    }
  };
  add(0, 0, few);
  return found;
}
function drawn(places: number): number[] {
  const found: number[] = [];
  for (let at = 0, x = Math.imul(places, 2654435761) >>> 0; at < most; at++)
    found.push((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> (32 - places));
  return found;
}
const lengths = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, at) => from + at);
const short = () => lengths(7, 27).flatMap(places => withFew(places, 2).map((split): Run => [places, split, -1]));
const withAnOddOne = () =>
  lengths(12, 27).flatMap(places =>
    withFew(places, 1).flatMap(split =>
      lengths(0, places - 1)
        .filter(odd => !((split >> odd) & 1))
        .map((odd): Run => [places, split, odd]),
    ),
  );

// What stands around the run in the pattern, and what the text needs in front of the run for it.
type Kind = {
  name: string;
  runs: () => Run[];
  before?: string;
  behind?: string;
  lead?: string;
  odd?: string;
  digits?: true;
  /** A place that is no letter holds a character without a case, not a class. */
  marks?: true;
  /** The pattern is written as \`new RegExp(text, flags)\`: of written texts, or with its text, the two halves of its text or its flags parsed out of data. */
  made?: "written" | "text-from-data" | "halves-from-data" | "flags-from-data";
};
const allSplits = (places: number) => () => lengths(0, 2 ** places - 1).map((split): Run => [places, split, -1]);
const kindsOfPrograms: Kind[] = [
  ...lengths(5, 15).map(places => ({
    name: `${places}-places`,
    runs: () => lengths(0, 2 ** places - 1).map((split): Run => [places, split, -1]),
  })),
  ...lengths(16, 27).map(places => ({
    name: `${places}-places-with-few-classes`,
    runs: () => withFew(places, 4).map((split): Run => [places, split, -1]),
  })),
  ...lengths(16, 27).map(places => ({
    name: `${places}-places-drawn`,
    runs: () => drawn(places).map((split): Run => [places, split, -1]),
  })),
  { name: "last-in-an-alternative", runs: short, before: "(?:zz|", behind: ")" },
  { name: "first-in-an-alternative", runs: short, before: "(?:", behind: "|zz)" },
  { name: "a-term-that-may-be-absent-behind", runs: short, behind: "z*" },
  { name: "the-end-behind", runs: short, behind: "$" },
  { name: "behind-a-group", runs: short, before: "(?:vw)", lead: "vw" },
  { name: "behind-a-term-that-repeats", runs: short, before: "w+", lead: "ww" },
  { name: "in-a-capture", runs: short, before: "(", behind: ")" },
  { name: "digits-beside-letters", runs: short, digits: true },
  { name: "a-zero-among-the-letters", runs: withAnOddOne, odd: "\\x00" },
  { name: "the-last-narrow-character-among-the-letters", runs: withAnOddOne, odd: "\\xff" },
  { name: "a-wide-character-among-the-letters", runs: withAnOddOne, odd: "\\u0100" },
  ...lengths(5, 15).map(
    (places): Kind => ({ name: `${places}-places-of-letters-and-marks`, runs: allSplits(places), marks: true }),
  ),
  ...lengths(16, 27).map(
    (places): Kind => ({
      name: `${places}-places-of-letters-and-few-marks`,
      runs: () => withFew(places, 4).map((split): Run => [places, split, -1]),
      marks: true,
    }),
  ),
  ...lengths(5, 15).map(
    (places): Kind => ({ name: `${places}-places-made-from-a-text`, runs: allSplits(places), made: "written" }),
  ),
  ...lengths(5, 15).map(
    (places): Kind => ({
      name: `${places}-places-of-letters-and-marks-made-from-a-text`,
      runs: allSplits(places),
      marks: true,
      made: "written",
    }),
  ),
  ...lengths(5, 15).map(
    (places): Kind => ({
      name: `${places}-places-made-from-a-text-out-of-data`,
      runs: allSplits(places),
      made: "text-from-data",
    }),
  ),
  ...lengths(5, 15).map(
    (places): Kind => ({
      name: `${places}-places-of-letters-and-marks-made-from-a-text-out-of-data`,
      runs: allSplits(places),
      marks: true,
      made: "text-from-data",
    }),
  ),
  { name: "made-from-two-halves-out-of-data", runs: short, made: "halves-from-data" },
  { name: "letters-and-marks-made-from-two-halves-out-of-data", runs: short, marks: true, made: "halves-from-data" },
  { name: "made-with-flags-out-of-data", runs: short, made: "flags-from-data" },
  { name: "letters-and-marks-made-with-flags-out-of-data", runs: short, marks: true, made: "flags-from-data" },
];
const parts: [kind: Kind, part: number][] = kindsOfPrograms.flatMap(kind =>
  lengths(0, Math.ceil(kind.runs().length / most) - 1).map((part): [Kind, number] => [kind, part]),
);

const all = flags.length * rotations.length * parts.length;

const helper = `"use strict";
// What matches a class, what is laid in its place (the nearest characters outside it, and one that has its low byte), and the lowest character that matches it: a place that is wrongly compared is compared with zero.
const kinds = { A: ["5", "x:/\\u0135", "0"], B: ["q", "z\\0\\u017aZ", "\\0"], C: ["c", "g\`\\u0163C", "a"], D: ["-", "\\n\\r\\u2028\\u0100", "\\0"] };
const wraps = [["", ""], [">", ""], ["\\u2192", ""], ["", "\\u2192"], ["\\u2192 ", " end"]];
const only = process.argv[2];
function run(re, spec, lead = "") {
  if (only !== undefined && only !== re.source) return;
  let digest = 2166136261;
  const ask = text => {
    for (const [front, behind] of wraps) {
      const subject = front + lead + text + behind;
      re.lastIndex = front.length;
      const tested = re.test(subject);
      re.lastIndex = front.length;
      const found = re.exec(subject);
      const at = found === null ? -1 : found.index;
      digest = Math.imul(digest ^ ((tested ? 1 : 0) + 2 * (at + 1)), 16777619);
      if (only !== undefined) console.log(JSON.stringify(subject), tested, at);
    }
  };
  for (const filling of [0, 2]) {
    const match = Array.from(spec, place => kinds[place]?.[filling] ?? place);
    ask(match.join(""));
    for (let i = 0; i < match.length; i++) {
      const code = spec.charCodeAt(i);
      const others = kinds[spec[i]]?.[1] ?? "X" + spec[i].toUpperCase() + String.fromCharCode(code + 256, code + 1);
      for (const other of others) {
        const text = match.slice();
        text[i] = other;
        ask(text.join(""));
      }
    }
  }
  console.log(re.source, (digest >>> 0).toString(16));
}
`;

function write(at: number) {
  const pick = <T>(from: T[]) => {
    const each = from[at % from.length];
    at = Math.floor(at / from.length);
    return each;
  };
  const [kind, part] = pick(parts),
    rotation = pick([0, 1, 2, 3]),
    [flag, text] = pick(flags);
  const lines = kind
    .runs()
    .slice(part * most, (part + 1) * most)
    .map(([places, split, odd]) => {
      let source = "",
        spec = "";
      for (let i = 0; i < places; i++) {
        const which = (i + rotation) % classes.length;
        const letter = kind.digits && i & 1 ? String(i % 10) : letters[i % letters.length];
        source += (split >> i) & 1 ? (kind.marks ? marks : classes)[which] : i === odd ? kind.odd : letter;
        spec +=
          (split >> i) & 1
            ? (kind.marks ? marksInTexts : "ABCD")[which]
            : i === odd
              ? JSON.parse(`"${kind.odd!.replace("\\x", "\\u00")}"`)
              : letter;
      }
      const lead = kind.lead ? `, "${kind.lead}"` : "";
      const whole = `${kind.before ?? ""}${source}${kind.behind ?? ""}`;
      const written = (one: string) => JSON.stringify(one);
      const parsed = (one: string) => `JSON.parse(${JSON.stringify(JSON.stringify(one))})`;
      const middle = whole.length >> 1;
      const pattern =
        kind.made === undefined
          ? `/${whole}/${text}`
          : kind.made === "written"
            ? `new RegExp(${written(whole)}, ${written(text)})`
            : kind.made === "text-from-data"
              ? `new RegExp(${parsed(whole)}, ${written(text)})`
              : kind.made === "halves-from-data"
                ? `new RegExp(${parsed(whole.slice(0, middle))} + ${parsed(whole.slice(middle))}, ${written(text)})`
                : `new RegExp(${written(whole)}, ${parsed(text)})`;
      return `  run(${pattern}, ${JSON.stringify(spec)}${lead});`;
    });
  let body = "";
  for (let from = 0; from < lines.length; from += 256)
    body += `function some${from / 256}() {\n${lines.slice(from, from + 256).join("\n")}\n}\nsome${from / 256}();\n`;
  return { name: `${kind.name}--${rotations[rotation]}--${flag}--part-${part}.cjs`, text: helper + body };
}

const pad = (at: number) => String(at).padStart(4, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
  }
  console.log(Math.min(count, all));
}
