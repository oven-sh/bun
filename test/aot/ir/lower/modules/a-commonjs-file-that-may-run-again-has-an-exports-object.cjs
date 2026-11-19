// A handler outlives what the first run of ledger.cjs throws, so the next `require` runs the file again. Each run fills an object of its own: no name of the file is a variable of the program,
// and the name that holds what `require` answered holds that object.
// RUN(AGAIN): link
// AGAIN: layout [[exports]] module=[[ledger]] fields=[{key="early"{{*}}{key="late"
// AGAIN: module [[ledger]] path="{{*}}/ledger.cjs"{{*}}MayBeReevaluated]{{*}}exportsVariable=[[whole]]
// AGAIN: = NewObject layout=[[exports]]
// AGAIN: PutModuleVariable {{*}}variable=[[whole]]
// AGAIN: PropSet {{*}}key="early"
// AGAIN: PropSet {{*}}key="late"
// AGAIN: PropGet {{*}}key="early"
// AGAIN: PropGet {{*}}key="late"

// FILE: main.cjs
try {
  require("./ledger.cjs");
} catch {}
const ledger = require("./ledger.cjs");
console.log(ledger.early, ledger.late);

// FILE: ledger.cjs
exports.early = 1;
if (globalThis.fails) throw new Error("boom");
exports.late = 2;
