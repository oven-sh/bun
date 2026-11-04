// Made by test/aot/tools/generate-objects-made-below-whatever-comes.py.
let at = 0;
function operand() {
  const pool = [new Uint8Array(2), { a: 7 }, null, 0.5];
  return (operand.last = pool[at]);
}
function make(above) { return Object.create(above, undefined); }
function used() {
  const made = make(operand());
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
