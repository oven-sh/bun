// Fields hold lists that a helper fills with views; loops read the elements of those views, which are replaced, removed, detached or of other classes.
"use strict";
function banks(count, size, kind) {
  const list = [];
  for (let bank = 0; bank < count; bank++) list.push(new kind(size));
  return list;
}
class Store {
  constructor(size) {
    this.size = size;
    this.low = banks(3, size, Uint8Array);
    this.high = banks(2, size, Int32Array);
    for (const list of [this.low, this.high]) for (let bank = 0; bank < list.length; bank++) for (let at = 0; at < size; at++) list[bank][at] = at * (bank + 2) - 9;
  }
  sum(bank) {
    let sum = 0;
    for (let at = 0; at < this.size; at++) sum += this.low[bank][at] * 2 + this.high[bank][at];
    return sum;
  }
  carry(from, to) {
    const source = this.low[from];
    for (let at = 0; at < this.size; at++) this.high[to][at] += source[at];
    return this.high[to][this.size - 1];
  }
}
function tried(action) {
  try {
    return String(action());
  } catch (error) {
    return error.constructor.name;
  }
}
const store = new Store(12);
for (let round = 0; round < 40; round++) {
  const sum = store.sum(round & 1);
  const last = store.carry(round % 3, round & 1);
  if (round % 13 === 0) console.log(round, sum, last);
}
const changes = {
  shorter: one => (one.low[0] = new Uint8Array(5)),
  longer: one => (one.low[0] = new Uint8Array(40).fill(3)),
  floats: one => (one.high[0] = new Float64Array(12).fill(0.25)),
  list: one => (one.low[0] = Array.from({ length: 12 }, (_, at) => at / 2)),
  removed: one => one.low.shift(),
  gone: one => (one.high.length = 0),
  nothing: one => (one.low[0] = null),
  text: one => (one.low[0] = "0123456789ab"),
  moved: one => one.low[0].buffer.transfer(),
  shared: one => (one.high[0] = new Int32Array(new SharedArrayBuffer(48))),
  big: one => (one.high[0] = new BigInt64Array(12)),
  field: one => (one.low = one.high),
  object: one => (one.high = { 0: [1, 2, 3], 1: new Int8Array(12) }),
  swapped: one => ([one.low, one.high] = [one.high, one.low]),
};
for (const name of Object.keys(changes)) {
  const one = new Store(12);
  one.sum(0);
  changes[name](one);
  console.log(name, tried(() => one.sum(0)), tried(() => one.sum(1)), tried(() => one.carry(0, 0)), tried(() => one.carry(1, 1)));
}
