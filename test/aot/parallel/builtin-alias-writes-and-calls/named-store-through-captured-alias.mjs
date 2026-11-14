// A captured alias of the global object: a store under a name of the program.
function outer() {
  const g = globalThis;
  return value => {
    g.madeUpCounter = value;
  };
}
outer()(41);
console.log(globalThis.madeUpCounter + 1);
