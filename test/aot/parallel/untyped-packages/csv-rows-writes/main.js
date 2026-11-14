// An untyped package and a program of it (writes): comma separated rows with quotes, delimiters found by counting, headers, casts and a writer
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var rows = []; for (var i = 0; i < 14; i++) { rows.push(i % 5 === 4 ? { b: [i], a: new Date(i * 1e10) } : { a: ['x', 'q"', 'l\nn', ' s', i / 4, null, undefined, -0][i % 8], b: i, c: 'c;' + i }); say(i, JSON.stringify(lib.write(rows.slice(-3), { delimiter: [',', ';', '|', '\t'][i % 4], columns: i % 3 ? undefined : ['c', 'a', 'none'] })), JSON.stringify(lib.write(rows.slice(-2).map(Object.values)))); }
