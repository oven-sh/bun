// A cycle in the graph that never happens: a requires b in a function that runs when the body of a has ended, so b sees all of a.
const a = require("./a.cjs");
console.log("a is loaded");
console.log(a.partner().saw, a.partner() === a.partner());
