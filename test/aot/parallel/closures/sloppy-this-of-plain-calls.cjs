// A sloppy function that is called without an object has the global object as its this: the stub reads it.
// COUNT: operation:operationAOTToThis <= 1600
globalThis.marker = 5;
function self() { return this; }
function wrap(f) { return function () { return f.apply(this, arguments); }; }
const wrapped = wrap(function (a) { return (this === globalThis ? 1 : 0) + a; });
let sum = 0;
for (let i = 0; i < 2000; i++) sum += wrapped(i) + self().marker + (self.call(null) === globalThis) + (self.call(undefined) === globalThis) + self.call({ marker: i }).marker;
console.log(sum);
for (const value of [1, -0, "text", true, Symbol.iterator, 10n]) {
  let last;
  for (let i = 0; i < 200; i++) last = self.call(value);
  console.log(typeof last, Object.prototype.toString.call(last), last == value, Object.getPrototypeOf(last) === Object.getPrototypeOf(Object(value)));
}
const listed = [1, 2, 3].map(function () { return this === globalThis; });
console.log(listed.join(), [1].map(function () { return typeof this; }, "x").join(), self.bind()() === globalThis, self.bind(3)() == 3);
console.log((() => { var f = function () { return this; }; return f() === globalThis && (0, f)() === globalThis && (f)() === globalThis; })());
var o = { f: self, get g() { return this; } };
console.log(o.f() === o, o.g === o, (0, o.f)() === globalThis, Reflect.apply(self, null, []) === globalThis);
