import { test } from "bun:test";

function Meter() {
  this.n = 1;
}
function Gauge() {
  this.n = 2;
}
function countNulls(p) {
  let hits = 0;
  for (let i = 0; i < 300; i++) if (p === null) hits++;
  return hits;
}
function readName(p) {
  let out;
  for (let i = 0; i < 300; i++) out = p.n;
  return out;
}

// A read of `prototype` gives what was stored there, and what `new` makes from then on stands below Object.prototype.
test("a primitive is stored under prototype of a constructor function", () => {
  console.log("as made:", countNulls(Meter.prototype), typeof Gauge.prototype);
  Meter.prototype = null;
  Gauge.prototype = 7;
  console.log("stored:", countNulls(Meter.prototype), typeof Gauge.prototype, String(readName(Gauge.prototype)));
  console.log("made behind it:", new Meter().n, Object.getPrototypeOf(new Gauge()) === Object.prototype);
});
