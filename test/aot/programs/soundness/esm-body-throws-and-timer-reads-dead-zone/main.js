function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
process.on("uncaughtException", e => console.log("uncaught", e.message));
setTimeout(() => console.log(attempt(() => later.x), attempt(() => new K().m()), attempt(() => count + 1)), 1);
if (JSON.parse("true")) throw new RangeError("midway");
const later = { x: 1 };
class K { m() { return 1; } }
let count = 41;
