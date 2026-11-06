// Variables that start as null get objects, functions, arrays, numbers and a Map from functions, closures, a generator and an async function.
const log = [];
var last = null, current = null; let captured = null;
function remember(value) { last = value; return () => { captured = value; }; }
function* walk() { current = { step: 1 }; yield current; current = [2]; yield current; current = null; }
async function later() { await null; last = new Map([["k", "v"]]); log.push(last.get("k")); console.log(log.join("; ")); }
log.push(last === null, current, captured);
remember({ x: 1 })(); log.push(last.x, captured.x);
remember(function named() { return 3; })(); log.push(last(), captured.name);
for (const value of walk()) log.push(JSON.stringify(value), current === value);
log.push(current); remember(4)(); log.push(last + 1, captured + 1); later();
