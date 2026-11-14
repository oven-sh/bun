// An untyped package and a program of it (documents): a recursive reader with positions, comments allowed, reviver; and a writer with indents and cycles
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var docs = ['{"a":1,"b":[true,false,null,-0.5e2],"c":{"d":"x\\n\\u0041\\"","e":[]}}', '[1,2,[3,[4,[5]]]]', '"text"', '  {} ', '[1,]', '{"a" 1}', '{"a":}', '[1 2]', '{"k":1,"k":2}', '// c\n[1, /* in */ 2]', '12345678901234567890', '{"__proto__":{"x":1}}', '"\\ud83d\\ude00 \\/"', '', '[', '{"a":"\u0001"}', '01', '-', 'nul', '[1]x'];
for (var n = 0; n < 4; n++) docs.forEach(function (d, i) {
  try { var v = lib.parse(n % 2 ? '\n ' + d : d, [undefined, { comments: true, trailing: true }, { big: true }, { reviver: function (k, v) { return typeof v === 'number' ? v + n : v; } }][n]); say(n, i, lib.write(v), typeof v); } catch (e) { say(n, i, e.message, e.line); }
});
