// Objects of one class whose methods create the same fields behind other fields each time: the step of the key order that an object took last is another object's wrong one.
"use strict";

class Point {
  constructor(order) {
    this.order = order;
    this[order]();
    this.last = order;
  }
  forward() {
    this.a = 1;
    this.b = "b";
    this.c = 3.5;
    this.d = this;
  }
  backward() {
    this.d = null;
    this.c = 4.5;
    this.b = "B";
    this.a = 2;
  }
  partly(skip) {
    if (!skip) this.a = 3;
    this.c = 5.5;
  }
  nothing() {}
}

function Shape(order) {
  this.order = order;
  Shape.prototype[order].call(this);
  this.last = order;
}
Shape.prototype.forward = Point.prototype.forward;
Shape.prototype.backward = function () {
  this.d = null;
  this.c = 4.5;
  this.b = "B";
  this.a = 2;
};
Shape.prototype.partly = function () {
  this.c = 5.5;
};
Shape.prototype.nothing = function () {};

class Kept extends Point {
  constructor(order) {
    super(order);
    this.extra = order.length;
  }
}

const orders = ["forward", "backward", "partly", "nothing", "forward", "partly", "backward", "backward"];

function describe(object) {
  return Object.keys(object).join() + ":" + [object.a, object.b, object.c, object.d === object ? "itself" : object.d].join("|");
}

function fillLate(object, turn) {
  if (turn % 3 === 0) delete object.b;
  if (turn % 4 === 1) Object.freeze(object);
  if (turn % 5 === 2) Object.preventExtensions(object);
  try {
    object.b = "late";
    object.d = turn;
    object.c = undefined;
    object["e" + (turn % 2)] = turn;
  } catch (error) {
    return error.constructor.name;
  }
  return "filled";
}

const seen = new Map();
function note(text) {
  seen.set(text, (seen.get(text) ?? 0) + 1);
}

for (let turn = 0; turn < 600; ++turn) {
  for (const constructor of [Point, Shape, Kept]) {
    const object = new constructor(orders[(turn * 7 + constructor.name.length) % orders.length]);
    note(constructor.name + " " + describe(object));
    note(constructor.name + " " + fillLate(object, turn) + " " + describe(object).replace(/\d+$/, "n"));
  }
}

// A setter above a class that has created the field without one.
let stored = 0;
for (let turn = 0; turn < 40; ++turn) {
  if (turn === 20)
    Object.defineProperty(Shape.prototype, "a", {
      configurable: true,
      get() {
        return "above";
      },
      set(value) {
        stored += value;
      },
    });
  note("setter " + (turn < 20) + " " + describe(new Shape(orders[turn % orders.length])));
}
delete Shape.prototype.a;
note("stored " + stored);
note("without " + describe(new Shape("forward")));

for (const text of [...seen.keys()].sort()) console.log(seen.get(text), text);
