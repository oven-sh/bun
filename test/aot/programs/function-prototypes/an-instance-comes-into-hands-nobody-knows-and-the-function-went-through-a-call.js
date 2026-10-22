// An instance of a plain function is stored into an array whose contents nobody knows, and a method that comes back out of it is run on another receiver. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const Meter = hide(function Meter() {});
Meter.prototype.read = function (by) { return (this instanceof Meter ? "meter" : "other") + ":" + typeof by; };
const first = new Meter().read(1);
const held = JSON.parse("[]");
held.push(new Meter());
const back = held[0];
console.log(first, back.read("s"), back.read.call({}, null), back.constructor.prototype.read === Meter.prototype.read, new back.constructor() instanceof Meter);
