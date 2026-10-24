// Another object is stored as the prototype property of a plain function between two constructions: the first instance keeps what it was born below. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const Meter = hide(function Meter() {});
Meter.prototype.read = function () { return 1; };
function make() { return new Meter(); }
const early = make();
Meter.prototype = { read() { return "late"; } };
const late = make();
const told = [];
for (const meter of [early, late]) told.push(typeof meter.read(), meter instanceof Meter, meter.constructor === Meter);
console.log(told.join());
