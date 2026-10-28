// a.cjs and one line that never runs, in which the module is loaded under a computed name.
let first; try { require("./fails-once.cjs"); } catch (error) { first = error.message; }
const second = require("./fails-once.cjs");
const [old, fresh] = globalThis.kept;
old.bump(); second.state.n = 5; fresh.state.list.push(1);
console.log(old.state === fresh.state, old.bump === fresh.bump, old.state.n, fresh.state.n, old.state.list.length, fresh.state.list.length);
if (process.argv.length > 99) require(Buffer.from("./fails-once.cjs").toString());
