// Made by test/aot/tools/generate-objects-made-below-whatever-comes.py.
const above = [{ a: 1 }, { a: 2 }, { a: 3 }, null, { a: 4 }];
function make(holder) { return Object.create(holder.above); }
function safely(holder) {
  try {
    const made = make(holder);
    return (Object.getPrototypeOf(made) === holder.above) + " " + made.a;
  } catch (error) {
    return "thrown: " + error.name + (/^(Array length|Object prototype|Property description)/.test(error.message) ? ": " + error.message : "");
  }
}
let printed = "";
for (let turn = 0; turn < 3; turn++) for (let at = 0; at < above.length; at++) printed += safely({ above: above[at] }) + ";";
console.log(printed);
