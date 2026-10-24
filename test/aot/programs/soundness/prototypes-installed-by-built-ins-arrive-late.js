// The prototype that a built-in installs, and the object it installs it on, arrive one after the other.
function main() {
let proto = { who() { proto = { who() { return { second: true }; } }; return 1; } };
const child = {};
const got = [];
for (let i = 0; i < 2; i++) {
  Object.setPrototypeOf(child, proto);
  got.push(typeof child.who());
}
console.log(got.join());
let base = null;
let kids = [];
function later() { base = { hello() { return "hello"; } }; }
for (let i = 0; i < 2; i++) {
  kids.push(Object.create(base));
  [0].forEach(later);
}
console.log(typeof kids[0].hello, kids[1].hello());
let inspected = { __proto__: { level: 1 } };
function swap() { inspected = Object.create({ level: "two" }); }
for (let i = 0; i < 2; i++) {
  console.log(typeof Object.getPrototypeOf(inspected).level);
  [0].forEach(swap);
}
const changing = {};
function reparent() { Object.setPrototypeOf(changing, { level: { three: 3 } }); }
for (let i = 0; i < 2; i++) {
  console.log(typeof Reflect.getPrototypeOf(changing).level);
  [0].forEach(reparent);
}
}
main();
