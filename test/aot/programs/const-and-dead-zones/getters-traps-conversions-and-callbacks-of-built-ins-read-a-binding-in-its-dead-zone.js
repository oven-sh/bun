// A getter, a proxy trap, valueOf between two statements.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const probe = () => later.x;
const o = { get p() { return probe(); }, valueOf() { return probe(); }, [Symbol.toPrimitive]() { return probe(); } };
console.log(attempt(() => o.p), attempt(() => +o), attempt(() => o + ""), attempt(() => [o].join()), attempt(() => JSON.stringify({ toJSON: probe })));
const p = new Proxy({}, { get: probe, has: probe, ownKeys: probe });
console.log(attempt(() => p.q), attempt(() => "q" in p), attempt(() => Object.keys(p)));
console.log(attempt(() => [3, 1].sort(probe)), attempt(() => "a".replace("a", probe)), attempt(() => Array.from({ length: 1 }, probe)));
const later = { x: 1 };
console.log(o.p);
