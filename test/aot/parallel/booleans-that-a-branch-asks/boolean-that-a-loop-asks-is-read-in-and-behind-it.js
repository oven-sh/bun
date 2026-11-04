// a Boolean goes round a loop that asks it, and is read in a turn and behind the loop
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(n) { let more = n > 0; const seen = []; let i = 0; while (more) { seen.push(more); i++; more = i < n; seen.push(more); } seen.push(more); return seen; }
function atTheEnd(n) { let i = 0, go; const seen = []; do { go = ++i < n; seen.push(go); } while (go); return [seen, go]; }
function inTheHead(n) { const seen = []; for (let i = 0, go = i < n; go; go = ++i < n) seen.push(go); return seen; }
for (const n of [0, 1, 2, 3, 2.5, NaN, "2", null]) console.log(JSON.stringify([subject(n), atTheEnd(n), inTheHead(n)]));
