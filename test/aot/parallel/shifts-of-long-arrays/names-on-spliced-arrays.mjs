const list = [];
for (let i = 0; i < 60; i++) list.push(i);
const kept = [];
for (let k = 0; k < 40; k++) {
  const taken = list.slice().splice(1, 50);
  while (taken.length > 46) taken.shift();
  taken.name = "x" + k;
  kept.push(taken);
}
Bun.gc(true);
console.log(kept.length, kept[39].length, kept[39][45], kept[39].name);
