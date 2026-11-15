// Elements that are read to be stored elsewhere are moved as they are.
const kinds = {
  strings: () => Array.from({ length: 12 }, (_, i) => "s" + i), objects: () => Array.from({ length: 12 }, (_, i) => ({ id: i })), functions: () => Array.from({ length: 12 }, (_, i) => Object.assign(() => i, { id: "f" + i })),
  symbols: () => Array.from({ length: 12 }, (_, i) => Symbol("y" + i)), sparse: () => { const list = Array.from({ length: 12 }, (_, i) => "p" + i); delete list[3]; delete list[7]; return list; }, undefineds: () => Array.from({ length: 12 }, (_, i) => (i % 4 ? "u" + i : undefined)),
  nulls: () => Array.from({ length: 12 }, (_, i) => (i % 3 ? { id: i } : null)), integers: () => Array.from({ length: 12 }, (_, i) => i), fractions: () => Array.from({ length: 12 }, (_, i) => i / 4), mixed: () => Array.from({ length: 12 }, (_, i) => [i, "x" + i, { id: i }, null][i % 4]),
};
const show = v => (v === null ? "null" : typeof v === "object" || typeof v === "function" ? v.id : typeof v === "symbol" ? v.description : String(v));
class Holder { constructor(list) { this.list = list; } swap(i, j) { const held = this.list[i]; this.list[i] = this.list[j]; this.list[j] = held; } reverse() { for (let i = 0, j = this.list.length - 1; i < j; i++, j--) this.swap(i, j); } }
function rotate(list) { const first = list[0]; for (let i = 1; i < list.length; i++) list[i - 1] = list[i]; list[list.length - 1] = first; }
function copy(from, to) { for (let i = 0; i < from.length; i++) to[i] = from[i]; }
function scatter(list) { for (let i = 0; i < list.length; i++) { const at = (i * 5) % list.length, held = list[at]; list[at] = list[i]; list[i] = held; } }
function sift(list, less) { for (let i = 1; i < list.length; i++) { const held = list[i]; let j = i; while (j > 0 && less(held, list[j - 1])) { list[j] = list[j - 1]; j--; } list[j] = held; } }
for (const [name, make] of Object.entries(kinds)) {
  const list = make(), holder = new Holder(list);
  for (let round = 0; round < 3; round++) {
    holder.reverse(); rotate(list); scatter(list);
    const other = []; copy(list, other);
    sift(list, (a, b) => String(show(a)) < String(show(b)));
    console.log(name, list.map(show).join(), other.map(show).join(), Object.keys(list).length, Object.keys(other).length, 3 in list);
  }
  list.length = 5; holder.swap(1, 9); console.log(list.length, list.map(show).join());
}
