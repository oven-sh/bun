function Meter() { this.n = 1; }
function Gauge() { this.n = 2; }
Meter.prototype = null;
Gauge.prototype = 7;
let one; try { class Below extends Meter {} one = String(Object.getPrototypeOf(Below.prototype)); } catch (e) { one = e.constructor.name; }
let two; try { class Below extends Gauge {} two = String(Object.getPrototypeOf(Below.prototype)); } catch (e) { two = e.constructor.name; }
console.log(one, two);
