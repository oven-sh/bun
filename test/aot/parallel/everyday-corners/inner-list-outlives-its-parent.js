// Inner list outlives its parent: compiled answers as plain.
function make(i) {
  return { id: i, list: [i, i + 1, i + 2] };
}
const kept = [];
for (let i = 0; i < 2000; i++) kept.push(make(i).list);
Bun.gc(true);
console.log(
  kept.reduce((s, l) => s + l[2], 0),
  kept[7].length,
);
