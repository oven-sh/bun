// Patterns in which a run stands in front of a back reference: (["'])(.*?)\1, \[(.+?)\]\(\1#, ^(.+)\1$. A matcher may skip
// ahead to where the reference could begin, keep no record of a capture that is set again, or make a run possessive, as long
// as every match, every capture and every failure stay the same. Each program puts such patterns together out of groups, runs
// and references, as literals and out of strings at run time, and tries them on subjects over a small alphabet, short and
// long, that nearly match in many places. It prints the index, all captures and lastIndex.
import type { Random } from "./random";

/** Groups that a reference reads. */
const groups = [
  "([\"'])",
  "(a)",
  "(a|b)",
  "(ab?)",
  "(a+)",
  "(a*)",
  "(.)",
  "(..)",
  "(.+)",
  "(.+?)",
  "(.*?)",
  "([ab])",
  "(`+)",
  "(\\w+)",
  "(?<q>[\"'])",
  "(a|)",
  "(a)?",
  "(?:(a)|b)",
  "((a)b)",
  "(\\[)",
  "(x{2,3})",
  "(\\u00e9)",
  "(\\d)",
];

/** What stands between the group and the reference. */
const runs = [
  ".*?",
  ".*",
  ".+?",
  ".+",
  "[^]*?",
  "[^\"']*",
  "[ab]*",
  "[ab]*?",
  "\\w*?",
  "(.*?)",
  "(.+?)",
  "(?:ab)*?",
  "a*",
  "",
  "b",
  "[^a]*",
  ".{0,3}",
  ".{2,}?",
  "(?:.|\\n)*?",
  "\\s*",
  "(?=.)",
  "(b*)",
];

/** What stands behind the reference. */
const tails = ["", "", "", "$", "#", "b", "\\b", "(?!a)", "\\1", "(.)", "\\)", "x?"];

const heads = ["", "", "", "^", "\\[", "x", "(?<=^|b)", "\\b", "b*"];

const flags = ["", "", "", "g", "i", "s", "m", "u", "y", "gi", "su", "d", "v"];

/** Subjects over a small alphabet, with quotes and brackets. */
function subject(random: Random): string {
  const pieces = [
    "a",
    "b",
    "ab",
    "ba",
    '"',
    "'",
    "`",
    "``",
    "x",
    "xx",
    "[",
    "]",
    "(",
    ")",
    "#",
    " ",
    "\\n",
    "1",
    "\\u00e9",
    "A",
    "aa",
    "abc",
  ];
  const length = random.pick([0, 1, 2, 4, 6, 10, 16, 40]);
  return Array.from({ length }, () => random.pick(pieces)).join("");
}

export function generate(random: Random): string {
  const rows: string[] = [];
  for (let at = 0, total = random.between(6, 14); at < total; at++) {
    const group = random.pick(groups);
    const reference =
      group.startsWith("(?<q>") && random.chance(0.6)
        ? "\\k<q>"
        : random.pick(["\\1", "\\1", "\\1", "\\2", "\\1\\1", "(?:\\1)+", "\\1?", "\\1*", "(?:\\1|b)"]);
    const source = random.pick(heads) + group + random.pick(runs) + reference + random.pick(tails);
    const flag = random.pick(flags);
    const subjects = Array.from({ length: random.between(2, 4) }, () => `"${subject(random).replaceAll('"', '\\"')}"`);
    // A subject that does match: the group's text twice with something between.
    subjects.push(
      random.pick([
        '"\\"ab\\"a"',
        "\"'a'b'\"",
        '"abab"',
        '"aXa"',
        '"[ab](ab#"',
        '"``a``"',
        '"xxaxx"',
        '"a".repeat(30) + "b"',
        '"\\"" + "ab".repeat(40)',
        '"[" + "a]".repeat(30) + "(a#"',
      ]),
    );
    // As a literal the pattern is compiled with the program. Out of a string it is compiled when the program runs.
    // A pattern that is refused can only be made at run time: as a literal it would stop the whole file.
    let isValid = true;
    try {
      new RegExp(source, flag);
    } catch {
      isValid = false;
    }
    const made = isValid && random.chance(0.5) ? `/${source.replaceAll("/", "\\/")}/${flag}` : `new RegExp(word(${JSON.stringify(source)}), ${JSON.stringify(flag)})`; // prettier-ignore
    rows.push(`tried(${at}, () => ${made}, [${subjects.join(", ")}]);`);
  }
  return `const word = text => process.argv[9] ?? text;
function shown(match) {
  if (match === null) return "null";
  let text = match.index + ":";
  for (let at = 0; at < match.length; at++) text += (match[at] === undefined ? "undefined" : JSON.stringify(match[at].length > 12 ? match[at].slice(0, 6) + ".." + match[at].length : match[at])) + ",";
  return text + (match.groups ? JSON.stringify(match.groups).length : "");
}
function tried(row, make, subjects) {
  let line = "";
  try {
    const pattern = make();
    for (const subject of subjects) {
      pattern.lastIndex = 0;
      line += shown(pattern.exec(subject)) + " " + pattern.lastIndex + " ";
      line += pattern.test(subject) + " " + subject.search(pattern) + " " + subject.replace(pattern, "<$1>").length + " " + subject.split(pattern).length + " | ";
      ${random.pick(["", "", "for (let turn = 0; turn < 30; turn++) pattern.test(subject);", 'line += (subject.match(pattern)?.length ?? "none") + " | ";'])}
    }
  } catch (error) {
    line += "threw " + error.name;
  }
  console.log(row, line);
}
${rows.join("\n")}
`;
}
