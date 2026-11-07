// null is stored as the prototype property of a plain function: what it constructs lies below Object.prototype, and `instanceof` throws.
function Meter() {}
Meter.prototype.read = function () { return 1; };
Meter.prototype = null;
const meter = new Meter();
let thrown = "nothing";
try { meter instanceof Meter; } catch (error) { thrown = error.constructor.name; }
console.log(Object.getPrototypeOf(meter) === Object.prototype, typeof meter.read, typeof meter.hasOwnProperty, thrown);
