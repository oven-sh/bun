// An untyped package and a program of it (chunks): comma separated rows with quotes, delimiters found by counting, headers, casts and a writer
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var text = 'id,name,note\n' + Array.from({ length: 12 }, function (_, i) { return [i, i % 2 ? '"n ""' + i + '"""' : 'n' + i, i % 3 ? '"two\nlines ' + i + '"' : ''].join(','); }).join('\n'); for (var size = 1; size < 24; size += 2) { var p = new lib.Parser({ header: true, cast: true }); for (var i = 0; i < text.length; i += size) p.write(text.slice(i, i + size)); var rows = p.end(); say(size, rows.length, JSON.stringify(rows[size % rows.length]), p.line, p.errors.length, lib.write(rows).length, lib.write(rows) === lib.write(lib.parse(text, { header: true, cast: true }))); }
