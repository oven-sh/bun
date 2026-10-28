// util.inherits puts the prototype object of one plain function above that of another.
const util = require("node:util");
function Base() { this.base = true; }
Base.prototype.read = function () { return "read " + this.base + " " + this.size; };
function Meter(size) { Base.call(this); this.size = size; }
util.inherits(Meter, Base);
const meter = new Meter(4);
console.log(meter.read(), meter instanceof Base, Meter.super_ === Base, Object.getPrototypeOf(Meter.prototype) === Base.prototype);
