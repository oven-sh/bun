var call = (0, eval)("(f, list) => f.apply(null, list)"), unseen = (0, eval)("(x) => x");
function walk(args) { return args; }
function parameterStored(a, b) { b = "stored"; var s = ""; for (var i = 0; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function parameterStoredStrict(a, b) { "use strict"; b = "stored"; var s = ""; for (var i = 0; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function parameterStoredInTurn(a, b) { var s = ""; for (var i = 0; i < arguments.length; i++) { s += String(arguments[i]) + ","; b = "turn" + i; } return s; }
function elementStored(a, b) { arguments[1] = "element"; var s = b + ":"; for (var i = 0; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function elementStoredInTurn(a, b) { var s = ""; for (var i = 0; i < arguments.length; i++) { arguments[i + 1] = "next" + i; s += String(arguments[i]) + ","; if (i > 5) break; } return s; }
function elementDeleted(a, b) { delete arguments[0]; var s = ""; for (var i = 0; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function lengthStored(a, b) { arguments.length = 3; var s = ""; for (var i = 0; i < arguments.length; i++) s += String(arguments[i]) + ","; return s; }
function leaves(a, b) { var s = ""; for (var i = 0; i < arguments.length; i++) { s += String(arguments[i]) + ","; if (i === 1) unseen(arguments)[0] = "seen"; } return s + arguments[0]; }
function callsBetween(a, b) { var s = ""; for (var i = 0; i < arguments.length; i++) s += String(unseen(arguments[i])) + ","; return s; }
function otherKeys(a, b) { return [arguments["0"], arguments[1.5], arguments[-1], arguments["length"], arguments[unseen(1)], arguments[unseen("0")]].map(String).join(); }
var all = [parameterStored, parameterStoredStrict, parameterStoredInTurn, elementStored, elementStoredInTurn, elementDeleted, lengthStored, leaves, callsBetween, otherKeys];
for (var round = 0; round < 3; round++)
  for (var f = 0; f < all.length; f++)
    for (var n = 0; n <= 4; n++) console.log(f, n, call(all[f], [1, 2, 3, 4].slice(0, n)));
