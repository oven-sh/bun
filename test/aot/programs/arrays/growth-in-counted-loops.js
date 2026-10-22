// Arrays that counted loops append to: parameters, fields, literals longer than any planned capacity, arrays that cannot grow in place, loops that end early, and arrays replaced inside the loop.
function checksum(array) {
  let sum = 0;
  for (let i = 0; i < array.length; i++) sum = (Math.imul(sum, 31) + (array[i] | 0)) | 0;
  return array.length + ":" + sum;
}

function fill(list, n) {
  for (let i = 0; i < n; i++) list.push(i);
  return list;
}

function fillDown(list, n) {
  for (let i = n; i > 0; i--) list.push(i);
  return list;
}

function fillInclusive(list, n) {
  for (let i = 0; i <= n; i++) list.push(i * 0.5);
  return list;
}

function fillTwice(list, n) {
  for (let i = 0; i < n; i++) {
    list.push(i);
    list.push(-i);
  }
  return list;
}

function collect(n) {
  const kept = [];
  for (let i = 0; i < n; ++i) kept.push(i);
  return kept;
}

function copyInto(out, from) {
  for (let i = 0; i < from.length; i++) out.push(from[i]);
  return out;
}

class Bag {
  constructor() {
    this.items = [];
  }
  addAll(from) {
    for (let i = 0; i < from.length; i++) this.items.push(from[i]);
    return this;
  }
}

class Chunks {
  constructor() {
    this.current = [];
    this.full = [];
  }
  addAll(from, size) {
    for (let i = 0; i < from.length; i++) {
      this.current.push(from[i]);
      if (this.current.length === size) {
        this.full.push(this.current);
        this.current = [];
      }
    }
    return this;
  }
}

function fillUntilThrow(list, n, limit) {
  try {
    for (let i = 0; i < n; i++) {
      if (i === limit) throw new RangeError("stop");
      list.push(i);
    }
  } catch (error) {
    return error.message + " " + checksum(list);
  }
  return checksum(list);
}

function attempt(action) {
  try {
    return String(action());
  } catch (error) {
    return error.constructor.name;
  }
}

for (const n of [0, 1, 5, 6, 7, 100, 5000, 150000]) {
  console.log(n, checksum(fill([], n)), checksum(fillDown([], n)), checksum(fillInclusive([], n)), checksum(fillTwice([], n)), checksum(collect(n)));
  const source = collect(n);
  console.log(checksum(copyInto([], source)), checksum(copyInto([1, 2, 3], source)), checksum(new Bag().addAll(source).addAll(source).items));
}

const chunks = new Chunks().addAll(collect(100000), 8);
console.log(chunks.full.length, chunks.current.length, checksum(chunks.full[12499]));

console.log(checksum(fill([0.5, 1.5], 1000)), checksum(fill(["a", "b"], 1000)), checksum(fill([, , 1], 1000)));
console.log(fill([1, 2, 3], -5).length, fill([1, 2, 3], NaN).length, fill([1, 2, 3], 2.5).length, fill([1, 2, 3], "4").length);
console.log(attempt(() => fill(Object.freeze([1, 2]), 10).length), attempt(() => fill(Object.seal([1, 2]), 10).length), attempt(() => fill(Object.preventExtensions([1, 2]), 10).length));

const sparse = [];
sparse[200000] = 1;
console.log(fill(sparse, 100).length, sparse[200001], sparse[200100]);

const named = [1];
named.label = "kept";
console.log(checksum(fill(named, 5000)), named.label);

class Stack extends Array {}
console.log(checksum(fill(new Stack(), 5000)), fill(new Stack(), 3) instanceof Stack);

const constant = () => [1, 2, 3, 4];
console.log(checksum(fill(constant(), 2000)), checksum(constant()));

console.log(fillUntilThrow([], 1000000, 10), fillUntilThrow([], 20, 50));

const shared = [];
for (let round = 0; round < 2000; round++) fill(shared, 3);
console.log(checksum(shared));
