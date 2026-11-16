const created = Object.create({ set slot(v) { Object.freeze(v); } });
function store(o, v) { o.slot = v; }
function run(i) { const v = { a: i, b: "x" }; store(created, v); let r; try { v.a = 9; r = "stored"; } catch (e) { r = e.name; } return r + " " + v.a + " " + Object.isFrozen(v); }
let out = ""; for (let i = 0; i < 3; i++) out += run(i) + ";"; console.log(out);
