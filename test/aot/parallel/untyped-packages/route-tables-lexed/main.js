// An untyped package and a program of it (lexed): tables of written expressions in several forms: rows, objects, arrays in fields, switches of kinds; the match is read where it was made, by loops and by names, kept for later turns and compared
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const texts = ['let x1 = 3.14 + y', 'f("a\\"b", 12) => { return !ok; }', '', '  ', 'a.b[0] >= "x" && c', '"" 5', 'é @', '"open', 'n=1,m=2', 'for(;;)i+=2']; for (let n = 0; n < 3; n++) texts.forEach((s, i) => { const v = n === 0 ? s : n === 1 ? s + ' ' + texts[(i + 1) % 10] : s.repeat(2); say(n, i, lib.tokens(v).map(t => t.k[0] + t.text + (t.extra.length ? JSON.stringify(t.extra) : '')).join(' ')); }); ['key: value', 'k=', '- [x] done', '* item', '- [ ] todo', '## Title {id}', '# T', 'one two three', 'one', '', 'a  b'].forEach((l, i) => ['pair', 'list', 'head', 'other'].forEach(k => say(i, k, JSON.stringify(lib.fields(l, k)), JSON.stringify(lib.fields(i % 2 ? l + i : l.slice(0, -1), k)))));
