// Whoever prints an object asks its own `constructor` for `prototype`, as Node does: a getter there runs and changes a variable and a field, and the printer then leaves the method under its key alone.
// Each function reads one of the two, makes the call and reads it again, and does nothing else that could run code.
let ran = 0;
const held = { ran: 0 };
const thing = { size: 1 };
Object.defineProperty(thing, Symbol.for("nodejs.util.inspect.custom"), {
  value() {
    return "custom " + this.size;
  },
});
Object.defineProperty(thing, "constructor", {
  value: {
    get prototype() {
      ran++;
      held.ran++;
      return thing;
    },
  },
});
function variableAround(value) {
  const before = ran;
  console.log(value);
  return before + " " + ran;
}
function fieldAround(value) {
  const before = held.ran;
  console.log(value);
  return before + " " + held.ran;
}
console.log(variableAround(thing), fieldAround(thing));
console.log(ran, held.ran);
