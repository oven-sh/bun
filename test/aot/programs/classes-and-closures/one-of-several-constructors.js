// `new C(..)` and `super(..)` where C is one of a few values: constructor functions, classes, and things that are constructed some other way or not at all.
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.describe = function () {
  return "Point " + this.x + "," + this.y;
};
function Size(width) {
  this.width = width;
  this.target = new.target === Size ? "Size" : typeof new.target;
}
Size.prototype.describe = function () {
  return "Size " + this.width + " " + this.target;
};
function Replaced(value) {
  this.ignored = value;
  return { describe: () => "Replaced " + value };
}
function ReturnsPrimitive(value) {
  this.value = value;
  return 7;
}
ReturnsPrimitive.prototype.describe = function () {
  return "ReturnsPrimitive " + this.value;
};
class Circle {
  constructor(radius) {
    this.radius = radius;
  }
  describe() {
    return "Circle " + this.radius + " " + (this instanceof Circle);
  }
}
class Square {
  side = 1;
  constructor(side, scale = 2) {
    this.side = side * scale;
  }
  describe() {
    return "Square " + this.side;
  }
}
class Counting {
  constructor() {
    this.count = arguments.length;
  }
  describe() {
    return "Counting " + this.count;
  }
}
const arrow = () => {};
const method = { method() {} }.method;
async function asynchronous() {}
function* generator() {}
const bound = Point.bind(null, 10);
const proxy = new Proxy(Circle, {
  construct(target, args, newTarget) {
    return Reflect.construct(target, [args[0] * 100], newTarget);
  },
});

function describe(value) {
  return value !== null && typeof value === "object" && typeof value.describe === "function" ? value.describe() : Object.prototype.toString.call(value);
}
function attempt(run) {
  try {
    return describe(run());
  } catch (error) {
    return error.constructor.name;
  }
}

function twoFunctions(C) {
  return new C(1, 2);
}
function twoClasses(C) {
  return new C(3);
}
function functionOrClass(C, a, b) {
  return new C(a, b);
}
function anything(C) {
  return new C(4, 5);
}
function withList(C, list) {
  return new C(...list);
}

for (let round = 0; round < 3; round++) {
  console.log(attempt(() => twoFunctions(round & 1 ? Point : Size)), attempt(() => twoClasses(round & 1 ? Circle : Square)));
  for (const C of [Point, Circle, Replaced, ReturnsPrimitive, Counting]) console.log(attempt(() => functionOrClass(C, round, round + 1)));
  for (const C of [Point, Size, Circle, Square, Counting, arrow, method, asynchronous, generator, bound, proxy, Error, Map, Symbol, undefined, null, 1, "text", {}])
    console.log(attempt(() => anything(C)));
  for (const C of [Point, Square, Counting]) console.log(attempt(() => withList(C, [round])), attempt(() => withList(C, [round, 3, 4])), attempt(() => withList(C, [])));
}

const firstPrototype = Point.prototype;
Point.prototype = { describe: () => "another prototype" };
console.log(attempt(() => twoFunctions(Point)), attempt(() => twoFunctions(Size)));
Point.prototype = 5;
console.log(Object.getPrototypeOf(twoFunctions(Point)) === Object.prototype);
Point.prototype = firstPrototype;
console.log(attempt(() => twoFunctions(Point)));

function extend(Parent) {
  return class extends Parent {
    constructor(...args) {
      super(...args);
      this.extended = true;
    }
  };
}
function extendWithTwo(Parent) {
  return class extends Parent {
    constructor(a, b) {
      super(a, b);
      this.extended = new.target.name;
    }
  };
}
for (const Parent of [Point, Size, Circle, Square, Counting, Replaced, ReturnsPrimitive, Error, Array, null, proxy, bound]) {
  for (const make of [extend, extendWithTwo]) {
    console.log(
      attempt(() => {
        const Child = make(Parent);
        const child = new Child(6, 7);
        return { describe: () => describe(child) + " " + String(child.extended) + " " + (child instanceof Child) };
      }),
    );
  }
}
for (const Parent of [arrow, method, generator, undefined, 1]) console.log(attempt(() => extend(Parent)));

class Base {
  constructor() {
    this.made = new.target.name;
  }
}
class Left extends Base {}
class Right extends Base {
  constructor() {
    super();
    this.right = true;
  }
}
function leftOrRight(C) {
  return new C();
}
for (let i = 0; i < 4; i++) {
  const made = leftOrRight(i & 1 ? Left : Right);
  console.log(made.made, made.right, made instanceof Left, made instanceof Right);
}
console.log(Reflect.construct(Left, [], Right).made, Reflect.construct(Point, [1, 2], Circle) instanceof Circle);
