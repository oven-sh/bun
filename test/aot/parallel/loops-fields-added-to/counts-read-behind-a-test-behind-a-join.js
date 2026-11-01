class Ring {
  items = new Array(16).fill(0);
  head = 0;
  size = 0;
  push(value) {
    this.items[(this.head + this.size) & 15] = value;
    if (this.size < 16) this.size++;
    else this.head = (this.head + 1) & 15;
  }
  shift() {
    const value = this.items[this.head];
    this.head = (this.head + 1) & 15;
    this.size--;
    return value;
  }
}
const ring = new Ring();
function turn(i) {
  ring.push(i);
  if (i % 7 === 0) ring.push(i * 2);
  return ring.shift();
}
let sum = 0;
for (let i = 0; i < 5000; i++) sum = (sum + turn(i)) | 0;
console.log(sum, ring.size, ring.head);

class Twice {
  count = 0;
  seen = 0;
}
function storesBetween(o, a, b, seen) {
  if (a) o.count = o.count + 1;
  else o.seen = o.seen + 1;
  if (seen) o.count = seen;
  if (b) return o.count;
  return -1;
}
const twice = new Twice();
let total = 0;
for (let i = 0; i < 3000; i++) total += storesBetween(twice, i % 3 === 0, i % 2 === 0, i % 5 === 0 ? i : 0);
console.log(total, twice.count, twice.seen);

let shared = 1;
function setsShared(value) {
  shared = value;
}
function readBehindACall(a, b) {
  if (a) shared = 2;
  else shared = 3;
  if (b) setsShared(10);
  if (a === b) return shared;
  return 0;
}
console.log(readBehindACall(true, true), readBehindACall(true, false), readBehindACall(false, false), readBehindACall(false, true));
