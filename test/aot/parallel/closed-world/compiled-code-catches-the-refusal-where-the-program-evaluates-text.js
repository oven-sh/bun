// process.stdin is named nowhere, so the code behind it is not in the executable. The program evaluates text that the build never saw, so nobody can tell who chose what:
// compiled code that comes to the member under a key put together at run time gets the error that says what was left out, and catches it.
const decoded = text => Buffer.from(text).toString();
function said(use) {
  try {
    return typeof use();
  } catch (error) {
    return error.name + ": " + error.message.split(" because")[0];
  }
}
const holder = (0, eval)(decoded("process"));
const member = holder[["std", "in"].join("")];
console.log(typeof member);
console.log(said(() => member.resume()));
console.log("went on");
/* Output:
object
Error: process.openStdin was not compiled into this executable
went on
*/
