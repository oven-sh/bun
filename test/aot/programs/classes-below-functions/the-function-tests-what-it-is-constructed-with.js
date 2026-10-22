function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter(n) { if (!(this instanceof Meter)) return new Meter(n); this.made = n; this.target = new.target === undefined ? "none" : new.target.name; }
class Fine extends Meter { extra = 2; }
console.log(show(new Fine(1)), show(new Meter(2)), show(Meter(3)));
