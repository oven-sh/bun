// `with` in a CommonJS module: a name in the body resolves to a property of the object if the object has one at that moment, otherwise to the enclosing binding.
var outer = "outer";
var point = { x: 1, y: 2 };

with (point) {
  console.log("reads:", x, y, outer);
  x = 10;
  y += x;
  outer = "stored in the body";
}
console.log("stores:", point.x, point.y, outer, "x" in globalThis);

with (point) y = x * 2;
console.log("single statement:", point.y);
with (point) console.log("typeof:", typeof x, typeof missing);

function scale(vector, factor) {
  with (vector) {
    return [x * factor, y * factor].join();
  }
}
console.log("in a function:", scale(point, 3), "| a property shadows the parameter:", scale({ x: 1, y: 1, factor: 100 }, 3));

function addAndDelete() {
  var name = "variable";
  var scope = {};
  var seen = [];
  with (scope) {
    seen.push(name);
    scope.name = "property";
    seen.push(name);
    name = "stored";
    seen.push(scope.name);
    delete scope.name;
    seen.push(name);
  }
  return seen.join();
}
console.log("a property added and deleted in the body:", addAndDelete());

function declarations() {
  var holder = { value: "property", local: "property" };
  with (holder) {
    var value = "initializer";
    let local = "block scoped";
    var copy = local;
  }
  return [holder.value, String(value), copy, holder.local].join();
}
console.log("var initializer, let:", declarations());

function closure() {
  var counter = { count: 0 };
  var increment;
  with (counter) increment = () => ++count;
  increment();
  increment();
  return counter.count;
}
console.log("a closure created in the body:", closure());

function receiver() {
  var account = {
    balance: 5,
    read() {
      return this === account ? this.balance : "another receiver";
    },
  };
  with (account) return read();
}
console.log("this of a call by name:", receiver());

function unscopables() {
  var hidden = "variable";
  var keys = "variable";
  var scope = { hidden: "property", shown: "property", [Symbol.unscopables]: { hidden: true } };
  with (scope) var own = hidden + " " + shown;
  with ([1, 2]) var inherited = keys + " " + length + " " + typeof join;
  return own + " | " + inherited;
}
console.log("Symbol.unscopables:", unscopables());

function nested() {
  var first = { shared: "first", a: 1 };
  var second = { shared: "second", b: 2 };
  with (first) with (second) return [shared, a, b].join();
}
console.log("nested:", nested());

function objectConversion(value) {
  try {
    with (value) return typeof length;
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("ToObject:", objectConversion("text"), objectConversion(0), objectConversion(null), objectConversion(undefined));

function continueFromBody() {
  var totals = [];
  for (var item of [{ n: 1 }, { n: 2 }, { n: 3 }]) {
    with (item) {
      if (n === 2) continue;
      totals.push(n);
    }
  }
  return totals.join();
}
console.log("continue out of the body:", continueFromBody());

function throwFromBody() {
  var n = "variable";
  try {
    with ({ n: "property" }) throw n;
  } catch (thrown) {
    return thrown + ", then " + n;
  }
}
console.log("throw out of the body:", throwFromBody());

module.exports = { point };
