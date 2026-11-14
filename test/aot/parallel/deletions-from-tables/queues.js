const kinds = {
  ints: (i) => i,
  doubles: (i) => i + 0.5,
  texts: (i) => "k" + i,
  objects: ((made) => (i) => (made[i] ??= { i }))([]),
  mixed: ((made) => (i) => (i % 4 === 0 ? i : i % 4 === 1 ? "t" + i : i % 4 === 2 ? i / 8 : (made[i] ??= [i])))([]),
};
const values = [(i) => i, (i) => i / 4, (i) => ({ i }), (i) => undefined, (i) => "v" + i];
const show = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
for (const [name, key] of Object.entries(kinds)) {
  for (const width of [1, 3, 6, 12, 40, 130]) {
    for (let v = 0; v < values.length; v++) {
      const map = new Map();
      const set = new Set();
      let sum = 0;
      for (let i = 0; i < width * 5 + 20; i++) {
        map.set(key(i), values[v](i));
        set.add(key(i));
        if (map.size > width) {
          sum += map.delete(key(i - width)) ? 1 : 1000;
          sum += set.delete(key(i - width)) ? 1 : 1000;
        }
        if (map.has(key(i - width))) sum += 100000;
        const middle = map.get(key(i - (width >> 1)));
        sum += typeof middle === "number" ? middle : show(middle).length;
      }
      console.log(name, width, v, sum, map.size, set.size, [...map.keys()].slice(0, 3).map(show).join(), [...map.values()].slice(-2).map(show).join(), [...set].slice(-2).map(show).join());
    }
  }
}
for (const opens of [0, 3, 7, 11]) {
  const map = new Map();
  let log = "";
  const iterators = [];
  for (let i = 0; i < 60; i++) {
    map.set(i, i);
    if (map.size > 9) map.delete(i - 9 + (i % 3));
    if (i % 12 === opens) iterators.push(map.keys(), map.entries());
    for (const iterator of iterators) {
      const step = iterator.next();
      log += step.done ? "." : show(step.value) + ",";
    }
  }
  map.forEach((v, k) => { if (k % 2) map.delete(k); if (k < 50) map.set(k + 1000, v); log += k + ";"; });
  console.log(opens, log);
}
