// In sloppy code "the result is `this`" is not "the result is the receiver that the caller passed": undefined and null become the global object, a primitive becomes a new wrapper object on each call. In strict code (here: methods of a class) the receiver arrives as it is. The same callers call both.
function sloppyThis() {
  return this;
}
// The body of a class is strict code.
const strict = class {
  static self() {
    return this;
  }
  static type() {
    return typeof this;
  }
  static writes(value) {
    this.written = value;
    return this.written;
  }
  static pushes() {
    seen.push(typeof this + ":" + String(this));
  }
};
const strictThis = strict.self;
const strictType = strict.type;
const strictWrites = strict.writes;
function sloppyType() {
  return typeof this;
}
function sloppyKeeps() {
  kept.push(this);
}
function sloppyWrites(value) {
  this.written = value;
  return this.written;
}
const kept = [];
function callWith(f, receiver, argument) {
  return f.call(receiver, argument);
}
let warm = 0;
for (let i = 0; i < 1000; i++) {
  const o = { i };
  warm += (callWith(sloppyThis, o) === o ? 1 : 0) + (callWith(strictThis, o) === o ? 1 : 0) + callWith(sloppyType, o).length + callWith(strictType, o).length + callWith(sloppyWrites, o, i) + callWith(strictWrites, o, i);
}
console.log(warm);
console.log(callWith(sloppyThis, undefined) === globalThis, callWith(sloppyThis, null) === globalThis, sloppyThis() === globalThis, callWith(strictThis, undefined), callWith(strictThis, null), strictThis());
for (const primitive of [5, "text", true, Symbol.iterator, 10n]) {
  const boxed = callWith(sloppyThis, primitive);
  console.log(typeof primitive, typeof boxed, boxed === primitive, boxed == primitive, callWith(sloppyThis, primitive) === callWith(sloppyThis, primitive), callWith(strictThis, primitive) === primitive, callWith(sloppyType, primitive), callWith(strictType, primitive), Object.prototype.toString.call(boxed));
}
console.log(callWith(sloppyWrites, 5, "lost"), callWith(sloppyWrites, "s", "lost"));
for (const primitive of [5, "s"]) {
  try {
    console.log(callWith(strictWrites, primitive, "x"));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
callWith(sloppyKeeps, 7);
callWith(sloppyKeeps, "kept text");
callWith(sloppyKeeps, undefined);
Bun.gc(true);
console.log(kept.map(k => (k === globalThis ? "the global object" : typeof k + ":" + k.valueOf())).join());

// Methods that primitives inherit: a getter and a method on a prototype of the program's own, reached through a wrapper.
class Meters extends Number {
  get self() {
    return this;
  }
  double() {
    return this * 2;
  }
}
const m = new Meters(4);
console.log(m.self === m, m.double(), typeof m.self, m + 1);

// Callbacks of built-ins get the receiver that the built-in was told.
const seen = [];
[1].forEach(function () {
  seen.push(this === globalThis);
});
[1].forEach(function () {
  seen.push(typeof this + ":" + this);
}, 9);
[1].forEach(strict.pushes, 9);
[1].forEach(strict.pushes);
[1].map(sloppyKeeps, "as thisArg");
console.log(seen.join(), typeof kept[kept.length - 1]);
delete globalThis.written;
