function keysFor(count, kind) {
  const keys = [];
  for (let i = 0; i < count; i++) keys.push(kind === "objects" ? { i } : kind === "strings" ? "key" + i : kind === "numbers" ? i * 3 : i % 2 ? "key" + i : { i });
  return keys;
}
const nameOf = key => (typeof key === "object" ? "o" + key.i : String(key));
const rest = iterator => { const seen = []; for (let step = iterator.next(); !step.done; step = iterator.next()) seen.push(nameOf(step.value)); return seen.join(); };

function emptySet(count, kind) {
  const keys = keysFor(count + 3, kind);
  const out = [];
  const set = new Set();
  const beforeAnyEntry = set.values();
  for (let i = 0; i < count; i++) set.add(keys[i]);
  const notStarted = set.values();
  for (let i = 0; i < count; i++) set.delete(keys[i]);
  out.push(set.size);
  set.add(keys[count]);
  set.add(keys[count + 1]);
  out.push(rest(beforeAnyEntry), rest(notStarted), rest(set.values()), set.has(keys[0]), set.has(keys[count]));

  const started = set.values();
  out.push(nameOf(started.next().value));
  set.delete(keys[count]);
  set.delete(keys[count + 1]);
  set.add(keys[count + 2]);
  set.add(keys[0]);
  out.push(rest(started), set.size, [...set].map(nameOf).join());
  return out.join(" ");
}

function emptyMap(count, kind) {
  const keys = keysFor(count + 3, kind);
  const out = [];
  const map = new Map();
  const notStarted = map.keys();
  for (let i = 0; i < count; i++) map.set(keys[i], i);
  for (let i = count; i--;) map.delete(keys[i]);
  map.set(keys[count], "a");
  out.push(map.size, rest(notStarted), map.get(keys[count]), map.get(keys[0]));

  let rounds = 0;
  for (const [key, value] of map) {
    out.push(nameOf(key) + "=" + value);
    map.delete(key);
    if (rounds++ < 3) map.set(keys[count + (rounds % 3)], rounds);
  }
  out.push(map.size);
  map.set(keys[1], "b");
  map.forEach((value, key) => { out.push(nameOf(key) + "=" + value); map.delete(key); if (rounds++ < 6) map.set(keys[rounds % 3], rounds); });
  out.push(map.size, [...map.keys()].map(nameOf).join());
  return out.join(" ");
}

function churn(alive, kind) {
  const keys = keysFor(64, kind);
  const set = new Set(), map = new Map();
  let sum = 0;
  for (let i = 0; i < 1000; i++) {
    set.add(keys[i & 63]);
    map.set(keys[i & 63], i);
    if (i >= alive) {
      set.delete(keys[(i - alive) & 63]);
      map.delete(keys[(i - alive) & 63]);
    }
    sum += set.size + map.size;
  }
  return [sum, [...set].map(nameOf).join(), [...map].map(([key, value]) => nameOf(key) + "=" + value).join()].join(" ");
}

for (const kind of ["objects", "strings", "numbers", "mixed"]) {
  for (const count of [1, 2, 4, 5, 8, 9, 20, 40]) console.log(kind, count, "|", emptySet(count, kind), "|", emptyMap(count, kind));
  for (const alive of [0, 1, 2, 3, 7, 20, 50]) console.log(kind, "churn", alive, churn(alive, kind));
}
