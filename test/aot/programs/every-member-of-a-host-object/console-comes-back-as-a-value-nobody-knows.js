// No member of console but `log` is named. console leaves through the trap of a proxy and comes back as a value that nobody knows, and built-ins then read every member of it. No read throws.
const proxy = new Proxy({}, { get() { return console; } });
const value = proxy.anything;
const key = ["Con", "sole"].join("");
const copy = Object.assign({}, value);
console.log("assign", typeof copy[key]);
const spread = { ...value };
console.log("spread", typeof spread[key]);
let found = "none";
for (const [name, member] of Object.entries(value)) {
  if (name === key) found = typeof member;
}
console.log("entries", found);
console.log("values", Object.values(value).every(member => typeof member === "function"));
console.log("by key", typeof value[key], typeof Reflect.get(value, key));
