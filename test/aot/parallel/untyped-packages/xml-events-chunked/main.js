// An untyped package and a program of it (chunked): a reader of tags as events by a state machine, a tree builder and a writer; entities, CDATA, name spaces
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var xml = '<list n="3">\n' + Array.from({ length: 9 }, function (_, i) { return '<item id="' + i + '" k=\'v&quot;' + i + '\'>t' + i + (i % 3 ? '<br/>' : '<!--c' + i + '-->') + '</item>'; }).join('\n') + '</list>'; for (var size = 1; size < 30; size += 3) { var log = [], p = new lib.Sax(true, { onopen: function (t) { log.push('<' + t.name + Object.keys(t.attrs).map(function (k) { return k + t.attrs[k]; }).join()); }, onclose: function (n) { log.push('/' + n); }, ontext: function (t) { if (t.trim()) log.push(t.trim()); }, oncomment: function (c) { log.push('!' + c); } }); for (var i = 0; i < xml.length; i += size) p.write(xml.slice(i, i + size)); p.end(); say(size, log.length, log.slice(size % 5, size % 5 + 6).join(' '), JSON.stringify(p.counts), p.line, p.col, p.pos); }
