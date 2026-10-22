function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; this.seen = this.look(); this.after = 3; }
Meter.prototype.look = function () { return "of the function"; };
class Fine extends Meter { extra = 2; look() { return "of the class " + this.extra + " " + this.made + " " + this.after; } }
console.log(show(new Fine()), show(new Meter()));
