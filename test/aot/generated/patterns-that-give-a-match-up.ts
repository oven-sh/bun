// Regular expressions that plain Bun gives up: it does not walk for ever through the ways in which the groups of a pattern can divide a subject, but stops at the hundred millionth turn that they begin
// in one match, and then answers that there is no match. Whoever asks cannot tell that from a subject that does not match, so programs ask again with an alternative beside the pattern that always
// matches, and count on both giving up together. An executable gives a match up at the same length of the subject as plain Bun, and takes no longer to get there.
//
//   bodies    repetitions in repetitions, alternatives that overlap, greedy and lazy, with and without a greatest number of turns, capturing or not, referred back to, in a lookahead: the turns double
//             with each character;
//             names between slashes, words between blanks: the turns grow with the second, third or fourth power of the length
//   around    every subject has a match: the body fails, or matches late, and an alternative beside it matches at once: the end of the subject, nothing, a text behind the subject.
//             The body begins with ^ or not, alone or with a neighbor that does, inside a group or not: alternatives that begin with ^ are tried at the first place alone
//   flags     each of i m s u v g y d
//   used by   test, exec, match, search, replace, split, matchAll, replaceAll
//   text      arrives at run time in pieces; or stands in the program as a literal or as a constant text
//
// Each case looks for the least number of units at which its use finds nothing, halving between a length at which it finds something and one at which it finds nothing, and prints that number.
// Behind it stands the longest time that one use has taken, which is no part of the answer.
import type { Random } from "../fuzz/random";

export type Text = "at run time" | "literal" | "constant";
type Body = { pattern: string; head: string; unit: string; tail: string; most: number };
type Case = { pieces: string[]; flags: string; head: string; unit: string; tail: string; most: number; use: string };

const doubling: Body[] = [
  "(x+)+y",
  "(?:x+)+y",
  "(x|xx)+y",
  "(?:x|x)*y",
  "(x+?)+?y",
  "(x+)+?y",
  "(x+){2,}y",
  "(?:x+){1,40}y",
  "((x+)+)+y",
  "(x+x+)+y",
  "(?:x+w?)*y",
  "(?:x|x){30,}y",
  "(?:(?:x|x)+)+y",
  "(?=(x+)+y)x",
  "(?<n>x+)+y",
  "(?:x|[xw])*y",
  "(x+)+\\1y",
  "(?<n>x+)+\\k<n>y",
  "(x|xx)+\\1y",
  "((x+)+)\\2y",
  "(x)(?:x|xx)+\\1y",
].map(pattern => ({ pattern, head: "", unit: "x", tail: "c", most: 80 }));
const powers: Body[] = [
  { pattern: "(?:x|w|xw)*y", head: "", unit: "xw", tail: "c", most: 64 },
  { pattern: "(?:\\w+\\s*)+:", head: "", unit: "xw ", tail: ";", most: 64 },
  { pattern: "(?:.*,)*y", head: "", unit: "x,", tail: "c", most: 64 },
  {
    pattern: "q(?:/[^\\/]+)*/[^\\/]*x[^\\/]*x[^\\/]*x[^\\/]*(?:/[^\\/]+)*/[^\\/]*x[^\\/]*/y(?=$|/$)",
    head: "q/xxx/m/",
    unit: "x",
    tail: "/c",
    most: 1024,
  },
  {
    pattern: "q(?:/[^\\/]+)*/[^\\/]*x[^\\/]*x[^\\/]*x[^\\/]*(?:/[^\\/]+)*/[^\\/]*x[^\\/]*/y(?=$|/$)",
    head: "q/xxx/m/",
    unit: "x",
    tail: "/y",
    most: 1024,
  },
  {
    pattern: "q(?:/[^\\/]+)*/[^\\/]*x[^\\/]*x[^\\/]*(?:/[^\\/]+)*/y",
    head: "q/xxx/m/",
    unit: "x",
    tail: "/c",
    most: 4096,
  },
  { pattern: "k\\s+(?:\\w+=\\S*\\s+)*end", head: "k", unit: " A=k", tail: "\nno", most: 32768 },
];
// What stands around the body B, what it adds behind the subject, and whether B is tried at the first place alone.
const around: [string, string, boolean][] = [
  ["B|$", "", false],
  ["(?:B)|$", "", false],
  ["(B)|$", "", false],
  ["(?:B)|", "", false],
  ["(?:B)|zz", "zz", false],
  ["(?:(?:B)|$)", "", false],
  ["(?:B$)|$", "", false],
  ["$|B|zz", "zz", false],
  ["^B|$", "", true],
  ["(?:^B)|$", "", true],
  ["^(?:B)|$", "", true],
  ["(?:^B)|", "", true],
  ["(?:^B)|zz", "zz", true],
  ["^B|^never|$", "", true],
  ["(?:^B|^never)|$", "", true],
  ["(?:^B|never)|$", "", true],
  ["(?:^B$)|$", "", true],
  ["(?:(?:^B)|zz)", "zz", true],
  ["((?:^B)|(zz))", "zz", true],
  ["(?:^|,)B|zz", "zz", true],
];
const uses: Record<string, string> = {
  test: "re.test(s)",
  exec: "re.exec(s) !== null",
  match: "s.match(re) !== null",
  search: "s.search(re) >= 0",
  replace: 's.replace(re, "<>") !== s',
  split: "s.split(re).length > 1",
  matchAll: "[...s.matchAll(new RegExp(re, re.flags.includes('g') ? re.flags : re.flags + 'g'))].length > 0",
  replaceAll: "s.replaceAll(new RegExp(re, re.flags.includes('g') ? re.flags : re.flags + 'g'), \"<>\") !== s",
};

export function generate(random: Random, text: Text, count: number): string {
  const cases: Case[] = [];
  const cut = (pattern: string) => {
    if (random.chance(0.4)) return [pattern];
    const at = random.between(1, pattern.length - 1);
    return [pattern.slice(0, at), pattern.slice(at)];
  };
  while (cases.length < count) {
    const body = random.chance(0.5) ? random.pick(doubling) : random.pick(powers);
    // The build makes one class of alternatives that are single characters: nothing is left to go back over, and the match is found.
    if (text !== "at run time" && /\(\?:x\|(x|\[xw\])\)\*/.test(body.pattern)) continue;
    const flags = random.pick(["", "", "", "i", "m", "s", "u", "v", "g", "y", "d"]);
    let [form, behind, isTriedOnce] = random.pick(around);
    // The flag y allows no place but the first, and under the flag m a ^ holds at more places than that.
    if (flags === "y") form = isTriedOnce ? "(?:^B)|" : "(?:B)|";
    if (flags === "y") behind = "";
    // A use that goes on behind a place where it has found nothing walks all the ways again from the next place.
    const use = random.pick(
      isTriedOnce && flags !== "m" && behind ? Object.keys(uses) : ["test", "exec", "match", "search", "replace"],
    );
    cases.push({
      pieces: cut(form.replace("B", () => body.pattern)),
      flags,
      head: body.head,
      unit: body.unit,
      tail: body.tail + behind,
      most: body.most,
      use,
    });
  }
  const made = (one: Case, at: number) =>
    text === "literal"
      ? `/${one.pieces.join("").replace(/\\?\//g, "\\/") || "(?:)"}/${one.flags}`
      : text === "constant"
        ? `new RegExp(${one.pieces.map(piece => JSON.stringify(piece)).join(" + ")}, ${JSON.stringify(one.flags)})`
        : `new RegExp(cases[${at}].pieces.join(""), cases[${at}].flags)`;
  return `// ${cases.map(one => one.use).join(" ")}
type Case = { pieces: string[]; flags: string; head: string; unit: string; tail: string; most: number; use: string };
const cases: Case[] = JSON.parse(${JSON.stringify(JSON.stringify(cases))});
const patterns: RegExp[] = [
${cases.map((one, at) => `  ${made(one, at)},`).join("\n")}
];
function finds(use: string, re: RegExp, s: string): boolean {
  re.lastIndex = 0;
  switch (use) {
${Object.entries(uses)
  .map(([name, code]) => `    case ${JSON.stringify(name)}:\n      return ${code};`)
  .join("\n")}
  }
  throw new Error(use);
}
for (let at = 0; at < cases.length; at++) {
  const one = cases[at];
  let longest = 0;
  const findsAt = (count: number) => {
    const subject = one.head + one.unit.repeat(count) + one.tail;
    const began = performance.now();
    const found = finds(one.use, patterns[at], subject);
    longest = Math.max(longest, performance.now() - began);
    return found;
  };
  let line: string;
  if (!findsAt(1)) line = "finds nothing at 1";
  else if (findsAt(one.most)) line = "finds something at " + one.most;
  else {
    let found = 1;
    let none = one.most;
    while (none - found > 1) {
      const middle = (found + none) >> 1;
      if (findsAt(middle)) found = middle;
      else none = middle;
    }
    line = "finds nothing from " + none;
  }
  console.log(at + ": " + one.use + " " + line + " " + Math.round(longest) + "ms");
}
`;
}
