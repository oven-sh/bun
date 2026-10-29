// Regular expressions whose text arrives at run time and that go back over the turns of their groups for millions of turns before they find their match.
//
// Every subject has a match: the first alternative fails, but only behind all the ways in which its groups can divide the subject, and the last alternative matches at once.
// Plain Bun does not walk for ever: it gives a match up at the hundred millionth turn that the groups of a pattern begin in one match, and then answers that there is none.
// An executable has to find every match that plain Bun finds, and has to end wherever plain Bun ends.
//
//   groups    alternatives that overlap, repetitions in repetitions, bodies that may be empty; greedy and lazy; without a greatest number of turns, with one near the length of the subject, with a fixed number;
//             capturing, named, referred back to; groups with a fixed number of turns, optional groups and lookaheads inside
//   around    nothing; a lookahead of either sign; a lookbehind, modifiers, a set of the flag v, a property: what not every matcher of patterns made at run time takes
//   subjects  so long that the turns lie between a few millions and a few hundred millions: on both sides of the place where plain Bun gives up; of 8-bit and of 16-bit characters
//   squares   patterns whose turns grow with the square of the length, at lengths one turn apart from that place
//   used by   one of exec, test, match, matchAll, replace, replaceAll, search, split: each use walks all the ways again
//
// Each use prints its answer. Where two builds differ, the one that prints no match is the one that gave up.
import type { Random } from "./random";

type Case = { pieces: string[]; flags: string; head: string; unit: string; count: number; tail: string; use: string };

// A group over x, and the length at which a hundred million turns are reached where `<group>c` meets nothing but x.
const doubling: [string, number][] = [
  ["(?:x|x)*", 27],
  ["(?:x|x)*?", 27],
  ["(?:x|x)+", 27],
  ["(x|x)*", 27],
  ["(?<n>x|x)*", 27],
  ["(?:x|[xy])*", 27],
  ["(?:x|.)*", 27],
  ["(?:x||x)*", 27],
  ["(?:x|x){0,99}", 27],
  ["(?:x|x){2,}", 27],
  ["(?:x|x){3,}?", 27],
  ["(?:x|x){0,COUNT}", 27],
  ["(?:x|x){0,LESS}", 27],
  ["(?:x|x){LESS}", 27],
  ["(x+)+", 28],
  ["(x*)*", 28],
  ["(?:x*)*", 28],
  ["(?:x+)*?", 28],
  ["(x+|y)+", 28],
  ["(?:x*|y*|x)*", 20],
  ["(?:(?:x|y)|x)*", 27],
  ["(?:(?=x)x|x)*", 27],
  ["(x|x)*\\1", 27],
  ["(?:x|x)?(?:x|x)?(?:x|x)*", 25],
  ["(?:x|x|x)*", 18],
  ["(?:x|xx)+", 38],
  ["(?:(?:x)?x|xx)*", 28],
  ["(?:(?:x|x)*)*", 14],
  ["((x|x)*y?)*", 14],
  ["(?:(?:x){2}|xx)*", 53],
  ["(?:(?:x){3}|xxx)*", 79],
];
const around: [string, string, string][] = [
  ["", "", ""],
  ["", "", ""],
  ["", "", ""],
  ["(?=", ")x", ""],
  ["(?!", ")x+|q", ""],
  ["(?<=^|y)", "", ""],
  ["(?<!y)", "", ""],
  ["(?i:", ")", ""],
  ["(?:[q--y]|", ")", "v"],
  ["(?:\\p{Lu}|", ")", "u"],
];
const squares: [string, string, string, string, number][] = [
  ["(?:\\n|\\bk\\s+(?:\\w+=\\S*\\s+)*)end", "k", " A=k", "\nno\nend", 14141],
  ["(?<!q)(?:\\n|\\bk\\s+(?:\\w+=\\S*\\s+)*)end", "k", " A=k", "\nno\nend", 14141],
];
const uses: Record<string, string> = {
  exec: "re.exec(s)?.[0].length",
  test: "re.test(s)",
  match: "s.match(re)?.[0].length",
  matchAll: "[...s.matchAll(new RegExp(re, re.flags + 'g'))].length",
  replace: 's.replace(re, "<>").length',
  replaceAll: "s.replaceAll(new RegExp(re, re.flags + 'g'), \"<>\").length",
  search: "s.search(re)",
  split: "s.split(re).length",
};

export function generate(random: Random): string {
  const cases: Case[] = [];
  const cut = (text: string) => {
    if (random.chance(0.4)) return [text];
    const at = random.between(1, text.length - 1);
    return [text.slice(0, at), text.slice(at)];
  };
  const count = random.between(2, 3);
  for (let i = 0; i < count; i++) {
    const use = random.pick(Object.keys(uses));
    if (random.chance(0.15)) {
      const [pattern, head, unit, tail, limit] = random.pick(squares);
      cases.push({ pieces: cut(pattern), flags: random.pick(["", "", "s", "u"]), head, unit, count: limit + random.pick([-4000, -1000, -2, -1, 0, 1]), tail, use: "test" });
      continue;
    }
    const [group, limit] = random.pick(doubling);
    const [before, after, neededFlag] = random.pick(around);
    const isWide = random.chance(0.3);
    // A last character of 16 bits is one more place for the group to stop in front of.
    const length = Math.max(1, limit - (isWide ? 1 : 0) + random.pick([-3, -2, -1, -1, -1, 0, 0, 1]) * (limit > 50 ? 3 : limit > 30 ? 2 : 1));
    const letter = random.pick(["a", "a", "b", "z"]);
    const text = (before + group + "c" + after + "|x+").replaceAll("COUNT", String(length)).replaceAll("LESS", String(length - 1)).replaceAll("x", letter);
    cases.push({ pieces: cut(text), flags: neededFlag || random.pick(["", "", "", "i", "m", "s", "d", "y", "u", "v"]), head: "", unit: letter, count: length, tail: isWide ? "中" : "", use });
  }
  return `// ${cases.map(one => one.use).join(" ")}
type Case = { pieces: string[]; flags: string; head: string; unit: string; count: number; tail: string; use: string };
const cases: Case[] = JSON.parse(${JSON.stringify(JSON.stringify(cases))});
function answer(use: string, re: RegExp, s: string): unknown {
  switch (use) {
${Object.entries(uses)
  .map(([name, code]) => `    case ${JSON.stringify(name)}:\n      return ${code};`)
  .join("\n")}
  }
}
for (let at = 0; at < cases.length; at++) {
  const one = cases[at];
  let text = "";
  for (const piece of one.pieces) text += piece;
  let line: string;
  try {
    line = String(answer(one.use, new RegExp(text, one.flags), one.head + one.unit.repeat(one.count) + one.tail));
  } catch (error) {
    line = (error as Error).name;
  }
  console.log(at + ": " + one.use + " " + line);
}`;
}
