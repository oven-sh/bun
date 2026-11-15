function giveName(named, text) {
  Object.defineProperty(named, "name", { get() { return this(); }, configurable: true });
}
function first() { process.nextTick(() => console.log("ticked")); return "first ran"; }
function second() { return "second ran"; }
giveName(first, "one");
giveName(second, "two");
console.log(first.name, second.name);
