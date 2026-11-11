// A captured alias of the global object: a name of the program is tested with `in`.
function outer() {
  const g = globalThis;
  return () => "madeUpFlag" in g;
}
const has = outer();
console.log(has());
globalThis.madeUpFlag = 1;
console.log(has());
