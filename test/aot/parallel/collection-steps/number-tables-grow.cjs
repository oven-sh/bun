// Maps and sets of numbers grow past each of their sizes, with other keys amid them, while iterators wait, and behind deletions.
const object = { a: 1 };
const kinds = [
  i => i, i => i * 1.5, i => -i, i => (i ? 1 / i : -0), i => (i % 5 ? i : NaN), i => 2 ** 31 + i, i => i * 1e15, i => i % 11,
  i => (i === 9 ? object : i), i => (i > 30 ? "s" + i : i), i => (i > 10 ? i : "s" + i), i => (i % 13 === 12 ? null : i), i => (i % 17 === 16 ? BigInt(i) : i),
];
const values = [i => i, i => i * 0.5, i => "v" + i, i => (i > 20 ? "w" : i), i => undefined, i => (i % 3 ? i : object)];
const show = x => (typeof x === "bigint" ? x + "n" : typeof x === "object" && x ? "object" : Object.is(x, -0) ? "-0" : String(x));
const sizes = [1, 2, 3, 4, 5, 8, 9, 13, 24, 40, 63, 64, 65, 97, 130];
kinds.forEach((kind, number) => {
  let sum = 0;
  const log = [];
  for (const size of sizes) {
    const value = values[(number + size) % values.length];
    const set = new Set(), map = new Map();
    let waiting;
    for (let i = 0; i < size; i++) {
      set.add(kind(i));
      map.set(kind(i), value(i));
      if (i === 2) waiting = map.keys();
      if (i === 6) set.delete(kind(3));
      if (waiting && i === 7) sum += typeof waiting.next().value === "number" ? 1 : 2;
    }
    for (let i = 0; i < size; i++) sum += (set.has(kind(i)) ? 1 : 0) + (map.has(kind(i)) ? 1 : 0) + (map.get(kind(i)) === value(i) ? 1 : 0);
    for (let i = 0; i < size; i += 3) map.delete(kind(i));
    for (let i = 0; i < 5; i++) set.add(i * 1000 + 0.25);
    log.push(set.size, map.size, waiting ? [...waiting].slice(0, 3).map(show).join(" ") : "", [...set].slice(-6).map(show).join(" "), [...map].slice(0, 2).map(entry => entry.map(show).join(":")).join(" "));
  }
  console.log(sum, log.join("|"));
});
