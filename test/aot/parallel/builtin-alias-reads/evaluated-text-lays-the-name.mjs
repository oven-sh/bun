// Evaluated text lays the name, and the captured alias reads it.
function outer() {
  const g = globalThis;
  return () => g.madeUpByText;
}
new Function("globalThis.madeUpByText = 'laid by text';")();
console.log(outer()());
