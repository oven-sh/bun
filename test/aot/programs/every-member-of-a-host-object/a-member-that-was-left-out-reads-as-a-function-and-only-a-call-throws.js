// console.Console is named nowhere, so the code behind it is not in the executable. Whoever comes to it under a key put together at run time reads a function of that name, the same one each time.
// Only the call and the construction throw, and the error names the member. Plain Bun constructs a console.
const proxy = new Proxy({}, { get() { return console; } });
const value = proxy.anything;
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
