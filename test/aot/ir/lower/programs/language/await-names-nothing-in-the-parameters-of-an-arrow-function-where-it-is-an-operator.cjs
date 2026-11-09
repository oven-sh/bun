// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1359 4

// `await` as a name in the parameters of an arrow function that stands in a static block, in the parameters of an async arrow function or in an async function: `bun run` reports each and runs nothing.
console.log("never printed");
class HoldsArrow {
  static {
    ((value = await) => value);
  }
}
const holdsNestedArrow = async (outer = (...await) => {}) => outer;
async function holdsArrowToo() {
  return (value = await) => value;
}
async function holdsNestedArrows() {
  return (outer = (inner = await) => inner) => outer;
}
console.log(HoldsArrow, holdsNestedArrow, holdsArrowToo, holdsNestedArrows);
