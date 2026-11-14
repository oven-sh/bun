// The prototype of an object and that of a class are asked in loops, while somebody changes the object's, or the class is not there yet.
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
function early(turns) {
  let n = 0;
  for (let i = 0; i < turns; i++) if (Object.getPrototypeOf({}) === Late.prototype) n++;
  return n;
}
console.log(attempt(() => early(0)), attempt(() => early(3)));
class Late {}
console.log(attempt(() => early(3)));
class A { constructor(v) { this.v = v; } }
class B extends A { more() { return this.v; } }
class M extends Map {}
function F(v) { this.v = v; }
const things = [new A(1), new B(2), new F(3), new M(), {}, [], Object.create(null), Object.create(A.prototype), new Proxy(new A(4), { getPrototypeOf: () => B.prototype }), () => 1, "text", 5, A, B];
function count(thing, turns) {
  let a = 0, b = 0, f = 0, plain = 0;
  for (let i = 0; i < turns; i++) {
    const above = Object.getPrototypeOf(thing);
    if (above === A.prototype) a++;
    if (Reflect.getPrototypeOf(Object(thing)) === B.prototype) b++;
    if (above === F.prototype) f++;
    if (above === null || above === Object.prototype) plain++;
  }
  return [a, b, f, plain].join();
}
for (const thing of things) console.log(attempt(() => count(thing, 20)));
for (const nothing of [null, undefined]) console.log(attempt(() => count(nothing, 2)), attempt(() => count(nothing, 0)));
const a = new A(5);
function changed(turns) {
  let text = "";
  for (let i = 0; i < turns; i++) {
    if (i === 3) Object.setPrototypeOf(a, B.prototype);
    if (i === 5) a.__proto__ = null;
    if (i === 6) Reflect.setPrototypeOf(a, A.prototype);
    text += Object.getPrototypeOf(a) === A.prototype ? "A" : Object.getPrototypeOf(a) === B.prototype ? "B" : "-";
  }
  return text;
}
console.log(changed(8), changed(8));
function replaced(turns) {
  let n = 0;
  for (let i = 0; i < turns; i++) {
    if (i === 2) attempt(() => { "use strict"; A.prototype = {}; });
    if (i === 3) F.prototype = A.prototype;
    n += (Object.getPrototypeOf(new A(i)) === A.prototype) + (Object.getPrototypeOf(new F(i)) === A.prototype);
  }
  return n;
}
console.log(replaced(6), Object.getPrototypeOf(B) === A, Object.getPrototypeOf(B.prototype) === A.prototype);
const made = [1, 2].map(k => class extends A { which() { return k; } });
function ofMade(turns) {
  let text = "";
  for (let i = 0; i < turns; i++) {
    const Made = made[i & 1];
    text += Object.getPrototypeOf(new Made(1)) === Made.prototype && Made.prototype !== made[1 - (i & 1)].prototype ? Made.prototype.which() : "-";
  }
  return text;
}
console.log(ofMade(5));
