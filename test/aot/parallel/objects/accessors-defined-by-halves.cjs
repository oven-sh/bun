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

function Features() {
  this._owner = null;
  this._red = 0;
  this._green = 1;
}
Object.defineProperty(Features.prototype, "red", {
  configurable: true,
  get: function () {
    return this._red;
  },
});
const early = new Features();
print(attempt(() => (early.red = 3)), early.red);
Object.defineProperty(Features.prototype, "red", {
  configurable: true,
  set: function (value) {
    this._red = value;
    this._owner._key += value;
  },
});
Object.defineProperty(Features.prototype, "green", {
  configurable: true,
  set: function (value) {
    this._green = value;
    this._owner._key -= value;
  },
});
print(early.green);
Object.defineProperty(Features.prototype, "green", {
  configurable: true,
  get: function () {
    return this._green;
  },
});
function Contact() {
  this._key = 0;
  this.features = new Features();
  this.features._owner = this;
}
function write(contact, value) {
  const features = contact.features;
  features.red = value;
  features.green = value + 1;
  return features.red + features.green;
}
function run(contacts, times) {
  let sum = 0;
  for (let k = 0; k < times; k++) sum += write(contacts[k % contacts.length], k & 7);
  return sum;
}
const contacts = [new Contact(), new Contact(), new Contact()];
print(run(contacts, 50), contacts.map(contact => contact._key));
print(attempt(() => (early.red = 4)), early.red, attempt(() => (early.green = 4)), early.green);

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

Object.defineProperty(contacts[1].features, "red", { value: 5, writable: true, configurable: true });
print(run(contacts, 9), contacts.map(contact => contact._key), contacts[1].features._red);
Object.defineProperty(Point.prototype, "x", { get: undefined });
print(move(points, 4), points.map(point => point.stores));
Object.defineProperty(Point.prototype, "x", { get: () => 2, set: undefined });
print(attempt(() => move(points, 4)), points[0].x);
delete Features.prototype.red;
print(run(contacts, 9), contacts.map(contact => contact._key), Object.keys(contacts[0].features));
Object.defineProperty(Features.prototype, "green", { value: 8, writable: false });
print(attempt(() => run(contacts, 9)), contacts[0].features.green);
console.log(printed.join("\n"));
