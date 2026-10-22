function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; return 5; }
class Fine extends Meter { extra = 2; }
console.log(show(new Fine()), new Fine() instanceof Meter);
