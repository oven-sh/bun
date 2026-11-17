// a queue of workers with priorities, pausing, draining, retries; a mutex, a semaphore and a barrier beside it
'use strict';
var util = require('util'), EventEmitter = require('events');
function Queue(worker, concurrency) {
  if (!(this instanceof Queue)) return new Queue(worker, concurrency);
  EventEmitter.call(this);
  if (concurrency == null) concurrency = 1; else if (concurrency === 0) throw new RangeError('Concurrency must not be zero');
  this.worker = worker; this.concurrency = concurrency; this.tasks = []; this.running = 0; this.paused = false; this.started = false; this.workers = [];
}
util.inherits(Queue, EventEmitter);
Queue.prototype._insert = function (data, atFront, priority, callback) {
  var self = this, item = { data: data, priority: priority || 0, callback: callback || function () {}, tries: 0 };
  self.started = true;
  if (atFront) self.tasks.unshift(item);
  else { var i = self.tasks.length; while (i > 0 && self.tasks[i - 1].priority > item.priority) i--; self.tasks.splice(i, 0, item); }
  if (self.tasks.length === self.concurrency) self.emit('saturated', self.running);
  if (!self.scheduled) { self.scheduled = true; setImmediate(function () { self.scheduled = false; self.process(); }); }
  return item;
};
Queue.prototype.push = function (data, priority, cb) { if (typeof priority === 'function') { cb = priority; priority = 0; } var self = this; if (Array.isArray(data)) { data.forEach(function (d) { self._insert(d, false, priority, cb); }); return data.length; } this._insert(data, false, priority, cb); return 1; };
Queue.prototype.unshift = function (data, cb) { this._insert(data, true, -Infinity, cb); };
Queue.prototype.process = function () {
  var self = this;
  while (!self.paused && self.running < self.concurrency && self.tasks.length) {
    (function (item) {
      self.running++; self.workers.push(item);
      if (self.tasks.length === 0) self.emit('empty');
      var called = false;
      function done(err) {
        if (called) throw new Error('Callback was already called.');
        called = true; self.running--; self.workers.splice(self.workers.indexOf(item), 1);
        if (err && err.retry && item.tries++ < err.retry) { self.tasks.unshift(item); self.emit('retry', item.data, item.tries); }
        else { item.callback.apply(item, arguments); if (err) self.emit('error', err, item.data); }
        if (self.tasks.length + self.running === 0) self.emit('drain');
        self.process();
      }
      try { self.worker(item.data, done, item.tries); } catch (e) { done(e); }
    }(self.tasks.shift()));
  }
};
Queue.prototype.pause = function () { this.paused = true; };
Queue.prototype.resume = function () { if (!this.paused) return; this.paused = false; this.process(); };
Queue.prototype.remove = function (test) { var before = this.tasks.length; this.tasks = this.tasks.filter(function (t) { return !test(t); }); return before - this.tasks.length; };
Object.defineProperty(Queue.prototype, 'length', { get: function () { return this.tasks.length; } });
class Semaphore {
  #free; #waiting = [];
  constructor(n) { this.#free = n; }
  async use(fn) { if (this.#free === 0) await new Promise(r => this.#waiting.push(r)); else this.#free--; try { return await fn(this.#waiting.length); } finally { const next = this.#waiting.shift(); if (next) next(); else this.#free++; } }
}
class Barrier { constructor(n) { this.n = n; this.count = 0; this.round = 0; this.reset(); } reset() { this.gate = new Promise(r => { this.open = r; }); } async wait() { const gate = this.gate, round = this.round; if (++this.count === this.n) { this.count = 0; this.round++; const open = this.open; this.reset(); open(round); } return gate; } }
module.exports = { Queue: Queue, Semaphore: Semaphore, Barrier: Barrier };
