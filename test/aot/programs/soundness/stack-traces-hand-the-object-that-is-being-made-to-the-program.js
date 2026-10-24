// Stack traces hand the error that is being made to the program.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); }
const seen = [];
Error.prepareStackTrace = (e, sites) => { seen.push(attempt(() => e.ha.qg)); return "trace"; };
class X extends Error { ha = { qg: 1 }; }
const x = new X("m"); x.stack;
class Y { constructor() { Error.captureStackTrace(this); this.stack; this.ha = { qg: 2 }; } }
const y = new Y(); y.stack;
console.log(seen.join("|"), x.ha.qg, y.ha.qg);
