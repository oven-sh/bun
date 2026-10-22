function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; return { other: 7 }; }
class Fine extends Meter { extra = 2; read() { return this.made; } }
const fine = new Fine();
console.log(show(fine), fine instanceof Fine, fine instanceof Meter, fine.made, fine.other, fine.extra, typeof fine.read);
