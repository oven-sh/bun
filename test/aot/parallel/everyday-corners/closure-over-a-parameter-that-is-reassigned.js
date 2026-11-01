// Closure over a parameter that is reassigned: compiled answers as plain.
function f(x) {
  const g = () => x;
  x = x === undefined ? "default" : x * 2;
  return g();
}
console.log(f(), f(2), f("a"));
