// A variable of the module takes what stands two steps above a callable object of the library.
let held;
function hold() {
  held = Object.getPrototypeOf(Object.getPrototypeOf(Bun.$));
}
hold();
console.log(held === null, typeof held);
