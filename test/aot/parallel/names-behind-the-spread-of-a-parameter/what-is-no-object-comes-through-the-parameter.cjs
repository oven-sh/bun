const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
function step(state, i) { return { ...state, busy: i, more: i + 1 }; }
const door = [null, undefined, 7, 'text', true, Symbol.iterator, 10n, [4, 5], function named() { }, new Map([[1, 2]])];
for (let t = 0; t < turns; t++) { out.push(show(step({ id: t, text: 't', count: 1, open: true }, t))); out.push(show(Reflect.apply(step, undefined, [door[t % door.length], t]))); }

console.log(out.join("\n"));
