function outer() {
  const g = globalThis;
  return value => {
    g.madeUpCounter = value;
  };
}
outer()(41);
console.log(globalThis.madeUpCounter + 1);
