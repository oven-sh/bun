// A function that is called once finds the closure in arguments.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
let r;
try { r = (function () { return arguments[0](); })(() => later.x); } catch (e) { r = "threw " + e.constructor.name; }
console.log(r);
const later = { x: 1 };
console.log(later.x);
