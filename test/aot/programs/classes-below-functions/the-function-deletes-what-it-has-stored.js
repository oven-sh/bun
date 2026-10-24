function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; this.name = "m"; delete this.made; }
class Fine extends Meter { extra = 2; put() { this.made = 9; return this; } }
console.log(show(new Fine()), "made" in new Fine(), show(new Fine().put()));
