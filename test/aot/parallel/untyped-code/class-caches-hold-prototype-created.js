// What compiled code has learnt about the members of a class while its prototype was unmade goes on holding when something makes the prototype make its members: nothing is asked of the run time again. And from then on the members are read where they now lie.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTGetByIdAndCache");
class Gauge {
  level = 1;
  read() { return this.level; }
  reset() { this.level = 0; return this; }
  label() { return "gauge"; }
  get double() { return this.level * 2; }
}
class Meter extends Gauge { unit = "m"; label() { return "meter in " + this.unit; } }
function reads(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.read(); return s; }
function labels(o, turns) { let s = ""; for (let i = 0; i < turns; i++) s = o.label(); return s; }
function doubles(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.double; return s; }
function makers(o, turns) { let s; for (let i = 0; i < turns; i++) s = o.constructor; return s === Gauge ? "Gauge" : s === Meter ? "Meter" : "another"; }
const gauge = new Gauge(), meter = new Meter();
const all = () => [reads(gauge, 50), reads(meter, 50), labels(gauge, 50), labels(meter, 50), doubles(gauge, 50), doubles(meter, 50), makers(gauge, 50), makers(meter, 50)].join();
console.log(all());
const names = [Object.getOwnPropertyNames(Gauge.prototype).join(), Object.getOwnPropertyNames(Meter.prototype).join()];
const before = asked();
console.log(all());
const after = asked();
console.log(names.join(" | "));
console.log(after === before ? "nothing was asked again" : (after - before) + " names were asked again");

// They are read where they lie now.
Gauge.prototype.read = function () { return 100; };
Meter.prototype.label = () => "another label";
console.log(all());
Object.defineProperty(Gauge.prototype, "double", { get() { return -1; } });
Meter.prototype.constructor = Gauge;
console.log(all());
delete Meter.prototype.label;
delete Gauge.prototype.read;
console.log(labels(meter, 50), typeof gauge.read, typeof meter.read);
