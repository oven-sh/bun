// A program that stores another function into Uint8Array.fromHex calls that function from then on.
// STATISTIC: ByteLiteralsEncoded = 0
function make() {
  return String(Uint8Array.fromHex("6869"));
}
console.log("before |", make());
try {
  Uint8Array.fromHex = input => "the replacement got " + input;
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
