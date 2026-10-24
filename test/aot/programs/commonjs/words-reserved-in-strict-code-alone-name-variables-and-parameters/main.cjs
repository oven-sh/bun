// Words reserved in strict code alone name variables and parameters.
var package = require("./package.json");
var interface = 1, private = 2, public = 3, protected = 4, static = 5, implements = 6;
function f(package, interface) { return package + interface; }
console.log(package.name, interface + private + public + protected + static + implements, f(1, 2));
