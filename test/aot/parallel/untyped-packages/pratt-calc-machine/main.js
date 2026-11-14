// An untyped package and a program of it (machine): a lexer, a parser by precedence, an evaluator with scopes, a printer, a simplifier and code for a stack machine
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var vars = { x: 1, y: 2.5, t: 'text', z: 0 }; ['x + y * 2', 'x && z || y', '!x ? t : t + y', 'x = x + 1; y = x * x; y - z', 'z = x > 3 ? z + x : z - 1; z', '-(x % 3) ** 2', 't + (x == 2)', 'x >= 4 && y != 9 && (t = t + 1)'].forEach(function (p, i) { var code = lib.compile(lib.parse(p)), f = lib.compile(lib.fold(lib.parse(p))); for (var k = 0; k < 5; k++) { var r = lib.machine(k % 2 ? f : code, vars); say(i, k, String(r[0]), r[1], code.length, JSON.stringify(vars)); } }); say(JSON.stringify(lib.compile(lib.parse('a ? b && c : d')))); try { lib.compile(lib.parse('[1]')); } catch (e) { say(e.message); } lib.OPS['+'] = function (a, b) { return a + '+' + b; }; say(lib.machine(lib.compile(lib.parse('1 + 2 + x')), vars)[0]);
