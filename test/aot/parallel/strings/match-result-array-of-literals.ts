// The array that `exec` and `match` of a RegExp literal return in a program that never reads `RegExp.$1` or its like, where a match needs no RegExp object: elements, `index`, `input`, `groups`, own property names, later growth, every kind of subject, and arrays kept across collections.
// Env: JSC_aotCountsPath=/dev/null
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

function describe(match: RegExpMatchArray | null) {
  if (!match) return "null";
  const own = Object.getOwnPropertyNames(match).join();
  return `${JSON.stringify(match)} length ${match.length} index ${match.index} input ${JSON.stringify(match.input)} groups ${JSON.stringify(match.groups)} [${own}] ${Array.isArray(match)} ${Object.getPrototypeOf(match) === Array.prototype}`;
}
function join(left: string, right: string) {
  return left + right;
}
function cut(whole: string, from: number, to: number) {
  return whole.slice(from, to);
}

const finders: [string, (text: string) => RegExpMatchArray | null][] = [
  ["exec date", text => /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)],
  ["match date", text => text.match(/^(\d{4})-(\d{2})-(\d{2})$/)],
  ["exec optional", text => /(x)?(y)?(z)/.exec(text)],
  ["match optional", text => text.match(/(x)?(y)?(z)/)],
  ["exec empty groups", text => /()()(c)/.exec(text)],
  ["exec whole", text => /^(.*)$/.exec(text)],
  ["match without group", text => text.match(/b+c/)],
  ["exec ends", text => /(.)(.*)(.)/.exec(text)],
  ["exec named", text => /(?<key>\w+)=(?<value>\w+)/.exec(text)],
  ["match named", text => text.match(/(?<key>\w+)=(?<value>\w+)/)],
  ["exec wide", text => /(中)(.)?/.exec(text)],
  ["match alternatives", text => text.match(/(a)|(b)|(c)|(d)|(e)|(f)|(g)|(h)|(i)|(j)|(k)/)],
  ["exec look behind", text => /(?<=(a))b/.exec(text)],
  ["exec back reference", text => /(a)\1/.exec(text)],
];
const subjects: string[] = [
  "", "a", "c", "abc", "aabc", "bbc", "xyz", "z", "yz", "2026-10-15", "2026-10-1", "k=v", "key=value", "kjihgfedcba", "a中", "中abc", "中", "x".repeat(70) + "abc",
  join(cut("2026-10", 0, 5), cut("10-15", 0, 5)), cut("<<2026-10-15>>", 2, 12), join("key", "=value"), cut("中<<中abc>>", 3, 7), join("a", "中z"),
];
for (const [name, find] of finders) {
  for (const subject of subjects)
    console.log(name, JSON.stringify(subject.length > 40 ? subject.length : subject), describe(find(subject)));
}

const grown = /(a)(b)/.exec("ab")!;
grown.push("pushed");
grown[7] = "far";
grown.index = -1;
(grown as any).extra = 1;
delete (grown as any).groups;
console.log(JSON.stringify(grown), grown.length, grown.index, (grown as any).extra, "groups" in grown, grown.indexOf("b"), [...grown].length);
const [whole, first, second = "default", third = "default"] = /(a)(x)?/.exec("a")!;
console.log(whole, first, second, third);

const kept: RegExpMatchArray[] = [];
let sum = 0;
for (let i = 0; i < 60000; i++) {
  const text = `${2000 + (i % 30)}-${10 + (i % 3)}-${10 + (i % 19)}`;
  const match = i & 1 ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("no match");
  sum += match[1].length + match[3].charCodeAt(1) + match.index! + match.length;
  if (i % 997 === 0) kept.push(match);
  if (i % 20000 === 0) collect();
}
collect();
console.log(sum, kept.length, kept.map(match => match.join(":")).join(" ").length, describe(kept[7]));

const names = ["operationAOTRegExpExec", "operationAOTStringMatchRegExp", "operationAOTRegExpMatchLiteral", "operationAOTRegExpMatchLiteralWithoutObject"];
const entries = () => names.reduce((total, name) => total + count(name), 0);
const dates: string[] = [];
const wideDates: string[] = [];
for (let number = 2020; number < 2028; number++) {
  dates.push([number, 10, 15].join("-"));
  wideDates.push([number, "年", 10, "月日"].join(""));
}
const recent: RegExpMatchArray[] = [];
const before = entries();
let length = 0;
for (let i = 0; i < 4000; i++) {
  const narrow = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dates[i & 7])!;
  const wide = wideDates[i & 7].match(/^(\d{4})年(\d{1,2})月(.)/)!;
  recent[i & 7] = narrow;
  recent[8 + (i & 7)] = wide;
  length += narrow.length + wide[3].length;
  if (/^(\d{4})-(\d{2})-(\d{2})$/.exec(wideDates[i & 7]) || dates[i & 7].match(/^(\d{4})年(\d{1,2})月(.)/)) length = -1;
}
console.log(length, entries() - before < 400 ? "few entries" : "MANY ENTRIES", describe(recent[3]), describe(recent[11]));
