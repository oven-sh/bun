const state = require("./state.cjs");
function sum(start) { let total = start; for (let place = 0; place < state.shelf.rows.length; place++) total = total + state.shelf.rows[place]; return total; }
for (let turn = 0; turn < 3; turn++) console.log("SAID", sum(turn));
