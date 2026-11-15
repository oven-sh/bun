function giveName(named, text) {
  Object.defineProperty(named, "name", { value: text, enumerable: false, configurable: true });
}
function first() { return "first ran"; }
function second() { return "second ran"; }
giveName(first, "one");
giveName(second, "two");
console.log(first.name, second.name, first(), second());
