// Alone: the stores of other programs would be seen beside its own
function make() {
  return {
    pick: function () {
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
Object.defineProperties(e.constructor, Object.getOwnPropertyDescriptors(make()));
function read() {
  return TypeError.pick();
}
console.log(read());
