// A freeze, a seal and preventExtensions show in neither the shape nor the slots of an object, so a typed store looks at its order word. What makes a property read only, an accessor or hidden takes it out of its slot.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Point { x; y; label; constructor(x, y) { this.x = x; this.y = y; } }
function attempt(run) { try { return run(); } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } }
function state(o) { return Object.keys(o).join() + (Object.isFrozen(o) ? " frozen" : "") + (Object.isSealed(o) ? " sealed" : "") + (Object.isExtensible(o) ? " open" : ""); }
function storeX(p, v) { p.x = v; return p.x; }
function storeBoth(p, v) { p.x = v; p.y = v + 1; return p.x * 100 + p.y; }
function storeLabel(p, v) { p.label = v; return p.label; }
function storeInLoop(p, n) { for (let i = 0;i < n; i++) { p.x += i; p.y = p.x - i; } return p.x * 1000 + p.y; }
function storeFirst(p, v) { p.first = v; return p.first; }
function storeNote(p, v) { p.note = v; return p.note; }
function increment(p) { p.x++; ++p.y; return p.x + p.y; }
function close(o, how) { if (how === 1) Object.freeze(o); if (how === 2) Object.seal(o); if (how === 3) Object.preventExtensions(o); if (how === 4) Object.defineProperty(o, "x", { writable: false }); if (how === 5) Object.defineProperty(o, "x", { get() { return 40; }, set(v) {} }); if (how === 6) Object.defineProperty(o, "x", { enumerable: false }); if (how === 7) delete o.x; if (how === 8) { delete o.x; Object.preventExtensions(o); } return o; }
for (let i = 0;i < 40; i++) { const p = new Point(i, i); storeX(p, 1); storeBoth(p, 2); storeLabel(p, "a"); storeInLoop(p, 3); increment(p); const q = { first: i, second: i }; storeFirst(q, 1); storeNote(q, "n"); }
for (let how = 0;how < 9; how++) { let p = new Point(1, 2); report(attempt(() => storeX(close(p, how), 7))); report(state(p) + p.x + p.y); p = new Point(1, 2); report(attempt(() => storeBoth(close(p, how), 7))); report(state(p) + p.x + p.y); p = new Point(1, 2); report(attempt(() => storeLabel(close(p, how), "new"))); report(state(p) + p.label); p = new Point(1, 2); report(attempt(() => storeInLoop(close(p, how), 4))); report(state(p) + p.x + p.y); p = new Point(1, 2); report(attempt(() => increment(close(p, how)))); report(state(p) + p.x + p.y); }
for (let how = 0;how < 4; how++) { let q = { first: 1, second: 2 }; report(attempt(() => storeFirst(close(q, how), 7))); report(state(q) + q.first); q = { first: 1, second: 2 }; report(attempt(() => storeNote(close(q, how), "new"))); report(state(q) + q.note); q = { first: 1, second: 2, note: "old" }; report(attempt(() => storeNote(close(q, how), "new"))); report(state(q) + q.note); }
report("end");
