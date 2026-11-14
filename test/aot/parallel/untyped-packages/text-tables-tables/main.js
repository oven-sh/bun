// An untyped package and a program of it (tables): text wrapped, aligned, boxed; differences of lines; distances; cases; a rope that is built and cut
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var rows = [['name', 'n', 'note'], ['a', 1, 'two\nlines'], ['日本語', 22.5, null], ['\u001b[1mbold\u001b[0m', -3, 'a long note that must be wrapped somewhere'], [true]]; [{}, { head: true, align: ['left', 'right', 'center'] }, { max: 8, head: true }, { max: 3, align: ['right'] }].forEach(function (o) { for (var n = 1; n <= rows.length; n += 2) say(lib.table(rows.slice(0, n).map(function (r) { return r.slice(); }), o)); });
[5, 12, 20, 40].forEach(function (w) { ['The quick brown fox jumps', 'averyveryverylongword in it', '', 'two\nparas here  spaced', '日本語 テキスト'].forEach(function (t) { say(w, JSON.stringify(lib.wrap(t, w)), JSON.stringify(lib.wrap(t, w, { hard: true, indent: '  ', first: '* ' }))); }); });
