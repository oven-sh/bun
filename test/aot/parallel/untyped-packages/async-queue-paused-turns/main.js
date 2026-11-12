// An untyped package and a program of it (paused turns): a queue of workers with priorities, pausing, draining, retries; a mutex, a semaphore and a barrier beside it
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var order = [], q = new lib.Queue(function (d, done) { order.push(d.name); setImmediate(function () { done(null, d.n * d.n); }); }, 1), sums = 0;
function turn(i) { if (i === 10) { say(order.join()); try { new lib.Queue(function () {}, 0); } catch (e) { say(e.name, e.message); } return; } q.pause(); for (var k = 0; k < 4; k++) q.push({ name: 't' + i + k, n: i + k }, (k * 3 + i) % 4, function (e, v) { sums += v; }); if (i % 3 === 0) q.unshift({ name: 'u' + i, n: 1 }, function (e, v) { sums += v * 1000; }); say(i, q.length, q.tasks.map(function (t) { return t.data.name + ':' + t.priority; }).join(' '), sums); q.once('drain', function () { say('drained', i, order.length, sums); turn(i + 1); }); q.resume(); }
turn(0);
