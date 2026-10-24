// Microtasks that run while the module stands at its await.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
queueMicrotask(() => seen.push(attempt(() => later.x)));
Promise.resolve().then(() => seen.push(attempt(() => later.x)));
(async () => { await null; seen.push(attempt(() => later.x)); })();
const thenable = { then(r) { seen.push(attempt(() => later.x)); r(1); } };
await thenable;
await null;
const later = { x: 1 };
console.log(seen.join("|"), later.x);
