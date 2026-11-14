// A module of Node is an object, and its classes are functions: a string that is made of their kinds is known.
// COUNTER: InterpretedEvalCode = 0
const url = require("url"), path = require("node:path");
var kinds = [];
function add(kind) { kinds.push(kind); }
eval("add('" + typeof url + "')");
eval("add('" + typeof require("node:url") + "')");
eval("add('" + typeof url.URL + "')");
eval("add('" + typeof url.fileURLToPath + "')");
eval("add('" + typeof path + "')");
console.log(kinds.join());
