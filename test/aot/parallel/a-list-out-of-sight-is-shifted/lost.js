// The collector: a queue of young objects is filled and emptied.
// The list goes through a door under a key that is read, so nothing is copied in line and the list is out of sight where it is shifted.
// COUNT: operation:operationAOTArrayShiftGeneric <= 0
const doors = { name(q) { return q.shift(); }, value(q) { const f = q.shift; return f.call(q); }, apply(q) { return Reflect.apply(Array.prototype.shift, q, []); } }; const go = (d, q) => doors[d](q); const all = Object.keys(doors);
const name = JSON.parse('"name"');
const q = []; let bad = 0, odd = 0; for (let r = 0; r < 50000; r++) { for (let i = 0; i < 17; i++) q.push({ i: r * 17 + i }); for (let i = 0; i < 17; i++) { const x = go(name, q); if (x.i !== r * 17 + i) bad++; odd += x.i & 1; } } console.log(bad, odd);
