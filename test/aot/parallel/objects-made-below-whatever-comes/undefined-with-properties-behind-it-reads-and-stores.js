// Made by test/aot/tools/generate-objects-made-below-whatever-comes.py.
let at = 0;
function operand() {
  const pool = [undefined, { a: 7 }, null, 0.5];
  return (operand.last = pool[at]);
}
function make(above, properties) { return Object.create(above, properties); }
function used() {
  const made = make(operand(), { own: { value: 9, enumerable: true } });
  return (() => { const before = String(made.a) + String(made.b); made.a = 10; made.c = 3; return before + " " + made.a + " " + String(made.b) + " " + Object.keys(made).join(); })();
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
