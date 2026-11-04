class V { constructor(i) { this.n = i; } twice() { return this.n * 2; } }
let got = 0;
const created = Object.create({ set slot(f) { got += f(21); } });
function store(o, f) { o.slot = f; }
function run(i) { store(created, x => x + i); return got; }
let out = ""; for (let i = 0; i < 3; i++) out += run(i) + ";"; console.log(out);
