const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
function step(state, i) { return { ...state, busy: i, more: i + 1 }; }
for (let t = 0; t < turns; t++) { const s = { id: t, text: 't', count: 1, open: true }; const made = step(s, t); delete made.text; made.late = t; made.text = 'again'; delete made.busy; Object.defineProperty(made, 'id', { get() { return 'got'; }, enumerable: true, configurable: true }); out.push(show(made) + '|' + show(s)); const frozen = Object.freeze(step(s, t)); try { 'use strict'; frozen.more = 0; } catch (e) { out.push(e.name); } out.push(show(frozen) + '|' + Object.isFrozen(frozen)); }

console.log(out.join("\n"));
