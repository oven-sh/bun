// util.inherits puts the prototype object of one plain function above that of another. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const util = require("node:util");
const Base = hide(function Base() { this.base = true; });
Base.prototype.read = function () { return "read " + this.base + " " + this.size; };
const Meter = hide(function Meter(size) { Base.call(this); this.size = size; });
util.inherits(Meter, Base);
const meter = new Meter(4);
console.log(meter.read(), meter instanceof Base, Meter.super_ === Base, Object.getPrototypeOf(Meter.prototype) === Base.prototype);
