// An untyped package and a program of it (counts): a hand-written scanner: positions, strings with escapes, numbers of every base, comments, operators by longest match
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var total = {}, src = ''; for (var i = 0; i < 120; i++) { src += ['function f' + i + '(a, b) {', '  return a * ' + i + ' + b / 2.' + i + ';', '}', 'let s' + i + ' = "t' + i + '";', 'if (s' + i + ' !== f' + i + '(1, 2)) { x = ' + i + ' << 3; }'][i % 5] + '\n'; if (i % 10 === 9) { var t = lib(src); t.forEach(function (x) { total[x.type] = (total[x.type] || 0) + 1; }); say(i, t.length, t[t.length - 1].line, t[t.length >> 1].value, JSON.stringify(total)); } }
