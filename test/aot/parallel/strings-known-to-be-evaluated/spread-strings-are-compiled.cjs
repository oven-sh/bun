// A direct eval of a string that a spread brings runs no interpreted code where the build knows the string.
// COUNTER: InterpretedEvalCode = 0
// COUNTER: InterpretedFunctionCode = 0
function build(names) {
  const made = {}, template = "(function (a, b) { return a %op% b + outer; })", outer = 100;
  for (const [name, op] of [["add", "+"], ["sub", "-"]]) {
    const parts = [template.replace("%op%", op), name];
    made[name] = eval(...parts);
  }
  return made;
}
function settled() {
  const outer = 7, parts = ["(function (a) { return a * outer; })"];
  return eval(...parts);
}
const { add, sub } = build();
console.log(add(3, 4), sub(3, 4), settled()(6));
