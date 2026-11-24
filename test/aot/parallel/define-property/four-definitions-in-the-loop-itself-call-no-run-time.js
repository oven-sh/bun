// The twin of constructor-function-defined-without-runtime-calls.js: the four definitions stand in the loop itself: there the pair of the accessor is made in line too, and nothing calls the run time.
// COUNT: operation:operationAOTDefineOwnProperty = 0
// COUNT: operations <= 40
function Made() {}
let sum = 0;
for (let turn = 0; turn < 2000; turn++) {
  const made = new Made();
  Object.defineProperty(made, "b", { value: turn, enumerable: true });
  Object.defineProperty(made, "c", { get() { return 2; }, configurable: true });
  Object.defineProperty(made, "y", { value: turn, writable: true });
  Object.defineProperty(made, "z", { value: 3 });
  sum += made.b + made.c + made.y + made.z;
}
console.log(sum);
