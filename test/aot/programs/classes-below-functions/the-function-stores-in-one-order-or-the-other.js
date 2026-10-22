function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter(swap) { if (swap) { this.name = "m"; this.made = 1; } else { this.made = 1; this.name = "m"; } }
class Fine extends Meter { extra = 2; }
console.log(show(new Fine(false)), show(new Fine(true)), show(new Meter(true)));
