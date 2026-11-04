import { Meter } from "./meter.js";
import "./strip.js";
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
console.log(tell(Meter.prototype), new Meter().n);
