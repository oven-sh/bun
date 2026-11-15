// An untyped package and a program of it (wheels): schedules of minutes, hours, days, months and weekdays; the next times, names, steps, lists and a wheel of timers on a made clock
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var w = new lib.Wheel(8, 10), log = [], b = new lib.Bucket(5, 3, function () { return w.now; }); function note(t) { return function (id) { log.push(t + id + '@' + w.now); }; } [5, 10, 85, 160, 33].forEach(function (d) { w.add(d, note('a')); }); var every = w.add(40, note('e'), true), c = w.add(70, note('never')); say(w.cancel(c), w.cancel(c), w.cancel(99)); for (var i = 0; i < 16; i++) { if (i === 3) w.add(0, function () { w.add(10, note('inner')); log.push('zero'); }); if (i === 9) say(w.cancel(every), Object.keys(w.live).length); var n = w.advance(20 + i % 3 * 10); say(i, w.now, n, log.splice(0).join(' '), [b.take(1), b.take(i % 4 / 2)].join(), b.tokens.toFixed(3)); }
