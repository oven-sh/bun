function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
let hook;
let wake, state;
Promise.resolve().then(() => { console.log(attempt(() => state.x)); wake(); });
await new Promise(r => { wake = r; });
state = { x: 1 };
console.log(state.x);
