// A local alias of the global object that is declared with let.
function outer() {
  let g = globalThis;
  return () => typeof g.Array;
}
console.log(outer()());
