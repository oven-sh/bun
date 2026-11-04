function lengthIsSet(a, b) { arguments.length = 1; var n = 0; if (arguments.length === 1) b = 2; for (var i = a; i < b; i++) n += i + 1; return n; }
function isAliased(a, b) { arguments[1] = 2; var n = 0; for (var i = a; i < b; i++) n += i + 1; return n + arguments.length; }
function aliasIsRead(a, b) { b = 2; var n = 0; for (var i = a; i < arguments[1]; i++) n += i + 1; return n; }
function leaks(a, b) { kept = arguments; var n = 0; if (arguments.length === 2) n = 1; for (var i = a; i < b; i++) n += i + 1; return n; }
function strict(a, b) { "use strict"; arguments[1] = 2; var n = 0; for (var i = a; i < b; i++) n += i + 1; return n + arguments.length; }
function parameterIsStored(a, b) { if (b > 3) b = 3; a = a + 1; var n = 0; for (var i = a; i < b; i++) n += i + 1; return n; }
var kept, carried = 0;
for (var turn = 0; turn < 30; turn++)
  carried += lengthIsSet(0, 5) + isAliased(0, 5) + aliasIsRead(0, 5) + leaks(0, 5) + kept.length + strict(0, 5) + parameterIsStored(0, 5) + parameterIsStored(0, 2);
console.log(carried, lengthIsSet(0, 5), isAliased(0, 5), aliasIsRead(0, 5), leaks(0, 5), strict(0, 5), parameterIsStored(0, 5));
