// A compiled executable keeps globalThis.Uint8Array, so the free name goes on naming the built-in.
// STATISTIC: ByteLiteralsEncoded = 2
// Build prints: 1 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
function make() {
  return [String(Uint8Array.fromBase64("aGk=")), String(Uint8Array.fromHex("6869")), String(Uint8Array.of(1, 2))].join(" | ");
}
console.log("before |", make());
try {
  globalThis.Uint8Array = { fromBase64: input => "base64 " + input, fromHex: input => "hex " + input, of: (...numbers) => "of " + numbers };
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
/* Output:
before | 104,105 | 104,105 | 1,2
stored throws TypeError
then | 104,105 | 104,105 | 1,2
*/
