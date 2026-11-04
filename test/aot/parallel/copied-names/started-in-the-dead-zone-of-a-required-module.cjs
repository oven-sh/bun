function outer(run) { let said; try { said = run(a); } catch (e) { said = e.constructor.name; } const path = require("node:path"); return said + " " + a(); function a() { return walk(); } function walk() { return path.sep.length; } }
console.log(outer(f => f()));
