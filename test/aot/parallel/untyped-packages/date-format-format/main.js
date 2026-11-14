// An untyped package and a program of it (format): formats and parses dates by tokens; everything in UTC
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var masks = ['YYYY-MM-DD HH:mm:ss.SSS', 'dddd, MMMM Do YYYY', 'h:m:s a [on] ddd D/M/YY', 'Q W X', '[YYYY] YYYY', 'hh A MMM DD', 'x'];
for (var i = 0; i < 30; i++) { var d = Date.UTC(2023 + i % 4, i * 5 % 14, i * 11 % 31 + 1, i * 7 % 25, i * 13 % 61, i, i * 37); say(i, lib.format(d, masks[i % masks.length]), lib.format(lib.add(d, i % 2 ? i : -i, ['month', 'year', 'day', 'week', 'hour', 'minute'][i % 6]), 'YYYY-MM-DD HH:mm'), lib.relative(d, +lib.add(d, i - 15, ['second', 'minute', 'hour', 'day', 'month'][i % 5]))); }
try { lib.format('nonsense', 'YYYY'); } catch (e) { say(e.message); }
