function outer() {
  const g = globalThis;
  return () => "madeUpFlag" in g;
}
const has = outer();
console.log(has());
globalThis.madeUpFlag = 1;
console.log(has());
