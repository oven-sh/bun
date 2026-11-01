// Alone: the stores of other programs would be seen beside its own
function make() {
  return {
    pick() {
      return "mine";
    },
  };
}
let e;
try {
  null.x;
} catch (x) {
  e = x;
}
Object.defineProperties(e.constructor.prototype, Object.getOwnPropertyDescriptors(make()));
function read() {
  return new TypeError("m").pick();
}
console.log(read());
