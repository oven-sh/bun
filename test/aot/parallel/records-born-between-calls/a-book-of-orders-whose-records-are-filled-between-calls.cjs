'use strict';
// ES6, sorted price levels, time priority, as the matching engines on npm are
let nextOrderId = 1;

class Order {
  constructor({ side, type = 'limit', price = 0, quantity, owner, tif = 'GTC' }) {
    this.id = nextOrderId++;
    this.side = side;
    this.type = type;
    this.price = price;
    this.quantity = quantity;
    this.remaining = quantity;
    this.owner = owner;
    this.tif = tif;
    this.next = null;
    this.prev = null;
    this.level = null;
  }
  get filled() {
    return this.quantity - this.remaining;
  }
  toJSON() {
    const { id, side, price, remaining, owner } = this;
    return { id, side, price, remaining, owner };
  }
}

class Level {
  constructor(price) {
    this.price = price;
    this.head = null;
    this.tail = null;
    this.volume = 0;
    this.count = 0;
  }
  append(order) {
    order.level = this;
    if (this.tail) {
      this.tail.next = order;
      order.prev = this.tail;
    } else this.head = order;
    this.tail = order;
    this.volume += order.remaining;
    this.count++;
  }
  remove(order) {
    if (order.prev) order.prev.next = order.next;
    else this.head = order.next;
    if (order.next) order.next.prev = order.prev;
    else this.tail = order.prev;
    order.next = order.prev = order.level = null;
    this.volume -= order.remaining;
    this.count--;
  }
  *[Symbol.iterator]() {
    for (let order = this.head; order; order = order.next) yield order;
  }
}

class Side {
  constructor(name, better) {
    this.name = name;
    this.better = better;
    this.levels = [];
    this.byPrice = new Map();
  }
  find(price) {
    let low = 0, high = this.levels.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.better(this.levels[middle].price, price)) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  levelAt(price) {
    let level = this.byPrice.get(price);
    if (!level) {
      level = new Level(price);
      this.byPrice.set(price, level);
      this.levels.splice(this.find(price), 0, level);
    }
    return level;
  }
  drop(level) {
    this.byPrice.delete(level.price);
    this.levels.splice(this.levels.indexOf(level), 1);
  }
  get best() {
    return this.levels.length ? this.levels[0] : undefined;
  }
  depth(n) {
    return this.levels.slice(0, n).map(({ price, volume, count }) => [price, volume, count]);
  }
}

class OrderBook {
  constructor(symbol) {
    this.symbol = symbol;
    this.bids = new Side('buy', (a, b) => a > b);
    this.asks = new Side('sell', (a, b) => a < b);
    this.orders = new Map();
    this.trades = [];
    this.handlers = {};
  }
  on(event, handler) {
    (this.handlers[event] || (this.handlers[event] = [])).push(handler);
    return this;
  }
  fire(event, ...args) {
    const list = this.handlers[event];
    if (list) for (const handler of list) handler.apply(this, args);
  }
  submit(fields) {
    const order = new Order(fields);
    if (order.quantity <= 0) {
      this.fire('rejected', order, 'quantity');
      return order;
    }
    const opposite = order.side === 'buy' ? this.asks : this.bids;
    if (order.tif === 'FOK' && !this.canFill(order, opposite)) {
      this.fire('rejected', order, 'fok');
      return order;
    }
    this.match(order, opposite);
    if (order.remaining > 0 && order.type === 'limit' && order.tif === 'GTC') {
      (order.side === 'buy' ? this.bids : this.asks).levelAt(order.price).append(order);
      this.orders.set(order.id, order);
      this.fire('rested', order);
    }
    return order;
  }
  crosses(order, price) {
    return order.type === 'market' || (order.side === 'buy' ? price <= order.price : price >= order.price);
  }
  canFill(order, side) {
    let left = order.remaining;
    for (const level of side.levels) {
      if (!this.crosses(order, level.price)) break;
      left -= level.volume;
      if (left <= 0) return true;
    }
    return false;
  }
  match(taker, side) {
    let level;
    while (taker.remaining > 0 && (level = side.best) && this.crosses(taker, level.price)) {
      const maker = level.head;
      if (maker.owner === taker.owner) {
        this.cancel(maker.id);
        continue;
      }
      const quantity = Math.min(maker.remaining, taker.remaining);
      maker.remaining -= quantity;
      taker.remaining -= quantity;
      level.volume -= quantity;
      const trade = { price: level.price, quantity, maker: maker.owner, taker: taker.owner };
      this.trades.push(trade);
      this.fire('trade', trade, maker, taker);
      if (maker.remaining === 0) {
        level.remove(maker);
        this.orders.delete(maker.id);
        if (level.count === 0) side.drop(level);
      }
    }
  }
  cancel(id) {
    const order = this.orders.get(id);
    if (!order) return false;
    const level = order.level, side = order.side === 'buy' ? this.bids : this.asks;
    level.remove(order);
    if (level.count === 0) side.drop(level);
    this.orders.delete(id);
    this.fire('cancelled', order);
    return true;
  }
  get spread() {
    const bid = this.bids.best, ask = this.asks.best;
    return bid && ask ? ask.price - bid.price : NaN;
  }
  snapshot(n = 5) {
    return { symbol: this.symbol, bids: this.bids.depth(n), asks: this.asks.depth(n) };
  }
}

class Trader {
  constructor(name, book, random) {
    this.name = name;
    this.book = book;
    this.random = random;
    this.cash = 10000;
    this.position = 0;
    this.open = [];
  }
  act(mid) {
    const r = this.random(), side = this.random() < 0.5 ? 'buy' : 'sell';
    if (r < 0.15 && this.open.length) {
      this.book.cancel(this.open.shift());
      return;
    }
    const away = Math.floor(this.random() * 8) - 2;
    const order = this.book.submit({
      side,
      type: r > 0.9 ? 'market' : 'limit',
      price: side === 'buy' ? mid - away : mid + away,
      quantity: 1 + Math.floor(this.random() * 9),
      owner: this.name,
      tif: r > 0.8 && r <= 0.9 ? 'FOK' : r > 0.9 ? 'IOC' : undefined
    });
    if (order.remaining && order.level) this.open.push(order.id);
  }
}

function f(t) {
  nextOrderId = 1;
  let seed = t * 2053 + 29;
  const random = () => {
    seed = (seed + 0x9e3779b9) | 0;
    let z = seed ^ (seed >>> 16);
    z = Math.imul(z, 0x21f0aaad);
    z ^= z >>> 15;
    z = Math.imul(z, 0x735a2d97);
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
  const book = new OrderBook('ACME');
  const traders = ['ann', 'bob', 'cy', 'dan', 'eve'].map(name => new Trader(name, book, random));
  const byName = Object.fromEntries(traders.map(x => [x.name, x]));
  const counts = { rested: 0, rejected: 0, cancelled: 0 };
  let mid = 100;
  book.on('trade', ({ price, quantity }, maker, taker) => {
    for (const order of [maker, taker]) {
      const trader = byName[order.owner], sign = order.side === 'buy' ? 1 : -1;
      trader.cash -= sign * price * quantity;
      trader.position += sign * quantity;
    }
    mid = price;
  });
  for (const key of Object.keys(counts)) book.on(key, () => { counts[key]++; });
  for (let step = 0; step < 140; step++) traders[step % traders.length].act(mid);
  let queued = 0;
  for (const level of book.bids.levels) for (const order of level) queued += order.remaining * order.price;
  const text = JSON.stringify(book.snapshot());
  const money = traders.reduce((s, x) => s + Math.abs(x.cash) + Math.abs(x.position) * 3, 0);
  return money + text.length + queued + counts.rested * 3 + counts.rejected + counts.cancelled + book.trades.length * 5 + (book.spread || 0);
}

var n = Number(process.argv[2] || 3);
var sum = 0;
for (var t = 0; t < n; t++) sum = (sum + f(t)) % 1000000007;
console.log(sum);
