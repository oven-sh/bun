// A program that stores into Uint8Array.fromHex through an object that the build cannot read calls what it stored.
// STATISTIC: ByteLiteralsEncoded = 1
function make() {
  return String(Uint8Array.fromHex("6869"));
}
console.log("before |", make());
try {
  globalThis[JSON.parse('"Uint8Array"')].fromHex = input => "the replacement got " + input;
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
