(function () {
  function Point(x, y) {
    this.x = x;
    this.y = y;
  }
  Point.prototype.sum = function () {
    return this.x + this.y;
  };
  Point.prototype.move = function (d) {
    this.x += d;
    return this;
  };
  let total = 0;
  for (let i = 0; i < 100; i++) total = (total + new Point(i, 1).move(2).sum()) | 0;
  console.log(total);
})();
(function () {
  function Base(x) {
    this.x = x;
  }
  Base.prototype.getX = function () {
    return this.x;
  };
  function Derived(x, y) {
    Base.call(this, x);
    this.y = y;
  }
  Derived.prototype = Object.create(Base.prototype);
  Derived.prototype.constructor = Derived;
  Derived.prototype.getY = function () {
    return this.y;
  };
  let total = 0;
  for (let i = 0; i < 100; i++) {
    const d = new Derived(i, 2);
    total = (total + d.getX() + d.getY()) | 0;
  }
  console.log(total, new Base(5).getX());
})();
(function () {
  const util = require("util");
  function Base(x) {
    this.x = x;
  }
  Base.prototype.getX = function () {
    return this.x;
  };
  function Derived(x, y) {
    Base.call(this, x);
    this.y = y;
  }
  util.inherits(Derived, Base);
  Derived.prototype.getY = function () {
    return this.y;
  };
  let total = 0;
  for (let i = 0; i < 100; i++) {
    const d = new Derived(i, 2);
    total = (total + d.getX() + d.getY()) | 0;
  }
  console.log(total);
})();
(function () {
  function Stored(x) {
    if (!(this instanceof Stored)) return new Stored(x);
    this.x = x;
  }
  Stored.prototype.get = function () {
    return this.x;
  };
  let total = 0;
  for (let i = 0; i < 100; i++) total = (total + Stored(i).get() + new Stored(1).get()) | 0;
  console.log(total);
})();
(function () {
  function Chain(x) {
    this.x = x;
    this.n = 0;
    return this;
  }
  Chain.prototype.add = function (d) {
    this.n += d;
    return this;
  };
  let total = 0;
  for (let i = 0; i < 100; i++) total = (total + new Chain(i).add(1).add(2).n) | 0;
  console.log(total);
})();
(function () {
  function init(o, x) {
    o.x = x;
  }
  function Made(x) {
    init(this, x);
    this.y = 1;
  }
  Made.prototype.sum = function () {
    return this.x + this.y;
  };
  let total = 0;
  for (let i = 0; i < 100; i++) total = (total + new Made(i).sum()) | 0;
  console.log(total);
})();
(function () {
  function Made(x) {
    var self = this;
    self.x = x;
    self.f = function () {
      return self.x;
    };
  }
  let total = 0;
  for (let i = 0; i < 100; i++) total = (total + new Made(i).f()) | 0;
  console.log(total);
})();
(function () {
  function Stored(x) {
    this.x = x;
  }
  Stored.prototype.get = function () {
    return this.x;
  };
  const other = { x: 0 };
  Stored.call(other, 7);
  const made = new Stored(1);
  Stored.call(made, 9);
  console.log(other.x, made.get());
})();
