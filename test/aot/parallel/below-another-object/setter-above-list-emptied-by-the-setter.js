const created = Object.create({ set slot(l) { l.length = 0; l.push("s"); } });
function store(o, l) { o.slot = l; }
function run(i) { const l = [i, i + 1]; store(created, l); return l.length + " " + typeof l[0] + " " + l[0]; }
let out = ""; for (let i = 0; i < 3; i++) out += run(i) + ";"; console.log(out);
