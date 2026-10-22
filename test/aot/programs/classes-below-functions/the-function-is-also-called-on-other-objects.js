function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; this.name = "m"; }
class Fine extends Meter { extra = 2; }
const plain = { before: 0 }; Meter.call(plain);
const list = []; Meter.call(list);
class Alone { own = 9; } const alone = new Alone(); Meter.call(alone);
const again = new Fine(); again.made = 5; Meter.call(again);
console.log(show(plain), list.made, list.length, show(alone), show(again), show(new Fine()));
