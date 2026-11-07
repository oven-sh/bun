globalThis.shelf = [];
const keep = (0, eval)("(o) => { shelf.push(o); }");
function make(i) { const o = { lid: i }; keep(o); return i; }
make(1); make(2);
console.log(shelf.map(o => o.lid).join());
