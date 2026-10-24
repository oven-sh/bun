function makeKind(name, methods) {
  const Kind = function (value) {
    this.value = value;
  };
  Kind.prototype = { name, ...methods };
  return function (value) {
    return new Kind(value);
  };
}

const double = makeKind("double", {
  run() {
    return this.value * 2;
  },
});
const negate = makeKind("negate", {
  run() {
    return -this.value;
  },
});

function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.sum = function () {
  return this.x + this.y;
};

function Untouched(x) {
  this.x = x;
}

function WithStatics(x) {
  this.x = x;
}
WithStatics.count = 0;
WithStatics.prototype.bump = function () {
  return ++WithStatics.count + this.x;
};

function Replaced(x) {
  this.x = x;
}
Replaced.prototype.kind = "first";

function construct(constructor, ...values) {
  return new constructor(...values);
}

function constructOne(constructor, value) {
  return new constructor(value);
}

class Base {
  constructor(x) {
    this.x = x;
  }
}
function OldStyleParent(x) {
  this.x = x;
}
OldStyleParent.prototype.describe = function () {
  return "old " + this.x;
};
class Derived extends OldStyleParent {
  constructor(x) {
    super(x + 1);
  }
}

const bound = Point.bind(null, 7);
const lines = [];
for (let round = 0; round < 3; ++round) {
  lines.push(double(round).run(), negate(round).run(), double(round).name, negate(round).name);
  lines.push(new Point(round, 1).sum(), construct(Point, round, 2).sum(), constructOne(Untouched, round).x);
  lines.push(new WithStatics(round).bump(), constructOne(WithStatics, round).bump());
  lines.push(constructOne(Replaced, round).kind, constructOne(Base, round).x, new Derived(round).describe());
  lines.push(constructOne(Map, [[round, round]]).get(round), constructOne(bound, round).sum(), constructOne(Array, 3).length);
  lines.push(Point.call({ marker: 1 }, 1, 2) === undefined, Point.apply({ marker: 1 }, [1, 2]) === undefined);
  if (round === 0) Replaced.prototype = { kind: "second" };
  if (round === 1) Object.defineProperty(Replaced, "extra", { value: 1 });
}
for (const notConstructor of [() => 1, undefined, 3, {}, Math.max]) {
  try {
    constructOne(notConstructor, 1);
    lines.push("constructed");
  } catch (error) {
    lines.push(error instanceof TypeError);
  }
}
lines.push(Object.getOwnPropertyNames(Point).sort().join(), Object.getOwnPropertyNames(Untouched).sort().join(), Object.getOwnPropertyNames(WithStatics).sort().join());
lines.push(Object.getPrototypeOf(constructOne(Untouched, 1)) === Untouched.prototype, Untouched.prototype.constructor === Untouched);
console.log(lines.join("\n"));
