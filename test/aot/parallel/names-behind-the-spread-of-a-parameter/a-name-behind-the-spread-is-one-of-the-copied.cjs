const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
function step(state, i) { return { ...state, text: i, busy: i, id: 'late' }; }
const door = JSON.parse('[{"text":"x","zeta":1},{"busy":0,"id":5,"text":"y"}]');
for (let t = 0; t < turns; t++) { out.push(show(step({ id: t, text: 't', count: 1, open: true }, t))); out.push(show(Reflect.apply(step, undefined, [door[t & 1], t]))); }

console.log(out.join("\n"));
