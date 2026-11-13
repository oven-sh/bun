// An untyped package and a program of it (turns): a list changed by splices in loops: moves, replaces, windows, undo; lists of lists flattened; array-likes and sparse lists
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var e = new lib.Editor([1, 2, 3]); for (var i = 0; i < 40; i++) { var r; switch (i % 8) { case 0: r = e.insert(i % 5, i, 'x' + i); break; case 1: r = e.remove(i % 3, i % 4).join(); break; case 2: r = e.replace(function (x) { return typeof x === 'string'; }, function (x) { return i % 3 ? x.length : [x, x]; }); break; case 3: r = e.move(0, -1); break; case 4: r = e.insert(-2, i / 4); break; case 5: r = e.back(); break; case 6: r = e.windows(2, 2).map(function (w) { return w.join('+'); }).join(); break; default: r = e.remove(-1).join() + e.back() + e.back(); } say(i, r, e.items.join(), e.items.length, e.removed, e.undo.length); if (i === 20) e.items = [1.5, , undefined, null, 'mixed', NaN, NaN]; if (i === 30) e.items.length = 4; }
