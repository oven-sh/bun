// A method is stored on the prototype object of a plain function, and instances find it.
function Meter() {}
Meter.prototype.read = function (by) { return (this instanceof Meter ? "meter" : "other") + ":" + typeof by; };
const meter = new Meter();
console.log(meter.read(1), meter.read("s"), Meter.prototype.read.call({}, null), Object.keys(meter).length);
