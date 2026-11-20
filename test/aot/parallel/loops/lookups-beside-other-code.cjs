// STATISTIC: CollectionLookupsByTag = 1
// A loop that runs other code looks keys up by a call; one that runs none, or stores into the map itself, looks them up in line.
const log = [];
function visit(callback) {
  const map = new Map();
  for (let i = 0; i < 100; i++) map.set(i * 3, i);
  let sum = 0;
  for (let key = 0; key < 120; key++) {
    if (map.has(key + 1)) sum += callback(map, key);
    if (map.has(key * 2)) sum++;
  }
  return sum + map.size;
}
function quiet() {
  const map = new Map();
  let sum = 0;
  for (let i = 0; i < 200; i++) {
    const key = (i * 37) % 71;
    let value = map.get(key);
    if (value === undefined) map.set(key, (value = key * 2));
    sum += value;
  }
  return sum;
}
const callbacks = JSON.parse("[0,1]").map(kind => (kind ? (map, key) => { if (key === 32) map.clear(); if (key === 5) map.set(92, 7); return key; } : (map, key) => { if (key === 8) map.set(1000, 1).delete(12); return key * 2; }));
for (const callback of callbacks) log.push(visit(callback), quiet());
console.log(log.join());
