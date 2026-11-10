// Ring calls Back, which calls Ring: the reading stops where it meets a function that it is in, with `a`. The program ends in a RangeError, as it must.
// STATISTIC: ConstructorFieldsFoldedIntoAllocations = 2
function Ring(a) { this.a = a; Back.call(this, a); }
function Back(a) { Ring.call(this, a); }
Object.setPrototypeOf(Ring.prototype, Back.prototype);
function run(count) { let made = 0; for (let i = 0; i < count; i++) { new Ring(i); made++; } return made; }
try { console.log(run(2)); } catch (e) { console.log(e.name); }
