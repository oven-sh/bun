class Maker { make() { throw new RangeError("r"); } }
function f(m) { using r0 = m.make(); return 0; }
try { console.log(f(new Maker())); } catch (e) { console.log(e.name); }
