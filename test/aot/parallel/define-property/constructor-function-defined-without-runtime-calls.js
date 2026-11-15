// A helper defines four properties on what a constructor function makes. The layout keeps each field with its attributes, so no definition is left to the run time.
// The pair of an accessor is a cell of its own, made in line: the helper is called in a loop. The run time is asked for room alone.
// COUNT: operation:operationAOTDefineOwnProperty = 0
// COUNT: operation:operationAOTNewGetterSetter <= 20
// COUNT: operations <= 60
function describe(made, turn) {
  Object.defineProperty(made, "b", { value: turn, enumerable: true });
  Object.defineProperty(made, "c", { get() { return 2; }, configurable: true });
  Object.defineProperty(made, "y", { value: turn, writable: true });
  Object.defineProperty(made, "z", { value: 3 });
}
function Made(turn) { describe(this, turn); }
let sum = 0;
for (let turn = 0; turn < 2000; turn++) {
  const made = new Made(turn);
  sum += made.b + made.c + made.y + made.z;
}
console.log(sum);
