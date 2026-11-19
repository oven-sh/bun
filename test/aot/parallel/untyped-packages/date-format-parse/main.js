// An untyped package and a program of it (parse): formats and parses dates by tokens; everything in UTC
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
[['2026-11-12', 'YYYY-MM-DD'], ['2026-02-30', 'YYYY-MM-DD'], ['12 Nov 2026', 'D MMM YYYY'], ['1 foo 2026', 'D MMM YYYY'], ['2026-11-12 23:59:58', 'YYYY-MM-DD HH:mm:ss'], ['11:05 PM', 'HH:mm A'], ['12:05 AM', 'HH:mm A'], ['nope', 'YYYY'], ['2024-02-29', 'YYYY-MM-DD'], ['x', 'Q']].forEach(function (p) { for (var k = 0; k < 3; k++) try { var d = lib.parse(k ? p[0].replace('2026', 2020 + k) : p[0], p[1]); say(p.join(' by '), k, d && d.toISOString()); } catch (e) { say(e.message); } });
