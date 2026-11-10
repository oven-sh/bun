class Tagged { get __proto__() { return 7; } hello() { return 2; } }
function linkOf(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.__proto__; }
let out = ""; for (let i = 0; i < 300; i++) { const got = linkOf(new Tagged()); out = typeof got + ":" + (got === 7); }
console.log(out);
