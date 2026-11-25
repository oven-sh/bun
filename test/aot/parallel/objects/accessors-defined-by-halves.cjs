// A getter and a setter of one name, each defined by its own descriptor.
"use strict";
const printed = [];
const print = (...values) => printed.push(values.map(String).join(" "));
const attempt = f => {
  try {
    return f();
  } catch (error) {
    return error.constructor.name;
  }
};

function Candle() {
  this._holder = null;
  this._wax = 0;
  this._wick = 1;
}
Object.defineProperty(Candle.prototype, "wax", {
  configurable: true,
  get: function () {
    return this._wax;
  },
});
const early = new Candle();
print(attempt(() => (early.wax = 3)), early.wax);
Object.defineProperty(Candle.prototype, "wax", {
  configurable: true,
  set: function (value) {
    this._wax = value;
    this._holder.light += 2 * value;
  },
});
Object.defineProperty(Candle.prototype, "wick", {
  configurable: true,
  set: function (value) {
    const holder = this._holder;
    holder.light = holder.light * 3 - value;
    this._wick = value;
  },
});
print(early.wick);
Object.defineProperty(Candle.prototype, "wick", {
  configurable: true,
  get: function () {
    return this._wick;
  },
});
function lit(holder) {
  const candle = new Candle();
  candle._holder = holder;
  return candle;
}
function Holder() {
  this.candle = lit(this);
  this.light = 0;
}
function write(holder, value) {
  const { candle } = holder;
  candle.wick = value + 2;
  candle.wax = value;
  return candle.wick * 5 - candle.wax;
}
function run(holders, times) {
  let sum = 0;
  for (let k = 0; k < times; k++) sum += write(holders[k % holders.length], k & 7);
  return sum;
}
const holders = [new Holder(), new Holder(), new Holder()];
print(run(holders, 50), holders.map(holder => holder.light));
print(attempt(() => (early.wax = 4)), early.wax, attempt(() => (early.wick = 4)), early.wick);

class Point {
  constructor(x) {
    this._x = x;
    this.stores = 0;
  }
}
Object.defineProperty(Point.prototype, "x", {
  configurable: true,
  get() {
    return this._x;
  },
});
Object.defineProperty(Point.prototype, "x", {
  set(value) {
    this._x = value;
    this.stores++;
  },
});
function move(points, times) {
  let sum = 0;
  for (let k = 0; k < times; k++) {
    const point = points[k % points.length];
    point.x = k;
    sum += point.x;
  }
  return sum;
}
const points = [new Point(1), new Point(2)];
print(move(points, 30), points.map(point => point.stores));

Object.defineProperty(holders[1].candle, "wax", { value: 5, writable: true, configurable: true });
print(run(holders, 9), holders.map(holder => holder.light), holders[1].candle._wax);
Object.defineProperty(Point.prototype, "x", { get: undefined });
print(move(points, 4), points.map(point => point.stores));
Object.defineProperty(Point.prototype, "x", { get: () => 2, set: undefined });
print(attempt(() => move(points, 4)), points[0].x);
delete Candle.prototype.wax;
print(run(holders, 9), holders.map(holder => holder.light), Object.keys(holders[0].candle));
Object.defineProperty(Candle.prototype, "wick", { value: 8, writable: false });
print(attempt(() => run(holders, 9)), holders[0].candle.wick);
console.log(printed.join("\n"));
