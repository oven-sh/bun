// A local alias of the global object is captured by value.
function outer() {
  const g = globalThis;
  return () => typeof g.Array;
}
console.log(outer()());
