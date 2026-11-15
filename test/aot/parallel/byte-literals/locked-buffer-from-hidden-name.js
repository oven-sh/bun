// A compiled executable keeps Buffer.from against a store under a name that the build cannot read.
// STATISTIC: ByteLiteralsEncoded = 1
// Build prints: 1 x warn: TS100014: the compiler can't read the property name here. This assignment throws if the name is an existing member, or one that compiled code relies on being absent: a compiled executable keeps both as they are on built-in objects
const name = JSON.parse('"from"');
function make() {
  return String(Buffer.from("literal", "latin1"));
}
console.log("before |", make());
try {
  Buffer[name] = (input, encoding) => "the replacement got " + input + " " + encoding;
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
