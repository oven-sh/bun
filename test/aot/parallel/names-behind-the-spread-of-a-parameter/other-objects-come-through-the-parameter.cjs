const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
function step(state, i) { return { ...state, busy: i, more: i + 1 }; }
const door = JSON.parse('[{"open":true,"id":7},{"id":1,"text":"a","count":2,"open":false,"extra":9},{},{"more":5,"busy":6,"id":2},{"2":"two","1":"one","id":3}]');
for (let t = 0; t < turns; t++) { out.push(show(step({ id: t, text: 't', count: 1, open: true }, t))); out.push(show(Reflect.apply(step, undefined, [door[t % door.length], t]))); }

console.log(out.join("\n"));
