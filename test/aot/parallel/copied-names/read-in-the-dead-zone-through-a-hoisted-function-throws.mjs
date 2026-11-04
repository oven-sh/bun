function outer(run) { let said; try { said = run(a); } catch (e) { said = e.constructor.name; } const list = [1, 2, 3]; return said + " " + a(); function a() { return walk(); } function walk() { return list.length; } }
console.log(outer(f => f()));
