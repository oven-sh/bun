// A loop goes over arrays, strings, a String object and objects that only borrow Array.prototype[Symbol.iterator].
// Each receiver is iterated by the method that it finds itself, and what the steps hand out is what it holds.
class Row {
  constructor(id) {
    this.id = id;
  }
}

class Shelf {
  constructor(...rows) {
    this.length = rows.length;
    rows.forEach((row, index) => (this[index] = row));
  }
}
Shelf.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];

const borrowed = { 0: new Row(7), 1: new Row(8), length: 2, [Symbol.iterator]: Array.prototype.values };

function describe(value) {
  return value instanceof Row ? `row ${value.id}` : `${typeof value} ${String(value)}`;
}

function list(iterable) {
  const seen = [];
  for (const value of iterable) seen.push(describe(value));
  return seen;
}

function first([value]) {
  return describe(value);
}

const iterables = [[new Row(1), new Row(2)], "ab", new String("cd"), new Shelf(new Row(3), new Row(4)), borrowed, new Set([new Row(5)]), new Map([[new Row(6), 1]]).keys()];
for (const iterable of iterables) console.log(JSON.stringify(list(iterable)), first(iterable), JSON.stringify([...iterable].map(describe)));

Promise.all([new Row(9)]).then(([row]) => console.log(describe(row), row.id));
