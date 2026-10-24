function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; }
Meter.prototype = { read() { return "first " + this.made; } };
class Fine extends Meter { extra = 2; }
Meter.prototype = { read() { return "second " + this.made; } };
class Later extends Meter { extra = 3; }
console.log(new Fine().read(), new Later().read(), new Fine() instanceof Meter, new Later() instanceof Meter, show(new Fine()));
