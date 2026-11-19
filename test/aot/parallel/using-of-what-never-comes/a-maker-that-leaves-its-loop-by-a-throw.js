let turns = 0;
function spin() { for (;;) { if (++turns > 1000) throw new RangeError("r"); } }
function f() { using r0 = spin(); return 0; }
try { console.log(f()); } catch (e) { console.log(e.name, turns); }
