// The exports of a sloppy package stay known: nothing hands the global object to code out of sight.
var lib = require("./lib.cjs");
function run(k) { var c = lib.Counter(); for (var i = 0; i < k; i++) c.add(new lib.Point(i, 1)); return c.n; }
console.log(run(100), Object.keys(lib).join(), typeof globalThis.lib);
lib.Point.prototype.total = function () { return 0.5; };
console.log(run(100));
