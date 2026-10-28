// `arguments.callee` in a factory is the function that the program called, whichever call it was.
function self() {
  const callee = arguments.callee;
  return () => callee;
}
const first = self();
const second = self();
console.log(first() === self, second() === self, first() === second());
