// Words reserved in strict code alone name variables in a js file.
var package = require("./package.json");
var interface = 1, private = 2, public = 3, protected = 4, static = 5, implements = 6;
module.exports = function (static) { return static; };
console.log(package.name, interface + private + public + protected + static + implements);
