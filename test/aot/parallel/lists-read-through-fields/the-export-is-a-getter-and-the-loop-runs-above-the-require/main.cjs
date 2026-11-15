function sum(start) { let total = start; for (let place = 0; place < state.shelf.rows.length; place++) total = total + state.shelf.rows[place]; return total; }
console.log("SAID", "a", 1, true, null, undefined);
console.log("SAID", "b", 2, false, null, undefined);
console.log("SAID", "c", 3, true, null, undefined);
console.log("SAID", "d", 4, false, null, undefined);
console.log("SAID", "e", 5, true, null, undefined);
console.log("SAID", "f", 6, false, null, undefined);
try { console.log("SAID", sum(0)); } catch (error) { console.log("SAID", error.name); }
const state = require("./state.cjs");
console.log("SAID", sum(0));
console.log("SAID", sum(1));
