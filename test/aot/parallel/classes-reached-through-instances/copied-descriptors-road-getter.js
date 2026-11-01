// Alone: the stores of other programs would be seen beside its own
function make() {
  return {
    get got() {
      return 7;
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
  return TypeError.got;
}
console.log(read());
