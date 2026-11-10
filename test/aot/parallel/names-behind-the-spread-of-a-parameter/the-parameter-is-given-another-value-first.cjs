const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
function step(state, i) { if (i & 1) state = { zeta: i, id: 'swapped' }; return { ...state, busy: i, more: i + 1 }; }
function loose(state, i) { arguments[0] = i & 1 ? { alpha: i } : state; return { ...state, busy: i }; }
function preset(state = { from: 'default' }, i) { return { ...state, busy: i }; }
for (let t = 0; t < turns; t++) { const s = { id: t, text: 't', count: 1, open: true }; out.push(show(step(s, t))); out.push(show(loose(s, t))); out.push(show(preset(t & 1 ? undefined : s, t))); }

console.log(out.join("\n"));
