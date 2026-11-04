// Long random lives of a Map and a Set over a small world of keys: added, deleted, added again, asked, walked, cleared. Every answer goes into a sum.
// A deletion frees the slot of the key, a table that is mostly deleted entries is let go, and a walk from the front begins behind the entries that are known to be deleted there: no answer may move.
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
// Of a hundred steps: additions, deletions, questions, walks, clearings; in the rest the oldest goes, as from a cache or a queue.
const mixes = { even: [40, 40, 10, 9, 1], churn: [48, 48, 2, 2, 0], drain: [30, 55, 10, 5, 0], fill: [55, 30, 10, 5, 0], hot: [45, 45, 5, 5, 0], evict: [45, 5, 5, 5, 0], queue: [42, 0, 4, 4, 0], cleared: [40, 8, 6, 5, 1] };
const name = v => (typeof v === "object" ? "o" + v.i : typeof v === "symbol" ? v.description : String(v));

function live(key, world, [adds, deletes, asks, walks, clears], isHot, seed) {
  let state = seed, sum = 0;
  const random = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 8;
  const mix = text => { for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0; };
  const map = new Map(), set = new Set(), iterators = [];
  for (let step = 0; step < 15000; step++) {
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
    } else if (what < adds + deletes + asks + walks + clears) { map.clear(); set.clear(); }
    else {
      const how = random() % 8;
      if (how === 0) {
        if (map.size) { const first = map.keys().next().value; mix(name(first)); map.delete(first); }
        if (set.size) { const first = set.values().next().value; mix(name(first)); set.delete(first); }
      } else if (how === 1) {
        for (const first of map.keys()) { mix(name(first)); map.delete(first); break; }
        for (const first of set) { mix(name(first)); set.delete(first); break; }
      } else if (how === 2) {
        if (map.size) { const [[first, value]] = map; mix(name(first)); sum = (sum + value) | 0; map.delete(first); }
        if (set.size) { const [first] = set; mix(name(first)); set.delete(first); }
      } else if (how === 3) {
        if (map.size) { const [first] = map.entries().next().value; mix(name(first)); map.delete(first); }
        if (set.size) { const [first] = set.entries().next().value; mix(name(first)); set.delete(first); }
      } else if (how === 4) {
        while (map.size > world / 3) map.delete(map.keys().next().value);
        while (set.size > world / 3) { const [first] = set; set.delete(first); }
      } else if (how === 5) {
        let count = 0;
        for (const first of map.keys()) { map.delete(first); if (++count > 4) break; }
        count = 0;
        for (const first of set) { set.delete(first); if (++count > 4) break; }
      } else if (how === 6) {
        if (map.size) { const first = map.keys().next().value, value = map.get(first); map.delete(first); map.set(first, value); }
        if (set.size) { const first = set.keys().next().value; set.delete(first); set.add(first); }
      } else if (step % 997 === 0) {
        while (map.size) map.delete(map.keys().next().value);
        while (set.size) set.delete(set.values().next().value);
      }
    }
    if (step % 5000 === 0) { mix([...map.keys()].map(name).join()); mix([...set].map(name).join()); }
  }
  return [sum, map.size, set.size, [...map.keys()].slice(0, 4).map(name).join(), [...set].slice(-4).map(name).join()].join(" ");
}

const lines = [];
for (const [kind, key] of Object.entries(kinds))
  for (const world of [12, 40, 150, 1200, 9000])
    for (const [mixName, mix] of Object.entries(mixes))
      lines.push(kind + " " + world + " " + mixName + ": " + live(key, world, mix, mixName === "hot", world * 7919 + mixName.length));
console.log(lines.join("\n"));
