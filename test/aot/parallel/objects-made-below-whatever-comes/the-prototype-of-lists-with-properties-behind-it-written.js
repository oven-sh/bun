// Made by test/aot/tools/generate-objects-made-below-whatever-comes.py.
let at = 0;
function operand() {
  const pool = [Array.prototype, { a: 7 }, null, 0.5];
  return (operand.last = pool[at]);
}
function make(above, properties) { return Object.create(above, properties); }
function used() {
  const made = make(operand(), { own: { value: 9, enumerable: true } });
  return (() => { made.own2 = 1; return JSON.stringify(made) + " " + Object.prototype.toString.call(made) + " " + ("a" in made) + " " + ("toString" in made); })();
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
