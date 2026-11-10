// `const zero = 0` is an int32 in every function that reads it, as `const one = 1` is.
import type { int32 } from "bun";

const zero = 0;
const hex = 0x0;
const one = 1;
function take(n: int32): number {
  return n + 1;
}
function plain() {
  return take(zero);
}
const arrow = () => take(hex);
class Counter {
  start() {
    return take(zero) + take(one);
  }
}
function make() {
  return {
    first() {
      return take(zero);
    },
  };
}
function readsWhatIsDeclaredBelow() {
  return take(late);
}
const late = 0;
function local() {
  const none = 0;
  return () => take(none);
}

console.log(
  take(zero),
  plain(),
  arrow(),
  new Counter().start(),
  make().first(),
  readsWhatIsDeclaredBelow(),
  local()(),
  Object.is(zero, 0),
  1 / zero,
);
