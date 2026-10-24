// A function that is called once finds the closure in a rest parameter, in a default value, in arguments.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
let r;
try { r = ((...a) => a[0]())(() => later.x); } catch (e) { r = "threw " + e.constructor.name; }
console.log(r);
try { r = ((f, g = f) => g())(() => later.x); } catch (e) { r = "threw " + e.constructor.name; }
console.log(r);
try { r = (function (a) { return arguments[1](); })(0, () => later.x); } catch (e) { r = "threw " + e.constructor.name; }
console.log(r);
const later = { x: 1 };
console.log(later.x);
