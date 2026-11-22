// A helper copies the names of the function above onto the function below. What stands on it, what is read there later, and what runs while it is copied, is as written.
"use strict";
function copied(below, above) {
  for (const name of Object.keys(above)) below[name] = above[name];
  below.upper = above;
  return below;
}
function Meter(n) { this.n = n; }
Meter.limit = 10; Meter.units = ["m", "cm"]; Meter.read = function (meter) { return meter.n + "/" + this.limit; }; Meter.make = function (n) { return new this(n); };
function Gauge(n) { Meter.call(this, n); }
Gauge.limit = 99;
Gauge.prototype = Object.create(Meter.prototype);
copied(Gauge, Meter);
function Dial(n) { Gauge.call(this, n); }
Dial.prototype = Object.create(Gauge.prototype);
copied(Dial, Gauge);
const told = kind => Object.keys(kind).map(name => name + "=" + (typeof kind[name] === "function" ? kind[name].name : String(kind[name]))).join(" ");
console.log(told(Meter)); console.log(told(Gauge)); console.log(told(Dial));
let sum = 0; for (let i = 0; i < 100; i++) sum += Gauge.read(Gauge.make(i)).length + Dial.read(new Dial(i)).length + Meter.read(Meter.make(i)).length; console.log(sum, Dial.make(3) instanceof Gauge, Dial.read === Meter.read, Dial.units === Meter.units);
// A name that changes above afterwards does not change below; a list that both hold does.
Meter.limit = 1; Meter.read = () => "later"; Meter.units.push("mm"); console.log(Gauge.read({ n: 1 }), Dial.limit, Dial.units.join(), Meter.read());
// What is copied runs: getters of the function above, setters of the one below, a name that stops the copy.
let order = [];
function Upper() {} function Lower() {}
Object.defineProperty(Upper, "asked", { enumerable: true, get() { order.push("got"); return order.length; } });
Object.defineProperty(Upper, "unlisted", { value: 5, enumerable: false });
Object.defineProperty(Lower, "asked", { set(v) { order.push("set " + v); }, get() { return "own"; }, configurable: true });
Upper[Symbol("s")] = 1; Upper.late = 2;
copied(Lower, Upper); console.log(order.join(), Lower.asked, Lower.unlisted, Object.getOwnPropertySymbols(Lower).length, Lower.late);
function Fixed() {} Object.defineProperty(Fixed, "late", { value: "stays" });
try { copied(Fixed, Upper); console.log("copied"); } catch (error) { console.log(error.constructor.name, Fixed.late, Fixed.upper); }
// The names of a function: its own name and length are not to be listed, so they stay; what hides them above is copied.
function Named() {} Object.defineProperty(Named, "name", { value: "renamed", enumerable: true, configurable: true });
function Taker() {} try { copied(Taker, Named); console.log(Taker.name); } catch (error) { console.log(error.constructor.name, Taker.name); }
// Functions of which the one is the other, what is no function, what lies above a function.
console.log(copied(Meter, Meter) === Meter, Meter.upper === Meter, told(Meter));
Function.prototype.shared = 1; function Both() {} console.log(Object.keys(copied(Both, Upper)).join()); delete Function.prototype.shared;
for (const bad of [null, undefined, 5, "ab", [7, 8], new Proxy({ q: 1 }, { ownKeys() { throw new RangeError("keys"); } })]) { const kind = function () {}; try { copied(kind, bad); console.log(Object.keys(kind).join()); } catch (error) { console.log(error.constructor.name); } }
class Written { static limit = 4; static told() { return "written " + this.limit; } } function Beside() {} copied(Beside, Written); console.log(Beside.limit, Beside.told, Object.keys(Beside).join());
for (let i = 0; i < 4; i++) { const Kind = function () {}; Kind["n" + i] = i; const Below = copied(function () {}, Kind); console.log(told(Below)); delete Below["n" + i]; console.log(told(Below), Kind["n" + i]); }
