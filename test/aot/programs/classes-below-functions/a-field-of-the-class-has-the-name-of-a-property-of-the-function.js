function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; this.extra = "of the function"; this.last = 3; }
class Fine extends Meter { extra = "of the class"; made; }
const fine = new Fine();
console.log(show(fine), fine.made, fine.extra, fine.last, new Meter().extra);
