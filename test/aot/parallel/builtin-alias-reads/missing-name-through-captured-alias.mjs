// The table has no member under the name, so what answers is what the program laid there: nothing.
function outer() {
  const g = globalThis;
  return () => g.madeUp;
}
console.log(outer()());
