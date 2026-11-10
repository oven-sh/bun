// The place behind the last value is emptied: a length raised again finds a hole there.
// The list goes through a door under a key that is read, so nothing is copied in line and the list is out of sight where it is shifted.
// COUNT: operation:operationAOTArrayShiftGeneric <= 0
const doors = { name(q) { return q.shift(); }, value(q) { const f = q.shift; return f.call(q); }, apply(q) { return Reflect.apply(Array.prototype.shift, q, []); } }; const go = (d, q) => doors[d](q); const all = Object.keys(doors);
const name = JSON.parse('"name"');
const q = [1, 2, 3]; q[0] = 1; const x = go(name, q); q.length = 3; console.log(x, 2 in q, q[2], q.join());
