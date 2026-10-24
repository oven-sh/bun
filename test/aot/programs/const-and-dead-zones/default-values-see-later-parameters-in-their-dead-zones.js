// Default values of parameters see later parameters in their dead zone; a closure in a default value.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function d(a = () => b.x, b = { x: attempt(a) }) { return b.x; }
console.log(d());
function e(a = attempt(() => c.x), { c } = { c: { x: 1 } }) { return a; }
console.log(e());
const [m = attempt(() => n.x), n = { x: 1 }] = [];
console.log(m);
