const state = require("./state.cjs");
function sum(start) { let total = start; for (let place = 0; place < state.shelf.rows.length; place++) total = total + state.shelf.rows[place]; return total; }
function say() { try { console.log("SAID", sum(0)); } catch (error) { console.log("SAID", error.name); } }
say();
state.fill(process.argv[2] ?? "[1,2,3]"); say();
state.fill("[10,20]"); say();
state.empty(); say();
state.fill("[0.5]"); say();
