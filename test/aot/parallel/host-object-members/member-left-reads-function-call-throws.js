// console.Console is named nowhere, so the code behind it is not in the executable. Whoever comes to it under a key put together at run time reads a function of that name, the same one each time.
// Only the call and the construction throw, and the error names the member. Plain Bun constructs a console.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const decoded = text => Buffer.from(text).toString();
const value = (0, eval)(decoded("console"));
const key = ["Con", "sole"].join("");
const member = value[key];
console.log(typeof member, member.name, value[key] === member, Reflect.get(value, key) === member);
console.log(key in value, Object.hasOwn(value, key), typeof Object.getOwnPropertyDescriptor(value, key));
for (const use of [() => new member({ stdout: process.stdout }), () => member({ stdout: process.stdout })]) {
  try {
    console.log(typeof use());
  } catch (error) {
    console.log(error.message.split(" because")[0]);
  }
}
/* Output:
function Console true true
true true object
console.Console was not compiled into this executable
console.Console was not compiled into this executable
*/
