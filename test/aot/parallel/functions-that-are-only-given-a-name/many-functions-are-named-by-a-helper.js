// STATISTIC: ImageFunctionsEmitted <= 20
function giveName(named, text) {
  Object.defineProperty(named, "name", { value: text, enumerable: false, configurable: true });
}
function first() { process.nextTick(() => console.log("first ran")); }
function second() { process.nextTick(() => console.log("second ran")); }
function third() { process.nextTick(() => console.log("third ran")); }
giveName(first, "one");
giveName(second, "two");
giveName(third, "three");
console.log(first.name, second.name, third.name);
