// A member of a built-in object is replaced by name, which leaves it without a lock. Then it is replaced through a receiver and a key that the compiler cannot follow.
const hide = value => new CustomEvent("x", { detail: value }).detail;
JSON.parse = () => "by name";
hide(JSON)[hide("parse")] = () => "hidden";
console.log(JSON.parse());
Date.now = () => 1;
hide(Date)[hide("now")] = () => 2;
console.log(Date.now());
console.table = () => "by name";
hide(console)[hide("table")] = () => "hidden";
console.log(console.table());
String.prototype.trim = function () {
  return "by name";
};
hide(String.prototype)[hide("trim")] = [1, 2];
console.log(Array.isArray(" x ".trim), typeof " x ".trim);
console.count = () => 1;
Object.defineProperty(hide(console), hide("count"), {
  get() {
    return () => 2;
  },
});
console.log(console.count());
process.uptime = () => 1;
Reflect.set(hide(process), hide("uptime"), () => 2);
console.log(process.uptime());
console.dir = () => "by name";
Object.assign(hide(console), hide({ dir: () => "hidden" }));
console.log(console.dir());
