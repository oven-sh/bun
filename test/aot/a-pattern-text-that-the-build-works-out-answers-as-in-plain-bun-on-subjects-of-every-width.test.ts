// A pattern text that the build works out gets no code for 16-bit subjects where the build proves that the pattern matches no subject with a character of more than one byte; such a subject is
// then answered "no match" without a search. Whether the proof holds is asked here of every kind of atom in every kind of frame: runs, groups, references to groups (numbered, named, forward,
// to a group that an assertion filled, in a lookbehind), assertions; under the flags that change what a character is or what it equals; on subjects that are narrow, that have 16 bits a character by
// their storage alone, and that hold wider characters: those that equal a narrow one without regard to case, ends of lines, surrogate pairs and their halves.
// The texts stand in a table that a loop goes through: a constant that flow folds is as good as a literal, which has both kinds of code.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./harness/commands";
import { test } from "./supported";

const atoms = [
  "a", "[a-z]", "\\w", "\\d", "\\s", "\\S", "\\W", "\\D", ".", "[^a]", "\\xff", "\\xb5", "k", "s", "\\xe5", "[\\x80-\\xff]", "\\u212a", "\\u017f", "[\\s\\S]", "[a-z\\u2500]", "(?:a|\\u2500)", "\\u2500",
  "[k-s]", "\\b", "\\B", "(?:)",
]; // prettier-ignore
const frames = [
  "^X$", "^X+$", "^X*$", "^(X)\\1$", "^(X)\\1*$", "^(?=(X))\\1$", "^(?=(X+))\\1$", "^(?=(X*))\\1$", "^(?<n>X)\\k<n>$", "^(?=(?<n>X))\\k<n>$", "^(?:(?=(X))\\1)+$", "^a?(?<=(X))\\1?$", "^(?<=(X)?)\\1?a?$",
  "^\\1(X)$", "^(?:\\1(X))+$", "^(?:(X)|b)\\1$", "^(?!(?!(X)))\\1?a?$", "^(?=X)[a-c]+$", "^(?!X)[a-c]+$", "^[a-c]+(?<=X)$", "^[a-c]+(?<!X)$", "^(?=(X))(?=(\\1))\\2$", "^(?=(X)(X))\\2\\1$", "^(?=((X)))\\2$",
  "^(?=(X))a?\\1$|^b$", "^b$|^(?=(X))\\1$",
]; // prettier-ignore
const flagSets = ["", "i", "u", "iu", "v", "s", "m", "g", "y"];
const narrow = [
  "",
  "a",
  "b",
  "aa",
  "ab",
  "abc",
  "k",
  "s",
  "K",
  "S",
  "\xff",
  "\xb5",
  "\xe5",
  "\xc5",
  "\xe9\xff",
  " ",
  "\n",
  "0",
  "_",
];
const wide = [
  "\u2500", "a\u2500", "\u2500a", "\u2500\u2500", "\u2603", "\u0178", "\u039c", "\u03bc", "\u212a", "\u212a\u212a", "k\u212a", "\u017f", "\u017f\u017f", "s\u017f", "\u212b", "\xe5\u212b", "\u2028", "\ufeff",
  "\u0100", "\u{1F600}", "\u{1F600}\u{1F600}", "a\u{1F600}", "\ud83d", "\ude00", "\ud83d\ud83d", "a\ud83d",
]; // prettier-ignore

const ascii = (value: unknown) =>
  JSON.stringify(value).replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
const texts = frames.flatMap(frame => atoms.map(atom => frame.replaceAll("X", atom)));
const program = `const texts = ${ascii(texts)};
const flagSets = ${ascii(flagSets)};
const nothing = process.argv.length > 99 ? "x" : "";
const stored16 = text => (text + "\\u2500" + nothing).split("\\u2500")[0];
const narrow = ${ascii(narrow)};
const wide = ${ascii(wide)};
const lines = [];
for (let at = 0; at < texts.length; at++) {
  for (let set = 0; set < flagSets.length; set++) {
    let made;
    try {
      made = new RegExp(texts[at], flagSets[set]);
    } catch (error) {
      lines.push("/" + texts[at] + "/" + flagSets[set] + " " + error.name);
      continue;
    }
    const subjects = [...narrow, ...narrow.map(stored16), ...wide];
    let answers = "";
    for (let index = 0; index < subjects.length; index++) {
      const subject = subjects[index];
      made.lastIndex = 0;
      answers += made.test(subject) ? "1" : "0";
      made.lastIndex = 0;
      const found = made.exec(subject);
      answers += found ? found[0].length : "-";
      made.lastIndex = 0;
      answers += subject.search(made) + 1;
      made.lastIndex = 0;
      answers += subject.replace(made, "<$&>").length - subject.length;
    }
    lines.push("/" + texts[at] + "/" + flagSets[set] + " " + answers);
  }
}
console.log(lines.join("\\n"));
`;

test(
  `${texts.length} pattern texts under ${flagSets.length} sets of flags on ${2 * narrow.length + wide.length} subjects`,
  () =>
    slot(async () => {
      using dir = tempDir("aot-pattern-texts-on-subjects-of-every-width", { "main.js": program });
      const folder = String(dir);
      const plain = await spawned([bunExe(), "main.js"], folder, bunEnv);
      expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      built(await spawned([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "out"], folder, bunEnv));
      const compiled = await spawned([join(folder, isWindows ? "out.exe" : "out")], folder, bunEnv);
      expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const expected = plain.stdout.split("\n");
      expect(expected.length).toBe(texts.length * flagSets.length + 1);
      expect(
        compiled.stdout
          .split("\n")
          .flatMap((line, index) => (line === expected[index] ? [] : [{ compiled: line, plain: expected[index] }])),
      ).toEqual([]);
    }),
  300_000,
);
