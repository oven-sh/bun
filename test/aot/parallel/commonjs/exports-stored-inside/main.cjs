// Files that store exports and module.exports together inside functions, branches and loops.
var u = require("./underscore.cjs"), late = require("./late.cjs"), b = require("./branches.cjs");
function run(k) { var t = 0; for (var i = 0; i < k; i++) t += u.make(i).sum() + new u.lib.Pair(1, 2).sum(); return t; }
console.log(run(100), u.lib === u, Object.keys(u).join());
console.log(JSON.stringify(late), late.same().join(), require("./late.cjs") === late);
console.log(late.install({ other: 3 }), JSON.stringify(require("./late.cjs")), late.same().join(), require("./late.cjs") === late);
console.log(JSON.stringify(b), b.after);
u.Pair.prototype.sum = function () { return "t"; }; console.log(run(1));
