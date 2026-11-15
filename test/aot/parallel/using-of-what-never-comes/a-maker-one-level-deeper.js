function boom() { throw new RangeError("r"); }
function through() { return boom(); }
function f() { using r0 = through(); return 0; }
try { console.log(f()); } catch (e) { console.log(e.name); }
