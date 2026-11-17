// the reader is the generator itself. plain: 3,2,1 true
const n = +process.argv[2] || 3;
function f() {
  "use strict";
  function* count(k) {
    if (k > 0) {
      yield k;
      yield* count(k - 1);
    }
  }
  const a = () => count(n), b = () => count(1);
  return [...a()].join() + " " + String(Object.getPrototypeOf(a()) === Object.getPrototypeOf(b()));
}
console.log(f());
