// Regular expressions whose source arrives at run time and that backtrack millions of times before they match. Every
// subject has a match, on both sides of the step limit at which plain Bun gives up. Past it plain Bun says that nothing
// matches. An executable may say so too, or find the match, and nothing else: each case brings what the language says,
// and a line that says something else ends with it.
import type { Random } from "./random";

type Case = { pieces: string[]; flags: string; head: string; unit: string; count: number; tail: string; use: string; right: string };

// A group over x, and the length at which `<group>c` on a subject of only x takes a hundred million steps.
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

// The first alternative wants a c, which no subject has, so the last one takes the whole run of the letter. split() also
// answers with what each group has captured.
const rightOf = (use: string, pattern: string, count: number, tail: string) =>
  String({ exec: count, test: true, match: count, matchAll: 1, replace: 2 + tail.length, replaceAll: 2 + tail.length, search: 0, split: 2 + pattern.split(/\((?!\?)|\(\?<(?![=!])/).length - 1 }[use]);

/** Why the two runs may print these two texts: wherever they differ, plain Bun's line says that it is wrong, and the executable is right. */
export function meant(plain: string, compiled: string): string | undefined {
  const [theirs, ours] = [plain.split("\n"), compiled.split("\n")];
  if (theirs.length !== ours.length || plain === compiled) return;
  for (const [at, line] of theirs.entries()) {
    if (line === ours[at]) continue;
    const [, head, right] = /^(\d+: \w+ )\S+, and the language says (\S+)$/.exec(line) ?? [];
    if (head === undefined || ours[at] !== head + right) return;
  }
  return "plain Bun gives up at its limit of steps, and the executable finds the match";
}

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
      cases.push({ pieces: cut(pattern), flags: random.pick(["", "", "s", "u"]), head, unit, count: limit + random.pick([-4000, -1000, -2, -1, 0, 1]), tail, use: "test", right: "true" });
      continue;
    }
    const [group, limit] = random.pick(doubling);
    const [before, after, neededFlag] = random.pick(around);
    const isWide = random.chance(0.3);
    // A final 16-bit character is one more position for the group to stop before.
    const length = Math.max(1, limit - (isWide ? 1 : 0) + random.pick([-3, -2, -1, -1, -1, 0, 0, 1]) * (limit > 50 ? 3 : limit > 30 ? 2 : 1));
    const letter = random.pick(["a", "a", "b", "z"]);
    const text = (before + group + "c" + after + "|x+").replaceAll("COUNT", String(length)).replaceAll("LESS", String(length - 1)).replaceAll("x", letter);
    cases.push({ pieces: cut(text), flags: neededFlag || random.pick(["", "", "", "i", "m", "s", "d", "y", "u", "v"]), head: "", unit: letter, count: length, tail: isWide ? "中" : "", use, right: rightOf(use, text, length, isWide ? "中" : "") });
  }
  return `// ${cases.map(one => one.use).join(" ")}
type Case = { pieces: string[]; flags: string; head: string; unit: string; count: number; tail: string; use: string; right: string };
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
  console.log(at + ": " + one.use + " " + line + (line === one.right ? "" : ", and the language says " + one.right));
}`;
}
