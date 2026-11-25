const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
function step(state, i) { return { ...state, busy: i, more: i + 1 }; }
let asked = 0; const mark = Symbol('mark');
function odd(t) { const o = { get id() { asked++; return t * 2; }, text: 'g', [mark]: t }; Object.defineProperty(o, 'count', { value: 5, enumerable: false }); Object.defineProperty(o, 'open', { get() { asked += 10; return false; }, enumerable: true }); return o; }
for (let t = 0; t < turns; t++) { out.push(show(step({ id: t, text: 't', count: 1, open: true }, t))); const made = Reflect.apply(step, undefined, [odd(t), t]); out.push(show(made) + '|' + asked + '|' + Object.getOwnPropertyDescriptor(made, 'id').writable + '|' + ('count' in made)); }

console.log(out.join("\n"));
