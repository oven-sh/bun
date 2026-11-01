// A bound function has no prototype property, and a construction of it makes an instance of its target. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const Meter = hide(function Meter(size) { this.size = size; });
Meter.prototype.read = function () { return this.size; };
const bound = Meter.bind({ size: "ignored" }, "bound");
const made = new bound();
console.log(bound.prototype, "prototype" in bound, made.read(), made instanceof Meter, made instanceof bound, Object.getPrototypeOf(made) === Meter.prototype);
