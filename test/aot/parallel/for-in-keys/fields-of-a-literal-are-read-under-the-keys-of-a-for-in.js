const hide = value => JSON.parse(JSON.stringify([0]))[0] === 0 ? value : null;
function count(o) { let n = 0; for (const k in o) n += o[k] ? 1 : 0; return n; }
function names(o) { let n = 0; for (const k in o) n += k.length; return n; }
function empty(o) { let n = 0; for (const k in o) n++; return n; }
const o = hide({ alpha: 1, beta: "b", gamma: 1, delta: 2, epsilon: true, zeta: "z", eta: 2, theta: 1 });
const turns = +(process.env.TURNS || 100000), which = { count, names, empty }[process.env.KIND || "count"];
let total = 0;
for (let i = 0; i < turns; i++) total += which(o);
console.log(total);
