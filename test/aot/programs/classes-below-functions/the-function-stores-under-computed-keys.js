function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter(keys) { this.made = 1; for (const key of keys) this[key] = key.length; }
class Fine extends Meter { extra = 2; }
console.log(show(new Fine(["a", "extra", "made", "0", "zz"])), show(new Fine([])));
