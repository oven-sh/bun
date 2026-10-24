// Iterators and loops stand in a Map or a Set while entries in front of them and behind them are deleted and added, the collection is cleared, and the collector runs in between.
let seed = 20261023;
function random(limit) {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % limit;
}

const keyMakers = [n => n, n => "k" + n, n => n * 4194304 + 1, n => n + 0.5, n => (n & 1 ? n : "s" + n)];

function step(walker) {
  const result = walker.iterator.next();
  if (!result.done) walker.seen.push(String(result.value));
  return !result.done;
}

function runIterators(isMap, makeKey) {
  const collection = isMap ? new Map() : new Set();
  const add = n => (isMap ? collection.set(makeKey(n), n) : collection.add(makeKey(n)));
  let next = 0;
  const size = 1 + random(40);
  while (next < size) add(next++);
  const walkers = [];
  for (let w = 0; w < 4; w++) {
    const iterator = w === 0 ? collection.keys() : w === 1 ? collection.values() : w === 2 ? collection.entries() : collection[Symbol.iterator]();
    const walker = { iterator, seen: [] };
    for (let steps = random(size + 2); steps > 0 && step(walker); steps--);
    walkers.push(walker);
  }
  for (let phases = 1 + random(6); phases > 0; phases--) {
    for (let churn = random(120); churn > 0; churn--) {
      if (random(3)) add(next++);
      collection.delete(makeKey(random(next)));
      if (!random(150)) collection.clear();
    }
    if (random(3)) Bun.gc(true);
    for (const walker of walkers) if (random(2)) step(walker);
  }
  Bun.gc(true);
  for (const walker of walkers) for (let most = 400; most > 0 && step(walker); most--);
  return walkers.map(walker => walker.seen.join(",")).join(" | ") + " # " + collection.size;
}

function runLoop(isMap, makeKey) {
  const collection = isMap ? new Map() : new Set();
  const add = n => (isMap ? collection.set(makeKey(n), n) : collection.add(makeKey(n)));
  let next = 0;
  const size = 1 + random(30);
  while (next < size) add(next++);
  const seen = [];
  let turns = 0;
  for (const item of collection) {
    seen.push(String(item));
    if (++turns > 60) break;
    for (let churn = random(40); churn > 0; churn--) {
      if (turns < 30 && random(2)) add(next++);
      collection.delete(makeKey(random(next)));
    }
    if (!random(4)) Bun.gc(true);
  }
  return seen.join(",") + " # " + collection.size;
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return h;
}

for (let round = 0; round < 400; round++) {
  const isMap = (round & 1) === 0;
  const makeKey = keyMakers[round % keyMakers.length];
  const text = round % 4 === 3 ? runLoop(isMap, makeKey) : runIterators(isMap, makeKey);
  console.log(round, hash(text), round < 12 ? text : "");
}
