// A compiled executable keeps %TypedArray%.of, which every typed array constructor inherits.
// STATISTIC: ByteLiteralsEncoded = 0
function make() {
  return String(Uint8Array.of(1, 2));
}
console.log("before |", make());
try {
  Object.getPrototypeOf(Uint8Array).of = (...numbers) => "the replacement got " + numbers;
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
