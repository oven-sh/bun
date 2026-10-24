// A getter and a setter are defined on the prototype object of a plain function and run with the instance as `this`. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const Meter = hide(function Meter() {});
const seen = [];
Object.defineProperty(Meter.prototype, "size", {
  get() { seen.push(this instanceof Meter); return this.kept; },
  set(value) { seen.push(typeof value); this.kept = value; },
});
const meter = new Meter();
meter.size = 1;
const first = meter.size;
meter.size = "wide";
console.log(first, meter.size, Meter.prototype.size, seen.join(), Object.keys(meter).join());
