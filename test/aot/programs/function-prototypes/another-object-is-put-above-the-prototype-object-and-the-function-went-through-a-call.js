// Object.setPrototypeOf and __proto__ put another object above the prototype object of a plain function, after instances were made. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const Meter = hide(function Meter() {});
const Base = hide(function Base() {});
Base.prototype.read = function () { return "base"; };
const meter = new Meter();
const before = typeof meter.read;
Object.setPrototypeOf(Meter.prototype, Base.prototype);
const between = meter.read();
Meter.prototype.__proto__ = { read() { return 7; } };
console.log(before, between, meter.read(), meter instanceof Base);
