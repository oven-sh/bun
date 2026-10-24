function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Root() { this.root = 0; }
Root.prototype.where = function () { return "root " + this.root; };
function Meter() { Root.call(this); this.made = 1; }
Object.setPrototypeOf(Meter.prototype, Root.prototype); Object.setPrototypeOf(Meter, Root);
class Fine extends Meter { extra = 2; }
const fine = new Fine();
console.log(show(fine), fine.where(), fine instanceof Root, show(new Meter()));
