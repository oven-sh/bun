function Meter() { this.n = 1; }
function tell() { let hits = 0; for (let i = 0; i < 300; i++) if (Meter.prototype === null) hits++; return hits; }
function strip() { Meter.prototype = null; }
const ahead = tell();
strip();
console.log(ahead, tell());
