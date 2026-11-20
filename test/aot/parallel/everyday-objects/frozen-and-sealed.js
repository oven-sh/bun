// Writes to frozen, sealed and closed objects in strict code
"use strict";
function attempt(write) {
  try {
    return write() ?? "fine";
  } catch (error) {
    return error.name;
  }
}
function run(n) {
  const frozen = Object.freeze({ a: n, inner: { b: n } });
  const sealed = Object.seal({ a: n });
  const closed = Object.preventExtensions({ a: n });
  const out = [() => (frozen.a = 1), () => void (frozen.inner.b++), () => void (sealed.a += 5), () => (sealed.c = 1), () => delete sealed.a, () => void (closed.a = n * 2), () => (closed.d = 1), () => String(delete closed.a)].map(attempt);
  return out.join() + " " + JSON.stringify([frozen, sealed, closed]) + Object.isFrozen(closed);
}
console.log(run(1));
console.log(run(40));
console.log(run(0));
