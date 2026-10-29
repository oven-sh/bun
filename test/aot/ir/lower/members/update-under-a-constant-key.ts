// A member of a bound function is counted up under a key that a constant holds.
// RUN: lower
// CHECK: = PropGet [[target]] key="name"
// CHECK: PropSet [[target]], {{*}}key="name"
// CHECK: = PropGet [[target]] key="name"

const key = "name";
const held: Function = function named() {}.bind(null);
try {
  const target: any = held;
  target[key]++;
  console.log([target[key]]);
} catch {
  console.log("threw");
}
