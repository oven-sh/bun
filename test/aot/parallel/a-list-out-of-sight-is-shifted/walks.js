// A list is shifted while it is walked.
// The list goes through a door under a key that is read, so nothing is copied in line and the list is out of sight where it is shifted.
// COUNT: operation:operationAOTArrayShiftGeneric <= 1
const doors = { name(q) { return q.shift(); }, value(q) { const f = q.shift; return f.call(q); }, apply(q) { return Reflect.apply(Array.prototype.shift, q, []); } }; const go = (d, q) => doors[d](q); const all = Object.keys(doors);
const name = JSON.parse('"name"');
const a = [..."abcde"]; let s = ""; for (const x of a) { s += x; if (x !== "e") go(name, a); } const b = [..."abcde"]; let t = ""; b.forEach(x => { t += x; go(name, b); }); const c = [1, 2, 3, 4, 5]; const m = c.map(x => { go(name, c); return x * 10; }); console.log(s, a.join(), t, b.join(), m.join(), c.join());
