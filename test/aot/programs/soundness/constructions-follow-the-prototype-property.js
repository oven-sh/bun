// new F() gives its object whatever the prototype property of F holds at that moment, also after many constructions under the first prototype object.
var outOfSight = new Proxy({}, {});
var log = [];

function Point(x) {
  this.x = x;
}
Point.prototype.kind = function () {
  return "first";
};
outOfSight.value = Point;

function make(x) {
  return new Point(x);
}

function describe(point) {
  return point.kind() + ":" + point.x + ":" + (point instanceof Point) + ":" + (Object.getPrototypeOf(point) === Point.prototype);
}

function constructMany(count) {
  var sum = 0;
  var last;
  for (var i = 0; i < count; i++) {
    last = make(i);
    sum += last.x;
  }
  log.push(sum + " " + describe(last));
  return last;
}

var early = constructMany(2000);

var second = {
  kind: function () {
    return "second";
  },
};
Point.prototype = second;
var middle = constructMany(2000);
log.push("early " + early.kind() + " " + (early instanceof Point));

Object.defineProperty(Point, "prototype", {
  value: {
    kind: function () {
      return "third";
    },
  },
});
var late = constructMany(2000);
log.push("middle " + middle.kind() + " " + (middle instanceof Point));

Point.prototype = 7;
var plain = make(1);
log.push("plain " + (Object.getPrototypeOf(plain) === Object.prototype) + " " + plain.x + " " + typeof plain.kind);

function createCounter(step) {
  function Counter() {
    this.step = step;
  }
  Counter.prototype.next = function (value) {
    return value + this.step;
  };
  return Counter;
}
var counters = [createCounter(1), createCounter(10)];
outOfSight.value = counters;
var total = 0;
for (var round = 0; round < 2000; round++) {
  var Counter = counters[round & 1];
  var counter = new Counter();
  total = counter.next(total);
  if (!(counter instanceof Counter) || counter instanceof counters[(round + 1) & 1])
    log.push("wrong class in round " + round);
}
log.push("counters " + total);

class Shape {
  constructor(sides) {
    this.sides = sides;
  }
  name() {
    return "shape" + this.sides;
  }
}
class Square extends Shape {
  constructor() {
    super(4);
  }
  name() {
    return "square/" + super.name();
  }
}
outOfSight.value = [Shape, Square];
var names = "";
for (var turn = 0; turn < 2000; turn++) {
  var shape = turn & 1 ? new Square() : new Shape(3);
  if (turn > 1996)
    names += shape.name() + " ";
}
log.push(names + (Reflect.construct(Shape, [5], Square) instanceof Square) + " " + Reflect.construct(Shape, [5], Point).sides);

console.log(log.join("\n"));
