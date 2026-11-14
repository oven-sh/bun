// A name that compiled code has taken for absent from the prototype of an array or a primitive is refused there on every road by which evaluated text may add it.
const log = console.log.bind(console);
function Vector(x) {
  this.x = x;
}
Vector.prototype.plus = function (other) {
  return this.x + other.x;
};
Vector.prototype.minus = function (other) {
  return this.x - other.x;
};
Vector.prototype.times = function (other) {
  return this.x * other.x;
};
Vector.prototype.dot = function (other) {
  return this.x * other.x + 1;
};
Vector.prototype.cross = function (other) {
  return this.x * other.x - 1;
};
function Box(value) {
  this.value = value;
}
const evil = "function (other) { other.x = 1000; return 7; }";
const holders = ["Array", "Number", "Boolean", "String", "BigInt", "Symbol"];
const roads = [
  p => `${p}.p~lus = ${evil}`,
  p => `Object.defineProperty(${p}, "m~inus", { value: ${evil} })`,
  p => `Object.assign(${p}, { t~imes: ${evil} })`,
  p => `class A { constructor() { return ${p}; } } class B extends A { d~ot = ${evil}; } new B()`,
  p => `Reflect.set({}, "c~ross", ${evil}, ${p}) || (() => { throw new TypeError("Reflect.set gave false") })()`,
  p => `({ __proto__: { }, f() { super.p~lus = ${evil}; } }).f.call(${p})`,
  p => `${p}.__defineGetter__("m~inus", function () { return ${evil}; })`,
  p => `Object.setPrototypeOf(${p}, { t~imes: ${evil} })`,
  p => `${p}.__proto__ = { d~ot: ${evil} }`,
  p => `Reflect.defineProperty(${p}, "c~ross", { value: ${evil} }) || (() => { throw new TypeError("Reflect.defineProperty gave false") })()`,
  p => `Object.defineProperties(${p}, { p~lus: { get() { return ${evil}; } } })`,
  p => `for (const k of ["m~i" + "nus"]) ${p}[k] = ${evil}`,
  p => `"use strict"; new Proxy(${p}, {}).t~imes = ${evil}`,
  p => `Object.create(${p}).constructor.prototype.d~ot = ${evil}`,
  p => `({ a: ${p}.c~ross } = { a: ${evil} })`,
  p => `[${p}.p~lus] = [${evil}]`,
  p => `Reflect.setPrototypeOf(${p}, { m~inus: ${evil} }) || (() => { throw new TypeError("Reflect.setPrototypeOf gave false") })()`,
  p => `${p}.t~imes ??= ${evil}`,
];
const values = { Array: [1], Number: 5, Boolean: true, String: "s", BigInt: 7n, Symbol: Symbol.iterator };
const boxes = [];
for (let i = 0; i < 60; i++) boxes.push(new Box(i % 10 === 9 ? values[holders[(i / 10) | 0]] : new Vector(i)));
function run() {
  let sum = 0, thrown = 0;
  for (const box of boxes)
    for (let k = 0; k < 5; k++) {
      const other = new Vector(1);
      try {
        sum += k === 0 ? box.value.plus(other) : k === 1 ? box.value.minus(other) : k === 2 ? box.value.times(other) : k === 3 ? box.value.dot(other) : box.value.cross(other);
      } catch {
        thrown++;
      }
      sum += other.x;
    }
  return sum + " " + thrown;
}
log(run());
let done = 0, refused = 0;
for (const holder of holders)
  for (let i = 0; i < roads.length; i++) {
    try {
      new Function(roads[i]([holder, "prototype"].join(".")).split("~").join(process.argv.length > 99 ? "x" : ""))();
      done++;
      log("done", holder, i);
    } catch (e) {
      if (e instanceof TypeError) refused++;
      else log(holder, i, e.name, e.message);
    }
  }
log(done, refused);
log(run());
/* Output:
8130 30
0 108
8130 30
*/
