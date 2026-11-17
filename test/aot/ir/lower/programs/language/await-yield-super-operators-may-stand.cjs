// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1034 1
// DIAGNOSTIC: TS1359 3

// `await` as the parameter of an async arrow function, `yield` in the parameters of an arrow function in a generator, and `new super`: `bun run` reports each and runs nothing.
console.log("never printed");
function holdsAsyncArrow() {
  return async await => 1;
}
function* holdsArrow() {
  return (value = yield) => value;
}
function* holdsNestedArrows() {
  return (outer = (inner = yield) => inner) => outer;
}
class Derived extends Object {
  method() {
    return new super();
  }
}
console.log(holdsAsyncArrow, holdsArrow, holdsNestedArrows, Derived);
