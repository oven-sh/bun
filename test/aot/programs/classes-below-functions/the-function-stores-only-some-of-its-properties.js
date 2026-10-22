function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter(some) { this.made = 1; if (some) this.name = "m"; if (some > 1) this.third = 3; }
class Fine extends Meter { extra = 2; }
for (const some of [0, 1, 2, 0]) { const fine = new Fine(some); console.log(show(fine), "name" in fine, fine.third, Object.hasOwn(fine, "third")); }
