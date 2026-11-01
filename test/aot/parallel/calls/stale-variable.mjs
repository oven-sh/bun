const u = { box: write => ({ set() { write({ a: 1 }); } }), unread: () => 2 };
const between = {};
for (const e of Object.entries(u)) Object.defineProperty(between, e[0], { get: () => u[e[0]] });
let state = {};
between.box(v => { state = v; }).set();
console.log(JSON.stringify(state));
