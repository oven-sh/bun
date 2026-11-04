// Made by test/aot/tools/generate-objects-made-below-whatever-comes.py.
let at = 0;
function operand() {
  const pool = [function named() { return 1; }, { a: 7 }, null, 0.5];
  return (operand.last = pool[at]);
}
function make(list, at) { return Object.create(list[at]); }
function used() {
  const made = make([0, operand()], 1);
  return (() => { const above = operand.last; return (Object.getPrototypeOf(made) === above) + " " + Object.keys(made).join() + " " + typeof made; })();
}
function safely() {
  try {
    return String(used());
  } catch (error) {
    return "thrown: " + error.name + (/^(Array length|Object prototype|Property description)/.test(error.message) ? ": " + error.message : "");
  }
}
for (let turn = 0; turn < 8; turn++) {
  at = turn & 3;
  console.log(safely());
}
