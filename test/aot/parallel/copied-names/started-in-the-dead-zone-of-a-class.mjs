function outer(run) { let said; try { said = run(a); } catch (e) { said = e.constructor.name; } class C { static n = 1; } return said + " " + a(); function a() { return walk(); } function walk() { return C.n; } }
console.log(outer(f => f()));
