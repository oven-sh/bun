function giveLength(named, count) {
  Object.defineProperty(named, "length", { value: count, configurable: true });
}
function first(a, b) {}
function second(a) {}
giveLength(first, 7);
giveLength(second, 9);
console.log(first.length + second.length, first.length * 2);
