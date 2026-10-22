// A class extends a plain function: its instances find what lies on the prototype object of the function, also what is stored there afterwards. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const Meter = hide(function Meter() { this.made = new.target.name; });
Meter.prototype.read = function () { return "read " + this.made; };
class Fine extends Meter { fine() { return this.read() + " " + this.late(); } }
const fine = new Fine();
Meter.prototype.late = function () { return typeof this.fine; };
console.log(fine.fine(), fine instanceof Meter, Object.getPrototypeOf(Fine.prototype) === Meter.prototype, Object.getPrototypeOf(Fine) === Meter, new Meter().made);
