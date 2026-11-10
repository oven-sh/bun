// A compiled executable keeps Buffer.from against a store through an object that the build cannot read.
// STATISTIC: ByteLiteralsEncoded = 1
function make() {
  return String(Buffer.from("literal", "latin1"));
}
console.log("before |", make());
try {
  globalThis[JSON.parse('"Buffer"')].from = input => "the replacement got " + input;
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
/* Output:
before | literal
stored throws TypeError
then | literal
*/
