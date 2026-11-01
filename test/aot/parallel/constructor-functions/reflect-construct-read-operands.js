// `Reflect.construct(Object.getPrototypeOf(B), list, Object.getPrototypeOf(this).constructor)`: what compilers emit for `super(..)`, with both functions read at run time.
// What stands above B and what the prototype object names may change while the program runs, and may be no constructor at all: then Reflect.construct refuses in its own words.
"use strict";
function A(x) { this.z = x === undefined ? 1 : x; this.target = new.target && new.target.name; }
A.prototype.base = function () { return this.z; };
function Other(x) { this.other = x; this.target = new.target && new.target.name; }
function B(a) {
  var self = Reflect.construct(Object.getPrototypeOf(B), [a], Object.getPrototypeOf(this).constructor);
  self.a = a;
  return self;
}
B.prototype = Object.create(A.prototype);
B.prototype.constructor = B;
Object.setPrototypeOf(B, A);
function C(a) { return Reflect.construct(Object.getPrototypeOf(C), [a], Object.getPrototypeOf(this).constructor); }
C.prototype = Object.create(B.prototype);
C.prototype.constructor = C;
Object.setPrototypeOf(C, B);

function describe(v) {
  return [Object.keys(v).join(), v instanceof C, v instanceof B, v instanceof A, v instanceof Other, v.target, v.z, v.a, v.other, Object.getPrototypeOf(v) === B.prototype, Object.getPrototypeOf(v) === C.prototype].join(" ");
}
function attempt(make) {
  try { return describe(make()); } catch (e) { return e.constructor.name + ": " + e.message; }
}
function turns(n, at, change, make = i => new B(i & 3)) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    if (i === at) change();
    const said = attempt(() => make(i));
    if (i >= at - 1 && i <= at + 1) seen.push(said);
  }
  return seen.join("\n");
}

let sum = 0;
for (let i = 0; i < 3000; i++) { const v = new B(i & 7); sum += v.a + v.base(); }
console.log(sum, describe(new B(2)), "|", describe(new C(3)));

console.log("another function above");
console.log(turns(600, 300, () => Object.setPrototypeOf(B, Other)));
console.log("Function.prototype above: no constructor");
console.log(turns(600, 300, () => Object.setPrototypeOf(B, Function.prototype)));
console.log("null above");
console.log(turns(600, 300, () => Object.setPrototypeOf(B, null)));
console.log("an arrow above");
console.log(turns(600, 300, () => Object.setPrototypeOf(B, () => {})));
Object.setPrototypeOf(B, A);

console.log("the prototype object names another function");
console.log(turns(600, 300, () => { B.prototype.constructor = Other; }));
console.log("names A itself");
console.log(turns(600, 300, () => { B.prototype.constructor = A; }));
console.log("names Object");
console.log(turns(600, 300, () => { B.prototype.constructor = Object; }));
console.log("names nothing: the name is found above");
console.log(turns(600, 300, () => { delete B.prototype.constructor; }));
console.log("names undefined, a number, an arrow");
console.log(turns(600, 300, () => { B.prototype.constructor = undefined; }));
console.log(turns(600, 300, () => { B.prototype.constructor = 5; }));
console.log(turns(600, 300, () => { B.prototype.constructor = () => {}; }));
console.log("a getter");
let reads = 0;
console.log(turns(600, 300, () => Object.defineProperty(B.prototype, "constructor", { get() { reads++; return B; }, configurable: true })));
console.log(reads);
delete B.prototype.constructor;
B.prototype.constructor = B;

console.log("called, not constructed, on other receivers");
for (const receiver of [new C(1), Object.create(null), {}, 5, "text"]) console.log(attempt(() => B.call(receiver, 9)));
for (const receiver of [undefined, null]) console.log(attempt(() => B.call(receiver, 9)));
console.log(describe(new B(4)), "|", describe(new C(5)));
