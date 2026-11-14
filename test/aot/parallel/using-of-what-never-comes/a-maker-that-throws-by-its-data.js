function boom(x) { if (x) throw new RangeError("r"); return null; }
function f() { using r0 = boom(process.argv.length > 1); return 0; }
try { console.log(f()); } catch (e) { console.log(e.name); }
