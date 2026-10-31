// A variable of the module takes what stands two steps above a callable object of the library.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
let held;
function hold() {
  held = Object.getPrototypeOf(Object.getPrototypeOf(Bun.$));
}
hold();
console.log(held === null, typeof held);
