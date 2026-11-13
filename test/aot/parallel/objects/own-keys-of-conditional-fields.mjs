// A literal gets a name under a condition, in a helper, or behind a deletion: its names are not those of the literal.
const said = [];
const price = (parcel, amount) => { parcel.price = amount; };
function conditional(x) { const o = { weight: x }; if (x & 1) price(o, x); globalThis.answer = o.price; return Object.keys(o).join(); }
function either(x) { const o = { a: 1, b: 2 }; if (x & 1) o.c = x; else o.d = x; return Object.keys(o).join() + JSON.stringify({ ...o }); }
function behind(x) { const o = { a: 1, b: 2, c: 3 }; delete o.b; if (x & 1) o.b = x; return Object.keys(o).join() + Object.entries(o).join(";"); }
function before(x) { const o = { a: 1, b: 2, c: 3 }; if (x & 1) o.late = x; delete o.b; return Object.keys(o).join() + Object.values(o).length; }
function arms(x) { const o = { a: 1, b: 2, c: 3 }; if (x & 1) delete o.a; else delete o.c; return Object.keys(o).join() + ("a" in o) + ("c" in o); }
function same(x) { const o = { a: x, b: 2, c: 3 }; if (x & 1) { delete o.b; } else { delete o.b; o.z = 1; } return Object.keys(o).join(); }
function again(x) { const o = { a: 1, b: 2 }; for (let i = 0; i < 3; i++) { delete o.a; if (x & 1) o.a = i; } return Object.keys(o).join(); }
function plain(x) { const o = { a: 1, b: 2, c: 3 }; delete o.b; return Object.keys(o).length + Object.keys(o).join() + o.a + x; }
function taken(x) { const o = { a: 1, b: 2, c: 3 }; delete o.b; const { a, ...rest } = o; rest.x = x; return Object.keys(rest).join() + a; }
for (let x = 0; x < 4; x++) said.push("conditional " + conditional(x));
for (let x = 0; x < 4; x++) said.push("either " + either(x));
for (let x = 0; x < 4; x++) said.push("behind " + behind(x));
for (let x = 0; x < 4; x++) said.push("before " + before(x));
for (let x = 0; x < 4; x++) said.push("arms " + arms(x));
for (let x = 0; x < 4; x++) said.push("same " + same(x));
for (let x = 0; x < 4; x++) said.push("again " + again(x));
for (let x = 0; x < 4; x++) said.push("plain " + plain(x));
for (let x = 0; x < 4; x++) said.push("taken " + taken(x));
let n = 0; for (let k = 0; k < 50; k++) { const o = { a: 1, b: 2, c: 3 }; delete o.b; n += Object.keys(o).length; }
console.log(said.join("\n"), n);
