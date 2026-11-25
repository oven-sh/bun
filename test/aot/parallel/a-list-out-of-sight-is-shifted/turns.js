// The collector: a list of integers takes an object in and is shifted on.
// The list goes through a door under a key that is read, so nothing is copied in line and the list is out of sight where it is shifted.
// COUNT: operation:operationAOTArrayShiftGeneric <= 30000
const doors = { name(q) { return q.shift(); }, value(q) { const f = q.shift; return f.call(q); }, apply(q) { return Reflect.apply(Array.prototype.shift, q, []); } }; const go = (d, q) => doors[d](q); const all = Object.keys(doors);
const name = JSON.parse('"name"');
let bad = 0, n = 0; for (let r = 0; r < 30000; r++) { const q = [1, 2, 3, 4]; if (go(name, q) !== 1) bad++; q.push({ r }); for (let i = 2; i < 5; i++) if (go(name, q) !== i) bad++; if (go(name, q).r !== r || q.length) bad++; n++; } console.log(bad, n);
