function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
const held = [];
function Meter() { this.made = 1; held.push(this); held.push(show(this)); }
class Fine extends Meter { extra = 2; more = 3; }
const fine = new Fine();
console.log(held[1], show(held[0]), held[0] === fine);
