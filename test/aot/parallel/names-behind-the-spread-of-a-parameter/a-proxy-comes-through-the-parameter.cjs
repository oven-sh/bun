const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
function step(state, i) { return { ...state, busy: i, more: i + 1 }; }
const log = [];
function veiled(t) { return new Proxy({ open: 1, id: t, zeta: 2 }, { ownKeys(o) { log.push('keys'); return Reflect.ownKeys(o); }, getOwnPropertyDescriptor(o, k) { log.push('d:' + String(k)); return Reflect.getOwnPropertyDescriptor(o, k); }, get(o, k) { log.push('g:' + String(k)); return o[k]; } }); }
for (let t = 0; t < turns; t++) { out.push(show(step({ id: t, text: 't', count: 1, open: true }, t))); log.length = 0; out.push(show(Reflect.apply(step, undefined, [veiled(t), t])) + '|' + log.join()); }

console.log(out.join("\n"));
