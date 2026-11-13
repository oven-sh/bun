// Counter.n only ever holds null, and the old o.n is an object.
function veil(value) {
  return JSON.parse("0", () => value);
}
class Counter {
  constructor(list) {
    this.list = list;
    this.n = null;
    this.sum = 0;
  }
}
class Page {
  constructor(list) {
    this.list = list;
  }
}
class Queue {
  constructor(list) {
    this.list = list;
  }
}
class Shelf {
  constructor(list) {
    this.list = list;
  }
}
function tally(o) {
  for (let j = 0; j < 3; j++) o.sum += 0.5;
  let seen = 0;
  for (let i = 0; i < 8; i++) {
    o.n = o.n === null ? null : null;
    o.sum = (o.sum * 31 + o.list[i >> 1]) | 0;
  }
  return o.sum + "/" + o.n + "/" + seen;
}
const rows = [];
for (const r of rows) console.log(typeof new Counter(r));
console.log(tally(veil({ list: [1, 2, 3, 4], n: { a: 1 }, sum: 1, last: 0 })));
