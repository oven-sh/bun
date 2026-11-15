// Stores: least recently and least frequently used with limits by count, size and age, tries by letters and by longest prefix, a sorted list of levels, a filter that may say yes, intervals, a log with a snapshot, in two modules
import { Recent, Frequent, Trie, Levels, Maybe, Intervals, Log } from "./lib.mjs";
let clock = 0;
const told = [];
const r = new Recent({ max: 12, size: v => v.length, age: 30, now: () => clock, onEvict: (k, v,
  why) => told.push(k + why) });
r.set("a", "xxx").set("b", "xxxx").set("c", "xxxxx");
console.log(r.get("a"), [...r].map(e => e[0]).join(""), r.total);
r.set("d", "xx");
console.log([...r].map(e => e[0]).join(""), r.evicted.join());
clock = 40;
console.log(r.get("a"), r.get("zz"), r.peek("c"), r.hits, r.misses, r.delete("c"),
  r.delete("c"), r.size, told.join());
try {
  r.set("big", "x".repeat(13));
} catch (e) {
  console.log(e.name, e.message);
}
r.set("d", "xxxxxx");
console.log(r.total, [...r].join("|"));
const f = new Frequent(3);
f.set("a", 1).set("b", 2).set("c", 3);
f.get("a");
f.get("a");
f.get("c");
f.set("d", 4);
console.log(String(f), f.get("b"), f.get("d"));
f.set("e", 5).set("f", 6);
console.log(String(f), String(new Frequent(0).set("q", 1)));
let seed = 77;
const random = n => (seed = (seed * 48271) % 2147483647) % n;
const skewed = n => Math.min(random(n), random(n), random(n));
const lru = new Recent({ max: 64 }), lfu = new Frequent(64);
let lfuHits = 0;
for (let i = 0; i < 12000; i++) {
  const k = skewed(400);
  if (lru.get(k) === undefined) lru.set(k, i);
  if (lfu.get(k) !== undefined) lfuHits++;
  else lfu.set(k, i);
}
console.log(lru.hits, lru.misses, lfuHits, lru.evicted.length, [...lru].slice(0,
  5).map(e => e[0]).join());
const trie = new Trie([["car", 1], ["card", 2], ["care", 3], ["cat", 4], ["dog", 5], ["do", 6],
  ["", 0]]);
console.log(trie.size, trie.nodes, [...trie].map(e => e.join("=")).join(),
  [...trie.entries("car")].join(" "), trie.count("ca"), trie.count("x"));
console.log(JSON.stringify([trie.longest("cards"), trie.longest("dot"), trie.longest("z"),
  trie.get("ca"), trie.has("ca")]), trie.near("cart").join(), trie.near("dg", 2).join());
console.log(trie.delete("car"), trie.delete("car"), trie.delete("dog"), trie.size, trie.nodes,
  [...trie].length);
const syllables = ["ka", "lo", "mi", "ne", "ru", "ta", "shi"];
const big = new Trie();
let mixed = 0;
for (let i = 0; i < 2500; i++) {
  let w = "";
  for (let k = 1 + random(5); k > 0; k--) w += syllables[random(7)];
  if (random(5) === 0) big.delete(w);
  else big.set(w, i);
}
for (const [w, v] of big) {
  mixed = (mixed * 31 + w.length * 7 + v) >>> 0;
}
console.log(big.size, big.nodes, mixed, big.near("kalomi", 1).slice(0, 6).join(),
  big.count("ka"));
for (const p of syllables) mixed = (mixed * 31 + big.count(p) + [...big.entries(p)].length) >>> 0;
const s = new Levels();
const real = new Map();
for (let i = 0; i < 4000; i++) {
  const k = random(1500);
  if (random(3) === 0) {
    if (s.delete(k) !== real.delete(k)) console.log("wrong delete", k);
} else {
    s.set(k, i);
    real.set(k, i);
  }
}
const keys = [...real.keys()].sort((a, b) => a - b);
let wrong = 0;
keys.forEach((k, i) => {
  if (s.at(i) !== k || s.rank(k) !== i || s.get(k) !== real.get(k)) wrong++;
});
console.log(s.size, real.size, wrong, s.level, s.steps, [...s.range(100, 112)].join(" "),
  s.at(-1), s.at(s.size), s.get(-5));
const names = new Levels((a, b) => b.localeCompare(a));
for (const n of ["pear", "fig", "apple", "kiwi", "fig"]) names.set(n, n.length);
console.log([...names.range("z", "a")].join(" "), names.size);
const maybe = new Maybe(4096, 4);
for (let i = 0; i < 500; i++) maybe.add("key" + i);
let missed = 0, falsely = 0;
for (let i = 0; i < 500; i++) if (!maybe.has("key" + i)) missed++;
for (let i = 500; i < 3500; i++) if (maybe.has("key" + i)) falsely++;
console.log(missed, falsely, maybe.full.toFixed(4));
const iv = new Intervals().add(1, 5).add(10, 15).add(4, 8).add(20, 25).remove(12, 22);
console.log(String(iv), iv.length, [0, 1, 7, 8, 11, 12, 23, 25].map(x => iv.has(x)).join(),
  JSON.stringify(iv.gaps(0, 30)));
for (let i = 0; i < 600; i++) {
  const a = random(5000);
  if (random(3)) iv.add(a, a + 1 + random(20));
  else iv.remove(a, a + 30);
}
console.log(String(iv).length, iv.length, iv.gaps(0, 5000).length);
try {
  iv.add(3, 3);
} catch (e) {
  console.log(e.message);
}
const log = new Log((state, e) => {
  const next = {
    ...state
};
  if (e.op === "del") delete next[e.key];
  else next[e.key] = (e.op === "add" ? (state[e.key] ?? 0) : 0) + e.value;
  return next;
});
for (let i = 0; i < 400; i++) log.append({ op: ["set", "add", "add", "del"][random(4)],
  key: "k" + random(12), value: random(100) });
const end = log.state();
console.log(JSON.stringify(end), log.replayed, log.length, Object.keys(log.state(120)).length,
  log.replayed);
console.log(log.compact(), log.length, Object.keys(log.state()).sort().join(), mixed);
