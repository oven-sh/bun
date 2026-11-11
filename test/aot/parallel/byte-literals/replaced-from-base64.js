// A program that stores another function into Uint8Array.fromBase64 calls that function from then on.
// STATISTIC: ByteLiteralsEncoded = 0
const original = Uint8Array.fromBase64;
function make() {
  return String(Uint8Array.fromBase64("aGk="));
}
console.log("before |", make());
try {
  Uint8Array.fromBase64 = input => "the replacement got " + input;
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
try {
  Uint8Array.fromBase64 = original;
  console.log("restored");
} catch (error) {
  console.log("restored throws", error.name);
}
console.log("then |", make());
