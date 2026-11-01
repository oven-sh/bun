// `text.match(/../g)` whose list is read only for its length, or only asked whether it is there. The compiler need not make the
// list, but all that a global match does besides must still happen: lastIndex is read, set to 0 and left at 0, an empty match
// steps on by one character or one code point, a sticky pattern stops at the first gap, RegExp remembers the last match, and a
// pattern that is not what it seems runs the program's own code. Each scene picks a pattern, a subject and what is read, and
// prints what can be seen afterwards as well. In some iterations the list is used after all.
import type { Random } from "./random";

/** Pattern literals with the g flag. */
const patterns = [
  "/[aeiou]/g",
  "/[aeiou]/g",
  "/a/g",
  "/a*/g",
  "/(?:)/g",
  "/\\b/g",
  "/$/g",
  "/^/gm",
  "/./g",
  "/./gu",
  "/./gs",
  "/(?:)/gu",
  "/\\p{L}/gu",
  "/[\\p{L}--[a-z]]/gv",
  "/a/gy",
  "/a*/gy",
  "/a|b/gi",
  "/(a)(b)?/g",
  "/(?<first>a)/g",
  "/(?=a)/g",
  "/(?<=a)/g",
  "/aa/g",
  "/\\d+/g",
  "/x{2,}/g",
  "/\\uD83D/g",
  "/a/gd",
];

const subjects = [
  '"banana"',
  '"banana"',
  '""',
  '"aaa"',
  '"xyz"',
  '"a\\u{1F600}a"',
  '"\\uD83D\\uDE00"',
  '"line\\nline\\n"',
  '"AbAb"',
  '"12 and 345"',
  'word("banana")',
  '("ban" + word("ana"))',
  '"a".repeat(i % 5)',
  "String(i)",
  '"xxxx x xx"',
];

/** Expressions that read the result of MATCH without keeping its list. */
const reads = [
  "MATCH.length",
  "MATCH?.length",
  "(MATCH || []).length",
  "(MATCH ?? []).length",
  "MATCH === null",
  "MATCH !== null",
  "!!MATCH",
  "MATCH ? 1 : 0",
  "(MATCH?.length ?? 0) > 2",
  "MATCH?.length || 0",
  "typeof MATCH",
  "Array.isArray(MATCH)",
  "MATCH?.[0]",
  "MATCH?.at(-1)",
  "MATCH?.join()",
  "MATCH?.index",
];

/** Statements before the match. `pattern` is the pattern where the scene keeps it in a variable. */
const before = [
  "",
  "",
  "",
  "pattern.lastIndex = 2;",
  "pattern.lastIndex = 100;",
  "pattern.lastIndex = -1;",
  'pattern.lastIndex = { valueOf: () => (log.push("valueOf"), 1) };',
  '/zzz|(n)/.exec("n");',
  "if (isRare) Object.freeze(pattern);",
  'if (isRare) Object.defineProperty(pattern, "lastIndex", { writable: false });',
  'if (isRare) pattern.exec = () => (log.push("own exec"), null);',
  'if (isRare) Object.defineProperty(pattern, "flags", { value: "" });',
  'if (isRare) Object.defineProperty(pattern, "global", { value: false });',
  'if (isRare) pattern[Symbol.match] = () => (log.push("own match"), ["own"]);',
  'if (isRare) pattern.compile("n", "g");',
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const literal = random.pick(patterns);
    // A literal in place is made anew for every match. One that is kept in a variable carries its lastIndex along.
    const isKept = random.chance(0.5);
    const match = `subject.match(${isKept ? "pattern" : literal})`;
    const when = random.pick(["i === 1", "i === turns - 1", "i % 97 === 5", "false", "false"]);
    // Mostly a small function of its own makes the match and reads it, as programs do. Under a handler less is left unbuilt.
    const isApart = random.chance(0.7);
    const read = random.pick(reads).replace(/^MATCH\./, typed ? "MATCH!." : "MATCH.").replaceAll("MATCH", match); // prettier-ignore
    const apart = `function read${scene}(subject${as("string")}${isKept ? `, pattern${as("RegExp")}` : ""}) {\n  return ${read};\n}\n`;
    scenes.push(`${isApart ? apart : ""}function scene${scene}(turns${as("number")})${as("string")} {
  const answers = new Set${typed ? "<string>" : ""}();
  ${isKept && random.chance(0.5) ? `const pattern${as("any")} = ${literal};` : ""}
  for (let i = 0; i < turns; i++) {
    const isRare = ${when};
    let line = "";
    try {
      const subject${as("string")} = ${random.pick(subjects)};
      ${isKept ? `PATTERN` : ""}
      ${isKept ? random.pick(before) : random.pick(["", "", '/zzz|(n)/.exec("n");'])}
      line += ${isApart ? `read${scene}(subject${isKept ? ", pattern" : ""})` : read};
      ${random.chance(0.3) ? `if (isRare) line += "," + ${match}?.join();` : ""}
      line += ${random.pick(['""', '""', '"," + RegExp.lastMatch + "," + RegExp.$1', '"," + RegExp.leftContext + "|" + RegExp.rightContext', '"," + RegExp.lastParen'])};
      ${isKept ? 'line += "," + pattern.lastIndex;' : ""}
    } catch (error) {
      line += "threw " + ${typed ? "(error as Error)" : "error"}.name;
    }
    // The iteration's number is taken out, so that the usual iterations give one answer.
    answers.add(line.replaceAll(String(i), "i"));
  }
  return [...answers].slice(0, 6).join(" | ");
}
console.log("scene ${scene}", scene${scene}(${random.pick([1, 3, 300, 3000])}), log.length, log.splice(0).slice(0, 3).join());`);
    const last = scenes.length - 1;
    // Where no variable outside the loop holds the pattern, each iteration makes its own.
    scenes[last] = scenes[last].replace(
      "PATTERN",
      scenes[last].includes(`const pattern${as("any")} = ${literal};\n  for`)
        ? ""
        : `const pattern${as("any")} = ${literal};`,
    );
  }
  return `const log${as("string[]")} = [];
const word = (text${as("string")})${as("string")} => process.argv[9] ?? text;
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
