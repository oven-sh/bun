// A program that defines Uint8Array.fromBase64 anew through an object that the build cannot read calls what it defined.
// STATISTIC: ByteLiteralsEncoded = 1
function make() {
  return String(Uint8Array.fromBase64("aGk="));
}
console.log("before |", make());
try {
  Object.defineProperty(globalThis[JSON.parse('"Uint8Array"')], "fromBase64", { value: input => "the replacement got " + input });
  console.log("defined");
} catch (error) {
  console.log("defined throws", error.name);
}
console.log("then |", make());
