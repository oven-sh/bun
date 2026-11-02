// The package says that its files have no side effects. A namespace object comes to this file through two others: they run, and so does the module that the object shows, whatever is read off it.
console.log(require("./absent-again.mjs").ns.nothing);
console.log(typeof require("./named-again.mjs").ns.c);
const again = require("./held-again.mjs");
console.log(again.ns.d);
console.log(Object.keys(require("./listed-again.mjs").ns));
