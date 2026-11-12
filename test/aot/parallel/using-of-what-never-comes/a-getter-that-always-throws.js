const holder = { get made() { throw new RangeError("r"); } };
function f() { using r0 = holder.made; return 0; }
try { console.log(f()); } catch (e) { console.log(e.name); }
