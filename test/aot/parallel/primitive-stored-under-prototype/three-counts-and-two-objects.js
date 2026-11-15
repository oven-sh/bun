function Meter() { this.n = 1; }
function Gauge() { this.n = 2; }
Meter.prototype = null;
Gauge.prototype = 7;
function countNulls(p) {
  let hits = 0;
  for (let i = 0; i < 300; i++) if (p === null) hits++;
  return hits;
}
function countNumbers(p) {
  let hits = 0;
  for (let i = 0; i < 300; i++) if (typeof p === "number") hits++;
  return hits;
}
const box = { held: Meter.prototype };
function countHeld(b) {
  let hits = 0;
  for (let i = 0; i < 300; i++) if (b.held === null) hits++;
  return hits;
}
console.log(countNulls(Meter.prototype));
console.log(countNumbers(Gauge.prototype));
console.log(countHeld(box));
console.log(new Meter().n + new Gauge().n);
