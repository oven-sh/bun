// A name is read off a closure that has no such name, and the closure is laid below an object that has it.
// Under: --aot-testing=CheckProofsAtRunTime: LinkedFunction::closuresStayAsMade
function subject() {
  return 1;
}
function read() {
  return String(subject.cache) + String("cache" in subject) + String(subject());
}
function deed(f) {
  Object.setPrototypeOf(f, { cache: "above", __proto__: Function.prototype });
}
console.log(read());
let last = "";
for (let i = 0; i < 300; i++) last = read();
console.log(last);
deed(subject);
console.log(read());
