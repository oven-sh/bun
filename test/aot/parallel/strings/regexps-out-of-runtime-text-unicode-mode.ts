// A pattern with the u or v flag whose text only the run knows. Where no step of it can consume a surrogate it runs on the program for code units, elsewhere in the interpreter: the answers are plain Bun's,
// on subjects with pairs of surrogates, lone surrogates, matches of nothing between the halves of a pair, and a lastIndex inside a pair.
// COUNTER: RegExpMatchesInterpreted >= 100
const out: string[] = [];
const atRunTime = (text: string) => [...text].reverse().reverse().join("");

const subjects = [
  "",
  "plain ascii text, with tabs\tand words",
  "café ؜ mark ‪ embed ⁦ isolate ⁩",
  "\u{1f600} smile \u{1f600}\u{1f601} two \u{10000}x",
  "lone \ud83d lead, lone \ude00 trail, swapped \ude00\ud83d",
  "x\u{1f600}xx\u{1f600}xxx",
  "K k K S s ſ",
  "一二三 abc 一",
  "aXbXc aXXb",
  "line one\nline two\r\nline three four",
];
const patterns: [string, string][] = [
  ["[\\t\\u{61c}\\u{202a}-\\u{202e}\\u{2066}-\\u{2069}]", "u"],
  ["[\\t\\u{61c}\\u{202a}-\\u{202e}\\u{2066}-\\u{2069}]+", "gu"],
  ["x*", "gu"],
  ["x+", "gu"],
  ["(?:x|\\u4e00)+", "gu"],
  ["(a)(X+)(b)", "gu"],
  ["(X)\\1", "u"],
  ["(?<letter>[a-c])X\\k<letter>?", "gu"],
  ["\\bword", "u"],
  ["\\bs\\b", "gu"],
  ["^line", "gmu"],
  ["[a-z]+$", "gmu"],
  ["e(?= )", "gu"],
  ["e(?! )", "gu"],
  ["[\\u4e00-\\u4e09]{2}", "u"],
  ["a|b|c", "gu"],
  ["smile|two|lead", "gu"],
  ["", "gu"],
  ["x", "yu"],
  ["[k]", "giu"],
  ["k", "giu"],
  ["s", "giu"],
  ["\\bk\\b", "giu"],
  ["(k)\\1", "iu"],
  ["[^x]", "gu"],
  [".", "gu"],
  [".x", "gu"],
  ["\\u{1f600}", "gu"],
  ["[\\u{1f600}-\\u{1f601}]", "gu"],
  ["\\ud83d", "gu"],
  ["[\\ud83d]", "gu"],
  ["\\ude00", "gu"],
  ["\\p{L}+", "gu"],
  ["\\P{L}", "gu"],
  ["\\W", "gu"],
  ["\\S+", "gu"],
  ["[\\s\\S]", "gu"],
  ["[[a-z]&&[^aeiou]]+", "gv"],
  ["[\\t\\u{61c}]", "v"],
  ["[x\\q{xx}]", "gv"],
];

const show = (text: string | undefined) => (text === undefined ? "-" : [...text].map(c => (c >= " " && c <= "~" ? c : "\\u{" + c.codePointAt(0)!.toString(16) + "}")).join(""));
for (const [source, flags] of patterns) {
  const expression = new RegExp(atRunTime(source), flags);
  const line: string[] = [];
  for (const subject of subjects) {
    expression.lastIndex = 0;
    const first = expression.exec(subject);
    const found = first ? first.index + ":" + first.map(show).join(",") + "@" + expression.lastIndex : "no";
    expression.lastIndex = 0;
    const all = expression.global ? [...subject.matchAll(expression)].map(match => match.index).join(".") : String(expression.test(subject));
    expression.lastIndex = 0;
    line.push(found + " " + all + " " + show(subject.replace(expression, "<$&>")).length + " " + subject.split(expression).length);
  }
  out.push("/" + source + "/" + flags + " " + line.join(" | "));
}

for (const [source, flags] of [["x*", "gu"], ["x*", "yu"], ["", "gu"], ["[x\\u4e00]?", "gu"], ["(?=x)", "gu"], ["\\b", "gu"]] as const) {
  const expression = new RegExp(atRunTime(source), flags);
  const subject = "\u{1f600}x\u{1f600}";
  const line: string[] = [];
  for (let from = 0; from <= subject.length + 1; from++) {
    expression.lastIndex = from;
    const match = expression.exec(subject);
    line.push(from + ">" + (match ? match.index + ":" + match[0].length : "no") + "@" + expression.lastIndex);
  }
  out.push("from every index /" + source + "/" + flags + " " + line.join(" "));
}
console.log(out.join("\n"));
