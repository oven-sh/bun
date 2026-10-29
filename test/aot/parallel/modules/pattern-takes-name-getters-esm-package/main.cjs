// A pattern takes a name through getters and an es module in a package without side effects.
var { x } = require("./h3.cjs");
console.log("x is " + x);
