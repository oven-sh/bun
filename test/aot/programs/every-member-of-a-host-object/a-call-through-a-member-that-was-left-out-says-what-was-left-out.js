// process.stdin is named nowhere, so the code behind it is not in the executable, and whoever comes to it reads a function in its place. The real member is an object:
// a call of one of its methods finds nothing to call. The error is the one that is thrown anyway, and its message goes on with the sentence that says what was left out.
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
const holder = new Proxy({}, { get() { return process; } }).anything;
const member = holder[key];
console.log(typeof member);
console.log(said(() => member.resume()));
console.log(said(() => member["res" + "ume"]()));
console.log(said(() => holder[key].setEncoding("utf8")));
// A call that has nothing to do with the member says what it always said.
console.log(said(() => ({}).resume()));
console.log(said(() => (0, eval)(decoded("({}).resume()"))));
console.log(said(() => (0, eval)(decoded("undefined()"))));
