class Kind {
  constructor(name) {
    this.name = name;
  }
  get isFirst() {
    return this === first;
  }
}
const first = new Kind("first");
const second = new Kind("second");
const symbol = Symbol("symbol");
const list = [1, 2];
function handler() {}
class Base {}
let last = first;

class Entry {
  constructor(kind, value) {
    this.kind = kind;
    this.value = value;
  }
  get holdsFirst() {
    return this.value === first;
  }
  get holdsOtherThanSecond() {
    return second !== this.value;
  }
}

const held = [first, second, symbol, list, handler, Base, null, undefined, 1, "first"];
const entries = [];
for (let index = 0; index < 40; index++) entries.push(new Entry(held[(index * 7) % held.length], held[(index * 3) % held.length]));

function compare(entry, kind, value) {
  let bits = 0;
  if (kind === first) bits |= 1;
  if (second === kind) bits |= 2;
  if (kind !== symbol) bits |= 4;
  if (list !== kind) bits |= 8;
  if (entry.kind === handler) bits |= 16;
  if (Base === entry.kind) bits |= 32;
  if (entry.kind !== first) bits |= 64;
  if (last !== entry.kind) bits |= 128;
  if (value === last) bits |= 256;
  if (entry.holdsFirst) bits |= 512;
  if (entry.holdsOtherThanSecond) bits |= 1024;
  return bits;
}

function count(all, sought) {
  let counts = 0;
  for (let index = 0; index < all.length; index++) {
    const entry = all[index];
    if (entry.value === first) counts += 1;
    if (entry.value !== second) counts += 100;
    if (entry.kind === symbol || handler === entry.kind) counts += 10000;
    if (entry === sought) continue;
    switch (entry.kind) {
      case first:
        counts += 1000000;
        break;
      case list:
      case Base:
        counts += 2000000;
        break;
      case last:
        counts += 4000000;
    }
  }
  return counts;
}

for (let round = 0; round < 12; round++) {
  if (round === 5) last = second;
  if (round === 9) last = entries[3];
  const entry = entries[(round * 5) % entries.length];
  console.log(round, compare(entry, held[round % held.length], held[(round * 3) % held.length]), count(entries, entry));
}
console.log(first.isFirst, second.isFirst, entries.filter(entry => entry.holdsFirst).length, entries.filter(entry => entry.holdsOtherThanSecond).length);
