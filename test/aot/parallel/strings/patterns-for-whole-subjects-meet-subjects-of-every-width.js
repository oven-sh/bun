// Whether a pattern can do without code for 16-bit subjects hangs on whether it could ever match a character of more than one byte. Each of these texts, under each of these flags, meets subjects
// that are narrow, that have 16 bits a character by their storage alone, and that hold wider characters: those that fold to a narrow one without regard to case, ends of lines, halves of pairs.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
// COUNTER: RegExpWideSubjectsRefused >= 1000
// COUNTER: RegExpSubjectsNarrowed >= 1000
const texts = [
  "^[a-z]+$",
  "^[a-z0-9.\\-]{1,9}$",
  "^(?:abc|\\xff)$",
  "^[\\x80-\\xff]+$",
  "^\\xff$",
  "^\\xb5$",
  "^\\w+$",
  "^\\d*$",
  "^$",
  "^a$|^abc$",
  "^(a)b(c)$",
  "^(a|b|c)+$",
  "^(a)b?\\1?c?$",
  "^(?<x>a)bc$",
  "^(?=abc)[a-c]+$",
  "^(?=─)[a-c]+$",
  "^a(?!─)bc$",
  "^ab(?<=b)c$",
  "^ab(?<!─)c$",
  "^\\babc\\b$",
  "^a\\Bbc$",
  "^(?:a*)*bc$",
  "^a??b*?c+?$",
  "^.$",
  "^.+$",
  "^\\W$",
  "^\\S+$",
  "^\\D+$",
  "^[^a]$",
  "^[^a]+$",
  "^\\s$",
  "^[\\s]+$",
  "^[a-z─]+$",
  "^─$",
  "^[\\x00-Ā]+$",
  "^[\\w\\W]+$",
  "^a$|b",
  "a|^b$",
  "(^abc$)",
  "^abc",
  "abc$",
  "^abc$\\n?",
  "^(?:abc$)",
  "(?:^abc)$",
];
const flagSets = ["", "g", "y", "u", "v", "s", "d", "i", "m", "iu", "gy"];
// What the build cannot work out it cannot make narrow.
const nothing = process.argv.length > 99 ? "x" : "";
const stored16 = text => (text + "\u2500" + nothing).split("\u2500")[0];
const narrow = ["", "a", "b", "abc", "abcabc", "ab c", "aac", "\xff", "\xb5", "\xe9\xff", "abc\n", "\n", " ", "k", "s", "0", "a.b-9"];
const wide = ["\u2500", "abc\u2500", "\u2500abc", "a\u2500c", "\u0178", "\u039c", "\u03bc", "\u212a", "\u017f", "\u2028", "abc\u2028", "\ufeff", "\u0100", "\ud83d\ude00", "\ud83d", "\ude00", "a\ud83d"];
const lines = [];
for (let at = 0; at < texts.length; at++) {
  for (let set = 0; set < flagSets.length; set++) {
    let made;
    try {
      made = new RegExp(texts[at], flagSets[set]);
    } catch (error) {
      lines.push(at + " " + flagSets[set] + " " + error.name);
      continue;
    }
    // Made anew for each pattern: a text that is used again and again does not keep its storage.
    const subjects = [...narrow, ...narrow.map(stored16), ...wide];
    let answers = "";
    let sum = 0;
    for (let index = 0; index < subjects.length; index++) {
      const subject = subjects[index];
      made.lastIndex = 0;
      answers += made.test(subject) ? "1" : "0";
      made.lastIndex = 0;
      const found = made.exec(subject);
      sum = (sum * 31 + (found ? found.index + found[0].length * 3 + found.length * 7 : 1)) % 1000003;
      made.lastIndex = 1;
      sum = (sum * 31 + (made.test(subject) ? 2 : 1) + made.lastIndex) % 1000003;
      made.lastIndex = 0;
      sum = (sum * 31 + subject.replace(made, "<$&>").length + subject.search(made) + subject.split(made).length) % 1000003;
    }
    lines.push(at + " " + flagSets[set] + " " + answers + " " + sum);
  }
}
console.log(lines.join("\n"));
