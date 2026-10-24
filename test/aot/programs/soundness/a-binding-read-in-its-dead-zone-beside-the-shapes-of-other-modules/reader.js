// The callback runs while the module waits, before the declaration of `later` has run.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
let wake;
Promise.resolve().then(() => { console.log(attempt(() => later.x)); wake(); });
await new Promise(resolve => { wake = resolve; });
const later = { x: 1 };
console.log(later.x);
