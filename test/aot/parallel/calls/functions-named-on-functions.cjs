// Functions that the program names on functions, called in loops, and what may become of the name in the middle of a loop.
const list = JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]");
const box = JSON.parse("{}");
const hide = value => ((box.value = value), box.value);

function K() {}
K.ONE = 1;
K.add = function (a, b) { return a + b; };
K.twice = function (a) { return K.add(a, a) + K.ONE; };
K.self = function (a) { return this === K ? a : -a; };
K.fib = function (n) { return n < 2 ? n : K.fib(n - 1) + K.fib(n - 2); };
K.maybe = function (a) { if (a === 9) throw new Error("nine"); return a * 0.5; };

var V = function (v) { this.v = v; };
V.make = function (v) { return new V(v); };
V.prototype.plus = function (o) { return V.sum(this, o); };
V.sum = function (a, b) { return V.make(a.v + b.v); };

const N = {};
N.Inner = () => 0;
N.Inner.mix = (a, b) => a * 0.25 + b;
(function () {
  const Inner = N.Inner;
  Inner.outer = function (a) { return Inner.mix(a, a) + 1; };
})();

class C {}
C.later = function (a) { return a + 0.5; };

function total(call) {
  let s = 0;
  for (let i = 0; i < list.length; i++) s += call(list[i], i);
  return s;
}
function plain() { let s = 0; for (let i = 0; i < list.length; i++) s += K.add(list[i], i); return s; }
function chain() { let s = 0; for (const x of list) s += K.twice(x) + K.self(x); return s; }
function recursive() { let s = 0; for (const x of list) s += K.fib(x & 7); return s; }
function made() { let v = V.make(0); for (const x of list) v = v.plus(V.make(x)); return v.v; }
function nested() { let s = 0; for (let i = 0; i < list.length; i++) s += N.Inner.outer(list[i]) + C.later(list[i]); return s; }
function throws() { let s = 0; try { for (const x of list) s += K.maybe(x); } catch (e) { return s + e.message; } return s; }
console.log(plain(), chain(), recursive(), made(), nested(), throws(), total((x, i) => K.add(x, i)));

// Unseen code stores, defines and deletes the name between two iterations.
function beside(act) {
  let s = 0;
  for (let i = 0; i < list.length; i++) {
    act(i);
    s = s + K.add(list[i], i);
  }
  return s;
}
function inside(act) { let s = ""; for (let i = 0; i < list.length; i++) s += K.add(list[i], act(i)) + " "; return s; }
const add = K.add;
const { defineProperty, setPrototypeOf } = hide(Object);
const restore = () => { setPrototypeOf(hide(K), Function.prototype); defineProperty(hide(K), hide("add"), { value: add, writable: true, enumerable: true, configurable: true }); };
const acts = {
  nothing: () => 0,
  stores: i => { if (i === 5) hide(K)[hide("add")] = hide(() => 1000); return 1; },
  storesOften: i => { hide(K)[hide("add")] = i % 3 ? add : hide(() => -1); return 1; },
  defines: i => { if (i === 4) defineProperty(hide(K), hide("add"), { get: hide(() => a => a + 0.125), configurable: true }); return 1; },
  binds: i => { if (i === 7) hide(K)[hide("add")] = add.bind(null, 3); return 1; },
  deletes: i => { if (i === 6) { delete hide(K)[hide("add")]; setPrototypeOf(hide(K), hide({ __proto__: Function.prototype, add: () => 7 })); } return 1; },
  constant: i => { if (i === 6) hide(K)[hide("ONE")] = 2; return 1; },
};
for (const name of Object.keys(acts)) {
  for (let round = 0; round < 2; round++) {
    console.log(name, beside(hide(acts[name])), K.twice(3));
    restore();
    console.log(name, inside(hide(acts[name])), K.twice(3));
    restore();
  }
}
hide(K)[hide("add")] = hide(5);
try { console.log(plain()); } catch (e) { console.log(e.constructor.name); }
