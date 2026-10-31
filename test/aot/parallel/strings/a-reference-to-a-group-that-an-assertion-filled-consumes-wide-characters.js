// A pattern text that the build works out gets no code for 16-bit subjects where the pattern has to match its subject from end to end with characters of one byte: then a subject that holds a
// wider character is answered "no match" without a search. An assertion consumes nothing, so what it looks at did not count; but a group in it keeps what it has looked at, and a reference to
// that group consumes it: `^(?=(.*))\1$` matches any subject of one line, and answered false for "\u2603". Where a pattern has a reference, what its assertions look at counts as well.
// It takes a text that is truly worked out: a constant that flow folds is as good as a literal and has both kinds of code.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpMatchesInterpreted = 0
const texts = [
  "^(?=(.*))\\1$", "^(?=(.+))\\1$", "^(?=(?<x>.*))\\k<x>$", "^(?=(\\W))\\1$", "^(?=([^a]))\\1$", "^(?=(.))\\1$", "^(?:(?=(.))\\1)+$", "^(?=(─))\\1$", "^(?=([\\s\\S]*))\\1$",
  "^(?=(.)(.))\\1\\2$", "^(?=a?(.))a?\\1$", "^(?=(.*))(?:\\1)$", "^(?=(.*))(\\1)$", "^(?=(.*))\\1{1}$", "^(?=(.*))\\1?$", "^(?=(.*))\\1*$", "^(?!(?!(.*)))\\1$", "^\\1(?=(.*))$", "^(?=(.*)$)\\1$",
  "^a(?<=(.))\\1$", "^(?=(.*))a?\\1$", "^(?=(?:(.)|b))\\1$", "^(?=((.)))\\2$", "^(a)\\1$", "^(?=(a))\\1$", "^(?=([a-z]*))\\1$",
];
const flagSets = ["", "g", "u", "s", "d", "v"];
const nothing = process.argv.length > 99 ? "x" : "";
const subjects = ["", "a", "aa", "ab", "\xe9", "─", "☃", "a☃", "☃a", "☃☃", "──", "Ā", "\u{1F600}", "a\u{1F600}", "\ud83d", "\ude00", " ", "﻿"].map(each => each + nothing);
const lines = [];
for (let at = 0; at < texts.length; at++) {
  for (let set = 0; set < flagSets.length; set++) {
    const made = new RegExp(texts[at], flagSets[set]);
    let answers = "";
    for (let index = 0; index < subjects.length; index++) {
      made.lastIndex = 0;
      answers += made.test(subjects[index]) ? "1" : "0";
      made.lastIndex = 0;
      const found = made.exec(subjects[index]);
      answers += found ? found[0].length : "-";
    }
    lines.push("/" + texts[at] + "/" + flagSets[set] + " " + answers);
  }
}
console.log(lines.join("\n"));
