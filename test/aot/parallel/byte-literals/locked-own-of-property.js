// A compiled executable refuses an own property named of on Uint8Array, because it would hide the inherited one.
// STATISTIC: ByteLiteralsEncoded = 0
// Build prints: 1 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
function make() {
  return String(Uint8Array.of(1, 2));
}
console.log("before |", make());
try {
  Uint8Array.of = (...numbers) => "the own property got " + numbers;
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
/* Output:
before | 1,2
stored throws TypeError
then | 1,2
*/
