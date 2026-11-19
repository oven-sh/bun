// A program that defines TextEncoder.prototype.encode anew calls what it defined.
// STATISTIC: ByteLiteralsEncoded = 0
const shared = new TextEncoder();
function make() {
  return [String(new TextEncoder().encode("hi")), String(shared.encode("hi"))].join(" | ");
}
console.log("before |", make());
try {
  Object.defineProperty(TextEncoder.prototype, "encode", { value: input => "the replacement got " + input });
  console.log("defined");
} catch (error) {
  console.log("defined throws", error.name);
}
console.log("then |", make());
