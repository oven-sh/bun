// An untyped package and a program of it (sources): a hand-written scanner: positions, strings with escapes, numbers of every base, comments, operators by longest match
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var texts = ['var x = 0x1F + 0b101 - .5e3 * 1_000;', 'if (a >>>= b ?? c?.d) return "q\\n\\u0041\\x42";', '/* one\ntwo */ let $y_1 = \'it\\\'s\' // end\nfoo(...z)', 'const n = 123n ** 2n; é = n => n', 'a+++b---c', '"open', '@', "'a\nb'", 'x /* never', '', '\t\r\n  \n', '"\\u00zz"'];
for (var k = 0; k < 4; k++) texts.forEach(function (t, i) { try { say(k, i, lib((k ? 'p' + k + ';' : '') + t).map(function (x) { return x.type[0] + ':' + String(x.value) + '@' + x.line + ':' + x.column; }).join(' ')); } catch (e) { say(k, i, String(e), e.pos); } });
