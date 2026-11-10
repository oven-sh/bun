// A compiled executable keeps Uint8Array.fromHex against a store made by code that is evaluated at run time.
// STATISTIC: ByteLiteralsEncoded = 2
function make() {
  return String(Uint8Array.fromHex("6869"));
}
console.log("before |", make());
try {
  (0, eval)('Uint8Array.fromHex = input => "the replacement got " + input');
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
/* Output:
before | 104,105
stored throws TypeError
then | 104,105
*/
