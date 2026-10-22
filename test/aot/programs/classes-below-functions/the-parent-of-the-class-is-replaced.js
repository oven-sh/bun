function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; this.name = "m"; }
function Other() { this.z = 26; }
class Fine extends Meter { extra = 2; }
console.log(show(new Fine()));
Object.setPrototypeOf(Fine, Other);
const fine = new Fine();
console.log(show(fine), fine.made, fine.z, fine instanceof Meter, fine instanceof Other);
Object.setPrototypeOf(Fine, Meter);
console.log(show(new Fine()));
