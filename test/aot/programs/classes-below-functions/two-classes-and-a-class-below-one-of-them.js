function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter(n) { this.made = n; this.name = "m"; }
Meter.prototype.read = function () { return this.made + ":" + this.name; };
class Fine extends Meter { extra = 2; }
class Coarse extends Meter { wide = 3; wider = 4; }
class Finest extends Fine { most = 5; constructor(n) { super(n + 1); this.end = 6; } }
function readAll(list) { return list.map(it => it.read() + " " + show(it)).join(" | "); }
console.log(readAll([new Meter(1), new Fine(2), new Coarse(3), new Finest(4), new Fine(5)]));
