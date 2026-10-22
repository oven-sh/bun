// A variable that holds the result of a require and is stored again, and a `var` that is declared twice: each holds a value, and a read goes to the module it holds at that moment.
let a = require("./x.cjs");
const read = () => a.n;
a = require("./y.cjs");
console.log(read());
var twice = require("./x.cjs");
const first = twice.n;
var twice = require("./y.cjs");
console.log(first, twice.n);
