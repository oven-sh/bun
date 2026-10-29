// The array that `exec` and `match` return: elements, `index`, `input`, `groups`, own property names, holes and later growth, and the legacy `RegExp.$1` properties after each search, at typed and untyped sites and across collections.
// Env: JSC_aotCountsPath=/dev/null
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

function execs(pattern: RegExp, text: string) {
  return pattern.exec(text);
}
function execsUntyped(pattern: any, text: any) {
  return pattern.exec(text);
}
function matches(text: string, pattern: RegExp) {
  return text.match(pattern);
}
function describe(match: RegExpMatchArray | null) {
  if (!match) return "null";
  const own = Object.getOwnPropertyNames(match).join();
  const holes = match.map((_, index) => (index in match ? "" : "hole")).join("");
  return `${JSON.stringify(match)} length ${match.length} index ${match.index} input ${JSON.stringify(match.input)} groups ${JSON.stringify(match.groups)} [${own}] ${Array.isArray(match)} ${Object.getPrototypeOf(match) === Array.prototype} ${holes}`;
}
function legacy() {
  return [RegExp.lastMatch, RegExp.$1, RegExp.$2, RegExp.$9, RegExp.leftContext, RegExp.rightContext, RegExp.input, RegExp.lastParen].join("|");
}

const patterns: RegExp[] = [
  /b/, /^abc$/, /(a)(b)(c)/, /^(\d{4})-(\d{2})-(\d{2})$/, /(x)?(y)?(z)/, /()()(c)/, /(a|(b))+/, /(?:)/, /$/, /^/, /(.*)/, /^(.*)$/, /(.)(.*)(.)/,
  /(\w+)\s*=\s*(\w*)/, /(?<key>\w+)=(?<value>\w+)/, /(\w)(\w)/d, /(a)|(b)|(c)|(d)|(e)|(f)|(g)|(h)|(i)|(j)|(k)/, /\/users\/([^/]+)()$|\/posts\/([^/]+)\/([^/]+)()$|\/static\/(.*)()$/,
  /(?=(a))a/, /(?<=(a))b/, /(a)\1/, /(\xe9)(\xff)/, /([^]*)/,
];
const subjects = [
  "", "a", "b", "c", "abc", "aabc", "xyz", "z", "yz", "2026-10-15", "2026-10-1", "key = value", "key=", "k=v", "/users/42", "/posts/7/comments", "/static/", "/static/a.css", "kjihgfedcba", "éÿ",
  "a中", "中abc", "x".repeat(70) + "abc", "aa",
];
for (const pattern of patterns) {
  for (const subject of subjects) {
    const typed = describe(execs(pattern, subject));
    const seen = legacy();
    const untyped = describe(execsUntyped(pattern, subject));
    const isSameUntyped = typed === untyped && seen === legacy();
    const matched = describe(matches(subject, pattern));
    console.log(String(pattern), JSON.stringify(subject.length > 40 ? subject.length : subject), typed, seen, isSameUntyped, typed === matched && seen === legacy());
  }
}

for (const pattern of [/(a)|(b)/g, /\d+/g, /(?:)/g, /x*/g, /(b)/y, /(a)(b)?/y, /(\w)/gy, /[^a]/gu]) {
  for (const subject of subjects) {
    pattern.lastIndex = 1;
    const matched = describe(matches(subject, pattern));
    const after = pattern.lastIndex;
    pattern.lastIndex = 1;
    console.log(String(pattern), JSON.stringify(subject.length > 40 ? subject.length : subject), matched, after, describe(execs(pattern, subject)), pattern.lastIndex, legacy());
  }
}
const odd = /(a)(b)?/;
(odd as any).lastIndex = { valueOf() { console.log("lastIndex is read"); return 1; } };
console.log(describe(matches("ab", odd)), describe(execs(odd, "ab")), typeof odd.lastIndex);

const many = new RegExp("(.)".repeat(62));
const more = new RegExp("(.)".repeat(63));
const most = new RegExp("(.)?".repeat(300));
const letters = "abcdefghijklmnopqrstuvwxyz".repeat(4);
for (const pattern of [many, more, most]) {
  const match = execs(pattern, letters)!;
  console.log(match.length, match[0].length, match[1], match[61], match[62], match[63], match[match.length - 1], match.index);
}

const rope = "left-" + subjects[9] + "-" + String(patterns.length);
console.log(describe(execs(/(\d+)-(\d+)/, rope)), describe(execs(/(\d+)-(\d+)/, rope.slice(3, 14))));

const grown = execs(/(a)(b)/, "ab")!;
grown.push("pushed");
grown[7] = "far";
grown.index = -1;
(grown as any).extra = 1;
delete (grown as any).groups;
console.log(JSON.stringify(grown), grown.length, grown.index, (grown as any).extra, "groups" in grown, grown.indexOf("b"), grown.indexOf("", 1), [...grown].length);
const [whole, first, second = "default", third = "default"] = execs(/(a)(x)?/, "a")!;
console.log(whole, first, second, third);

const date = /^(\d{4})-(\d{2})-(\d{2})$/;
const kept: (RegExpExecArray | null)[] = [];
let sum = 0;
for (let i = 0; i < 60000; i++) {
  const text = `${2000 + (i % 30)}-${10 + (i % 3)}-${10 + (i % 19)}`;
  const match = i & 1 ? execs(date, text) : execsUntyped(date, text);
  if (!match) throw new Error("no match");
  sum += match[1].length + match[3].charCodeAt(1) + match.index + match.length;
  if (i % 997 === 0) kept.push(match);
  if (i % 20000 === 0) collect();
}
collect();
console.log(sum, kept.length, kept.map(match => match!.join(":")).join(" ").length, describe(kept[7]), legacy());

const before = count("operationAOTRegExpExec") + count("operationAOTRegExpMatchLiteral");
let found = 0;
for (let i = 0; i < 4000; i++) if (execs(date, "2026-10-15")) found++;
console.log(found, count("operationAOTRegExpExec") + count("operationAOTRegExpMatchLiteral") - before < 400 ? "few entries" : "MANY ENTRIES");
const wide = /^(\d{4})\u5e74(\d{1,2})\u6708(.)/;
const names = ["operationAOTRegExpExec", "operationAOTStringMatchRegExp", "operationAOTRegExpMatchLiteral"];
const entries = () => names.reduce((sum, name) => sum + count(name), 0);
const beforeWide = entries();
let length = 0;
for (let i = 0; i < 4000; i++) {
  length += execs(wide, "2026\u5e7410\u6708\u65e5")![3].length + matches("2026\u5e741\u6708x", wide)![2].length + matches("2026-10-15", date)![1].length;
  if (matches("2026-10-1", date) || matches("\u5e74", wide)) length = -1;
}
console.log(length, entries() - beforeWide < 400 ? "few entries" : "MANY ENTRIES", describe(execs(wide, "2026\u5e7410\u6708\u65e5")), describe(matches("2026\u5e741\u6708x", wide)));
