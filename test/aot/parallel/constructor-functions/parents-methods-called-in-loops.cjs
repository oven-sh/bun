// A loop calls the method of the parent through call, while somebody changes the function, the prototype or the function's own names.
"use strict";
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
function make() {
  function P(a) { this.a = a; }
  P.prototype.get = function (x = 0) { return this.a + x; };
  P.prototype.other = function () { return "other" + this.a; };
  function C(a) { P.call(this, a); this.b = 1; }
  C.prototype = Object.create(P.prototype);
  C.prototype.get = function (x) { return P.prototype.get.call(this, x) + this.b; };
  C.prototype.list = function () { return P.prototype.get.apply(this, arguments) + P.prototype.other.call(this); };
  return [P, C];
}
function Q(a) { this.a = a; }
Q.prototype.get = function (x = 0) { return this.a + x; };
Q.prototype.other = function () { return "other" + this.a; };
function D(a) { Q.call(this, a); this.b = 1; }
D.prototype = Object.create(Q.prototype);
D.prototype.get = function (x) { return Q.prototype.get.call(this, x) + this.b; };
D.prototype.list = function () { return Q.prototype.get.apply(this, arguments) + Q.prototype.other.call(this); };
function run(Class, turns, at, change) {
  const object = new Class(3);
  let text = "", sum = 0;
  for (let i = 0; i < turns; i++) {
    if (i === at) change();
    text += attempt(() => object.get(i & 3)) + attempt(() => object.list(i)) + " ";
    sum += Number(attempt(() => new Class(i).get(1)).length);
  }
  return text + sum;
}
const changes = [
  () => {},
  P => { P.prototype.get.call = () => "own"; },
  P => { P.prototype.other.call = undefined; },
  P => { delete P.prototype.get.call; P.prototype.get.mark = 1; },
  P => { P.prototype.get = function () { return 100; }; },
  P => { Object.setPrototypeOf(P.prototype.other, { call: () => "above" }); },
  P => { Object.freeze(P.prototype.get); },
  P => { Object.defineProperty(P.prototype, "other", { get() { return function () { return "defined"; }; }, configurable: true }); },
  P => { delete P.prototype.get; },
  P => { P.prototype = { get: () => 7, other: () => 8 }; },
];
for (const change of changes) {
  const [P, C] = make();
  console.log(run(C, 6, 3, () => change(P)), run(C, 0, 0, () => {}));
}
function sums(turns) {
  let n = 0;
  for (let i = 0; i < turns; i++) n += new D(i & 3).get(1);
  return n;
}
for (const change of changes) {
  console.log(attempt(() => sums(0)), attempt(() => sums(9)));
  console.log(run(D, 6, 3, () => change(Q)));
}
console.log(attempt(() => sums(9)));
