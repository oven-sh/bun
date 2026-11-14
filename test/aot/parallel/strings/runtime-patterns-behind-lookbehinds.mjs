// Patterns that were created at run time and begin with lookbehinds, a ^ with m, or lookaheads. An attempt is made only where the unit in front, and the unit that the lookaheads let through, allow one.
// Every answer is plain Bun's, at the start and at the end of a string, behind wide units and halves of surrogate pairs, and at each lastIndex.
// COUNTER: RegExpsSearchedByPrecedingUnit >= 20
const atRunTime = (text) => text.slice(Math.min(0, process.pid));
const sources = [
  "(?<!\\+\\+|--)(?<=[(*,:=>?\\[{]|&&|\\|\\||\\?|\\*\\/|^await|[^$._\\p{Alpha}\\p{Nd}]await|^return|[^$._\\p{Alpha}\\p{Nd}]return|^)\\p{space}*(?=<)",
  "(?<![$_\\w])(?:(?<=\\.\\.\\.)|(?<!\\.))(new|return)(?![$_\\w])",
  "(?=(?<![$_\\p{Alpha}\\p{Nd}])(?:(?<=\\.\\.\\.)|(?<!\\.))(?:\\b(export)\\p{space}+)?\\b(var|let|const)(?![$\\w]))",
  "(?<=[\\])\\w])\\s*(?:(/=)|(/)(?![*/]))",
  "(?<=^|[,;])[^,;]*",
  "(?<=a|bb|)c",
  "(?<=a*)b",
  "(?<=(a)|(?:b|c)d?)e",
  "(?<!a)(?<!b)(?<!cd)\\w",
  "(?<=\\n)x|(?<=y)z",
  "^\\s*\\w+",
  "(?<=\\s)$",
  "$(?<=\\s)",
  "\\b(?<=-)\\w",
  "(?:(?<=q)|(?<=r))s?",
  "((?<=q)|t)u",
  "(?<=\\u{1f600})a",
  "(?<=\\u0100)a",
  "(?<=[^a-z])k",
  "(?<=K)k",
  "(?<=\\W)",
  "(?<=.)",
  "(?<=[^])x",
  "(?<=(?=ab)a)b",
  "(?<=(?<!x)a)b",
  "(?=[a-c])(?<=[x-z])",
  "(?=\\$\\{)",
  "(?=(a+)+b)",
  "(?=a|b|$)",
  "(?=^|b)",
  "(?=\\b)(?=\\w)",
  "(?!a)(?=[ab])",
  "(?<=(\\w)\\1)-",
  "(?<=\\1(\\w))-",
  "(?<!\\+\\+|--)(?<!ab)[\\w<]",
  "(?<=[\u00e9\u00f1])a",
  "(?<!\u00e9)a",
];
const flagsOf = ["g", "gm", "gi", "gs", "gu", "gv", "giu", "gmv", "gy", "gd", "g"];
const texts = [
  "return await <a/> ; const x = (<b>); y = [ <c/>, ++ <d/>, -- <e/>",
  "new X; ...new Y; a.new; $new; renew return\nreturn 1; export let a; export  const b; var c",
  "a) / b ] /= c /* d */ e/f",
  "one,two;;three,,\n four",
  "c ac bbc abbc bde ade ce cde",
  "\n x\ny z yz\n\nx",
  "a -b --c d- \n- ",
  "qs rs s qqs tu qu u",
  "\u{1f600}a \ud83da \ude00a Āa bĀa Kk Kk kK ſ k",
  "😀\ude00\ud83d x",
  "ab xab yab zc ya zb",
  "`a${b}${`c${d}`}$`",
  "aaaab aab b aaaaaaaaaaaa",
  "aa- ab- a- --",
  "+a ++b -<c --d abc bc \u00e9a \u00f1a \u00eaa a+b",
  "",
  "x",
  " ",
];
const out = [];
for (const source of sources) {
  for (const flags of flagsOf) {
    let pattern;
    try {
      pattern = new RegExp(atRunTime(source), flags);
    } catch {
      out.push("not a pattern");
      continue;
    }
    for (const text of texts) {
      const subject = atRunTime(text);
      for (let at = 0; at <= subject.length; at += at > 6 ? 5 : 1) {
        pattern.lastIndex = at;
        const match = pattern.exec(subject);
        out.push(match === null ? "null" : match.index + JSON.stringify([...match]), pattern.lastIndex);
      }
      out.push(JSON.stringify(subject.split(pattern)), subject.replace(pattern, "<$&>"), subject.search(pattern), JSON.stringify(subject.match(pattern)));
    }
  }
}
console.log(out.length, Bun.hash(out.join("~")).toString(36));
for (let i = 0; i < out.length; i += 997) console.log(out[i]);
