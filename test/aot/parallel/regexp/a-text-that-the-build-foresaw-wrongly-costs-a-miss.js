// The build goes through the code that makes the second pattern with `prefix` as the body of the module leaves it. Before that code runs, a timer has stored a text there that only the run knows:
// what the build foresaw (^ab+z$) is in the image and nobody asks for it; what the program makes (^xy+z$) has no record, and the run time's own matcher gives the answers of plain Bun.
// A wrong guess costs a miss, never a wrong match.
// COUNTER: RegExpsCreatedWithoutRecord = 1
let prefix = "^ab+";
const subjects = ["abbc", "xyyz", "abbz", "xyy", "ABBZ", "xz"];
function make(tail) {
  return new RegExp(prefix + tail);
}
function answers(pattern) {
  return pattern.source + ": " + subjects.map(subject => (pattern.test(subject) ? 1 : 0)).join("");
}
console.log(answers(make("c$")));
setTimeout(() => {
  prefix = "^" + "x".repeat(Math.min(1, process.pid)) + "y+";
}, 1);
setTimeout(() => {
  console.log(answers(make("z$")));
}, 20);
