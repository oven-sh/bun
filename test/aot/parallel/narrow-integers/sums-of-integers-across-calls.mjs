// Sums of integers in counted loops around calls, at the edges of what integers and doubles hold.
class Entry {
  constructor(key, value, next) {
    this.key = key;
    this.value = value;
    this.next = next;
  }
}
class Table {
  constructor(values) {
    this.slots = [null, null, null, null];
    for (let k = 0; k < 24; k++) this.slots[k & 3] = new Entry(k, values[k % values.length], this.slots[k & 3]);
  }
  find(key) {
    let entry = this.slots[key & 3];
    while (entry && entry.key !== key) entry = entry.next;
    return entry ? entry.value : -1;
  }
}
const told = v => (Object.is(v, -0) ? "-0" : String(v));
const small = new Table([1, 0, -7, 12]);
const large = new Table([2147483647, -2147483648, 2147483647, 2147483647]);
const none = new Table([3, null, 4, null]);

function nested(table) {
  let sum = 0;
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 3000; i++) sum += table.find(i & 31);
  }
  return sum;
}
function taken(table) {
  let sum = 5;
  for (let i = 0; i < 5000; i++) sum = sum - table.find(i % 25);
  return sum;
}
function fromMinusZero(table) {
  let sum = -0;
  for (let i = 0; i < 3; i++) sum += table.find(1) * 0;
  return sum;
}
function left(table, most) {
  let sum = 0;
  for (let j = 0; j < 40; j++) {
    for (let i = 0; i < 40; i++) {
      sum += table.find(i);
      if (sum > most) return [sum, j, i];
    }
    if (j === 9) sum = 0;
  }
  return [sum, -1, -1];
}
function thrown(table) {
  let sum = 0;
  try {
    for (let i = 0; i < 1000; i++) {
      sum += table.find(i & 15);
      if (i === 700) throw new Error(String(sum));
    }
  } catch (e) {
    return e.message + "/" + sum;
  }
  return "none";
}
const kept = [];
function stored(table) {
  let sum = 0;
  const half = [];
  for (let i = 0; i < 12; i++) {
    sum += table.find(i);
    kept.push(sum);
    half.push(sum / 2);
  }
  return half.join();
}
function beyond(table) {
  let sum = 9007199254740990;
  for (let i = 0; i < 6; i++) sum += table.find(i);
  return sum;
}
function without(n, table) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += table.find(i & 3);
  return sum;
}
for (const table of [small, large, none]) {
  console.log(told(nested(table)), told(taken(table)), told(fromMinusZero(table)), left(table, 100).join(), left(table, 1e12).join());
  console.log(thrown(table), stored(table), told(beyond(table)), told(without(100000, table)));
}
console.log(kept.map(told).join());
