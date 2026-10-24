var package = 1, interface = 2, static = 3;
var x = 5;
var gone = delete x;
function f(a, a2) { return arguments.callee === f }
module.exports = { sum: package + interface + static, gone: gone, callee: f(1, 2), octal: 010 };
