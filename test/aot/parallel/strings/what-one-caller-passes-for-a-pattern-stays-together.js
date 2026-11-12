// A function puts a pattern together from several of its parameters. Each parameter has as many values as the function has callers, but of all their pairs only those are ever made that one
// caller passes. The build follows each caller by itself, so it knows exactly these texts, with their flags, and each has its code. None of the functions is copied into its callers.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
// STATISTIC: RegExpCandidatesCompiled = 12
const depth = process.argv.length % 3;
function between(open, close, depth) {
  if (depth > 0) return between(open, close, depth - 1);
  return new RegExp(`^${open}[a-z]+${close}$`);
}
function again(pattern, extra, depth) {
  if (depth > 0) return again(pattern, extra, depth - 1);
  return new RegExp(pattern.source + extra, pattern.flags + "g");
}
function atMost(letter, width, depth) {
  if (depth > 0) return atMost(letter, width, depth - 1);
  return new RegExp(`^${letter}{1,${Math.max(1, width - 2)}}$`);
}
function throughAnother(open, close) {
  return between(open + "!", close + "!", depth);
}
const made = [
  between("<", ">", depth),
  between("\\[", "\\]", depth),
  between("\\(", "\\)", depth),
  between("\\{", "\\}", depth),
  again(/ab+/, "c", depth),
  again(/x[yz]/i, "+", depth),
  again(/\d\d/m, "?", depth),
  atMost("a", 5, depth),
  atMost("b", 9, depth),
  atMost("c", 1, depth),
  throughAnother("<", ">"),
  throughAnother("#", "%"),
];
console.log(made.map(each => each.source + "/" + each.flags).join(" "));
const subjects = ["<abc>", "[abc]", "(abc)", "{abc}", "abbc", "XYY", "12", "aaa", "bbbbbbb", "c", "<!abc>!", "#!abc%!", "<abc]"];
console.log(made.map(each => subjects.map(subject => ((each.lastIndex = 0), each.test(subject) ? 1 : 0)).join("")).join(" "));
