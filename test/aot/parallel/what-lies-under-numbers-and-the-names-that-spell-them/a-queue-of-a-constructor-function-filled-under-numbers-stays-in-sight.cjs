'use strict';
function Ring(capacity) { this._capacity = capacity; this._length = 0; this._front = 0; }
Ring.prototype.push = function (fn, receiver, arg) {
  var at = (this._front + this._length) & (this._capacity - 1);
  this[at] = fn; this[(at + 1) & (this._capacity - 1)] = receiver; this[(at + 2) & (this._capacity - 1)] = arg;
  this._length += 3;
};
Ring.prototype.shift = function () {
  var front = this._front, taken = this[front];
  this[front] = undefined;
  this._front = (front + 1) & (this._capacity - 1);
  this._length--;
  return taken;
};
function Counter() { this.total = 0; }
Counter.prototype.add = function (n) { this.total += n; };
var ring = new Ring(16), counter = new Counter();
for (var turn = 0; turn < 40; turn++) {
  ring.push(Counter.prototype.add, counter, turn);
  var fn = ring.shift(), receiver = ring.shift(), arg = ring.shift();
  fn.call(receiver, arg);
}
console.log(counter.total, ring._length, ring._front);
