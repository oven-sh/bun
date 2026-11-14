function sum(count) { let total = 0; for (let place = 0; place < count; place++) total = total + state.shelf.rows[place]; return total; }
console.log("SAID", "a", 1, true, null, undefined);
console.log("SAID", "b", 2, false, null, undefined);
console.log("SAID", "c", 3, true, null, undefined);
console.log("SAID", "d", 4, false, null, undefined);
console.log("SAID", "e", 5, true, null, undefined);
console.log("SAID", sum(process.argv.length - process.argv.length));
const state = require("./state.cjs");
console.log("SAID", sum(4));
