// What compilers emit for `super(..)` in a class that they turn into functions: `Reflect.construct(A, list, B)`.
// The object is B's: its prototype is what B.prototype holds at that moment, new.target is B, and what A returns counts as with `new`.
"use strict";
const log = [];
function A(x, y) {
  this.z = x === undefined ? 1 : x + y;
  this.target = new.target === B ? "B" : new.target === A ? "A" : new.target === Beside ? "Beside" : typeof new.target;
  if (x === "throw") throw new Error("from A");
}
A.prototype.base = function () { return this.z; };
function B(a) {
  var self = Reflect.construct(A, [a, 2], B);
  self.a = a;
  return self;
}
B.prototype = Object.create(A.prototype, { constructor: { value: B, writable: true, configurable: true } });
Object.setPrototypeOf(B, A);
function Beside() {}

function describe(v) {
  return [Object.keys(v).join(), v instanceof B, v instanceof A, Object.getPrototypeOf(v) === B.prototype, v.constructor === B, v.target, v.z, v.a, "a" in v].join(" ");
}

function many(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = new B(i & 7);
    sum += v.a + v.base();
  }
  return sum;
}
console.log(many(2000));
console.log(describe(new B(3)));

// Not from within B: the object has none of what B's own text stores.
function bare(n) {
  let last;
  for (let i = 0; i < n; i++) last = Reflect.construct(A, [i, 1], B);
  return last;
}
console.log(describe(bare(300)));
console.log(describe(Reflect.construct(A, [], B)));

// A function that stands beside, and the function itself.
const beside = Reflect.construct(A, [1, 1], Beside);
console.log(Object.getPrototypeOf(beside) === Beside.prototype, beside instanceof A, beside.target, Object.keys(beside).join());
console.log(describe(Reflect.construct(A, [1, 1], A)), describe(Reflect.construct(A, [1, 1])));

// What the function above returns.
function ReturnsObject() { this.mine = 1; return { other: 2 }; }
function ReturnsNumber() { this.mine = 1; return 5; }
function BelowObject() { return Reflect.construct(ReturnsObject, [], BelowObject); }
BelowObject.prototype = Object.create(ReturnsObject.prototype);
function BelowNumber() { return Reflect.construct(ReturnsNumber, [], BelowNumber); }
BelowNumber.prototype = Object.create(ReturnsNumber.prototype);
for (let i = 0; i < 300; i++) { new BelowObject(); new BelowNumber(); }
console.log(JSON.stringify(new BelowObject()), new BelowObject() instanceof BelowObject, JSON.stringify(new BelowNumber()), new BelowNumber() instanceof BelowNumber);

// A throw goes through both.
try { new B("throw"); } catch (e) { console.log(e.message, e.stack.split("\n").slice(1, 4).map(line => line.trim().replace(/ \(.*$/, "")).join(" | ")); }

// A setter above takes the store of the function above.
function turns(n, at, change, say = describe) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    if (i === at) change();
    const v = new B(i & 3);
    if (i >= at - 1 && i <= at + 1) seen.push(say(v));
  }
  return seen.join("\n");
}
console.log(turns(600, 300, () => Object.defineProperty(B.prototype, "z", { set(value) { log.push("z=" + value); }, get() { return "got"; }, configurable: true })));
console.log(log.length, log[0]);
delete B.prototype.z;

// Another prototype object in mid-loop, then none at all.
const first = B.prototype;
console.log(turns(600, 300, () => { B.prototype = { constructor: B, base() { return "second"; } }; }));
console.log(new B(1).base(), Object.getPrototypeOf(new B(1)) === first);
console.log(turns(600, 300, () => { B.prototype = 5; }, v => [Object.keys(v).join(), Object.getPrototypeOf(v) === Object.prototype, Object.getPrototypeOf(v) === first, v.target, v.z, v.a].join(" ")));
console.log(Object.getPrototypeOf(new B(1)) === Object.prototype);
B.prototype = first;

// What is no constructor is refused by name.
for (const [target, list, newTarget] of [[A, [], 5], [A, [], () => {}], [5, [], B], [A, 5, B], [A, null, B], [() => {}, [], B]]) {
  try { Reflect.construct(target, list, newTarget); console.log("made"); } catch (e) { console.log(e.constructor.name, e.message); }
}
