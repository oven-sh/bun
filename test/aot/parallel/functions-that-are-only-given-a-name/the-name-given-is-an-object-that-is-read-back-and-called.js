function giveName(named, text) {
  Object.defineProperty(named, "name", { value: text, enumerable: false, configurable: true });
}
function first() {}
function second() {}
giveName(first, { tell() { process.nextTick(() => console.log("ticked")); return "told"; } });
giveName(second, "two");
console.log(first.name.tell(), second.name);
