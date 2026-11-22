// A program that stores another object into globalThis.Buffer finds it under the free name.
// STATISTIC: ByteLiteralsEncoded = 0
const original = Buffer;
function make() {
  return String(Buffer.from("literal", "latin1"));
}
console.log("before |", make());
try {
  globalThis.Buffer = { from: (input, encoding) => "the replacement got " + input + " " + encoding };
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
try {
  globalThis.Buffer = original;
  console.log("restored");
} catch (error) {
  console.log("restored throws", error.name);
}
console.log("then |", make());
