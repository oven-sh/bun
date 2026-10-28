function defineAll(target, list) {
  for (var i = 0; i < list.length; i++) {
    var descriptor = list[i];
    descriptor.enumerable = descriptor.enumerable || false;
    descriptor.configurable = true;
    if ("value" in descriptor) descriptor.writable = true;
    Object.defineProperty(target, descriptor.key, descriptor);
  }
}
function createClass(Constructor, members, statics) {
  if (members) defineAll(Constructor.prototype, members);
  if (statics) defineAll(Constructor, statics);
  return Constructor;
}

var Point = (function () {
  function Point(x) {
    this.x = x;
  }
  createClass(
    Point,
    [
      { key: "get", value: function get() { return this.x + 1; } },
      { key: "twice", get: function () { return this.x * 2; } },
    ],
    [{ key: "of", value: function of(x) { return new Point(x); } }],
  );
  return Point;
})();

function Mixed(y) {
  this.y = y;
}
Object.assign(Mixed.prototype, {
  get: function () { return this.y + 2; },
  name: function () { return "mixed"; },
});

function Late(z) {
  this.z = z;
}

function sumOf(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += new Point(i & 7).get() + new Mixed(i & 3).get() + Point.of(i & 1).twice;
  return sum;
}
function callLate(value) {
  try {
    return new Late(value).get();
  } catch (error) {
    return error.constructor.name;
  }
}

console.log(sumOf(1000), new Mixed(1).name());
console.log(Object.keys(Point.prototype), Object.keys(Mixed.prototype), Object.getOwnPropertyNames(Point.prototype));
console.log(callLate(1));
defineAll(Late.prototype, [{ key: "get", value: function () { return this.z + 3; } }]);
console.log(callLate(1));
defineAll(Late.prototype, [{ key: "get", value: function () { return this.z + 4; } }]);
console.log(callLate(1));
delete Late.prototype.get;
console.log(callLate(1));
Object.setPrototypeOf(Late.prototype, { get() { return "from above " + this.z; } });
console.log(callLate(1));
const own = new Late(5);
own["g" + "et"] = function () { return "own " + this.z; };
console.log(own.get(), callLate(2));
defineAll(Late.prototype, [{ key: "get", get: function () { return function () { return "through a getter " + this.z; }; } }]);
console.log(callLate(3));
defineAll(Point.prototype, [{ key: "get", value: 7 }]);
try {
  console.log(sumOf(3));
} catch (error) {
  console.log(error.constructor.name);
}
