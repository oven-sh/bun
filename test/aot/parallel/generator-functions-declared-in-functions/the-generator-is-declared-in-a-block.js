const n = +process.argv[2] || 3;
function f(flag) {
  "use strict";
  if (flag) {
    function* gen() { yield n; }
    const a = () => gen(), b = () => gen();
    return Object.getPrototypeOf(a()) === Object.getPrototypeOf(b());
  }
  return null;
}
console.log(String(f(n > 0)));
