// Maps and Sets of every size of their index: insertion order, deleting while iterating, iterators that stay live while the table grows, is cleared or is emptied.
export {};

const lines: string[] = [];
function report(name: string, ...values: unknown[]) {
  lines.push(name + ": " + values.map(value => JSON.stringify(value)).join(" "));
}
function checksum(values: Iterable<unknown>): string {
  let count = 0;
  let sum = 0;
  for (const value of values) {
    const text = String(value);
    for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
    count++;
  }
  return count + ":" + sum;
}

const sizes = [1, 7, 8, 9, 12, 16, 17, 64, 65, 190, 191, 253, 254, 255, 256, 300, 1000, 5000];
const makers: [string, (i: number) => unknown][] = [
  ["numbers", i => i * 3],
  ["doubles", i => i + 0.5],
  ["strings", i => "key" + i],
  ["joined", i => "k" + (i % 7) + "-" + i],
  ["objects", i => ({ i })],
  ["mixed", i => (i % 3 === 0 ? i : i % 3 === 1 ? "m" + i : BigInt(i))],
];

for (const [kind, make] of makers) {
  for (const size of sizes) {
    const keys = Array.from({ length: size }, (_, i) => make(i));
    const map = new Map<unknown, number>();
    const set = new Set<unknown>();
    keys.forEach((key, i) => {
      map.set(key, i);
      set.add(key);
    });
    let found = 0;
    keys.forEach((key, i) => {
      if (map.get(key) === i && map.has(key) && set.has(key)) found++;
    });
    let absent = 0;
    for (let i = size; i < size * 2 + 9; i++) {
      const other = kind === "objects" ? {} : make(i);
      if (!map.has(other) && map.get(other) === undefined && !set.has(other)) absent++;
    }
    const inOrder = kind === "objects" ? [...map.values()] : [...map.keys()];
    // Every third key goes, and comes back at the end.
    keys.forEach((key, i) => {
      if (i % 3 === 0) {
        map.delete(key);
        set.delete(key);
      }
    });
    const stillThere = keys.filter(key => set.has(key)).length;
    keys.forEach((key, i) => {
      if (i % 6 === 0) {
        map.set(key, -i);
        set.add(key);
      }
    });
    const order = kind === "objects" ? [...map.values()] : [...set];
    report(kind + " " + size, found, absent, checksum(inOrder), stillThere, map.size, set.size, checksum(order));
  }
}

for (const size of [9, 64, 255, 1000]) {
  // Deleted ahead of the walk, deleted behind it, added during it.
  const map = new Map<number, number>();
  for (let i = 0; i < size; i++) map.set(i, i);
  const seen: number[] = [];
  for (const [key] of map) {
    seen.push(key);
    if (key % 5 === 0) map.delete(key + 1);
    if (key % 7 === 0) map.delete(key);
    if (key < size && key % 11 === 0) map.set(size + key, key);
    if (seen.length > size * 3) break;
  }
  report("delete and add in a walk " + size, seen.length, checksum(seen), map.size);

  // An iterator stays live over growing, over a clear, and over emptying.
  const set = new Set<string>();
  for (let i = 0; i < size; i++) set.add("s" + i);
  const iterator = set.values();
  const first = iterator.next().value;
  for (let i = size; i < size * 3; i++) set.add("s" + i);
  const second = iterator.next().value;
  set.delete("s2");
  const third = iterator.next().value;
  const walker = set.entries();
  walker.next();
  set.clear();
  const afterClear = walker.next();
  set.add("again");
  const seesNew = walker.next();
  const ended = iterator.next();
  report("iterators " + size, first, second, third, afterClear, seesNew, ended);

  // A forEach that deletes everything and adds some.
  const each = new Set<number>();
  for (let i = 0; i < size; i++) each.add(i);
  let turns = 0;
  each.forEach(value => {
    turns++;
    each.delete(value);
    if (value < 20 && value % 2 === 0) each.add(value + size);
  });
  report("forEach " + size, turns, each.size);
}

// Written in the program, so that they may start in the executable's own data; then changed.
const written = new Map<string, number>([
  ["alpha", 1], ["bravo", 2], ["charlie", 3], ["delta", 4], ["echo", 5], ["foxtrot", 6], ["golf", 7], ["hotel", 8], ["india", 9],
  ["juliet", 10], ["kilo", 11], ["lima", 12], ["mike", 13], ["november", 14], ["oscar", 15], ["papa", 16], ["quebec", 17],
]);
const writtenSet = new Set<string>(["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"]);
const asked = ["alpha", "lima", "quebec", "zulu", "", "alph" + "a", ["pa", "pa"].join(""), "juliet".slice(0, 3) + "iet", JSON.parse('"oscar"')];
report("written", asked.map(key => written.get(key)), asked.map(key => writtenSet.has(key)), written.size, writtenSet.size);
const walk = written.keys();
walk.next();
written.set("romeo", 18);
written.delete("bravo");
writtenSet.add("mike");
writtenSet.delete("alpha");
report("written, changed", walk.next().value, asked.map(key => written.get(key)), asked.map(key => writtenSet.has(key)), [...written.keys()].join(), [...writtenSet].join());

// One key in each of the kinds that compare by value.
const odd = new Map<unknown, string>();
for (const key of [0, -0, NaN, 1.5, "1.5", null, undefined, true, 10n, 2 ** 53, -1, "", "0"]) odd.set(key, typeof key);
for (let i = 0; i < 40; i++) odd.set("fill" + i, "fill");
report("odd keys", odd.size, [0, -0, NaN, 1.5, "1.5", null, undefined, true, false, 10n, 11n, 2 ** 53, -1, "", "0", "fill39", "fill40"].map(key => odd.get(key) ?? "absent"));

console.log(lines.join("\n"));
