function Few(a, b) { this.a = a; this.b = b; this.c = 1; }
function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o) + '|' + ('b' in o) + '|' + o.a + ',' + o.b + ',' + o.c; }
function make(i) { return new Few({ i }); }
const kept = []; for (let i = 0; i < 20000; i++) { const o = make(i); if (i % 1000 === 0) { kept.push(o); Bun.gc(true); } }
console.log(kept.length, kept.map(o => o.a.i + ':' + o.b + ':' + o.c).join());
