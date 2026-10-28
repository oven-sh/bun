function readExports() { return exports; }
function storeModule(value) { module = value; }
var seen = [];
for (var i = 0; i < 2; i++) { exports = "store " + i; seen.push(readExports()); }
console.log("exports read by a function:", seen.join(), exports);
for (var j = 0; j < 2; j++) { storeModule("store " + j); console.log("module stored by a function:", module); }
