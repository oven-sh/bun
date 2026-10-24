function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; this.name = "m"; }
class Other { p = 1; q = 2; r = 3; s = 4; }
class Fine extends Meter { extra = 2; sum() { return [this.made, this.name, this.extra, this.p, this.s].join(); } }
console.log(new Fine().sum());
Object.setPrototypeOf(Fine, Other);
console.log(new Fine().sum(), show(new Fine()));
