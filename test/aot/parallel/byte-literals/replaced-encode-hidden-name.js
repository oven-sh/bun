// A program that stores into TextEncoder.prototype under a name that the build cannot read calls what it stored.
// STATISTIC: ByteLiteralsEncoded = 0
const shared = new TextEncoder();
const name = JSON.parse('"encode"');
function make() {
  return [String(new TextEncoder().encode("hi")), String(shared.encode("hi"))].join(" | ");
}
console.log("before |", make());
try {
  TextEncoder.prototype[name] = input => "the replacement got " + input;
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
