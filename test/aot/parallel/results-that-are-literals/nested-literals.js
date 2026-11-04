function id(x) { return x; }
const all = [id({ p: { q: 1 } }), id({ p: { r: "s" } }), id({ p: null }), id({ o: { q: 2 } })];
let text = "";
for (const each of all) text += (each.p ? (each.p.q ?? each.p.r) : each.p) + ",";
console.log(text, JSON.stringify(all));
