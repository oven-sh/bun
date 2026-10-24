// transitions.js <objects>: every object gets five properties under names of its own, by key: each store makes a new transition.
const n = Number(process.argv[2] ?? 100);
const kept = [];
for (let i = 0; i < n; i++) {
  const object = JSON.parse("{}");
  for (let j = 0; j < 5; j++) object["p" + i + "_" + j] = j;
  kept.push(object);
}
console.log(kept.length, Object.keys(kept[n - 1]).join());
