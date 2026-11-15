function boom() { throw new RangeError("r"); }
function f() { return Array.from({ length: boom() }, (_, i) => i).length; }
try { console.log(f()); } catch (e) { console.log(e.name); }
