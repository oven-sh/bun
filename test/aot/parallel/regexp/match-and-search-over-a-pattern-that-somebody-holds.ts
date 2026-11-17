// A pattern is written once and kept: in a variable, a field, a capture, a list. `pattern.exec(text)` and `pattern.test(text)` over such a pattern enter the pattern's code;
// `text.match(pattern)` and `text.search(pattern)` entered the run time at each call. Nobody here reads what the last match left in RegExp.
// COUNT: operation:operationAOTStringMatchRegExp <= 200
// COUNT: operation:operationAOTStringSearchRegExp <= 200
const word = /[a-z]+/;
class Rules {
  readonly tag = /<([a-z]+)>/;
  first(text: string) { return text.match(this.tag); }
  at(text: string) { return text.search(this.tag); }
}
function makeFinder() {
  const comma = /,\s*/;
  return { first: (text: string) => text.match(comma), at: (text: string) => text.search(comma) };
}
const rules = new Rules(), finder = makeFinder();
const kept = [/^\d+$/, /b> /, /Z/];
const texts = ["12 ab", "345", "<b> x", "a, b", "", "Z9"];
let hits = 0;
for (let round = 0; round < 2000; round++) {
  for (const text of texts) {
    if (text.match(word)) hits++;
    if (text.search(word) >= 0) hits++;
    if (rules.first(text)) hits++;
    if (rules.at(text) >= 0) hits++;
    if (finder.first(text)) hits++;
    if (finder.at(text) >= 0) hits++;
    for (const pattern of kept) {
      if (text.match(pattern)) hits++;
      if (text.search(pattern) >= 0) hits++;
    }
  }
}
console.log(hits);

const said: string[] = [];
const atRunTime = (text: string) => text.slice(Math.min(0, process.pid));
function show(found: unknown): string {
  if (!Array.isArray(found)) return String(found);
  const match = found as RegExpMatchArray & { indices?: unknown };
  return JSON.stringify([[...match], match.index, match.input, match.groups, match.indices]);
}
function attempt(deed: () => unknown): string {
  try { return show(deed()); } catch (error) { return (error as Error).name; }
}
function both(name: string, pattern: RegExp, text: string) {
  const before = pattern.lastIndex;
  const found = attempt(() => text.match(pattern));
  const between = pattern.lastIndex;
  const at = attempt(() => text.search(pattern));
  said.push(`${name}: ${found} | ${at} | lastIndex ${String(before)} ${String(between)} ${String(pattern.lastIndex)}`);
}

const long = atRunTime("the quick brown fox jumps over the lazy dog 2026-11-05 and on");
const subjects: [string, string][] = [
  ["flat", "ab 12-34 def"],
  ["wide", "Āb 12-34 déf \u{1F600}\u{1F600}"],
  ["joined", atRunTime("ab 12") + atRunTime("-34 def")],
  ["a part", long.slice(10, 54)],
  ["empty", ""],
];
const patterns: [string, () => RegExp][] = [
  ["groups", () => /(\d+)-(\d+)/],
  ["named", () => /(?<first>\d+)-(?<second>\d+)/],
  ["places", () => /(\d+)-(\d+)?x?/d],
  ["plain characters", () => /def/],
  ["one character", () => /d/],
  ["any case", () => /DEF|FOX/i],
  ["code points", () => /\u{1F600}+|\d/u],
  ["empty", () => /(?:)/],
  ["global", () => /\d+/g],
  ["sticky", () => /\w+/y],
  ["global and sticky", () => /\w/gy],
  ["made at run time", () => new RegExp(atRunTime("(\\d+)-(\\d+)"))],
];
for (const [kind, text] of subjects) {
  for (const [name, make] of patterns) {
    const pattern = make();
    both(`${kind}, ${name}`, pattern, text);
    pattern.lastIndex = 3;
    both(`${kind}, ${name}, from 3`, pattern, text);
    pattern.lastIndex = 99;
    both(`${kind}, ${name}, from 99`, pattern, text);
  }
}

for (const [name, make] of patterns.slice(0, 1).concat(patterns.slice(8, 11))) {
  both(`frozen, ${name}`, Object.freeze(make()), "ab 12-34 def");
  const late = make();
  late.lastIndex = 3;
  both(`frozen at 3, ${name}`, Object.freeze(late), "ab 12-34 def");
}

const counted = /b/;
(counted as { lastIndex: unknown }).lastIndex = { valueOf() { said.push("lastIndex is asked for its number"); return 0; } };
said.push(attempt(() => "abc".match(counted)), attempt(() => "abc".search(counted)), typeof counted.lastIndex);

const ownExec = /b/;
ownExec.exec = function (text: string) { said.push("its own exec sees " + text); return null; };
said.push(attempt(() => "abc".match(ownExec)), attempt(() => "abc".search(ownExec)));

const ownMethods = /b/ as RegExp & Record<symbol, unknown>; // @ts-expect-error
ownMethods[Symbol.match] = (text: string) => "its own match of " + text; // @ts-expect-error
ownMethods[Symbol.search] = (text: string) => "its own search of " + text;
said.push(attempt(() => "abc".match(ownMethods)), attempt(() => "abc".search(ownMethods)));

class Loud extends RegExp {
  exec(text: string) { said.push("a class below RegExp sees " + text); return super.exec(text); }
}
both("a class below RegExp", new Loud("b+"), "abbc");

const compiledAnew = /a/;
both("before it is compiled anew", compiledAnew, "abcc");
compiledAnew.compile("c+", "");
both("compiled anew", compiledAnew, "abcc");
compiledAnew.compile("c", "g");
both("compiled anew, global", compiledAnew, "abcc");

const byValue: ((text: any, pattern: any) => unknown)[] = [(text, pattern) => text.match(pattern), (text, pattern) => text.search(pattern)];
for (const deed of byValue) {
  for (const pattern of [word, /\d+/g, "b", undefined, null, 2, { [Symbol.match]: () => "matched by an object", [Symbol.search]: () => "searched by an object" }])
    said.push(attempt(() => deed("ab 12 null undefined", pattern)));
  said.push(attempt(() => deed(1234, /3/)), attempt(() => deed(null, word)));
}
console.log(said.join("\n"));
