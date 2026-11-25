// A rope that a comparison resolves keeps its short text in its cell; collections, names, slices and later comparisons find the same text.
const ids = [];
for (let i = 0; i < 400; i++) ids.push((i % 3 ? "id" : i % 2 ? "Id" : "x") + i);
class Entry {
  constructor(id) {
    this.id = id;
  }
  compareTo(other) {
    return this.id.localeCompare(other.id);
  }
}
const entries = ids.map(id => new Entry(id));
let sum = 0;
function orders(entry) {
  for (const other of entries) sum = (sum * 31 + entry.compareTo(other)) | 0;
}
for (let round = 0; round < 3; round++) {
  for (let i = round; i < entries.length; i += 7) orders(entries[i]);
  if (globalThis.Bun) Bun.gc(round === 1);
  const rows = [];
  for (let i = 0; i < 2000; i++) rows.push({ id: "r" + i, list: [i] });
  sum = (sum + rows.length) | 0;
}
const table = {}, map = new Map();
for (const entry of entries) {
  table[entry.id] = (table[entry.id] | 0) + 1;
  map.set(entry.id, entry.id.length);
}
let found = 0;
for (let i = 0; i < 400; i++) {
  const id = (i % 3 ? "id" : i % 2 ? "Id" : "x") + i;
  found += table[id] + map.get(id) + (id === entries[i].id ? 1 : 100) + (entries[i].id < "id2" ? 1 : 0) + entries[i].id.charCodeAt(1) + (typeof entries[i].id === "string" ? 1 : 50);
}
const joined = entries.map(entry => entry.id + "-" + entry.id.slice(1)).join();
const sorted = entries.slice().sort((a, b) => a.compareTo(b));
let hash = 0;
for (let i = 0; i < joined.length; i++) hash = (hash * 31 + joined.charCodeAt(i)) | 0;
console.log(sum, found, hash, joined.length, sorted.slice(0, 6).map(entry => entry.id).join(), JSON.stringify(sorted[399]), Object.keys(table).length, structuredClone(sorted[7]).id);
