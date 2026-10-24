// The throw half way through a function called once.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
var box;
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); }
try { (function () { mayThrow(); box = { a: 1 }; })(); } catch {}
console.log(attempt(() => box.a));
function f() {
  var v;
  try { (() => { mayThrow(); v = { a: 1 }; })(); } catch {}
  return attempt(() => v.a);
}
console.log(f());
function g() {
  var v;
  try { mayThrow(); v = { a: 1 }; } finally { console.log(attempt(() => v.a)); }
}
attempt(g);
