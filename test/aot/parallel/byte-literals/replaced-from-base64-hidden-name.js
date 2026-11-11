// A program that stores into Uint8Array under a name that the build cannot read calls what it stored.
// STATISTIC: ByteLiteralsEncoded = 0
const name = JSON.parse('"fromBase64"');
function make() {
  return [String(Uint8Array.fromBase64("aGk=")), String(Uint8Array.fromHex("6869"))].join(" | ");
}
console.log("before |", make());
try {
  Uint8Array[name] = input => "the replacement got " + input;
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
