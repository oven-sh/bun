const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
const key = JSON.parse('"made"'); const above = { inherited: 1 };
function second(state, other, i) { return { ...state, busy: i, ...other, more: i }; }
function computed(state, i) { return { ...state, [key + (i & 1)]: i, busy: i }; }
function members(state, i) { return { ...state, get late() { return i; }, run() { return i; }, busy: i }; }
function below(state, i) { return { ...state, __proto__: above, busy: i }; }
function quoted(state, i) { return { ...state, '__proto__x': 1, 3: 'three', 'a-b': i }; }
for (let t = 0; t < turns; t++) { const s = { id: t, text: 't', count: 1, open: true }; out.push(show(second(s, { id: 'o', zeta: t }, t))); out.push(show(computed(s, t))); const m = members(s, t); out.push(show(m) + '|' + m.late + '|' + m.run()); const b = below(s, t); out.push(show(b) + '|' + b.inherited + '|' + (Object.getPrototypeOf(b) === above)); out.push(show(quoted(s, t))); }

console.log(out.join("\n"));
