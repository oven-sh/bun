// process.stdin is named nowhere, so the code behind it is not in the executable. Code that comes to it at run time reads an object that answers `fd` and `isTTY`.
// A read of any other member throws the error that says what was left out.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const decoded = text => Buffer.from(text).toString();
function said(use) {
  try {
    return typeof use();
  } catch (error) {
    return error.name + ": " + error.message.split(" because")[0];
  }
}
// Text that is evaluated at run time.
console.log(said(() => (0, eval)(decoded("process.stdin.resume()"))));
console.log(said(() => (0, eval)(decoded("process.stdin['res' + 'ume']()"))));
// Compiled code comes to the member only under a key put together at run time, and gets the same error.
const key = ["std", "in"].join("");
const holder = (0, eval)(decoded("process"));
const member = holder[key];
console.log(typeof member);
console.log(said(() => member.resume()));
console.log(said(() => member["res" + "ume"]()));
console.log(said(() => holder[key].setEncoding("utf8")));
// A call that has nothing to do with the member says what it always said.
console.log(said(() => ({}).resume()));
console.log(said(() => (0, eval)(decoded("({}).resume()"))));
console.log(said(() => (0, eval)(decoded("undefined()"))));
/* Output:
Error: process.openStdin was not compiled into this executable
Error: process.openStdin was not compiled into this executable
object
Error: process.openStdin was not compiled into this executable
Error: process.openStdin was not compiled into this executable
Error: process.openStdin was not compiled into this executable
TypeError: resume is not a function. (In 'resume()', 'resume' is undefined)
TypeError: ({}).resume is not a function. (In '({}).resume()', '({}).resume' is undefined)
TypeError: undefined is not a function. (In 'undefined()', 'undefined' is undefined)
*/
