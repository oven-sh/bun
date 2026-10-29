// a.mjs and one line that never runs, in which the function is called once more.
const kept = [];
function start() { const state = { n: 0 }; kept.push(state); if (kept.length === 1) throw new Error("first run"); return state; }
let again = start, made;
try { made = start(); } catch { made = again(); }
kept[0].n = 1; made.n = 5;
console.log(kept[0] === kept[1], kept[0].n, kept[1].n);
if (process.argv.length > 99) start();
