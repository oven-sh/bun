function giveName(named, text) {
  Object.defineProperty(named, "name", { value: text, enumerable: false, configurable: true });
}
class Holder { static name = "as written"; static tell() { return Holder.name; } }
function first() {}
giveName(first, "one");
giveName(Holder, "given");
console.log(first.name, Holder.tell());
