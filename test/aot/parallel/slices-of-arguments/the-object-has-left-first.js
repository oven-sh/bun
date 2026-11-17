// Unseen code has the object before it is sliced.
globalThis.touch = null;
(0, eval)("touch = function (object) { object[0] = 'touched'; object.length = 2; }");
var slice = Array.prototype.slice;
function sliced() { touch(arguments); return slice.call(arguments).join(); }
function run(n) { var out; for (var i = 0; i < n; i++) out = sliced(i, 1, 2); return out; }
console.log(run(20));
