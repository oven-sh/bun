// A Map or Set of whose entries three in four are deleted lets its table go for a smaller one. Whoever walks it goes on where he stood.
const lines = [];
const name = v => (typeof v === "object" ? "o" + v.i : String(v));
const kinds = { text: i => "k" + i, whole: i => i, half: i => i + 0.5, object: (objects => i => (objects[i] ??= { i }))([]) };

for (const [kind, key] of Object.entries(kinds)) {
  for (const size of [31, 32, 33, 64, 100, 300]) {
    const map = new Map(), set = new Set();
    for (let i = 0; i < size; i++) { map.set(key(i), i); set.add(key(i)); }
    const early = map.keys(), middle = map.entries(), late = set.values(), unstarted = set.entries();
    early.next();
    for (let i = 0; i < size >> 1; i++) middle.next();
    for (let i = 0; i < size - 2; i++) late.next();

    // In the middle of a walk: what is deleted ahead is not visited, what is added behind is.
    const seen = [];
    let calls = 0;
    for (const [k, v] of map) {
      seen.push(v);
      if (++calls === 3) {
        for (let i = 0; i < size; i++) if (i % 9) { map.delete(key(i)); set.delete(key(i)); }
        map.set(key(size), size); set.add(key(size));
      }
    }
    lines.push([kind, size, seen.join(), [...early].map(name).join(), [...middle].map(e => e[1]).join(), [...late].map(name).join(), [...unstarted].map(e => name(e[0])).join(), map.size, set.size].join(" | "));

    // All that is left is found, nothing else is.
    let hits = 0;
    for (let i = 0; i <= size + 1; i++) hits += (map.has(key(i)) ? 1 : 0) + (set.has(key(i)) ? 10 : 0) + (map.get(key(i)) === i ? 100 : 0);
    // Down to nothing, one by one, with a walk at each step, and up again.
    const order = [];
    for (const k of [...map.keys()]) { map.delete(k); set.delete(k); let n = 0; for (const _ of map) n++; for (const _ of set) n++; order.push(n); }
    for (let i = 0; i < 40; i++) { map.set(key(i), -i); set.add(key(i)); }
    lines.push([hits, order.join(), map.size, set.size, [...map.values()].slice(-2).join(), name([...set][39])].join(" | "));
  }
}

// forEach with deletions in the callback.
const walked = new Map(Array.from({ length: 120 }, (_, i) => [i, i]));
const visited = [];
walked.forEach((v, k) => { visited.push(k); for (let i = k + 1; i < k + 12; i++) walked.delete(i); if (k === 108) walked.set("late", 1); });
lines.push(visited.join() + " | " + walked.size);

// A has and the get behind it, and a search in a loop, with a table that a callee lets go in between.
const cache = new Map(Array.from({ length: 200 }, (_, i) => ["k" + i, i]));
const holder = [cache];
function drop(from) { for (let i = from; i < 200; i++) holder[0].delete("k" + i); }
function read(k, from) { if (cache.has(k)) { drop(from); return cache.get(k); } return "absent"; }
lines.push([read("k5", 10), read("k5", 0), read("k5", 0), cache.size].join());
const nodes = Array.from({ length: 200 }, (_, i) => ({ i }));
const marked = new Set(nodes);
const owner = { marked };
function sweep(i) { if (i === 20) for (let j = 30; j < 200; j++) owner.marked.delete(nodes[j]); }
let found = 0;
for (let i = 0; i < 200; i++) { sweep(i); if (marked.has(nodes[i])) found++; }
lines.push(found + " " + marked.size);

// clear(), then few, then many, then few.
const turns = new Set();
for (let round = 0; round < 4; round++) {
  for (let i = 0; i < 500; i++) turns.add(round + ":" + i);
  const it = turns.values();
  it.next();
  for (let i = 0; i < 497; i++) turns.delete(round + ":" + i);
  lines.push([...it].join() + " " + turns.size);
  if (round % 2) turns.clear();
}
console.log(lines.join("\n"));
