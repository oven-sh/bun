// Inner object outlives its parent: compiled answers as plain.
function make(i) {
  return { id: i, pos: { x: i, y: i + 1 } };
}
const kept = [];
for (let i = 0; i < 2000; i++) {
  const o = make(i);
  kept.push(o.pos);
}
Bun.gc(true);
let s = 0;
for (const p of kept) s += p.x * 2 + p.y;
console.log(s, kept[1999].y, kept[0] === kept[1]);
