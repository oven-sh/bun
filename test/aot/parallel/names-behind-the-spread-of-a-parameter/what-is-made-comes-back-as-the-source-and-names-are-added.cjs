'use strict';
function step(state, i) { return { ...state, busy: i > 1, more: i }; }
function f(t) { let state = { id: t, text: 't', count: 2, open: true }, s = 0; for (let i = 0; i < 4; i++) { state = step(state, i); s += state.more + state.count; } return s; }
globalThis.kept = [f];
const n = +process.argv[2]; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(sum);
