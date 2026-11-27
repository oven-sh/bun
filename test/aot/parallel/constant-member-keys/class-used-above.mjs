const out = [];
try { out.push(new Gauge().mode); } catch (error) { out.push(error.name); }
var KEY = "late";
class Gauge { mode = KEY === undefined ? "early" : { late: KEY }[KEY]; }
out.push(new Gauge().mode);
console.log(out.join());
