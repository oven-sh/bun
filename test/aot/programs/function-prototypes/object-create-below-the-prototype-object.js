// Object.create makes an object below the prototype object of a plain function that is never constructed.
function Meter() {}
Meter.prototype.read = function () { return this.size; };
const made = Object.create(Meter.prototype);
made.size = "wide";
const other = Object.create(Meter.prototype, { size: { value: 3 } });
console.log(made.read(), other.read(), made instanceof Meter, made.constructor === Meter, Object.keys(other).length);
