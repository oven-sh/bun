// process.stdin is named nowhere, so the code behind it is not in the executable, and whoever comes to it reads a function in its place. The real member is an object:
// a call of one of its methods finds nothing to call. The error is the one that is thrown anyway, and its message goes on with the sentence that says what was left out.
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
// Compiled code comes to the member only under a key put together at run time. Where it tests the callee it has no receiver at hand, so it says what it always says.
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
TypeError: process.stdin.resume is not a function. (In 'process.stdin.resume()', 'process.stdin.resume' is undefined). None of process.openStdin or process.stdin was compiled into this executable
TypeError: process.stdin['res' + 'ume'] is not a function. (In 'process.stdin['res' + 'ume']()', 'process.stdin['res' + 'ume']' is undefined). None of process.openStdin or process.stdin was compiled into this executable
function
TypeError: member.resume is not a function. (In 'member.resume()', 'member.resume' is undefined)
TypeError: member.resume is not a function. (In 'member.resume()', 'member.resume' is undefined)
TypeError: holder[key].setEncoding is not a function. (In 'holder[key].setEncoding()', 'holder[key].setEncoding' is undefined)
TypeError: resume is not a function. (In 'resume()', 'resume' is undefined)
TypeError: ({}).resume is not a function. (In '({}).resume()', '({}).resume' is undefined)
TypeError: undefined is not a function. (In 'undefined()', 'undefined' is undefined)
*/
