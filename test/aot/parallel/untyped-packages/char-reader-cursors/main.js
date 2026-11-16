// An untyped package and a program of it (cursors): reading characters: past the end, pairs of surrogates, code points, cursors that go both ways, unicode expressions
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var texts = ['', 'a', 'ab\ncd', '😀x😀', '\ud83d', 'x\udc00y', '日本\n語', 'café́', '12ab34', '😀'.repeat(5) + '\n']; for (var n = 0; n < 3; n++) texts.forEach(function (t, i) { if (n === 1) t = t + i + t; if (n === 2) t = ('pad' + t).slice(3); var c = new lib.Cursor(t), f = [], b = [], x; while ((x = c.next()) !== undefined) f.push(x.toString(16)); say(n, i, f.join(), c.pos, c.line, c.peek(), c.peek(-1) === t[t.length - 1], c.code(), c.next()); while ((x = c.back()) !== undefined) b.push(x.toString(16)); say(b.join() === f.slice().reverse().join(), c.pos, JSON.stringify(c.until(function (ch, k) { return k > 0x7f || ch === 'b'; })), c.number(), c.pos, lib.ends(t), JSON.stringify(lib.reverse(t)), lib.same(t, texts[(i + 1) % 10])); });
