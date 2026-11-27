// A program that stores another function into TextEncoder.prototype.encode calls that function from then on.
// STATISTIC: ByteLiteralsEncoded = 0
const shared = new TextEncoder();
const original = TextEncoder.prototype.encode;
function make() {
  return [String(new TextEncoder().encode("hi")), String(shared.encode("hi"))].join(" | ");
}
console.log("before |", make());
try {
  TextEncoder.prototype.encode = function (input) { return "the replacement got " + input; };
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
try {
  TextEncoder.prototype.encode = original;
  console.log("restored");
} catch (error) {
  console.log("restored throws", error.name);
}
console.log("then |", make());
