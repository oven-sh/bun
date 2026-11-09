function giveName(named, text) {
  Object.defineProperty(named, "name", { value: text, enumerable: false, configurable: true });
}
function first() { return "first ran"; }
function second() {}
const watched = new Proxy(first, {
  defineProperty(target, key, descriptor) {
    process.nextTick(() => console.log("ticked", String(key), target()));
    return Reflect.defineProperty(target, key, descriptor);
  },
});
giveName(watched, "one");
giveName(second, "two");
console.log(first.name, second.name);
