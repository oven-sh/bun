// A pattern made at run time whose search doubles with every character of the subject: plain Bun gives the match up at the hundred millionth turn of a group, after seconds.
// The compiled program gives up at the same length of the subject, and at once: it does not make the same search from the same place twice. That holds where the pattern refers to a group,
// looks behind with groups and runs, has characters beyond the BMP, and where the subject has them: none of these patterns goes to the interpreter of bytecode, which makes every search anew.
// Env of the executable: BUN_JSC_verboseRegExpCompilation=1
const nothing = String(Date.now()).slice(99);
const face = "\u{1f600}";
const rows = [
  ["a reference to a group in front of the turns", "(a)(?:\\1{2}|aa)*c|a+", "", count => "a".repeat(count)],
  ["a reference to the group that takes the turns", "(a|a)*\\1c|a+", "", count => "a".repeat(count)],
  ["a reference that is taken as seldom as may be", "(a)(?:\\1*?a|a)*c|a+", "", count => "a".repeat(count)],
  ["references to two groups", "(a)(b?)(?:\\1\\2|a)*c|a+", "", count => "a".repeat(count)],
  ["a reference that ignores case", "(a)(?:\\1|A)*c|a+", "i", count => "a".repeat(count)],
  ["a text between quotes", "(['\"])(?:(?!\\1).|\\\\.|a)*\\1c|.+", "", count => "'" + "a".repeat(count)],
  ["a character beyond the BMP", "(?:" + face + "|" + face + ")*c|" + face + "+", "u", count => face.repeat(count)],
  ["a class with a character beyond the BMP", "(?:[" + face + "a]|" + face + ")*c|.+", "u", count => face.repeat(count)],
  ["a dot behind a pair", "(?:.|a)*c|.+", "u", count => face + "a".repeat(count)],
  ["a dot on pairs", "(?:.|.)*c|.+", "u", count => face.repeat(count)],
  ["a negated class in front of a pair", "(?:[^x]|a)*c|.+", "u", count => "a".repeat(count) + face],
  ["properties on pairs", "(?:\\P{L}|\\p{Emoji})*c|.+", "u", count => face.repeat(count)],
  ["half a pair", "(?:\\ud83d|\\ud83d)*c|.+", "u", count => "\ud83d".repeat(count)],
  ["a difference of classes in front of a pair", "(?:[\\p{L}--[b]]|a)*c|.+", "v", count => "a".repeat(count) + face],
  ["a lookbehind with a group", "a+(?<=c(?:a|a)*)|a+", "", count => "a".repeat(count)],
  ["a lookbehind with a run behind turns", "(?:a|a)*(?<=b+)c|a+", "", count => "a".repeat(count)],
  ["a lookbehind that must fail, with a group", "(?:a|a)*(?<!(?:a|b)+)c|a+", "", count => "a".repeat(count)],
];
for (const [name, source, flags, subject] of rows) {
  const answers = [];
  for (let count = 20; count <= 32; count++) {
    const match = new RegExp(source + nothing, flags).exec(subject(count) + nothing);
    answers.push(match === null ? "-" : match[0].length);
  }
  console.log(name + ":", answers.join(" "));
}
/* Output:
a reference to a group in front of the turns: 20 21 22 23 24 25 26 27 28 29 30 31 32
a reference to the group that takes the turns: 20 21 22 23 24 25 26 - - - - - -
a reference that is taken as seldom as may be: 20 - - - - - - - - - - - -
references to two groups: 20 21 22 23 24 25 26 27 - - - - -
a reference that ignores case: 20 21 22 23 24 25 26 27 - - - - -
a text between quotes: 21 22 23 24 25 26 27 - - - - - -
a character beyond the BMP: 40 42 44 46 48 50 52 - - - - - -
a class with a character beyond the BMP: 40 42 44 46 48 50 52 - - - - - -
a dot behind a pair: 22 23 24 25 26 27 28 - - - - - -
a dot on pairs: 40 42 44 46 48 50 52 - - - - - -
a negated class in front of a pair: 22 23 24 25 26 27 - - - - - - -
properties on pairs: 40 42 44 46 48 50 52 - - - - - -
half a pair: 20 21 22 23 24 25 26 - - - - - -
a difference of classes in front of a pair: 22 23 24 25 26 27 - - - - - - -
a lookbehind with a group: 20 21 22 23 24 25 - - - - - - -
a lookbehind with a run behind turns: 20 21 22 23 24 25 26 - - - - - -
a lookbehind that must fail, with a group: 20 21 22 - - - - - - - - - -
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
Runs on a flat program
Counts turns on a second flat program
*/
