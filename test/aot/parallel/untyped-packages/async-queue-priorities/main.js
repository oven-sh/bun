// An untyped package and a program of it (priorities): a queue of workers with priorities, pausing, draining, retries; a mutex, a semaphore and a barrier beside it
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var log = [], q = lib.Queue(function (d, done, tries) { log.push('run ' + d + ' at ' + q.running + (tries ? ' try ' + tries : '')); if (d % 7 === 3 && tries < 2) { var e = new Error('again ' + d); e.retry = 2; return setImmediate(done, e); } if (d === 9) throw new TypeError('nine'); setTimeout(done, 0, null, d * 2); }, 2);
q.on('drain', function () { log.push('drain'); }); q.on('error', function (e, d) { log.push('error ' + e.message + ' of ' + d); }); q.on('retry', function (d, n) { log.push('retry ' + d + '/' + n); }); q.on('saturated', function (n) { log.push('saturated ' + n); }); q.on('empty', function () { log.push('empty'); });
for (var i = 0; i < 12; i++) q.push(i, (i * 5) % 3, function (e, v) { log.push('back ' + (e ? e.name : v) + ' ' + this.priority + ' ' + this.tries); });
q.unshift('first'); say(q.push([20, 21, 22], 1), q.length, q.remove(function (t) { return t.data === 21; }), lib.Queue.super_ === require('events'), q.started);
var turns = 0; (function wait() { if (turns++ > 60 || (turns > 5 && !q.length && !q.running)) { var done = log.filter(function (l) { return !/^(run|back)/.test(l); }); say(done.length > 5, log.length); var backs = log.filter(function (l) { return /^back/.test(l); }).sort(); backs.forEach(function (l) { say(l); }); say(log.slice(0, 4).join(' | ')); return; } setTimeout(wait, 2); }());
