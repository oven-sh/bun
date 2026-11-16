// The collector: old lists hold young objects.
// The list goes through a door under a key that is read, so nothing is copied in line and the list is out of sight where it is shifted.
// COUNT: operation:operationAOTArrayShiftGeneric <= 0
const doors = { name(q) { return q.shift(); }, value(q) { const f = q.shift; return f.call(q); }, apply(q) { return Reflect.apply(Array.prototype.shift, q, []); } }; const go = (d, q) => doors[d](q); const all = Object.keys(doors);
const name = JSON.parse('"name"');
const lists = []; for (let k = 0; k < 64; k++) lists.push([]); Bun.gc(true); let bad = 0; for (let r = 0; r < 20000; r++) { const q = lists[r & 63]; q.push({ r }); if (q.length > 9 && go(name, q).r !== r - 576) bad++; } let n = 0, sum = 0; for (const q of lists) { n += q.length; for (const x of q) sum += x.r; } console.log(bad, n, sum);
