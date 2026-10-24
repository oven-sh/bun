function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { let hidden = 1; Object.defineProperty(this, "made", { get() { return hidden; }, set(v) { hidden = v * 2; }, enumerable: true, configurable: true }); this.name = "m"; }
class Fine extends Meter { extra = 2; bump() { this.made = this.made + 1; return this.made; } }
const fine = new Fine();
console.log(show(fine), fine.bump(), fine.bump(), Object.getOwnPropertyDescriptor(fine, "made").get !== undefined);
