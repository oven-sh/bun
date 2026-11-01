let sum = 0;
const byNumber = new Map(), byText = new Map(), seen = new Set(), weak = new WeakMap(), keys = [];
for (let i = 0; i < 60000; i++) { byNumber.set(i, i); byText.set("k" + i, { i }); seen.add(i % 5000); const key = { i }; keys.push(key); weak.set(key, i); }
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < 60000; i++) sum += byNumber.get(i) + byText.get("k" + i).i + (seen.has(i) ? 1 : 0) + weak.get(keys[i]);
  for (const [key, value] of byNumber) sum += key - value;
  for (const value of seen) sum += value;
  for (let i = round; i < 60000; i += 7) { byNumber.delete(i); byNumber.set(i, i); }
}
sum += Object.fromEntries(byText).k7.i + new Set([...seen].map(n => n >> 1)).size + Map.groupBy(keys, key => key.i % 10).size;
console.log(sum);
