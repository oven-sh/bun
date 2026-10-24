// Sloppy code: a store to an accessor that has lost its setter, or never had one, does nothing.
function make(start) {
  return {
    held: start,
    calls: 0,
    get value() {
      return this.held;
    },
    set value(next) {
      this.calls++;
      this.held = next * 2;
    },
  };
}
function store(object, times) {
  var sum = 0;
  for (var i = 0; i < times; i++) {
    object.value = i & 7;
    sum += object.value;
  }
  return sum;
}
function storeStrictly(object, times) {
  "use strict";
  var sum = 0;
  for (var i = 0; i < times; i++) {
    object.value = i & 7;
    sum += object.value;
  }
  return sum;
}
var plain = make(1);
console.log(store(plain, 100), plain.calls, storeStrictly(plain, 100), plain.calls);
var without = make(6);
Object.defineProperty(without, "value", { set: undefined });
console.log(store(without, 100), without.calls, without.held);
try {
  console.log(storeStrictly(without, 100));
} catch (error) {
  console.log(error.constructor.name, error.message);
}
var frozen = Object.freeze(make(3));
console.log(store(frozen, 100), frozen.calls, frozen.held);
var primitive = make(4);
Object.defineProperty(primitive, "value", {
  set: function (next) {
    this.held = typeof this + next;
  },
});
console.log(store(primitive, 2), primitive.held);
