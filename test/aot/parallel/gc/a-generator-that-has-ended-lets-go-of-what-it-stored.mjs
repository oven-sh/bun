// A generator that has ended needs nothing of what it stored: it is collected while the generator itself is still held.
// Prints what the compiler saves: objects that are collected earlier
const unseen = x => [x][JSON.parse("0")]; const references = []; const finished = [];
function make(tag) { const thing = { tag, pad: new Array(32).fill(tag) }; references.push(new WeakRef(thing)); return thing; }
function* endsOnTheShortWay(tag, long) { yield 0; const thing = make(tag); if (long) { yield 1; yield thing.tag; } return tag; }
function start(count) { for (let tag = 0; tag < count; tag++) { const steps = endsOnTheShortWay(tag, unseen(false)); steps.next(); steps.next(); finished.push(steps); } }
start(200); for (let round = 0; round < 6; round++) { await new Promise(resolve => setTimeout(resolve, 2)); Bun.gc(true); }
console.log(references.filter(reference => reference.deref() === undefined).length > 100 ? "collected" : "KEPT", finished.length);
