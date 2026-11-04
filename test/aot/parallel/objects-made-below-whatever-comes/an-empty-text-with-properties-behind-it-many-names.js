// Made by test/aot/tools/generate-objects-made-below-whatever-comes.py.
let at = 0;
function operand() {
  const pool = ["", { a: 7 }, null, 0.5];
  return (operand.last = pool[at]);
}
function make(above, properties) { return Object.create(above, properties); }
function used() {
  const made = make(operand(), { own: { value: 9, enumerable: true } });
  return (() => { for (let i = 0; i < 12; i++) made["n" + i] = i; let sum = 0; for (const name in made) if (Object.prototype.hasOwnProperty.call(made, name)) sum += made[name] === undefined ? 0 : 1; return sum + " " + made.n11; })();
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
