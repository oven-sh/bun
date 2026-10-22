// `module.exports` is a function, a class, what a call made, a primitive; with members behind it; handed through another module.
const add = require("./fn"), Point = require("./cls"), made = require("./made"), both = require("./both"), escapes = require("./escapes"), through = require("./through"), conditional = require("./conditional");
function calls(n) { let s = 0; for (let i = 0; i < n; i++) s = add(s, i); return s; }
console.log(add(1, 2), add.extra, calls(10), require("./fn")(3, 4), new Point(5).x, Point.origin().x, made.made, made.who(), both(), both.sub);
console.log(escapes.a, escapes.keys(), through(1, 1), through.added, add.added, through === add, conditional(), require("./primitive"), typeof require("./primitive"));
