// A captured alias of the global object: a method of the global object is called through it.
function outer() {
  const g = globalThis;
  return text => g.parseInt(text, 16) + g.Math.max(1, 2);
}
console.log(outer()("ff"));
