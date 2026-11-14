// Loops along links, entered with what was asked whether it is an entry, with what was not, and with nothing.
class Entry {
  constructor(key, value, next) {
    this.key = key;
    this.value = value;
    this.next = next;
  }
}
const table = [];
let head = null;

function find(key) {
  let entry = table[key & 7];
  while (entry && (entry.key !== key || entry.value < 0)) entry = entry.next;
  return entry;
}
function findAsked(key) {
  let entry = table[key & 7];
  if (!entry) return -1;
  while (entry && entry.key !== key) entry = entry.next;
  return entry ? entry.value : -2;
}
function findFrom(entry, key) {
  while (entry && entry.key !== key) entry = entry.next;
  return entry ? entry.value : -3;
}
function sum(entry) {
  let total = 0;
  for (; entry; entry = entry.next) total += entry.value;
  return total;
}
function sumAsked(key) {
  let total = 0,
    entry = table[key & 7];
  if (entry === undefined || entry === null) return "none";
  do {
    if (entry.value & 1) total += entry.value;
    entry = entry.next;
  } while (entry);
  return total;
}
function last(entry) {
  while (entry && entry.next) entry = entry.next;
  return entry && entry.key;
}
function remove(key) {
  let entry = table[key & 7],
    before = null;
  while (entry && entry.key !== key) {
    before = entry;
    entry = entry.next;
  }
  if (!entry) return false;
  if (before) before.next = entry.next;
  else table[key & 7] = entry.next;
  return true;
}
function pairs(key) {
  let count = 0;
  for (let one = table[key & 7]; one; one = one.next) for (let other = one.next; other; other = other.next) count += other.key < one.key ? 1 : 100;
  return count;
}
function stops(key) {
  let entry = table[key & 7];
  try {
    while (entry) {
      if (entry.key === key) throw entry;
      entry = entry.next;
    }
  } catch (found) {
    return found.value;
  }
  return entry;
}

const out = [];
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 30; i++) {
    const key = (i * 7) & 31;
    if (key & 7) table[key & 7] = new Entry(key, i - 3, table[key & 7] ?? null);
    head = new Entry(i, i * 2, i % 9 ? head : null);
  }
  for (let key = 0; key < 40; key++) {
    out.push(find(key)?.value, findAsked(key), findFrom(head, key), findFrom(table[key & 3], key), sum(table[key & 7]), sumAsked(key), last(head), pairs(key), stops(key));
    if (key % 5 === round) out.push(remove(key), find(key) === null);
  }
}
console.log(out.join());
