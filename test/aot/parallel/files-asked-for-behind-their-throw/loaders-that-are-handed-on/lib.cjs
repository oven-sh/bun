// What it hands out before its first run throws lives on beside what the second run makes.
const run = globalThis.runs = (globalThis.runs ?? 0) + 1;
let counter = run * 100;
class Box { constructor(v) { this.v = v; this.run = run; } get() { return this.v + counter + ":" + this.run + ":" + run; } bump() { counter++; return this.get(); } }
function tell() { counter++; return run + "/" + counter; }
globalThis.kept.push({ tell, Box, box: new Box(run) });
if (run === 1) throw new Error("first run");
exports.run = run; exports.tell = tell; exports.Box = Box;
