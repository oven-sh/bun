const assign = function () { return Object.assign.apply(this, arguments); };
const D = { a: 1 };
const u = { box: write => ({ set() { write(assign({}, D)); } }), unread: () => D };
const between = {};
for (const k of Object.keys(u)) Object.defineProperty(between, k, { get: () => u[k] });
let state = {};
between.box(v => { state = v; }).set();
console.log(JSON.stringify(state));
