// An async function that was started earlier holds an object in its suspended frame and stores to it while the caller awaits. What the caller reads after the await is the new value, and what it stored before the await is gone.
const later = () => new Promise(resolve => setTimeout(resolve, 0));
async function change(x) { await null; x.v = 2; }
async function arrowStartedBefore() { const o = { v: 1 }; const other = (async () => { await later(); o.v = 2; })(); const a = o.v; await other; return [a, o.v].join(); }
async function objectHandedOver() { const o = { v: 1 }; const other = change(o); const a = o.v; await other; return [a, o.v].join(); }
async function anotherPromiseAwaited() { const o = { v: 1 }; change(o); const a = o.v; await later(); return [a, o.v].join(); }
async function storeBeforeTheAwait() { const o = { v: 1 }; const other = change(o); o.v = 5; await other; return o.v; }
async function testBeforeTheAwait() { const o = { pet: { legs: 4 } }; const other = (async () => { await later(); o.pet = null; })(); if (o.pet === null) return "null"; await other; return o.pet === null ? "cleared" : o.pet.legs; }
for (const f of [arrowStartedBefore, objectHandedOver, anotherPromiseAwaited, storeBeforeTheAwait, testBeforeTheAwait]) {
  console.log(f.name, await f(), await f());
}
console.log(await arrowStartedBefore(), await objectHandedOver(), await anotherPromiseAwaited(), await storeBeforeTheAwait(), await testBeforeTheAwait());
