class Plain { idq; noteq = [1]; constructor(v) { this.idq = v; } }
function see(o) { return Object.keys({ ...o }).join(); }
const out = [];
for (const make of [() => ({ idq: undefined, noteq: {}, zq: 0 }), () => ({ idq: 7, noteq: 2 }), () => ({ idq: 8, noteq: {} })]) out.push(see(make()));
console.log(out.join(" "));
