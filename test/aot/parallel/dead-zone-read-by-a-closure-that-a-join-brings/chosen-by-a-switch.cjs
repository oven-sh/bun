const c = process.argv.length > 100;
let f;
switch (process.argv.length) { case 100: f = () => x; break; case 101: f = () => x + 1; break; default: f = () => y; }
let before;
try { before = f(); } catch (error) { before = error.name; }
let x = 1, y = 2;
console.log(before, f());
