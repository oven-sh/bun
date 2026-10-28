// console.Console is named nowhere. console leaves through the trap of a proxy and comes back as a value that nobody knows, so its members are in the executable:
// whoever comes to one under a key put together at run time calls and constructs it.
const proxy = new Proxy({}, { get() { return console; } });
const value = proxy.anything;
const key = ["Con", "sole"].join("");
const member = value[key];
console.log(typeof member, member.name, member.length, value[key] === member, Reflect.get(value, key) === member);
console.log(key in value, Object.hasOwn(value, key), typeof Object.getOwnPropertyDescriptor(value, key));
for (const use of [() => new member({ stdout: process.stdout }), () => member({ stdout: process.stdout })]) {
  const made = use();
  console.log(typeof made, typeof made.log);
  made.log("printed by what was made");
}
