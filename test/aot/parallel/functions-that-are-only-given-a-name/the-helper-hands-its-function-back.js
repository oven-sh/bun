function giveName(named, text) {
  return Object.defineProperty(named, "name", { value: text, enumerable: false, configurable: true });
}
function first() { process.nextTick(() => console.log("ticked")); return "first ran"; }
function second() { return "second ran"; }
console.log(giveName(first, "one")(), giveName(second, "two")());
