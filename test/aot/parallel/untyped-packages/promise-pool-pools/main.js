// An untyped package and a program of it (pools): limits, retries, a queue with priorities, timeouts by ticks; no clock
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
(async function () {
  for (var n = 1; n < 6; n++) { var p = new lib.Pool(n), order = []; var r = await p.map([5, 1, 3, 'x', 2, null, 4.5], async function (x, i) { order.push('s' + i); await lib.tick(typeof x === 'number' ? x | 0 : 2); order.push('e' + i); return typeof x === 'string' ? x + i : x * 2; }); say(n, r.join(), order.join(' '), p.peak, p.log.join('')); }
  var p = new lib.Pool(2), out = []; for (var i = 0; i < 12; i++) (function (i) { p.add(function () { out.push(i); if (i % 5 === 3) throw new Error('job ' + i); return lib.tick(i % 4).then(function () { return i; }); }, i % 3).then(function (v) { out.push('ok' + v); }, function (e) { out.push(e.message); }); })(i); await p.idle(); say(out.join(' '), p.active, p.waiting.length, p.peak);
})();
