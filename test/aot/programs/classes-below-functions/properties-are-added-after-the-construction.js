function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; }
class Fine extends Meter { extra = 2; }
const fine = new Fine(); fine.later = 3; fine.name = "n"; delete fine.extra; fine.extra = 4;
const meter = new Meter(); meter.extra = 5;
console.log(show(fine), show(meter), show(new Fine()));
