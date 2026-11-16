function Counter() {
  this.count = 0;
  this.label = "";
  this.items = [];
  this.isOpen = false;
  this.owner = null;
  this.limits = { low: 0, high: 10 };
}
Counter.prototype.bump = function () {
  this.count++;
  return this.count;
};
Counter.prototype.add = function (by) {
  this.count += by;
  return this.count;
};
Counter.prototype.title = function () {
  return this.label.toUpperCase() + this.label.length;
};
Counter.prototype.keep = function (item) {
  return this.items.push(item);
};
Counter.prototype.held = function () {
  return this.items.length;
};
Counter.prototype.state = function () {
  return this.isOpen ? "open" : "closed";
};
Counter.prototype.span = function () {
  return this.limits.high - this.limits.low;
};
Counter.prototype.ownerName = function () {
  return this.owner === null ? "nobody" : this.owner.name;
};

class Modern {
  count = 0;
  label = "";
  items = [];
  static made = 0;
  constructor() {
    Modern.made++;
  }
  bump() {
    this.count++;
    return this.count;
  }
  add(by) {
    this.count += by;
    return this.count;
  }
  title() {
    return this.label.toUpperCase() + this.label.length;
  }
  keep(item) {
    return this.items.push(item);
  }
  held() {
    return this.items.length;
  }
}

var total = 0;
var names = [];
var last = "";
exports.record = function (value, name) {
  total += value;
  names.push(name);
  last = name;
  return [total, names.length, last.length];
};
exports.overwrite = function (newTotal, newNames, newLast) {
  total = newTotal;
  names = newNames;
  last = newLast;
};
exports.Counter = Counter;
exports.Modern = Modern;
