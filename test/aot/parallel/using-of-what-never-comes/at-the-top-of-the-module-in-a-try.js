function boom() { throw new RangeError("r"); }
try { using r0 = boom(); console.log(0); } catch (e) { console.log(e.name); }
