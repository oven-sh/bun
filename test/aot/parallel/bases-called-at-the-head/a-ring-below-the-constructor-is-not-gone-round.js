// Start calls Ring, Ring calls Back, Back calls Ring: the reading stops where it meets a function that it is in, with `a`. The program ends in a RangeError, as it must.
// The loop of run() is built twice: one such allocation in each version.
// STATISTIC: ConstructorFieldsFoldedIntoAllocations = 2
function Ring(a) { this.a = a; Back.call(this, a); }
function Back(a) { Ring.call(this, a); }
function Start(a) { Ring.call(this, a); }
Object.setPrototypeOf(Ring.prototype, Back.prototype);
Object.setPrototypeOf(Start.prototype, Ring.prototype);
function run(count) { let made = 0; for (let i = 0; i < count; i++) { new Start(i); made++; } return made; }
try { console.log(run(process.argv.length)); } catch (e) { console.log(e.name); }
