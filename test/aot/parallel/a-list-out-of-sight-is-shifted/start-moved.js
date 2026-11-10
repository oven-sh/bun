// The collector: a long queue, whose start the operation moves forward, comes down to the stub's lengths.
// The list goes through a door under a key that is read, so nothing is copied in line and the list is out of sight where it is shifted.
// COUNT: operation:operationAOTArrayShiftOfAnyList <= 54900
const doors = { name(q) { return q.shift(); }, value(q) { const f = q.shift; return f.call(q); }, apply(q) { return Reflect.apply(Array.prototype.shift, q, []); } }; const go = (d, q) => doors[d](q); const all = Object.keys(doors);
const name = JSON.parse('"name"');
let bad = 0; for (let r = 0; r < 300; r++) { const q = []; for (let i = 0; i < 200; i++) q.push({ i }); for (let i = 0; i < 200; i++) if (go(name, q).i !== i) bad++; q.push({ i: r }); if (go(name, q).i !== r || q.length) bad++; } console.log(bad);
