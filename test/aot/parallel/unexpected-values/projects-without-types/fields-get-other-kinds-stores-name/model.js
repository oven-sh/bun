function Counter() {
  this.count = 0;
  this.label = "";
  this.items = [];
  this.limits = { low: 0, high: 10 };
}
Counter.prototype.bump = function () {
  this.count++;
  return this.count;
};
Counter.prototype.double = function () {
  return this.count * 2;
};
Counter.prototype.title = function () {
  return this.label.length;
};
Counter.prototype.keep = function (item) {
  return this.items.push(item);
};
Counter.prototype.span = function () {
  return this.limits.high - this.limits.low;
};

class Modern {
  count = 0;
  label = "";
  items = [];
  limits = { low: 0, high: 10 };
  bump() {
    this.count++;
    return this.count;
  }
  double() {
    return this.count * 2;
  }
  title() {
    return this.label.length;
  }
  keep(item) {
    return this.items.push(item);
  }
  span() {
    return this.limits.high - this.limits.low;
  }
}

function literal() {
  return {
    count: 0,
    label: "",
    items: [],
    limits: { low: 0, high: 10 },
    bump: Counter.prototype.bump,
    double: Counter.prototype.double,
    title: Counter.prototype.title,
    keep: Counter.prototype.keep,
    span: Counter.prototype.span,
  };
}

module.exports = {
  Counter: function () { return new Counter(); },
  Modern: function () { return new Modern(); },
  literal: literal,
};
