// `{ __proto__: value, .. }`: an object, a function or null becomes the prototype of the literal; anything else is passed over. The value is only known when the program runs, and variables that are set before the literal are read behind it.
function describe(made) {
  const prototype = Object.getPrototypeOf(made);
  return [prototype === null ? "null" : prototype === Object.prototype ? "Object.prototype" : typeof prototype, Object.keys(made).join(), made.inherited];
}
function make(prototype, turn) {
  let label = "before";
  if (turn % 2) label = "odd";
  const made = describe({ __proto__: prototype, a: 1, [label]: turn });
  return label + ": " + made.join(" ");
}
const prototypes = [{ inherited: "from an object" }, Object.assign(function () {}, { inherited: "from a function" }), null, undefined, 5, "text", true, Symbol("s"), 10n];
prototypes.forEach((prototype, turn) => console.log(make(prototype, turn)));
