// BUN_JSC_useTemporal=0 takes the global Temporal away, and a script that the build has not seen stores and declares under the name. Either it is refused and compiled code goes on finding nothing, or it is admitted and compiled code sees it from then on.
// Flags: --aot-validate
// Env: BUN_JSC_useTemporal=0
const vm = require("node:vm");
const key = ["Tem", "poral"].join("");
const absent = {};
function read() {
  try {
    return Temporal;
  } catch {
    return absent;
  }
}
const kindOf = value => (value === absent ? "undefined" : typeof value);

const wrong = [];
function expect(what, expected) {
  for (let round = 0; round < 40; round++) {
    if (!Object.is(read(), expected)) return void wrong.push(what + ": the read");
    if (typeof Temporal !== kindOf(expected)) return void wrong.push(what + ": typeof");
  }
}
const inObject = () => (key in globalThis ? globalThis[key] : absent);

// A refusal throws, in sloppy code too.
function run(text) {
  try {
    vm.runInThisContext(text);
  } catch (error) {
    if (error.name !== "TypeError") wrong.push(text + ": " + error.name);
  }
}

expect("at first", inObject());
run("globalThis." + key + " = 'stored by the script'");
expect("behind the store", inObject());
run("delete globalThis." + key);
expect("behind the delete", inObject());
let declared = inObject();
try {
  vm.runInThisContext("let " + key + " = 'declared by the script'");
  declared = "declared by the script";
} catch (error) {
  if (error.name !== "SyntaxError") wrong.push("the declaration: " + error.name);
}
expect("behind the declaration", declared);
console.log(wrong.length ? "compiled code does not see: " + wrong.join(", ") : "compiled code sees what was done");
