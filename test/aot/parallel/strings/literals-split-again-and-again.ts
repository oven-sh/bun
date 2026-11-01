// Literals that reach split() through a variable, again and again: each answer is a new array that its owner may change,
// and what a split leaves behind in RegExp's legacy properties is the same each time.
const subjects = [
  "one two  three",
  "a,b;c,,d",
  "no separator",
  "",
  "x",
  "日本 語 と\tかな",
  "line one\r\nline two\nline three",
  "a1b22c333d",
];
const patterns = [/\s+/, /[,;]+/, /,/, /(\d)\d*/, /\r?\n/, /\r\n?|\n/, /(?:)/, /x/, /\s*/u, /(,)|(;)/];
const texts = [" ", ",", ", ", "", "two", "語", "\n", "no separator"];

function atPattern(subject: string, pattern: RegExp, limit?: number): string[] {
  return subject.split(pattern, limit);
}
function atText(subject: string, text: string, limit?: number): string[] {
  return subject.split(text, limit);
}
const legacy = () =>
  [RegExp.lastMatch, RegExp.$1, RegExp.leftContext, RegExp.rightContext].map(part => JSON.stringify(part)).join();

const seen: string[] = [];
for (let round = 0; round < 5; round++) {
  const lines: string[] = [];
  for (const subject of subjects) {
    for (const pattern of patterns) {
      /reset(.)/.exec("reset!");
      const pieces = atPattern(subject, pattern);
      lines.push(JSON.stringify(pieces) + " " + legacy());
      // The owner changes its array. The next round must not see it.
      pieces.push("pushed");
      pieces[0] = "changed";
      pieces.reverse();
      lines.push(JSON.stringify(atPattern(subject, pattern, 2)));
    }
    for (const text of texts) {
      const pieces = atText(subject, text);
      lines.push(JSON.stringify(pieces));
      pieces.length = 0;
      pieces.push(text);
      lines.push(JSON.stringify(atText(subject, text, 1)));
    }
  }
  seen.push(lines.join("\n"));
  if (round === 2) Bun.gc(true);
}
console.log(seen[0]);
console.log(seen.every(lines => lines === seen[0]));

// Two arrays of the same split are not one array, and their pieces are equal strings.
const first = atText(subjects[0]!, " ");
const second = atText(subjects[0]!, " ");
console.log(first !== second, first.join("|") === second.join("|"), Object.isFrozen(first), first.length);
first.sort();
console.log(second.join("|"), Array.isArray(second), Object.keys(second).join());

// A pattern that is changed between two splits of one literal.
const changing = /b/;
console.log(atPattern("abcabc", changing).join("|"), atPattern("abcabc", changing).join("|"));
changing.compile("c");
console.log(atPattern("abcabc", changing).join("|"), atPattern("abcabc", changing).join("|"));
Object.defineProperty(changing, "flags", { value: "i" });
console.log(atPattern("abCabc", changing).join("|"), atPattern("abCabc", changing).join("|"));
