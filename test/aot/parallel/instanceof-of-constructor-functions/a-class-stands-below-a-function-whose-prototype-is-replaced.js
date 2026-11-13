// A class extends a function, and the function gets another `prototype` afterwards: the class is linked to the object that the property held when it was defined, so its instances are no instances of the function any more.
function Meter(x) { this.x = x; }
class Fine extends Meter { constructor(x) { super(x); this.fine = true; } }
function isMeter(o) { return o instanceof Meter; }
function fineIsMeter() { const fine = new Fine(1); return fine instanceof Meter; }

function deed() {
  Meter.prototype = { second: true };
}
console.log(String(isMeter(new Fine(1))), String(fineIsMeter()), String(isMeter(new Meter(1))));
let count = 0;
for (let i = 0; i < 200; i++) count += (fineIsMeter() ? 1 : 0) + (isMeter(i & 1 ? new Fine(i) : new Meter(i)) ? 1 : 0);
console.log(String(count));
deed();
console.log(String(isMeter(new Fine(1))), String(fineIsMeter()), String(isMeter(new Meter(1))), String(new Fine(1) instanceof Fine), String(new Meter(1).second), String(new Fine(1).second));
count = 0;
for (let i = 0; i < 200; i++) count += (fineIsMeter() ? 1 : 0) + (isMeter(i & 1 ? new Fine(i) : new Meter(i)) ? 1 : 0);
console.log(String(count));
