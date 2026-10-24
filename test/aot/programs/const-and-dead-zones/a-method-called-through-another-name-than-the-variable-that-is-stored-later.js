// The callee comes out of a variable that is stored later; the call happens through another name of the same object.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
let api;
const early = { run() { return later.x; } };
function go() { return api.run(); }
console.log(attempt(() => early.run()));
api = early;
console.log(attempt(go));
const later = { x: 1 };
console.log(attempt(go));
