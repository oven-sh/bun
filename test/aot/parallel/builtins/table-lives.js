// Long random lives of a Map and a Set over a small world of keys: added, deleted, added again, asked, walked, cleared. Every answer goes into a sum.
// A key that is deleted and added again takes over the slot that it has left, and a table that is mostly deleted entries is let go: no answer may move.
const objects = [], symbols = [];
const kinds = {
  text: i => "k" + i,
  whole: i => i,
  half: i => i + 0.5,
  large: i => i * 16777216,
  object: i => (objects[i] ??= { i }),
  symbol: i => (symbols[i] ??= Symbol("s" + i)),
  mixed: i => (i % 3 === 0 ? "s" + i : i % 3 === 1 ? i : (objects[i] ??= { i })),
};
// Of a hundred steps: additions, deletions, questions, walks; the rest clear.
const mixes = { even: [40, 40, 10, 9], churn: [48, 48, 2, 2], drain: [30, 55, 10, 5], fill: [55, 30, 10, 5], hot: [45, 45, 5, 5] };
const name = v => (typeof v === "object" ? "o" + v.i : typeof v === "symbol" ? v.description : String(v));

function live(key, world, [adds, deletes, asks, walks], isHot, seed) {
  let state = seed, sum = 0;
  const random = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 8;
  const mix = text => { for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0; };
  const map = new Map(), set = new Set(), iterators = [];
  for (let step = 0; step < 30000; step++) {
    const what = random() % 100, k = key(isHot && random() % 4 ? random() % 3 : random() % world);
    if (what < adds) { map.set(k, step); set.add(k); }
    else if (what < adds + deletes) sum += (map.delete(k) ? 1 : 0) + (set.delete(k) ? 2 : 0);
    else if (what < adds + deletes + asks) sum = (sum + (map.has(k) ? map.get(k) : -1) + (set.has(k) ? 5 : 0)) | 0;
    else if (what < adds + deletes + asks + walks) {
      if (step % 7 === 0) {
        let count = 0;
        for (const [a, b] of map) { mix(name(a)); sum = (sum + b) | 0; if (++count > 50) break; }
        for (const a of set) { mix(name(a)); if (++count > 100) break; }
      } else if (iterators.length < 6) iterators.push(map.keys(), set.values());
      else { const result = iterators[random() % iterators.length].next(); mix(result.done ? "done" : name(result.value)); if (result.done) iterators.length = 0; }
    } else { map.clear(); set.clear(); }
    if (step % 10000 === 0) { mix([...map.keys()].map(name).join()); mix([...set].map(name).join()); }
  }
  return [sum, map.size, set.size, [...map.keys()].slice(0, 4).map(name).join(), [...set].slice(-4).map(name).join()].join(" ");
}

const lines = [];
for (const [kind, key] of Object.entries(kinds))
  for (const world of [12, 40, 150, 1200, 9000])
    for (const [mixName, mix] of Object.entries(mixes))
      lines.push(kind + " " + world + " " + mixName + ": " + live(key, world, mix, mixName === "hot", world * 7919 + mixName.length));
console.log(lines.join("\n"));
