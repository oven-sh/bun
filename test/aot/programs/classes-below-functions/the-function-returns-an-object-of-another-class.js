function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
class Other { a = 1; b = 2; c = 3; }
function Meter(pick) { this.made = 1; this.name = "m"; if (pick) return new Other(); }
class Fine extends Meter { extra = 2; }
for (const pick of [false, true, false, true]) { const fine = new Fine(pick); console.log(show(fine), fine instanceof Other, fine instanceof Fine, fine.extra, fine.made, fine.a); }
