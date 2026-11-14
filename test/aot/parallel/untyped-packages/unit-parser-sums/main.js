// An untyped package and a program of it (sums): amounts with units read by one table after the other: durations, sizes, angles, money, coordinates, times of day
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var totals = {}, mixed = ['5m', '2kb', '10deg', '$3.50', '1:30', '90s', '1.5 MB', '0.25turn', '4 EUR', '11:59:59 pm', 'x', 7, null, 1e3, '1h', '12 b', '-2d']; for (var i = 0; i < 60; i++) { var o = lib.parse(i % 4 === 3 ? String(mixed[i % 17]).toUpperCase() : mixed[(i * 5) % 17]); totals[o.kind] = (totals[o.kind] || 0) + o.value; if (i === 25) lib.units.reverse(); if (i === 40) lib.units.unshift({ kind: 'time', re: /^(\d+) ticks?$/, by: { t: 10 } }); if (i % 6 === 5) say(i, JSON.stringify(totals), lib.print({ kind: 'time', value: totals.time || 0 }, true), lib.print({ kind: 'size', value: totals.size || 0 }), JSON.stringify(lib.parse(i + ' ticks'))); }
