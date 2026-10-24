// Another function is stored as `constructor` on the prototype object of a plain function, and code constructs what an instance names as its constructor.
function Meter() { return undefined; }
function Other() {}
Other.prototype.name = function () { return "other"; };
Meter.prototype.name = function () { return "meter"; };
const meter = new Meter();
const first = new meter.constructor().name();
Meter.prototype.constructor = Other;
console.log(first, new meter.constructor().name(), meter.constructor === Other, meter instanceof Meter);
