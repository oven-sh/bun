function boom() { throw new RangeError("r"); }
function f() { const r0 = boom(); return 0; }
try { console.log(f()); } catch (e) { console.log(e.name); }
