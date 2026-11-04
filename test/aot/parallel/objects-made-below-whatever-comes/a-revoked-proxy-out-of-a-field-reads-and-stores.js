// Made by test/aot/tools/generate-objects-made-below-whatever-comes.py.
let at = 0;
function operand() {
  const pool = [(() => { const made = Proxy.revocable({}, {}); made.revoke(); return made.proxy; })(), { a: 7 }, null, 0.5];
  return (operand.last = pool[at]);
}
function make(holder) { return Object.create(holder.above); }
function used() {
  const made = make({ above: operand() });
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
