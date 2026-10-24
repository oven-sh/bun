// Another object is stored as the prototype property of a plain function before the first instance is made.
function Meter() {}
const first = Meter.prototype;
first.read = function () { return 1; };
Meter.prototype = { read() { return "other"; } };
const meter = new Meter();
console.log(meter.read(), meter instanceof Meter, Object.getPrototypeOf(meter) === first, meter.constructor === Object, first.isPrototypeOf(meter));
