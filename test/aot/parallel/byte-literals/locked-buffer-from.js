// A compiled executable keeps Buffer.from: a store, a definition and a deletion throw, and the call gives the bytes.
// STATISTIC: ByteLiteralsEncoded = 1
// Build prints: 3 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
function make() {
  return String(Buffer.from("literal", "latin1"));
}
console.log("before |", make());
try {
  Buffer.from = (input, encoding) => "the replacement got " + input + " " + encoding;
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
try {
  Object.defineProperty(Buffer, "from", { value: input => "the replacement got " + input });
  console.log("defined");
} catch (error) {
  console.log("defined throws", error.name);
}
console.log("then |", make());
try {
  delete Buffer.from;
  console.log("deleted");
} catch (error) {
  console.log("deleted throws", error.name);
}
console.log("then |", make());
/* Output:
before | literal
stored throws TypeError
then | literal
defined throws TypeError
then | literal
deleted throws TypeError
then | literal
*/
