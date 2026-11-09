// A name is read off a closure that has no such name, and Object.assign, Object.defineProperty and Reflect.set each give it one.
// Under: --aot-testing=CheckProofsAtRunTime: LinkedFunction::closuresStayAsMade
function first() {
  return 1;
}
function second() {
  return 2;
}
function third() {
  return 3;
}
function read() {
  return [first.cache, "cache" in first, second.cache, "cache" in second, third.cache, "cache" in third, first() + second() + third()].join(" ");
}
function deed() {
  Object.assign(first, { cache: "assigned" });
  Object.defineProperty(second, "cache", { get: () => "defined" });
  Reflect.set(third, "cache", "set");
}
console.log(read());
let last = "";
for (let i = 0; i < 300; i++) last = read();
console.log(last);
deed();
console.log(read());
