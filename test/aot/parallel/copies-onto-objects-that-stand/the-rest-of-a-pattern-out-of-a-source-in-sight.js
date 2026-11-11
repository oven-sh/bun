// STATISTIC: ObjectRestsExpandedToDefines >= 2
// STATISTIC: ObjectSpreadsExpandedToDefines = 0
// Plain JavaScript: the rest of a pattern out of a default that stands in sight, out of a literal handed over, out of the members of a written list: the names that the pattern has taken stay out.
function show(v) { console.log(Object.keys(v).join() + "|" + JSON.stringify(v) + "|" + Reflect.ownKeys(v).length + "|" + ("a" in v)); }
var holder = { take({ a, ...r } = { a: 1, q: 2 }) { return r; } };
show(holder.take());
show(holder.take({ a: 5, w: 6 }));
function last({ q, ...r } = { a: 1, q: 2 }) { return r; }
show(last());
function both({ a, q, ...r } = { a: 1, q: 2 }) { return r; }
show(both());
function neither({ z, ...r } = { a: 1, q: 2 }) { return r; }
show(neither());
for (const { a, ...r } of [{ a: 1, s: 2 }, { s: 3, a: 4 }]) show(r);
var again;
({ a: again, ...again } = { a: 1, v: 2 });
show(again);
(({ a, ...b }, ...c) => console.log(a, Object.keys(b).join(), c.length))({ a: 1, z: 2 }, 3, 4);
function standing() { return { z: 0 }; }
var calls = 0;
show({ ...standing(), ...{ get a() { calls++; return 1; }, b: 2 } });
for (var turn = 0; turn < 3; turn++) show({ ...standing(), ...{ b: turn, get a() { calls++; return turn; } } });
console.log(calls);
