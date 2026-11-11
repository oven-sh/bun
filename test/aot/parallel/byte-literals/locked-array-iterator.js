// new Uint8Array([..]) and Uint8Array.from([..]) go through the array's iterator, which a compiled executable keeps.
// STATISTIC: ByteLiteralsEncoded = 0
// Build prints: 1 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
function make() {
  return [String(new Uint8Array([1, 2, 3])), Buffer.from([1, 2, 3]).toString("hex"), String(Uint8Array.from([1, 2, 3])), String(Uint8Array.of(1, 2, 3))].join(" | ");
}
console.log("before |", make());
try {
  Array.prototype[Symbol.iterator] = function* () { yield 9; yield 8; };
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
/* Output:
before | 1,2,3 | 010203 | 1,2,3 | 1,2,3
stored throws TypeError
then | 1,2,3 | 010203 | 1,2,3 | 1,2,3
*/
