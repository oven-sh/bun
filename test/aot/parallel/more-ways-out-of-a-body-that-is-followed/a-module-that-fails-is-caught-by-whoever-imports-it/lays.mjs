import { keep } from "./keeps.mjs";
function Gauge(v) { this.v = v; }
keep(Gauge);
if (process.argv.length < 99) throw new Error("stop");
Gauge.prototype.next = function () { return this.v + 1; };
