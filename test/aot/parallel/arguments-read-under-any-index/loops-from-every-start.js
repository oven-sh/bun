var call = (0, eval)("(f, list) => f.apply(null, list)");
function from(start, args) { return args; }
function none() { var s = ""; for (var i = 0; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function oneFromZero(a) { var s = ""; for (var i = 0; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function threeFromOne(a, b, c) { var s = ""; for (var i = 1; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function threeFromTwo(a, b, c) { var n = arguments.length - 2, out = n > 0 ? Array(n) : []; for (var i = 0; i < n; i++) out[i] = arguments[i + 2]; return out.join(); }
function fourFromZero(a, b, c, d) { var s = ""; for (var i = 0; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function fiveFromZero(a, b, c, d, e) { var s = ""; for (var i = 0; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function fiveFromOne(a, b, c, d, e) { var s = ""; for (var i = 1; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function downward(a, b) { var s = ""; for (var i = arguments.length - 1; i >= 0; i--) s += String(arguments[i]) + ","; return s; }
function pastTheEnd(a, b) { var s = ""; for (var i = 0; i < 5; i++) s += String(arguments[i]) + ","; return s; }
function strict(a, b) { "use strict"; var s = ""; for (var i = 0; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function onOneWay(a, b, c) { switch (arguments.length) { case 0: return "none"; case 1: return "one:" + a; default: var s = ""; for (var i = 1; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; } }
var all = [none, oneFromZero, threeFromOne, threeFromTwo, fourFromZero, fiveFromZero, fiveFromOne, downward, pastTheEnd, strict, onOneWay], values = [1, undefined, "c", null, 5.5, { toString() { return "o"; } }, 7];
for (var round = 0; round < 3; round++)
  for (var f = 0; f < all.length; f++)
    for (var n = 0; n <= 7; n++) console.log(f, n, call(all[f], values.slice(0, n)));
