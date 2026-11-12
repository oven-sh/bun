function boom() { throw new RangeError("r"); }
function f() { return Array(boom()).fill(0).length; }
try { console.log(f()); } catch (e) { console.log(e.name); }
