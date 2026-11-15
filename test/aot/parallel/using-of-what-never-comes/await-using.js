function boom() { throw new RangeError("r"); }
async function f() { await using r0 = boom(); return 0; }
try { console.log(await f()); } catch (e) { console.log(e.name); }
