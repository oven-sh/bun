// Iterators of Maps and Sets are stepped by hand while their collection grows, shrinks, is cleared and is filled again.
const numbers = JSON.parse("[" + Array.from({ length: 40 }, (_, k) => (k * 37) % 101).join() + "]");

function stepsOfValues(map, changes) {
  const seen = [];
  const it = map.values();
  for (let r = it.next(), k = 0; !r.done; r = it.next(), k++) {
    seen.push(r.value);
    if (changes[k]) changes[k](map);
    if (k > 300) break;
  }
  return seen.join();
}

function stepsOfEntries(map, changes) {
  let text = "";
  const it = map.entries();
  let r = it.next();
  for (let k = 0; r.done === false && k < 300; k++) {
    const [key, value] = r.value;
    text += key + ":" + value + " ";
    if (changes[k]) changes[k](map);
    r = it.next();
  }
  return text;
}

function stepsOfSet(set, changes) {
  const seen = [];
  const it = set.values();
  let r;
  let k = 0;
  while (!(r = it.next()).done && k < 300) {
    seen.push(r.value);
    if (changes[k]) changes[k](set);
    k++;
  }
  seen.push(String(it.next().done), String(it.next().value));
  return seen.join();
}

const mapOf = n => new Map(Array.from({ length: n }, (_, k) => [k, numbers[k % numbers.length]]));
const setOf = n => new Set(Array.from({ length: n }, (_, k) => k * 3));

const grow = n => c => {
  for (let k = 0; k < n; k++) c instanceof Map ? c.set("n" + c.size, k) : c.add("n" + c.size);
};
const drop = (...keys) => c => {
  for (const key of keys) c.delete(key);
};
const clear = c => c.clear();
const refill = n => c => {
  c.clear();
  grow(n)(c);
};

const plans = [
  {},
  { 0: grow(1) },
  { 2: grow(100) },
  { 1: drop(0, 1, 3) },
  { 1: drop(2), 2: grow(40), 5: drop(4, 5, 6) },
  { 3: clear },
  { 3: refill(5) },
  { 0: refill(60), 10: refill(3) },
  { 0: clear, 1: grow(3) },
  { 2: c => (drop(0, 1, 2)(c), grow(64)(c)), 4: refill(2) },
];
for (let turn = 0; turn < 40; turn++) {
  for (const [place, plan] of plans.entries()) {
    const results = [stepsOfValues(mapOf(8), plan), stepsOfEntries(mapOf(8), plan), stepsOfSet(setOf(8), plan), stepsOfSet(setOf(0), plan)];
    if (turn % 39 === 0) console.log(place, results.join(" | "));
  }
}

// An iterator outlives the table that it began in.
function heldIterators(rounds) {
  const map = mapOf(4);
  const held = [];
  for (let k = 0; k < rounds; k++) {
    const it = map.keys();
    it.next();
    held.push(it);
    map.set("k" + k, k);
    if (k % 7 === 3) map.delete("k" + (k - 2));
    if (k % 50 === 49) Bun.gc(true);
  }
  let sum = 0;
  let count = 0;
  for (const it of held) {
    let r = it.next();
    while (!r.done) {
      sum += typeof r.value === "number" ? r.value : r.value.length;
      count++;
      r = it.next();
    }
  }
  return sum + " " + count;
}
console.log(heldIterators(200));

// Both kinds at one place.
function either(c) {
  const it = c.values();
  let text = "";
  for (let r = it.next(); !r.done; r = it.next()) {
    text += r.value + ";";
    if (text.length === 4 && !Array.isArray(c)) grow(30)(c);
  }
  return text;
}
for (let turn = 0; turn < 60; turn++) {
  const texts = [either(mapOf(5)), either(setOf(5)), either([4, 5, 6].concat([7]))];
  if (turn === 59) console.log(texts.join("\n"));
}

// What has ended stays ended, though its collection grows behind its end.
function endedThenGrown(c) {
  const it = c.values();
  let n = 0;
  for (let r = it.next(); !r.done; r = it.next()) n++;
  grow(3)(c);
  const behind = it.next();
  grow(40)(c);
  return n + ":" + behind.done + ":" + it.next().value + ":" + [...it].length;
}
for (let turn = 0; turn < 60; turn++) {
  const texts = [endedThenGrown(mapOf(5)), endedThenGrown(setOf(5)), endedThenGrown(mapOf(0)), endedThenGrown(setOf(8))];
  if (turn === 59) console.log(texts.join("\n"));
}

// The same where the collection is in sight.
const fixedMap = new Map([["a", 1]]);
const fixedSet = new Set([1]);
function fixedMapSteps(n, at, more) {
  let s = 0;
  fixedMap.clear();
  for (let k = 0; k < n; k++) fixedMap.set(k, k * 2);
  for (let round = 0; round < 3; round++) {
    const it = fixedMap.values();
    let k = 0;
    for (let r = it.next(); !r.done; r = it.next()) {
      s = (s * 3 + r.value) | 0;
      if (k++ === at) for (let q = 0; q < more; q++) fixedMap.set("n" + round + ":" + q, q);
      if (k === at + 2) fixedMap.delete(k);
      if (k > 400) break;
    }
    for (let q = 0; q < more; q++) fixedMap.set("behind" + round + ":" + q, q);
    const behind = it.next();
    s += behind.done ? 1 : 1000;
  }
  return s + ":" + fixedMap.size;
}
function fixedSetSteps(n, at, more) {
  let s = 0;
  fixedSet.clear();
  for (let k = 0; k < n; k++) fixedSet.add(k * 2);
  for (let round = 0; round < 3; round++) {
    const it = fixedSet.values();
    let k = 0;
    let r;
    while (!(r = it.next()).done) {
      s = (s * 3 + (typeof r.value === "number" ? r.value : 7)) | 0;
      if (k++ === at) for (let q = 0; q < more; q++) fixedSet.add("n" + round + ":" + q);
      if (k === at + 3) fixedSet.clear();
      if (k > 400) break;
    }
    for (let q = 0; q < more; q++) fixedSet.add("behind" + round + ":" + q);
    s += it.next().done ? 1 : 1000;
  }
  return s + ":" + fixedSet.size;
}
for (const n of [0, 1, 4, 8, 30]) {
  for (const at of [0, 2, 7, 1000]) {
    for (const more of [0, 1, 5, 50]) console.log(n, at, more, fixedMapSteps(n, at, more), fixedSetSteps(n, at, more));
  }
}
