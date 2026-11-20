// orders that cooks take by their rank, with breaks, quiet hours and second tries; a semaphore and a barrier beside it
'use strict';
var EventEmitter = require('events'), util = require('util');
function Kitchen(cook, cooks) {
  if (cooks === 0) throw new RangeError('a kitchen without a cook');
  if (!(this instanceof Kitchen)) return new Kitchen(cook, cooks);
  EventEmitter.call(this);
  this.open = true; this.woken = false; this.busy = 0; this.served = 0; this.cook = cook; this.orders = []; this.cooks = cooks === undefined ? 1 : cooks;
}
util.inherits(Kitchen, EventEmitter);
Kitchen.prototype.order = function (dish, rank, told) {
  if (typeof rank === 'function') return this.order(dish, 0, rank);
  var kitchen = this, dishes = [].concat(dish);
  dishes.forEach(function (one) {
    var place = kitchen.orders.findIndex(function (other) { return other.rank > (rank || 0); });
    kitchen.lay(place < 0 ? kitchen.orders.length : place, { rank: rank || 0, tries: 0, dish: one, told: told });
  });
  return dishes.length;
};
Kitchen.prototype.first = function (dish, told) { this.lay(0, { rank: -Infinity, tries: 0, dish: dish, told: told }); };
Kitchen.prototype.lay = function (place, order) {
  this.orders.splice(place, 0, order);
  if (this.orders.length === this.cooks) this.emit('full', this.busy);
  if (!this.woken) setImmediate(wake, this);
  this.woken = true;
};
function wake(kitchen) { kitchen.work(); kitchen.woken = false; }
Kitchen.prototype.work = function () { while (this.open && this.orders.length > 0 && this.busy < this.cooks) this.take(this.orders.shift()); };
Kitchen.prototype.take = function (order) {
  var kitchen = this, over = false;
  this.busy += 1;
  if (this.orders.length === 0) this.emit('last');
  function ready(error) {
    if (over) throw new Error('served twice');
    kitchen.busy -= 1;
    over = true;
    if (error && error.again > order.tries) kitchen.emit('again', order.dish, ++order.tries), kitchen.orders.unshift(order);
    else {
      kitchen.served += 1;
      if (order.told) order.told.apply(order, arguments);
      if (error) kitchen.emit('error', error, order.dish);
    }
    if (kitchen.busy === 0 && kitchen.orders.length === 0) kitchen.emit('quiet');
    kitchen.work();
  }
  try { this.cook(order.dish, ready, order.tries); } catch (error) { ready(error); }
};
Kitchen.prototype.rest = function () { this.open = false; };
Kitchen.prototype.go = function () { var slept = !this.open; this.open = true; if (slept) this.work(); };
Kitchen.prototype.strike = function (test) { var kept = this.orders.filter(function (order) { return !test(order); }), gone = this.orders.length - kept.length; this.orders = kept; return gone; };
Object.defineProperty(Kitchen.prototype, 'length', { get: function () { return this.orders.length; } });
class Semaphore {
  #free; #waiting = [];
  constructor(n) { this.#free = n; }
  async use(fn) { if (this.#free === 0) await new Promise(r => this.#waiting.push(r)); else this.#free--; try { return await fn(this.#waiting.length); } finally { const next = this.#waiting.shift(); if (next) next(); else this.#free++; } }
}
class Barrier { constructor(n) { this.n = n; this.count = 0; this.round = 0; this.reset(); } reset() { this.gate = new Promise(r => { this.open = r; }); } async wait() { const gate = this.gate, round = this.round; if (++this.count === this.n) { this.count = 0; this.round++; const open = this.open; this.reset(); open(round); } return gate; } }
module.exports = { Kitchen: Kitchen, Semaphore: Semaphore, Barrier: Barrier };
