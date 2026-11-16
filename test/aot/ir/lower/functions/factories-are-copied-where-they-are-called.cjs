// Two calls of a factory that run once enter copies of it where the callee is a closure of the factory. A call in a loop, a call of a function that may run again, and a factory whose functions nobody constructs get none.
// RUN: lower
// CHECK: = IsClosureOf
// CHECK: = IsClosureOf
// CHECK-NOT: = IsClosureOf

const Class = { create() { return function () { this.start.apply(this, arguments); }; } };
var First = Class.create();
First.prototype = { start(value) { this.value = value; } };
const classes = {};
classes.Second = Class.create();
classes.Second.prototype.start = function (other) { this.other = other; };
const list = [];
for (let i = 0; i < 2; i++) list.push(Class.create());
function again() { return Class.create(); }
const adders = { make(a) { return function (b) { return a + b; }; } };
const one = adders.make(1), two = adders.make(2);
console.log(new First(1).value, new classes.Second(2).other, again() === again(), list.length, one(1) + two(1));
